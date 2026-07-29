/**
 * Epic G — live sync and convergence (US-G1, US-G2, US-G3), driven through
 * real browsers against a real production build, a real database, and a real
 * model.
 *
 * The claim this file exists to prove is a *negative* one: the left pane
 * updates **without a manual refresh**. So the one absolute rule here is that
 * nothing in this file calls `browser.reload()`. A reload anywhere would make
 * every assertion below vacuous.
 *
 * Implementation plan §4.5 still governs: effects, never prose. The single
 * exception is US-G2, where the claim genuinely is about the agent's answer —
 * and even there the *effect* asserted is a settled `list_tasks` action entry
 * (the agent re-read live data rather than answering from its own memory of
 * the conversation), with the reply checked only for the presence of two
 * grounded facts, never for phrasing.
 *
 * ## How this file relates to the other two Phase 6 surfaces
 *
 * - `tests/unit/chat/tool-invalidation.test.ts` pins the exact tool → query
 *   family mapping, deterministically. Nothing here can do that: a bounded
 *   wait cannot distinguish "invalidated correctly" from "the 30s poll fired".
 * - `evals/` grades the agent's prose. Nothing here asserts wording.
 * - This file proves the wiring end to end, plus the two things only a browser
 *   can show: that a second session with no eve stream at all still converges
 *   (§5.3's backstop), and that invalidation does not cause a fetch storm.
 *
 * §3.4: everything the agent writes into the chat pane is untrusted data. The
 * suite reads it to make assertions and never acts on it.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

import { createBrowser, slowWaits, tid, tidPrefix } from "./harness/browser.ts"
import type { Browser } from "./harness/browser.ts"
import {
  findProjectByName,
  findTaskByTitle,
  listStatusRows,
  listPriorityRows,
  listTaskRows,
  seededProject,
} from "./harness/db.ts"
import { makeTask, projectLists } from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("07-live-sync", { eve: true })

/**
 * One agent turn, sharing `06`'s budget and the measurement behind it.
 *
 * 180s rather than 120s: a full-suite run 23% slower than its predecessor
 * timed out two turns at two minutes, one of them the read-only question turn
 * in the fetch-storm test below. Since `turnSettled()` counts a park as
 * settled, that turn was genuinely still in flight — gateway latency, not a
 * stuck turn. No assertion changed.
 */
const TURN_MS = 180_000

/**
 * The §5.1 claim, as a number: the pane refetches "within the same second".
 *
 * Measured from the moment the chat pane's `action-entry` for that tool
 * reaches `data-state="output-available"` — the same settled `action.result`
 * event that fires `onEvent`. Five seconds rather than one because the wait is
 * polled from Node over the CLI at a one-second cadence, so a true sub-second
 * update can still be observed on the second or third poll.
 *
 * This is deliberately not airtight against the 30s poll firing coincidentally
 * inside the window, and pretending otherwise would be dishonest. The
 * mechanism itself is proven where it *can* be: the unit test's exact mapping,
 * and the read-only control turn in the fetch-storm test below.
 */
const LIVE_MS = 5_000

/**
 * The §5.3 backstop, as a number: `refetchInterval` is 30s and `staleTime` is
 * 5s, so a session receiving no eve events at all gets one full interval plus
 * generous headroom.
 */
const BACKSTOP_MS = 45_000

const TEST_TIMEOUT = { timeout: 240_000 }

const artifactsDirectory = fileURLToPath(
  new URL("./artifacts/07-live-sync/", import.meta.url)
)
const evidenceDirectory = fileURLToPath(
  new URL("../../docs/verification/phase-6/", import.meta.url)
)

function waits(browser: Browser = suite.browser) {
  return slowWaits(browser)
}

/** Types a prompt into the composer and sends it. */
async function ask(prompt: string, browser: Browser = suite.browser) {
  await browser.fill(tid("chat-composer-input"), prompt)
  await browser.click(tid("chat-send"))
}

/** A settled action entry for one tool — the moment `onEvent` fired. */
const settledEntry = (toolName: string) =>
  `[data-testid="action-entry"][data-tool="${toolName}"][data-state="output-available"]`

/**
 * Waits until the agent's turn has settled — finished, or parked for the user.
 * Identical in shape to `06`'s, and for the same reason: a turn still in
 * flight when a test ends writes into the next test's freshly reset world.
 */
