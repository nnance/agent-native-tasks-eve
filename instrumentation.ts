/**
 * Seeds the workspace on server boot so US-A1 holds for anyone who runs
 * `pnpm dev` on a fresh database without first running `pnpm db:seed`
 * (implementation plan §2.2 asks for both entry points).
 *
 * The dynamic import keeps `postgres` out of any non-node bundle, the env
 * guard keeps a credential-less build from failing, and the try/catch means a
 * database hiccup can never block app boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (!process.env.DATABASE_URL) return

  try {
    const { ensureSeeded } = await import("@/lib/db/seed")
    const result = await ensureSeeded()
    if (result.seeded) {
      console.log("[seed] created the default project and its lists")
    }
  } catch (error) {
    console.error("[seed] skipped:", error)
  }
}
