/**
 * Verification harness: prove the tests/support/db.ts guard actually refuses to
 * run when the "test" database resolves to the dev database.
 *
 * It does this the only honest way — by making the two URLs identical in this
 * process's environment and then importing the real harness module, so the real
 * guard runs. Nothing is connected to and nothing is written: the guard throws
 * during module initialisation, before createDatabase() is reached.
 *
 * Run from the repo root:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-1/harness/guard-refuses-dev.ts
 */
import { describeDbUrl, resolveDbUrls } from "../../../../lib/db/urls.ts"

const dev = resolveDbUrls("dev").pooled
const test = resolveDbUrls("test").pooled

console.log("baseline: dev  ->", describeDbUrl(dev))
console.log("baseline: test ->", describeDbUrl(test))
console.log("baseline: distinct ->", dev !== test)
console.log()

// Point DATABASE_URL_TEST at the DEV database — the mistake the guard exists to
// catch. Both spellings are overwritten because resolveDbUrls("test") accepts
// either.
process.env.DATABASE_URL_TEST = dev
process.env.TEST_DATABASE_URL = dev
console.log("sabotaged: DATABASE_URL_TEST now resolves to", describeDbUrl(dev))
console.log("sabotaged: identical to DATABASE_URL ->", dev === process.env.DATABASE_URL)
console.log()

try {
  await import("../../../../tests/support/db.ts")
  console.log("RESULT: NO ERROR THROWN — the guard did not fire. This is a FAIL.")
  process.exitCode = 1
} catch (error) {
  console.log("RESULT: import threw, as required.")
  console.log("  error name    ->", (error as Error).name)
  console.log("  error message ->", (error as Error).message)
  process.exitCode = 0
}
