import "@/lib/env"

import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in."
  )
}

// Neon's pooled endpoint runs PgBouncer in transaction mode, which does not
// support the session-level prepared statements postgres.js uses by default.
const createClient = () =>
  postgres(connectionString, { max: 5, prepare: false })

// Reuse one client across dev hot-reloads so Next doesn't leak Neon
// connections on every recompile.
const globalForDb = globalThis as unknown as {
  __taskDbClient?: ReturnType<typeof createClient>
}

const client = globalForDb.__taskDbClient ?? createClient()

if (process.env.NODE_ENV !== "production") {
  globalForDb.__taskDbClient = client
}

export const db = drizzle(client, { schema })

/** The injectable handle type for actions and tests. */
export type Database = typeof db

export async function closeDb() {
  await client.end({ timeout: 5 })
}
