/**
 * The built-in `todo` tool keeps a durable per-session todo list, which would
 * sit directly next to the product's actual tasks: a live confusion hazard for
 * the model (two things called a todo, only one of which the user can see) and,
 * once Phase 5 renders action entries, a spurious entry in the user's history
 * for work that never touched their data.
 */

import { disableTool } from "eve/tools"

export default disableTool()