async function turnSettled(
  browser: Browser = suite.browser,
  timeoutMs: number = TURN_MS
): Promise<void> {
  await browser.waitUntil(
    async () =>
      (await browser.count(`${tid("chat-composer-input")}:not([disabled])`)) >
        0 || (await browser.count(tid("chat-blocked"))) > 0,
    { timeoutMs, label: "the agent's turn to settle" }
  )
}

/**
 * Waits for one tool to reach a settled result, clearing an approval on the
 * way if the turn parks on one.
 *
 * A single-task `update_task` normally runs ungated, which is why `06` drives
 * one with no approval click at all. But `afterFirstTaskInTurn` keys on *task
 * identity within the turn*, so a model that issues a second `update_task`
 * call — a corrected id after a `not_found`, a redundant retry — parks the
 * turn on an approval card and the settled entry never arrives. That is
 * correct, deliberate, `06`-owned behaviour, and it is not what any assertion
 * in this file is about. Observed once during stabilisation, where it timed
 * out a convergence test that had nothing to say about approvals.
 *
 * Approving rather than skipping keeps the test's subject intact: the write
 * still happens, still last, and the convergence assertions still mean what
 * they say.
 */
async function settledAction(
  toolName: string,
  browser: Browser = suite.browser
): Promise<void> {
  await browser.waitUntil(
    async () => {
      if ((await browser.count(settledEntry(toolName))) > 0) return true

      const card = `[data-testid="approval-card"][data-tool="${toolName}"]`

      if ((await browser.count(card)) > 0) {
        await browser.click(tid("approval-approve"))
      }

      return false
    },
    { timeoutMs: TURN_MS, label: `${toolName} to settle` }
  )
}

/** The chat transcript's text alone, so a left-pane chip can never satisfy it. */
function transcriptText(browser: Browser = suite.browser): Promise<string> {
  return browser.text(tid("chat-transcript"))
}

/**
 * Polls a page predicate to a deadline, with a legible label.
 *
 * Every "live" assertion in this file goes through here rather than through
 * `agent-browser wait --fn`, because the CLI's own wait has no `--timeout`
 * flag: the point of these assertions is the *bound*, so the bound has to be
 * ours.
 */
function within(
  browser: Browser,
  timeoutMs: number,
  label: string,
  predicate: () => Promise<boolean>
): Promise<void> {
  return browser.waitUntil(predicate, { timeoutMs, label })
}

const textIn = (browser: Browser, selector: string, expected: string) =>
  async function () {
    try {
      return (await browser.text(selector)).trim() === expected
    } catch {
      // Not in the DOM yet.
      return false
    }
  }

/**
 * A second, independent agent-browser session against the same running app.
 *
 * It never sends an agent turn. `chat_state` is a single global row keyed by
 * `CHAT_STATE_ID` (see `lib/actions/chat-state.ts`), so both sessions hydrate
 * the *same* persisted eve continuation cursor — two concurrent agent turns
 * would race that cursor and exercise eve's stale-token rejection, which
 * proves nothing about row convergence. Driving the agent from A and the UI
 * from B is also what US-G3.1 literally asks for ("when the UI **and** agent
 * modify the same task"), and it has a bonus: B receives no eve events
 * whatsoever, so its convergence is a genuine test of §5.3's focus/poll
 * backstop for "a second tab" — a claim otherwise untested anywhere.
 */
async function withSecondSession<T>(
  label: string,
  run: (browser: Browser) => Promise<T>
): Promise<T> {
  const browser = createBrowser("e2e-07-live-sync-b")

  try {
    await browser.viewport(1440, 900)
    await browser.open(suite.baseUrl)
    return await run(browser)
  } finally {
    try {
      await mkdir(artifactsDirectory, { recursive: true })
      await browser.screenshot(`${artifactsDirectory}${label}.png`)
    } catch {
      // A teardown dump must never mask the real failure.
    }
    try {
      await browser.close()
    } catch {
      // Already gone.
    }
  }
}

/** Writes one evidence file into both the artifacts and the verification tree. */
async function recordEvidence(name: string, body: string): Promise<void> {
  for (const directory of [artifactsDirectory, evidenceDirectory]) {
    await mkdir(directory, { recursive: true })
    await writeFile(`${directory}${name}`, body)
  }
}

