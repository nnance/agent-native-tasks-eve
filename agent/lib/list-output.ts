/**
 * `toModelOutput` trimming for the tools whose result is array-shaped
 * (implementation plan §2.4: "trims large list results — counts + compact rows
 * to the model, full rows to the channel").
 *
 * The plan's rationale is about result shape rather than name prefix, so this
 * is applied to all six array-returning tools, including `bulk_update_tasks`
 * and `bulk_delete_tasks` — a bulk update over an arbitrarily long id list has
 * exactly the same token problem as `list_tasks`, with exactly the same fix.
 *
 * What is left here is only the EVE-shaped half. The projection itself is
 * `compactPayload` in `lib/compact.ts`, shared with the MCP interface (§2.8) so
 * that "what the model sees from a list tool" has exactly one definition and
 * the two agents cannot be shown different data.
 */

import type { ToolModelOutput } from "eve/tools"

import { compactPayload } from "../../lib/compact.ts"
import type { ToolResult } from "../../lib/tool-result.ts"

/**
 * Builds a `toModelOutput` for a tool whose `execute` returns
 * `ToolResult<T[]>`. Channel event handlers still receive the full rows on
 * `action.result`; only the model sees the projection.
 */
export function compactList<T, R>(
  toRow: (row: T) => R
): (output: ToolResult<T[]>) => ToolModelOutput {
  return (output) => ({ type: "json", value: compactPayload(output, toRow) })
}
