/**
 * Non-interactive EVE runs against the real agent, for the Phase 4 evidence.
 *
 * The phase's exit criteria ask for CLI evidence — a grounded read, a rule
 * violation relayed with an alternative, and a delete pausing for approval —
 * captured as transcripts. This drives `eve/client` against a real `next dev`
 * with the eve runtime mounted by `withEve`, which is exactly "the EVE dev
 * loop" minus the interactive TUI.
 *
 * **Why `scripts/` and not `tests/`.** Every run here makes real, paid,
 * non-deterministic model calls. Inside `pnpm test` a flaky third-party model
 * would poison the regression signal for the rules the unit suite actually
 * proves. `eve eval` and the browser-driven chat suite are deliberately not
 * used either: the implementation plan assigns those to Phases 6 and 5.
 *
 * **Which database.** The test one. `startApiServer()` from
 * tests/api/support/server.ts already spawns `next dev` with `DATABASE_URL`
 * overridden to `resolveTestDbUrl()` in the child environment only — never on
 * the command line, so no credential reaches a process listing or a
 * transcript — and refuses outright when the test URL equals the dev one. This
 * script creates and deletes real committed rows, including through an
 * approved delete gate; doing that to the developer's working data would be
 * needless. That module is dev-server plumbing rather than test
 * infrastructure: it imports nothing from `node:test`, so a script may use it.
 * (`tests/support/db.ts` is not safe to import this way — it registers an
 * import-time `after()` hook — which is why every post-condition below is read
 * back over HTTP instead.)
 *
 * **Why post-conditions go through the API.** "The task is really gone" and
 * "all four rows really moved" have to be independent reads of committed
 * state, not a restatement of what the agent claimed. One transport, no second
 * connection pool.
 *
 * Run with no other `pnpm dev` or `eve dev` process active: they share the
 * `.eve/` runtime state and the `.next/` build directory.
 *
 *   pnpm verify:agent
 */

import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { Client, type ClientSession } from "eve/client"
import type { InputRequest } from "eve/client"
import type { HandleMessageStreamEvent } from "eve/client"

import {
  apiJson,
  startApiServer,
  stopApiServer,
} from "../tests/api/support/server.ts"

const outputDir = fileURLToPath(
  new URL("../docs/verification/phase-4/", import.meta.url)
)

/** How long one turn may take before the harness gives up on it. */
const TURN_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// Wire types for the API reads. Deliberately minimal: this file asserts facts
// about committed state, not about the shape of the HTTP layer.
// ---------------------------------------------------------------------------

type ProjectRow = { id: string; name: string }
type StatusRow = { id: string; name: string; isCompleted: boolean }
type TaskRow = {
  id: string
  title: string
  status: { id: string; name: string }
  priority: { id: string; name: string }
}

// ---------------------------------------------------------------------------
// Turn capture
// ---------------------------------------------------------------------------

type ToolCall = { name: string; input: unknown }

type Turn = {
  /** Every stream event, verbatim, so a transcript stays valid evidence even
   *  if the derived summaries below ever need re-deriving. */
  events: HandleMessageStreamEvent[]
  toolCalls: ToolCall[]
  approvalRequests: InputRequest[]
  /** Every assistant message of the turn, in order. */
  messages: string[]
  /**
   * The last assistant message. Keep using this only where the assertion is
   * genuinely about how the turn *closes*. For "did the agent say X", prefer
   * `transcript()` — a model is free to state a grounded fact mid-turn and
   * close with a shorter line, which is not a defect.
   */
  finalMessage: string
  failed: { code: string; message: string } | undefined
}

/**
 * Every assistant message of the given turns as one string.
 *
 * Content assertions ("did the agent say the count", "did it explain the
 * refusal") must use this rather than `finalMessage`. A model is free to state
 * a grounded fact mid-turn and close with a short acknowledgement; that is a
 * phrasing choice, not a defect, and plan §4.5 is explicit that these checks
 * are about grounded facts rather than wording or placement.
 *
 * Tolerates `undefined` so the resumed-after-approval turns read cleanly.
 */
function transcript(...turns: (Turn | undefined)[]): string {
  return turns
    .filter((turn): turn is Turn => turn !== undefined)
    .flatMap((turn) => turn.messages)
    .join("\n")
}

