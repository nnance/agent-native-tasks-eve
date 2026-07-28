/**
 * Verification harness: read-only dump of BOTH databases — row counts plus the
 * repo's own describeSeedState(). Used to show that a full `pnpm test:unit` run
 * leaves the test database exactly as it found it and never touches the dev
 * database at all. Writes nothing.
 *
 * Run from the repo root:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-1/harness/db-state.ts [label]
 */
import { sql } from "drizzle-orm"

import { createDatabase } from "../../../../lib/db/connect.ts"
import { describeSeedState } from "../../../../lib/db/seed.ts"
import { describeDbUrl, resolveDbUrls } from "../../../../lib/db/urls.ts"

const label = process.argv[2] ?? "state"

for (const target of ["dev", "test"] as const) {
  const { pooled } = resolveDbUrls(target)
  const { database, close } = createDatabase(pooled)

  try {
    console.log(
      `== ${label} — ${target.toUpperCase()} — ${describeDbUrl(pooled)} ==`
    )

    const counts = await database.execute<Record<string, string>>(sql`select
        (select count(*) from projects)   as projects,
        (select count(*) from statuses)   as statuses,
        (select count(*) from priorities) as priorities,
        (select count(*) from tasks)      as tasks`)
    console.log("counts ->", counts[0])

    const rows = await database.execute<{ id: string; name: string }>(
      sql`select id, name, created_at from projects order by created_at`
    )
    console.log("every project row ->", rows)
    console.log(JSON.stringify(await describeSeedState(database), null, 2))
    console.log()
  } finally {
    await close()
  }
}
