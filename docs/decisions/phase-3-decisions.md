# Phase 3 — Task UI + list management: decisions and assumptions

**Phase:** 3 — Task UI + list management (Epics B–E)
**Date:** 2026-07-28
**Branch:** `phase-3-task-ui-list-management`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 3 builds the second consumer of Phase 1's action layer — the direct
manipulation UI — on top of the Phase 2 API surface, which it does not change.
It also introduces the E2E harness the remaining phases run on.

Same two conventions as the Phase 0–2 records: a decision taken **at design
time** was settled before code was written; a decision taken **at build time**
was forced by something only discoverable once the code ran.

---

## Framework pre-read (AGENTS.md mandate)

Read before any code was written this phase:

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
- `node_modules/eve/docs/README.md`, `project-structure.mdx`

**Confirmed for the files this phase creates:**

1. **No fully-async request API is reachable from this phase's code.** Next 16
   removed the synchronous compatibility shim entirely: `cookies`, `headers`,
   `draftMode`, `params` (layout/page/route/default/metadata files) and
   `searchParams` (page) are Promise-only. Phase 3 adds **no dynamic route
   segment** and **no page-level `params`/`searchParams`** — `app/page.tsx` is a
   props-less Server Component — so there is nothing to await. The existing
   dynamic API routes already `await params` and are untouched.
2. **No Cache Components usage.** `next.config.ts` is a bare `withEve({})` with
   no `cacheComponents` flag, so `use cache`, `cacheLife`, `cacheTag`,
   `updateTag`, `refresh` and the Suspense-around-runtime-APIs obligations do
   not apply. Route handlers remain uncached by default (route-handlers doc,
   "Route Handlers are not cached by default"), so no route-segment config is
   added anywhere.
3. **Provider composition follows the documented pattern.** React context is
   unavailable in Server Components, so the TanStack `QueryClientProvider` is
   wrapped in a `"use client"` module (`app/providers.tsx`) and rendered from
   the Server Component layout — exactly the "Context providers" recipe in the
   server-and-client-components guide, and the same shape `ThemeProvider`
   already uses.
4. **The client boundary is drawn as deep as the docs advise.** `app/page.tsx`,
   `components/app-shell.tsx` and `components/workspace/chat-pane-placeholder.tsx`
   stay Server Components; `"use client"` starts at
   `components/workspace/task-workspace.tsx`, which is the first component that
   needs state.
5. **EVE is untouched.** Phase 3 adds no tool, channel, skill, subagent or
   schedule under `agent/`, and does not call any EVE API. `withEve()` in
   `next.config.ts` is unchanged. The right pane is static placeholder chrome
   with no `useChat`/`useEveAgent` wiring — that is Phase 5.
6. **Turbopack is the default bundler** for both `next dev` and `next build` in
   16, which is what the E2E harness's production build runs through. No
   webpack-specific configuration exists in this repo to migrate.

---

## Decisions

_(Design-time decisions were settled in the approved Phase 3 blueprint and are
transcribed below; build-time decisions were added as the phase was built.)_
