/**
 * The per-project status capabilities of product spec §5, and the only place
 * their rules live. See lib/actions/projects.ts for the house rules that apply
 * to every action in this directory.
 *
 * The two delete guards run in a deliberate order — last-remaining first, then
 * in-use — because the in-use message tells the user to reassign the blocking
 * tasks, and if this is the project's only status there is nowhere to reassign
 * them to. Leading with in-use would hand the user a dead-end remedy. §7.5
 * also frames the minimum-lists rule as unconditional ("the last one cannot be
 * deleted, even if unused"), so it is the stronger constraint.
 */

import { and, asc, count, eq, max } from "drizzle-orm"

import { db, type Database } from "../db/client.ts"
import { projects, statuses, tasks, type Status } from "../db/schema.ts"
import { NotFoundError, RuleViolation } from "../domain/errors.ts"
import { reindexAfterMove, renumber } from "../domain/reorder.ts"
import {
  createStatusSchema,
  deleteStatusSchema,
  listStatusesSchema,
  updateStatusSchema,
  type CreateStatusInput,
  type DeleteStatusInput,
  type ListStatusesInput,
  type UpdateStatusInput,
} from "../schemas/statuses.ts"

/** Loads a status or raises NotFoundError. */
async function requireStatus(
  database: Database,
  statusId: string
): Promise<Status> {
  const [status] = await database
    .select()
    .from(statuses)
    .where(eq(statuses.id, statusId))
    .limit(1)

  if (!status) {
    throw new NotFoundError(`No status with id ${statusId}.`)
  }

  return status
}

/** Writes back only the rows whose order actually changed. */
async function applyOrder(
  database: Database,
  assignments: { id: string; order: number }[],
  current: readonly { id: string; order: number }[]
): Promise<void> {
  const before = new Map(current.map((row) => [row.id, row.order]))

  for (const assignment of assignments) {
    if (before.get(assignment.id) === assignment.order) continue

    await database
      .update(statuses)
      .set({ order: assignment.order })
      .where(eq(statuses.id, assignment.id))
  }
}

/** Lists a project's statuses in their defined order (US-D1.1/D1.2). */
export async function listStatuses(
  input: ListStatusesInput,
  database: Database = db
): Promise<Status[]> {
  const parsed = listStatusesSchema.parse(input)

  return database
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, parsed.projectId))
    .orderBy(asc(statuses.order))
}

/** Creates a status, appended to the end of the project's list. */
export async function createStatus(
  input: CreateStatusInput,
  database: Database = db
): Promise<Status> {
  const parsed = createStatusSchema.parse(input)

  return database.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1)

    if (!project) {
      throw new NotFoundError(`No project with id ${parsed.projectId}.`)
    }

    const [highest] = await tx
      .select({ value: max(statuses.order) })
      .from(statuses)
      .where(eq(statuses.projectId, parsed.projectId))

    const [status] = await tx
      .insert(statuses)
      .values({
        projectId: parsed.projectId,
        name: parsed.name,
        order: (highest?.value ?? -1) + 1,
        isCompleted: parsed.isCompleted ?? false,
      })
      .returning()

    if (!status) {
      throw new Error("createStatus: the status insert returned no row.")
    }

    return status
  })
}

/**
 * Renames a status, moves it to a new position, and/or toggles its completed
 * flag (US-D1.2, US-D1.3). `order` is a 0-based target position: the whole
 * sibling list is renumbered densely around the move.
 */
export async function updateStatus(
  input: UpdateStatusInput,
  database: Database = db
): Promise<Status> {
  const parsed = updateStatusSchema.parse(input)

  return database.transaction(async (tx) => {
    const status = await requireStatus(tx, parsed.statusId)

    if (parsed.name !== undefined || parsed.isCompleted !== undefined) {
      await tx
        .update(statuses)
        .set({
          ...(parsed.name !== undefined ? { name: parsed.name } : {}),
          ...(parsed.isCompleted !== undefined
            ? { isCompleted: parsed.isCompleted }
            : {}),
        })
        .where(eq(statuses.id, status.id))
    }

    if (parsed.order !== undefined) {
      const siblings = await tx
        .select({ id: statuses.id, order: statuses.order })
        .from(statuses)
        .where(eq(statuses.projectId, status.projectId))
        .orderBy(asc(statuses.order))

      await applyOrder(
        tx,
        reindexAfterMove(siblings, status.id, parsed.order),
        siblings
      )
    }

    return requireStatus(tx, status.id)
  })
}

/**
 * Deletes a status, subject to §7.5 (minimum one per project) and §7.3 (not
 * while any task uses it). Survivors are renumbered so the list stays dense.
 */
export async function deleteStatus(
  input: DeleteStatusInput,
  database: Database = db
): Promise<{ id: string; name: string }> {
  const parsed = deleteStatusSchema.parse(input)

  return database.transaction(async (tx) => {
    const status = await requireStatus(tx, parsed.statusId)

    const siblings = await tx
      .select({ id: statuses.id, order: statuses.order })
      .from(statuses)
      .where(eq(statuses.projectId, status.projectId))
      .orderBy(asc(statuses.order))

    // §7.5 / US-D2.3 first: unconditional, and never leaves the user with a
    // remedy they cannot act on.
    if (siblings.length <= 1) {
      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, status.projectId))
        .limit(1)

      throw new RuleViolation(
        `'${status.name}' is the only status in ` +
          `'${project?.name ?? "this project"}'. Every project must keep at ` +
          `least one status, so it cannot be deleted. Create another status ` +
          `first.`
      )
    }

    // §7.3 / US-D2.2: state what is blocking and what to do about it.
    const [inUse] = await tx
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.statusId, status.id),
          eq(tasks.projectId, status.projectId)
        )
      )

    const using = inUse?.value ?? 0

    if (using > 0) {
      throw new RuleViolation(
        `Status '${status.name}' is used by ${using} ` +
          `task${using === 1 ? "" : "s"}. Move those tasks to another status ` +
          `(or delete them) first, then delete the status.`
      )
    }

    await tx.delete(statuses).where(eq(statuses.id, status.id))

    const survivors = siblings.filter((sibling) => sibling.id !== status.id)
    await applyOrder(tx, renumber(survivors), survivors)

    return { id: status.id, name: status.name }
  })
}
