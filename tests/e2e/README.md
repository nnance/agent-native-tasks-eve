# End-to-end tests

Browser-driven tests written with `node:test` and driven by the pinned
`agent-browser` CLI (`pnpm exec agent-browser`), run with `pnpm test:e2e`.
They are deliberately serialised (`--test-concurrency=1`) because they share
one browser profile and one database.

```bash
pnpm test:e2e        # eve build, next build, then the whole suite
pnpm test:e2e:only   # skip both builds (iterating; requires existing output)
```

`test:e2e` chains the builds with `&&` rather than using a `pretest:e2e`
script: pnpm does not run pre/post lifecycle scripts by default, so that
script would silently never fire. `harness/server.ts` refuses to start
without `.next/BUILD_ID` — or, for the agent suite, without
`.output/server/index.mjs` — and says how to get one.

### The eve agent server (`06` and `07`)

`next start` does **not** boot the agent, and cannot. `withEve()` spawns it
from inside `next.config.ts`'s `rewrites()`, which Next evaluates at build
time only; `next start` reads the finished rewrite out of
`.next/routes-manifest.json`. So `/eve/v1/:path+ →
http://127.0.0.1:4274/eve/v1/:path+` is baked and correct while nothing
listens on the other end — a request through the Next origin answers 500
with `ECONNREFUSED 127.0.0.1:4274`.

`setupSuite(name, { eve: true })` therefore starts `eve start --host
127.0.0.1 --port 4274` itself, against the test database, and tears it down
as a process group after the Next server. The port is **fixed** because the
rewrite baked it in, so a `pnpm dev` holding 4274 will fail the suite — the
harness says so in the error. `pnpm exec eve build` must have run first;
`pnpm test:e2e` does it for you.

`06-agent-chat.test.ts` and `07-live-sync.test.ts` opt in, so 01–05 stay
fast. They are the only suites that pay the eve boot and the fixed-port
constraint.

## What runs against what

Nothing is mocked (implementation plan §4.3). Each test file boots its own
`next start` on a free port against a real production build, pointed at
`DATABASE_URL_TEST` — a Neon project separate from the dev database.
`harness/setup.ts` refuses to run if `DATABASE_URL_TEST` is missing or equal
to `DATABASE_URL`, or if `AI_GATEWAY_API_KEY` is absent, so a skipped run can
never look like a passing one.

Per-test isolation is `TRUNCATE … CASCADE` plus `ensureSeeded()` in
`beforeEach`; migrations run once per file.

## Layout

```
tests/e2e/
├── harness/
│   ├── browser.ts    # agent-browser wrapper (execFile → JSON envelope)
│   ├── server.ts     # next start on a free port, health-polled
│   │                 # (+ opt-in eve agent server on the fixed 4274)
│   ├── db.ts         # reset + seed + direct row assertions
│   ├── fixtures.ts   # preconditions, written through lib/actions
│   └── setup.ts      # per-file before/beforeEach/after
├── baselines/        # committed screenshots (phase evidence, not a gate)
├── artifacts/        # per-run console/errors/screenshot dumps (gitignored)
├── 01-foundation.test.ts
├── 02-tasks-ui.test.ts
├── 03-projects-ui.test.ts
├── 04-statuses-ui.test.ts
├── 05-priorities-ui.test.ts
├── 06-agent-chat.test.ts   # real model, real turns — `{ eve: true }`
└── 07-live-sync.test.ts    # live sync + convergence — `{ eve: true }`,
                            # two agent-browser sessions, never reloads
```

## `data-testid` conventions (implementation plan §2.7)

Attributes only — no testid is ever read by business logic.

