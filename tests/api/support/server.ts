/**
 * Boots one real `next dev` server for the whole tests/api run, and gives the
 * suites a two-line way to talk to it.
 *
 * **One server, not one per file.** Spawning a dev server per test file would
 * put several concurrent processes on a single `.next/` build directory, which
 * is a cache-corruption hazard rather than merely slow. tests/api/index.test.ts
 * is consequently the only file matching the `test:api` glob; the per-resource
 * suites live in tests/api/suites/ (no `.test.ts` suffix) and are registered by
 * it. That also makes the singleton `chat_state` row race-free for free.
 *
 * **Dev, not a production build.** A `next build` per test run would dominate
 * the suite's cost, and production-build fidelity is the E2E suite's job
 * (plan §4.3). Route handlers behave identically in both modes here — none of
 * them carries route-segment config, and Next 16 makes them dynamic by default.
 *
 * State is module-scoped rather than threaded through every suite as a
 * parameter, because there is exactly one server per process by construction.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const nextBin = fileURLToPath(
  new URL("../../../node_modules/next/dist/bin/next", import.meta.url)
)

/** How long a cold first compile may take before the harness gives up. */
const BOOT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 250
/** How long SIGTERM gets before the process group is killed outright. */
const SHUTDOWN_GRACE_MS = 10_000

let child: ChildProcess | undefined
let baseUrl: string | undefined
/** Child stdout+stderr, capped, printed only when boot fails. */
let output = ""

function record(chunk: unknown): void {
  output = (output + String(chunk)).slice(-20_000)
}

/** Asks the OS for a port nobody is using, then hands it straight back. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()

      if (address === null || typeof address === "string") {
        probe.close()
        reject(new Error("Could not resolve a free port for the API server."))
        return
      }

      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Polls /api/health until it answers `{ ok: true }`, which additionally proves
 * the target database is reachable *and* migrated — a half-migrated schema can
 * never reach a test.
 */
async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(
        `The API test server exited with code ${child.exitCode} before ` +
          `becoming healthy.\n--- server output ---\n${output}`
      )
    }

    try {
      const response = await fetch(`${url}/api/health`)
      const body = (await response.json()) as { ok?: boolean }
      if (response.ok && body.ok === true) return
    } catch {
      // Not listening yet, or mid-compile. Keep polling until the deadline.
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(
    `The API test server did not report healthy within ` +
      `${BOOT_TIMEOUT_MS}ms.\n--- server output ---\n${output}`
  )
}

/**
 * Starts the server and resolves once it is serving. Idempotent.
 *
 * DATABASE_URL is overridden in the child's env, never on the command line, so
 * no credential can reach a process listing or a transcript. `@next/env` does
 * not overwrite a variable already present in `process.env` (verified against
 * the installed compiled source), so this survives `.env.local` — and
 * `assertServerUsesTestDatabase()` checks that claim at runtime rather than
 * trusting it.
 */
export async function startApiServer(): Promise<string> {
  if (baseUrl) return baseUrl

  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}`

  child = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: resolveTestDbUrl(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      // A process group, so teardown can take the dev server's forked children
      // with it rather than orphaning them on a held port.
      detached: true,
    }
  )

  child.stdout?.on("data", record)
  child.stderr?.on("data", record)

  await waitForHealth(url)

  baseUrl = url
  return url
}

/** Stops the server and everything it forked. Idempotent. */
export async function stopApiServer(): Promise<void> {
  const running = child
  child = undefined
  baseUrl = undefined

  if (!running || running.pid === undefined || running.exitCode !== null) return

  const exited = new Promise<void>((resolve) => {
    running.once("exit", () => resolve())
  })

  try {
    process.kill(-running.pid, "SIGTERM")
  } catch {
    // Already gone.
    return
  }

  const timedOut = Symbol("timeout")
  const race = await Promise.race([
    exited.then(() => "exited" as const),
    sleep(SHUTDOWN_GRACE_MS).then(() => timedOut),
  ])

  if (race === timedOut) {
    try {
      process.kill(-running.pid, "SIGKILL")
    } catch {
      // Raced with a natural exit.
    }
    await exited
  }
}

/** Absolute URL for a path like `/api/projects`. */
export function apiUrl(path: string): string {
  if (!baseUrl) {
    throw new Error("The API test server is not running. Did startApiServer()?")
  }

  return `${baseUrl}${path}`
}

/** `fetch` against the running server, with a JSON content type by default. */
export async function api(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

/**
 * `api()` plus a parsed body, so a suite reads status and body in one line.
 * The body is read as text first: an unexpected HTML error page then surfaces
 * as a legible assertion failure instead of a bare JSON parse error.
 */
export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: T }> {
  const response = await api(path, init)
  const raw = await response.text()

  let body: unknown

  try {
    body = raw === "" ? undefined : JSON.parse(raw)
  } catch {
    throw new Error(
      `${init.method ?? "GET"} ${path} returned ${response.status} with a ` +
        `non-JSON body:\n${raw.slice(0, 1000)}`
    )
  }

  return { status: response.status, body: body as T }
}
