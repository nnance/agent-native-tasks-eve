/**
 * Direct Postgres access for the E2E suite: reset the world before each test,
 * and assert on rows the UI claims to have written.
 *
 * Asserting against the database rather than only against the DOM is what
 * makes these tests worth writing — a row that renders but was never
 * persisted, or a rule the server enforced but the UI misreported, both fail
 * here and only here.
 *
 * The connection target comes from `resolveTestDbUrl()`, which refuses when
 * `DATABASE_URL_TEST` is missing or equals `DATABASE_URL`. That guard exists
 * in exactly one place in the repo and is never re-derived.
 */

import { asc, eq } from "drizzle-orm"

import { createDatabase, type Database } from "../../../lib/db/connect.ts"
import { runMigrations } from "../../../lib/db/migrate.ts"
import {
  priorities,
  projects,
  statuses,
  tasks,
  type Priority,
  type Project,
  type Status,
  type Task,
} from "../../../lib/db/schema.ts"
import { ensureSeeded } from "../../../lib/db/seed.ts"
import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

let handle: ReturnType<typeof createDatabase> | undefined

export function testDb(): Database {
  handle ??= createDatabase(resolveTestDbUrl(), { max: 2 })
  return handle.database
}

export async function closeTestDb(): Promise<void> {
  const open = handle
  handle = undefined
  if (open) await open.close()
}

let migrated = false

/** Once per test process — the schema cannot change between tests. */
export async function migrateTestDatabase(): Promise<void> {
  if (migrated) return
  await runMigrations({ target: "test" })
  migrated = true
}

/**
 * Every test starts from a freshly seeded, otherwise-empty database.
 *
 * Implementation plan §4.4 words this as "drop, migrate, seed" per test. A
 * wipe plus `ensureSeeded()` gives the identical isolation guarantee far more
 * cheaply; re-running DDL between tests would buy nothing (the schema is
 * constant) and would dominate the suite's runtime against a remote Neon
 * instance. `chat_state` is included so a Phase 5/6 test can never inherit a
 * transcript from the test before it.
 *
 * **`DELETE`, not `TRUNCATE`, and that is not a style preference.** From Phase
 * 5 the agent suite runs a *second* process — the eve agent server — holding
 * its own connection pool against this database. `TRUNCATE` needs an
 * `AccessExclusiveLock` on every table, so it blocks that pool's writer, while
 * the writer holds the row locks `TRUNCATE` is waiting for: a textbook cycle,
 * and Postgres duly reported `40P01 deadlock detected` on two tests of the
 * first full `06` run. `DELETE` takes only `RowExclusiveLock`, which is
 * compatible with the writer's, so the lock-upgrade cycle cannot form.
 *
 * The identity restart TRUNCATE offered is not missed: every primary key in
 * this schema is a UUID.
 */
export async function resetTestDatabase(): Promise<void> {
  const database = testDb()

  // Child rows first: the FKs are ON DELETE CASCADE, but deleting in
  // dependency order keeps each statement's footprint small and predictable.
  await database.execute(`delete from tasks`)
  await database.execute(`delete from statuses`)
  await database.execute(`delete from priorities`)
  await database.execute(`delete from projects`)
  await database.execute(`delete from chat_state`)

  await ensureSeeded(database)
}

/** The starter project every test begins with (US-A1). */
export async function seededProject(): Promise<Project> {
  const [project] = await testDb()
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .limit(1)

  if (!project) {
    throw new Error("The test database has no seeded project.")
  }

  return project
}

export async function listProjectRows(): Promise<Project[]> {
  return testDb()
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
}

export async function findProjectByName(
  name: string
): Promise<Project | undefined> {
  const rows = await listProjectRows()
  return rows.find((project) => project.name === name)
}

export async function listStatusRows(projectId: string): Promise<Status[]> {
  return testDb()
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.order))
}

export async function listPriorityRows(projectId: string): Promise<Priority[]> {
  return testDb()
    .select()
    .from(priorities)
    .where(eq(priorities.projectId, projectId))
    .orderBy(asc(priorities.order))
}

export async function listTaskRows(projectId?: string): Promise<Task[]> {
  const query = testDb().select().from(tasks)

  const rows = projectId
    ? await query.where(eq(tasks.projectId, projectId))
    : await query

  return [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

export async function findTaskByTitle(
  title: string
): Promise<Task | undefined> {
  const rows = await listTaskRows()
  return rows.find((task) => task.title === title)
}

export async function countProjects(): Promise<number> {
  return (await listProjectRows()).length
}

/** Named lookups, so a test reads as prose rather than as index arithmetic. */
export async function statusNamed(
  projectId: string,
  name: string
): Promise<Status> {
  const row = (await listStatusRows(projectId)).find(
    (status) => status.name === name
  )

  if (!row) throw new Error(`No status named '${name}' in ${projectId}.`)

  return row
}

export async function priorityNamed(
  projectId: string,
  name: string
): Promise<Priority> {
  const row = (await listPriorityRows(projectId)).find(
    (priority) => priority.name === name
  )

  if (!row) throw new Error(`No priority named '${name}' in ${projectId}.`)

  return row
}
