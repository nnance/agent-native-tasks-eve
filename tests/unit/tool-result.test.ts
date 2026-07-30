/**
 * The tool layer's error vocabulary and JSON boundary, tested without a
 * database: `runAction` takes a thunk, so every branch is reachable by
 * throwing the real error classes the shared actions throw.
 *
 * Sits at the root of tests/unit/ because its subject sits at the root of
 * lib/: the module was `agent/lib/tool-result.ts` until the MCP interface
 * needed it verbatim, and it moved rather than being imported across from a
 * sibling interface.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { runAction, toJsonSafe } from "../../lib/tool-result.ts"
import { NotFoundError, RuleViolation } from "../../lib/domain/errors.ts"
import { updateTaskSchema } from "../../lib/schemas/tasks.ts"

describe("toJsonSafe", () => {
  it("rewrites Date to an ISO string at every depth", () => {
    const when = new Date("2026-07-28T12:34:56.000Z")

    assert.equal(toJsonSafe(when), "2026-07-28T12:34:56.000Z")
    assert.deepEqual(toJsonSafe({ createdAt: when }), {
      createdAt: "2026-07-28T12:34:56.000Z",
    })
    assert.deepEqual(toJsonSafe({ nested: { at: when } }), {
      nested: { at: "2026-07-28T12:34:56.000Z" },
    })
    assert.deepEqual(toJsonSafe([{ at: when }]), [
      { at: "2026-07-28T12:34:56.000Z" },
    ])
  })

  it("passes primitives and null through unchanged", () => {
    assert.equal(toJsonSafe(null), null)
    assert.equal(toJsonSafe("hello"), "hello")
    assert.equal(toJsonSafe(false), false)
    assert.equal(toJsonSafe(0), 0)
    assert.deepEqual(toJsonSafe({ description: null }), { description: null })
  })

  it("drops undefined properties, as JSON.stringify does", () => {
    const converted = toJsonSafe({ id: "a", description: undefined })

    assert.deepEqual(converted, { id: "a" })
    assert.equal("description" in converted, false)
  })

  it("throws with the path when a value cannot survive JSON", () => {
    assert.throws(
      () => toJsonSafe({ rows: [{ score: Number.NaN }] }),
      /\$\.rows\[0\]\.score/
    )
    // `BigInt(1)` rather than a `1n` literal: tsconfig targets ES2017.
    assert.throws(() => toJsonSafe({ id: BigInt(1) }), /\$\.id: bigint/)
    assert.throws(() => toJsonSafe({ seen: new Set([1]) }), /\$\.seen: object/)
    assert.throws(() => toJsonSafe({ run: () => 1 }), /\$\.run: function/)
  })
})

describe("runAction", () => {
  it("wraps a success in { ok: true } with Dates converted", async () => {
    const result = await runAction(async () => ({
      id: "task-1",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
    }))

    assert.deepEqual(result, {
      ok: true,
      data: { id: "task-1", createdAt: "2026-07-28T00:00:00.000Z" },
    })
  })

  it("maps NotFoundError to not_found, message verbatim", async () => {
    const message = "No task with id 3f1b."
    const result = await runAction(async () => {
      throw new NotFoundError(message)
    })

    assert.deepEqual(result, { ok: false, kind: "not_found", message })
  })

  it("maps RuleViolation to blocked, message verbatim", async () => {
    // The verbatim relay is a product requirement (spec §9, US-F3.4), not a
    // stylistic choice: the action wrote the sentence the user must read.
    const message =
      "Status 'In Progress' is still used by 2 tasks. Move them first."
    const result = await runAction(async () => {
      throw new RuleViolation(message)
    })

    assert.deepEqual(result, { ok: false, kind: "blocked", message })
  })

  it("maps a real ZodError to invalid_input with a legible message", async () => {
    // Exactly the shape the model can emit and the JSON Schema cannot forbid:
    // an update patch with an id and no fields to change.
    const result = await runAction(async () =>
      updateTaskSchema.parse({ taskId: crypto.randomUUID() })
    )

    if (result.ok) assert.fail("Expected the empty patch to be rejected.")

    assert.equal(result.kind, "invalid_input")
    assert.match(result.message, /at least one of title, description/)
  })

  it("rethrows an unrecognized error rather than reporting a refusal", async () => {
    const boom = new Error("connection terminated unexpectedly")

    await assert.rejects(
      runAction(async () => {
        throw boom
      }),
      (error: unknown) => error === boom
    )
  })
})
