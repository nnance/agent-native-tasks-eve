/**
 * The model-facing error vocabulary and the one JSON-serialization boundary
 * for every tool an agent can call — `agent/tools/` over EVE (implementation
 * plan §2.4) and `mcp/` over MCP (§2.8).
 *
 * Authored in Phase 4 as `agent/lib/tool-result.ts` and hoisted here when the
 * MCP interface landed, on the same reasoning `lib/serialized.ts` records: two
 * front doors need it, so it belongs to neither. An MCP server importing an EVE
 * agent's internals would make the dependency graph claim a relationship that
 * does not exist — there are three peer interfaces over one action layer, not a
 * chain of them.
 *
 * `lib/api/respond.ts` is the same idea for the HTTP front door, and its own
 * doc comment says outright that the agent-facing tools need their own,
 * differently worded mapping of the same two action-layer errors — "the model
 * for it, not a shared dependency of it". This module is that mapping. It keeps
 * `errorResponse`'s asymmetry: distinguish the two known failure kinds, relay
 * their messages verbatim (product spec §9, US-F3.4), and rethrow anything
 * unrecognized rather than flattening a genuine defect into a plausible answer
 * the model would then report as a considered refusal.
 *
 * It also carries the JSON conversion. `eve/docs/tools/overview.mdx` requires
 * tool output to be JSON-serializable and names `Date` as the author's job;
 * `TaskView`, `Project`, `Status` and `Priority` all carry live `Date`
 * columns. Doing it once here beats nineteen ad hoc conversions, and doing it
 * explicitly rather than via `JSON.parse(JSON.stringify(x))` means the return
 * type tells the truth about `createdAt` being a string and a value JSON would
 * silently mangle fails loudly instead.
 */

import { ZodError } from "zod"

import { NotFoundError, RuleViolation } from "./domain/errors.ts"
import type { Serialized } from "./serialized.ts"

/**
 * Why a tool call did not produce data, in the model's vocabulary.
 *
 * - `invalid_input` — the arguments were malformed. Recoverable: fix and retry.
 * - `not_found` — nothing exists with that id.
 * - `blocked` — a product spec §7 rule refused the operation. Never retryable;
 *   the message says what to do instead.
 *
 * These three are the kinds an *action* can produce, so they are the ones both
 * agent-facing interfaces share. `mcp/guard.ts` adds two of its own for the
 * outcomes only its approval gate can reach; it does not widen this union.
 */
export type ToolFailureKind = "invalid_input" | "not_found" | "blocked"

/** The failure branch, named so the trimming helpers can pass it through. */
export type ToolFailure = {
  ok: false
  kind: ToolFailureKind
  message: string
}

/**
 * What every tool returns. One shape means `agent/instructions.md` and
 * `mcp/instructions.md` can each teach the model a single rule for reading any
 * tool result, and Phase 5's chat UI has exactly one thing to render.
 */
export type ToolResult<T> = { ok: true; data: T } | ToolFailure

/** Plain objects only: a class instance is not something JSON can carry. */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Recursively rewrites `Date` to an ISO string and rejects anything JSON
 * cannot carry, naming the path so a defect is diagnosable from the message.
 *
 * `undefined` properties are dropped, matching `JSON.stringify` semantics.
 * Cycles are not defended against: the action layer returns flat rows joined
 * one level deep, so a cycle would be a defect this converter should not mask.
 */
export function toJsonSafe<T>(value: T, path = "$"): Serialized<T> {
  if (value === null) return value as Serialized<T>

  if (value instanceof Date) return value.toISOString() as Serialized<T>

  const type = typeof value

  if (type === "string" || type === "boolean") return value as Serialized<T>

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Tool output is not JSON-serializable at ${path}: ${String(value)}.`
      )
    }
    return value as Serialized<T>
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      toJsonSafe(item, `${path}[${index}]`)
    ) as Serialized<T>
  }

  if (type === "object" && isPlainObject(value as object)) {
    const result: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(value as object)) {
      if (item === undefined) continue
      result[key] = toJsonSafe(item, `${path}.${key}`)
    }

    return result as Serialized<T>
  }

  throw new Error(`Tool output is not JSON-serializable at ${path}: ${type}.`)
}

/** Flattens a ZodError into one line the model can act on. */
function describeIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
}

/**
 * Runs one shared action and adapts its outcome to `ToolResult`.
 *
 * | thrown          | result                                            |
 * | --------------- | ------------------------------------------------- |
 * | nothing         | `{ ok: true, data }`, Dates converted             |
 * | `ZodError`      | `{ ok: false, kind: "invalid_input", message }`   |
 * | `NotFoundError` | `{ ok: false, kind: "not_found", message }`       |
 * | `RuleViolation` | `{ ok: false, kind: "blocked", message }`         |
 * | anything else   | rethrown                                          |
 *
 * `ZodError` is caught even though EVE validates `inputSchema` before calling
 * `execute`: every action re-parses internally, and the four refined schemas
 * carry cross-field rules ("provide at least one of…") that a JSON Schema
 * cannot express. A call the model made that satisfies the advertised schema
 * can still fail the refinement inside the action, and a legible correction it
 * can retry beats a failed turn.
 */
export async function runAction<T>(
  run: () => Promise<T>
): Promise<ToolResult<Serialized<T>>> {
  try {
    return { ok: true, data: toJsonSafe(await run()) }
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        kind: "invalid_input",
        message: describeIssues(error),
      }
    }

    if (error instanceof NotFoundError) {
      return { ok: false, kind: "not_found", message: error.message }
    }

    if (error instanceof RuleViolation) {
      return { ok: false, kind: "blocked", message: error.message }
    }

    throw error
  }
}
