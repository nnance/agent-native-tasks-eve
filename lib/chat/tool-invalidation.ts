/**
 * Which cache families one completed agent tool call invalidates
 * (implementation plan §5.1, US-G1).
 *
 * This is the "agent → UI" half of live sync. `chat-pane.tsx` hands every
 * stream event `useEveAgent` observes to `queryFamiliesForEvent`, and
 * invalidates whatever comes back. Everything interesting is here rather than
 * in the component, for the reasons `describe-tool-call.ts` is also a pure
 * module: no React, no `@/` alias, relative `.ts` imports only, so this runs
 * under bare `node --test` *and* through the Next bundler, and the phase's
 * highest-risk mapping gets real automated coverage without a component
 * testing library (which §1.1's dependency policy does not allow).
 *
 * ## Why `action.result`, and not the event name the plan says
 *
 * Plan §5.1 and `docs/eve-framework-notes.md` both say `onEvent` "watches for
 * action/tool-result events". **No such event name exists on the eve 0.27.8
 * wire.** `node_modules/eve/dist/src/protocol/message.d.ts` declares exactly
 * two action events: `actions.requested` (the model asked, nothing has run)
 * and `action.result` (one action settled). A handler matching the string
 * `"tool-result"` would silently never fire — a permanently stale left pane
 * with no error anywhere. This is the same class of mismatch Phase 5 hit when
 * the plan's "tool-call/tool-result parts" turned out to be a single
 * `dynamic-tool` part; see `docs/decisions/phase-5-decisions.md`.
 *
 * `actions.requested` is useless here on its own terms too: it fires *before*
 * execution, when nothing durable has changed, so refetching on it would
 * re-read the old rows and then never re-read the new ones.
 *
 * ## Why a hand-authored table
 *
 * `describe-tool-call.ts` derives display wording from a naming heuristic over
 * the tool name. Invalidation deliberately does not reuse it. Display wording
 * degrading gracefully is fine; invalidation silently missing a tool is a pane
 * that quietly lies. An exhaustive table fails **loudly** — a forgotten tool
 * shows up as a visibly stale pane in one browser pass — and
 * `tests/unit/chat/tool-invalidation.test.ts` walks `agent/tools/` off disk so
 * a tool added in a later phase turns that into a red unit test instead.
 *
 * The family sets mirror the `invalidateQueries` calls the mutation hooks in
 * `lib/queries/*.ts` already make, one for one. They are not re-derived: those
 * sets were designed in Phase 3 and encode real reasons (chiefly that
 * `TaskView` denormalises project name, status name/order and priority onto
 * every task row), and a second independent opinion about the same question is
 * how the two halves drift apart.
 */

import type { HandleMessageStreamEvent } from "eve/client"

/** The four coarse cache families `lib/queries/keys.ts` exposes as `.all`. */
export type QueryFamily = "tasks" | "projects" | "statuses" | "priorities"

/**
 * Every product tool in `agent/tools/`, mapped to the families one successful
 * call can have changed.
 *
 * The five read tools are listed explicitly with an empty set rather than
 * omitted: it makes the table self-documenting, and it lets the completeness
 * guard in the unit test be exhaustive rather than approximate.
 */
export const QUERY_FAMILIES_BY_TOOL: Readonly<
  Record<string, readonly QueryFamily[]>
> = {
  // Reads — nothing changed, so nothing is refetched. This is the half the
  // fetch-storm check in `tests/e2e/07-live-sync.test.ts` proves: a read-only
  // turn must produce no `/api/` burst at all.
  list_tasks: [],
  list_projects: [],
  list_statuses: [],
  list_priorities: [],
  get_task: [],

  // Tasks.
  create_task: ["tasks"],
  update_task: ["tasks"],
  delete_task: ["tasks"],
  bulk_update_tasks: ["tasks"],
  bulk_delete_tasks: ["tasks"],

  // Projects. `TaskView` denormalises the project name onto every task row, so
  // a rename has to reach the task list too — which is why `useProjects`'
  // mutations invalidate both.
  create_project: ["projects", "tasks"],
  rename_project: ["projects", "tasks"],
  // A project delete cascades through its statuses and priorities, and the
  // pane may still be filtered by the project that just went away.
  delete_project: ["projects", "tasks", "statuses", "priorities"],

  // Statuses. Same denormalisation: the status name *and* its order live on
  // every task row the list sorts and renders.
  create_status: ["statuses", "tasks"],
  update_status: ["statuses", "tasks"],
  delete_status: ["statuses", "tasks"],

  // Priorities. Same again.
  create_priority: ["priorities", "tasks"],
  update_priority: ["priorities", "tasks"],
  delete_priority: ["priorities", "tasks"],
}

const NOTHING: readonly QueryFamily[] = []

/**
 * `true` when a tool output is **this repo's own** failure envelope.
 *
 * `agent/lib/tool-result.ts` is ours, not eve's: every product tool returns
 * `{ ok: true, data }` or `{ ok: false, kind, message }` through `runAction`.
 * Reading that shape is reading our own contract, not guessing at the interior
 * of an eve-owned `JsonValue`. A blocked rule or a not-found id changed no
 * rows, so refetching four families for it is pure waste.
 *
 * Only an **explicit** `ok === false` counts. An output with no `ok` key is not
 * ours to interpret, and the safe default there is to invalidate: a needless
 * refetch is cheap, a missed one is a stale pane.
 */
export function isFailedToolOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output) &&
    (output as { ok?: unknown }).ok === false
  )
}

/**
 * The families to invalidate for one stream event — usually none.
 *
 * An empty array is the overwhelmingly common answer: every `message.appended`
 * delta, every `actions.requested`, every read tool and every failed call all
 * land there. Invalidation fires only for a **settled successful write**:
 *
 * - `type === "action.result"` — the action ran to a conclusion.
 * - `data.status === "completed"` — not `"failed"`, and not `"rejected"`,
 *   which is eve's marker for a call denied at an approval gate. A denied
 *   delete never touched the database, and refetching for it would be the one
 *   thing that could make a denial *look* like it did something.
 * - `data.result.kind === "tool-result"` — not a `subagent-result` or a
 *   `load-skill-result`, neither of which writes product data.
 * - `data.result.isError !== true`, and the output is not our `ok: false`
 *   envelope.
 *
 * Total, like `describe-tool-call.ts`: never throws for any input, including a
 * malformed event or a hallucinated tool name. It runs on a live stream
 * underneath the chat pane, where a throw would take the transcript with it.
 */
export function queryFamiliesForEvent(
  event: HandleMessageStreamEvent
): readonly QueryFamily[] {
  if (!event || typeof event !== "object") return NOTHING
  if (event.type !== "action.result") return NOTHING

  const data = event.data as Partial<
    Extract<HandleMessageStreamEvent, { type: "action.result" }>["data"]
  > | null

  if (!data || data.status !== "completed") return NOTHING

  const result = data.result
  if (!result || result.kind !== "tool-result") return NOTHING
  if (result.isError === true) return NOTHING
  if (isFailedToolOutput(result.output)) return NOTHING

  return QUERY_FAMILIES_BY_TOOL[result.toolName] ?? NOTHING
}