| Surface | testids |
| --- | --- |
| Shell | `app-shell`, `task-pane`, `chat-pane`, `chat-conversation` |
| Tabs | `tab-tasks`, `tab-lists`, `panel-tasks`, `panel-lists` |
| Task filters | `filter-project-<id>`, `filter-status-<id>`, `filter-priority-<id>`, `status-filter-hint`, `task-search-input`, `show-completed-toggle`, `clear-filters` |
| Task list | `task-list-loading`, `task-list-error`, `task-list-empty`, `task-row-<id>` (+ `data-completed`), `task-title-<id>`, `task-project-chip-<id>`, `task-status-chip-<id>`, `task-priority-chip-<id>`, `task-status-select-<id>`, `task-edit-<id>`, `task-delete-<id>` |
| Task form | `task-create-open`, `task-form-dialog`, `task-form-title`, `task-form-description`, `task-form-project`, `task-form-project-readonly`, `task-form-status`, `task-form-priority`, `task-form-submit`, `task-form-cancel`, `task-form-error` |
| Delete dialogs | `delete-<entity>-<id>-dialog`, `-confirm`, `-cancel`, `-error` |
| Projects | `projects-panel-{loading,error,empty}`, `project-row-<id>`, `project-name-<id>`, `project-rename-<id>` (+ `-input`/`-submit`/`-cancel`/`-error`), `project-delete-<id>`, `project-create-{input,submit,error}` |
| Statuses | `manage-project-select`, `statuses-panel-{loading,error,empty}`, `status-row-<id>` (+ `data-completed`), `status-name-<id>`, `status-rename-<id>` (+ `-input`/…), `status-up-<id>`, `status-down-<id>`, `status-completed-<id>`, `status-delete-<id>`, `status-create-{input,completed,submit,error}` |
| Priorities | `priorities-panel-{loading,error,empty}`, `priority-row-<id>` (+ `data-default`), `priority-name-<id>`, `priority-rename-<id>` (+ `-input`/…), `priority-up-<id>`, `priority-down-<id>`, `priority-set-default-<id>`, `priority-default-badge-<id>`, `priority-delete-<id>`, `priority-create-{input,submit,error}` |
| Chat pane | `chat-conversation`, `chat-transcript`, `chat-empty`, `chat-error`, `chat-composer`, `chat-composer-input`, `chat-send`, `chat-blocked` |
| Agent activity | `action-entry` (+ `data-tool`, `data-state`, `data-outcome`), `action-entry-details` |
| Approvals | `approval-card` (+ `data-tool`, `data-severity`, `data-count`), `approval-approve`, `approval-deny`, `approval-option-<id>`, `approval-freeform`, `approval-freeform-submit`, `approval-target-<id>` |

Rows are counted with prefix selectors: `[data-testid^="task-row-"]`,
`[data-testid^="status-row-"]`, `[data-testid^="priority-row-"]`,
`[data-testid^="project-row-"]`, `[data-testid^="approval-target-"]`.

The agent surfaces are addressed by their **data attributes** rather than by
a testid per tool: `[data-testid="action-entry"][data-tool="delete_task"]`,
`[data-state="output-available"]`, `[data-outcome="denied"]`. That keeps the
testid vocabulary small while letting the suite assert exactly which tool ran
and how it ended. When an approval card has a single target the
`approval-target-<id>` hook sits on the headline, which already names it;
above one, on each row of the manifest.

## Coverage (implementation plan §4.6)

