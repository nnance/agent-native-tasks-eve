/**
 * `pnpm db:seed` — creates the starter project and its default lists, but only
 * on a workspace that has never been initialized (US-A1.5).
 *
 * Run as `node --env-file=.env.local scripts/seed.ts [--target=dev|test]`.
 * The idempotency lives in lib/db/seed.ts, which app boot also calls; this
 * file only picks a database, reports the outcome and dumps the resulting
 * state as the phase's data-verification evidence.
 */
import { createDatabase } from "../lib/db/connect.ts"
import { describeSeedState, ensureSeeded } from "../lib/db/seed.ts"
import { SEED_PROJECT_NAME } from "../lib/domain/defaults.ts"
import { describeDbUrl, parseTarget, resolveDbUrls } from "../lib/db/urls.ts"

try {
  const target = parseTarget(process.argv.slice(2))
  const { pooled } = resolveDbUrls(target)
  const { database, close } = createDatabase(pooled)

  console.log(`Seeding ${describeDbUrl(pooled)} (${target}).`)

  try {
    const result = await ensureSeeded(database)
    console.log(
      result.seeded
        ? `Seeded: created the "${SEED_PROJECT_NAME}" project and its defaults.`
        : "Skipped: the projects table is not empty; nothing was created."
    )
    console.log(JSON.stringify(await describeSeedState(database), null, 2))
  } finally {
    await close()
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
