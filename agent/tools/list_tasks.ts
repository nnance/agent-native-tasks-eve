/**
 * `list_tasks` — implementation plan §2.4. The agent's front door onto
 * `listTasks` (US-F2.1, US-F2.2): the tool that makes a grounded answer
 * possible, since every filter the UI offers is expressible here.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { listTasks } from "../../lib/actions/index.ts"
import { listTasksSchema } from "../../lib/schemas/index.ts"
import { compactTask } from "../../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "List tasks, optionally filtered by project, status, priority, and a " +
    "case-insensitive text search over titles and descriptions. Every filter " +
    "combines. Completed tasks are hidden unless includeCompleted is true or " +
    "you filter to a completed status explicitly. Results come back in the " +
    "same order the user's list shows them: open before completed, then " +
    "highest priority first, then oldest first. Rows are compact and carry no " +
    "description — call get_task when you need a task's full text.",
  inputSchema: listTasksSchema,
  approval: never(),
  execute: (input) => runAction(() => listTasks(input)),
  toModelOutput: compactList(compactTask),
})
