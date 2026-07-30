/**
 * `list_priorities` — implementation plan §2.4. The agent's front door onto
 * `listPriorities` (US-F4.1).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { listPriorities } from "../../lib/actions/index.ts"
import { listPrioritiesSchema } from "../../lib/schemas/index.ts"
import { compactPriority } from "../../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "List the priorities of one project, in their defined order — lowest " +
    "urgency first, so a higher `order` is a more urgent priority. Priorities " +
    "are per-project. Exactly one carries `isDefault`, and that is the one a " +
    "new task takes when none is named.",
  inputSchema: listPrioritiesSchema,
  approval: never(),
  execute: (input) => runAction(() => listPriorities(input)),
  toModelOutput: compactList(compactPriority),
})
