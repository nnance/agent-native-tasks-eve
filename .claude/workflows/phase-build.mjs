export const meta = {
  name: 'phase-build',
  description: 'Run one implementation-plan phase end-to-end: explore, design, implement, review, verify with screenshots, document, PR',
  whenToUse:
    'Invoke once per phase of docs/implementation-plan.md, passing args {phase: N}. Phases are sequential; run N only after N-1 is merged to main.',
  phases: [
    { title: 'Explore', detail: 'read-only agents map the repo state relevant to this phase' },
    { title: 'Design', detail: 'competing architecture proposals, then a synthesis judge picks one' },
    { title: 'Implement', detail: 'single sequential agent writes code and commits as it goes' },
    { title: 'Review', detail: 'parallel reviewers on correctness, simplicity, conventions' },
    { title: 'Fix', detail: 'apply high-severity review findings' },
    { title: 'Verify', detail: 'run the app, capture acceptance-criteria evidence, write the verification packet' },
    { title: 'Ship', detail: 'decisions doc, push branch, open PR, merge' },
  ],
}

// ---------------------------------------------------------------------------
// Phase table — derived from docs/implementation-plan.md §4
// ---------------------------------------------------------------------------

const PHASES = {
  0: {
    title: 'Foundations',
    goal:
      'Dependencies, env, Drizzle schema + initial migration + idempotent seed, withEve() wiring, agent scaffold.',
    scope: [
      'Add deps: drizzle-orm, postgres, drizzle-kit, @tanstack/react-query, vitest. Install eve (prefer `npx eve@latest init .`; if it misbehaves under pnpm, fall back to `pnpm add eve@latest` + hand-created agent/ — see plan §6 risk 3).',
      'DATABASE_URL and AI_GATEWAY_API_KEY are ALREADY provisioned in .env.local (Neon Postgres + Vercel AI Gateway). Do NOT re-provision. Do check .env.example is created and checked in with the key names only.',
      'Drizzle schema per plan §2.2 (projects, statuses, priorities, tasks, chat_state) + initial migration + idempotent seed script (pnpm db:seed) that creates the "Personal" project and its default statuses/priorities ONLY when projects is empty.',
      'Wrap next.config.ts with withEve(); scaffold agent/agent.ts + agent/instructions.md; confirm pnpm dev boots Next + EVE.',
      'Commit the .agents/ and .claude/skills Neon agent skills and skills-lock.json that were installed during provisioning, and the .gitignore change adding .vercel.',
    ],
    exit:
      'Migrations apply to the Neon Postgres; seed produces the Personal project exactly once and is safe to re-run (US-A1); EVE dev loop responds.',
    stories: ['US-A1'],
    ui: false,
    evidence:
      'CLI evidence: `pnpm db:migrate` output, `pnpm db:seed` run TWICE showing idempotency, a psql/drizzle query listing the seeded project + statuses + priorities, and proof the dev server boots with EVE mounted.',
    explorers: 2,
    architects: 2,
  },
  1: {
    title: 'Shared action layer',
    goal:
      'lib/schemas/ (Zod input schemas per capability) and lib/actions/ (the single home for every business rule), with Vitest coverage.',
    scope: [
      'One Zod input schema per capability in product-spec §5 — these exact schema objects are the parity contract, later imported by BOTH the API routes and the EVE tools.',
      'One action function per capability enforcing every product-spec §7 rule: project immutability (tasks never change project), per-project scoping of statuses/priorities, block-delete-if-in-use, minimum-one status/priority per project, default-priority reassignment, exactly-one-default.',
      'Typed RuleViolation errors carrying human-readable messages (e.g. "Project \'Design\' still has 4 tasks").',
      'Confirmation/approval is deliberately NOT in this layer — it is per-interface UX. Do not add it here.',
      'Vitest unit tests covering every rule, every creation default, and seed idempotency.',
    ],
    exit: 'Action tests green. Rules live here and are never re-checked downstream.',
    stories: [],
    ui: false,
    evidence: 'CLI evidence: full `pnpm test` run output showing every rule test passing, plus `pnpm typecheck`.',
    explorers: 2,
    architects: 3,
  },
  2: {
    title: 'API routes',
    goal: 'Thin route handlers under app/api/ per plan §2.3 wrapping the action layer.',
    scope: [
      'Routes exactly per plan §2.3, including /api/chat-state (GET/PUT).',
      'Each handler: parse -> validate with the SHARED zod schema from lib/schemas -> call the action -> map result or RuleViolation to JSON with the right status code. No business logic in routes.',
      'PATCH /statuses/[id] covers rename/reorder/toggle-completed; PATCH /priorities/[id] covers rename/reorder/set-default.',
      'GET /api/tasks supports ?project=&status=&priority=&q=&includeCompleted=.',
    ],
    exit:
      'Every capability is exercisable end-to-end via curl against the seeded DB, including blocked-delete error bodies.',
    stories: [],
    ui: false,
    evidence:
      'CLI evidence: a committed scripts/verify/phase-2-curl.sh that exercises every route against a running dev server, with its captured transcript showing success paths AND rule-violation error bodies.',
    explorers: 2,
    architects: 2,
  },
  3: {
    title: 'Task UI + list management',
    goal: 'Split-screen shell plus the full direct-manipulation task and list-management UI (Epics B-E).',
    scope: [
      'app/page.tsx becomes the split-screen per product-spec §8.0: left = task UI, right = chat placeholder. Both permanently visible; stack on narrow viewports.',
      'Left pane: task list with filter chips (project/status/priority), text search, sort per §8.1, show-completed toggle; task create/edit forms; quick status move; delete confirmation dialogs.',
      'List management surface for projects/statuses/priorities in per-project context.',
      'TanStack Query over the API routes (chosen for its invalidation primitives, which Phase 6 live sync depends on).',
      'shadcn components throughout, added via the shadcn CLI as needed. Consult the vercel:shadcn skill guidance before adding components.',
    ],
    exit: 'Every Epic B, C, D, E acceptance criterion passes by hand against the running app.',
    stories: [
      'US-B1', 'US-B2', 'US-B3', 'US-B4', 'US-B5', 'US-B6',
      'US-C1', 'US-C2', 'US-C3',
      'US-D1', 'US-D2',
      'US-E1', 'US-E2',
    ],
    ui: true,
    evidence: 'Browser screenshots via agent-browser, one or more per acceptance criterion.',
    explorers: 3,
    architects: 3,
  },
  4: {
    title: 'EVE agent (Epic F backend half)',
    goal: 'The full EVE tool inventory per plan §2.4, backed by the shared action layer.',
    scope: [
      'One tool per row of the plan §2.4 inventory, each importing the SHARED zod schema and the action function — never re-implementing rules.',
      'Approval policies exactly as tabled: always() for delete_project, delete_task, bulk_update_tasks, bulk_delete_tasks, delete_status, delete_priority; never() for the rest.',
      'agent/instructions.md: concise task-assistant persona, always ground answers in tool reads, never invent tasks, prefer bulk_* whenever more than one task is affected, explain rule violations and offer alternatives, summarize actions plainly after acting.',
      'toModelOutput trimming on list results (counts + compact rows to the model, full rows to the channel).',
      'Re-verify EVE API shapes against node_modules/eve/docs/ and eve.dev before coding — the framework is young (plan §6 risk 2).',
    ],
    exit: 'Every capability is drivable from the EVE dev loop; deletes and bulk operations pause for approval there.',
    stories: ['US-F2', 'US-F3', 'US-F4', 'US-F5'],
    ui: false,
    evidence:
      'CLI evidence: non-interactive EVE runs (prefer `eve` CLI / a scripted harness over the interactive TUI) showing a grounded read, a rule violation relayed with an alternative, and a delete pausing for approval. Capture transcripts.',
    explorers: 3,
    architects: 2,
  },
  5: {
    title: 'Chat UI rewire (Epic F frontend half)',
    goal: 'Replace the scripted demo chat with a real useEveAgent-driven conversation, including approval cards and persistence.',
    scope: [
      'Replace the createChat fake transport in app/page.tsx with useEveAgent from eve/react; real text composer; drop the demo dropdown items (attachments/deep-research).',
      'Keep the existing shadcn chat kit components (MessageScroller*, Message/MessageAnimated, InputGroup, Card, Empty, Tooltip).',
      'Render message parts: text -> prose bubbles; tool-call/tool-result -> compact structured action entries ("Created task Fix header in Website") per US-F6; dynamic-tool with toolMetadata.eve.inputRequest -> approval card showing the request prompt and Approve/Deny buttons responding via agent.send({ inputResponses }).',
      'The approval card MUST render tool inputs legibly — which tasks, what change (US-F5.2). This is the safety UX; budget real design effort for it (plan §6 risk 6). Consult the frontend-design skill.',
      'Persistence: useEveAgent({ initialEvents, initialSession, onFinish }); onFinish PUTs { events, session } to /api/chat-state; the page server-loads the snapshot and passes it in. Always persist the full session cursor (all three fields).',
    ],
    exit:
      'US-F1 through US-F6 pass in the browser, including reload-and-continue ("move that one to Done" after a page refresh).',
    stories: ['US-F1', 'US-F2', 'US-F3', 'US-F4', 'US-F5', 'US-F6'],
    ui: true,
    evidence:
      'Browser screenshots via agent-browser, one or more per acceptance criterion, including the approval card and the reload-and-continue sequence.',
    explorers: 3,
    architects: 3,
  },
  6: {
    title: 'Live sync + parity validation (Epic G)',
    goal: 'Agent changes appear live in the task pane; evals lock in agent behavior; the full parity matrix is walked.',
    scope: [
      'useEveAgent({ onEvent }) watches action/tool-result events and invalidates the relevant TanStack Query keys so the left pane refetches within the same second.',
      'Backstop: refetch-on-window-focus plus a modest polling interval (~30s).',
      'Convergence (US-G3): last-write-wins via unconditioned row updates; no locking. Verify the G3 scenario explicitly.',
      'EVE evals in evals/ for the high-value behaviors: refuses project moves with an explanation, never deletes without approval, states its plan before bulk changes, produces grounded counts. Runnable via `eve eval`.',
      'Walk the full parity matrix in the user-stories appendix: every row through BOTH interfaces. Record the results in the appendix table.',
    ],
    exit: 'US-G1 through US-G4 pass; the parity matrix is fully checked; evals are green.',
    stories: ['US-G1', 'US-G2', 'US-G3', 'US-G4'],
    ui: true,
    evidence:
      'Browser screenshots showing before/after live updates without a manual refresh, plus the `eve eval` run output and the completed parity matrix.',
    explorers: 3,
    architects: 2,
  },
  7: {
    title: 'Hardening & handoff',
    goal: 'End-to-end pass on the running app, accurate docs, documented deploy posture.',
    scope: [
      'Full end-to-end pass on the running app; fix whatever falls out.',
      'Rewrite README: setup (env vars, migrate, seed, dev), architecture overview pointing at docs/, how to run evals.',
      'Document deploy posture (Vercel + withEve build outputs). The channel auth decision stays deferred until a deploy is actually wanted — say so explicitly rather than inventing an auth scheme.',
      'Re-run every prior phase verification packet and note any regressions.',
    ],
    exit: 'A clean clone reaches a running app in 5 commands or fewer, and the docs are accurate.',
    stories: ['US-A1', 'US-G4'],
    ui: true,
    evidence:
      'A clean-clone walkthrough transcript plus browser screenshots of the finished app exercising a representative slice of every epic.',
    explorers: 2,
    architects: 2,
  },
}

