/**
 * The only file matching the `test:api` glob, and therefore the only place a
 * server is booted. Per-resource suites live in tests/api/suites/ and export a
 * `register*Suite()` function; see tests/api/support/server.ts for why one
 * server per run — rather than one per file — is a correctness requirement and
 * not a speed trade-off.
 *
 * Hook order is deliberate and must be preserved. Static imports evaluate
 * before this module's body, so the suite modules must *not* call `describe`
 * at import time — that is exactly why they export register functions. With
 * that shape, registering before/after here, above the register calls, provably
 * precedes every test registration.
 */

import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"

import { closeApiTestDb } from "./support/db.ts"
import {
  assertServerUsesTestDatabase,
  cleanupFixtures,
} from "./support/fixtures.ts"
import { apiJson, startApiServer, stopApiServer } from "./support/server.ts"
import { registerPrioritiesSuite } from "./suites/priorities.ts"
import { registerProjectsSuite } from "./suites/projects.ts"
import { registerStatusesSuite } from "./suites/statuses.ts"

before(async () => {
  await startApiServer()
  await assertServerUsesTestDatabase()
})

after(async () => {
  // Order matters: delete fixtures while the pool is open, close the pool,
  // then stop the server. tests/support/db.ts's import-time `after` hook is
  // precisely what this suite avoids by owning its own handle.
  await cleanupFixtures()
  await closeApiTestDb()
  await stopApiServer()
})

describe("harness", () => {
  it("serves GET /api/health against a migrated database", async () => {
    const { status, body } = await apiJson<{
      ok: boolean
      db: boolean
      migrations: string
    }>("/api/health")

    assert.equal(status, 200)
    assert.deepStrictEqual(body, {
      ok: true,
      db: true,
      migrations: "current",
    })
  })
})

registerProjectsSuite()
registerStatusesSuite()
registerPrioritiesSuite()
