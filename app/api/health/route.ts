import { sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  getMigrationStatus,
  type MigrationStatus,
} from "@/lib/db/migration-status"

/**
 * The readiness probe every other harness polls (implementation plan §2.7):
 * the E2E suite waits on this before driving the browser, so it must answer
 * "can the app actually serve a request against a migrated database?" rather
 * than merely "is the process up?".
 *
 * No route-segment config: Next 16 route handlers are uncached by default
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md),
 * and static-by-default for GET was removed in v15.0.0-RC. `force-dynamic`
 * here would be noise.
 */
export async function GET() {
  let dbOk = false
  let migrations: MigrationStatus = "unknown"

  try {
    await db.execute(sql`select 1`)
    dbOk = true
    migrations = await getMigrationStatus(db)
  } catch {
    // Unreachable database: dbOk stays false and migrations stays "unknown",
    // which is exactly the distinction the body is meant to carry.
  }

  const ok = dbOk && migrations === "current"

  // 503 when unhealthy so a polling harness can fail fast on status alone,
  // while the body still reports which of the two checks went wrong.
  return Response.json({ ok, db: dbOk, migrations }, { status: ok ? 200 : 503 })
}
