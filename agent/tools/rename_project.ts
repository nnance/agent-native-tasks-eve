/**
 * `rename_project` — implementation plan §2.4. The agent's front door onto
 * `renameProject` (US-C2).
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { renameProject } from "../../lib/actions/index.ts"
import { renameProjectSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Rename one project. Its tasks, statuses and priorities are untouched — " +
    "only the name changes.",
  inputSchema: renameProjectSchema,
  approval: never(),
  execute: (input) => runAction(() => renameProject(input)),
})
