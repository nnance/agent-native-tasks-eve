/**
 * `update_task` — implementation plan §2.4. The agent's front door onto
 * `updateTask` (US-F3.2), which also serves "move this task to Done".
 *
 * The description names the project-immutability rule (product spec §7 rule 1)
 * even though the schema already makes a project change inexpressible: the
 * model has to be able to explain the refusal to the user (US-F3.4) rather
 * than silently failing to find a field.
 *
 * Approval is the one policy in the §2.4 table that is not a bare `never()` /
 * `always()`. A single-task edit is explicitly non-destructive (§6) and must
 * run without a prompt; a *second* task edited in the same turn is a bulk
 * change and must not. `afterFirstTaskInTurn` is that distinction, and the
 * reasoning for holding it in the framework rather than in `instructions.md`
 * lives in `agent/lib/bulk-edit-gate.ts`.
 */

import { defineTool } from "eve/tools"

import { updateTask } from "../../lib/actions/index.ts"
import { updateTaskSchema } from "../../lib/schemas/index.ts"
import { afterFirstTaskInTurn } from "../lib/bulk-edit-gate.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Edit one task's title, description, status and/or priority. This is also " +
    "how a task moves between statuses. Supply at least one field beyond " +
    "taskId; pass description as null to clear it. The new status or priority " +
    "must belong to the task's own project. A task's project cannot be " +
    "changed and there is no field for it. When more than one task is " +
    "affected, use bulk_update_tasks instead of calling this repeatedly: the " +
    "first task you edit in a turn runs immediately, but editing a second " +
    "task with this tool pauses for the user's approval one task at a time.",
  inputSchema: updateTaskSchema,
  approval: afterFirstTaskInTurn,
  execute: (input) => runAction(() => updateTask(input)),
})
