/**
 * `update_task` — implementation plan §2.4. The agent's front door onto
 * `updateTask` (US-F3.2), which also serves "move this task to Done".
 *
 * The description names the project-immutability rule (product spec §7 rule 1)
 * even though the schema already makes a project change inexpressible: the
 * model has to be able to explain the refusal to the user (US-F3.4) rather
 * than silently failing to find a field.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { updateTask } from "../../lib/actions/index.ts"
import { updateTaskSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Edit one task's title, description, status and/or priority. This is also " +
    "how a task moves between statuses. Supply at least one field beyond " +
    "taskId; pass description as null to clear it. The new status or priority " +
    "must belong to the task's own project. A task's project cannot be " +
    "changed and there is no field for it. When more than one task is " +
    "affected, use bulk_update_tasks instead of calling this repeatedly.",
  inputSchema: updateTaskSchema,
  approval: never(),
  execute: (input) => runAction(() => updateTask(input)),
})
