/**
 * Verification harness: boot `next dev` on port 3100 against the **test** Neon
 * project instead of the dev one, so US-A1's "fresh install" can be exercised
 * for real (the test project is disposable; the dev database must not be
 * dropped).
 *
 * Next.js resolves environment variables from `process.env` first and only
 * then from `.env*` files
 * (node_modules/next/dist/docs/01-app/02-guides/environment-variables.md,
 * "Environment Variable Load Order"), so exporting DATABASE_URL here wins over
 * .env.local without editing any file. No credential is ever passed on a
 * command line or printed.
 *
 * Run from the repo root:
 *   node --env-file=.env.local docs/verification/phase-0r/harness/dev-on-test.mjs
 */
import { spawn } from "node:child_process"

const test = process.env.DATABASE_URL_TEST ?? process.env.TEST_DATABASE_URL
if (!test) throw new Error("No test database URL in the environment.")
if (test === process.env.DATABASE_URL) {
  throw new Error("Refusing: the test URL is identical to DATABASE_URL.")
}

const env = { ...process.env }
env.DATABASE_URL = test
env.DATABASE_URL_UNPOOLED =
  process.env.DATABASE_URL_TEST_UNPOOLED ??
  process.env.TEST_DATABASE_URL_UNPOOLED ??
  test
env.PORT = "3100"

const url = new URL(test)
console.log(`[harness] next dev :3100 -> ${url.host}${url.pathname} (test)`)

spawn("pnpm", ["exec", "next", "dev", "--port", "3100"], {
  stdio: "inherit",
  env,
})
