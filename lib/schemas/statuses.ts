/**
 * Input schemas for the per-project status capabilities of product spec §5.
 *
 * There is no separate "reorder" schema: implementation plan §1 fixes the tool
 * grain at a consolidated `update_*` per entity, so `order` on updateStatus
 * means "move this status to 0-based position N" — which is also the shape a
 * model can emit from "move Done to the front".
 */

import { z } from "zod"

import { idSchema, nameSchema, orderSchema } from "./common.ts"

/** List a project's statuses in their defined order (US-D1.1). */
export const listStatusesSchema = z.strictObject({
  projectId: idSchema,
})

/** Create a status; it is appended to the end of the project's list. */
export const createStatusSchema = z.strictObject({
  projectId: idSchema,
  name: nameSchema,
  isCompleted: z.boolean().optional(),
})

/**
 * Rename, reorder, or toggle the completed flag (US-D1.2, US-D1.3).
 *
 * The refinement rejects an empty patch: a no-op update is almost always a
 * mistake in a tool call, and the message tells the model which fields it
 * could have supplied. It does not appear in the generated JSON Schema, but
 * EVE parses with the zod schema itself, so it still holds at call time.
 */
export const updateStatusSchema = z
  .strictObject({
    statusId: idSchema,
    name: nameSchema.optional(),
    order: orderSchema.optional(),
    isCompleted: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.order !== undefined ||
      value.isCompleted !== undefined,
    { message: "Provide at least one of name, order or isCompleted." }
  )

/** Delete a status — blocked when in use or last remaining (§7.3, §7.5). */
export const deleteStatusSchema = z.strictObject({
  statusId: idSchema,
})

export type ListStatusesInput = z.infer<typeof listStatusesSchema>
export type CreateStatusInput = z.infer<typeof createStatusSchema>
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>
export type DeleteStatusInput = z.infer<typeof deleteStatusSchema>
