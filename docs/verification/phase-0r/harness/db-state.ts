/**
 * Verification harness: read-only dump of the TEST database — row counts plus
 * the repo's own describeSeedState() (project, ordered statuses, ordered
 * priorities). Writes nothing.
 *
 * Run from the repo root:
 *   node --env-file=.env.local docs/verification/phase-0r/harness/db-state.ts [label]
 */
import { sql } from "drizzle-orm"

import { createDatabase } from "../../../../lib/db/connect.ts"
import { describeSeedState } from "../../../../lib/db/seed.ts"
import {
  describeDbUrl,
  resolveDbUrls,
} from "../../../../lib/db/urls.ts"

const label = process.argv[2] ?? "state"
const { pooled } = resolveDbUrls("test")
const { database, close } = createDatabase(pooled)

try {
  console.log(`== ${label} — ${describeDbUrl(pooled)} (test) ==`)

  const counts = await database.execute<Record<string, string>>(sql`select
      (select count(*) from projects)   as projects,
      (select count(*) from statuses)   as statuses,
      (select count(*) from priorities) as priorities,
      (select count(*) from tasks)      as tasks`)
  console.log("counts ->", counts[0])

  const names = await database.execute<{ id: string; name: string }>(
    sql`select id, name, created_at from projects order by created_at`
  )
  console.log("every project row ->", names)

  console.log(JSON.stringify(await describeSeedState(database), null, 2))
} finally {
  await close()
}
