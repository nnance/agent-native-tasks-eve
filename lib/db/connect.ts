import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema.ts"

/** The injectable handle type for actions, scripts and tests. */
export type Database = ReturnType<typeof drizzle<typeof schema>>

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
