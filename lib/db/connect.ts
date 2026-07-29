import { sql } from "drizzle-orm"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.ts"

/**
 * The injectable handle type for actions, scripts and tests.
 *
 * Deliberately widened from `ReturnType<typeof drizzle<typeof schema>>`: that
 * type resolves to `PostgresJsDatabase<typeof schema> & { $client: Sql }`, and
 * a `PgTransaction` carries no `$client`, so anything typed against it could
 * never be handed a transaction. Every action in lib/actions/ takes this type
 * as its `database` parameter precisely so a test can pass a rolled-back
 * transaction (implementation plan §2.7 testability affordances), and so an
 * action that opens its own transaction composes as a savepoint rather than
 * needing a test-only branch.
 */
export type Database = PostgresJsDatabase<typeof schema>

/**
 * Builds a throwaway connection against an explicit connection string.
 *
 * Deliberately side-effect-free: no module-level singleton, no env reads and
 * no throw at import time. That is what lets scripts/*.ts open a connection to
 * the *test* database without lib/db/client.ts's eager DATABASE_URL check
 * firing (implementation plan §2.7 testability affordances).
 */
export function createDatabase(
  connectionString: string,
  options: { max?: number } = {}
): { database: Database; close: () => Promise<void> } {
  // Neon's pooled endpoint runs PgBouncer in transaction mode, which does not
  // support the session-level prepared statements postgres.js uses by default.
  const client = postgres(connectionString, {
    max: options.max ?? 5,
    prepare: false,
    // Neon suspends idle compute (scale-to-zero). The first connection after a
    // suspend has to wait for a resume, and the driver's default budget is not
    // always enough — the observed failure is a bare `connect ETIMEDOUT` on the
    // first attempt, with every subsequent connect succeeding in under 3s.
    connect_timeout: 30,
  })

  return {
    database: drizzle(client, { schema }),
    close: async () => {
      await client.end({ timeout: 5 })
    },
  }
}

/** Connection errors that mean "the compute was asleep", not "the query is wrong". */
const COLD_START_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "CONNECT_TIMEOUT",
])

/**
 * Waits for a scale-to-zero database to actually be reachable.
 *
 * Neon's free tier suspends compute after a few minutes idle. Measured
 * behaviour against the test project: the first connect after a suspend fails
 * with `ETIMEDOUT`, then connects succeed in 0.8-2.6s. Left alone this reads as
 * intermittent test failure — a different test each run, always passing in
 * isolation, because by then something else has woken the database.
 *
 * This is deliberately **not** a retry around assertions, which plan §4.5
 * forbids. It retries *establishing a connection*, before any test logic runs,
 * and only for the error codes above; a genuine query failure still propagates
 * on the first attempt.
 */
export async function waitForDatabase(
  database: Database,
  { attempts = 5, delayMs = 2_000 }: { attempts?: number; delayMs?: number } = {}
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await database.execute(sql`select 1`)
      return
    } catch (error) {
      const code = (error as { code?: string }).code ?? ""

      if (!COLD_START_CODES.has(code) || attempt === attempts) {
        throw error
      }

      process.stderr.write(
        `Database not reachable yet (${code}); resume attempt ${attempt}/${attempts - 1}.\n`
      )
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
