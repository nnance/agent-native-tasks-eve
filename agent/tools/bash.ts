/**
 * The task assistant has no shell.
 *
 * `agent/sandbox.ts` deliberately disables sandbox auto-install, so this
 * built-in could only ever fail at call time — and a task assistant that can
 * shell out is a capability surface the product never asked for
 * (eve/docs/concepts/default-harness.md: "Disable, wrap, restrict, or require
 * approval for any tool that can access the filesystem, network, shell, or
 * sensitive data").
 */

import { disableTool } from "eve/tools"

export default disableTool()
