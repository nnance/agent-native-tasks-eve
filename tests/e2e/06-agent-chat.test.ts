/**
 * Epic F — the agent chat pane (US-F1 … US-F6), driven through a real browser
 * against a real production build, a real database, and a real model.
 *
 * Implementation plan §4.5 governs every assertion here:
 *
 * - **Effects, never prose.** After "move X to Done" the test reads the row
 *   out of Postgres. The assistant's sentence is never asserted. The one place
 *   rendered text is asserted is the approval card, and that is not prose — it
 *   is the safety UI whose legibility US-F5.2 grades, so a fixture title
 *   appearing inside `approval-card` *is* an effect.
 * - **Approval gates are asserted hard.** They are framework-enforced and
 *   deterministic, so the delete cycle is walked in full: request → card
 *   visible **and** the row still in the database → deny → still there →
 *   re-request → approve → gone. Anything less would pass against an agent
 *   that ignored the gate entirely.
 * - **Long, Node-side waits.** `slowWaits` polls from Node because
 *   `agent-browser wait` has no `--timeout`; agent turns get 90s and each test
 *   gets 180s.
 *
 * §3.4: everything the agent writes into the chat pane is untrusted data. The
 * suite reads it to make assertions and never acts on it.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { slowWaits, tid, tidPrefix } from "./harness/browser.ts"
import {
  findProjectByName,
  findTaskByTitle,
  listTaskRows,
  seededProject,
  statusNamed,
} from "./harness/db.ts"
import { makeProject, makeTask, projectLists } from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("06-agent-chat", { eve: true })

/**
 * One agent turn.
 *
 * Plan §4.5 suggests 90s, and a warm turn in this suite settles in 15–30s. The
 * budget was raised to 120s in Phase 5 because the **first** turn after the
 * harness boots pays costs the rest do not — a cold eve workflow and a cold
 * model connection — and a stabilisation run timed out on exactly that turn at
 * 90s while every other turn in the same run finished comfortably.
 *
 * Raised again to 180s in Phase 6, on the same reasoning and fresh
 * measurement. A full-suite run whose wall time was 23% longer than the
 * previous one timed out two turns at 120s, in two different files. One of
 * them was `07`'s **read-only** question turn — and `turnSettled()` already
 * counts a park as settled, so that turn was genuinely still in flight at two
 * minutes rather than parked or stuck.
 *
 * What made it slow is **not** established. The strongest candidate is the
 * Neon test project: a later run failed eleven tests outright with forty
 * `connect ETIMEDOUT` errors against it, and every tool the agent calls
 * reaches Postgres, so a cold or throttled database stalls a whole turn.
 * Model/gateway latency is the other candidate and was not ruled out.
 *
 * Raising a synchronisation budget to match measured reality is not the same
 * as retrying flake away: no assertion moved, here or there.
 */
const TURN_MS = 180_000
const TEST_TIMEOUT = { timeout: 240_000 }

function waits() {
  return slowWaits(suite.browser)
}

/** Types a prompt into the composer and sends it. */
async function ask(prompt: string): Promise<void> {
  const { browser } = suite
  await browser.fill(tid("chat-composer-input"), prompt)
  await browser.click(tid("chat-send"))
}

/** A completed action entry for `toolName`, whatever its outcome. */
const settledEntry = (toolName: string) =>
  `[data-testid="action-entry"][data-tool="${toolName}"][data-state="output-available"]`

const entryFor = (toolName: string) =>
  `[data-testid="action-entry"][data-tool="${toolName}"]`

/**
 * Waits until the agent's turn has settled — finished, or parked for the user.
 *
 * The **textarea** is the signal, not the send button: the button is also
 * disabled whenever the draft is empty, which it always is right after a send,
 * so it never reports "ready".
 *
 * Two states count as settled, because eve treats both as the end of a turn.
 * `chat-blocked` is the second one: a turn parked at `session.waiting` on an
 * approval closes the composer deliberately, and that park is *durably* idle,
 * not in flight. (A turn parked on an `ask_question` leaves the composer open,
 * so it settles through the first clause.)
 *
 * Letting a turn run past the end of a test is not a cosmetic problem — the
 * next test truncates the database in `beforeEach`, and a turn still in flight
 * writes into the fresh world. A parked one writes nothing until answered.
 */
