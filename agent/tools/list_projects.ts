/**
 * `list_projects` — implementation plan §2.4. The agent's front door onto
 * `listProjects` (US-F2.1).
 *
 * Every tool in this directory has the same body on purpose: advertise the
 * shared schema unmodified, call the shared action, and let `runAction` do the
 * error and JSON translation. No product rule is re-checked here.
 */

import { defineTool } from "eve/tools"
import { never } from "eve/tools/approval"

import { listProjects } from "../../lib/actions/index.ts"
import { listProjectsSchema } from "../../lib/schemas/index.ts"
import { compactProject } from "../lib/compact.ts"
import { compactList } from "../lib/list-output.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "List every project, oldest first. Takes no arguments. Start here when " +
    "the user names a project by name and you need its id.",
  inputSchema: listProjectsSchema,
  approval: never(),
  execute: (input) => runAction(() => listProjects(input)),
  toModelOutput: compactList(compactProject),
})
