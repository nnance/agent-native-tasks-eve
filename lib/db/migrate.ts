import { migrate } from "drizzle-orm/postgres-js/migrator"

import { createDatabase } from "./connect.ts"
import { describeDbUrl, resolveDbUrls, type DbTarget } from "./urls.ts"

/**
 * Where drizzle-kit writes generated SQL and its journal. Exported so
 * migration-status.ts reads the same folder the migrator applies from —
 * two constants would eventually disagree.
 */
export const MIGRATIONS_FOLDER = "./drizzle"

/**
 * Applies any unapplied migrations, replacing `drizzle-kit migrate` at the
 * CLI layer (implementation plan §4.7 mandates `node ... scripts/migrate.ts`).
 *
 * This is a different entry point into drizzle-orm, not a new dependency.
 * DDL runs over the direct/unpooled endpoint on a single connection, matching
 * the split drizzle.config.ts already encodes: PgBouncer's transaction pooling
 * is a poor fit for multi-statement schema changes.
 */
export async function runMigrations(
  opts: { target?: DbTarget } = {}
): Promise<{ target: DbTarget; database: string }> {
  const target = opts.target ?? "dev"
  const { direct } = resolveDbUrls(target)

  const { database, close } = createDatabase(direct, { max: 1 })

  try {
    await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER })
    return { target, database: describeDbUrl(direct) }
  } finally {
    await close()
  }
}
