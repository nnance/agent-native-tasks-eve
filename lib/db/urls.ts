/**
 * Resolves which database a CLI script is about to talk to, and renders that
 * choice in a form that can never leak a credential into a transcript.
 *
 * Scripts take an explicit `--target=dev|test` rather than inferring intent
 * from which env vars happen to be set: `scripts/reset.ts` is destructive, so
 * the database being dropped must be named by the caller, not guessed
 * (implementation plan §8, risk 11).
 */

export type DbTarget = "dev" | "test"

/** Reads `--target=dev|test` out of argv. Defaults to "dev". */
export function parseTarget(argv: string[]): DbTarget {
  const flag = argv.find((arg) => arg.startsWith("--target="))
  if (!flag) return "dev"

  const value = flag.slice("--target=".length)
  if (value === "dev" || value === "test") return value

  throw new Error(
    `Unknown --target=${value}. Expected --target=dev or --target=test.`
  )
}

/**
 * The pooled URL is for app-shaped work; the direct (unpooled) one is for DDL,
 * which is happiest over a plain session rather than PgBouncer — the same
 * split drizzle.config.ts already encodes.
 *
 * Both spellings of the test URL are accepted on purpose: the Neon/Vercel env
 * pull writes TEST_DATABASE_URL into .env.local, while .env.test (per the
 * project's own convention) spells the same URL DATABASE_URL_TEST.
 */
export function resolveDbUrls(target: DbTarget): {
  pooled: string
  direct: string
} {
  if (target === "dev") {
    const pooled = process.env.DATABASE_URL
    if (!pooled) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
      )
    }
    return { pooled, direct: process.env.DATABASE_URL_UNPOOLED ?? pooled }
  }

  const pooled = process.env.DATABASE_URL_TEST ?? process.env.TEST_DATABASE_URL
  if (!pooled) {
    throw new Error(
      "Neither DATABASE_URL_TEST nor TEST_DATABASE_URL is set. The test " +
        "database must be a separate Neon project; see .env.example."
    )
  }

  const direct =
    process.env.DATABASE_URL_TEST_UNPOOLED ??
    process.env.TEST_DATABASE_URL_UNPOOLED ??
    pooled

  return { pooled, direct }
}

/**
 * Renders a connection string as `host/database` and nothing else. Every log
 * line in scripts/ goes through this — a password must never reach stdout,
 * where it would end up pasted into a verification transcript.
 */
export function describeDbUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return "<unparseable connection string>"
  }
}
