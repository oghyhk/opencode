export * as ConfigTeam from "./team"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class RoleConfig extends Schema.Class<RoleConfig>("ConfigV2.Team.Role")({
  provider: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  variant: Schema.String.pipe(Schema.optional),
  context_limit: PositiveInt.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  concurrency: PositiveInt.pipe(Schema.optional),
  workspace: Schema.Literals(["worktree", "shared"]).pipe(Schema.optional),
}) {}

export class TeamConfig extends Schema.Class<TeamConfig>("ConfigV2.Team.Config")({
  orchestrator: RoleConfig.pipe(Schema.optional),
  worker: RoleConfig.pipe(Schema.optional),
  verifier: RoleConfig.pipe(Schema.optional),
  context_limit: PositiveInt.pipe(Schema.optional),
}) {}

export class Team extends Schema.Class<Team>("ConfigV2.Team")({
  team_defaults: TeamConfig.pipe(Schema.optional),
  team: Schema.Record(Schema.String, TeamConfig).pipe(Schema.optional),
  default_team: Schema.String.pipe(Schema.optional),
}) {}
