/**
 * `delete_task` — implementation plan §2.4. The agent's front door onto
 * `deleteTask` (US-F3.3), gated on the user's approval.
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { deleteTask } from "../../lib/actions/index.ts"
import { deleteTaskSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Delete one task permanently. This pauses for the user's approval before " +
    "it runs — name the task by title in your message first, and pass the " +
    "task id you actually read from list_tasks. To delete several tasks, use " +
    "bulk_delete_tasks instead so the user sees one accurate prompt.",
  inputSchema: deleteTaskSchema,
  approval: always(),
  execute: (input) => runAction(() => deleteTask(input)),
})
