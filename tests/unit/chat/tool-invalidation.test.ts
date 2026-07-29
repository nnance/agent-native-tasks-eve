/**
 * The live-sync mapping, as an executable assertion (US-G1).
 *
 * `queryFamiliesForEvent` is the whole "agent → UI" mechanism in one function,
 * and its failure mode is silent: a pane that renders fine and is simply
 * wrong. Nothing in the E2E suite can distinguish "invalidated the right
 * families" from "the 30s poll happened to fire", so the exact mapping is
 * pinned here, deterministically, and `07-live-sync.test.ts` is left to prove
 * the wiring end to end.
 *
 * The last group is the one that earns its keep over time: it reads
 * `agent/tools/` off disk, so a twentieth product tool added in a later phase
 * fails here at the moment the file lands, rather than shipping as a stale
 * pane nobody notices.
 */

import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

import type { HandleMessageStreamEvent } from "eve/client"

import {
  isFailedToolOutput,
  queryFamiliesForEvent,
  QUERY_FAMILIES_BY_TOOL,
  type QueryFamily,
} from "../../../lib/chat/tool-invalidation.ts"

/**
 * One `action.result` event, with everything the type demands supplied and
 * only the interesting parts overridable. Strict TS will not accept a partial
 * event literal, and hand-writing `sequence`/`stepIndex`/`turnId` at every
 * call site would bury the thing each case is actually varying.
 */
function actionResult(options: {
  toolName?: string
  status?: "completed" | "failed" | "rejected"
  isError?: boolean
  output?: unknown
  kind?: "tool-result" | "subagent-result" | "load-skill-result"
}): HandleMessageStreamEvent {
  const kind = options.kind ?? "tool-result"

  const result =
    kind === "tool-result"
      ? {
          callId: "call-1",
          isError: options.isError,
          kind: "tool-result" as const,
          output: (options.output ?? { ok: true, data: {} }) as never,
          toolName: options.toolName ?? "update_task",
        }
      : kind === "subagent-result"
        ? {
            callId: "call-1",
            kind: "subagent-result" as const,
            output: (options.output ?? {}) as never,
            subagentName: "researcher",
          }
        : {
            callId: "call-1",
            kind: "load-skill-result" as const,
            output: (options.output ?? {}) as never,
          }

  return {
    type: "action.result",
    data: {
      result,
      sequence: 1,
      stepIndex: 0,
      status: options.status ?? "completed",
      turnId: "turn-1",
    },
  } as HandleMessageStreamEvent
}

const families = (toolName: string, extra: Partial<{ output: unknown }> = {}) =>
  queryFamiliesForEvent(actionResult({ toolName, ...extra }))

// ------------------------------------------------------------------ mapping

describe("QUERY_FAMILIES_BY_TOOL", () => {
  it("maps every task-mutating tool to the tasks family alone", () => {
    for (const tool of [
      "create_task",
      "update_task",
      "delete_task",
      "bulk_update_tasks",
      "bulk_delete_tasks",
    ]) {
      assert.deepStrictEqual(families(tool), ["tasks"], tool)
    }
  })

  it("maps project writes onto projects *and* tasks", () => {
    // `TaskView` denormalises the project name onto every row, so a rename
    // that only invalidated `projects` would leave stale chips on the left.
    assert.deepStrictEqual(families("create_project"), ["projects", "tasks"])
    assert.deepStrictEqual(families("rename_project"), ["projects", "tasks"])
  })

  it("maps a project delete onto all four families", () => {
    // It cascades through the project's statuses and priorities, and the pane
    // may still be filtered by the project that just went away.
    assert.deepStrictEqual(families("delete_project"), [
      "projects",
      "tasks",
      "statuses",
      "priorities",
    ])
  })

  it("maps status writes onto statuses and tasks", () => {
    for (const tool of ["create_status", "update_status", "delete_status"]) {
      assert.deepStrictEqual(families(tool), ["statuses", "tasks"], tool)
    }
  })

  it("maps priority writes onto priorities and tasks", () => {
    for (const tool of [
      "create_priority",
      "update_priority",
      "delete_priority",
    ]) {
      assert.deepStrictEqual(families(tool), ["priorities", "tasks"], tool)
    }
  })

  it("invalidates nothing for a read tool", () => {
    for (const tool of [
      "list_tasks",
      "list_projects",
      "list_statuses",
      "list_priorities",
      "get_task",
    ]) {
      assert.deepStrictEqual(families(tool), [], tool)
    }
  })

  it("invalidates nothing for a tool name it has never heard of", () => {
    assert.deepStrictEqual(families("totally_made_up"), [])
  })
})

// -------------------------------------------------------------- event gating

