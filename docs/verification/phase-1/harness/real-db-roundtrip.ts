/**
 * Verification harness: prove that the Phase 1 unit tests exercise a REAL
 * Postgres — the separate test Neon project — and not a mock, and that the dev
 * database is never touched.
 *
 * It uses the exact handle the test suite uses (`testDatabase` and
 * `withRollback` from tests/support/db.ts) and the exact action functions the
 * tests call, then verifies the effects from INDEPENDENT connections opened
 * straight from the resolved URLs.
 *
 * Part 1 commits a sentinel project through the suite's own handle, observes it
 * from a separate connection to the test database, confirms it is absent from
 * the dev database, drives a real RuleViolation against it, and then deletes it
 * so the database is left exactly as it was found.
 *
 * Part 2 demonstrates the isolation strategy: a project created inside
 * `withRollback` is visible inside the transaction and gone afterwards.
 *
 * Run from the repo root:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-1/harness/real-db-roundtrip.ts
 */
import { eq, sql } from "drizzle-orm"

import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  listPriorities,
  listStatuses,
} from "../../../../lib/actions/index.ts"
import { createDatabase, type Database } from "../../../../lib/db/connect.ts"
import { projects } from "../../../../lib/db/schema.ts"
import { describeDbUrl, resolveDbUrls } from "../../../../lib/db/urls.ts"
import { RuleViolation } from "../../../../lib/domain/errors.ts"
import { testDatabase, withRollback } from "../../../../tests/support/db.ts"

const SENTINEL = `phase-1-verification-${crypto.randomUUID()}`

const devUrl = resolveDbUrls("dev").pooled
const testUrl = resolveDbUrls("test").pooled

const devSide = createDatabase(devUrl)
const testSide = createDatabase(testUrl)

async function counts(database: Database, label: string) {
  const [row] = await database.execute<Record<string, string>>(sql`select
      (select count(*) from projects)   as projects,
      (select count(*) from statuses)   as statuses,
      (select count(*) from priorities) as priorities,
      (select count(*) from tasks)      as tasks`)
  console.log(`   counts on ${label} ->`, row)
  return row
}

async function findSentinel(database: Database) {
  return database.select().from(projects).where(eq(projects.name, SENTINEL))
}

try {
  console.log("sentinel project name ->", SENTINEL)
  console.log("dev  database ->", describeDbUrl(devUrl))
  console.log("test database ->", describeDbUrl(testUrl))
  console.log()

  console.log(
    "== PART 1: the suite's handle writes to the real test database =="
  )
  console.log("-- baseline, from independent connections --")
  const devBefore = await counts(devSide.database, "dev ")
  const testBefore = await counts(testSide.database, "test")
  console.log()

  console.log(
    "-- createProject() through tests/support/db.ts's testDatabase (committed) --"
  )
  const project = await createProject({ name: SENTINEL }, testDatabase)
  console.log("   returned project ->", { id: project.id, name: project.name })
  console.log()

  console.log(
    "-- observed from an INDEPENDENT connection to the TEST database --"
  )
  const seenOnTest = await findSentinel(testSide.database)
  console.log("   rows found ->", seenOnTest.length)
  console.log(
    "   seeded statuses   ->",
    (await listStatuses({ projectId: project.id }, testSide.database)).map(
      (s) => `${s.order}:${s.name}${s.isCompleted ? " (completed)" : ""}`
    )
  )
  console.log(
    "   seeded priorities ->",
    (await listPriorities({ projectId: project.id }, testSide.database)).map(
      (p) => `${p.order}:${p.name}${p.isDefault ? " (default)" : ""}`
    )
  )
  console.log()

  console.log(
    "-- observed from an INDEPENDENT connection to the DEV database --"
  )
  const seenOnDev = await findSentinel(devSide.database)
  console.log("   rows found ->", seenOnDev.length, "(must be 0)")
  console.log()

  console.log(
    "-- a real §7.3 RuleViolation, raised by the real database's own data --"
  )
  const task = await createTask(
    { projectId: project.id, title: "blocks the project delete" },
    testDatabase
  )
  console.log("   created task ->", { id: task.id, title: task.title })
  try {
    await deleteProject({ projectId: project.id }, testDatabase)
    console.log("   RESULT: delete SUCCEEDED — the rule did not fire. FAIL.")
    process.exitCode = 1
  } catch (error) {
    console.log("   threw ->", (error as Error).name)
    console.log("   message ->", (error as Error).message)
    console.log("   is RuleViolation ->", error instanceof RuleViolation)
  }
  console.log()

  console.log("-- cleanup: remove the task, then the project --")
  await deleteTask({ taskId: task.id }, testDatabase)
  console.log(
    "   deleted the task ->",
    await deleteProject({ projectId: project.id }, testDatabase)
  )
  console.log()

  console.log("-- final state, from independent connections --")
  const devAfter = await counts(devSide.database, "dev ")
  const testAfter = await counts(testSide.database, "test")
  console.log(
    "   dev  unchanged ->",
    JSON.stringify(devBefore) === JSON.stringify(devAfter)
  )
  console.log(
    "   test restored  ->",
    JSON.stringify(testBefore) === JSON.stringify(testAfter)
  )
  console.log()

  console.log(
    "== PART 2: withRollback isolation, the strategy every test uses =="
  )
  const insideName = `phase-1-rollback-${crypto.randomUUID()}`
  const insideId = await withRollback(async (tx) => {
    const p = await createProject({ name: insideName }, tx)
    const visible = await tx
      .select()
      .from(projects)
      .where(eq(projects.name, insideName))
    console.log("   inside the transaction, rows visible ->", visible.length)
    console.log(
      "   inside the transaction, seeded statuses ->",
      (await listStatuses({ projectId: p.id }, tx)).length
    )
    return p.id
  })
  const afterRollback = await testSide.database
    .select()
    .from(projects)
    .where(eq(projects.id, insideId))
  console.log(
    "   after withRollback returned, rows on test DB ->",
    afterRollback.length,
    "(must be 0)"
  )
  await counts(testSide.database, "test")
} finally {
  await devSide.close()
  await testSide.close()
  process.exit(process.exitCode ?? 0)
}
