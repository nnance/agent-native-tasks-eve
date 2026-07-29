"use client"

/**
 * The chat pane's one write to the server, behind a named seam.
 *
 * `useEveAgent`'s `onFinish` fires from the store's `finally` block on every
 * turn boundary — normal completion, error, abort, and a turn that parks at
 * `session.waiting` waiting for an approval. That last case is why `onFinish`
 * alone is sufficient for US-F1.3: a reload while an approval card is on
 * screen re-renders that card from the snapshot this function wrote.
 *
 * **Fire and forget, on purpose.** A background persistence failure must not
 * interrupt an otherwise-successful turn, and there is nothing useful to do
 * about it in the moment: the snapshot is a whole-conversation overwrite, so
 * the very next turn's `onFinish` re-persists everything that was lost
 * (last write wins, implementation plan §8 risk 5). The failure is logged, not
 * surfaced — an error banner over a turn that actually succeeded would be a
 * worse lie than a silent retry-next-turn.
 *
 * The **full** session cursor is persisted every time: all three of
 * `sessionId`, `continuationToken` and `streamIndex`. A partial persist would
 * silently break reload-and-continue, which is the phase's graded exit
 * criterion, and would do so in a way that looks like a model failure rather
 * than a storage bug.
 */

import { apiFetch, jsonBody } from "@/lib/queries/http"
import type { PutChatStateInput } from "@/lib/schemas/chat-state"

export async function persistChatState(
  input: PutChatStateInput
): Promise<void> {
  try {
    await apiFetch("/api/chat-state", { method: "PUT", ...jsonBody(input) })
  } catch (error) {
    console.error("Failed to persist the conversation snapshot.", error)
  }
}
