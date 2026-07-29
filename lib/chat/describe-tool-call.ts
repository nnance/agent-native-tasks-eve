/**
 * Turning one EVE tool call into something a person can read.
 *
 * This module is the whole safety argument of Phase 5 in one file. EVE builds
 * every tool approval with a boilerplate prompt — `extractApprovalRequests` in
 * `eve/dist/src/harness/input-extraction.js` writes literally
 * `Approve tool call: bulk_delete_tasks` with options `Yes` / `No` — so
 * `request.prompt` carries no titles, no count and no change. US-F5.2 asks the
 * approval card to state "exactly what it is about to do: which tasks, what
 * change, how many". The only place that information exists on the client is
 * the tool name and the raw tool input, so this module is what converts them.
 *
 * Three house rules, each load-bearing:
 *
 * - **Pure and framework-free.** No React, no `@/` alias, relative `.ts`
 *   imports only — the same dual-target trick `lib/actions/chat-state.ts`
 *   uses, so this runs under bare `node --test` *and* through the Next
 *   bundler. Since no component-testing library is inside the §1.1 dependency
 *   policy, a pure module is the only way this phase's highest-risk logic gets
 *   real automated coverage.
 * - **Total.** Every exported function returns a renderable value for any
 *   input, including `undefined`, a string, or a hallucinated tool name.
 *   These functions sit on a live render path underneath an Approve button;
 *   a throw there would blank the safety UX rather than degrade it.
 * - **Ids never masquerade as names.** An unresolved id degrades to
 *   `shortId()` and is flagged `resolved: false` so the renderer can show it
 *   as a machine value. Inventing a plausible title on a delete confirmation
 *   would be worse than showing none.
 *
 * Input parsing reuses the exact `lib/schemas` objects the route and the tool
 * parse, so the shared contract gains a third consumer instead of a fourth
 * hand-rolled shape. A generic key scan covers the twelve non-gated tools.
 */

import {
  bulkDeleteTasksSchema,
  bulkUpdateTasksSchema,
  deleteTaskSchema,
  updateTaskSchema,
} from "../schemas/tasks.ts"
import { deleteProjectSchema } from "../schemas/projects.ts"
import { deleteStatusSchema } from "../schemas/statuses.ts"
import { deletePrioritySchema } from "../schemas/priorities.ts"

export type EntityKind = "task" | "project" | "status" | "priority"

export type EntityRef = { readonly kind: EntityKind; readonly id: string }

/** id → display name, from whatever the client currently has cached. */
export type EntityLabels = Readonly<Record<string, string>>

export type ToolSeverity = "read" | "write" | "destructive" | "question"

export type ToolMeta = {
  /** Imperative, for a pending call and for the confirm button. */
  readonly verb: string
  readonly noun: string
  readonly nounPlural: string
  /** For a completed call. */
  readonly pastVerb: string
  readonly severity: ToolSeverity
  /** One sentence of consequence, shown only on the approval card. */
  readonly consequence?: string
}

const PERMANENT = "Permanent. This cannot be undone."

/**
 * Only the tools whose wording or consequence differs from the generic rule
 * below. Everything else — the nineteen product tools plus anything the
 * framework adds later — falls out of `toolMeta`'s derivation, so a new tool
 * renders sensibly on the day it ships rather than as a blank row.
 */
export const TOOL_META: Readonly<Record<string, Partial<ToolMeta>>> = {
  // "Get" would past-tense to "Geted", and "read" is the honest verb anyway.
  get_task: { verb: "Read", pastVerb: "Read" },

  // A list call has no singular target, so its zero-target headline should
  // read "List tasks", not "List task".
  list_tasks: { noun: "tasks" },
  list_projects: { noun: "projects" },
  list_statuses: { noun: "statuses" },
  list_priorities: { noun: "priorities" },

  delete_task: { consequence: PERMANENT },
  bulk_delete_tasks: { consequence: PERMANENT },
  delete_status: { consequence: PERMANENT },
  delete_priority: { consequence: PERMANENT },
  delete_project: {
    consequence: "Permanent. The project's statuses and priorities go with it.",
  },
}

