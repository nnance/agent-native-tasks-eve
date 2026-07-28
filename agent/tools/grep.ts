/**
 * Content search over files, for an agent whose only content is task titles
 * and descriptions — `list_tasks` already searches both. The sandbox this
 * built-in proxies into is disabled in `agent/sandbox.ts`.
 */

import { disableTool } from "eve/tools"

export default disableTool()
