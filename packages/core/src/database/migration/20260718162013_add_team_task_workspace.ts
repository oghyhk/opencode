import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718162013_add_team_task_workspace",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`team_task\` ADD \`workspace\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
