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
  })

  return {
    database: drizzle(client, { schema }),
    close: async () => {
      await client.end({ timeout: 5 })
    },
  }
}
