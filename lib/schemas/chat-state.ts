/**
 * Input schemas for the conversation snapshot behind `GET/PUT /api/chat-state`.
 *
 * Deliberately **not** re-exported from lib/schemas/index.ts. That barrel's own
 * doc comment describes it as the parity contract shared with the Phase 4 EVE
 * tools, and Phase 1's verification packet mechanically counts 19 schemas in
 * 1:1 correspondence with 19 actions. Chat state is neither a product-spec §5
 * capability nor an EVE tool input — it is transport for the chat pane — so
 * adding a twentieth entry to the barrel would silently falsify a published
 * claim. The route imports this file directly.
 */

import { z } from "zod"

/** Read the conversation snapshot. No inputs; the object keeps the shape uniform. */
export const getChatStateSchema = z.strictObject({})

/**
 * Envelope-only validation: `events` is a list, `session` is an object or null.
 *
 * The interior shape of an EVE event and of a session cursor belongs to the
 * agent runtime, which the project's own notes describe as young and evolving.
 * Encoding it here would produce a validator that starts rejecting valid
 * payloads on the next EVE upgrade, and nothing in product spec §7 constrains
 * the snapshot's contents. `strictObject` still holds, so an unknown top-level
 * key is a loud 400.
 */
export const putChatStateSchema = z.strictObject({
  events: z.array(z.unknown()),
  session: z.record(z.string(), z.unknown()).nullable(),
})

export type GetChatStateInput = z.infer<typeof getChatStateSchema>
export type PutChatStateInput = z.infer<typeof putChatStateSchema>