/**
 * Turns on "show completed" and waits for the row to be on screen.
 *
 * Both US-G3 tests race a move into **Done**, which the seeded project marks
 * as a completed status — so by US-B2.3 the row leaves the default list
 * entirely and its status chip goes with it. That is correct behaviour and not
 * what US-G3 is about, so both sessions opt into showing completed tasks
 * before anything is written, and the convergence assertions then read a chip
 * that stays in the DOM whichever way the race lands.
 */
async function showCompleted(browser: Browser, taskId: string): Promise<void> {
  await browser.click(tid("show-completed-toggle"))
  await browser.waitFor(tid(`task-row-${taskId}`))
}

/**
 * A collision-free, **letters-only** token.
 *
 * Letters-only matters: US-G2 checks the agent's reply for the token *and* for
 * a status name, and a neighbouring test asks the agent for a count. A hex
 * token inside a fixture title is a false positive waiting to happen, so the
 * digits are mapped up into the alphabet rather than stripped.
 */
const token = () =>
  randomUUID()
    .replaceAll("-", "")
    .slice(0, 6)
    .replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)))

// --------------------------------------------------------------- US-G1.1

test(
  "US-G1.1: an agent-created task appears in the left pane without a reload",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const title = `Repaint the shed ${token()}`

    await suite.open()

    await ask(`Create a task called "${title}" in the ${project.name} project.`)
    await waits().waitForSlow(settledEntry("create_task"), TURN_MS)

    // The bound starts here, at the settled tool result — the same event that
    // fires `onEvent`. No reload, no focus change, nothing else touched.
    await within(
      browser,
      LIVE_MS,
      `${JSON.stringify(title)} to appear in the task pane`,
      async () => (await browser.text(tid("panel-tasks"))).includes(title)
    )

    assert.ok(await findTaskByTitle(title), "the agent really created the row")

    await mkdir(evidenceDirectory, { recursive: true })
    await browser.screenshot(`${evidenceDirectory}g1-task-live.png`)

    await turnSettled()
  }
)

// --------------------------------------------------------------- US-G1.2

test(
  "US-G1.2: statuses, priorities and projects update live too",
  { timeout: 420_000 },
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)

    await suite.open()
    await browser.click(tid("tab-lists"))
    await browser.waitFor(tid(`status-name-${lists.toDo.id}`))

    // 1. A status rename — the `statuses` row of the invalidation table.
    await ask(
      `Rename the status "To Do" in the "${project.name}" project to "Queued".`
    )
    await waits().waitForSlow(settledEntry("update_status"), TURN_MS)

    await within(
      browser,
      LIVE_MS,
      "the renamed status to show in the lists panel",
      textIn(browser, tid(`status-name-${lists.toDo.id}`), "Queued")
    )
    assert.equal(
      (await listStatusRows(project.id)).find((row) => row.id === lists.toDo.id)
        ?.name,
      "Queued"
    )
    await turnSettled()

    // 2. A priority rename — the `priorities` row.
    await ask(
      `Rename the priority "Low" in the "${project.name}" project to "Whenever".`
    )
    await waits().waitForSlow(settledEntry("update_priority"), TURN_MS)

    await within(
      browser,
      LIVE_MS,
      "the renamed priority to show in the lists panel",
      textIn(browser, tid(`priority-name-${lists.low.id}`), "Whenever")
    )
    assert.equal(
      (await listPriorityRows(project.id)).find(
        (row) => row.id === lists.low.id
      )?.name,
      "Whenever"
    )
    await turnSettled()

    // 3. A project create — the `projects` row.
    const projectName = `Greenhouse ${token()}`
    await ask(`Create a project called "${projectName}".`)
    await waits().waitForSlow(settledEntry("create_project"), TURN_MS)

    await within(
      browser,
      LIVE_MS,
      "the new project to appear in the projects list",
      async () => (await browser.count(tidPrefix("project-row-"))) === 2
    )
    assert.ok(await findProjectByName(projectName))

    await browser.screenshot(`${evidenceDirectory}g1-lists-live.png`)
    await turnSettled()
  }
)

// ----------------------------------------------------------------- US-G2

