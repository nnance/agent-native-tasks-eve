import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"

import { db } from "./client.ts"
import type { Database } from "./connect.ts"
import { MIGRATIONS_FOLDER } from "./migrate.ts"

export type MigrationStatus = "current" | "pending" | "unknown"

/**
 * Answers "is this database on the newest migration?" for GET /api/health
 * (implementation plan §2.7). Nothing in the stack tracked this before.
 *
 * drizzle-kit records each applied migration in drizzle.__drizzle_migrations
 * as (id, hash, created_at), where hash is the same SHA-256 of the file's SQL
 * that readMigrationFiles() computes — so comparing the newest file's hash to
 * the newest recorded row's hash is an exact check, not a row-count proxy that
 * would miss an edited migration.
 *
 * Deliberately does NOT swallow connection errors: a database that is down and
 * a database that is up but unmigrated are different failures, and the health
 * route reports them differently ("unknown" vs "pending").
 */
export async function getMigrationStatus(
  database: Database = db
): Promise<MigrationStatus> {
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })

  // Nothing to be behind on.
  if (files.length === 0) return "current"

  const expected = files[files.length - 1]!.hash

  let applied: string | undefined
  try {
    const rows = await database.execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`
    )
    applied = rows[0]?.hash
  } catch (error) {
    // 3F000 undefined_schema / 42P01 undefined_table: migrations have never
    // run here at all. Anything else (auth, network) is a real fault and must
    // reach the caller so it is not misreported as merely "pending".
    const code = (error as { code?: string }).code
    if (code === "3F000" || code === "42P01") return "pending"
    throw error
  }

  return applied === expected ? "current" : "pending"
}
