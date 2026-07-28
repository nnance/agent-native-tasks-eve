/**
 * Input schemas for the project capabilities of product spec §5.
 *
 * Every schema is a `z.strictObject`, so an unknown key is a loud ZodError
 * rather than a silent strip. That matters most on the task schemas, but one
 * uniform rule is easier to reason about than a per-schema judgement call.
 */

import { z } from "zod"

import { idSchema, nameSchema } from "./common.ts"

/** View/list projects. No inputs today; the object keeps the shape uniform. */
export const listProjectsSchema = z.strictObject({})

/** Create a project (seeded with default statuses and priorities, US-C1.2). */
export const createProjectSchema = z.strictObject({
  name: nameSchema,
})

/** Rename a project (US-C2). */
export const renameProjectSchema = z.strictObject({
  projectId: idSchema,
  name: nameSchema,
})

/** Delete a project — blocked when it still has tasks (§7.3, US-C3). */
export const deleteProjectSchema = z.strictObject({
  projectId: idSchema,
})

export type ListProjectsInput = z.infer<typeof listProjectsSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type RenameProjectInput = z.infer<typeof renameProjectSchema>
export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>
