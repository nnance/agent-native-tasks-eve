/**
 * The parity contract, in one import.
 *
 * Phase 2's route handlers and Phase 4's EVE tools import the *same* schema
 * objects from here — the route calls `.parse()` for a 400, the tool passes
 * the object as its `inputSchema`. Neither redefines a shape (implementation
 * plan §2.1). Mirrors the existing lib/db/index.ts barrel.
 */

export * from "./common.ts"
export * from "./priorities.ts"
export * from "./projects.ts"
export * from "./statuses.ts"
export * from "./tasks.ts"
