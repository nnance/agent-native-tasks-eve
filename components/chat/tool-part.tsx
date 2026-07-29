"use client"

/**
 * The one place the transcript decides what a tool call looks like.
 *
 * Implementation plan §2.5 reads as though EVE emitted three part types —
 * `tool-call`, `tool-result` and `dynamic-tool`. It does not. The installed
 * `eve/dist/src/client/message-reducer-types.d.ts` defines `EveMessagePart` as
 * `text | reasoning | file | step-start | authorization | dynamic-tool`, and
 * *every* tool call — gated or not, read or write — is one `dynamic-tool` part
 * moving through a state machine:
 *
 *   input-streaming → input-available
 *     → [approval-requested → approval-responded]
 *     → output-available | output-error | output-denied
 *
 * So the branch is on `state`, not on `type`. Taking the plan literally would
 * have matched nothing and silently dropped every tool call in the app from
 * the transcript.
 *
 * Keeping that branch to one line is also what makes "generic across all seven
 * gated tools" true by construction rather than by discipline — including
 * `update_task`, whose gate is an input-dependent policy
 * (`agent/lib/bulk-edit-gate.ts`) that can pause a perfectly ordinary edit
 * mid-turn. Nothing here special-cases a destructive-looking tool name.
 */

import type { EveDynamicToolPart } from "eve/react"
import type { InputResponse } from "eve/client"

import { ActionEntry } from "@/components/chat/action-entry"
import { ApprovalCard } from "@/components/chat/approval-card"
import type { EntityLabels } from "@/lib/chat/describe-tool-call"

export function ToolPart({
  part,
  labels,
  onRespond,
  disabled,
  live,
}: {
  part: EveDynamicToolPart
  labels: EntityLabels
  onRespond: (response: InputResponse) => void
  disabled: boolean
  /**
   * Whether this part sits on the newest message that is not the user's.
   *
   * It gates **questions** only, and it exists because of a real defect: after
   * a page reload an already-answered `ask_question` replays as
   * `approval-requested`. Nothing on the server ever advances that part —
   * `ask_question` has no `execute`, so there is no output event — and the
   * projection event that resolved it client-side
   * (`client.input.responded`) is reducer-facing only, deliberately absent
   * from the authoritative `events` array we persist. Without the flag the
   * transcript grows a scrollback of live-looking buttons for decisions the
   * user already made.
   *
   * A follow-up message also *answers* a question as far as eve is concerned —
   * it "clears that pending request before the model continues" — so a
   * question's card stepping aside for the next message is correct, not a
   * loss.
   */
  live: boolean
}) {
  const request = part.toolMetadata?.eve?.inputRequest

  /**
   * An approval, unlike a question, is live wherever it sits.
   *
   * Position is not evidence for a tool approval: answering one always
   * advances the part on the *server* — to `output-available`, `output-error`
   * or `output-denied` — so a part still reading `approval-requested` is still
   * genuinely parked, reload or no reload. Meanwhile an unrelated follow-up
   * does **not** answer it (eve holds the text), so nothing appended later may
   * take Approve and Deny off the screen. `ChatPane` closes the composer for
   * the same reason; this is the half that holds even if that lock is ever
   * relaxed.
   */
  const isConfirmation = request?.display === "confirmation"

  if (
    (live || isConfirmation) &&
    part.state === "approval-requested" &&
    request
  ) {
    return (
      <ApprovalCard
        part={part}
        request={request}
        labels={labels}
        onRespond={onRespond}
        disabled={disabled}
      />
    )
  }

  return <ActionEntry part={part} labels={labels} />
}
