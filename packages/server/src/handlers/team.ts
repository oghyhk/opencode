import { Team } from "@opencode-ai/schema/team"
import { Session } from "@opencode-ai/schema/session"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { TeamGroup, TeamRunNotFoundError, TeamTaskNotFoundError } from "@opencode-ai/protocol/groups/team"
import { TeamService } from "@opencode-ai/core/team"

export const TeamHandler = HttpApiBuilder.group(Api, "server.team", (handlers) =>
  Effect.gen(function* () {
    const team = yield* TeamService.Service

    return handlers
      .handle(
        "team.listRuns",
        Effect.fn(function* () {
          const data = yield* team.listRuns()
          return { data }
        }),
      )
      .handle(
        "team.createRun",
        Effect.fn(function* (ctx) {
          const run = yield* team.createRun({
            sessionID: ctx.payload.sessionID,
            teamName: ctx.payload.teamName,
          })
          return { data: run }
        }),
      )
      .handle(
        "team.getRun",
        Effect.fn(function* (ctx) {
          const run = yield* team.getRun(ctx.params.runID)

          if (!run) {
            return yield* new TeamRunNotFoundError({
              runID: ctx.params.runID,
              message: `Team run not found: ${ctx.params.runID}`,
            })
          }

          return { data: run }
        }),
      )
      .handle(
        "team.listTasks",
        Effect.fn(function* (ctx) {
          const run = yield* team.getRun(ctx.params.runID)

          if (!run) {
            return yield* new TeamRunNotFoundError({
              runID: ctx.params.runID,
              message: `Team run not found: ${ctx.params.runID}`,
            })
          }

          const data = yield* team.listTasks(ctx.params.runID)
          return { data }
        }),
      )
      .handle(
        "team.getTask",
        Effect.fn(function* (ctx) {
          const run = yield* team.getRun(ctx.params.runID)

          if (!run) {
            return yield* new TeamRunNotFoundError({
              runID: ctx.params.runID,
              message: `Team run not found: ${ctx.params.runID}`,
            })
          }

          const task = yield* team.getTask(ctx.params.runID, ctx.params.taskID)

          if (!task) {
            return yield* new TeamTaskNotFoundError({
              taskID: ctx.params.taskID,
              message: `Team task not found: ${ctx.params.taskID}`,
            })
          }

          return { data: task }
        }),
      )
  }),
)
