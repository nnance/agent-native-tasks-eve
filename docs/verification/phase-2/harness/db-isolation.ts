/**
 * Demonstrates — rather than asserts — that the server tests/api spawns writes
 * to the TEST database and never the dev one.
 *
 * Writes a sentinel project through the spawned server's own API, then looks
 * for that row from two independent connections: the test database and the dev
 * database. Present in one, absent in the other, is the whole claim.
 *
 * Connection strings are never printed; `describeDbUrl` renders host/database
 * only. Run:
 *
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-2/harness/db-isolation.ts
 */

import { eq } from "drizzle-orm"

import { createDatabase } from "../../../../lib/db/connect.ts"
import { projects } from "../../../../lib/db/schema.ts"
import {
  describeDbUrl,
  resolveDbUrls,
  resolveTestDbUrl,
} from "../../../../lib/db/urls.ts"
import {
  apiTestDatabase,
  closeApiTestDb,
} from "../../../../tests/api/support/db.ts"
import { assertServerUsesTestDatabase } from "../../../../tests/api/support/fixtures.ts"
import {
  apiJson,
  startApiServer,
  stopApiServer,
} from "../../../../tests/api/support/server.ts"

const devUrl = resolveDbUrls("dev").pooled
const testUrl = resolveTestDbUrl()
const dev = createDatabase(devUrl, { max: 1 })

console.log("Databases in play (host/database only — never a credential):")
console.log(`  dev  DATABASE_URL      -> ${describeDbUrl(devUrl)}`)
console.log(`  test resolveTestDbUrl() -> ${describeDbUrl(testUrl)}`)
console.log(`  identical? ${devUrl === testUrl}`)
console.log(
  "\nresolveTestDbUrl() throws outright when those two are equal, so reaching\n" +
    "this line already proves they are different projects.\n"
)

try {
  await startApiServer()

  // The same interlock the API suite runs in its root before hook.
  console.log("[1] assertServerUsesTestDatabase() — the suite's own interlock")
  await assertServerUsesTestDatabase()
  console.log("    passed: a project written through the API was readable")
  console.log("    back through the test-database handle.\n")

  // Now the same check made visible from BOTH sides.
  const name = `isolation-probe ${crypto.randomUUID()}`
  const { status, body } = await apiJson<{ id: string; name: string }>(
    "/api/projects",
    { method: "POST", body: JSON.stringify({ name }) }
  )

  console.log(`[2] POST /api/projects -> ${status}`)
  console.log(`    wrote id ${body.id}`)

  const inTest = await apiTestDatabase
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, body.id))

  const inDev = await dev.database
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, body.id))

  console.log(`\n[3] the same id, seen from two independent connections`)
  console.log(`    rows in TEST (${describeDbUrl(testUrl)}): ${inTest.length}`)
  console.log(`    rows in DEV  (${describeDbUrl(devUrl)}): ${inDev.length}`)

  const ok = inTest.length === 1 && inDev.length === 0
  console.log(
    `\n    verdict: ${ok ? "PASS" : "FAIL"} — the spawned server's DATABASE_URL ` +
      `override\n    survived .env.local; the dev database was never touched.`
  )

  await apiTestDatabase.delete(projects).where(eq(projects.id, body.id))
  console.log("\n[4] probe row removed from the test database.")

  if (!ok) process.exitCode = 1
} finally {
  await closeApiTestDb()
  await dev.close()
  await stopApiServer()
}
