/**
 * `pnpm db:reset` — drops everything, re-migrates, re-seeds (plan §4.7).
 *
 * Run as `node --env-file=.env.local scripts/reset.ts [--target=dev|test]`,
 * or `pnpm db:reset:test`, which stacks .env.test on top so both DATABASE_URL
 * and DATABASE_URL_TEST are visible to the guard below in one process.
 *
 * This is the only destructive script in the repo, so the database it is
 * about to drop is named by an explicit --target rather than inferred from
 * whichever env vars happen to be set (plan §8, risk 11).
 */
import { sql } from "drizzle-orm"

import { createDatabase } from "../lib/db/connect.ts"
import { runMigrations } from "../lib/db/migrate.ts"
import { describeSeedState, ensureSeeded } from "../lib/db/seed.ts"
import { describeDbUrl, parseTarget, resolveDbUrls } from "../lib/db/urls.ts"

try {
  const target = parseTarget(process.argv.slice(2))
  const { pooled, direct } = resolveDbUrls(target)

  // Tests must never run against the dev database, so a test reset refuses
  // outright when the two URLs are the same string. Nothing has been dropped
  // at this point — the check comes before any connection is opened.
  if (target === "test" && pooled === process.env.DATABASE_URL) {
    console.error(
      "Refusing to reset: the test database URL is identical to DATABASE_URL. " +
        "The test database must be a separate Neon project."
    )
    process.exitCode = 1
  } else {
    console.log(`Resetting ${describeDbUrl(direct)} (${target}).`)

    // Schema-level rather than an enumerated table list, which would silently
    // go stale as later phases add tables. Safe here because the migrations
    // create no extensions — the only function they use, gen_random_uuid(),
    // is built into pg_catalog from PostgreSQL 13 onward.
    const dropper = createDatabase(direct, { max: 1 })
    try {
      await dropper.database.execute(sql`drop schema public cascade`)
      await dropper.database.execute(sql`create schema public`)
      await dropper.database.execute(sql`drop schema if exists drizzle cascade`)
    } finally {
      await dropper.close()
    }
    console.log("Dropped the public and drizzle schemas.")

    const migrated = await runMigrations({ target })
    console.log(`Applied migrations to ${migrated.database}.`)

    const seeder = createDatabase(pooled)
    try {
      const result = await ensureSeeded(seeder.database)
      console.log(
        result.seeded
          ? "Seeded: created the starter project and its defaults."
          : "Skipped: the projects table is not empty; nothing was created."
      )
      console.log(
        JSON.stringify(await describeSeedState(seeder.database), null, 2)
      )
    } finally {
      await seeder.close()
    }
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