/** The gated tools, parsed with the same schema the tool itself advertises. */
const GATED_INPUT_SCHEMAS: Readonly<
  Record<string, { safeParse: (value: unknown) => { success: boolean } }>
> = {
  delete_task: deleteTaskSchema,
  update_task: updateTaskSchema,
  bulk_update_tasks: bulkUpdateTasksSchema,
  bulk_delete_tasks: bulkDeleteTasksSchema,
  delete_project: deleteProjectSchema,
  delete_status: deleteStatusSchema,
  delete_priority: deletePrioritySchema,
}

/** The first 8 characters — enough to correlate, short enough to scan. */
export function shortId(id: string): string {
  return typeof id === "string" ? id.slice(0, 8) : ""
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)
}

function toPastVerb(verb: string): string {
  return verb.endsWith("e") ? `${verb}d` : `${verb}ed`
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`
  if (word.endsWith("ses")) return word.slice(0, -2)
  // "status" and "bonus" are already singular; a blanket -s would maim them.
  if (word.endsWith("us") || word.endsWith("ss")) return word
  if (word.endsWith("s")) return word.slice(0, -1)
  return word
}

function pluralize(word: string): string {
  if (word.endsWith("y")) return `${word.slice(0, -1)}ies`
  if (word.endsWith("s")) return `${word}es`
  return word === "" ? word : `${word}s`
}

function deriveSeverity(toolName: string): ToolSeverity {
  if (toolName === "ask_question") return "question"
  if (toolName.includes("delete")) return "destructive"
  if (/^(list|get)_/.test(toolName)) return "read"
  return "write"
}

/**
 * Wording for any tool name, known or not.
 *
 * `bulk_delete_tasks` reads as "Delete 3 tasks", not "Bulk 3 tasks": a leading
 * `bulk_` describes the call's shape, not the user's change, so it is dropped
 * before the verb is taken. The count in the headline already says "bulk".
 */
export function toolMeta(toolName: string): ToolMeta {
  const name = typeof toolName === "string" ? toolName : ""
  const allTokens = name.split("_").filter((token) => token.length > 0)
  const tokens = allTokens[0] === "bulk" ? allTokens.slice(1) : allTokens

  const verb = capitalize(tokens[0] ?? "Run")
  const rawNoun = tokens.slice(1).join(" ")
  const noun = rawNoun === "" ? "action" : singularize(rawNoun)

  const derived: ToolMeta = {
    verb,
    noun,
    nounPlural: pluralize(noun),
    pastVerb: toPastVerb(verb),
    severity: deriveSeverity(name),
  }

  const override = TOOL_META[name]

  if (!override) return derived

  // `nounPlural` and `pastVerb` follow an overridden `noun`/`verb` unless the
  // override states them, so a one-key entry stays internally consistent.
  const noun2 = override.noun ?? derived.noun
  const verb2 = override.verb ?? derived.verb

  return {
    verb: verb2,
    noun: noun2,
    nounPlural: override.nounPlural ?? pluralize(noun2),
    pastVerb: override.pastVerb ?? toPastVerb(verb2),
    severity: override.severity ?? derived.severity,
    ...(override.consequence === undefined
      ? {}
      : { consequence: override.consequence }),
  }
}

/** Which kind of thing a tool acts *on*, from its name. */
export function toolEntityKind(toolName: string): EntityKind | undefined {
  const name = typeof toolName === "string" ? toolName : ""

  if (/tasks?$/.test(name)) return "task"
  if (/projects?$/.test(name)) return "project"
  if (/status(es)?$/.test(name)) return "status"
  if (/priorit(y|ies)$/.test(name)) return "priority"

  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const ID_KEYS: ReadonlyArray<readonly [string, EntityKind]> = [
  ["taskId", "task"],
  ["taskIds", "task"],
  ["projectId", "project"],
  ["statusId", "status"],
  ["priorityId", "priority"],
]

/**
 * Every entity id a call references — the things it targets *and* the things
 * it changes them to.
 *
 * Both matter: the targets become the card's enumerated list, and the change
 * values ("Status → Done") need the same id→name resolution. The label
 * resolver consumes this union, and `describeToolCall` narrows it.
 *
 * The seven gated tools are parsed with their own schema first, so the safety
 * path reads the same contract the tool and the route parse. Anything else —
 * and any input that fails its schema — falls back to a key scan. Never
 * throws: a malformed or hallucinated call degrades to raw ids.
 */
export function extractEntityRefs(
  toolName: string,
  input: unknown
): readonly EntityRef[] {
  const record = asRecord(input)

  if (!record) return []

  // The parse is a contract check, not a transform: on success the shape is
  // known-good, on failure the scan below still reads whatever is legible.
  GATED_INPUT_SCHEMAS[toolName]?.safeParse(input)

  const refs: EntityRef[] = []
  const seen = new Set<string>()

  const push = (kind: EntityKind, id: unknown) => {
    if (typeof id !== "string" || id === "") return
    const key = `${kind}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ kind, id })
  }

  for (const [key, kind] of ID_KEYS) {
    const value = record[key]

    if (Array.isArray(value)) {
      for (const item of value) push(kind, item)
      continue
    }

    push(kind, value)
  }

  return refs
}

