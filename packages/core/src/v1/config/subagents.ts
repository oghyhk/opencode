export * as ConfigSubagentsV1 from "./subagents"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const Tier = Schema.Literals(["fast", "balanced", "deep"])
export type Tier = typeof Tier.Type

export const Profile = Schema.Struct({
  model: Schema.optional(Schema.String).annotate({
    description: "Model to use in the format provider/model for this subagent compute tier.",
  }),
  effort: Schema.optional(Schema.String).annotate({
    description: "Provider model variant to use as the reasoning effort for this tier.",
  }),
})

export const Info = Schema.Struct({
  default_tier: Schema.optional(Tier).annotate({
    description: "Compute tier used when a subagent task does not request one. Defaults to balanced.",
  }),
  tiers: Schema.optional(
    Schema.Struct({
      fast: Schema.optional(Profile),
      balanced: Schema.optional(Profile),
      deep: Schema.optional(Profile),
    }),
  ),
  limits: Schema.optional(
    Schema.Struct({
      max_concurrent: Schema.optional(PositiveInt).annotate({
        description: "Maximum concurrently running subagents. Defaults to 4.",
      }),
      max_total_per_parent_turn: Schema.optional(PositiveInt).annotate({
        description: "Maximum subagent runs admitted by one parent turn. Defaults to 12.",
      }),
    }),
  ),
}).annotate({ identifier: "SubagentConfig" })

export type Info = typeof Info.Type
