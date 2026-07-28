import { getChatState, putChatState } from "@/lib/actions/chat-state"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { putChatStateSchema } from "@/lib/schemas/chat-state"

/**
 * Conversation snapshot persistence (implementation plan §2.3).
 *
 * The action and schema are imported from their files directly rather than
 * through lib/actions and lib/schemas: chat state is not a product-spec §5
 * capability and not an EVE tool input, so it is deliberately absent from
 * those barrels. See lib/schemas/chat-state.ts.
 *
 * GET never answers 404 — an empty conversation is a legitimate state, so an
 * absent row reads as an empty snapshot. PUT is a whole-snapshot overwrite,
 * last write wins (§7.6), and answers 200 because it is not a creation in any
 * sense the caller can observe: there is exactly one row, always.
 */
export async function GET() {
  return respond(async () => getChatState())
}

export async function PUT(request: Request) {
  return respond(async () =>
    putChatState(putChatStateSchema.parse(await readJsonObject(request)))
  )
}
