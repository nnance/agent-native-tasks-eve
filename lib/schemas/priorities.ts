/**
 * Input schemas for the per-project priority capabilities of product spec §5.
 *
 * The `isDefault` field is the interesting one. Product spec §4.3 requires
 * exactly one default per project at all times (US-E1.3), and only two kinds
 * of request could break that: "make zero priorities default" and "make two
 * default". Typing the field as `z.literal(true)` makes the first
 * inexpressible — a default can never be un-set without naming its
 * replacement — and omitting `isDefault` from createPrioritySchema entirely
 * means exactly one code path in the whole system ever writes the flag.
 */

import { z } from "zod"

import { idSchema, nameSchema, orderSchema } from "./common.ts"

/** List a project's priorities in their defined order (US-E1.1). */
export const listPrioritiesSchema = z.strictObject({
  projectId: idSchema,
})

/** Create a priority; it is appended, and is never the default. */
export const createPrioritySchema = z.strictObject({
  projectId: idSchema,
  name: nameSchema,
})

/**
 * Rename, reorder, or designate as the project's default (US-E1.2, US-E1.3).
 * `order` is a 0-based target position, as on updateStatus.
 */
export const updatePrioritySchema = z
  .strictObject({
    priorityId: idSchema,
    name: nameSchema.optional(),
    order: orderSchema.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.order !== undefined ||
      value.isDefault !== undefined,
    { message: "Provide at least one of name, order or isDefault." }
  )

/** Delete a priority — blocked when in use or last remaining (§7.3, §7.5). */
export const deletePrioritySchema = z.strictObject({
  priorityId: idSchema,
})

export type ListPrioritiesInput = z.infer<typeof listPrioritiesSchema>
export type CreatePriorityInput = z.infer<typeof createPrioritySchema>
export type UpdatePriorityInput = z.infer<typeof updatePrioritySchema>
export type DeletePriorityInput = z.infer<typeof deletePrioritySchema>
