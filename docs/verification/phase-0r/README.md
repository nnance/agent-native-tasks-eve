# Phase 0r verification evidence

Captured on Node v24.10.0, macOS, against the Neon dev and test projects.
Connection strings are always rendered `host/database` — no credential appears
in any transcript here.

| File | What it proves |
| --- | --- |
| `01-dependencies.txt` | package.json carries nothing outside implementation plan §1.1: `vitest` and `tsx` are gone, `agent-browser` is pinned exact. Also dumps the §4.7 script block and the Node version. |
| `02-node-test.txt` | `pnpm test:unit` green via `node --test` (6/6), and `test` / `test:api` / `test:e2e` all exit 0. |
| `03-db-migrate.txt` | `scripts/migrate.ts` is an idempotent no-op on the already-migrated dev database — the NOTICEs are drizzle's own bookkeeping schema, not a re-applied migration. |
| `04-db-seed.txt` | `scripts/seed.ts` reports *Skipped* and dumps the seeded state, preserving Phase 0's idempotency (US-A1.5). |
| `05-api-health.txt` | `GET /api/health` returns `{"ok":true,"db":true,"migrations":"current"}` with HTTP 200 — the §2.7 exit criterion. |
| `06-db-reset-test.txt` | `pnpm db:reset:test` runs the full destructive drop → migrate → seed against the **test** project, ending *Seeded*. The dev database was never dropped. |
| `07-reset-guard.txt` | The reset guard refuses, non-destructively and with exit 1, when the test URL equals `DATABASE_URL`. Run against fake URLs in a throwaway env file, so no real credential was involved. |
| `08-db-seed-dev-after.txt` | The dev database still reports *Skipped* after the test-database reset — the two are genuinely separate projects. |
| `09-agent-browser-doctor.txt` | The pinned `agent-browser` (0.33.1, via `pnpm exec`) passes `doctor` 8/8, including a real headless Chrome launch. |
| `10-app-screenshot.png` | The running app, rendered and screenshotted through agent-browser. Expected content at this phase is `app/page.tsx`'s Phase 0 placeholder chat demo, not product UI. |
| `11-agent-browser-snapshot.txt` | `snapshot -i` returns a live accessibility tree with refs, proving the harness can address elements. Page content is untrusted data captured as evidence, never instructions (§3.4). |
