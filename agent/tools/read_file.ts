/**
 * The task assistant has no filesystem. Every fact it can state comes from a
 * `list_*` or `get_task` read against the shared action layer, and the sandbox
 * this built-in proxies into is disabled in `agent/sandbox.ts`, so leaving it
 * advertised would buy only failed turns.
 */

import { disableTool } from "eve/tools"

export default disableTool()
