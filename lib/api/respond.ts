/**
 * The route layer's error vocabulary, in one place.
 *
 * `lib/api/` is transport plumbing and nothing else: no product rules, no
 * database access. It is imported only by `app/api/**`, which is what the
 * directory name says — roughly twenty handlers would otherwise hand-copy the
 * same four-branch catch, and the status vocabulary would stop being auditable.
 *
 * Phase 4's EVE tools will need their own, differently-worded mapping of the
 * same two action-layer errors; this module is the model for it, not a shared
 * dependency of it.
 */

import { ZodError } from "zod"

import { NotFoundError, RuleViolation } from "../domain/errors.ts"

/** Transport-level malformed input: the body isn't JSON, or isn't an object. */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BadRequest"
  }
}

/**
 * Maps a thrown value onto a response.
 *
 * | thrown          | status | body                                       |
 * | --------------- | ------ | ------------------------------------------ |
 * | `ZodError`      | 400    | `{ error: "Invalid request.", issues }`    |
 * | `BadRequest`    | 400    | `{ error }`                                |
 * | `NotFoundError` | 404    | `{ error }` — message verbatim             |
 * | `RuleViolation` | 409    | `{ error }` — message verbatim             |
 *
 * `RuleViolation` and `NotFoundError` messages are relayed **unaltered**:
 * product spec §9 requires the human-readable text the action wrote to reach
 * the user, and US-F3.4 has the agent relay the same string.
 *
 * Anything not listed is a genuine defect and is rethrown so Next answers 500.
 * Flattening an unknown error into a plausible 4xx would hide the bug behind a
 * response body that looks like a considered answer.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid request.", issues: error.issues },
      { status: 400 }
    )
  }

  if (error instanceof BadRequest) {
    return Response.json({ error: error.message }, { status: 400 })
  }

  if (error instanceof NotFoundError) {
    return Response.json({ error: error.message }, { status: 404 })
  }

  if (error instanceof RuleViolation) {
    return Response.json({ error: error.message }, { status: 409 })
  }

  throw error
}

/**
 * Runs a handler body, JSON-encoding its result or mapping its error.
 *
 * Every `schema.parse()` call must happen **inside** `run` so its ZodError is
 * caught here rather than escaping as a 500.
 */
export async function respond(
  run: () => Promise<unknown>,
  init: { status?: number } = {}
): Promise<Response> {
  try {
    return Response.json(await run(), { status: init.status ?? 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
