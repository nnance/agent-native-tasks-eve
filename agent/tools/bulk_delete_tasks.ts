/**
 * `bulk_delete_tasks` — implementation plan §2.4. The agent's front door onto
 * `bulkDeleteTasks` (US-F5), gated on the user's approval.
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { bulkDeleteTasks } from "../../lib/actions/index.ts"
import { bulkDeleteTasksSchema } from "../../lib/schemas/index.ts"
import { compactDeletedTask } from "../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Delete several tasks at once, permanently and atomically — all of them " +
    "are removed or none are. Use this instead of repeated delete_task calls " +
    "whenever more than one task is involved. Pauses for the user's approval, " +
    "and the approval prompt shows the exact task ids you pass, so list the " +
    "tasks by title and say how many there are in your message before calling.",
  inputSchema: bulkDeleteTasksSchema,
  approval: always(),
  execute: (input) => runAction(() => bulkDeleteTasks(input)),
  toModelOutput: compactList(compactDeletedTask),
})
