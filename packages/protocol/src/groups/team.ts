import { Team } from "@opencode-ai/schema/team"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { SessionNotFoundError } from "../errors"

export class TeamRunNotFoundError extends Schema.TaggedErrorClass<TeamRunNotFoundError>()("TeamRunNotFound", {
  runID: Team.RunID,
  message: Schema.String,
}) {}

export class TeamTaskNotFoundError extends Schema.TaggedErrorClass<TeamTaskNotFoundError>()("TeamTaskNotFound", {
  taskID: Team.TaskID,
  message: Schema.String,
}) {}

export const TeamGroup = HttpApiGroup.make("server.team")
  .add(
    HttpApiEndpoint.get("team.listRuns", "/api/team/run", {
      success: Schema.Struct({ data: Schema.Array(Team.RunInfo) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.run.list",
        summary: "List team runs",
        description: "Retrieve all execution team runs.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("team.createRun", "/api/team/run", {
      payload: Schema.Struct({
        sessionID: Session.ID,
        teamName: Schema.String,
      }),
      success: Schema.Struct({ data: Team.RunInfo }),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.run.create",
        summary: "Create team run",
        description: "Create and schedule a new team run for a session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("team.getRun", "/api/team/run/:runID", {
      params: { runID: Team.RunID },
      success: Schema.Struct({ data: Team.RunInfo }),
      error: TeamRunNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.run.get",
        summary: "Get team run",
        description: "Retrieve a specific team run.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("team.listTasks", "/api/team/run/:runID/task", {
      params: { runID: Team.RunID },
      success: Schema.Struct({ data: Schema.Array(Team.TaskInfo) }),
      error: TeamRunNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.task.list",
        summary: "List tasks for run",
        description: "Retrieve all planned/executed tasks for a team run.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("team.getTask", "/api/team/run/:runID/task/:taskID", {
      params: { runID: Team.RunID, taskID: Team.TaskID },
      success: Schema.Struct({ data: Team.TaskInfo }),
      error: TeamTaskNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.task.get",
        summary: "Get team task",
        description: "Retrieve a specific team task within a run.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("team.cancelRun", "/api/team/run/:runID/cancel", {
      params: { runID: Team.RunID },
      success: Schema.Struct({ data: Schema.Struct({ success: Schema.Boolean }) }),
      error: TeamRunNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.team.run.cancel",
        summary: "Cancel team run",
        description: "Cancel an active team run and its running tasks.",
      }),
    ),
  )
