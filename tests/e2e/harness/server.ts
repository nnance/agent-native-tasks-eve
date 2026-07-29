/**
 * Boots one `next start` per E2E test file, against the **test** database.
 *
 * A production build, not `next dev` — that is implementation plan §4.3's
 * explicit requirement, and it is what makes the suite an exit gate rather
 * than a dev-mode smoke test. The build itself happens once per `pnpm
 * test:e2e` invocation (`next build && node --test …`); this module refuses to
 * run without one rather than shelling out to a builder inside a test hook,
 * where a five-minute compile would look like a hang.
 *
 * The port/health/kill plumbing is adapted from `tests/api/support/server.ts`
 * rather than imported: that module is a module-scoped `next dev` singleton
 * owned by the API suite, so it cannot be reused here. The **database guard**
 * is not duplicated — it comes from `lib/db/urls.ts`, which exists precisely
 * so exactly one copy of it can exist.
 *
 * ## The eve agent server, and why the harness has to start it
 *
 * Under `next dev`, `withEve()` boots the eve dev server for you. Under `next
 * start` it does not, and the reason is structural rather than a bug: the
 * spawn happens inside `resolveEveDestinationPrefix`, which `withEve` calls
 * only from `next.config.ts`'s `rewrites()` — and `rewrites()` is evaluated at
 * **build** time. `next start` reads the finished rewrite out of
 * `.next/routes-manifest.json`, so the route `/eve/v1/:path+ →
 * http://127.0.0.1:4274/eve/v1/:path+` is baked and correct while nothing ever
 * listens on the other end. `eve/docs/guides/frontend/nextjs.mdx` states the
 * same requirement in prose ("Run `eve build` first so that output exists").
 *
 * Measured directly during Phase 5: with `next start` alone, a request to
 * `/eve/v1/health` through the Next origin answered 500 with `ECONNREFUSED
 * 127.0.0.1:4274`; with `eve start --port 4274` alongside it, the same request
 * answered `{"ok":true,"status":"ready",…}`.
 *
 * So suites that drive the agent opt in with `startE2eServer({ eve: true })`,
 * and 01–05 stay fast and untouched.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
const nextBin = fileURLToPath(
  new URL("../../../node_modules/next/dist/bin/next", import.meta.url)
)
const eveBin = fileURLToPath(
  new URL("../../../node_modules/eve/bin/eve.js", import.meta.url)
)
const buildIdPath = fileURLToPath(
  new URL("../../../.next/BUILD_ID", import.meta.url)
)
const eveOutputPath = fileURLToPath(
  new URL("../../../.output/server/index.mjs", import.meta.url)
)

const BOOT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 200
const SHUTDOWN_GRACE_MS = 10_000

/**
 * The port baked into the rewrite at `next build` time.
 *
 * `withEve` reads `EVE_NEXT_PRODUCTION_PORT` and falls back to 4274, so build
 * and runtime agree as long as they read the same variable — which is why this
 * is derived rather than written as a literal.
 */
export const EVE_LOCAL_PORT = Number(
  process.env.EVE_NEXT_PRODUCTION_PORT ?? 4274
)

export type E2eServer = {
  baseUrl: string
  output: () => string
  stop: () => Promise<void>
}

export type E2eServerOptions = {
  /** Also start the eve agent server, for suites that drive the agent. */
  eve?: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()

      if (address === null || typeof address === "string") {
        probe.close()
        reject(new Error("Could not resolve a free port for the E2E server."))
        return
      }

      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

/**
 * Kills a spawned process group, SIGTERM then SIGKILL.
 *
 * A group, not a pid: `next start` and `eve start` both fork workers, and
 * killing only the parent orphans them on a held port — which for the eve
 * server means the fixed 4274 and a failure on the very next run.
 */
function stopChild(child: ChildProcess): () => Promise<void> {
  return async () => {
    if (child.pid === undefined || child.exitCode !== null) return

    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve())
    })

    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      return
    }

    const timedOut = Symbol("timeout")
    const race = await Promise.race([
      exited.then(() => "exited" as const),
      sleep(SHUTDOWN_GRACE_MS).then(() => timedOut),
    ])

    if (race === timedOut) {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // Raced with a natural exit.
      }
      await exited
    }
  }
}

/**
 * The eve agent server on the fixed port the rewrite was built against.
 *
 * `DATABASE_URL` is overridden in the child's environment for the same reason
 * the Next server's is: the agent's tools reach Postgres through
 * `lib/actions` → `lib/db/client.ts`, which reads it at import time, and a
 * credential must never appear in a process listing.
 */