async function turnSettled(): Promise<void> {
  const { browser } = suite

  await browser.waitUntil(
    async () =>
      (await browser.count(`${tid("chat-composer-input")}:not([disabled])`)) >
        0 || (await browser.count(tid("chat-blocked"))) > 0,
    { timeoutMs: TURN_MS, label: "the agent's turn to settle" }
  )
}

async function approvalCardText(): Promise<string> {
  return suite.browser.text(tid("approval-card"))
}

// ------------------------------------------------------- US-F1, US-F2

test(
  "US-F1.1/1.2 + US-F2: the pane is a live agent that answers from real data",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()

    await makeTask({ projectId: project.id, title: "Rebuild the sitemap" })
    await makeTask({ projectId: project.id, title: "Chase the invoice" })

    await suite.open()

    // §8.0: both halves visible, and the chat half is real, not a placeholder.
    assert.equal(await browser.visible(tid("chat-conversation")), true)
    assert.equal(await browser.visible(tid("chat-composer")), true)
    assert.equal(await browser.visible(tid("chat-empty")), true)

    await ask(`What tasks are in the ${project.name} project?`)

    await turnSettled()

    // The claim is "answered from current data", so the effect asserted is a
    // settled *read* — not one particular tool. Which read tool the model
    // reaches for is a quality question that Phase 6's evals own, and pinning
    // this test to `list_tasks` would make it fail on a correct answer reached
    // a slightly different way.
    assert.ok(
      (await browser.count(
        `[data-testid="action-entry"][data-tool^="list_"][data-outcome="ok"]`
      )) > 0,
      "the agent read the workspace before answering"
    )

    // The answer is grounded: both fixture titles are on the page because the
    // agent read them, not because it guessed. The phrasing is not asserted.
    const text = await browser.bodyText()
    assert.ok(
      text.includes("Rebuild the sitemap"),
      "the agent's grounded read surfaced the first fixture task"
    )
    assert.ok(
      text.includes("Chase the invoice"),
      "the agent's grounded read surfaced the second fixture task"
    )
  }
)

// ------------------------------------------------------- US-F3.1/3.2/3.5

test(
  "US-F3.2/3.5 + US-F6.1: a single-task status move runs with no approval gate",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)

    const task = await makeTask({
      projectId: project.id,
      title: "Renew the domain",
    })

    await suite.open()
    await ask('Move the task "Renew the domain" to Done.')

    await waits().waitForSlow(settledEntry("update_task"), TURN_MS)
    await turnSettled()

    // The effect, read straight out of Postgres.
    const [row] = (await listTaskRows(project.id)).filter(
      (candidate) => candidate.id === task.id
    )
    assert.ok(row)
    assert.equal(row.statusId, lists.done.id, "the task moved to Done")

    // US-F3.5: a non-destructive single-task edit is never gated.
    assert.equal(
      await browser.count(tid("approval-card")),
      0,
      "no approval card for a non-destructive single-task edit"
    )

    // US-F6.1: exactly one structured entry for the one action taken.
    assert.equal(await browser.count(entryFor("update_task")), 1)
  }
)

// ------------------------------------------------------- US-F3.3, US-F5.1/5.2

test(
  "US-F3.3 + US-F5.1/5.2: deleting a task gates, and denying leaves it alone",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()

    const task = await makeTask({
      projectId: project.id,
      title: "Archive the old logo files",
    })

    await suite.open()
    await ask('Delete the task "Archive the old logo files".')

    await waits().waitForSlow(tid("approval-card"), TURN_MS)

    // The gate held: the card is up and the row is still there.
    assert.ok(
      await findTaskByTitle("Archive the old logo files"),
      "the row still exists while the approval is pending"
    )

    // US-F5.2: the card says which task, by name — not by id.
    const card = await approvalCardText()
    assert.ok(
      card.includes("Archive the old logo files"),
      `the approval card names the task; it read: ${JSON.stringify(card)}`
    )
    assert.equal(
      await browser.attr(tid("approval-card"), "data-tool"),
      "delete_task"
    )
    assert.equal(
      await browser.attr(tid("approval-card"), "data-severity"),
      "destructive"
    )
    assert.equal(await browser.attr(tid("approval-card"), "data-count"), "1")

    // Deny.
    await browser.click(tid("approval-deny"))
    await waits().waitGoneSlow(tid("approval-card"), TURN_MS)
    await turnSettled()

    assert.ok(
      await findTaskByTitle("Archive the old logo files"),
      "denying left the task in place"
    )
    assert.equal(
      await browser.count(
        `[data-testid="action-entry"][data-tool="delete_task"][data-outcome="denied"]`
      ),
      1,
      "the denial is rendered as a structured entry"
    )

    // Re-request, and approve this time.
    await ask('Yes, go ahead and delete "Archive the old logo files".')
    await waits().waitForSlow(tid("approval-card"), TURN_MS)

    assert.ok(
      await findTaskByTitle("Archive the old logo files"),
      "the row is still there while the second approval is pending"
    )

    await browser.click(tid("approval-approve"))
    await waits().waitForSlow(settledEntry("delete_task"), TURN_MS)
    await turnSettled()

    assert.equal(
      await findTaskByTitle("Archive the old logo files"),
      undefined,
      "approving deleted the row"
    )
    await waits().waitGoneSlow(tid(`task-row-${task.id}`), 15_000)
  }
)