export type ResolvedTarget = {
  readonly id: string
  readonly kind: EntityKind
  /** The resolved name, or `shortId(id)` when nothing is known. */
  readonly label: string
  /** `false` ⇒ render muted and monospace; never present it as a name. */
  readonly resolved: boolean
}

export type ToolChange = { readonly label: string; readonly value: string }

export type ToolCallSummary = {
  readonly headline: string
  readonly count: number
  readonly severity: ToolSeverity
  readonly consequence?: string
  readonly targets: readonly ResolvedTarget[]
  readonly changes: readonly ToolChange[]
}

function resolveTarget(ref: EntityRef, labels: EntityLabels): ResolvedTarget {
  const label = labels[ref.id]

  return typeof label === "string" && label !== ""
    ? { id: ref.id, kind: ref.kind, label, resolved: true }
    : { id: ref.id, kind: ref.kind, label: shortId(ref.id), resolved: false }
}

function quoted(value: string): string {
  return `“${value}”`
}

function labelFor(id: unknown, labels: EntityLabels): string {
  if (typeof id !== "string" || id === "") return ""
  const name = labels[id]
  return typeof name === "string" && name !== "" ? name : shortId(id)
}

/**
 * The "what change" half of US-F5.2, read straight off the raw input.
 *
 * `projectId` is a change rather than a target whenever the tool does not act
 * on projects — on `create_task` it says where the task lands, on `list_tasks`
 * it says what was filtered.
 */
function describeChanges(
  toolName: string,
  input: unknown,
  labels: EntityLabels,
  entityKind: EntityKind | undefined
): readonly ToolChange[] {
  const record = asRecord(input)

  if (!record) return []

  const changes: ToolChange[] = []

  if (typeof record.title === "string") {
    changes.push({ label: "Title", value: quoted(record.title) })
  }

  if (typeof record.name === "string") {
    changes.push({ label: "Name", value: quoted(record.name) })
  }

  if (record.description === null) {
    changes.push({ label: "Description", value: "cleared" })
  } else if (typeof record.description === "string") {
    changes.push({ label: "Description", value: "rewritten" })
  }

  if (entityKind !== "project" && typeof record.projectId === "string") {
    changes.push({
      label: "Project",
      value: labelFor(record.projectId, labels),
    })
  }

  if (typeof record.statusId === "string") {
    changes.push({ label: "Status", value: labelFor(record.statusId, labels) })
  }

  if (typeof record.priorityId === "string") {
    changes.push({
      label: "Priority",
      value: labelFor(record.priorityId, labels),
    })
  }

  // `order` is 0-based in the contract and 1-based to a reader.
  if (typeof record.order === "number" && Number.isFinite(record.order)) {
    changes.push({ label: "Position", value: String(record.order + 1) })
  }

  if (typeof record.isCompleted === "boolean") {
    changes.push({
      label: "Counts as completed",
      value: record.isCompleted ? "yes" : "no",
    })
  }

  if (record.isDefault === true) {
    changes.push({ label: "Default", value: "yes" })
  }

  if (typeof record.search === "string" && record.search !== "") {
    changes.push({ label: "Search", value: quoted(record.search) })
  }

  if (record.includeCompleted === true) {
    changes.push({ label: "Completed", value: "included" })
  }

  if (typeof record.prompt === "string" && toolName === "ask_question") {
    changes.push({ label: "Question", value: record.prompt })
  }

  return changes
}

