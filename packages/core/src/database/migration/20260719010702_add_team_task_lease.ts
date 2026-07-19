import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260719010702_add_team_task_lease",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`team_task\` ADD \`lease_owner\` text;`)
      yield* tx.run(`ALTER TABLE \`team_task\` ADD \`lease_expires_at\` integer;`)
    })
  },
} satisfies DatabaseMigration.Migration
