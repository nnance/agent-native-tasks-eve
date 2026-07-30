/**
 * `update_status` — implementation plan §2.4. The agent's front door onto
 * `updateStatus` (US-F4.2). One consolidated update per entity, so `order`
 * doubles as the reorder capability.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { updateStatus } from "../../lib/actions/index.ts"
import { updateStatusSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Rename a status, move it to a new position, or change whether it counts " +
    "as completed. Supply at least one field beyond statusId. `order` is the " +
    "0-based target position within the project's list, so 0 moves the " +
    "status to the front; the other statuses renumber around it.",
  inputSchema: updateStatusSchema,
  approval: never(),
  execute: (input) => runAction(() => updateStatus(input)),
})
