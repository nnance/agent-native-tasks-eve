/**
 * Fixture setup for the E2E suite.
 *
 * Written straight into the test database through the shared action layer,
 * not through the UI. Driving the browser to build a precondition would make
 * every test depend on the correctness of a feature it is not testing, and
 * would triple the suite's runtime; the UI is driven for the behaviour under
 * test and nothing else. `resetTestDatabase()` in `beforeEach` means no
 * fixture ever outlives its test, so there is no cleanup to forget.
 */

import {
  createPriority,
  createProject,
  createStatus,
  createTask,
  updateStatus,
} from "../../../lib/actions/index.ts"
import type { Priority, Project, Status, Task } from "../../../lib/db/schema.ts"

import { priorityNamed, statusNamed, testDb } from "./db.ts"

export async function makeProject(name: string): Promise<Project> {
  return createProject({ name }, testDb())
}

export async function makeStatus(
  projectId: string,
  name: string,
  options: { isCompleted?: boolean } = {}
): Promise<Status> {
  return createStatus(
    {
      projectId,
      name,
      ...(options.isCompleted === undefined
        ? {}
        : { isCompleted: options.isCompleted }),
    },
    testDb()
  )
}

export async function makePriority(
  projectId: string,
  name: string
): Promise<Priority> {
  return createPriority({ projectId, name }, testDb())
}

export async function makeTask(input: {
  projectId: string
  title: string
  description?: string
  statusId?: string
  priorityId?: string
}): Promise<{ id: string; title: string }> {
  const created = await createTask(input, testDb())
  return { id: created.id, title: created.title }
}

/** Moves a status to a 0-based position, for ordering fixtures. */
export async function moveStatus(
  statusId: string,
  order: number
): Promise<Status> {
  return updateStatus({ statusId, order }, testDb())
}

/**
 * The seeded project's three statuses and three priorities, by name — so a
 * test says `lists.done` rather than `rows[2]`.
 */
export async function projectLists(projectId: string): Promise<{
  toDo: Status
  inProgress: Status
  done: Status
  low: Priority
  medium: Priority
  high: Priority
}> {
  const [toDo, inProgress, done, low, medium, high] = await Promise.all([
    statusNamed(projectId, "To Do"),
    statusNamed(projectId, "In Progress"),
    statusNamed(projectId, "Done"),
    priorityNamed(projectId, "Low"),
    priorityNamed(projectId, "Medium"),
    priorityNamed(projectId, "High"),
  ])

  return { toDo, inProgress, done, low, medium, high }
}

export type { Priority, Project, Status, Task }
