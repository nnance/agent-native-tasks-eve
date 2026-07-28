/**
 * Fixture lifecycle for the API suite.
 *
 * The system under test is a real server in another process, so there is no
 * transaction to roll back: rows are really committed. Isolation therefore
 * comes from ownership rather than from rollback — every fixture is created
 * through the API with a uniquely-suffixed name, and no suite ever reads,
 * updates or deletes a row it did not create. That is the same discipline
 * tests/unit/ already follows, so the two suites can share a database.
 *
 * Teardown hard-deletes the fixture projects; statuses, priorities and tasks
 * go with them through the existing ON DELETE CASCADE.
 */

import assert from "node:assert/strict"

import { asc, eq, inArray } from "drizzle-orm"

import {
  CHAT_STATE_ID,
  chatState,
  priorities,
  projects,
  statuses,
  tasks,
} from "../../../lib/db/schema.ts"
import { apiTestDatabase } from "./db.ts"
import { apiJson } from "./server.ts"

const created = new Set<string>()

export type FixtureProject = { id: string; name: string }

/**
 * Creates a project through the API and registers it for cleanup.
 *
 * Deliberately created through the endpoint rather than through
 * `apiTestDatabase`: the test process then needs no second write path, and
 * POST /api/projects gets exercised as a side effect of every suite's setup.
 */
export async function createFixtureProject(
  label: string
): Promise<FixtureProject> {
  const name = `${label} ${crypto.randomUUID().slice(0, 8)}`
  const { status, body } = await apiJson<FixtureProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  })

  assert.equal(status, 201, `fixture project '${name}' was not created`)
  assert.equal(body.name, name)

  created.add(body.id)
  return body
}

/**
 * Inserts a task directly, bypassing the API.
 *
 * Blocked-delete coverage for projects, statuses and priorities all need a
 * task to exist, and those suites are exercised before POST /api/tasks is
 * reached. Writing the row directly also means a delete-block assertion cannot
 * fail for a reason that lives in the task endpoint — the same reasoning
 * `seedTask` in tests/unit/actions/projects.test.ts already applies. Omitted
 * status/priority take the project's first-by-order, mirroring §4.4.
 */
export async function createFixtureTask(
  projectId: string,
  title: string,
  overrides: { statusId?: string; priorityId?: string } = {}
): Promise<{ id: string; title: string }> {
  const statusId =
    overrides.statusId ??
    (
      await apiTestDatabase
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.projectId, projectId))
        .orderBy(asc(statuses.order))
        .limit(1)
    )[0]?.id

  const priorityId =
    overrides.priorityId ??
    (
      await apiTestDatabase
        .select({ id: priorities.id })
        .from(priorities)
        .where(eq(priorities.projectId, projectId))
        .orderBy(asc(priorities.order))
        .limit(1)
    )[0]?.id

  assert.ok(statusId, "fixture task: the project has no status")
  assert.ok(priorityId, "fixture task: the project has no priority")

  const [row] = await apiTestDatabase
    .insert(tasks)
    .values({ projectId, title, statusId, priorityId })
    .returning({ id: tasks.id, title: tasks.title })

  assert.ok(row, "fixture task: the insert returned no row")
  return row
}

/** Removes a fixture task, so a blocked-delete test can then unblock itself. */
export async function deleteFixtureTask(taskId: string): Promise<void> {
  await apiTestDatabase.delete(tasks).where(eq(tasks.id, taskId))
}

/**
 * The safety interlock: proves the spawned server writes to the **test**
 * database before a single fixture row exists.
 *
 * The spawn env already overrides DATABASE_URL, and `@next/env` is documented
 * (and was verified in its installed source) not to overwrite an existing
 * variable — but a configuration mistake here would write to the user's dev
 * database, which is the worst failure this phase could produce (plan §8 risk
 * 11). So the claim is observed rather than assumed: write a sentinel through
 * the API, read it back through the test-database handle, then remove it.
 */
export async function assertServerUsesTestDatabase(): Promise<void> {
  const name = `sentinel ${crypto.randomUUID()}`
  const { status, body } = await apiJson<FixtureProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  })

  assert.equal(status, 201, "the sentinel project could not be created")

  try {
    const rows = await apiTestDatabase
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, body.id))

    assert.equal(
      rows.length,
      1,
      "The API server wrote a project that is NOT visible in the test " +
        "database. It is talking to some other database — refusing to run."
    )
    assert.equal(rows[0]?.name, name)
  } finally {
    await apiTestDatabase.delete(projects).where(eq(projects.id, body.id))
  }
}

/** Removes every fixture project (cascading) and the chat_state singleton. */
export async function cleanupFixtures(): Promise<void> {
  const ids = [...created]
  created.clear()

  if (ids.length > 0) {
    await apiTestDatabase.delete(projects).where(inArray(projects.id, ids))
  }

  await apiTestDatabase.delete(chatState).where(eq(chatState.id, CHAT_STATE_ID))
}
