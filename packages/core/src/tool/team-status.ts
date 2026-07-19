import { Effect, Layer, Schema } from "effect"
import { Tool } from "./tool"
import { TeamService } from "../team"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { makeLocationNode } from "../effect/app-node"

const Input = Schema.Struct({}).annotate({ identifier: "TeamStatus.Input" })

const Output = Schema.Struct({
  tasks: Schema.Array(Schema.Struct({
    id: Schema.String,
    description: Schema.String,
    role: Schema.String,
    status: Schema.String,
    dependencies: Schema.Array(Schema.String)
  }))
}).annotate({ identifier: "TeamStatus.Output" })

export const make = () =>
  Effect.gen(function* () {
    const team = yield* TeamService.Service

    return Tool.make({
      description: "Retrieve the current state of all tasks in the active team run. Use this tool to inspect task statuses, roles, and dependencies.",
      input: Input,
      output: Output,
      execute: (_, context) =>
        Effect.gen(function* () {
          const run = yield* team.getRunBySession(context.sessionID)
          if (!run) {
            return yield* new Tool.Failure({
              message: "Cannot inspect team tasks outside of an active team run.",
            })
          }

          const tasks = yield* team.listTasks(run.id)
          return {
            tasks: tasks.map((t: any) => ({
              id: t.id,
              description: t.description,
              role: t.role,
              status: t.status,
              dependencies: t.dependencies
            }))
          }
        }),
      toModelOutput: ({ output }) => {
        if (output.tasks.length === 0) {
          return [{ type: "text", text: "No tasks have been planned yet." }]
        }
        
        const text = output.tasks.map((t: any) => 
          `- ID: ${t.id}\n  Description: ${t.description}\n  Role: ${t.role}\n  Status: ${t.status}\n  Dependencies: ${t.dependencies.length > 0 ? t.dependencies.join(", ") : "none"}`
        ).join("\n\n")

        return [{ type: "text", text: `Current task graph status:\n\n${text}` }]
      },
    })
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    yield* tools.register({ "team-status": yield* make() }).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/team-status",
  layer,
  deps: [ToolRegistry.node, TeamService.node],
})

