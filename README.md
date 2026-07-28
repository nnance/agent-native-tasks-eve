# Agent-Native Task Manager

A **reference application** for building *agent-native* software, built with Next.js, shadcn/ui, and the [Vercel EVE Agent Framework](https://eve.dev).

The product itself — a basic task manager — is intentionally simple. Its value is in demonstrating and validating one architectural idea:

> **The user and the AI agent are peers.** Every action a user can take through the UI, the agent can take through its tools, and both are backed by the exact same underlying capability.

Feature sophistication is explicitly *not* a goal. The goal is a clean, honest demonstration of UI/agent parity that others can study and pattern-match against.

## What it does

A single-user task manager presented as a **split screen**: the direct UI (task list + list management) on the left, an AI agent chat on the right — both always visible, operating on one shared source of truth.

- **Tasks** have a Title, Description, Status, Project, and Priority. A task's project is fixed at creation — it can never move.
- **Statuses and Priorities are defined per project** (each project owns its own workflow labels and priority scale), with sensible defaults seeded on project creation.
- **The agent is a full peer of the UI.** It can create, edit, search, and delete tasks — and manage projects, statuses, and priorities — through natural language. Destructive and bulk actions pause for your confirmation before executing.
- **Live sync.** Ask the agent for a change on the right, watch it land in the UI on the left — no refresh.

## Architecture

One set of actions, two front doors:

```
              lib/actions/*  ← every capability, every rule, defined once
                 ↑        ↑
    app/api/* (UI)      agent/tools/* (EVE agent)
         ↑                    ↑
   Task UI (left)       Chat UI (right)
                 ↘        ↙
                  Postgres
```

- **Backend:** CRUD API over Postgres (Drizzle ORM), with all business rules in a shared action layer.
- **UI:** ToDo list with tag-based filtering (project/status/priority) + list management, built with shadcn/ui.
- **Agent:** Vercel EVE agent embedded in the Next.js app via `withEve()`, with tools that call the same shared actions the API routes do, and framework-enforced approval gates on destructive operations.

## Documentation

| Doc | What it covers |
|---|---|
| [Product Spec](docs/product-spec.md) | What the system does and how the user interacts with it |
| [User Stories](docs/user-stories.md) | Acceptance criteria per epic, plus the UI↔agent parity matrix |
| [EVE Framework Notes](docs/eve-framework-notes.md) | Research notes mapping EVE's primitives onto this design |
| [Implementation Plan](docs/implementation-plan.md) | Architecture decisions, tool inventory, and the phased build plan |

## Status

📋 **Planning complete — implementation in progress.** The docs above are the source of truth; the app is currently the Next.js + shadcn scaffold with a demo chat UI, being built out per the [implementation plan](docs/implementation-plan.md).

## Development

```bash
pnpm install
pnpm dev
```

Requires Node 24+ (EVE's floor). Once implementation lands, you'll also need a Postgres `DATABASE_URL` and a Vercel AI Gateway key (`AI_GATEWAY_API_KEY`) in `.env.local` — see the implementation plan for setup details.

### Adding shadcn components

```bash
npx shadcn@latest add button
```

Components land in `components/ui/` and are imported as:

```tsx
import { Button } from "@/components/ui/button";
```
