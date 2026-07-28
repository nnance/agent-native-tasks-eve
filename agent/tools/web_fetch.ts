/**
 * A local task manager has no reason to fetch arbitrary URLs, and a tool that
 * can is an exfiltration path for whatever the user has written into their
 * tasks. Nothing in product spec §5 needs the network.
 */

import { disableTool } from "eve/tools"

export default disableTool()