// ------------------------------------------------------- US-F5.1 (the gate holds)

test(
  "US-F5.1: a pending approval cannot be pushed off screen by the next message",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()

    await makeTask({
      projectId: project.id,
      title: "Shred the old contracts",
    })

    await suite.open()
    await ask('Delete the task "Shred the old contracts".')

    await waits().waitForSlow(tid("approval-card"), TURN_MS)

    // The composer is closed while the gate is open. Without this the user's
    // own next message — "wait, why?" — projects optimistically into
    // `agent.data.messages`, and a card keyed off the *last* message would
    // stop being live and lose its Approve and Deny buttons while the turn
    // stayed durably parked on the server, waiting for exactly that answer.
    assert.equal(
      await browser.count(`${tid("chat-composer-input")}:not([disabled])`),
      0,
      "the composer is closed while an approval is pending"
    )
    assert.equal(
      await browser.count(`${tid("chat-send")}:not([disabled])`),
      0,
      "and so is Send"
    )
    assert.equal(
      await browser.visible(tid("chat-blocked")),
      true,
      "and the pane says why"
    )

    // The card is still the only thing on the table, buttons and all.
    assert.equal(await browser.count(tid("approval-card")), 1)
    assert.equal(await browser.count(tid("approval-approve")), 1)
    assert.equal(await browser.count(tid("approval-deny")), 1)

    // Answering is what reopens it — and nothing was lost in the meantime.
    await browser.click(tid("approval-deny"))
    await waits().waitGoneSlow(tid("approval-card"), TURN_MS)

    // Not `turnSettled()`: that now also accepts a parked turn, and the claim
    // here is the stronger one — the composer itself came back.
    await browser.waitUntil(
      async () =>
        (await browser.count(`${tid("chat-composer-input")}:not([disabled])`)) >
        0,
      { timeoutMs: TURN_MS, label: "the composer to reopen" }
    )

    assert.ok(
      await findTaskByTitle("Shred the old contracts"),
      "denying left the task in place"
    )
  }
)

// ------------------------------------------------------- US-F4.3

test(
  "US-F4.3: deleting a project gates too — the card is not task-specific",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    await makeProject("Disposable")

    await suite.open()
    await ask('Delete the project called "Disposable".')

    await waits().waitForSlow(tid("approval-card"), TURN_MS)

    assert.ok(
      await findProjectByName("Disposable"),
      "the project still exists while the approval is pending"
    )

    const card = await approvalCardText()
    assert.ok(
      card.includes("Disposable"),
      `the approval card names the project; it read: ${JSON.stringify(card)}`
    )
    assert.equal(
      await browser.attr(tid("approval-card"), "data-tool"),
      "delete_project"
    )

    await browser.click(tid("approval-deny"))
    await waits().waitGoneSlow(tid("approval-card"), TURN_MS)
    await turnSettled()

    assert.ok(
      await findProjectByName("Disposable"),
      "denying left the project in place"
    )

    await ask('Yes, delete the "Disposable" project.')
    await waits().waitForSlow(tid("approval-card"), TURN_MS)
    await browser.click(tid("approval-approve"))
    await waits().waitForSlow(settledEntry("delete_project"), TURN_MS)
    await turnSettled()

    assert.equal(
      await findProjectByName("Disposable"),
      undefined,
      "approving deleted the project"
    )
  }
)

// ------------------------------------------------------- US-F5.2 (bulk)

