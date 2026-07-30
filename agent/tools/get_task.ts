/**
 * `get_task` — implementation plan §2.4. The agent's front door onto `getTask`
 * (US-F2.3): the full record, including the description `list_tasks` trims.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { getTask } from "../../lib/actions/index.ts"
import { getTaskSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Read one task in full, including its description and its project, " +
    "status and priority. Use this after list_tasks when the user asks about " +
    "a task's details.",
  inputSchema: getTaskSchema,
  approval: never(),
  execute: (input) => runAction(() => getTask(input)),
})
