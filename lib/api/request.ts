/**
 * Reading transport input off a Request. See lib/api/respond.ts for what this
 * directory is and is not allowed to do.
 */

import { BadRequest } from "./respond.ts"

/**
 * Reads a JSON object body.
 *
 * An empty body yields `{}` on purpose: the schema then produces a precise
 * "name is required" 400 instead of a vague "invalid JSON" one, which is the
 * more useful answer to both a form and a model. Arrays and scalars are
 * rejected because every handler spreads the result into a schema input
 * object, where a non-object would silently contribute nothing.
 */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (raw.trim() === "") return {}

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new BadRequest("Request body must be valid JSON.")
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequest("Request body must be a JSON object.")
  }

  return parsed as Record<string, unknown>
}
