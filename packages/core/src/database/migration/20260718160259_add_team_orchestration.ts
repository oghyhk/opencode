import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718160259_add_team_orchestration",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`task_artifact\` (
          \`id\` text PRIMARY KEY,
          \`task_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`path\` text NOT NULL,
          \`content\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_task_artifact_task_id_team_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`team_task\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_attempt\` (
          \`id\` text PRIMARY KEY,
          \`task_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`output\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_task_attempt_task_id_team_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`team_task\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`team_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`team_name\` text NOT NULL,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_team_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`team_task\` (
          \`id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`session_id\` text,
          \`description\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`role\` text NOT NULL,
          \`status\` text NOT NULL,
          \`dependencies\` text NOT NULL,
          \`workspace_path\` text,
          \`provider\` text,
          \`model\` text,
          \`context_limit\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_team_task_run_id_team_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`team_run\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_team_task_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`verification\` (
          \`id\` text PRIMARY KEY,
          \`task_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`evidence\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_verification_task_id_team_task_id_fk\` FOREIGN KEY (\`task_id\`) REFERENCES \`team_task\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`task_artifact_task_idx\` ON \`task_artifact\` (\`task_id\`);`)
      yield* tx.run(`CREATE INDEX \`task_attempt_task_idx\` ON \`task_attempt\` (\`task_id\`);`)
      yield* tx.run(`CREATE INDEX \`team_run_session_idx\` ON \`team_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`team_task_run_idx\` ON \`team_task\` (\`run_id\`);`)
      yield* tx.run(`CREATE INDEX \`team_task_session_idx\` ON \`team_task\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`verification_task_idx\` ON \`verification\` (\`task_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
