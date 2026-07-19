import { Effect, Layer, Schema } from "effect"
import { Tool } from "./tool"
import { TeamService } from "../team"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { makeLocationNode } from "../effect/app-node"

const Input = Schema.Struct({
  description: Schema.String.annotate({ description: "A brief, human-readable summary of the task" }),
  prompt: Schema.String.annotate({ description: "The detailed prompt/instructions for the worker" }),
  role: Schema.Literals(["worker", "verifier"]).annotate({ description: "The role of the agent handling the task. 'worker' performs the execution, 'verifier' reviews it." }),
  dependencies: Schema.Array(Schema.String).annotate({ description: "A list of task IDs that must complete before this task can start." }),
}).annotate({ identifier: "TeamTask.Input" })

const Output = Schema.Struct({
  taskID: Schema.String,
  status: Schema.String,
}).annotate({ identifier: "TeamTask.Output" })

export const make = () =>
  Effect.gen(function* () {
    const team = yield* TeamService.Service

    return Tool.make({
      description: "Create and dispatch a new task in the current team run. Use this tool to delegate work to 'worker' and 'verifier' roles. Returns the newly created task ID.",
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          const run = yield* team.getRunBySession(context.sessionID)
          if (!run) {
            return yield* new Tool.Failure({
              message: "Cannot create team tasks outside of an active team run.",
            })
          }

          const task = yield* team.createTask({
            runID: run.id,
            description: input.description,
            prompt: input.prompt,
            role: input.role,
            dependencies: input.dependencies as any,
          })

          return { taskID: task.id, status: task.status }
        }),
      toModelOutput: ({ output }) => [{
        type: "text",
        text: `Task created successfully.\nID: ${output.taskID}\nStatus: ${output.status}\n\nThe scheduler will automatically dispatch this task when its dependencies are met.`,
      }],
    })
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    yield* tools.register({ "team-task": yield* make() }).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/team-task",
  layer,
  deps: [ToolRegistry.node, TeamService.node],
})


