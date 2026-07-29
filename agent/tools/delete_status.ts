/**
 * `delete_status` — implementation plan §2.4. The agent's front door onto
 * `deleteStatus` (US-F4.3), gated on the user's approval.
 */

import { defineTool } from "eve/tools"
import { always } from "eve/tools/approval"

import { deleteStatus } from "../../lib/actions/index.ts"
import { deleteStatusSchema } from "../../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

export default defineTool({
  description:
    "Delete one status from its project. A status that tasks still use " +
    "cannot be deleted, and neither can a project's last remaining status. " +
    "This pauses for the user's approval before it runs — name the status in " +
    "your message first, and pass the status id you actually read from " +
    "list_statuses.",
  inputSchema: deleteStatusSchema,
  approval: always(),
  execute: (input) => runAction(() => deleteStatus(input)),
})
