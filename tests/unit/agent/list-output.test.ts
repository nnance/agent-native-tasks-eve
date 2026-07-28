/**
 * `compactList` is what keeps a long list from being pasted into the model's
 * context in full (implementation plan §2.4), so what it emits — and what it
 * deliberately does not touch — is worth pinning down.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { compactList } from "../../../agent/lib/list-output.ts"
import type { ToolResult } from "../../../agent/lib/tool-result.ts"

type Row = { id: string; title: string; description: string | null }

const toRow = (row: Row) => ({ id: row.id, title: row.title })

describe("compactList", () => {
  it("returns a json ToolModelOutput with a count and projected rows", () => {
    const output: ToolResult<Row[]> = {
      ok: true,
      data: [
        { id: "1", title: "Fix header", description: "a long description" },
        { id: "2", title: "Ship it", description: null },
      ],
    }

    assert.deepEqual(compactList(toRow)(output), {
      type: "json",
      value: {
        ok: true,
        count: 2,
        items: [
          { id: "1", title: "Fix header" },
          { id: "2", title: "Ship it" },
        ],
      },
    })
  })

  it("reports count 0 for an empty list rather than omitting it", () => {
    assert.deepEqual(compactList(toRow)({ ok: true, data: [] }), {
      type: "json",
      value: { ok: true, count: 0, items: [] },
    })
  })

  it("passes a failure envelope through untouched", () => {
    // The model must relay `message` verbatim, so trimming it would be a
    // product regression rather than a token saving.
    const output: ToolResult<Row[]> = {
      ok: false,
      kind: "blocked",
      message: "Project 'Website' still has 3 tasks.",
    }

    assert.deepEqual(compactList(toRow)(output), {
      type: "json",
      value: output,
    })
  })
})