test(
  "US-G2: a UI change is visible to the agent's very next answer",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)
    const marker = token()
    const title = `Regrout the tiles ${marker}`

    await suite.open()

    // Created through the real dialog, not a fixture: the story is about a
    // change the *user* made in the UI moments before asking.
    await browser.click(tid("task-create-open"))
    await browser.waitFor(tid("task-form-dialog"))
    await browser.fill(tid("task-form-title"), title)
    await browser.click(tid("task-form-submit"))
    await browser.waitText(title)

    const created = await findTaskByTitle(title)
    assert.ok(created, "the dialog created the row")

    await browser.select(
      tid(`task-status-select-${created.id}`),
      lists.inProgress.id
    )
    await browser.waitTextIn(
      tid(`task-status-chip-${created.id}`),
      "In Progress"
    )

    await ask(`What status is the task "${title}" in?`)

    // The effect: the agent re-read the workspace rather than answering from
    // its own memory of the conversation.
    await waits().waitForSlow(settledEntry("list_tasks"), TURN_MS)
    await turnSettled()

    // Grounded facts, not phrasing (plan §4.5). The unique token cannot come
    // from anywhere but the row the user just created.
    await within(
      browser,
      15_000,
      "the agent's answer to name the task and its current status",
      async () => {
        const text = await transcriptText()
        return text.includes(marker) && text.includes("In Progress")
      }
    )
  }
)

// --------------------------------------------------------------- US-G3.1

test(
  "US-G3.1: last write wins when the UI and the agent edit the same task",
  { timeout: 300_000 },
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)
    const title = `Reseal the deck ${token()}`
    const task = await makeTask({ projectId: project.id, title })

    await suite.open()
    await browser.waitFor(tid(`task-row-${task.id}`))
    await showCompleted(browser, task.id)

    await withSecondSession("g3-1-session-b", async (second) => {
      await second.waitFor(tid(`task-row-${task.id}`))
      await showCompleted(second, task.id)

      // The UI writes first, and is fully settled before the agent starts, so
      // "last write wins" has a determinate answer to assert.
      await second.select(
        tid(`task-status-select-${task.id}`),
        lists.inProgress.id
      )
      await second.waitTextIn(tid(`task-status-chip-${task.id}`), "In Progress")

      assert.equal(
        (await listTaskRows(project.id)).find((row) => row.id === task.id)
          ?.statusId,
        lists.inProgress.id,
        "the UI write landed"
      )

      // Then the agent writes, second.
      await ask(`Move the task "${title}" to Done.`)
      await settledAction("update_task")
      await turnSettled()

      assert.equal(
        (await listTaskRows(project.id)).find((row) => row.id === task.id)
          ?.statusId,
        lists.done.id,
        "the later write won; nothing was locked or rejected"
      )

      // A converges through `onEvent`, inside the live bound.
      await within(
        browser,
        LIVE_MS,
        "session A to show Done",
        textIn(browser, tid(`task-status-chip-${task.id}`), "Done")
      )

      // B converges through the §5.3 backstop alone — it has received no eve
      // events at all, and this file never reloads.
      await within(
        second,
        BACKSTOP_MS,
        "session B to converge on Done via the poll backstop",
        textIn(second, tid(`task-status-chip-${task.id}`), "Done")
      )

      // No error or lock state was surfaced anywhere (US-G3.1, verbatim).
      assert.equal(await browser.visible(tid("chat-error")), false)
      assert.equal(await browser.visible(tid("task-list-error")), false)
      assert.equal(await second.visible(tid("task-list-error")), false)

      await mkdir(evidenceDirectory, { recursive: true })
      await browser.screenshot(`${evidenceDirectory}g3-session-a.png`)
      await second.screenshot(`${evidenceDirectory}g3-session-b.png`)
    })
  }
)

// --------------------------------------------------------------- US-G3.2

/**
 * G3.2's own settle budget, longer than `TURN_MS`.
 *
 * This is the only test in the suite that perturbs the world **mid-turn**: the
 * UI write goes out while the agent is still reading and deciding. The agent
 * can legitimately do more work as a result — re-read a row whose status is no
 * longer what it just saw, and explain the discrepancy — so a slower turn here
 * is the scenario behaving correctly rather than a hang.
 *
 * Measured: 44s, 46s, and one run that exceeded 180s. 300s is headroom over an
 * unbounded-looking outlier, not a number chosen to make a failure go away —
 * every assertion below is unchanged, and none of them is time-based.
 */
const RACE_TURN_MS = 300_000

