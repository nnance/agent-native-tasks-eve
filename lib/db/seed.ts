import "@/lib/env"

import { pathToFileURL } from "node:url"

import { asc, eq, sql } from "drizzle-orm"

import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  SEED_PROJECT_NAME,
} from "@/lib/domain/defaults"

import { closeDb, db, type Database } from "./client"
import { priorities, projects, statuses } from "./schema"

export type SeedResult = { seeded: boolean; projectId: string }

// Arbitrary but fixed: the CLI and the app-boot hook must agree on it.
const SEED_LOCK_KEY = 4924210

/**
 * Creates the starter project and its default lists, but only when the
 * workspace has never been initialized.
 *
 * Idempotency is keyed on the `projects` table being empty — never on a name
 * match or an upsert (implementation plan §2.2, US-A1.5). Once the user has
 * any project at all the workspace is initialized, so the starter data must
 * not reappear even if they renamed or deleted the Personal project.
 */
export async function ensureSeeded(
  database: Database = db
): Promise<SeedResult> {
  return database.transaction(async (tx) => {
    // The CLI and the app-boot hook can race on a fresh database, and
    // check-then-insert is not safe under READ COMMITTED on its own. The
    // lock releases with the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_KEY})`)

    const [existing] = await tx
      .select({ id: projects.id })
      .from(projects)
      .limit(1)

    if (existing) {
      return { seeded: false, projectId: existing.id }
    }

    const [project] = await tx
      .insert(projects)
      .values({ name: SEED_PROJECT_NAME })
      .returning({ id: projects.id })

    if (!project) {
      throw new Error("Seeding failed: the project insert returned no row.")
    }

    await tx.insert(statuses).values(
      DEFAULT_STATUSES.map((status, index) => ({
        projectId: project.id,
        name: status.name,
        order: index,
        isCompleted: status.isCompleted,
      }))
    )

    await tx.insert(priorities).values(
      DEFAULT_PRIORITIES.map((priority, index) => ({
        projectId: project.id,
        name: priority.name,
        order: index,
        isDefault: priority.isDefault,
      }))
    )

    return { seeded: true, projectId: project.id }
  })
}

/**
 * Re-reads the seeded project and its ordered lists. This is the phase's
 * data-verification evidence, so it lives here rather than in a separate psql
 * session — one command produces both the seeded/skipped line and the dump.
 */
export async function describeSeedState(database: Database = db) {
  const [project] = await database
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt))
    .limit(1)

  if (!project) {
    return { project: null, statuses: [], priorities: [] }
  }

  const [projectStatuses, projectPriorities] = await Promise.all([
    database
      .select()
      .from(statuses)
      .where(eq(statuses.projectId, project.id))
      .orderBy(asc(statuses.order)),
    database
      .select()
      .from(priorities)
      .where(eq(priorities.projectId, project.id))
      .orderBy(asc(priorities.order)),
  ])

  return { project, statuses: projectStatuses, priorities: projectPriorities }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  ensureSeeded()
    .then(async (result) => {
      console.log(
        result.seeded
          ? `Seeded: created the "${SEED_PROJECT_NAME}" project and its defaults.`
          : "Skipped: the projects table is not empty; nothing was created."
      )
      console.log(JSON.stringify(await describeSeedState(), null, 2))
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(closeDb)
}
