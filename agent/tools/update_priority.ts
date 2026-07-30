/**
 * `update_priority` — implementation plan §2.4. The agent's front door onto
 * `updatePriority` (US-F4.2).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { updatePriority } from "../../lib/actions/index.ts"
import { updatePrioritySchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Rename a priority, move it to a new position, or make it the project's " +
    "default. Supply at least one field beyond priorityId. `order` is the " +
    "0-based target position and a higher position is more urgent. " +
    "`isDefault` can only be set to true: naming a new default moves the " +
    "designation off the old one, and a project always has exactly one.",
  inputSchema: updatePrioritySchema,
  approval: never(),
  execute: (input) => runAction(() => updatePriority(input)),
})