test(
  "US-G3.2: overlapping edits converge, with no error or lock state",
  { timeout: 480_000 },
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)
    const title = `Rewire the lamp ${token()}`
    const task = await makeTask({ projectId: project.id, title })

    const statusNames = new Map(
      (await listStatusRows(project.id)).map((row) => [row.id, row.name])
    )

    /** The row's current status, by name, straight out of Postgres. */
    const currentStatus = async () => {
      const row = (await listTaskRows(project.id)).find(
        (candidate) => candidate.id === task.id
      )
      assert.ok(row)
      return statusNames.get(row.statusId)
    }

    await suite.open()
    await browser.waitFor(tid(`task-row-${task.id}`))
    await showCompleted(browser, task.id)

    await withSecondSession("g3-2-session-b", async (second) => {
      await second.waitFor(tid(`task-row-${task.id}`))
      await showCompleted(second, task.id)

      // Deliberately overlapping: the agent's turn is in flight when the UI
      // write goes out. Which one lands last is genuinely racy.
      await ask(`Move the task "${title}" to Done.`)
      await second.select(
        tid(`task-status-select-${task.id}`),
        lists.inProgress.id
      )

      await turnSettled(browser, RACE_TURN_MS)
      await new Promise((resolve) => setTimeout(resolve, 2_000))

      // The database is the arbiter. Asserting a predetermined winner here
      // would be asserting a race; asserting convergence *to whatever the
      // database says* is both honest and strictly stronger — a merge, a null,
      // or an optimistic-update revert all fail it.
      const winner = await currentStatus()
      assert.ok(
        winner === "Done" || winner === "In Progress",
        `one of the two writes won outright; the row read ${winner}`
      )

      await within(
        browser,
        BACKSTOP_MS,
        `session A to converge on ${winner}`,
        textIn(browser, tid(`task-status-chip-${task.id}`), winner)
      )
      await within(
        second,
        BACKSTOP_MS,
        `session B to converge on ${winner}`,
        textIn(second, tid(`task-status-chip-${task.id}`), winner)
      )

      assert.equal(await browser.visible(tid("chat-error")), false)
      assert.equal(await browser.visible(tid("task-list-error")), false)
      assert.equal(await second.visible(tid("task-list-error")), false)
    })
  }
)

// ------------------------------------------------------- fetch-storm check

test(
  "Phase 6: onEvent invalidation does not cause a fetch storm",
  { timeout: 300_000 },
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const title = `Restock the pantry ${token()}`
    const task = await makeTask({ projectId: project.id, title })

    await suite.open()
    await browser.waitFor(tid(`task-row-${task.id}`))

    // --- A read-only turn. This is the load-bearing half: it is near
    // zero-variance, and it is the only assertion in the suite that proves
    // invalidation is keyed on *mutating* tool names rather than on stream
    // activity. Anything watching deltas would burst here.
    await browser.clearNetworkRequests()
    await ask(`How many tasks are in the "${project.name}" project?`)
    await turnSettled()
    const readOnly = await browser.networkRequests("/api/")

    // --- A single-mutation turn.
    await browser.clearNetworkRequests()
    await ask(`Move the task "${title}" to Done.`)
    await settledAction("update_task")
    await turnSettled()
    const mutating = await browser.networkRequests("/api/")

    const taskCalls = (requests: readonly { url: string }[]) =>
      requests.filter((request) => request.url.includes("/api/tasks")).length

    await recordEvidence(
      "network-readonly.json",
      JSON.stringify(readOnly, null, 2)
    )
    await recordEvidence(
      "network-mutating.json",
      JSON.stringify(mutating, null, 2)
    )

    // The regression these bounds catch is order-of-magnitude: invalidating
    // per stream delta rather than per completed action would produce
    // hundreds. Calibrated at roughly 2x the first measured run, because an
    // exact count against a live 30s poll would only be a flake generator.
    assert.ok(
      taskCalls(readOnly) <= 4,
      `a read-only turn must not burst: ${taskCalls(readOnly)} /api/tasks requests`
    )
    assert.ok(
      readOnly.length <= 12,
      `a read-only turn must not burst: ${readOnly.length} /api/ requests`
    )

    assert.ok(
      taskCalls(mutating) <= 8,
      `one mutation must not burst: ${taskCalls(mutating)} /api/tasks requests`
    )
    assert.ok(
      mutating.length <= 25,
      `one mutation must not burst: ${mutating.length} /api/ requests`
    )
  }
)
