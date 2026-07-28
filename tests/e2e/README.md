# End-to-end tests

Browser-driven tests written with `node:test` and driven by the pinned
`agent-browser` CLI (`pnpm exec agent-browser`), run with `pnpm test:e2e`.
They are deliberately serialised (`--test-concurrency=1`) because they share
one browser profile and one database.

```bash
pnpm test:e2e        # next build, then the whole suite
pnpm test:e2e:only   # skip the build (iterating; requires an existing .next)
```

`test:e2e` chains the build with `&&` rather than using a `pretest:e2e`
script: pnpm does not run pre/post lifecycle scripts by default, so that
script would silently never fire. `harness/server.ts` refuses to start
without `.next/BUILD_ID` and says how to get one.

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
│   ├── db.ts         # reset + seed + direct row assertions
│   ├── fixtures.ts   # preconditions, written through lib/actions
│   └── setup.ts      # per-file before/beforeEach/after
├── baselines/        # committed screenshots (phase evidence, not a gate)
├── artifacts/        # per-run console/errors/screenshot dumps (gitignored)
├── 01-foundation.test.ts
├── 02-tasks-ui.test.ts
├── 03-projects-ui.test.ts
├── 04-statuses-ui.test.ts
└── 05-priorities-ui.test.ts
```

## `data-testid` conventions (implementation plan §2.7)

Attributes only — no testid is ever read by business logic.

| Surface | testids |
| --- | --- |
| Shell | `app-shell`, `task-pane`, `chat-pane`, `chat-placeholder`, `chat-composer-disabled` |
| Tabs | `tab-tasks`, `tab-lists`, `panel-tasks`, `panel-lists` |
| Task filters | `filter-project-<id>`, `filter-status-<id>`, `filter-priority-<id>`, `status-filter-hint`, `task-search-input`, `show-completed-toggle`, `clear-filters` |
| Task list | `task-list-loading`, `task-list-error`, `task-list-empty`, `task-row-<id>` (+ `data-completed`), `task-title-<id>`, `task-project-chip-<id>`, `task-status-chip-<id>`, `task-priority-chip-<id>`, `task-status-select-<id>`, `task-edit-<id>`, `task-delete-<id>` |
| Task form | `task-create-open`, `task-form-dialog`, `task-form-title`, `task-form-description`, `task-form-project`, `task-form-project-readonly`, `task-form-status`, `task-form-priority`, `task-form-submit`, `task-form-cancel`, `task-form-error` |
| Delete dialogs | `delete-<entity>-<id>-dialog`, `-confirm`, `-cancel`, `-error` |
| Projects | `projects-panel-{loading,error,empty}`, `project-row-<id>`, `project-name-<id>`, `project-rename-<id>` (+ `-input`/`-submit`/`-cancel`/`-error`), `project-delete-<id>`, `project-create-{input,submit,error}` |
| Statuses | `manage-project-select`, `statuses-panel-{loading,error,empty}`, `status-row-<id>` (+ `data-completed`), `status-name-<id>`, `status-rename-<id>` (+ `-input`/…), `status-up-<id>`, `status-down-<id>`, `status-completed-<id>`, `status-delete-<id>`, `status-create-{input,completed,submit,error}` |
| Priorities | `priorities-panel-{loading,error,empty}`, `priority-row-<id>` (+ `data-default`), `priority-name-<id>`, `priority-rename-<id>` (+ `-input`/…), `priority-up-<id>`, `priority-down-<id>`, `priority-set-default-<id>`, `priority-default-badge-<id>`, `priority-delete-<id>`, `priority-create-{input,submit,error}` |

Rows are counted with prefix selectors: `[data-testid^="task-row-"]`,
`[data-testid^="status-row-"]`, `[data-testid^="priority-row-"]`,
`[data-testid^="project-row-"]`.

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
| US-F1 – US-F6 | **Open gap** — the agent does not exist yet (Phase 4/5, `06-agent-chat.test.ts`) |
| US-G1 – US-G4 | **Open gap** — live sync and parity (Phase 6/7, `07-live-sync.test.ts`, `08-parity.test.ts`) |

## Baselines

`baselines/*.png` are captured at fixed viewports (1440×900, and 420×900 for
`shell-narrow`) and committed as phase evidence. They are **not** asserted
inside the suite: plan §3.2 lists visual regression as a phase-boundary check,
and pixel diffs across machines and font rendering would be the suite's first
flake source — which §4.5's "flake is never retried away" rule makes a
liability rather than a nuisance. Compare deliberately with
`agent-browser diff screenshot --baseline`.
