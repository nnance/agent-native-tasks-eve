/**
 * The second half of the Phase 4 CLI evidence: the acceptance criteria that
 * `scripts/verify-agent-tools.ts` does not exercise.
 *
 * That script proves the phase's *exit criteria* — a grounded read, a rule
 * violation relayed with an alternative, a delete pausing for approval. The
 * verification packet has to go further and touch every acceptance criterion of
 * US-F2…US-F5, so this file covers the remainder:
 *
 *   11  US-F3.1 / F3.2 / F3.5   create with defaults, edit every field, move
 *                               status, all without a confirmation gate
 *   12  US-F2.3 / F2.2          find a task by text with search; re-read after
 *                               an out-of-band write rather than answering from
 *                               the previous turn
 *   13  US-F4.1 / F4.2          create and rename a project (seeded defaults),
 *                               then create/rename/reorder/toggle statuses and
 *                               create/rename/reorder/set-default priorities
 *   14  US-F4.3 / F4.4          delete_project and delete_priority pause for
 *                               approval too, and all three "blocked deletion"
 *                               rules are relayed with a way forward
 *
 * Same construction as the sibling script, and for the same reasons: real
 * model calls through `eve/client` against a real `next dev` on the **test**
 * database (`startApiServer()` overrides DATABASE_URL in the child env only),
 * every post-condition read back independently over HTTP, every stream event
 * kept verbatim in the transcript, and no environment variable ever written to
 * a file. It lives in `scripts/` and not `tests/` because each run makes paid,
 * non-deterministic model calls.
 *
 * Run with no other `pnpm dev` or `eve dev` process active.
 *
 *   pnpm verify:agent:stories
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
// Wire types for the API reads.
// ---------------------------------------------------------------------------

type ProjectRow = { id: string; name: string }
type StatusRow = {
  id: string
  name: string
  order: number
  isCompleted: boolean
}
type PriorityRow = {
  id: string
  name: string
  order: number
  isDefault: boolean
}
type TaskRow = {
  id: string
  title: string
  description: string | null
  status: { id: string; name: string }
  priority: { id: string; name: string }
}

// ---------------------------------------------------------------------------
// Turn capture (identical to the sibling script; see its comments)
// ---------------------------------------------------------------------------

type ToolCall = { name: string; input: unknown }

type Turn = {
  events: HandleMessageStreamEvent[]
  toolCalls: ToolCall[]
  approvalRequests: InputRequest[]
  /** Every assistant message of the turn, in order. */
  messages: string[]
  /** The last assistant message. Use `transcript()` for content assertions. */
  finalMessage: string
  failed: { code: string; message: string } | undefined
}

/**
 * Every assistant message of the given turns as one string.
 *
 * Content assertions must use this rather than `finalMessage`: a model may
 * state a grounded fact mid-turn and close with a short acknowledgement, which
 * is a phrasing choice rather than a defect (plan §4.5).
 */
function transcript(...turns: (Turn | undefined)[]): string {
  return turns
    .filter((turn): turn is Turn => turn !== undefined)
    .flatMap((turn) => turn.messages)
    .join("\n")
}

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

