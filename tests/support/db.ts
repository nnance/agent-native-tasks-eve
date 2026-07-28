/**
 * The shared test-database harness.
 *
 * Lives in tests/support/ rather than tests/unit/ for two reasons: the
 * test:unit glob only matches `*.test.ts`, so this module is never executed as
 * a test file, and Phase 2's tests/api/ suite needs the same guarded handle.
 *
 * Isolation strategy: every DB-backed test runs inside a transaction that is
 * always rolled back, so the real test database is exercised — real
 * constraints, real SQL, real rules, no mocks (implementation plan §4.1) —
 * with no cleanup SQL and no db:reset between tests. Actions that open their
 * own `database.transaction()` compose as Postgres savepoints when handed the
 * outer `tx`, so nothing in lib/actions/ needs a test-only branch.
 */

import { sql } from "drizzle-orm"
import { after } from "node:test"

import { createDatabase, type Database } from "../../lib/db/connect.ts"
import { priorities, projects, statuses, tasks } from "../../lib/db/schema.ts"
import { resolveDbUrls } from "../../lib/db/urls.ts"

/**
 * Resolves the test database URL and refuses outright when it is the dev one —
 * the same guard scripts/reset.ts applies before any destructive statement.
 * Tests must never touch the dev database (plan §8 risk 11).
 */
function resolveTestDbUrl(): string {
  const { pooled } = resolveDbUrls("test")

  if (pooled === process.env.DATABASE_URL) {
    throw new Error(
      "Refusing to run tests: the test database URL is identical to " +
        "DATABASE_URL. The test database must be a separate Neon project."
    )
  }

  return pooled
}

const handle = createDatabase(resolveTestDbUrl(), { max: 2 })

// Registered once per test process at import time, so no test file has to
// remember to close the pool; without it `node --test` hangs after the last
// assertion.
after(async () => {
  await handle.close()
})

/** The pooled handle. Prefer `withRollback` — a bare write here persists. */
export const testDatabase: Database = handle.database

/**
 * Thrown to unwind the outer transaction. A sentinel throw is used instead of
 * `tx.rollback()` because it is dialect-independent and cannot be mistaken for
 * a real failure by the caller.
 */
class RollbackSignal extends Error {
  constructor() {
    super("rollback")
    this.name = "RollbackSignal"
  }
}

/** Runs `run` inside a transaction that is ALWAYS rolled back. */
export async function withRollback<T>(
  run: (tx: Database) => Promise<T>
): Promise<T> {
  let result!: T

  try {
    await testDatabase.transaction(async (tx) => {
      result = await run(tx)
      throw new RollbackSignal()
    })
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error
  }

  return result
}

/**
 * `withRollback` plus a transaction-local wipe of every table, for the one
 * test that needs a genuinely empty database (seed idempotency, US-A1.5).
 * The deletes are only ever visible inside this uncommitted transaction.
 *
 * Binding convention: tests/unit/db/seed.test.ts is the ONLY file permitted to
 * call this. Every other file builds its own fixtures via createProject and
 * never reads, updates or deletes pre-existing committed rows, so two test
 * processes running in parallel can never contend for the same row lock. The
 * `lock_timeout` turns any future violation of that rule into a fast, legible
 * failure rather than a hang.
 */
export async function withEmptyDb<T>(
  run: (tx: Database) => Promise<T>
): Promise<T> {
  return withRollback(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    await tx.delete(tasks)
    await tx.delete(statuses)
    await tx.delete(priorities)
    await tx.delete(projects)
    return run(tx)
  })
}
