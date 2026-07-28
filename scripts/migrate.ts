/**
 * `pnpm db:migrate` — applies pending migrations (implementation plan §4.7).
 *
 * Run as `node --env-file=.env.local scripts/migrate.ts [--target=dev|test]`.
 * All the logic lives in lib/db/migrate.ts so the E2E harness can call it
 * directly; this file is only argv, logging and an exit code.
 */
import { runMigrations } from "../lib/db/migrate.ts"
import { parseTarget } from "../lib/db/urls.ts"

try {
  const target = parseTarget(process.argv.slice(2))
  const result = await runMigrations({ target })
  console.log(`Applied migrations to ${result.database} (${result.target}).`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
