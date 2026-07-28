/**
 * The project capabilities of product spec §5, and the only place their rules
 * live (implementation plan §2.1).
 *
 * House rules for every action in lib/actions/:
 *
 * - The first statement is `schema.parse(input)`. The action layer is
 *   described as zod-validated and as the only place business rules live, so a
 *   shape rule it owns must hold no matter which caller arrives. Re-parsing an
 *   already-parsed object is free and always succeeds.
 * - The `database` parameter is injectable and defaults to the shared handle,
 *   so tests can pass a rolled-back transaction (plan §2.7).
 * - Anything that reads-then-writes, or writes more than once, runs inside
 *   `database.transaction()`. Handed a transaction, that composes as a
 *   savepoint, so there is no test-only branch anywhere in this layer.
 * - No `confirm`, `dryRun` or `approve` parameter exists here. Confirmation is
 *   per-interface UX — a dialog in the UI, an EVE approval gate for the agent
 *   (plan §2.1) — and adding a hook "for later" would create a second place
 *   the question is answered.
 */

import { asc, count, eq } from "drizzle-orm"

import { db, type Database } from "../db/client.ts"
import {
  priorities,
  projects,
  statuses,
  tasks,
  type Project,
} from "../db/schema.ts"
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES } from "../domain/defaults.ts"
import { NotFoundError, RuleViolation } from "../domain/errors.ts"
import {
  createProjectSchema,
  deleteProjectSchema,
  listProjectsSchema,
  renameProjectSchema,
  type CreateProjectInput,
  type DeleteProjectInput,
  type ListProjectsInput,
  type RenameProjectInput,
} from "../schemas/projects.ts"

/** Lists every project, oldest first — the seeded project stays on top. */
export async function listProjects(
  input: ListProjectsInput = {},
  database: Database = db
): Promise<Project[]> {
  listProjectsSchema.parse(input)

  // `asc(projects.id)` is a determinism backstop, not decoration: without a
  // final key, projects sharing a `created_at` sort in planner-defined order.
  return database
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
}

/**
 * Creates a project and seeds it so it is usable immediately (§7.4, US-C1.2).
 *
 * The defaults come from lib/domain/defaults.ts and are never restated here:
 * that module exists specifically so the first-run seeded project
 * (lib/db/seed.ts) and every project created later cannot drift apart. Returns
 * the project row only — callers read the seeded lists back through
 * listStatuses/listPriorities, which keeps every create action's contract
 * uniform and makes the defaults linkage provable against the database rather
 * than against an echo of what was just written.
 */
export async function createProject(
  input: CreateProjectInput,
  database: Database = db
): Promise<Project> {
  const parsed = createProjectSchema.parse(input)

  return database.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ name: parsed.name })
      .returning()

    if (!project) {
      throw new Error("createProject: the project insert returned no row.")
    }

    await tx.insert(statuses).values(
      DEFAULT_STATUSES.map((status, index) => ({
        projectId: project.id,
        name: status.name,
        order: index,
        isCompleted: status.isCompleted,
      }))
    )

    await tx.insert(priorities).values(
      DEFAULT_PRIORITIES.map((priority, index) => ({
        projectId: project.id,
        name: priority.name,
        order: index,
        isDefault: priority.isDefault,
      }))
    )

    return project
  })
}

/** Renames a project. Its tasks, statuses and priorities are untouched. */
export async function renameProject(
  input: RenameProjectInput,
  database: Database = db
): Promise<Project> {
  const parsed = renameProjectSchema.parse(input)

  const [project] = await database
    .update(projects)
    .set({ name: parsed.name })
    .where(eq(projects.id, parsed.projectId))
    .returning()

  if (!project) {
    throw new NotFoundError(`No project with id ${parsed.projectId}.`)
  }

  return project
}

/**
 * Deletes a project, but only when it holds no tasks (§7.3, US-C3.2).
 *
 * The block message states the count and the remedy, because US-C3.3 requires
 * the user to be told what is blocking the delete and what to do about it —
 * and because the agent relays this message verbatim (US-F3.4). Statuses and
 * priorities go with the project through the existing ON DELETE CASCADE.
 */
export async function deleteProject(
  input: DeleteProjectInput,
  database: Database = db
): Promise<{ id: string; name: string }> {
  const parsed = deleteProjectSchema.parse(input)

  return database.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1)

    if (!project) {
      throw new NotFoundError(`No project with id ${parsed.projectId}.`)
    }

    const [taskCount] = await tx
      .select({ value: count() })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))

    const remaining = taskCount?.value ?? 0

    if (remaining > 0) {
      throw new RuleViolation(
        `Project '${project.name}' still has ${remaining} ` +
          `task${remaining === 1 ? "" : "s"}. Delete or move those tasks ` +
          `first, then delete the project.`
      )
    }

    await tx.delete(projects).where(eq(projects.id, project.id))

    return { id: project.id, name: project.name }
  })
}
