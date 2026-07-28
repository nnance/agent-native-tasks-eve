import { existsSync } from "node:fs"
import { resolve } from "node:path"

// Next.js loads .env.local automatically for `next dev` / `next build`.
// Standalone processes (drizzle-kit, tsx) do not — this fills that gap and is
// a no-op whenever the environment is already populated or the file is absent,
// so importing it is safe from anywhere and in any order.
const envPath = resolve(process.cwd(), ".env.local")

if (!process.env.DATABASE_URL && existsSync(envPath)) {
  process.loadEnvFile(envPath)
}
