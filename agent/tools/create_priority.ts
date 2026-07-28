/**
 * `create_priority` — implementation plan §2.4. The agent's front door onto
 * `createPriority` (US-F4.2).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { createPriority } from "../../lib/actions/index.ts"
import { createPrioritySchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Add a priority to one project. It is appended to the end of that " +
    "project's list, which makes it the most urgent, and it is never the " +
    "project's default — use update_priority with isDefault to change that.",
  inputSchema: createPrioritySchema,
  approval: never(),
  execute: (input) => runAction(() => createPriority(input)),
})
