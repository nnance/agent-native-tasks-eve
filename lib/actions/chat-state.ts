/**
 * Read and write the conversation snapshot behind `GET/PUT /api/chat-state`.
 *
 * Same house rules as every other file in lib/actions/ (see
 * lib/actions/projects.ts): parse first, injectable `database` last. It exists
 * so the architecture's one hard invariant — zero direct database access under
 * app/api/** — holds without exception.
 *
 * Deliberately **not** re-exported from lib/actions/index.ts: that barrel is
 * the product-spec §5 capability set, and chat state is not a capability. See
 * lib/schemas/chat-state.ts for the full reasoning.
 */

import { eq } from "drizzle-orm"

import { db, type Database } from "../db/client.ts"
import { CHAT_STATE_ID, chatState } from "../db/schema.ts"
import {
  getChatStateSchema,
  putChatStateSchema,
  type GetChatStateInput,
  type PutChatStateInput,
} from "../schemas/chat-state.ts"

export type ChatStateView = {
  events: unknown[]
  session: Record<string, unknown> | null
  updatedAt: Date | null
}

/**
 * Reads the snapshot.
 *
 * **No row is not an error.** An empty conversation is a legitimate state —
 * the very first page load, and the state after any reset — so this returns
 * an empty snapshot rather than raising NotFoundError. Making every caller
 * catch a 404 to discover "there is no chat yet" would push branching into
 * each consumer for a case that is not a failure.
 */
export async function getChatState(
  input: GetChatStateInput = {},
  database: Database = db
): Promise<ChatStateView> {
  getChatStateSchema.parse(input)

  const [row] = await database
    .select()
    .from(chatState)
    .where(eq(chatState.id, CHAT_STATE_ID))
    .limit(1)

  if (!row) {
    return { events: [], session: null, updatedAt: null }
  }

  return {
    events: (row.events ?? []) as unknown[],
    session: (row.session ?? null) as Record<string, unknown> | null,
    updatedAt: row.updatedAt,
  }
}

/**
 * Overwrites the snapshot, last write wins (§7.6) — a single upsert statement,
 * so there is no read-then-write race window.
 *
 * `updatedAt` is set explicitly because drizzle's `$onUpdate` fires only for
 * `.update()`, not for the `set` clause of `onConflictDoUpdate`; without it
 * the column would keep the timestamp of the very first insert forever.
 */
export async function putChatState(
  input: PutChatStateInput,
  database: Database = db
): Promise<ChatStateView> {
  const parsed = putChatStateSchema.parse(input)

  const [row] = await database
    .insert(chatState)
    .values({
      id: CHAT_STATE_ID,
      events: parsed.events,
      session: parsed.session,
    })
    .onConflictDoUpdate({
      target: chatState.id,
      set: {
        events: parsed.events,
        session: parsed.session,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) {
    throw new Error("putChatState: the chat_state upsert returned no row.")
  }

  return {
    events: (row.events ?? []) as unknown[],
    session: (row.session ?? null) as Record<string, unknown> | null,
    updatedAt: row.updatedAt,
  }
}
