/**
 * `create_project` — implementation plan §2.4. The agent's front door onto
 * `createProject` (US-C1).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { createProject } from "../../lib/actions/index.ts"
import { createProjectSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Create a project. It is seeded with the standard statuses (To Do, In " +
    "Progress, Done) and priorities (Low, Medium, High, with Medium as the " +
    "default), so a task can be created in it immediately with no further " +
    "setup.",
  inputSchema: createProjectSchema,
  approval: never(),
  execute: (input) => runAction(() => createProject(input)),
})
