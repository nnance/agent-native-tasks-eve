/**
 * Field schemas shared across the capability schemas.
 *
 * lib/schemas/ is the parity contract of implementation plan §2.1: the exact
 * same schema object is imported by the Phase 2 API route (which calls
 * `.parse()` for a 400) and by the Phase 4 EVE tool (which passes it as
 * `inputSchema`). Anything expressible here is expressible through both front
 * doors, and anything inexpressible is impossible through either.
 *
 * Two house rules hold across every schema file:
 *
 * - **No `.default()`.** Optional stays optional so `z.input` and `z.output`
 *   are identical and an object parsed at the transport edge is trivially
 *   re-parseable by the action, which applies the default itself.
 * - **No `.max()`.** The spec declares no length limits and the underlying
 *   columns are unbounded `text`; an invented cap could only reject input the
 *   product allows.
 */

import { z } from "zod"

export const idSchema = z.uuid()

export const nameSchema = z.string().trim().min(1, "Name cannot be empty")

export const titleSchema = z.string().trim().min(1, "Title cannot be empty")

// Deliberately untrimmed: a description is free text where leading indentation
// and trailing blank lines are the author's formatting, not noise.
export const descriptionSchema = z.string()

/** A 0-based position within a project's ordered list. */
export const orderSchema = z.number().int().min(0)
