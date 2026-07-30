/**
 * `bulk_update_tasks` — implementation plan §2.4. The agent's front door onto
 * `bulkUpdateTasks` (US-F5), gated on the user's approval.
 *
 * The approval prompt renders the tool input, and this tool's input is an
 * explicit array of task ids — which is how "state exactly what will change"
 * (US-F5.2) falls out of the architecture instead of depending on the model
 * remembering to describe its plan.
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { bulkUpdateTasks } from "../../lib/actions/index.ts"
import { bulkUpdateTasksSchema } from "../../lib/schemas/index.ts"
import { compactTask } from "../../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Apply one status and/or priority to several tasks at once, atomically — " +
    "all of them succeed or none do. Use this instead of repeated update_task " +
    "calls whenever more than one task changes. Supply a statusId and/or a " +
    "priorityId; every status or priority must belong to the project of every " +
    "task named. Pauses for the user's approval, and the approval prompt " +
    "shows the exact task ids you pass, so list the tasks by title and say " +
    "how many there are in your message before calling.",
  inputSchema: bulkUpdateTasksSchema,
  approval: always(),
  execute: (input) => runAction(() => bulkUpdateTasks(input)),
  toModelOutput: compactList(compactTask),
})