/**
 * Sends one turn and drains its stream.
 *
 * Iterating rather than calling `.result()` is not a style choice:
 * `MessageResponse` is single-use, and the approval scenarios must observe
 * `input.requested` — and read the database while the run is still parked —
 * before deciding how to answer.
 */
async function runTurn(
  session: ClientSession,
  input: Parameters<ClientSession["send"]>[0]
): Promise<Turn> {
  const turn: Turn = {
    events: [],
    toolCalls: [],
    approvalRequests: [],
    messages: [],
    finalMessage: "",
    failed: undefined,
  }

  const response = await session.send(input)
  const deadline = Date.now() + TURN_TIMEOUT_MS

  for await (const event of response) {
    turn.events.push(event)

    if (Date.now() > deadline) {
      throw new Error(`A turn exceeded ${TURN_TIMEOUT_MS}ms.`)
    }

    switch (event.type) {
      case "actions.requested":
        for (const action of event.data.actions) {
          if (action.kind === "tool-call") {
            turn.toolCalls.push({ name: action.toolName, input: action.input })
          }
        }
        break

      case "input.requested":
        turn.approvalRequests.push(...event.data.requests)
        break

      case "message.completed":
        if (event.data.message) {
          turn.messages.push(event.data.message)
          turn.finalMessage = event.data.message
        }
        break

      case "turn.failed":
      case "step.failed":
      case "session.failed":
        turn.failed = { code: event.data.code, message: event.data.message }
        break
    }
  }

  return turn
}