async function startEveServer(): Promise<E2eServer> {
  if (!existsSync(eveOutputPath)) {
    throw new Error(
      "No eve build found at .output/server/index.mjs. `next start` serves " +
        "the agent from that output on port " +
        `${EVE_LOCAL_PORT} and never builds it. Run \`pnpm test:e2e\` (which ` +
        "builds first) or `pnpm exec eve build` before `pnpm test:e2e:only`."
    )
  }

  let output = ""
  const record = (chunk: unknown) => {
    output = (output + String(chunk)).slice(-20_000)
  }

  const child: ChildProcess = spawn(
    process.execPath,
    [eveBin, "start", "--host", "127.0.0.1", "--port", String(EVE_LOCAL_PORT)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: resolveTestDbUrl(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  )

  child.stdout?.on("data", record)
  child.stderr?.on("data", record)

  const baseUrl = `http://127.0.0.1:${EVE_LOCAL_PORT}`
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let healthy = false

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The eve agent server exited with code ${child.exitCode} before ` +
          `becoming healthy. Port ${EVE_LOCAL_PORT} is fixed by the rewrite ` +
          "baked at build time, so a `pnpm dev` already holding it is the " +
          `likeliest cause.\n--- eve output ---\n${output}`
      )
    }

    try {
      const response = await fetch(`${baseUrl}/eve/v1/health`)
      const body = (await response.json()) as { ok?: boolean }
      if (response.ok && body.ok === true) {
        healthy = true
        break
      }
    } catch {
      // Not listening yet.
    }

    await sleep(POLL_INTERVAL_MS)
  }

  if (!healthy) {
    throw new Error(
      `The eve agent server did not report healthy on ${EVE_LOCAL_PORT} ` +
        `within ${BOOT_TIMEOUT_MS}ms. A \`pnpm dev\` already holding that ` +
        `port is the likeliest cause.\n--- eve output ---\n${output}`
    )
  }

  return { baseUrl, output: () => output, stop: stopChild(child) }
}

export async function startE2eServer(
  options: E2eServerOptions = {}
): Promise<E2eServer> {
  if (!existsSync(buildIdPath)) {
    throw new Error(
      "No production build found at .next/BUILD_ID. The E2E suite runs " +
        "against `next start`, never `next dev`. Run `pnpm test:e2e` (which " +
        "builds first) or `pnpm build` before `pnpm test:e2e:only`."
    )
  }

  // Before Next, so a missing agent build fails in a second rather than after
  // a full server boot.
  const eve = options.eve === true ? await startEveServer() : undefined

  const port = await findFreePort()
  const baseUrl = `http://127.0.0.1:${port}`

  // Capped, and printed only when boot fails.
  let output = ""
  const record = (chunk: unknown) => {
    output = (output + String(chunk)).slice(-20_000)
  }

  // DATABASE_URL is overridden in the child's env, never on the command line,
  // so no credential can reach a process listing. `@next/env` does not
  // overwrite a variable already present in `process.env`, so this survives
  // .env.local — and 01-foundation.test.ts asserts that claim at runtime by
  // creating a project through the UI and finding it in the test database.
  const child: ChildProcess = spawn(
    process.execPath,
    [nextBin, "start", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: resolveTestDbUrl(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      // A process group, so teardown takes anything the server forked with it
      // rather than orphaning it on a held port.
      detached: true,
    }
  )

  child.stdout?.on("data", record)
  child.stderr?.on("data", record)

  const deadline = Date.now() + BOOT_TIMEOUT_MS
  let healthy = false

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `The E2E server exited with code ${child.exitCode} before becoming ` +
          `healthy.\n--- server output ---\n${output}`
      )
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`)
      const body = (await response.json()) as { ok?: boolean }
      if (response.ok && body.ok === true) {
        healthy = true
        break
      }
    } catch {
      // Not listening yet. Keep polling until the deadline.
    }

    await sleep(POLL_INTERVAL_MS)
  }

  if (!healthy) {
    throw new Error(
      `The E2E server did not report healthy within ${BOOT_TIMEOUT_MS}ms.\n` +
        `--- server output ---\n${output}`
    )
  }

  const stopNext = stopChild(child)

  // eve last, and unconditionally: it holds the fixed port, so leaving it
  // running would break the *next* suite rather than this one.
  const stop = async (): Promise<void> => {
    try {
      await stopNext()
    } finally {
      if (eve) await eve.stop()
    }
  }

  return {
    baseUrl,
    output: () =>
      eve ? `${output}\n--- eve output ---\n${eve.output()}` : output,
    stop,
  }
}
