/**
 * Verification harness: prove that the dev and test databases the Phase 1 test
 * run resolves are two DIFFERENT Neon projects, and that both are reachable and
 * migrated. Read-only — writes nothing, and every URL goes through
 * describeDbUrl() so no credential can reach the transcript.
 *
 * Run from the repo root:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-1/harness/db-identity.ts
 */
import { sql } from "drizzle-orm"

import { createDatabase } from "../../../../lib/db/connect.ts"
import { describeDbUrl, resolveDbUrls } from "../../../../lib/db/urls.ts"

const dev = resolveDbUrls("dev")
const test = resolveDbUrls("test")

console.log("resolved dev  (DATABASE_URL)      ->", describeDbUrl(dev.pooled))
console.log("resolved test (DATABASE_URL_TEST) ->", describeDbUrl(test.pooled))
console.log("same connection string?           ->", dev.pooled === test.pooled)
console.log(
  "same host?                        ->",
  new URL(dev.pooled).host === new URL(test.pooled).host
)
console.log()

for (const [label, url] of [
  ["dev", dev.pooled],
  ["test", test.pooled],
] as const) {
  const { database, close } = createDatabase(url)
  try {
    const [row] = await database.execute<{
      db: string
      user: string
      version: string
    }>(
      sql`select current_database() as db, current_user as "user",
                 substring(version() from 'PostgreSQL [0-9.]+') as version`
    )
    const applied = await database.execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations order by created_at`
    )
    console.log(
      `${label}: ${describeDbUrl(url)} -> current_database=${row?.db}`,
      `user=${row?.user}`,
      `${row?.version}`,
      `migrations_applied=${applied.length}`
    )
  } finally {
    await close()
  }
}
