/**
 * Reading the assistant's words out of a turn — including a turn that parked.
 *
 * ## Why this is not just `turn.message`
 *
 * `EveEvalTurn.message` is built by `extractCompletedMessage`, which is (from
 * `eve/dist/src/client/session-utils.js`, verified against the installed
 * package):
 *
 * ```js
 * function isFinalMessageCompleted(event) {
 *   return event.type === "message.completed" && event.data.finishReason !== "tool-calls"
 * }
 * ```
 *
 * Every assistant step that ends by calling a tool carries
 * `finishReason: "tool-calls"` and is therefore excluded — which is right for
 * "the reply", and exactly wrong for the two evals that grade what the agent
 * said *immediately before* pausing on an approval. Those turns have no final
 * message at all: the last thing that happened is a tool call awaiting the
 * user, so `turn.message` is `undefined`.
 *
 * That is not a hypothetical. Both HITL evals here first graded
 * `{ on: asked.message }` and scored a flat 0% while their deterministic gates
 * all passed — the judge was being handed an empty string, not a bad reply.
 * `messageIncludes` did not have the problem, because it joins assistant text
 * across the scope's events rather than reading `message`; this function does
 * the same thing, for the judge.
 *
 * `assertions.mdx` names the typed event stream as the sanctioned escape hatch
 * for exactly this ("`eventsSatisfy` remains the escape hatch"), so reading
 * events here is the documented move rather than a workaround.
 */

import type { HandleMessageStreamEvent } from "eve/client"

/**
 * Every assistant message in a turn, joined — tool-call steps included.
 *
 * Returns `""` rather than `undefined` for a silent turn, so a caller can hand
 * the result straight to a judge without a fallback that would quietly grade
 * the wrong thing.
 */
export function assistantText(turn: {
  readonly events: readonly HandleMessageStreamEvent[]
}): string {
  const parts: string[] = []

  for (const event of turn.events) {
    if (event.type !== "message.completed") continue

    const message = event.data.message

    if (typeof message === "string" && message.trim() !== "") {
      parts.push(message)
    }
  }

  return parts.join("\n\n")
}