describe("queryFamiliesForEvent", () => {
  it("ignores a call the user denied at the approval gate", () => {
    // `rejected` is eve's marker for a HITL denial: nothing executed. Treating
    // it as a write is the one bug that could make a denial look effective.
    assert.deepStrictEqual(
      queryFamiliesForEvent(
        actionResult({ toolName: "delete_task", status: "rejected" })
      ),
      []
    )
  })

  it("ignores a failed action", () => {
    assert.deepStrictEqual(
      queryFamiliesForEvent(
        actionResult({ toolName: "delete_task", status: "failed" })
      ),
      []
    )
  })

  it("ignores a tool result flagged isError", () => {
    assert.deepStrictEqual(
      queryFamiliesForEvent(
        actionResult({ toolName: "update_task", isError: true })
      ),
      []
    )
  })

  it("ignores this repo's own ok:false failure envelope", () => {
    assert.deepStrictEqual(
      families("delete_project", {
        output: {
          ok: false,
          kind: "blocked",
          message: "This project still has tasks.",
        },
      }),
      []
    )
  })

  it("invalidates on the ok:true envelope", () => {
    assert.deepStrictEqual(
      families("create_task", { output: { ok: true, data: { id: "t1" } } }),
      ["tasks"]
    )
  })

  it("invalidates when the output carries no ok key at all", () => {
    // Not ours to interpret, so the safe default applies: a needless refetch
    // is cheap, a missed one is a stale pane.
    assert.deepStrictEqual(families("update_task", { output: "some string" }), [
      "tasks",
    ])
    assert.deepStrictEqual(families("update_task", { output: null }), ["tasks"])
    assert.deepStrictEqual(families("update_task", { output: [1, 2, 3] }), [
      "tasks",
    ])
  })

  it("ignores every event type that is not action.result", () => {
    // `actions.requested` in particular: it fires *before* execution, when
    // nothing durable has changed yet.
    const requested = {
      type: "actions.requested",
      data: {
        actions: [
          {
            callId: "call-1",
            input: {},
            kind: "tool-call",
            toolName: "delete_task",
          },
        ],
        sequence: 1,
        stepIndex: 0,
        turnId: "turn-1",
      },
    } as unknown as HandleMessageStreamEvent

    assert.deepStrictEqual(queryFamiliesForEvent(requested), [])

    const completed = {
      type: "message.completed",
      data: { message: "Done.", sequence: 2, stepIndex: 0, turnId: "turn-1" },
    } as unknown as HandleMessageStreamEvent

    assert.deepStrictEqual(queryFamiliesForEvent(completed), [])
  })

  it("ignores a result that is not a tool result", () => {
    assert.deepStrictEqual(
      queryFamiliesForEvent(actionResult({ kind: "subagent-result" })),
      []
    )
    assert.deepStrictEqual(
      queryFamiliesForEvent(actionResult({ kind: "load-skill-result" })),
      []
    )
  })

  it("never throws on a malformed event", () => {
    // It runs on a live stream underneath the chat transcript; a throw here
    // would take the whole pane with it.
    for (const malformed of [
      undefined,
      null,
      "action.result",
      42,
      {},
      { type: "action.result" },
      { type: "action.result", data: null },
      { type: "action.result", data: { status: "completed" } },
      { type: "action.result", data: { status: "completed", result: {} } },
    ]) {
      assert.deepStrictEqual(
        queryFamiliesForEvent(malformed as unknown as HandleMessageStreamEvent),
        [],
        JSON.stringify(malformed ?? null)
      )
    }
  })
})

describe("isFailedToolOutput", () => {
  it("is true only for an explicit ok:false object", () => {
    assert.equal(isFailedToolOutput({ ok: false, kind: "blocked" }), true)
    assert.equal(isFailedToolOutput({ ok: true, data: {} }), false)
    assert.equal(isFailedToolOutput({ data: {} }), false)
    assert.equal(isFailedToolOutput(null), false)
    assert.equal(isFailedToolOutput(undefined), false)
    assert.equal(isFailedToolOutput("ok: false"), false)
    assert.equal(isFailedToolOutput([false]), false)
  })
})

// ------------------------------------------------------------ completeness

/**
 * The eve built-ins configured (and disabled) in `agent/tools/`, which are not
 * product tools and never touch this app's data. `agent/instructions.md` says
 * so outright: "These nineteen tools are the whole of what you can do to the
 * user's data. You have no shell, no filesystem, and no web access."
 */
const NON_PRODUCT_TOOLS = new Set([
  "agent",
  "bash",
  "glob",
  "grep",
  "read_file",
  "todo",
  "web_fetch",
  "web_search",
  "write_file",
])

describe("completeness", () => {
  it("covers every product tool in agent/tools/", () => {
    const directory = fileURLToPath(
      new URL("../../../agent/tools/", import.meta.url)
    )

    const productTools = readdirSync(directory)
      .filter((entry) => entry.endsWith(".ts"))
      .map((entry) => entry.slice(0, -".ts".length))
      .filter((name) => !NON_PRODUCT_TOOLS.has(name))
      .sort()

    assert.deepStrictEqual(
      productTools,
      Object.keys(QUERY_FAMILIES_BY_TOOL).sort(),
      "every product tool must have an invalidation entry — a missing one is " +
        "a silently stale task pane, not an error"
    )

    // The spec and the instructions both say nineteen. If that number moves,
    // both documents move with it.
    assert.equal(productTools.length, 19)
  })

  it("names only real query families", () => {
    const known: readonly QueryFamily[] = [
      "tasks",
      "projects",
      "statuses",
      "priorities",
    ]

    for (const [tool, entry] of Object.entries(QUERY_FAMILIES_BY_TOOL)) {
      for (const family of entry) {
        assert.ok(known.includes(family), `${tool} → ${family}`)
      }
      assert.equal(
        new Set(entry).size,
        entry.length,
        `${tool} lists a family twice`
      )
    }
  })
})
