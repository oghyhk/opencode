import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260718161854_add_team_claimed_paths",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`team_task\` ADD \`claimed_paths\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