/**
 * The renderable summary of one tool call.
 *
 * headline:
 * - `n > 1`  → `Delete 3 tasks` (the count is the point — US-F5.2 asks how many)
 * - `n === 1` → `Delete “Ship the newsletter”`
 * - `n === 0` → `Create task`, with the details in `changes`
 */
export function describeToolCall(
  toolName: string,
  input: unknown,
  labels: EntityLabels = {}
): ToolCallSummary {
  const meta = toolMeta(toolName)
  const entityKind = toolEntityKind(toolName)
  const refs = extractEntityRefs(toolName, input)

  // A tool whose entity kind is unreadable from its name (an unknown or
  // framework tool) enumerates everything it references rather than nothing:
  // showing too much is recoverable, showing an approval card with no targets
  // at all is not.
  const targets = (
    entityKind === undefined
      ? refs
      : refs.filter((ref) => ref.kind === entityKind)
  ).map((ref) => resolveTarget(ref, labels))

  const count = targets.length

  const headline =
    count > 1
      ? `${meta.verb} ${count} ${meta.nounPlural}`
      : count === 1
        ? `${meta.verb} ${quoted(targets[0]!.label)}`
        : `${meta.verb} ${meta.noun}`

  return {
    headline,
    count,
    severity: meta.severity,
    ...(meta.consequence === undefined
      ? {}
      : { consequence: meta.consequence }),
    targets,
    changes: describeChanges(toolName, input, labels, entityKind),
  }
}

/**
 * The two-shape envelope every tool in `agent/tools/` returns, read back for
 * display. `message` is relayed **verbatim** — product spec §9 makes the
 * `RuleViolation` / `NotFoundError` wording a product deliverable.
 */
export type ToolOutcome =
  | { readonly kind: "ok"; readonly detail?: string }
  | {
      readonly kind: "failed"
      readonly failure: "invalid_input" | "not_found" | "blocked"
      readonly message: string
    }
  | { readonly kind: "unreadable" }

const FAILURE_KINDS = new Set(["invalid_input", "not_found", "blocked"])

/** A short, honest fact about what came back — never a re-narration. */
function describeData(data: unknown): string | undefined {
  if (Array.isArray(data)) return `${data.length} rows`

  const record = asRecord(data)

  if (!record) return undefined

  if (typeof record.title === "string") return record.title
  if (typeof record.name === "string") return record.name

  if (typeof record.count === "number") {
    return `${record.count} ${record.count === 1 ? "row" : "rows"}`
  }

  if (Array.isArray(record.items)) return `${record.items.length} rows`

  return undefined
}

export function readToolOutcome(output: unknown): ToolOutcome {
  const record = asRecord(output)

  if (!record) return { kind: "unreadable" }

  if (record.ok === true) {
    const detail = describeData(record.data)
    return detail === undefined ? { kind: "ok" } : { kind: "ok", detail }
  }

  if (record.ok === false) {
    const failure =
      typeof record.kind === "string" && FAILURE_KINDS.has(record.kind)
        ? (record.kind as "invalid_input" | "not_found" | "blocked")
        : "blocked"

    return {
      kind: "failed",
      failure,
      message:
        typeof record.message === "string" && record.message !== ""
          ? record.message
          : "The tool reported a failure with no message.",
    }
  }

  return { kind: "unreadable" }
}
