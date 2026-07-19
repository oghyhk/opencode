import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"

export const TeamRunTable = sqliteTable(
  "team_run",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    team_name: text("team_name").notNull(),
    status: text("status").notNull(), // 'running' | 'completed' | 'failed' | 'cancelled'
    ...Timestamps,
  },
  (table) => [index("team_run_session_idx").on(table.session_id)],
)

export const TeamTaskTable = sqliteTable(
  "team_task",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => TeamRunTable.id, { onDelete: "cascade" }),
    session_id: text("session_id").references(() => SessionTable.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    prompt: text("prompt").notNull(),
    role: text("role").notNull(), // 'worker' | 'verifier'
    status: text("status").notNull(), // 'planned' | 'ready' | 'leased' | 'running' | 'awaiting-verification' | 'rework' | 'accepted' | 'failed' | 'cancelled' | 'blocked'
    dependencies: text("dependencies").notNull(), // JSON array of team_task.id strings
    claimed_paths: text("claimed_paths"), // JSON array of file paths
    workspace: text("workspace"), // 'worktree' | 'shared'
    workspace_path: text("workspace_path"),
    provider: text("provider"),
    model: text("model"),
    context_limit: integer("context_limit"),
    lease_owner: text("lease_owner"),
    lease_expires_at: integer("lease_expires_at"),
    ...Timestamps,
  },
  (table) => [
    index("team_task_run_idx").on(table.run_id),
    index("team_task_session_idx").on(table.session_id),
  ],
)

export const TaskAttemptTable = sqliteTable(
  "task_attempt",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id")
      .notNull()
      .references(() => TeamTaskTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // 'running' | 'completed' | 'failed'
    output: text("output"),
    cost: real("cost").notNull().default(0),
    tokens_input: integer("tokens_input").notNull().default(0),
    tokens_output: integer("tokens_output").notNull().default(0),
    time_created: integer("time_created")
      .notNull()
      .$default(() => Date.now()),
    time_completed: integer("time_completed"),
  },
  (table) => [index("task_attempt_task_idx").on(table.task_id)],
)

export const TaskArtifactTable = sqliteTable(
  "task_artifact",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id")
      .notNull()
      .references(() => TeamTaskTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // e.g. 'file' | 'diff' | 'command'
    path: text("path").notNull(),
    content: text("content"),
    time_created: integer("time_created")
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("task_artifact_task_idx").on(table.task_id)],
)

export const VerificationTable = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id")
      .notNull()
      .references(() => TeamTaskTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // 'accepted' | 'rework-required' | 'rejected'
    evidence: text("evidence"),
    time_created: integer("time_created")
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("verification_task_idx").on(table.task_id)],
)
