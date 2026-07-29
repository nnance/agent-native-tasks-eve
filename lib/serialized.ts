/**
 * The JSON-safe shape of a server value: one recursive mapped type that
 * rewrites `Date` to `string` and leaves everything else alone.
 *
 * Extracted from lib/queries/types.ts in Phase 4 because both front doors now
 * need it. The HTTP boundary runs values through `Response.json`, and the EVE
 * tool boundary has the same obligation by hand — `eve/docs/tools/overview.mdx`
 * requires tool output to be JSON-serializable and names `Date` explicitly as
 * the author's responsibility to convert. `lib/queries/` imports through the
 * `@/` alias and is therefore unreachable from `agent/`, which runs under bare
 * Node with no tsconfig `paths` support; this module imports nothing at all, so
 * both halves can reach it. `lib/queries/types.ts` re-exports it, so there
 * stays exactly one definition.
 */

export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T
