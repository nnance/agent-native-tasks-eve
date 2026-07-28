/**
 * The shared action set, in one import.
 *
 * Every capability in product spec §5 has exactly one function here, and every
 * §7 rule is enforced here and nowhere else. The UI's route handlers (Phase 2)
 * and the agent's tools (Phase 4) are two front doors onto this one set: they
 * adapt transport, parse the matching lib/schemas/ object, call the action, and
 * map RuleViolation / NotFoundError onto their own vocabulary. Neither
 * re-checks a rule. Mirrors the existing lib/db/index.ts barrel.
 */

export * from "./priorities.ts"
export * from "./projects.ts"
export * from "./statuses.ts"
export * from "./tasks.ts"
