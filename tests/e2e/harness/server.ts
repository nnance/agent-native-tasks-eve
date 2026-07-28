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
const buildIdPath = fileURLToPath(
  new URL("../../../.next/BUILD_ID", import.meta.url)
)

const BOOT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 200
const SHUTDOWN_GRACE_MS = 10_000

export type E2eServer = {
  baseUrl: string
  output: () => string
  stop: () => Promise<void>
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

export async function startE2eServer(): Promise<E2eServer> {
  if (!existsSync(buildIdPath)) {
    throw new Error(
      "No production build found at .next/BUILD_ID. The E2E suite runs " +
        "against `next start`, never `next dev`. Run `pnpm test:e2e` (which " +
        "builds first) or `pnpm build` before `pnpm test:e2e:only`."
    )
  }

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

  const stop = async (): Promise<void> => {
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

  return { baseUrl, output: () => output, stop }
}
