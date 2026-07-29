/**
 * No delegation. This is a single-session assistant whose turns are short and
 * bounded — read, then one write or one bulk write — and a child session would
 * do that work outside the conversation the user is watching, with its own
 * approval prompts arriving on a stream nobody is rendering.
 */

import { disableTool } from "eve/tools"

export default disableTool()