// ---------------------------------------------------------------------------
// Arg handling
// ---------------------------------------------------------------------------

const phaseNum = typeof args === 'number' ? args : Number(args?.phase)
if (!Number.isInteger(phaseNum) || !PHASES[phaseNum]) {
  throw new Error(`phase-build requires args {phase: N} where N is 0-7. Got: ${JSON.stringify(args)}`)
}
const P = PHASES[phaseNum]
const branch = `phase-${phaseNum}-${P.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
const decisionsDoc = `docs/decisions/phase-${phaseNum}-decisions.md`
const packetDir = `docs/verification/phase-${phaseNum}`
const packetDoc = `${packetDir}/README.md`

// Shared preamble every agent gets.
const HOUSE_RULES = `
## Project ground rules (non-negotiable)

- Repo: /Users/nicknance/Developer/genai/agent-native-tasks-eve. Package manager: **pnpm**. Git branch for this phase: \`${branch}\` (already created and checked out — do NOT create or switch branches).
- **AGENTS.md mandate:** this is NOT the Next.js you know. Version 16.2.6 has breaking changes from your training data. **Read the relevant guide under \`node_modules/next/dist/docs/\` before writing any Next.js code**, and heed deprecation notices. This applies to route handlers, config, caching, and params semantics.
- EVE is young and evolving. The installed-version source of truth is \`node_modules/eve/docs/\` — read it rather than recalling APIs. \`docs/eve-framework-notes.md\` records what was true on 2026-07-27.
- The governing documents are \`docs/product-spec.md\`, \`docs/user-stories.md\`, and \`docs/implementation-plan.md\`. Read the sections relevant to your task. The implementation plan is authoritative on architecture; do not silently redesign it.
- **Never ask the user a question.** If something is underspecified, choose the option you would recommend, proceed, and record the choice as a decision or assumption so it lands in \`${decisionsDoc}\`.
- Credentials are already provisioned in \`.env.local\`: \`DATABASE_URL\` (Neon Postgres) and \`AI_GATEWAY_API_KEY\` (Vercel AI Gateway). Never print, echo, commit, or paste secret values. \`.env*\` is gitignored — keep it that way.
- Never commit secrets, \`node_modules\`, or \`.next\`.
`.trim()

