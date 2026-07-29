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
}: {
  part: EveDynamicToolPart
  labels: EntityLabels
  onRespond: (response: InputResponse) => void
  disabled: boolean
}) {
  const request = part.toolMetadata?.eve?.inputRequest

  if (part.state === "approval-requested" && request) {
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
