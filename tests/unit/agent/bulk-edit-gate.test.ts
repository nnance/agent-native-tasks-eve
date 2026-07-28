/**
 * Product spec §6's bulk rule for edits, as an executable assertion.
 *
 * The rule under test: "a single request that would modify … more than one
 * task" must confirm first. `update_task` takes one id, so the framework can
 * only see the rule by counting distinct tasks within a turn — which is what
 * `afterFirstTaskInTurn` does. These cases pin the four behaviours the safety
 * argument in `agent/lib/bulk-edit-gate.ts` rests on: one task free, a second
 * task gated, a re-edit of the same task still free, and no turn identity
 * meaning ask.
 *
 * The module's state is per (session, turn, tool), so every case mints its own
 * turn id rather than needing a reset hook — which also proves the buckets do
 * not leak into each other.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { describe, it } from "node:test"

import type { ApprovalContext } from "eve/tools"

import { afterFirstTaskInTurn } from "../../../agent/lib/bulk-edit-gate.ts"

type Overrides = {
  callId?: string
  taskId?: string
  toolInput?: null
  sessionId?: string
  turnId?: string | null
  toolName?: string
}

/** One `update_task` approval evaluation inside a named turn. */
function judge(turnId: string | null, overrides: Overrides = {}) {
  const context = {
    approvedTools: new Set<string>(),
    callId: overrides.callId ?? randomUUID(),
    toolName: overrides.toolName ?? "update_task",
    toolInput:
      overrides.toolInput === null
        ? undefined
        : { taskId: overrides.taskId ?? randomUUID() },
    session: {
      id: overrides.sessionId ?? "session-under-test",
      auth: { current: null, initiator: null },
      ...(turnId === null ? {} : { turn: { id: turnId, sequence: 1 } }),
    },
  } as unknown as ApprovalContext<{ taskId: string }>

  return afterFirstTaskInTurn(context)
}

describe("update_task's approval policy", () => {
  it("lets the first task edited in a turn run without a prompt", () => {
    // §6: "editing a single task … executes directly without a confirmation
    // gate". A gate here would be a regression, not extra safety.
    assert.equal(judge(randomUUID()), "not-applicable")
  })

  it("pauses once a second task is edited in the same turn", () => {
    const turn = randomUUID()

    assert.equal(judge(turn), "not-applicable")
    assert.equal(judge(turn), "user-approval")
    assert.equal(judge(turn), "user-approval")
  })

  it("does not count a second edit of the same task as a second task", () => {
    // "set the title and move it to Done" may arrive as two calls on one id.
    // One task modified is not a bulk change.
    const turn = randomUUID()
    const taskId = randomUUID()

    assert.equal(judge(turn, { taskId }), "not-applicable")
    assert.equal(judge(turn, { taskId }), "not-applicable")
  })

  it("is idempotent for a replayed call", () => {
    // EVE re-resolves approval for a call it has already judged (step replay,
    // and again when a pending approval is answered). The same call must not
    // become a second task.
    const turn = randomUUID()
    const callId = randomUUID()
    const taskId = randomUUID()

    assert.equal(judge(turn, { callId, taskId }), "not-applicable")
    assert.equal(judge(turn, { callId, taskId }), "not-applicable")
  })

  it("starts fresh in the next turn", () => {
    // The rule is scoped to "a single request", so a turn that gated an edit
    // must not gate the next turn's first one.
    const first = randomUUID()

    assert.equal(judge(first), "not-applicable")
    assert.equal(judge(first), "user-approval")
    assert.equal(judge(randomUUID()), "not-applicable")
  })

  it("keeps separate sessions separate", () => {
    const turn = randomUUID()

    assert.equal(judge(turn, { sessionId: "session-a" }), "not-applicable")
    assert.equal(judge(turn, { sessionId: "session-b" }), "not-applicable")
  })

  it("asks when the runtime supplies no turn identity", () => {
    // Unable to prove this is the turn's first edit, the safe answer is the
    // prompt — the failure mode is an extra confirmation, never a silent
    // multi-task write.
    assert.equal(judge(null), "user-approval")
  })

  it("treats an unreadable input as its own task", () => {
    // Falling back to the callId keeps the policy total: a call whose input
    // never arrived still counts once, and still gates the next one.
    const turn = randomUUID()

    assert.equal(judge(turn, { toolInput: null }), "not-applicable")
    assert.equal(judge(turn, { toolInput: null }), "user-approval")
  })
})