const PHASE_BRIEF = `
## Phase ${phaseNum}: ${P.title}

**Goal:** ${P.goal}

**Scope:**
${P.scope.map((s) => `- ${s}`).join('\n')}

**Exit criteria:** ${P.exit}

**User stories that must demonstrably pass:** ${P.stories.length ? P.stories.join(', ') : 'none directly — this phase is infrastructure; its exit criteria are the acceptance test'}

**Verification evidence for this phase:** ${P.evidence}
`.trim()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const EXPLORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keyFiles', 'patterns', 'risks'],
  properties: {
    summary: { type: 'string', description: 'What exists today that this phase must build on or change' },
    keyFiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'why'],
        properties: { path: { type: 'string' }, why: { type: 'string' } },
      },
    },
    patterns: { type: 'array', items: { type: 'string' }, description: 'Conventions new code must follow' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach', 'filesToCreate', 'filesToModify', 'buildSequence', 'tradeoffs', 'openDecisions'],
  properties: {
    approach: { type: 'string', description: 'The architecture in prose — how it hangs together' },
    filesToCreate: { type: 'array', items: { type: 'string' } },
    filesToModify: { type: 'array', items: { type: 'string' } },
    buildSequence: { type: 'array', items: { type: 'string' }, description: 'Ordered steps, each independently commitable' },
    tradeoffs: { type: 'array', items: { type: 'string' } },
    openDecisions: {
      type: 'array',
      description: 'Underspecified points this approach had to decide',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'choice', 'rationale'],
        properties: { question: { type: 'string' }, choice: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
  },
}

const BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['chosen', 'why', 'blueprint', 'buildSequence', 'decisions', 'assumptions'],
  properties: {
    chosen: { type: 'string', description: 'Which proposal won, or "synthesis" if merged' },
    why: { type: 'string' },
    blueprint: { type: 'string', description: 'The full implementation blueprint the implementer will follow' },
    buildSequence: { type: 'array', items: { type: 'string' } },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'choice', 'rationale', 'alternatives'],
        properties: {
          question: { type: 'string' },
          choice: { type: 'string' },
          rationale: { type: 'string' },
          alternatives: { type: 'string' },
        },
      },
    },
    assumptions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assumption', 'basis', 'ifWrong'],
        properties: { assumption: { type: 'string' }, basis: { type: 'string' }, ifWrong: { type: 'string' } },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'commits', 'filesChanged', 'decisions', 'assumptions', 'deviations', 'howToRun', 'incomplete'],
  properties: {
    status: { enum: ['complete', 'partial'] },
    summary: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' }, description: 'Short sha + subject of each commit made' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'choice', 'rationale'],
        properties: { question: { type: 'string' }, choice: { type: 'string' }, rationale: { type: 'string' } },
      },
    },
    assumptions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['assumption', 'basis', 'ifWrong'],
        properties: { assumption: { type: 'string' }, basis: { type: 'string' }, ifWrong: { type: 'string' } },
      },
    },
    deviations: { type: 'array', items: { type: 'string' }, description: 'Where the build departed from the blueprint or the implementation plan, and why' },
    howToRun: { type: 'string', description: 'Exact commands to start the app / run the tests for this phase' },
    incomplete: { type: 'array', items: { type: 'string' }, description: 'Anything in scope that was NOT finished' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'summary', 'why', 'suggestedFix'],
        properties: {
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          why: { type: 'string', description: 'Concrete failure scenario or concrete cost' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['packetPath', 'overall', 'criteria', 'notes'],
  properties: {
    packetPath: { type: 'string' },
    overall: { enum: ['pass', 'partial', 'fail'] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['story', 'criterion', 'result', 'evidence'],
        properties: {
          story: { type: 'string' },
          criterion: { type: 'string' },
          result: { enum: ['pass', 'fail', 'not-applicable', 'blocked'] },
          evidence: { type: 'string', description: 'Relative path to the screenshot or transcript proving it' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// Stage 1 — Explore
// ---------------------------------------------------------------------------

phase('Explore')
log(`Phase ${phaseNum} — ${P.title}: exploring the codebase on branch ${branch}`)

const EXPLORE_ANGLES = [
  'Current repository state and conventions: directory layout, TypeScript/ESLint/Prettier config, existing components and hooks, how app/page.tsx is wired today, what is already installed in package.json. Report exactly what a new contributor must match.',
  `The governing specs as they bear on THIS phase: read docs/product-spec.md, docs/user-stories.md and docs/implementation-plan.md and extract every requirement, rule and acceptance criterion that Phase ${phaseNum} must satisfy. Quote section numbers.`,
  `Framework ground truth for this phase: read the relevant guides under node_modules/next/dist/docs/ (Next.js 16.2.6 differs from training data) and, if eve is installed, node_modules/eve/docs/. Report the API shapes and conventions this phase's code must actually use, flagging anything that contradicts common training-data assumptions.`,
]

const explorations = await parallel(
  EXPLORE_ANGLES.slice(0, P.explorers).map((angle, i) => () =>
    agent(
      `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Your job\n\nYou are a read-only code explorer. Do not modify any file.\n\nFocus: ${angle}\n\nTrace comprehensively. Return the 5-10 files the implementer most needs to read, each with a one-line reason.`,
      { label: `explore:${i + 1}`, phase: 'Explore', schema: EXPLORE_SCHEMA, agentType: 'feature-dev:code-explorer' },
    ),
  ),
)

const exploreDigest = explorations
  .filter(Boolean)
  .map(
    (e, i) =>
      `### Exploration ${i + 1}\n${e.summary}\n\n**Key files:**\n${e.keyFiles
        .map((f) => `- \`${f.path}\` — ${f.why}`)
        .join('\n')}\n\n**Patterns to follow:**\n${e.patterns.map((p) => `- ${p}`).join('\n')}\n\n**Risks:**\n${e.risks
        .map((r) => `- ${r}`)
        .join('\n')}`,
  )
  .join('\n\n')

// ---------------------------------------------------------------------------
// Stage 2 — Design (competing proposals, then a synthesis judge)
// ---------------------------------------------------------------------------

phase('Design')

const ARCHITECT_LENSES = [
  {
    key: 'plan-faithful',
    brief:
      'Maximum fidelity to docs/implementation-plan.md. Follow its architecture, file layout and naming exactly. Deviate only where the plan is demonstrably wrong or impossible against the installed framework versions, and say so loudly.',
  },
  {
    key: 'clean',
    brief:
      'Cleanest long-term architecture: elegant abstractions, minimal duplication, testability, clear seams for the phases that follow. Still honor the plan\'s load-bearing decisions (shared action layer, shared zod schemas, rules only in actions).',
  },
  {
    key: 'pragmatic',
    brief:
      'Smallest change that fully satisfies the exit criteria. Maximum reuse of what already exists. Optimize for a reviewable diff and for not blocking later phases.',
  },
]

const proposals = await parallel(
  ARCHITECT_LENSES.slice(0, P.architects).map((lens) => () =>
    agent(
      `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Codebase exploration findings\n\n${exploreDigest}\n\n## Your job\n\nYou are a code architect. Do not modify any file. Design an implementation approach for Phase ${phaseNum} through this lens:\n\n**${lens.brief}**\n\nRead the key files listed above before designing. Produce a concrete blueprint: exact files to create and modify, the shape of each module, and an ordered build sequence where each step leaves the tree in a committable state.\n\nWherever the specs leave something underspecified, DECIDE — do not defer, do not ask. Record every such decision in openDecisions with your rationale.`,
      { label: `design:${lens.key}`, phase: 'Design', schema: DESIGN_SCHEMA, agentType: 'feature-dev:code-architect' },
    ),
  ),
)

const proposalDigest = proposals
  .filter(Boolean)
  .map(
    (p, i) =>
      `### Proposal ${i + 1}: ${ARCHITECT_LENSES[i].key}\n\n**Approach:** ${p.approach}\n\n**Create:** ${p.filesToCreate.join(
        ', ',
      )}\n\n**Modify:** ${p.filesToModify.join(', ')}\n\n**Build sequence:**\n${p.buildSequence
        .map((s, n) => `${n + 1}. ${s}`)
        .join('\n')}\n\n**Trade-offs:**\n${p.tradeoffs.map((t) => `- ${t}`).join('\n')}\n\n**Decisions made:**\n${p.openDecisions
        .map((d) => `- *${d.question}* → **${d.choice}** (${d.rationale})`)
        .join('\n')}`,
  )
  .join('\n\n---\n\n')

const blueprint = await agent(
  `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Codebase exploration findings\n\n${exploreDigest}\n\n## Competing architecture proposals\n\n${proposalDigest}\n\n## Your job\n\nYou are the deciding architect. Pick the proposal that best fits Phase ${phaseNum}, or synthesize the best of several. Bias toward fidelity to docs/implementation-plan.md — it is the agreed architecture — but graft in clearly superior ideas from the other proposals.\n\nProduce the single implementation blueprint the implementer will follow. It must be concrete and complete enough to build from without further design work: exact files, module shapes, function signatures, and an ordered build sequence where each step is independently committable.\n\nConsolidate EVERY decision and assumption from the proposals plus any you make yourself. These become the phase decisions document, so they must be self-contained and readable by someone who never saw the proposals: state the question, the choice, why, and what the alternatives were. Separate genuine *decisions* (a choice among viable options) from *assumptions* (something taken as true without confirmation) — for each assumption record its basis and what breaks if it is wrong.`,
  { label: 'design:decide', phase: 'Design', schema: BLUEPRINT_SCHEMA },
)

log(`Blueprint chosen: ${blueprint.chosen} — ${blueprint.decisions.length} decisions, ${blueprint.assumptions.length} assumptions`)

// ---------------------------------------------------------------------------
// Stage 3 — Implement (single sequential agent; owns the working tree)
// ---------------------------------------------------------------------------

phase('Implement')

const blueprintText = `## Approved blueprint (${blueprint.chosen})\n\n${blueprint.why}\n\n${blueprint.blueprint}\n\n### Build sequence\n${blueprint.buildSequence
  .map((s, i) => `${i + 1}. ${s}`)
  .join('\n')}\n\n### Decisions already made (do not relitigate)\n${blueprint.decisions
  .map((d) => `- *${d.question}* → **${d.choice}** — ${d.rationale}`)
  .join('\n')}\n\n### Standing assumptions\n${blueprint.assumptions
  .map((a) => `- ${a.assumption} (basis: ${a.basis}; if wrong: ${a.ifWrong})`)
  .join('\n')}`

const impl = await agent(
  `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Codebase exploration findings\n\n${exploreDigest}\n\n${blueprintText}\n\n## Your job\n\nYou are the sole implementer for Phase ${phaseNum}. You own the working tree — no other agent is editing files right now.\n\n1. Read the key files identified during exploration, and read \`node_modules/next/dist/docs/\` for anything Next.js-related, BEFORE writing code.\n2. Work the build sequence in order. **Commit after each step that leaves the tree working** — small, focused commits with conventional-commit subjects. Do not wait until the end to commit.\n3. Every commit message must end with these two trailer lines, separated from the body by a blank line:\n\n\`\`\`\nCo-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>\nCo-Authored-By: Nick Nance <nance.nick@gmail.com>\n\`\`\`\n\n4. Follow the existing conventions exactly. Run \`pnpm typecheck\` and \`pnpm lint\` as you go; both must be clean before you finish. If the phase has tests, they must pass.\n5. Do not commit \`.env.local\` or any secret. Do not push. Do not open a PR. Do not switch branches.\n6. If you hit something underspecified, decide it yourself using your best judgment and record it in \`decisions\` or \`assumptions\`. Never ask the user.\n7. If part of the scope proves genuinely blocked, finish everything else in full and list what you left out and why in \`incomplete\` — do not silently narrow the scope.\n\nBefore returning, run \`git log --oneline\` for the commits you made and \`git status\` to confirm nothing important is left uncommitted.`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA },
)

log(`Implementation ${impl.status}: ${impl.commits.length} commits, ${impl.filesChanged.length} files`)
if (impl.incomplete.length) log(`Incomplete items carried forward: ${impl.incomplete.join('; ')}`)

// ---------------------------------------------------------------------------
// Stage 4 — Review (parallel, read-only) then a single fixer
// ---------------------------------------------------------------------------

phase('Review')

const REVIEW_LENSES = [
  {
    key: 'correctness',
    brief:
      'Bugs and functional correctness. Does the code actually satisfy the phase exit criteria and the product-spec §7 rules? Hunt for logic errors, unhandled cases, race conditions, incorrect async/transaction handling, and rules enforced in the wrong layer.',
  },
  {
    key: 'simplicity',
    brief:
      'Simplicity, DRY and elegance. Duplication, needless abstraction, dead code, over-engineering, functions doing too much, naming that obscures intent.',
  },
  {
    key: 'conventions',
    brief:
      'Project conventions and architectural fidelity. Does it match the repo\'s existing patterns, the implementation plan\'s architecture, and — critically — the Next.js 16.2.6 / EVE APIs as documented in node_modules, rather than training-data recollections? Flag any deprecated or hallucinated API usage.',
  },
]

const reviews = await parallel(
  REVIEW_LENSES.map((lens) => () =>
    agent(
      `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## What was just implemented\n\n${impl.summary}\n\nFiles changed: ${impl.filesChanged.join(
        ', ',
      )}\n\nDeviations from the blueprint: ${impl.deviations.join('; ') || 'none reported'}\n\n## Your job\n\nYou are a code reviewer. **Do not modify any file.** Review the changes on branch \`${branch}\` (use \`git diff main...HEAD\` and read the changed files in full).\n\nFocus: **${lens.brief}**\n\nReport only findings you are confident are real and that genuinely matter. For each, give a concrete failure scenario or concrete cost — not a style opinion. An empty findings list is a valid and useful answer. Do not invent work.`,
      { label: `review:${lens.key}`, phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'feature-dev:code-reviewer' },
    ),
  ),
)

const allFindings = reviews.filter(Boolean).flatMap((r) => r.findings)
const actionable = allFindings.filter((f) => f.severity === 'critical' || f.severity === 'high')
log(`Review: ${allFindings.length} findings, ${actionable.length} at critical/high severity`)

phase('Fix')

let fixNotes = 'No critical or high severity findings — nothing to fix.'
if (actionable.length) {
  fixNotes = await agent(
    `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Your job\n\nYou own the working tree on branch \`${branch}\`. Three reviewers examined the Phase ${phaseNum} implementation. Fix the critical and high severity findings below.\n\n${actionable
      .map(
        (f, i) =>
          `${i + 1}. **[${f.severity}] ${f.file}** — ${f.summary}\n   Why it matters: ${f.why}\n   Suggested fix: ${f.suggestedFix}`,
      )
      .join('\n\n')}\n\nFor each finding: verify it is real before acting — reviewers are sometimes wrong. Fix the real ones. If a finding is a false positive or the fix would be worse than the problem, skip it and say why.\n\nAlso for reference, the lower-severity findings (fix only the cheap, clearly-correct ones):\n${allFindings
      .filter((f) => f.severity === 'medium' || f.severity === 'low')
      .map((f) => `- [${f.severity}] ${f.file}: ${f.summary}`)
      .join('\n') || '(none)'}\n\nWhen done, \`pnpm typecheck\` and \`pnpm lint\` must be clean and any tests must pass. Commit the fixes (one commit is fine, or a few focused ones) with the same two Co-Authored-By trailers used throughout this branch. Do not push and do not open a PR.\n\nReturn a plain-text report: what you fixed, what you skipped and why.`,
    { label: 'fix', phase: 'Fix' },
  )
}

// ---------------------------------------------------------------------------
// Stage 5 — Verify (single agent; owns the dev server and the browser session)
// ---------------------------------------------------------------------------

phase('Verify')

const BROWSER_INSTRUCTIONS = `
### Capturing screenshots

Use the \`agent-browser\` CLI (already installed at /opt/homebrew/bin/agent-browser). Read its usage guide first: \`agent-browser skills get core --full\`.

Isolate your browser session so you never touch the user's own browser:

\`\`\`bash
export AGENT_BROWSER_SESSION=phase-${phaseNum}-verify
\`\`\`

Typical loop:

\`\`\`bash
agent-browser open http://localhost:3100
agent-browser snapshot -i                 # find refs
agent-browser click @e3                   # act
agent-browser wait --load networkidle
agent-browser screenshot ${packetDir}/<story>-<criterion>.png
\`\`\`

Refs go stale after any page change — re-snapshot before each ref interaction. When finished: \`agent-browser close --all\`.

Run the dev server yourself on **port 3100** so you do not collide with anything the user is running (\`PORT=3100 pnpm dev\`), in the background. Make sure the database is migrated and seeded first. Shut the server down when you are done.

Screenshots must actually show the criterion being satisfied — capture the state *after* the action, with the relevant UI visible. Crop or scope with \`-s <selector>\` when a full-page shot would bury the point. Name files so the packet reads clearly.
`.trim()

const CLI_INSTRUCTIONS = `
### Capturing evidence

This phase produces no user-visible UI, so the packet is built from command transcripts rather than screenshots. Capture real, complete output — run the commands, save stdout/stderr to files under \`${packetDir}/\`, and embed the relevant excerpts in the packet with fenced code blocks. Never fabricate or paraphrase output.

${P.evidence}

Where a step genuinely requires an interactive TUI that cannot be driven non-interactively, say so plainly in the packet and provide the closest non-interactive equivalent as evidence rather than claiming a pass you did not observe.
`.trim()

const verification = await agent(
  `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## What was implemented\n\n${impl.summary}\n\nHow to run it: ${impl.howToRun}\n\nKnown incomplete items: ${impl.incomplete.join('; ') || 'none'}\n\n## Your job\n\nBuild the **verification packet** for Phase ${phaseNum} at \`${packetDoc}\`, with evidence files alongside it in \`${packetDir}/\`.\n\n1. Read \`docs/user-stories.md\` and extract the **verbatim acceptance criteria** for: ${P.stories.length ? P.stories.join(', ') : 'this phase\'s exit criteria (no user stories map directly — use the exit criteria as the checklist)'}.\n2. Exercise each criterion against the real running system and capture evidence for it.\n3. Write \`${packetDoc}\`: a table of story → criterion → result → evidence link, with each screenshot or transcript embedded or linked inline beneath its criterion. Open with a one-paragraph summary and the overall verdict.\n4. Report honestly. A criterion that fails is a **fail** — record it with what actually happened. Do not paper over gaps; the packet's only value is that it can be trusted.\n\n${P.ui ? BROWSER_INSTRUCTIONS : CLI_INSTRUCTIONS}\n\nCommit the packet and its evidence files (\`docs: add phase ${phaseNum} verification packet\`) with the same two Co-Authored-By trailers used throughout this branch. Screenshots belong in git — they are the deliverable. Do not push and do not open a PR.`,
  { label: 'verify', phase: 'Verify' , schema: VERIFY_SCHEMA },
)

const failed = verification.criteria.filter((c) => c.result === 'fail' || c.result === 'blocked')
log(`Verification ${verification.overall}: ${verification.criteria.length} criteria, ${failed.length} not passing`)

// ---------------------------------------------------------------------------
// Stage 6 — Ship (decisions doc, push, PR, merge)
// ---------------------------------------------------------------------------

phase('Ship')

const decisionsPayload = `
### Decisions from design
${blueprint.decisions.map((d) => `- **${d.question}** → ${d.choice}\n  - Rationale: ${d.rationale}\n  - Alternatives considered: ${d.alternatives}`).join('\n') || '(none)'}

### Assumptions from design
${blueprint.assumptions.map((a) => `- **${a.assumption}**\n  - Basis: ${a.basis}\n  - If wrong: ${a.ifWrong}`).join('\n') || '(none)'}

### Decisions made during implementation
${impl.decisions.map((d) => `- **${d.question}** → ${d.choice} — ${d.rationale}`).join('\n') || '(none)'}

### Assumptions made during implementation
${impl.assumptions.map((a) => `- **${a.assumption}** (basis: ${a.basis}; if wrong: ${a.ifWrong})`).join('\n') || '(none)'}

### Deviations from docs/implementation-plan.md
${impl.deviations.map((d) => `- ${d}`).join('\n') || '(none)'}

### Review outcome
${allFindings.length} findings raised (${actionable.length} critical/high).

${fixNotes}

### Verification outcome
Overall: **${verification.overall}**. ${verification.criteria.length} criteria checked; ${failed.length} not passing.
${failed.map((c) => `- ${c.story} — ${c.criterion}: ${c.result}`).join('\n')}

### Carried forward
${impl.incomplete.map((i) => `- ${i}`).join('\n') || '(nothing)'}
`.trim()

const shipReport = await agent(
  `${HOUSE_RULES}\n\n${PHASE_BRIEF}\n\n## Your job\n\nClose out Phase ${phaseNum}.\n\n**Step 1 — write \`${decisionsDoc}\`.** A standalone document a future maintainer can read without any of this conversation's context. Structure it as:\n\n- Title, phase, date (get today's date with \`date +%Y-%m-%d\`), and a one-paragraph summary of what the phase delivered.\n- **Decisions** — each with the question, the choice, the rationale, and the alternatives rejected. Prose, not a bare list; explain enough that someone can later disagree on the merits.\n- **Assumptions** — each with its basis and what would break if it turns out to be wrong.\n- **Deviations from the implementation plan** — if any, with justification. If none, say so.\n- **Known gaps / carried forward** — anything in scope that was not finished, and anything the next phase inherits.\n\nSource material (rewrite it into readable prose; do not just paste it):\n\n${decisionsPayload}\n\n**Step 2 — sanity-check the branch.** Run \`pnpm typecheck\` and \`pnpm lint\`, and the test suite if one exists. Everything must be clean. Fix trivial breakage yourself; if something is substantively broken, stop and report it rather than merging.\n\n**Step 3 — verify nothing sensitive is staged.** \`git status\` must show no \`.env*\` files and no secrets in the diff.\n\n**Step 4 — commit and push.** Commit the decisions doc (\`docs: record phase ${phaseNum} decisions and assumptions\`) with the two Co-Authored-By trailers. Then \`git push -u origin ${branch}\`.\n\n**Step 5 — open the PR** with \`gh pr create --base main --head ${branch}\`. Title: \`Phase ${phaseNum}: ${P.title}\`. The body must contain:\n- What this phase delivers, in a few sentences.\n- The exit criteria and whether each is met.\n- A link to \`${decisionsDoc}\` and a short bulleted digest of the most consequential decisions.\n- A link to \`${packetDoc}\` and the verification verdict (${verification.overall}), including any failing criteria stated plainly.\n- Anything carried forward to the next phase.\n- End the body with these two lines:\n\n\`\`\`\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_01VYRmjT7JfgLtrGVLNkQim7\n\`\`\`\n\n**Step 6 — merge.** The repo has no CI workflows, so there are no remote checks to await. Since local typecheck/lint/tests are green, run \`gh pr merge --squash --delete-branch\` to squash-merge into main. Then \`git checkout main && git pull\`.\n\n**Do not merge** if step 2 failed or if the verification verdict is \`fail\`. In that case push the branch, open the PR, leave it open, and say clearly in your report that it needs attention.\n\nReturn a plain-text report: the PR URL, whether it merged, and anything the next phase needs to know.`,
  { label: 'ship', phase: 'Ship' },
)

return {
  phase: phaseNum,
  title: P.title,
  branch,
  implementation: { status: impl.status, commits: impl.commits.length, incomplete: impl.incomplete },
  review: { total: allFindings.length, actionable: actionable.length },
  verification: { overall: verification.overall, notPassing: failed },
  decisionsDoc,
  packetDoc,
  ship: shipReport,
}
