/**
 * Every answer this agent gives must be grounded in a tool read of the user's
 * own data (US-F2). Web results are the opposite of that: plausible text with
 * no relationship to the task list, and one more way for an answer to look
 * authoritative while being invented.
 */

import { disableTool } from "eve/tools"

export default disableTool()