| User story | Covering test |
| --- | --- |
| US-A1.1 | `01-foundation.test.ts › "US-A1.1: a fresh workspace has exactly one project"` |
| US-A1.2 | `01-foundation.test.ts › "US-A1.2: the seeded project has To Do / In Progress / Done, Done completed"` |
| US-A1.3 | `01-foundation.test.ts › "US-A1.3: the seeded project has Low / Medium / High, Medium default"` |
| US-A1.4 | `01-foundation.test.ts › "US-A1.4: a task can be created in the seeded project with no extra setup"` |
| US-A1.5 | `01-foundation.test.ts › "US-A1.5: reopening the app does not create a second starter project"` |
| §8.0 split screen | `01-foundation.test.ts › "§8.0: both panes render side by side and stack on a narrow viewport"` |
| US-B1.1 | `02-tasks-ui.test.ts › "US-B1.1/1.3/1.4/1.6: a title-only task takes the project's defaults and appears at once"` |
| US-B1.2 | `02-tasks-ui.test.ts › "US-B1.2: a task cannot be created without a title"` |
| US-B1.3 | `02-tasks-ui.test.ts › "US-B1.1/1.3/1.4/1.6: …"` |
| US-B1.4 | `02-tasks-ui.test.ts › "US-B1.1/1.3/1.4/1.6: …"` |
| US-B1.5 | `02-tasks-ui.test.ts › "US-B1.5: only the selected project's statuses and priorities are offered"` |
| US-B1.6 | `02-tasks-ui.test.ts › "US-B1.1/1.3/1.4/1.6: …"` |
| US-B2.1 | `02-tasks-ui.test.ts › "US-B2.1/2.2: rows show title + chips, sorted priority-desc then oldest-first"` |
| US-B2.2 | `02-tasks-ui.test.ts › "US-B2.1/2.2: …"` |
| US-B2.3 | `02-tasks-ui.test.ts › "US-B2.3/2.4: completed tasks are hidden, then shown last and marked"` |
| US-B2.4 | `02-tasks-ui.test.ts › "US-B2.3/2.4: …"` |
| US-B2.5 | `02-tasks-ui.test.ts › "US-B2.5: opening a task shows every field including the full description"` |
| US-B3.1 | `02-tasks-ui.test.ts › "US-B3.1/3.2: project, status and priority chips filter individually and together"` |
| US-B3.2 | `02-tasks-ui.test.ts › "US-B3.1/3.2: …"` |
| US-B3.3 | `02-tasks-ui.test.ts › "US-B3.3/3.4: search narrows the list and combines with the chips"` |
| US-B3.4 | `02-tasks-ui.test.ts › "US-B3.3/3.4: …"` |
| US-B3.5 | `02-tasks-ui.test.ts › "US-B3.5: an empty result offers a way to clear filters and search"` |
| US-B4.1 | `02-tasks-ui.test.ts › "US-B4.1/4.3/4.5: editing title, description, status and priority persists and shows at once"` |
| US-B4.2 | `02-tasks-ui.test.ts › "US-B4.2: the title cannot be cleared"` |
| US-B4.3 | `02-tasks-ui.test.ts › "US-B4.1/4.3/4.5: …"` (project-scoped selects) and `"US-B1.5: …"` |
| US-B4.4 | `02-tasks-ui.test.ts › "US-B4.4: there is no way in the UI to move a task to another project"` |
| US-B4.5 | `02-tasks-ui.test.ts › "US-B4.1/4.3/4.5: …"` |
| US-B5.1 | `02-tasks-ui.test.ts › "US-B5.1/5.2/5.4: the row's status select moves a task, in the project's order"` |
| US-B5.2 | `02-tasks-ui.test.ts › "US-B5.1/5.2/5.4: …"` |
| US-B5.3 | `02-tasks-ui.test.ts › "US-B5.3: moving into a completed status applies the completed display rules"` |
| US-B5.4 | `02-tasks-ui.test.ts › "US-B5.1/5.2/5.4: …"` |
| US-B6.1 | `02-tasks-ui.test.ts › "US-B6.1/6.2: deleting asks for confirmation, and declining changes nothing"` |
| US-B6.2 | `02-tasks-ui.test.ts › "US-B6.1/6.2: …"` |
| US-B6.3 | `02-tasks-ui.test.ts › "US-B6.3: confirming removes the task from the list and the database"` |
| US-C1.1 | `03-projects-ui.test.ts › "US-C1.1/1.2: a new project is seeded with the default statuses and priorities"` |
| US-C1.2 | `03-projects-ui.test.ts › "US-C1.1/1.2: …"` |
| US-C1.3 | `03-projects-ui.test.ts › "US-C1.3: a task can be created in a brand-new project immediately"` |
| US-C2.1 | `03-projects-ui.test.ts › "US-C2.1/2.2: renaming updates the task chips without a reload and leaves the contents alone"` |
| US-C2.2 | `03-projects-ui.test.ts › "US-C2.1/2.2: …"` |
| US-C3.1 | `03-projects-ui.test.ts › "US-C3.1: an empty project deletes after confirmation, taking its lists with it"` |
| US-C3.2 | `03-projects-ui.test.ts › "US-C3.2/3.3: deleting a project with tasks is blocked, with the reason and the remedy"` |
| US-C3.3 | `03-projects-ui.test.ts › "US-C3.2/3.3: …"` (message asserted verbatim) |
| US-D1.1 | `04-statuses-ui.test.ts › "US-D1.1: statuses are managed per project and each project's are independent"` |
| US-D1.2 | `04-statuses-ui.test.ts › "US-D1.2: a status can be created, renamed and reordered, and the order is respected"` |
| US-D1.3 | `04-statuses-ui.test.ts › "US-D1.3: toggling a status's completed flag applies the completed display rules at once"` |
| US-D1.4 | `04-statuses-ui.test.ts › "US-D1.4: renaming a status shows on existing task chips without a reload"` |
| US-D2.1 | `04-statuses-ui.test.ts › "US-D2.1: deleting an unused status succeeds"` |
| US-D2.2 | `04-statuses-ui.test.ts › "US-D2.2: deleting a status that tasks use is blocked, with the reason and the remedy"` |
| US-D2.3 | `04-statuses-ui.test.ts › "US-D2.3: deleting the project's last remaining status is blocked even when unused"` |
| US-E1.1 | `05-priorities-ui.test.ts › "US-E1.1: priorities are managed per project and each project's are independent"` |
| US-E1.2 | `05-priorities-ui.test.ts › "US-E1.2: a priority can be created, renamed and reordered, and reordering re-sorts the task list"` |
| US-E1.3 | `05-priorities-ui.test.ts › "US-E1.3: exactly one default exists, and a new task takes it"` |
| US-E1.4 | `05-priorities-ui.test.ts › "US-E1.4: renaming a priority shows on existing task chips without a reload"` |
| US-E2.1 | `05-priorities-ui.test.ts › "US-E2.1: deleting an unused priority succeeds"` |
| US-E2.2 | `05-priorities-ui.test.ts › "US-E2.2: deleting a priority that tasks use is blocked, with the reason and the remedy"` |
| US-E2.3 | `05-priorities-ui.test.ts › "US-E2.3: deleting the project's last remaining priority is blocked even when unused"` |
| US-E2.4 | `05-priorities-ui.test.ts › "US-E2.4: deleting the default reassigns it to the first priority by order"` |
| US-F1.1 | `06-agent-chat.test.ts › "US-F1.1/1.2 + US-F2: the pane is a live agent that answers from real data"` |
| US-F1.2 | `06-agent-chat.test.ts › "US-F1.1/1.2 + US-F2: …"` |
| US-F1.3 | `06-agent-chat.test.ts › "US-F1.3/1.4 + US-F6.3: the conversation survives a reload, pronoun and all"` |
| US-F1.4 | `06-agent-chat.test.ts › "US-F1.3/1.4 + US-F6.3: …"` (the literal "move that one to Done") |
| US-F2.1 | `06-agent-chat.test.ts › "US-F1.1/1.2 + US-F2: …"` |
| US-F2.2 | `06-agent-chat.test.ts › "US-F1.1/1.2 + US-F2: …"` (fixtures written moments before the turn) |
| US-F2.3 | `06-agent-chat.test.ts › "US-F1.1/1.2 + US-F2: …"` (tasks found by title, via `list_tasks`) |
| US-F2.4 | Covered by the Phase 4 story harness (`scripts/verify-agent-stories.ts`); not re-asserted here, since "says it does not exist" is prose |
| US-F3.1 | `06-agent-chat.test.ts › "US-F1.3/1.4 + US-F6.3: …"` (create with defaults) |
| US-F3.2 | `06-agent-chat.test.ts › "US-F3.2/3.5 + US-F6.1: a single-task status move runs with no approval gate"` |
| US-F3.3 | `06-agent-chat.test.ts › "US-F3.3 + US-F5.1/5.2: deleting a task gates, and denying leaves it alone"` |
| US-F3.4 | `06-agent-chat.test.ts › "US-F3.4: moving a task to another project is refused, and nothing changes"` |
| US-F3.5 | `06-agent-chat.test.ts › "US-F3.2/3.5 + US-F6.1: …"` (asserts **no** approval card) |
| US-F4.1 | Phase 4 story harness; `06` covers the delete half of Epic F4 |
| US-F4.2 | Phase 4 story harness |
| US-F4.3 | `06-agent-chat.test.ts › "US-F4.3: deleting a project gates too — the card is not task-specific"` |
| US-F4.4 | Phase 4 story harness (blocked-delete wording is asserted verbatim there) |
| US-F5.1 | `06-agent-chat.test.ts › "US-F3.3 + US-F5.1/5.2: …"` and `"US-F5.2/5.3: …"` |
| US-F5.2 | `06-agent-chat.test.ts › "US-F5.2/5.3: a bulk card states how many and names every task"` |
| US-F5.3 | `06-agent-chat.test.ts › "US-F5.2/5.3: …"` (approve applies all three) and the deny half of the delete cycle |
| US-F5.4 | `06-agent-chat.test.ts › "US-F5.2/5.3: …"` (the settled `action-entry` reports the outcome) |
| US-F6.1 | `06-agent-chat.test.ts › "US-F3.2/3.5 + US-F6.1: …"` (exactly one entry per action) |
| US-F6.2 | Not asserted — plan §4.5 forbids asserting the assistant's prose |
| US-F6.3 | `06-agent-chat.test.ts › "US-F1.3/1.4 + US-F6.3: …"` |
| US-F6.4 | `06-agent-chat.test.ts › "US-F1.3/1.4 + US-F6.3: …"` (entries re-render after reload) |
| US-G1.1 | `07-live-sync.test.ts › "US-G1.1: an agent-created task appears in the left pane without a reload"` |
| US-G1.2 | `07-live-sync.test.ts › "US-G1.2: statuses, priorities and projects update live too"` (all four entity types) |
| US-G2.1 | `07-live-sync.test.ts › "US-G2: a UI change is visible to the agent's very next answer"` |
| US-G3.1 | `07-live-sync.test.ts › "US-G3.1: last write wins when the UI and the agent edit the same task"` (writes sequenced, so the winner is determinate) |
| US-G3.2 | `07-live-sync.test.ts › "US-G3.2: overlapping edits converge, with no error or lock state"` (writes overlapped; convergence asserted against whatever the database says) |
| US-G4 | **Open gap** — parity capstone (Phase 7, `08-parity.test.ts`) |

## Baselines

`baselines/*.png` are captured at fixed viewports (1440×900, and 420×900 for
`shell-narrow`) and committed as phase evidence. They are **not** asserted
inside the suite: plan §3.2 lists visual regression as a phase-boundary check,
and pixel diffs across machines and font rendering would be the suite's first
flake source — which §4.5's "flake is never retried away" rule makes a
liability rather than a nuisance. Compare deliberately with
`agent-browser diff screenshot --baseline`.
