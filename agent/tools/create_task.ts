/**
 * `create_task` — implementation plan §2.4. The agent's front door onto
 * `createTask` (US-F3.1).
 *
 * The defaulting behavior is stated in the description because it is what
 * stops the model asking the user to fill in fields the product already
 * decides for them (§4.4).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { createTask } from "../../lib/actions/index.ts"
import { createTaskSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Create a task in a project. An omitted statusId takes the project's " +
    "first status and an omitted priorityId takes the project's default " +
    "priority, so do not ask the user for either unless they raised it. A " +
    "status or priority must belong to the same project as the task.",
  inputSchema: createTaskSchema,
  approval: never(),
  execute: (input) => runAction(() => createTask(input)),
})