/** The names of the tools called across a set of turns, in order. */
function toolNames(...turns: Turn[]): string[] {
  return turns.flatMap((turn) => turn.toolCalls.map((call) => call.name))
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

type Assertion = { name: string; passed: boolean; detail?: string }

const failures: string[] = []

/** Records an assertion and remembers a failure without aborting the run. */
function check(
  assertions: Assertion[],
  name: string,
  passed: boolean,
  detail?: string
): void {
  assertions.push(
    detail === undefined ? { name, passed } : { name, passed, detail }
  )
  if (!passed) failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
  process.stdout.write(`  ${passed ? "✔" : "✘"} ${name}\n`)
}

async function writeTranscript(
  file: string,
  body: Record<string, unknown>
): Promise<void> {
  // No process.env, ever: transcripts are committed evidence.
  await writeFile(`${outputDir}${file}`, `${JSON.stringify(body, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Fixtures, over HTTP
// ---------------------------------------------------------------------------

const fixtureProjects: string[] = []

async function createProject(label: string): Promise<ProjectRow> {
  const name = `Phase4 ${label} ${crypto.randomUUID().slice(0, 8)}`
  const { status, body } = await apiJson<ProjectRow>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  })

  if (status !== 201) {
    throw new Error(`Fixture project '${name}' was not created (${status}).`)
  }

  fixtureProjects.push(body.id)
  return body
}

async function listStatuses(projectId: string): Promise<StatusRow[]> {
  const { body } = await apiJson<StatusRow[]>(
    `/api/projects/${projectId}/statuses`
  )
  return body
}

async function createTask(
  projectId: string,
  title: string,
  statusId?: string
): Promise<TaskRow> {
  const { status, body } = await apiJson<TaskRow>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      projectId,
      title,
      ...(statusId ? { statusId } : {}),
    }),
  })

  if (status !== 201) {
    throw new Error(`Fixture task '${title}' was not created (${status}).`)
  }

  return body
}

/** Every task in a project, completed ones included. */
async function readTasks(projectId: string): Promise<TaskRow[]> {
  const { body } = await apiJson<TaskRow[]>(
    `/api/tasks?project=${projectId}&includeCompleted=true`
  )
  return body
}

/** Best-effort: the test database is disposable and `db:reset:test` exists. */
async function cleanUp(): Promise<void> {
  for (const projectId of fixtureProjects) {
    try {
      for (const task of await readTasks(projectId)) {
        await apiJson(`/api/tasks/${task.id}`, { method: "DELETE" })
      }
      await apiJson(`/api/projects/${projectId}`, { method: "DELETE" })
    } catch {
      // Leaving a fixture behind is not a reason to fail the run.
    }
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * US-F2.1 / US-F2.4 — the agent reads before it answers, and says plainly when
 * something does not exist rather than inventing it.
 */
async function grounded(client: Client, model: string): Promise<void> {
  process.stdout.write("\n01 grounded read\n")

  const project = await createProject("Grounded")
  const statuses = await listStatuses(project.id)
  const todo = statuses.find((status) => status.name === "To Do")!
  const doing = statuses.find((status) => status.name === "In Progress")!

  await createTask(project.id, "Fix the header bug", todo.id)
  await createTask(project.id, "Write release notes", todo.id)
  await createTask(project.id, "Migrate the settings page", doing.id)
  await createTask(project.id, "Review the onboarding copy", doing.id)

  const session = client.session()
  const first = await runTurn(
    session,
    `How many tasks are in the project "${project.name}", and which status is each in?`
  )
  const second = await runTurn(
    session,
    `And how many tasks are in the project "Nonexistent ${crypto.randomUUID().slice(0, 8)}"?`
  )

  const committed = await readTasks(project.id)
  const assertions: Assertion[] = []

  check(
    assertions,
    "the answer is preceded by a read tool call",
    toolNames(first).some((name) => name.startsWith("list_")),
    JSON.stringify(toolNames(first))
  )
  // These scan the whole turn, not just its closing message. US-F2 is about
  // the answer being *grounded*, not about which message carries it — an agent
  // that reports the count and then closes with "Anything else?" has satisfied
  // the criterion, and asserting on `finalMessage` alone failed it.
  const firstText = transcript(first)
  const secondText = transcript(second)

  check(
    assertions,
    "the reply states the real count of 4",
    /\b4\b|\bfour\b/i.test(firstText),
    firstText.slice(0, 400)
  )
  check(
    assertions,
    "every committed task title appears in the reply",
    committed.every((task) => firstText.includes(task.title)),
    `${committed.length} committed tasks`
  )
  check(
    assertions,
    "the nonexistent project is reported as not existing",
    /(no|not|does ?n[o']t|couldn't find|cannot find)/i.test(secondText),
    secondText.slice(0, 400)
  )
  check(
    assertions,
    "no write tool ran in either turn",
    toolNames(first, second).every(
      (name) => name.startsWith("list_") || name.startsWith("get_")
    )
  )

  await writeTranscript("01-grounded-read.json", {
    scenario: "Grounded read, and honesty about a project that does not exist",
    userStories: ["US-F2.1", "US-F2.2", "US-F2.4"],
    model,
    project: project.name,
    committedTasks: committed.map((task) => ({
      title: task.title,
      status: task.status.name,
    })),
    turns: [first, second],
    assertions,
  })
}

/**
 * US-F3.4 — the immutability rule the schema makes structurally inexpressible.
 * The agent has to explain it and offer a way forward, without ever emitting a
 * project change (there is no field for one).
 */
async function projectMoveRefused(
  client: Client,
  model: string
): Promise<void> {
  process.stdout.write("\n02 project move refused\n")

  const from = await createProject("MoveFrom")
  const to = await createProject("MoveTo")
  const task = await createTask(from.id, "Renew the SSL certificate")

  const session = client.session()
  const turn = await runTurn(
    session,
    `Move the task "${task.title}" out of "${from.name}" and into "${to.name}".`
  )

  const stillThere = await readTasks(from.id)
  const arrived = await readTasks(to.id)
  const assertions: Assertion[] = []

  check(
    assertions,
    "no update_task call attempted a project change",
    turn.toolCalls
      .filter((call) => call.name === "update_task")
      .every((call) => !Object.keys(call.input as object).includes("projectId"))
  )
  check(
    assertions,
    "the refusal names the rule",
    /project/i.test(transcript(turn)) &&
      /(can(no|')t|cannot|unable|not possible|immutable|fixed)/i.test(
        transcript(turn)
      ),
    transcript(turn).slice(0, 600)
  )
  check(
    assertions,
    "an alternative is offered",
    /(recreat|create|delete|instead|copy|new task)/i.test(transcript(turn)),
    transcript(turn).slice(0, 600)
  )
  check(
    assertions,
    "the task is still in its original project",
    stillThere.some((row) => row.id === task.id) &&
      !arrived.some((row) => row.id === task.id)
  )

  await writeTranscript("02-project-move-refused.json", {
    scenario:
      "A task cannot change project — refused, explained, alternative offered",
    userStories: ["US-F3.4"],
    model,
    projects: { from: from.name, to: to.name },
    task: task.title,
    turns: [turn],
    assertions,
  })
}

/**
 * The `blocked` envelope end to end: the gate fires, the user approves, and the
 * action *then* throws a RuleViolation which the agent must relay with a way
 * forward. This is the phase's "rule violation relayed with an alternative"
 * evidence — distinct from scenario 2, where the schema refuses structurally
 * and no action ever runs.
 */
async function blockedStatusDelete(
  client: Client,
  model: string
): Promise<void> {
  process.stdout.write("\n03 blocked status delete\n")

  const project = await createProject("BlockedStatus")
  const statuses = await listStatuses(project.id)
  const doing = statuses.find((status) => status.name === "In Progress")!
  await createTask(project.id, "Rebuild the search index", doing.id)

  const session = client.session()
  const asked = await runTurn(
    session,
    `Delete the "In Progress" status from the project "${project.name}".`
  )

  const assertions: Assertion[] = []

  check(
    assertions,
    "delete_status paused for approval",
    asked.approvalRequests.some(
      (request) => request.action.toolName === "delete_status"
    ),
    JSON.stringify(asked.approvalRequests.map((r) => r.action.toolName))
  )

  const resumed =
    asked.approvalRequests.length > 0
      ? await runTurn(session, {
          inputResponses: asked.approvalRequests.map((request) => ({
            requestId: request.requestId,
            optionId: "approve",
          })),
        })
      : undefined

  const survivors = await listStatuses(project.id)

  check(
    assertions,
    "the status still exists after the approved-but-blocked delete",
    survivors.some((status) => status.id === doing.id)
  )
  check(
    assertions,
    "the blocking rule is relayed to the user",
    /(still (in )?use|used by|task)/i.test(transcript(resumed)),
    transcript(resumed).slice(0, 600)
  )
  check(
    assertions,
    "a concrete way forward is offered",
    /(move|reassign|another status|different status|delete (them|those)|first)/i.test(
      transcript(resumed)
    ),
    transcript(resumed).slice(0, 600)
  )

  await writeTranscript("03-blocked-status-delete.json", {
    scenario:
      "An in-use status: approval granted, action blocked, rule relayed with an alternative",
    userStories: ["US-F4.3", "US-F3.4"],
    model,
    project: project.name,
    turns: resumed ? [asked, resumed] : [asked],
    assertions,
  })
}

/**
 * US-F3.3 — the pause is framework-enforced, not prompt compliance. The row is
 * read back *while the run is still parked*, which is the only way to prove
 * the tool had not already run before the user was asked.
 */
async function deleteDenied(client: Client, model: string): Promise<void> {
  process.stdout.write("\n04 delete approval denied\n")

  const project = await createProject("DeleteDenied")
  const task = await createTask(project.id, "Cancel the old DNS record")

  const session = client.session()
  const asked = await runTurn(session, `Delete the task "${task.title}".`)

  const assertions: Assertion[] = []

  check(
    assertions,
    "delete_task paused for approval",
    asked.approvalRequests.some(
      (request) => request.action.toolName === "delete_task"
    )
  )
  check(
    assertions,
    "the approval prompt carries the task id the tool would delete",
    asked.approvalRequests.some(
      (request) =>
        (request.action.input as { taskId?: string }).taskId === task.id
    ),
    JSON.stringify(asked.approvalRequests.map((r) => r.action.input))
  )

  const whileParked = await readTasks(project.id)
  check(
    assertions,
    "the task still exists while the run is parked",
    whileParked.some((row) => row.id === task.id)
  )

  const resumed =
    asked.approvalRequests.length > 0
      ? await runTurn(session, {
          inputResponses: asked.approvalRequests.map((request) => ({
            requestId: request.requestId,
            optionId: "deny",
          })),
        })
      : undefined

  const afterDeny = await readTasks(project.id)

  check(
    assertions,
    "the task still exists after the denial",
    afterDeny.some((row) => row.id === task.id)
  )
  check(
    assertions,
    "the agent says nothing changed",
    /(not|n't|nothing|cancel|left|kept|still)/i.test(
      transcript(resumed)
    ),
    transcript(resumed).slice(0, 600)
  )

  await writeTranscript("04-delete-approval-denied.json", {
    scenario:
      "Delete pauses for approval; the user declines and nothing changes",
    userStories: ["US-F3.3"],
    model,
    project: project.name,
    task: { id: task.id, title: task.title },
    turns: resumed ? [asked, resumed] : [asked],
    assertions,
  })
}

/**
 * US-F5 — a multi-task change routes through one gated bulk call rather than N
 * ungated single-task calls, the prompt shows exactly which ids, and approving
 * it moves every row.
 */
async function bulkApproved(client: Client, model: string): Promise<void> {
  process.stdout.write("\n05 bulk approval approved\n")

  const project = await createProject("BulkMove")
  const statuses = await listStatuses(project.id)
  const todo = statuses.find((status) => status.name === "To Do")!
  const doing = statuses.find((status) => status.name === "In Progress")!

  const seeded = [
    await createTask(project.id, "Audit the image pipeline", todo.id),
    await createTask(project.id, "Draft the migration plan", todo.id),
    await createTask(project.id, "Prune stale feature flags", todo.id),
  ]

  const session = client.session()
  const asked = await runTurn(
    session,
    `In the project "${project.name}", move everything that's in To Do to In Progress.`
  )

  const assertions: Assertion[] = []
  const bulkCalls = asked.toolCalls.filter(
    (call) => call.name === "bulk_update_tasks"
  )

  check(
    assertions,
    "exactly one bulk_update_tasks call, and no single-task updates",
    bulkCalls.length === 1 &&
      !asked.toolCalls.some((call) => call.name === "update_task"),
    JSON.stringify(toolNames(asked))
  )
  check(
    assertions,
    "the message states the count and the titles before the call",
    /\b3\b|\bthree\b/i.test(transcript(asked)) &&
      seeded.every((task) => transcript(asked).includes(task.title)),
    transcript(asked).slice(0, 600)
  )
  check(
    assertions,
    "the approval prompt carries all three task ids",
    asked.approvalRequests.some((request) => {
      const ids = (request.action.input as { taskIds?: string[] }).taskIds ?? []
      return seeded.every((task) => ids.includes(task.id))
    }),
    JSON.stringify(asked.approvalRequests.map((r) => r.action.input))
  )

  const resumed =
    asked.approvalRequests.length > 0
      ? await runTurn(session, {
          inputResponses: asked.approvalRequests.map((request) => ({
            requestId: request.requestId,
            optionId: "approve",
          })),
        })
      : undefined

  const moved = await readTasks(project.id)

  check(
    assertions,
    "every seeded task is now In Progress",
    seeded.every(
      (task) => moved.find((row) => row.id === task.id)?.status.id === doing.id
    ),
    JSON.stringify(moved.map((row) => [row.title, row.status.name]))
  )
  check(
    assertions,
    "the summary reports the move",
    /in progress/i.test(transcript(resumed)),
    transcript(resumed).slice(0, 600)
  )

  await writeTranscript("05-bulk-approval-approved.json", {
    scenario:
      "A multi-task move routes through one gated bulk call; approving it moves every row",
    userStories: ["US-F5.1", "US-F5.2", "US-F5.3", "US-F5.4"],
    model,
    project: project.name,
    seeded: seeded.map((task) => ({ id: task.id, title: task.title })),
    turns: resumed ? [asked, resumed] : [asked],
    assertions,
  })
}

/**
 * US-F5.1 / product spec §6 — two tasks edited in one request pause, even when
 * the bulk tool cannot express the request.
 *
 * Scenario 05 shows the happy path: asked to move several tasks the same way,
 * the model routes it through one gated `bulk_update_tasks` call. That is
 * behaviour, and behaviour is not a guarantee.
 *
 * This scenario removes the choice. `bulk_update_tasks` applies **one** status
 * or priority to many tasks; it has no field for a title. So "rename this one
 * to X and that one to Y" is a §6 bulk change ("a single request that would
 * modify … more than one task") that the bulk tool structurally cannot carry —
 * the model must loop `update_task`, and the instruction to prefer the bulk
 * tool has nothing to offer. Everything standing between that request and two
 * silent writes is `update_task`'s own approval policy
 * (`agent/lib/bulk-edit-gate.ts`), and this is where it is exercised against
 * the real runtime rather than a stubbed `ApprovalContext`.
 *
 * What §6 permits is one ungated single-task edit. What it forbids is the
 * second one going through unannounced, so that is what the assertions pin,
 * on committed rows read back while the run is still parked.
 */
async function loopedEditGated(client: Client, model: string): Promise<void> {
  process.stdout.write("\n06 looped single-task edits are gated\n")

  const project = await createProject("LoopedEdit")

  const first = await createTask(project.id, "Rotate the signing keys")
  const second = await createTask(project.id, "Backfill the search index")

  const renamed = {
    [first.id]: "Rotate the signing keys (Q3)",
    [second.id]: "Backfill the search index (v2)",
  }

  const session = client.session()
  const asked = await runTurn(
    session,
    `In the project "${project.name}", rename "${first.title}" to ` +
      `"${renamed[first.id]}" and rename "${second.title}" to ` +
      `"${renamed[second.id]}".`
  )

  /** How many of the two tasks currently carry their new title. */
  const renameCount = async (): Promise<number> =>
    (await readTasks(project.id)).filter((row) => row.title === renamed[row.id])
      .length

  const assertions: Assertion[] = []
  const updateCalls = asked.toolCalls.filter(
    (call) => call.name === "update_task"
  )
  const gated = asked.approvalRequests.filter(
    (request) => request.action.toolName === "update_task"
  )
  const parkedRenames = await renameCount()

  check(
    assertions,
    "the request routes through repeated update_task calls, as it must",
    updateCalls.length >= 2,
    JSON.stringify(toolNames(asked))
  )
  check(
    assertions,
    "the second single-task edit paused for approval",
    gated.length >= 1,
    JSON.stringify(asked.approvalRequests.map((r) => r.action.toolName))
  )
  check(
    assertions,
    "the approval prompt names the task the pending edit would change",
    gated.some((request) => {
      const input = request.action.input as { taskId?: string }
      return input.taskId === first.id || input.taskId === second.id
    }),
    JSON.stringify(gated.map((request) => request.action.input))
  )
  check(
    assertions,
    "at most one task was renamed before the user was asked",
    parkedRenames <= 1,
    `${parkedRenames} of 2 renamed while parked`
  )

  const resumed =
    asked.approvalRequests.length > 0
      ? await runTurn(session, {
          inputResponses: asked.approvalRequests.map((request) => ({
            requestId: request.requestId,
            optionId: "deny",
          })),
        })
      : undefined

  const deniedRenames = await renameCount()

  check(
    assertions,
    "declining leaves at most the one ungated single-task edit applied",
    deniedRenames <= 1,
    JSON.stringify((await readTasks(project.id)).map((row) => row.title))
  )

  await writeTranscript("06-looped-edit-gated.json", {
    scenario:
      "A two-task rename — which bulk_update_tasks cannot express — pauses before the second task changes",
    userStories: ["US-F5.1", "US-F5.2", "US-F5.3"],
    model,
    project: project.name,
    seeded: [first, second].map((task) => ({
      id: task.id,
      title: task.title,
      requestedTitle: renamed[task.id],
    })),
    routedThrough: toolNames(asked),
    turns: resumed ? [asked, resumed] : [asked],
    assertions,
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Polls /eve/v1/health until the agent runtime answers. */
async function waitForAgent(client: Client): Promise<void> {
  const deadline = Date.now() + 120_000

  while (Date.now() < deadline) {
    try {
      await client.health()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error("The eve runtime did not become healthy in time.")
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true })

  const baseUrl = await startApiServer()
  process.stdout.write(`Server: ${baseUrl} (test database)\n`)

  try {
    // localDev() admits loopback callers, so no credentials are configured
    // here — and none should be, since agent/channels/eve.ts must not be
    // weakened for a harness.
    const client = new Client({ host: baseUrl })
    await waitForAgent(client)

    const info = await client.info()
    const model = info.agent.model.id
    process.stdout.write(`Agent: ${info.agent.name} on ${model}\n`)

    await grounded(client, model)
    await projectMoveRefused(client, model)
    await blockedStatusDelete(client, model)
    await deleteDenied(client, model)
    await bulkApproved(client, model)
    await loopedEditGated(client, model)

    await cleanUp()
  } finally {
    await stopApiServer()
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} assertion(s) failed:\n`)
    for (const failure of failures) process.stdout.write(`  ✘ ${failure}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write("\nAll assertions passed.\n")
}

await main()
