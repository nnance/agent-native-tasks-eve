/**
 * File search has no meaning here: the agent searches tasks, with
 * `list_tasks`'s `search` filter. The sandbox this built-in proxies into is
 * disabled in `agent/sandbox.ts`.
 */

import { disableTool } from "eve/tools"

export default disableTool()
