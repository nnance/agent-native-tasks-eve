/**
 * The per-file lifecycle of implementation plan §4.4.
 *
 * One `next start` per test file on its own free port, torn down in that
 * file's `after`. `node:test` isolates each file in its own process, and
 * `next start` against a pre-built bundle boots in about a second, so a shared
 * server plus an orchestrator the plan never describes would buy nothing.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { after, before, beforeEach } from "node:test"
import { fileURLToPath } from "node:url"

import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

import { createBrowser, type Browser } from "./browser.ts"
import { closeTestDb, migrateTestDatabase, resetTestDatabase } from "./db.ts"
import {
  startE2eServer,
  type E2eServer,
  type E2eServerOptions,
} from "./server.ts"

const artifactsRoot = fileURLToPath(new URL("../artifacts/", import.meta.url))

/**
 * Implementation plan §4.3: a skipped E2E run must never look like a passing
 * one. `resolveTestDbUrl()` throws when `DATABASE_URL_TEST` is unset **or**
 * when it equals `DATABASE_URL`. `AI_GATEWAY_API_KEY` is checked here even
 * though no Phase 3 test calls a model — §4.3 states it as a whole-suite rule,
 * the credential is already provisioned, and checking it now means Phases 4–7
 * never revisit this file to add it.
 */
function assertE2eEnv(): void {
  resolveTestDbUrl()

  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set. The E2E suite runs against every real " +
        "dependency (plan §4.3); a skipped run must not look like a pass."
    )
  }
}

export type Suite = {
  readonly browser: Browser
  readonly baseUrl: string
  /** Opens the app at `path`, at the standard desktop viewport. */
  open(path?: string): Promise<void>
}

/**
 * `options.eve` additionally starts the agent server the production topology
 * needs (see `./server.ts`). Opt-in per suite, so 01–05 stay fast: only the
 * agent-chat suite pays the eve boot and the fixed-port constraint.
 */
export function setupSuite(
  name: string,
  options: E2eServerOptions = {}
): Suite {
  let server: E2eServer | undefined
  let browser: Browser | undefined

  before(async () => {
    assertE2eEnv()
    await migrateTestDatabase()
    await resetTestDatabase()
    server = await startE2eServer(options)
    browser = createBrowser(`e2e-${name}`)
  })

  beforeEach(async () => {
    await resetTestDatabase()
  })

  after(async () => {
    // Unconditional, not conditional on failure: node:test's hook context
    // exposes no reliable pass/fail flag, so a conditional dump would be
    // guesswork. This is cheap, never misses a failure, and doubles as a
    // record of the run.
    if (browser) {
      const directory = `${artifactsRoot}${name}/`

      try {
        await mkdir(directory, { recursive: true })
        await browser.screenshot(`${directory}final.png`)
        await writeFile(
          `${directory}console.json`,
          JSON.stringify(await browser.console(), null, 2)
        )
        await writeFile(
          `${directory}errors.json`,
          JSON.stringify(await browser.errors(), null, 2)
        )
      } catch {
        // A teardown dump must never mask the real failure.
      }

      try {
        await browser.close()
      } catch {
        // Already gone.
      }
    }

    if (server) await server.stop()
    await closeTestDb()
  })

  return {
    get browser() {
      if (!browser) {
        throw new Error(
          `Suite '${name}': the browser is only available inside a test — ` +
            "the before() hook has not run yet."
        )
      }
      return browser
    },
    get baseUrl() {
      if (!server) {
        throw new Error(
          `Suite '${name}': the server is only available inside a test — ` +
            "the before() hook has not run yet."
        )
      }
      return server.baseUrl
    },
    async open(path = "/") {
      if (!browser || !server) {
        throw new Error(`Suite '${name}': open() called before before() ran.`)
      }
      await browser.viewport(1440, 900)
      await browser.open(`${server.baseUrl}${path}`)
    },
  }
}
