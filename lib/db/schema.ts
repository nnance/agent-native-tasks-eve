import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

// Ordering columns are named `sort_order` physically because `order` is a
// reserved SQL word — the TS field stays `order` so callers are unaffected.

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("sort_order").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
  },
  (t) => [index("statuses_project_id_idx").on(t.projectId)]
)

export const priorities = pgTable(
  "priorities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    order: integer("sort_order").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("priorities_project_id_idx").on(t.projectId)]
)

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // RESTRICT, not CASCADE: deleting a status or priority that tasks still
    // reference is a blocked operation in the product rules, so the database
    // refuses it as defense in depth behind the action layer.
    statusId: uuid("status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    priorityId: uuid("priority_id")
      .notNull()
      .references(() => priorities.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_status_id_idx").on(t.statusId),
    index("tasks_priority_id_idx").on(t.priorityId),
  ]
)

/** The only permitted primary key of `chat_state`. */
export const CHAT_STATE_ID = "singleton"

export const chatState = pgTable(
  "chat_state",
  {
    id: text("id").primaryKey().default(CHAT_STATE_ID),
    events: jsonb("events")
      .notNull()
      .default(sql`'[]'::jsonb`),
    session: jsonb("session"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("chat_state_singleton", sql`${t.id} = 'singleton'`)]
)

export const projectsRelations = relations(projects, ({ many }) => ({
  statuses: many(statuses),
  priorities: many(priorities),
  tasks: many(tasks),
}))

export const statusesRelations = relations(statuses, ({ one, many }) => ({
  project: one(projects, {
    fields: [statuses.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}))

export const prioritiesRelations = relations(priorities, ({ one, many }) => ({
  project: one(projects, {
    fields: [priorities.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  status: one(statuses, {
    fields: [tasks.statusId],
    references: [statuses.id],
  }),
  priority: one(priorities, {
    fields: [tasks.priorityId],
    references: [priorities.id],
  }),
}))

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Status = typeof statuses.$inferSelect
export type NewStatus = typeof statuses.$inferInsert
export type Priority = typeof priorities.$inferSelect
export type NewPriority = typeof priorities.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type ChatState = typeof chatState.$inferSelect