/** Approves or denies every pending request of a turn, in one follow-up turn. */
async function answer(
  session: ClientSession,
  asked: Turn,
  optionId: "approve" | "deny"
): Promise<Turn | undefined> {
  if (asked.approvalRequests.length === 0) return undefined

  return runTurn(session, {
    inputResponses: asked.approvalRequests.map((request) => ({
      requestId: request.requestId,
      optionId,
    })),
  })
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

type Assertion = { name: string; passed: boolean; detail?: string }

const failures: string[] = []

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
// Fixtures and reads, over HTTP
// ---------------------------------------------------------------------------

const fixtureProjects: string[] = []

function uniqueName(label: string): string {
  return `Phase4 ${label} ${crypto.randomUUID().slice(0, 8)}`
}

async function createProject(label: string): Promise<ProjectRow> {
  const name = uniqueName(label)
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

async function listProjects(): Promise<ProjectRow[]> {
  const { body } = await apiJson<ProjectRow[]>("/api/projects")
  return body
}

async function listStatuses(projectId: string): Promise<StatusRow[]> {
  const { body } = await apiJson<StatusRow[]>(
    `/api/projects/${projectId}/statuses`
  )
  return body
}

async function listPriorities(projectId: string): Promise<PriorityRow[]> {
  const { body } = await apiJson<PriorityRow[]>(
    `/api/projects/${projectId}/priorities`
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

async function readTasks(projectId: string): Promise<TaskRow[]> {
  const { body } = await apiJson<TaskRow[]>(
    `/api/tasks?project=${projectId}&includeCompleted=true`
  )
  return body
}

async function readTask(taskId: string): Promise<TaskRow> {
  const { body } = await apiJson<TaskRow>(`/api/tasks/${taskId}`)
  return body
}

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
// 11 — US-F3.1 / US-F3.2 / US-F3.5
// ---------------------------------------------------------------------------

/**
 * Creating a task takes the UI's defaults; editing every field and moving a
 * status work; and none of it stops for a confirmation, because none of it is
 * destructive and each turn touches one task.
 */
async function taskLifecycle(client: Client, model: string): Promise<void> {
  process.stdout.write("\n11 single-task lifecycle\n")

  const project = await createProject("Lifecycle")
  const session = client.session()
  const assertions: Assertion[] = []

  // --- create, with defaults ------------------------------------------------
  const created = await runTurn(
    session,
    `Create a task called "Ship the changelog" in the project "${project.name}".`
  )

  const afterCreate = await readTasks(project.id)
  const task = afterCreate.find((row) => row.title === "Ship the changelog")

  check(
    assertions,
    "create_task ran",
    toolNames(created).includes("create_task"),
    JSON.stringify(toolNames(created))
  )
  check(assertions, "the task exists after the turn", task !== undefined)
  check(
    assertions,
    "the omitted status defaulted to the project's first status (To Do)",
    task?.status.name === "To Do",
    task?.status.name
  )
  check(
    assertions,
    "the omitted priority defaulted to the project's default (Medium)",
    task?.priority.name === "Medium",
    task?.priority.name
  )
  check(
    assertions,
    "creating a task did not pause for approval",
    created.approvalRequests.length === 0,
    JSON.stringify(created.approvalRequests.map((r) => r.action.toolName))
  )

  if (!task) {
    await writeTranscript("11-task-lifecycle.json", {
      scenario: "Single-task lifecycle",
      userStories: ["US-F3.1", "US-F3.2", "US-F3.5"],
      model,
      project: project.name,
      turns: [created],
      assertions,
    })
    return
  }

  // --- edit title, description and priority in one turn ---------------------
  const description =
    "Draft it, get it reviewed by the team, then publish to the blog."
  const edited = await runTurn(
    session,
    `Rename that task to "Ship the changelog (v2)", set its description to ` +
      `"${description}", and change its priority to High.`
  )

  const afterEdit = await readTask(task.id)

  check(
    assertions,
    "update_task ran for the edit",
    toolNames(edited).includes("update_task"),
    JSON.stringify(toolNames(edited))
  )
  check(
    assertions,
    "the title, description and priority are all committed",
    afterEdit.title === "Ship the changelog (v2)" &&
      afterEdit.description === description &&
      afterEdit.priority.name === "High",
    JSON.stringify({
      title: afterEdit.title,
      description: afterEdit.description,
      priority: afterEdit.priority.name,
    })
  )
  check(
    assertions,
    "editing one task did not pause for approval",
    edited.approvalRequests.length === 0,
    JSON.stringify(edited.approvalRequests.map((r) => r.action.toolName))
  )

  // --- move its status directly --------------------------------------------
  const moved = await runTurn(session, `Move it to Done.`)
  const afterMove = await readTask(task.id)

  check(
    assertions,
    "update_task ran for the status move",
    toolNames(moved).includes("update_task"),
    JSON.stringify(toolNames(moved))
  )
  check(
    assertions,
    "the task is now in Done",
    afterMove.status.name === "Done",
    afterMove.status.name
  )
  check(
    assertions,
    "moving one task's status did not pause for approval",
    moved.approvalRequests.length === 0,
    JSON.stringify(moved.approvalRequests.map((r) => r.action.toolName))
  )

  await writeTranscript("11-task-lifecycle.json", {
    scenario:
      "Create with UI defaults, edit every field, move status — none of it gated",
    userStories: ["US-F3.1", "US-F3.2", "US-F3.5"],
    model,
    project: project.name,
    task: { id: task.id, createdAs: "Ship the changelog" },
    committed: {
      afterCreate: {
        status: task.status.name,
        priority: task.priority.name,
      },
      afterEdit: {
        title: afterEdit.title,
        description: afterEdit.description,
        priority: afterEdit.priority.name,
      },
      afterMove: { status: afterMove.status.name },
    },
    turns: [created, edited, moved],
    assertions,
  })
}

// ---------------------------------------------------------------------------
// 12 — US-F2.3 / US-F2.2
// ---------------------------------------------------------------------------

/**
 * Loose references resolve by search, and a second turn re-reads rather than
 * answering from the first one's result.
 *
 * The between-turns write goes through the same `/api/tasks` route handlers the
 * left-hand UI's mutations call (plan §2.3) — this phase has no chat UI to
 * click, so the packet says plainly that the change was made over HTTP rather
 * than in a browser. What the criterion is about is the read: whether the agent
 * answers the follow-up from live data or from what it already had.
 */
async function searchAndFreshness(
  client: Client,
  model: string
): Promise<void> {
  process.stdout.write("\n12 search, and no stale reads\n")

  const project = await createProject("Freshness")
  const statuses = await listStatuses(project.id)
  const todo = statuses.find((status) => status.name === "To Do")!
  const doing = statuses.find((status) => status.name === "In Progress")!

  const header = await createTask(
    project.id,
    "Sticky header overlaps the nav on mobile",
    todo.id
  )
  await createTask(project.id, "Update the billing FAQ", todo.id)
  await createTask(project.id, "Compress the hero images", doing.id)

  const session = client.session()
  const assertions: Assertion[] = []

  const found = await runTurn(
    session,
    `In the project "${project.name}", find the task about the header bug and ` +
      `tell me which status it is in.`
  )

  const searches = found.toolCalls.filter(
    (call) =>
      call.name === "list_tasks" &&
      typeof (call.input as { search?: unknown }).search === "string" &&
      ((call.input as { search: string }).search ?? "").length > 0
  )

  check(
    assertions,
    "the task was found with a text search, not a guessed title",
    searches.length >= 1,
    JSON.stringify(found.toolCalls.map((call) => [call.name, call.input]))
  )
  check(
    assertions,
    "the reply names the real task and its real status",
    transcript(found).includes(header.title) &&
      /to ?do/i.test(transcript(found)),
    transcript(found).slice(0, 400)
  )

  // --- an out-of-band write between the two turns ---------------------------
  const patched = await apiJson<TaskRow>(`/api/tasks/${header.id}`, {
    method: "PATCH",
    body: JSON.stringify({ statusId: doing.id }),
  })
  if (patched.status !== 200) {
    throw new Error(`The between-turns PATCH failed (${patched.status}).`)
  }
  const late = await createTask(
    project.id,
    "Rotate the TLS certificate",
    todo.id
  )

  const committed = await readTasks(project.id)

  const refreshed = await runTurn(
    session,
    `What tasks are in "${project.name}" now, and which status is each in?`
  )

  check(
    assertions,
    "the follow-up re-read the data instead of reusing the first answer",
    toolNames(refreshed).some((name) => name.startsWith("list_")),
    JSON.stringify(toolNames(refreshed))
  )
  check(
    assertions,
    "the reply includes the task created after the first read",
    transcript(refreshed).includes(late.title),
    transcript(refreshed).slice(0, 600)
  )
  check(
    assertions,
    "the reply names all four committed tasks",
    committed.every((row) => transcript(refreshed).includes(row.title)),
    JSON.stringify(committed.map((row) => row.title))
  )
  check(
    assertions,
    "the header task is reported in its new status, not the one just read",
    /in progress/i.test(transcript(refreshed)),
    transcript(refreshed).slice(0, 600)
  )

  await writeTranscript("12-search-and-freshness.json", {
    scenario:
      "Find a task by text; then answer a follow-up from live data after an out-of-band change",
    userStories: ["US-F2.3", "US-F2.2"],
    model,
    project: project.name,
    outOfBandChange: {
      how: "HTTP PATCH/POST against the same /api/tasks routes the UI calls",
      movedToInProgress: header.title,
      created: late.title,
    },
    committedAfterChange: committed.map((row) => [row.title, row.status.name]),
    searchCalls: searches.map((call) => call.input),
    turns: [found, refreshed],
    assertions,
  })
}

// ---------------------------------------------------------------------------
// 13 — US-F4.1 / US-F4.2
// ---------------------------------------------------------------------------

/** The list-management half of parity: projects, statuses and priorities. */
async function listManagement(client: Client, model: string): Promise<void> {
  process.stdout.write("\n13 project, status and priority management\n")

  const name = uniqueName("Lists")
  const renamed = `${name} (renamed)`
  const session = client.session()
  const assertions: Assertion[] = []

  // --- create a project, seeded -------------------------------------------
  const created = await runTurn(session, `Create a project called "${name}".`)

  const project = (await listProjects()).find((row) => row.name === name)
  if (project) fixtureProjects.push(project.id)

  check(
    assertions,
    "create_project ran",
    toolNames(created).includes("create_project"),
    JSON.stringify(toolNames(created))
  )
  check(assertions, "the project exists", project !== undefined)

  if (!project) {
    await writeTranscript("13-list-management.json", {
      scenario: "Project, status and priority management",
      userStories: ["US-F4.1", "US-F4.2"],
      model,
      turns: [created],
      assertions,
    })
    return
  }

  const seededStatuses = await listStatuses(project.id)
  const seededPriorities = await listPriorities(project.id)

  check(
    assertions,
    "the new project carries the standard seeded statuses",
    JSON.stringify(seededStatuses.map((row) => [row.name, row.isCompleted])) ===
      JSON.stringify([
        ["To Do", false],
        ["In Progress", false],
        ["Done", true],
      ]),
    JSON.stringify(seededStatuses.map((row) => [row.name, row.isCompleted]))
  )
  check(
    assertions,
    "the new project carries the standard seeded priorities, Medium default",
    JSON.stringify(seededPriorities.map((row) => [row.name, row.isDefault])) ===
      JSON.stringify([
        ["Low", false],
        ["Medium", true],
        ["High", false],
      ]),
    JSON.stringify(seededPriorities.map((row) => [row.name, row.isDefault]))
  )
  check(
    assertions,
    "creating a project did not pause for approval",
    created.approvalRequests.length === 0
  )

  // --- rename it ------------------------------------------------------------
  const renamedTurn = await runTurn(
    session,
    `Rename the project "${name}" to "${renamed}".`
  )
  const afterRename = (await listProjects()).find(
    (row) => row.id === project.id
  )

  check(
    assertions,
    "rename_project ran",
    toolNames(renamedTurn).includes("rename_project"),
    JSON.stringify(toolNames(renamedTurn))
  )
  check(
    assertions,
    "the project's new name is committed",
    afterRename?.name === renamed,
    afterRename?.name
  )

  // --- statuses: create, toggle completed, rename, reorder ------------------
  const statusTurn = await runTurn(
    session,
    `In the project "${renamed}": add a status called "Shipped", mark ` +
      `"Shipped" as counting as completed, rename "To Do" to "Backlog", and ` +
      `move "Shipped" to the front of the status list.`
  )
  const statusesNow = await listStatuses(project.id)

  check(
    assertions,
    "create_status and update_status both ran",
    toolNames(statusTurn).includes("create_status") &&
      toolNames(statusTurn).includes("update_status"),
    JSON.stringify(toolNames(statusTurn))
  )
  check(
    assertions,
    "the status list now reads Shipped, Backlog, In Progress, Done",
    JSON.stringify(statusesNow.map((row) => row.name)) ===
      JSON.stringify(["Shipped", "Backlog", "In Progress", "Done"]),
    JSON.stringify(statusesNow.map((row) => row.name))
  )
  check(
    assertions,
    '"Shipped" counts as completed',
    statusesNow.find((row) => row.name === "Shipped")?.isCompleted === true,
    JSON.stringify(statusesNow.map((row) => [row.name, row.isCompleted]))
  )

  // --- priorities: create, set default, rename, reorder ---------------------
  const priorityTurn = await runTurn(
    session,
    `In the project "${renamed}": add a priority called "Critical", make ` +
      `"Critical" the project's default, rename "Low" to "Whenever", and ` +
      `reorder the priorities so the list reads Critical, Whenever, Medium, High.`
  )
  const prioritiesNow = await listPriorities(project.id)

  check(
    assertions,
    "create_priority and update_priority both ran",
    toolNames(priorityTurn).includes("create_priority") &&
      toolNames(priorityTurn).includes("update_priority"),
    JSON.stringify(toolNames(priorityTurn))
  )
  check(
    assertions,
    "the priority list now reads Critical, Whenever, Medium, High",
    JSON.stringify(prioritiesNow.map((row) => row.name)) ===
      JSON.stringify(["Critical", "Whenever", "Medium", "High"]),
    JSON.stringify(prioritiesNow.map((row) => row.name))
  )
  check(
    assertions,
    '"Critical" is the project\'s one default priority',
    prioritiesNow.filter((row) => row.isDefault).length === 1 &&
      prioritiesNow.find((row) => row.isDefault)?.name === "Critical",
    JSON.stringify(prioritiesNow.map((row) => [row.name, row.isDefault]))
  )
  check(
    assertions,
    "none of the list management paused for approval",
    renamedTurn.approvalRequests.length === 0 &&
      statusTurn.approvalRequests.length === 0 &&
      priorityTurn.approvalRequests.length === 0
  )

  await writeTranscript("13-list-management.json", {
    scenario:
      "Create and rename a project (seeded), then manage its statuses and priorities",
    userStories: ["US-F4.1", "US-F4.2"],
    model,
    project: { created: name, renamedTo: renamed },
    committed: {
      seededStatuses: seededStatuses.map((row) => [row.name, row.isCompleted]),
      seededPriorities: seededPriorities.map((row) => [
        row.name,
        row.isDefault,
      ]),
      statusesAfter: statusesNow.map((row) => [
        row.name,
        row.order,
        row.isCompleted,
      ]),
      prioritiesAfter: prioritiesNow.map((row) => [
        row.name,
        row.order,
        row.isDefault,
      ]),
    },
    turns: [created, renamedTurn, statusTurn, priorityTurn],
    assertions,
  })
}

// ---------------------------------------------------------------------------
// 14 — US-F4.3 / US-F4.4
// ---------------------------------------------------------------------------

/**
 * The other two gated deletes (`delete_project`, `delete_priority`), and the
 * two blocked-deletion rules scenario 03 does not reach: a project that still
 * has tasks, a priority still in use, and a project's last remaining status.
 */
async function deleteGatesAndBlocks(
  client: Client,
  model: string
): Promise<void> {
  process.stdout.write("\n14 delete gates and blocked deletions\n")

  const project = await createProject("Blocks")
  const task = await createTask(project.id, "Reconcile the invoice export")

  const session = client.session()
  const assertions: Assertion[] = []

  // --- a project that still has tasks --------------------------------------
  const askedProject = await runTurn(
    session,
    `Delete the project "${project.name}".`
  )

  check(
    assertions,
    "delete_project paused for approval",
    askedProject.approvalRequests.some(
      (request) => request.action.toolName === "delete_project"
    ),
    JSON.stringify(askedProject.approvalRequests.map((r) => r.action.toolName))
  )
  check(
    assertions,
    "the approval prompt carries the project id the tool would delete",
    askedProject.approvalRequests.some(
      (request) =>
        (request.action.input as { projectId?: string }).projectId ===
        project.id
    ),
    JSON.stringify(askedProject.approvalRequests.map((r) => r.action.input))
  )

  const projectResumed = await answer(session, askedProject, "approve")
  const projectsAfter = await listProjects()

  check(
    assertions,
    "the project still exists — the delete was blocked, not performed",
    projectsAfter.some((row) => row.id === project.id)
  )
  check(
    assertions,
    "the block is explained in terms of the tasks it still has",
    /task/i.test(transcript(projectResumed)),
    transcript(projectResumed).slice(0, 600)
  )
  check(
    assertions,
    "a concrete way forward is offered",
    /(delete|move|remove|first|then)/i.test(transcript(projectResumed)),
    transcript(projectResumed).slice(0, 600)
  )

  // --- a priority still in use ---------------------------------------------
  const inUse = (await readTask(task.id)).priority.name

  const askedPriority = await runTurn(
    session,
    `Delete the priority "${inUse}" from the project "${project.name}".`
  )

  check(
    assertions,
    "delete_priority paused for approval",
    askedPriority.approvalRequests.some(
      (request) => request.action.toolName === "delete_priority"
    ),
    JSON.stringify(askedPriority.approvalRequests.map((r) => r.action.toolName))
  )

  const priorityResumed = await answer(session, askedPriority, "approve")
  const prioritiesAfter = await listPriorities(project.id)

  check(
    assertions,
    "the in-use priority still exists",
    prioritiesAfter.some((row) => row.name === inUse),
    JSON.stringify(prioritiesAfter.map((row) => row.name))
  )
  check(
    assertions,
    "the block names the rule and offers a way forward",
    /(in use|used by|still|task)/i.test(transcript(priorityResumed)) &&
      /(move|reassign|another|different|change|first)/i.test(
        transcript(priorityResumed)
      ),
    transcript(priorityResumed).slice(0, 600)
  )

  // --- a project's last remaining status ------------------------------------
  // Set up over HTTP: an empty project, stripped down to one unused status.
  const lastOne = await createProject("LastStatus")
  const seeded = await listStatuses(lastOne.id)
  for (const status of seeded.slice(1)) {
    const removed = await apiJson(
      `/api/projects/${lastOne.id}/statuses/${status.id}`,
      { method: "DELETE" }
    )
    if (removed.status !== 204 && removed.status !== 200) {
      throw new Error(`Could not strip status '${status.name}'.`)
    }
  }
  const survivor = (await listStatuses(lastOne.id))[0]

  const askedLast = await runTurn(
    session,
    `Delete the "${survivor.name}" status from the project "${lastOne.name}".`
  )

  check(
    assertions,
    "delete_status paused for approval on the last remaining status too",
    askedLast.approvalRequests.some(
      (request) => request.action.toolName === "delete_status"
    ),
    JSON.stringify(askedLast.approvalRequests.map((r) => r.action.toolName))
  )

  const lastResumed = await answer(session, askedLast, "approve")
  const statusesAfter = await listStatuses(lastOne.id)

  check(
    assertions,
    "the last remaining status still exists",
    statusesAfter.some((row) => row.id === survivor.id),
    JSON.stringify(statusesAfter.map((row) => row.name))
  )
  check(
    assertions,
    "the block is explained as the last-remaining rule, with a way forward",
    /(last|only|at least one|remaining)/i.test(
      transcript(lastResumed)
    ) && /(create|add|another|new)/i.test(transcript(lastResumed)),
    transcript(lastResumed).slice(0, 600)
  )

  await writeTranscript("14-delete-gates-and-blocks.json", {
    scenario:
      "delete_project and delete_priority pause too; all three blocked-deletion rules relayed",
    userStories: ["US-F4.3", "US-F4.4"],
    model,
    projects: { withTasks: project.name, oneStatusLeft: lastOne.name },
    inUsePriority: inUse,
    lastRemainingStatus: survivor.name,
    turns: [
      askedProject,
      ...(projectResumed ? [projectResumed] : []),
      askedPriority,
      ...(priorityResumed ? [priorityResumed] : []),
      askedLast,
      ...(lastResumed ? [lastResumed] : []),
    ],
    assertions,
  })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
    const client = new Client({ host: baseUrl })
    await waitForAgent(client)

    const info = await client.info()
    const model = info.agent.model.id
    process.stdout.write(`Agent: ${info.agent.name} on ${model}\n`)

    await taskLifecycle(client, model)
    await searchAndFreshness(client, model)
    await listManagement(client, model)
    await deleteGatesAndBlocks(client, model)

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
