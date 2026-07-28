/**
 * `list_statuses` — implementation plan §2.4. The agent's front door onto
 * `listStatuses` (US-F4.1).
 *
 * The plan's table groups this row with `list_priorities`, but a tool's
 * identity is its filename, so a grouped row is always two files.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { listStatuses } from "../../lib/actions/index.ts"
import { listStatusesSchema } from "../../lib/schemas/index.ts"
import { compactStatus } from "../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "List the statuses of one project, in their defined order. Statuses are " +
    "per-project, so a status id is only valid for tasks in that same " +
    "project. `isCompleted` marks the statuses that count a task as finished.",
  inputSchema: listStatusesSchema,
  approval: never(),
  execute: (input) => runAction(() => listStatuses(input)),
  toModelOutput: compactList(compactStatus),
})
