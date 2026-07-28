/**
 * `create_status` — implementation plan §2.4. The agent's front door onto
 * `createStatus` (US-F4.2).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { createStatus } from "../../lib/actions/index.ts"
import { createStatusSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Add a status to one project. It is appended to the end of that " +
    "project's list. Set isCompleted to true only for a status that means " +
    "the task is finished — tasks in such a status are hidden from the " +
    "default list.",
  inputSchema: createStatusSchema,
  approval: never(),
  execute: (input) => runAction(() => createStatus(input)),
})
