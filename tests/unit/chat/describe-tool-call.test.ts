/**
 * The approval card's legibility, as an executable assertion.
 *
 * US-F5.2 ("states exactly what it is about to do — which tasks, what change,
 * how many") is graded on what this module produces, because EVE's own
 * approval prompt is boilerplate (`Approve tool call: bulk_delete_tasks`) and
 * carries none of it. There is no component-testing library inside the §1.1
 * dependency policy, so the safety-critical logic was deliberately split into
 * a pure module precisely so it could be covered here under bare `node --test`.
 *
 * The last group matters most: these functions run underneath a live Approve
 * button, so "never throws" is a correctness requirement, not politeness.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { describe, it } from "node:test"

import {
  describeToolCall,
  extractEntityRefs,
  readToolOutcome,
  shortId,
  toolEntityKind,
  toolMeta,
} from "../../../lib/chat/describe-tool-call.ts"

const TASK_A = randomUUID()
const TASK_B = randomUUID()
const TASK_C = randomUUID()
const PROJECT = randomUUID()
const STATUS = randomUUID()
const PRIORITY = randomUUID()

const labels = {
  [TASK_A]: "Ship the newsletter",
  [TASK_B]: "Fix the login redirect",
  [TASK_C]: "Draft Q3 plan",
  [PROJECT]: "Website",
  [STATUS]: "Done",
  [PRIORITY]: "High",
}

describe("toolMeta", () => {
  it("derives verb, noun and severity for the read tools", () => {
    const meta = toolMeta("list_tasks")

    assert.equal(meta.verb, "List")
    assert.equal(meta.severity, "read")
    // Overridden so the zero-target headline reads "List tasks".
    assert.equal(meta.noun, "tasks")
  })

  it("drops a leading bulk_ so the verb is the user's change", () => {
    const meta = toolMeta("bulk_delete_tasks")

    assert.equal(meta.verb, "Delete")
    assert.equal(meta.noun, "task")
    assert.equal(meta.nounPlural, "tasks")
    assert.equal(meta.pastVerb, "Deleted")
    assert.equal(meta.severity, "destructive")
    assert.ok(meta.consequence)
  })

  it("singularises statuses and priorities correctly", () => {
    assert.equal(toolMeta("delete_status").noun, "status")
    assert.equal(toolMeta("create_status").nounPlural, "statuses")
    assert.equal(toolMeta("delete_priority").noun, "priority")
    assert.equal(toolMeta("create_priority").nounPlural, "priorities")
  })

  it("classifies ask_question as a question, not a write", () => {
    const meta = toolMeta("ask_question")

    assert.equal(meta.severity, "question")
    assert.equal(meta.verb, "Ask")
    assert.equal(meta.pastVerb, "Asked")
  })

  it("gives an unknown tool sane wording rather than a blank", () => {
    const meta = toolMeta("archive_widgets")

    assert.equal(meta.verb, "Archive")
    assert.equal(meta.noun, "widget")
    assert.equal(meta.nounPlural, "widgets")
    assert.equal(meta.pastVerb, "Archived")
    assert.equal(meta.severity, "write")
  })

  it("never produces an empty verb, even for an empty name", () => {
    const meta = toolMeta("")

    assert.ok(meta.verb.length > 0)
    assert.ok(meta.noun.length > 0)
  })
})

describe("toolEntityKind", () => {
  it("reads the entity a tool acts on off its name", () => {
    assert.equal(toolEntityKind("delete_task"), "task")
    assert.equal(toolEntityKind("bulk_update_tasks"), "task")
    assert.equal(toolEntityKind("delete_project"), "project")
    assert.equal(toolEntityKind("list_statuses"), "status")
    assert.equal(toolEntityKind("update_priority"), "priority")
    assert.equal(toolEntityKind("ask_question"), undefined)
  })
})

describe("extractEntityRefs", () => {
  it("reads a single gated id", () => {
    assert.deepEqual(extractEntityRefs("delete_task", { taskId: TASK_A }), [
      { kind: "task", id: TASK_A },
    ])
  })

  it("reads a bulk id array in order", () => {
    assert.deepEqual(
      extractEntityRefs("bulk_delete_tasks", { taskIds: [TASK_A, TASK_B] }),
      [
        { kind: "task", id: TASK_A },
        { kind: "task", id: TASK_B },
      ]
    )
  })

  it("returns change targets as well as call targets", () => {
    assert.deepEqual(
      extractEntityRefs("bulk_update_tasks", {
        taskIds: [TASK_A],
        statusId: STATUS,
      }),
      [
        { kind: "task", id: TASK_A },
        { kind: "status", id: STATUS },
      ]
    )
  })

  it("falls back to a key scan for a non-gated tool", () => {
    assert.deepEqual(
      extractEntityRefs("create_task", {
        projectId: PROJECT,
        title: "New",
        priorityId: PRIORITY,
      }),
      [
        { kind: "project", id: PROJECT },
        { kind: "priority", id: PRIORITY },
      ]
    )
  })

  it("deduplicates a repeated id", () => {
    assert.deepEqual(
      extractEntityRefs("bulk_delete_tasks", {
        taskIds: [TASK_A, TASK_A, TASK_B],
      }),
      [
        { kind: "task", id: TASK_A },
        { kind: "task", id: TASK_B },
      ]
    )
  })
})

describe("describeToolCall — the seven gated tools", () => {
  it("delete_task names the task rather than its id", () => {
    const summary = describeToolCall("delete_task", { taskId: TASK_A }, labels)

    assert.equal(summary.headline, "Delete “Ship the newsletter”")
    assert.equal(summary.count, 1)
    assert.equal(summary.severity, "destructive")
    assert.ok(summary.consequence)
    assert.deepEqual(
      summary.targets.map((target) => [target.label, target.resolved]),
      [["Ship the newsletter", true]]
    )
  })

  it("bulk_delete_tasks states how many, and enumerates every one", () => {
    const summary = describeToolCall(
      "bulk_delete_tasks",
      { taskIds: [TASK_A, TASK_B, TASK_C] },
      labels
    )

    assert.equal(summary.headline, "Delete 3 tasks")
    assert.equal(summary.count, 3)
    assert.deepEqual(
      summary.targets.map((target) => target.label),
      ["Ship the newsletter", "Fix the login redirect", "Draft Q3 plan"]
    )
    assert.deepEqual(summary.changes, [])
  })

  it("bulk_update_tasks states both the targets and the change", () => {
    const summary = describeToolCall(
      "bulk_update_tasks",
      { taskIds: [TASK_A, TASK_B, TASK_C], statusId: STATUS },
      labels
    )

    assert.equal(summary.headline, "Update 3 tasks")
    assert.equal(summary.severity, "write")
    assert.equal(summary.consequence, undefined)
    assert.deepEqual(summary.changes, [{ label: "Status", value: "Done" }])
    // The status id is a change, never a target: the card must not claim four.
    assert.equal(summary.count, 3)
  })

  it("update_task reports every field it touches", () => {
    const summary = describeToolCall(
      "update_task",
      {
        taskId: TASK_A,
        title: "Ship it",
        description: null,
        priorityId: PRIORITY,
      },
      labels
    )

    assert.equal(summary.headline, "Update “Ship the newsletter”")
    assert.deepEqual(summary.changes, [
      { label: "Title", value: "“Ship it”" },
      { label: "Description", value: "cleared" },
      { label: "Priority", value: "High" },
    ])
  })

  it("delete_project reads a bare projectId as the target, not a change", () => {
    const summary = describeToolCall(
      "delete_project",
      { projectId: PROJECT },
      labels
    )

    assert.equal(summary.headline, "Delete “Website”")
    assert.equal(summary.count, 1)
    assert.equal(summary.severity, "destructive")
    assert.deepEqual(summary.changes, [])
  })

  it("delete_status and delete_priority resolve their own entity kind", () => {
    const status = describeToolCall(
      "delete_status",
      { statusId: STATUS },
      labels
    )
    assert.equal(status.headline, "Delete “Done”")
    assert.equal(status.count, 1)

    const priority = describeToolCall(
      "delete_priority",
      { priorityId: PRIORITY },
      labels
    )
    assert.equal(priority.headline, "Delete “High”")
    assert.equal(priority.count, 1)
  })
})

describe("describeToolCall — the ungated tools", () => {
  it("create_task has no target and puts everything in changes", () => {
    const summary = describeToolCall(
      "create_task",
      { projectId: PROJECT, title: "Fix header", statusId: STATUS },
      labels
    )

    assert.equal(summary.headline, "Create task")
    assert.equal(summary.count, 0)
    assert.deepEqual(summary.changes, [
      { label: "Title", value: "“Fix header”" },
      { label: "Project", value: "Website" },
      { label: "Status", value: "Done" },
    ])
  })

  it("a read tool renders quietly with a plural noun", () => {
    const summary = describeToolCall(
      "list_tasks",
      { projectId: PROJECT, search: "header" },
      labels
    )

    assert.equal(summary.headline, "List tasks")
    assert.equal(summary.severity, "read")
    assert.deepEqual(summary.changes, [
      { label: "Project", value: "Website" },
      { label: "Search", value: "“header”" },
    ])
  })

  it("ask_question carries the model's prompt", () => {
    const summary = describeToolCall(
      "ask_question",
      { prompt: "Which “Draft” did you mean?" },
      labels
    )

    assert.equal(summary.severity, "question")
    assert.deepEqual(summary.changes, [
      { label: "Question", value: "Which “Draft” did you mean?" },
    ])
  })

  it("an unknown tool still produces a renderable summary", () => {
    const summary = describeToolCall("archive_widgets", { taskId: TASK_A })

    assert.equal(summary.headline, `Archive “${shortId(TASK_A)}”`)
    assert.equal(summary.severity, "write")
  })
})

describe("describeToolCall — unresolved ids", () => {
  it("degrades to a short id and flags it as unresolved", () => {
    const summary = describeToolCall("delete_task", { taskId: TASK_A }, {})
    const [target] = summary.targets

    assert.ok(target)
    assert.equal(target.resolved, false)
    assert.equal(target.label, TASK_A.slice(0, 8))
    assert.equal(summary.headline, `Delete “${TASK_A.slice(0, 8)}”`)
  })

  it("resolves what it can and leaves the rest short", () => {
    const summary = describeToolCall(
      "bulk_delete_tasks",
      { taskIds: [TASK_A, TASK_B] },
      { [TASK_A]: "Ship the newsletter" }
    )

    assert.deepEqual(
      summary.targets.map((target) => [target.label, target.resolved]),
      [
        ["Ship the newsletter", true],
        [TASK_B.slice(0, 8), false],
      ]
    )
    assert.equal(summary.count, 2)
  })

  it("never invents a name for an id it does not know", () => {
    const summary = describeToolCall("delete_task", { taskId: TASK_A }, {})

    assert.ok(!summary.headline.includes("Ship"))
  })
})

describe("describeToolCall — malformed input never throws", () => {
  const hostile: unknown[] = [
    undefined,
    null,
    "just a string",
    42,
    [],
    [1, 2, 3],
    {},
    { taskId: 12 },
    { taskIds: "not-an-array" },
    { taskIds: [null, undefined, 7, ""] },
    { taskId: TASK_A, statusId: 5, order: Number.NaN },
    { description: { nested: true } },
  ]

  for (const [index, input] of hostile.entries()) {
    it(`case ${index}: renders something for ${JSON.stringify(input) ?? "undefined"}`, () => {
      for (const toolName of [
        "delete_task",
        "bulk_delete_tasks",
        "bulk_update_tasks",
        "update_task",
        "delete_project",
        "unknown_tool",
        "",
      ]) {
        const summary = describeToolCall(toolName, input, labels)

        assert.equal(typeof summary.headline, "string")
        assert.ok(summary.headline.length > 0)
        assert.ok(Array.isArray(summary.targets))
        assert.ok(Array.isArray(summary.changes))
        assert.equal(summary.count, summary.targets.length)
      }
    })
  }
})

describe("readToolOutcome", () => {
  it("reads a success envelope", () => {
    assert.deepEqual(
      readToolOutcome({ ok: true, data: { title: "Fix header" } }),
      {
        kind: "ok",
        detail: "Fix header",
      }
    )
  })

  it("counts rows on a list result", () => {
    assert.deepEqual(
      readToolOutcome({ ok: true, data: { count: 3, items: [] } }),
      {
        kind: "ok",
        detail: "3 rows",
      }
    )
  })

  it("relays a blocked message verbatim", () => {
    const message = "Project 'Website' still has 4 tasks."

    assert.deepEqual(readToolOutcome({ ok: false, kind: "blocked", message }), {
      kind: "failed",
      failure: "blocked",
      message,
    })
  })

  it("keeps not_found and invalid_input distinct", () => {
    assert.equal(
      readToolOutcome({ ok: false, kind: "not_found", message: "gone" }).kind,
      "failed"
    )
    assert.equal(
      (
        readToolOutcome({
          ok: false,
          kind: "invalid_input",
          message: "bad",
        }) as { failure: string }
      ).failure,
      "invalid_input"
    )
  })

  it("reports anything it cannot read as unreadable rather than as success", () => {
    for (const output of [undefined, null, "text", 7, [], { data: 1 }]) {
      assert.deepEqual(readToolOutcome(output), { kind: "unreadable" })
    }
  })
})
