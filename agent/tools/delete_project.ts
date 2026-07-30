/**
 * `delete_project` — implementation plan §2.4. The agent's front door onto
 * `deleteProject` (US-C3), gated on the user's approval.
 *
 * The gate is `always()` per the plan's table and is framework-enforced: the
 * call durably pauses at `input.requested` rather than depending on the model
 * choosing to ask first (US-F3.3).
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { deleteProject } from "../../lib/actions/index.ts"
import { deleteProjectSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../../lib/tool-result.ts"

export default defineTool({
  description:
    "Delete one project permanently, along with its statuses and priorities. " +
    "A project that still has tasks cannot be deleted. This pauses for the " +
    "user's approval before it runs — name the project by name in your " +
    "message first, and pass the project id you actually read from " +
    "list_projects.",
  inputSchema: deleteProjectSchema,
  approval: always(),
  execute: (input) => runAction(() => deleteProject(input)),
})
