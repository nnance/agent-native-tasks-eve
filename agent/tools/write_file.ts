/**
 * The task assistant writes to the database through its own tools and nowhere
 * else. A file write has no meaning in this product, and the sandbox it would
 * proxy into is disabled in `agent/sandbox.ts`.
 */

import { disableTool } from "eve/tools"

export default disableTool()
