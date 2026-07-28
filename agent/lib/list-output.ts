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
 * Failures pass through untouched: they are already small, and `kind` plus
 * `message` are precisely what the model has to relay to the user.
 */

import type { ToolModelOutput } from "eve/tools"

import type { ToolResult } from "./tool-result.ts"

/**
 * Builds a `toModelOutput` for a tool whose `execute` returns
 * `ToolResult<T[]>`. Channel event handlers still receive the full rows on
 * `action.result`; only the model sees the projection.
 */
export function compactList<T, R>(
  toRow: (row: T) => R
): (output: ToolResult<T[]>) => ToolModelOutput {
  return (output) =>
    output.ok
      ? {
          type: "json",
          value: {
            ok: true,
            count: output.data.length,
            items: output.data.map(toRow),
          },
        }
      : { type: "json", value: output }
}
