/**
 * Input schemas for the task capabilities of product spec §5.
 *
 * The most important line in this file is the one that is not here:
 * `updateTaskSchema` has **no `projectId` field**. That omission, combined
 * with `z.strictObject`, is how product spec §7 rule 1 (a task's project is
 * fixed at creation) is enforced — an illegal state that cannot be expressed
 * beats a runtime check that a future edit could forget, and because this same
 * object is what the Phase 2 route parses and the Phase 4 EVE tool advertises,
 * the constraint is visible in the shared contract rather than buried in an
 * action. A caller who smuggles `projectId` into an update gets a loud
 * ZodError, not a change that appears to succeed and quietly does nothing.
 */

import { z } from "zod"

import { descriptionSchema, idSchema, titleSchema } from "./common.ts"

/**
 * List/browse tasks, with every filter combinable (US-B3.1, US-B3.4).
 *
 * The field is `search`, not `q`: this schema doubles as the tool input a
 * model reads directly, and `search` is self-describing where `q` is a
 * URL-shortening convention. Phase 2's route maps `?q=` onto it — exactly the
 * transport adaptation the interface layer exists to do.
 */
export const listTasksSchema = z.strictObject({
  projectId: idSchema.optional(),
  statusId: idSchema.optional(),
  priorityId: idSchema.optional(),
  search: z.string().trim().min(1).optional(),
  includeCompleted: z.boolean().optional(),
})

/** View one task and all of its fields, including the full description. */
export const getTaskSchema = z.strictObject({
  taskId: idSchema,
})

/** Create a task; omitted status/priority take the project's defaults (§4.4). */
export const createTaskSchema = z.strictObject({
  projectId: idSchema,
  title: titleSchema,
  description: descriptionSchema.optional(),
  statusId: idSchema.optional(),
  priorityId: idSchema.optional(),
})

/**
 * Edit a task, including moving its status (US-B4, US-B5).
 *
 * `description` is `.nullable().optional()`: an absent key leaves it
 * untouched, an explicit `null` clears it, a string sets it. It is the only
 * nullable user-editable field, and without the distinction there would be no
 * way to ever clear a description once written.
 */
export const updateTaskSchema = z
  .strictObject({
    taskId: idSchema,
    title: titleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    statusId: idSchema.optional(),
    priorityId: idSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.statusId !== undefined ||
      value.priorityId !== undefined,
    {
      message:
        "Provide at least one of title, description, statusId or priorityId.",
    }
  )

/** Delete one task. */
export const deleteTaskSchema = z.strictObject({
  taskId: idSchema,
})

/** Apply one status and/or priority across several tasks, all or nothing. */
export const bulkUpdateTasksSchema = z
  .strictObject({
    taskIds: z.array(idSchema).min(1),
    statusId: idSchema.optional(),
    priorityId: idSchema.optional(),
  })
  .refine(
    (value) => value.statusId !== undefined || value.priorityId !== undefined,
    { message: "Provide a statusId and/or a priorityId to apply." }
  )

/** Delete several tasks, all or nothing. */
export const bulkDeleteTasksSchema = z.strictObject({
  taskIds: z.array(idSchema).min(1),
})

export type ListTasksInput = z.infer<typeof listTasksSchema>
export type GetTaskInput = z.infer<typeof getTaskSchema>
export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>
export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>
export type BulkDeleteTasksInput = z.infer<typeof bulkDeleteTasksSchema>
