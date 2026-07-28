import "../env.ts"

import { createDatabase, type Database } from "./connect.ts"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
  )
}

// Reuse one handle across dev hot-reloads so Next doesn't leak Neon
// connections on every recompile.
const globalForDb = globalThis as unknown as {
  __taskDb?: ReturnType<typeof createDatabase>
}

const handle = globalForDb.__taskDb ?? createDatabase(connectionString)

if (process.env.NODE_ENV !== "production") {
  globalForDb.__taskDb = handle
}

export const db = handle.database

/** The injectable handle type for actions and tests. */
export type { Database }

export async function closeDb() {
  await handle.close()
}
