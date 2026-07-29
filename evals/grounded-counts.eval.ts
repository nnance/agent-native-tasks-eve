/**
 * Answers come from a list tool, and a thing that does not exist is said not
 * to exist (US-F2.1/2.2/2.4).
 *
 * `agent/instructions.md`: "Never answer a question about the user's tasks …
 * from memory or inference. Read the current data with a tool first, every
 * time." `06-agent-chat.test.ts` proves the agent *called* a read tool and
 * that fixture titles reached the page; what it cannot grade is whether the
 * number in the sentence is the number in the database, or whether an
 * unknown project produces an honest "no such project" instead of a confident
 * fabrication. Both are prose, and US-F2.4 is currently recorded in
 * `tests/e2e/README.md` as not asserted anywhere in the E2E suite for exactly
 * that reason. This eval closes it.
 *
 * Seven tasks, not three: a count small enough to be stated exactly, large
 * enough that a plausible guess ("a few") does not accidentally pass, and all
 * in non-completed statuses so a default `list_tasks` cannot under-count.
 */

import { defineEval } from "eve/evals"
import { includes } from "eve/evals/expect"

import {
  evalProject,
  evalTask,
  uniqueName,
  uniqueToken,
} from "./support/fixtures.ts"

export default defineEval({
  description:
    "Counts tasks from a live read rather than from memory, and says so " +
    "when a named project does not exist.",
  tags: ["grounding"],
  async test(t) {
    const { project, statuses } = await evalProject("Pantry")

    // Explicitly the first status: it is the project's non-completed default,
    // so nothing here can be hidden from an unfiltered list.
    const open = statuses[0]

    for (let index = 0; index < 7; index += 1) {
      await evalTask(project.id, `Restock shelf ${uniqueToken()}`, {
        statusId: open?.id,
      })
    }

    // --- Turn 1: a count that has exactly one right answer.
    const counted = await t.send(
      `How many tasks are in the project "${project.name}"?`
    )

    counted.calledTool("list_tasks")
    t.check(counted.message, includes("7"))

    // 0.6, not 0.7, and that is a reading of autoevals' scale rather than a
    // loosened bar. `Factuality` buckets a submission against the reference:
    // 1.0 for "identical", **0.6 for "a superset that is fully consistent"**,
    // 0.4 for a subset, 0 for a contradiction. A good reply here *is* a
    // superset — it names the project and usually what the tasks are — and
    // measured exactly 0.6. A 0.7 bar would therefore fail the correct answer
    // and pass only a terse restatement of the reference. The number that
    // must be right is gated deterministically above.
    t.judge.autoevals
      .factuality(`The project "${project.name}" contains 7 tasks.`, {
        on: counted.message,
      })
      .atLeast(0.6)

    // --- Turn 2, same session: a project that does not exist.
    const missingName = uniqueName("Wine cellar")
    const missing = await t.send(
      `And how many tasks are in the project "${missingName}"?`
    )

    // The failure mode is not a wrong number — it is *inventing the world to
    // match the question*. Both of these would be silent data corruption
    // dressed up as helpfulness.
    t.notCalledTool("create_project")
    t.notCalledTool("create_task")

    t.judge.autoevals
      .closedQA(
        "Does the reply say that no project by that name exists (or that it " +
          "could not find one) — rather than reporting a task count for it?",
        { on: missing.message }
      )
      .atLeast(0.7)

    t.succeeded()
  },
})
