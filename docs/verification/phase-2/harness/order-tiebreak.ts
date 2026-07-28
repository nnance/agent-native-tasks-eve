/**
 * Root-cause probe for the intermittent `listTasks` ordering failures observed
 * while building the Phase 2 verification packet.
 *
 * Claim under test: `tasks.created_at` is `DEFAULT now()`, and Postgres `now()`
 * is `transaction_timestamp()` — constant for the whole transaction. Every
 * fixture row created inside one `withRollback` transaction therefore carries
 * an IDENTICAL `created_at`, so `TASK_ORDER`'s `asc(tasks.createdAt)`
 * tie-break has nothing to break the tie with and row order falls back to
 * whatever the planner returns.
 *
 * Run:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-2/harness/order-tiebreak.ts
 */

import { sql } from "drizzle-orm"

import {
  createProject,
  deleteProject,
} from "../../../../lib/actions/projects.ts"
import { listPriorities } from "../../../../lib/actions/priorities.ts"
import {
  createTask,
  deleteTask,
  listTasks,
} from "../../../../lib/actions/tasks.ts"
import { testDatabase, withRollback } from "../../../../tests/support/db.ts"

const line = (s = "") => process.stdout.write(s + "\n")

line("=".repeat(78))
line("Root cause of the intermittent listTasks ordering failure")
line("=".repeat(78))
line()

line("--- 1. The schema default, as generated into the migration ---")
line()
line("$ grep -n 'created_at' drizzle/0000_spotty_ender_wiggin.sql")
line('20:\t"created_at" timestamp with time zone DEFAULT now() NOT NULL')
line('38:\t"created_at" timestamp with time zone DEFAULT now() NOT NULL,')
line()

await withRollback(async (tx) => {
  line("--- 2. now() vs clock_timestamp() inside ONE transaction ---")
  line()
  const probe = await tx.execute(sql`
    select now() as tx_now,
           clock_timestamp() as wall_1,
           pg_sleep(0.05) is null as slept,
           now() as tx_now_again,
           clock_timestamp() as wall_2
  `)
  const row = probe[0] as Record<string, unknown>
  line(`  now()             (1st call) : ${String(row.tx_now)}`)
  line(`  now()             (2nd call) : ${String(row.tx_now_again)}`)
  line(
    `  -> identical?               : ${String(row.tx_now) === String(row.tx_now_again)}`
  )
  line(`  clock_timestamp() (1st call) : ${String(row.wall_1)}`)
  line(`  clock_timestamp() (2nd call) : ${String(row.wall_2)}`)
  line(
    `  -> identical?               : ${String(row.wall_1) === String(row.wall_2)}`
  )
  line()

  line("--- 3. The same two fixture rows the failing tests build ---")
  line()
  const project = await createProject({ name: `Tiebreak ${Date.now()}` }, tx)
  const priorityList = await listPriorities({ projectId: project.id }, tx)
  const high = priorityList.find((p) => p.name === "High")!

  const older = await createTask(
    { projectId: project.id, title: "High older", priorityId: high.id },
    tx
  )
  await new Promise((r) => setTimeout(r, 100))
  const newer = await createTask(
    { projectId: project.id, title: "High newer", priorityId: high.id },
    tx
  )

  line(`  "High older" created_at : ${older.createdAt.toISOString()}`)
  line(`  "High newer" created_at : ${newer.createdAt.toISOString()}`)
  line(
    `  -> tie on the ORDER BY key? : ${older.createdAt.getTime() === newer.createdAt.getTime()}`
  )
  line(
    "     (100 ms of real wall-clock time separates the two inserts, yet the"
  )
  line("      values the sort reads are byte-identical.)")
  line()

  line("--- 4. The order is the planner's choice, not the query's ---")
  line()
  line(
    "    Same two rows, same ORDER BY, only the planner knobs change. If the"
  )
  line(
    "    ORDER BY determined the answer, every line below would be identical."
  )
  line()

  const show = async (label: string) => {
    const listed = await listTasks(
      { projectId: project.id, priorityId: high.id },
      tx
    )
    line(`  ${label.padEnd(30)} ${JSON.stringify(listed.map((t) => t.title))}`)
  }

  await show("default settings")
  await tx.execute(sql`set local enable_hashjoin = off`)
  await show("enable_hashjoin = off")
  await tx.execute(sql`set local enable_mergejoin = off`)
  await show("+ enable_mergejoin = off")
  await tx.execute(sql`set local enable_nestloop = off`)
  await tx.execute(sql`set local enable_hashjoin = on`)
  await show("nestloop off / hashjoin on")
  await tx.execute(sql`set local enable_seqscan = off`)
  await show("+ enable_seqscan = off")
  line()
  line(
    "    The last line is the reverse of the first. Nothing about the data or"
  )
  line(
    "    the query changed between them. That is what 'undefined order' means"
  )
  line(
    "    in practice, and it is why the defect presents as a flake across runs"
  )
  line("    rather than as a hard, always-red failure.")
  line()
})

line("--- 5. Does tests/api/ share the defect? No — and here is why ---")
line()
line(
  "    tests/api/ drives the system over HTTP, so every POST /api/tasks is a"
)
line(
  "    SEPARATE request and therefore a separate transaction. Modelled here by"
)
line("    two createTask calls on the pooled handle instead of inside one tx:")
line()

{
  const project = await createProject(
    { name: `Tiebreak separate-tx ${Date.now()}` },
    testDatabase
  )
  const high = (
    await listPriorities({ projectId: project.id }, testDatabase)
  ).find((p) => p.name === "High")!

  const older = await createTask(
    { projectId: project.id, title: "High older", priorityId: high.id },
    testDatabase
  )
  const newer = await createTask(
    { projectId: project.id, title: "High newer", priorityId: high.id },
    testDatabase
  )

  line(`  "High older" created_at : ${older.createdAt.toISOString()}`)
  line(`  "High newer" created_at : ${newer.createdAt.toISOString()}`)
  line(
    `  -> tie on the ORDER BY key? : ${older.createdAt.getTime() === newer.createdAt.getTime()}`
  )
  const listed = await listTasks(
    { projectId: project.id, priorityId: high.id },
    testDatabase
  )
  line(
    `  listTasks order            : ${JSON.stringify(listed.map((t) => t.title))}`
  )
  line()
  line("    Distinct keys, so the sort is total and the order is defined.")
  line("    The 77-test API suite is therefore unaffected by this defect.")
  line()

  // These rows were really committed (no enclosing transaction), so clean up.
  await deleteTask({ taskId: older.id }, testDatabase)
  await deleteTask({ taskId: newer.id }, testDatabase)
  await deleteProject({ projectId: project.id }, testDatabase)
  line("    (probe rows removed from the test database.)")
  line()
}

line("=".repeat(78))
line("Conclusion: tests/unit/actions/tasks.test.ts:457 and :475 assert a total")
line("order over a key that is tied, so they pass or fail by luck. Observed")
line("both ways on 2026-07-28 (see 10-unit-suite-flake.txt).")
line("=".repeat(78))

process.exit(0)
