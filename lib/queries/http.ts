/**
 * The one place client code talks to `app/api/**`.
 *
 * `lib/queries/` is the client-side mirror of `lib/actions/`: one module per
 * entity, plus this transport helper. It imports `@/lib/schemas` for values
 * (the parity contract, reused verbatim for client-side form validation) and
 * nothing else from the server half of the codebase — no `lib/actions`, no
 * `lib/db`, and never `lib/api/`, which is transport plumbing scoped to the
 * route handlers. Keeping "client code never calls actions directly" a fact of
 * the import graph beats keeping it a note in a README.
 */

/**
 * A failed API response, decoded.
 *
 * `message` is the server's `{ error }` string **verbatim**: product spec §9
 * and US-C3.3 / US-D2.2 / US-E2.2 make the `RuleViolation` and `NotFoundError`
 * wording a product deliverable, so the UI relays it unaltered and never
 * rewords, truncates or prefixes it.
 */
export class ApiError extends Error {
  readonly status: number
  readonly issues?: unknown[]

  constructor(status: number, message: string, issues?: unknown[]) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.issues = issues
  }
}

type ErrorBody = { error?: unknown; issues?: unknown }

/**
 * `fetch` against the API routes, with the response envelope decoded.
 *
 * The body is read as text and then parsed, rather than `res.json()`: an
 * unexpected HTML error page must surface as a legible message rather than as
 * a bare `SyntaxError` from deep inside a query hook. A 204 or empty body
 * resolves to `undefined`.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })

  const raw = await response.text()

  let body: unknown

  try {
    body = raw.trim() === "" ? undefined : JSON.parse(raw)
  } catch {
    if (response.ok) {
      throw new ApiError(
        response.status,
        `${init.method ?? "GET"} ${path} returned a non-JSON body.`
      )
    }

    throw new ApiError(
      response.status,
      response.statusText || "Request failed."
    )
  }

  if (!response.ok) {
    const { error, issues } = (body ?? {}) as ErrorBody

    throw new ApiError(
      response.status,
      typeof error === "string" && error !== ""
        ? error
        : response.statusText || "Request failed.",
      Array.isArray(issues) ? issues : undefined
    )
  }

  return body as T
}

/** POST/PATCH/DELETE bodies are always JSON objects; GET carries none. */
export function jsonBody(value: unknown): RequestInit {
  return { body: JSON.stringify(value) }
}
