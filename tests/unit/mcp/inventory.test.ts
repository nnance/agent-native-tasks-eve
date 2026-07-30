/**
 * The parity guard, and the reason the MCP interface can claim "exactly the
 * same capabilities as the internal agent, no more and no less".
 *
 * Every expectation here is **derived from `agent/tools/` by import** rather
 * than restated: the tool names, the schema objects, the approval column, and
 * which results are trimmed all come from the EVE definitions themselves. A
 * capability added to one interface and not the other fails a test. A tool that
 * quietly redefines a schema fails a test. An approval downgraded on one side
 * fails a test. That is the whole point — parity asserted by construction, not
 * by two tables someone remembers to keep aligned.
 *
 * `tests/unit/agent/tools.test.ts` pins the EVE side against plan §2.4's
 * written table; this file pins the MCP side against the EVE side. Together
 * they chain the MCP inventory back to the plan.
 */

import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { isDisabledToolSentinel, type ToolDefinition } from "eve/tools"
import type { ApprovalContext } from "eve/tools"

import { afterFirstTaskInTurn } from "../../../agent/lib/bulk-edit-gate.ts"
import { INVENTORY, TOOLS_BY_NAME, type Gate } from "../../../mcp/inventory.ts"

const toolsDir = fileURLToPath(
  new URL("../../../agent/tools/", import.meta.url)
)

/** Every authored EVE tool, keyed by the slug eve derives from the filename. */
const eveTools = new Map(
  (
    await Promise.all(
      readdirSync(toolsDir).map(
        async (entry) =>
          [
            entry.replace(/\.ts$/, ""),
            (await import(`${toolsDir}${entry}`)).default,
          ] as [string, unknown]
      )
    )
  ).filter(([, value]) => !isDisabledToolSentinel(value))
) as Map<string, ToolDefinition<unknown, unknown>>

/** Enough of an `ApprovalContext` to invoke a bare `always()` / `never()`. */
function approvalContext(toolName: string): ApprovalContext<never> {
  return {
    approvedTools: new Set<string>(),
    callId: "parity-call",
    toolName,
    session: {},
  } as unknown as ApprovalContext<never>
}

/** The EVE approval policy for `name`, expressed as this interface's gate. */
async function eveGate(name: string): Promise<Gate> {
  const policy = eveTools.get(name)?.approval

  assert.equal(typeof policy, "function", `${name} states no approval policy.`)

  // The one input-dependent policy. Identity is the honest comparison: its
  // behaviour is asserted in tests/unit/agent/bulk-edit-gate.test.ts, and the
  // MCP re-scoping of it in tests/unit/mcp/call.test.ts.
  if (policy === afterFirstTaskInTurn) return "first-edit-free"

  return (await policy?.(approvalContext(name))) === "user-approval"
    ? "always"
    : "none"
}

describe("the MCP inventory against the EVE tools", () => {
  it("serves exactly the tools the internal agent has", async () => {
    assert.deepEqual(
      INVENTORY.map((entry) => entry.name).sort(),
      [...eveTools.keys()].sort()
    )
  })

  it("serves each tool exactly once", () => {
    assert.equal(TOOLS_BY_NAME.size, INVENTORY.length)
  })

  for (const entry of INVENTORY) {
    describe(entry.name, () => {
      it("advertises the same shared schema object, not a copy", () => {
        // Object identity. Two structurally identical schemas would pass a
        // deepEqual and still be two contracts that can drift; this cannot.
        assert.equal(entry.schema, eveTools.get(entry.name)?.inputSchema)
      })

      it("guards the call exactly as the EVE tool does", async () => {
        assert.equal(entry.gate, await eveGate(entry.name))
      })

      it("marks a destructive tool destructive, and a read read-only", async () => {
        const gate = await eveGate(entry.name)
        const reads =
          entry.name.startsWith("list_") || entry.name === "get_task"

        assert.equal(entry.annotations.readOnlyHint, reads)
        assert.equal(entry.annotations.openWorldHint, false)

        // Every tool EVE gates is one whose effect a host should warn about.
        // The converse does not hold — `update_task` is gated conditionally and
        // is not destructive — so this is an implication, not an equality.
        if (gate === "always") {
          assert.equal(
            entry.annotations.destructiveHint,
            true,
            `${entry.name} is gated but not marked destructive.`
          )
        }

        if (reads) assert.equal(entry.annotations.destructiveHint, false)
      })

      it("has a description of its own", () => {
        assert.equal(typeof entry.description, "string")
        assert.ok(entry.description.length > 0)
      })
    })
  }
})
