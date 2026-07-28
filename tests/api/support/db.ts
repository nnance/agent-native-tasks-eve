/**
 * The API suite's own guarded database handle.
 *
 * tests/support/db.ts cannot be reused here for two reasons. Its rolled-back
 * transactions are invisible to a server running in a *separate process*, and
 * it registers `after(close pool)` at import time — a hook that would run
 * before any teardown this suite registers, so `cleanupFixtures()` would find
 * a closed connection. This module therefore registers **no** hooks at all;
 * tests/api/index.test.ts owns the ordering explicitly.
 *
 * The dev-vs-test guard is the same one the unit harness uses, imported from
 * lib/db/urls.ts so the two can never drift (plan §8 risk 11).
 */

import { createDatabase, type Database } from "../../../lib/db/connect.ts"
import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

// max: 2 is enough — this handle only writes the sentinel check and the
// teardown deletes; every other statement goes through the spawned server's
// own pool.
const handle = createDatabase(resolveTestDbUrl(), { max: 2 })

/** A direct handle on the test database, for sentinel checks and cleanup. */
export const apiTestDatabase: Database = handle.database

/** Closed explicitly by tests/api/index.test.ts, after fixture cleanup. */
export async function closeApiTestDb(): Promise<void> {
  await handle.close()
}