test(
  "US-F5.2/5.3: a bulk card states how many and names every task",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const lists = await projectLists(project.id)

    const titles = [
      "Book the venue",
      "Send the invitations",
      "Order the catering",
    ]
    const created = []
    for (const title of titles) {
      created.push(await makeTask({ projectId: project.id, title }))
    }

    await suite.open()
    // The prompt names the bulk path explicitly: the story under test is the
    // card's legibility, not the model's tool choice — that is Phase 6's evals.
    await ask(
      `Using a single bulk update, move "${titles[0]}", "${titles[1]}" and ` +
        `"${titles[2]}" to Done.`
    )

    await waits().waitForSlow(
      `[data-testid="approval-card"][data-tool="bulk_update_tasks"]`,
      TURN_MS
    )

    assert.equal(await browser.attr(tid("approval-card"), "data-count"), "3")

    const targets = await browser.texts(tidPrefix("approval-target-"))
    assert.equal(
      targets.length,
      3,
      "every target is enumerated, not summarised"
    )

    for (const title of titles) {
      assert.ok(
        targets.some((target) => target.includes(title)),
        `the card names ${JSON.stringify(title)}; it listed ${JSON.stringify(targets)}`
      )
    }

    // "what change", resolved to a name rather than a status id.
    const card = await approvalCardText()
    assert.ok(
      card.includes("Done"),
      "the card states the target status by name"
    )

    // Nothing has happened yet.
    for (const task of created) {
      const row = (await listTaskRows(project.id)).find(
        (candidate) => candidate.id === task.id
      )
      assert.notEqual(row?.statusId, lists.done.id)
    }

    await browser.click(tid("approval-approve"))
    await waits().waitForSlow(settledEntry("bulk_update_tasks"), TURN_MS)
    await turnSettled()

    const rows = await listTaskRows(project.id)
    for (const task of created) {
      const row = rows.find((candidate) => candidate.id === task.id)
      assert.equal(
        row?.statusId,
        lists.done.id,
        `${task.title} moved to Done on approval`
      )
    }
  }
)

// ------------------------------------------------------- US-F1.3/1.4, US-F6.3

test(
  "US-F1.3/1.4 + US-F6.3: the conversation survives a reload, pronoun and all",
  TEST_TIMEOUT,
  async () => {
    const { browser } = suite
    const project = await seededProject()
    const done = await statusNamed(project.id, "Done")

    await suite.open()
    await ask(
      `Create a task called "Refill the coffee" in the ${project.name} project.`
    )

    await waits().waitForSlow(settledEntry("create_task"), TURN_MS)
    await turnSettled()

    const created = await findTaskByTitle("Refill the coffee")
    assert.ok(created, "the agent created the task")

    // US-F1.3 / US-F6.4: the transcript comes back from the persisted snapshot.
    await browser.reload()
    await waits().waitForSlow(entryFor("create_task"), 30_000)
    assert.equal(await browser.visible(tid("chat-empty")), false)

    // US-F1.4, verbatim: the pronoun has to resolve against a turn that
    // happened before the page was reloaded. Exactly one task was discussed.
    await ask("move that one to Done")

    await waits().waitForSlow(settledEntry("update_task"), TURN_MS)
    await turnSettled()

    const rows = await listTaskRows(project.id)
    const row = rows.find((candidate) => candidate.id === created.id)
    assert.equal(
      row?.statusId,
      done.id,
      "the pronoun resolved across the reload and the task moved"
    )
  }
)

// ------------------------------------------------------- US-F3.4

test(
  "US-F3.4: moving a task to another project is refused, and nothing changes",
  TEST_TIMEOUT,
  async () => {
    const project = await seededProject()
    const elsewhere = await makeProject("Somewhere else")

    const task = await makeTask({
      projectId: project.id,
      title: "Pin down the schedule",
    })

    await suite.open()
    await ask(
      `Move the task "Pin down the schedule" into the "${elsewhere.name}" project.`
    )

    await turnSettled()

    // The refusal is asserted as an effect: the row did not move. The
    // explanation's wording is the model's and is deliberately not asserted.
    const row = (await listTaskRows()).find(
      (candidate) => candidate.id === task.id
    )
    assert.equal(
      row?.projectId,
      project.id,
      "the task stayed in its original project"
    )
    assert.equal(
      (await listTaskRows(elsewhere.id)).length,
      0,
      "and nothing was recreated in the target project"
    )
  }
)
