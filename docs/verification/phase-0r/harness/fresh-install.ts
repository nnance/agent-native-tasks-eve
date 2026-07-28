/**
 * Verification harness: put the TEST database into a genuine fresh-install
 * state — schema dropped, migrations applied, zero rows — WITHOUT seeding, so
 * the app-boot seed path (instrumentation.ts) is the thing under test.
 *
 * Run from the repo root:
 *   node --env-file=.env.local docs/verification/phase-0r/harness/fresh-install.ts
 */
import { sql } from "drizzle-orm"

import { createDatabase } from "../../../../lib/db/connect.ts"
import { runMigrations } from "../../../../lib/db/migrate.ts"
import {
  describeDbUrl,
  resolveDbUrls,
} from "../../../../lib/db/urls.ts"

const { pooled, direct } = resolveDbUrls("test")

if (pooled === process.env.DATABASE_URL) {
  throw new Error("Refusing: test URL equals DATABASE_URL.")
}

console.log(`Wiping ${describeDbUrl(direct)} (test) to a fresh install.`)

const dropper = createDatabase(direct, { max: 1 })
try {
  await dropper.database.execute(sql`drop schema public cascade`)
  await dropper.database.execute(sql`create schema public`)
  await dropper.database.execute(sql`drop schema if exists drizzle cascade`)
} finally {
  await dropper.close()
}
console.log("Dropped the public and drizzle schemas.")

const migrated = await runMigrations({ target: "test" })
console.log(`Applied migrations to ${migrated.database}.`)
console.log("NOT seeded — the app boot is what must create the workspace.")

const reader = createDatabase(pooled)
try {
  const counts = await reader.database.execute<{
    projects: string
    statuses: string
    priorities: string
    tasks: string
  }>(sql`select
      (select count(*) from projects)   as projects,
      (select count(*) from statuses)   as statuses,
      (select count(*) from priorities) as priorities,
      (select count(*) from tasks)      as tasks`)
  console.log("counts ->", counts[0])
} finally {
  await reader.close()
}
