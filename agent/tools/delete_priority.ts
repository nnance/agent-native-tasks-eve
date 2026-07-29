/**
 * `delete_priority` — implementation plan §2.4. The agent's front door onto
 * `deletePriority` (US-F4.3), gated on the user's approval.
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { deletePriority } from "../../lib/actions/index.ts"
import { deletePrioritySchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Delete one priority from its project. A priority that tasks still use " +
    "cannot be deleted, and neither can a project's last remaining priority. " +
    "If the deleted one was the project's default, the designation moves to " +
    "the first surviving priority. This pauses for the user's approval before " +
    "it runs — name the priority in your message first, and pass the priority " +
    "id you actually read from list_priorities.",
  inputSchema: deletePrioritySchema,
  approval: always(),
  execute: (input) => runAction(() => deletePriority(input)),
})
