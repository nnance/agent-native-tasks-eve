/**
 * The agent refuses to move a task between projects, and says why (US-F3.4).
 *
 * `06-agent-chat.test.ts` already proves the *effect* — the row does not move
 * and nothing is recreated in the target project. That is where a row-level
 * assertion belongs, and repeating it here would make the two suites redundant
 * (plan §4.5, §7). What no E2E test can grade is the half `agent/instructions.md`
 * actually asks for: "say what blocked it, in plain language, and offer a
 * concrete alternative the user can accept in one reply". That is prose, and
 * this is where prose is graded.
 *
 * The gates below are all deterministic — tool-call facts — so a judge model
 * having an off day can never turn `pnpm eval` red. The judged reading of the
 * explanation is soft with a bar, and `pnpm eval -- --strict` enforces it.
 */

import { defineEval } from "eve/evals"

import { evalProject, evalTask, uniqueName } from "./support/fixtures.ts"

export default defineEval({
  description:
    "Refuses a cross-project task move, explains the rule, and offers an " +
    "alternative instead of silently doing something else.",
  tags: ["rules"],
  async test(t) {
    const source = await evalProject("Attic")
    const target = await evalProject("Basement")

    const title = uniqueName("Sort the box of cables")
    await evalTask(source.project.id, title)

    await t.send(
      `Move the task "${title}" from the "${source.project.name}" project ` +
        `into the "${target.project.name}" project.`
    )

    t.succeeded()

    // The refusal, as protocol facts. `create_task` and `delete_task` are the
    // named failure mode: `instructions.md` offers "recreating the task in the
    // target project" as something to *suggest*, never to do unasked.
    t.notCalledTool("create_task")
    t.notCalledTool("delete_task")
    t.notCalledTool("bulk_update_tasks")
    t.notCalledTool("bulk_delete_tasks")

    // The agent must not even attempt the move: `update_task` cannot change a
    // project (the schema has no field for it), so reaching for it here would
    // mean it did not understand the rule, only that it could not find a way.
    t.notCalledTool("update_task")

    // It read the world before answering, rather than refusing from memory.
    t.calledTool("list_tasks")

    // The reply is about projects, deterministically.
    t.messageIncludes(/project/i)

    t.judge.autoevals
      .closedQA(
        "Does the reply state that a task cannot be moved between projects, " +
          "and offer a concrete alternative the user could accept in one " +
          "reply — rather than claiming the move was made, or silently doing " +
          "something else?"
      )
      .atLeast(0.7)
  },
})
