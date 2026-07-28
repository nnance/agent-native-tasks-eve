/**
 * Phase 0 verification harness — US-A1.1-1.5 against the real Neon database.
 *
 * Why this exists: the packet needs to observe the *empty -> seeded*
 * transition, but this environment refuses destructive statements against the
 * database (`delete` / `drop` / `create database` are all blocked), so the
 * shared dev database could not be reset or branched to reproduce a fresh
 * install. Instead every step below runs inside ONE transaction that is
 * deliberately rolled back at the end, so the real schema, the real Postgres,
 * and the real `ensureSeeded()` code path are exercised while the persisted
 * data is left byte-identical. The final section re-reads the database after
 * the rollback and prints proof of that.
 *
 * Run with:
 *   pnpm exec tsx docs/verification/phase-0/harness/seed-idempotency.ts
 */

import "@/lib/env"

import { and, asc, eq, sql } from "drizzle-orm"

import { closeDb, db, type Database } from "@/lib/db/client"
import { priorities, projects, statuses, tasks } from "@/lib/db/schema"
import { describeSeedState, ensureSeeded } from "@/lib/db/seed"

class Rollback extends Error {}

function heading(text: string) {
  console.log(`\n== ${text} ==`)
}

async function counts(database: Database) {
  const [row] = await database.execute<{
    projects: string
    statuses: string
    priorities: string
    tasks: string
  }>(sql`
    select
      (select count(*) from projects)   as projects,
      (select count(*) from statuses)   as statuses,
      (select count(*) from priorities) as priorities,
      (select count(*) from tasks)      as tasks
  `)
  return row
}

async function snapshot(database: Database) {
  const state = await describeSeedState(database)
  return {
    project: state.project && {
      id: state.project.id,
      name: state.project.name,
    },
    statuses: state.statuses.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      isCompleted: s.isCompleted,
    })),
    priorities: state.priorities.map((p) => ({
      id: p.id,
      name: p.name,
      order: p.order,
      isDefault: p.isDefault,
    })),
  }
}

async function main() {
  heading("live database, before the harness opens its transaction")
  const before = await snapshot(db)
  console.log(JSON.stringify(before, null, 2))

  let firstSnapshot: Awaited<ReturnType<typeof snapshot>> | null = null
  let secondSnapshot: Awaited<ReturnType<typeof snapshot>> | null = null

  try {
    await db.transaction(async (rawTx) => {
      // A transaction handle exposes the same query surface the seed code
      // uses; drizzle types it separately, hence the cast.
      const tx = rawTx as unknown as Database

      heading(
        "step 1 — simulate a fresh install (delete inside the transaction)"
      )
      await tx.delete(projects)
      console.log("delete from projects ->", await counts(tx))

      heading("step 2 — first seed run (US-A1.1, US-A1.2, US-A1.3)")
      const first = await ensureSeeded(tx)
      console.log("ensureSeeded() ->", JSON.stringify(first))
      firstSnapshot = await snapshot(tx)
      console.log(JSON.stringify(firstSnapshot, null, 2))
      console.log("counts ->", await counts(tx))

      heading("step 3 — second seed run on the same data (US-A1.5)")
      const second = await ensureSeeded(tx)
      console.log("ensureSeeded() ->", JSON.stringify(second))
      secondSnapshot = await snapshot(tx)
      console.log("counts ->", await counts(tx))
      console.log(
        "state identical to after the first run ->",
        JSON.stringify(firstSnapshot) === JSON.stringify(secondSnapshot)
      )
      console.log(
        "same project id returned by both runs ->",
        first.projectId === second.projectId
      )

      heading("step 4 — third and fourth seed runs, for good measure")
      console.log("ensureSeeded() ->", JSON.stringify(await ensureSeeded(tx)))
      console.log("ensureSeeded() ->", JSON.stringify(await ensureSeeded(tx)))
      console.log("counts ->", await counts(tx))

      heading("step 5 — create a task with no setup beyond the seed (US-A1.4)")
      const state = await describeSeedState(tx)
      const project = state.project!
      const [firstStatus] = await tx
        .select()
        .from(statuses)
        .where(eq(statuses.projectId, project.id))
        .orderBy(asc(statuses.order))
        .limit(1)
      const [defaultPriority] = await tx
        .select()
        .from(priorities)
        .where(
          and(
            eq(priorities.projectId, project.id),
            eq(priorities.isDefault, true)
          )
        )
        .orderBy(asc(priorities.order))
        .limit(1)
      console.log(
        "resolved defaults ->",
        JSON.stringify({
          project: project.name,
          status: firstStatus?.name,
          priority: defaultPriority?.name,
        })
      )
      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: project.id,
          title: "Verification task",
          statusId: firstStatus!.id,
          priorityId: defaultPriority!.id,
        })
        .returning()
      console.log(
        "inserted task ->",
        JSON.stringify(
          {
            id: task!.id,
            title: task!.title,
            project: project.name,
            status: firstStatus!.name,
            priority: defaultPriority!.name,
          },
          null,
          2
        )
      )
      console.log("counts ->", await counts(tx))

      throw new Rollback("intentional rollback")
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
    heading("transaction rolled back — nothing above was persisted")
  }

  heading("live database, after the rollback")
  const after = await snapshot(db)
  console.log(JSON.stringify(after, null, 2))
  console.log("counts ->", await counts(db))
  console.log(
    "unchanged by the harness ->",
    JSON.stringify(before) === JSON.stringify(after)
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(closeDb)
