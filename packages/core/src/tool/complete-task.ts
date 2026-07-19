import { Effect, Layer, Schema } from "effect"
import { Tool } from "./tool"
import { TeamService } from "../team"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { makeLocationNode } from "../effect/app-node"
import { SessionTodo } from "../session/todo"

const Input = Schema.Struct({
  status: Schema.Literals(["awaiting-verification", "blocked", "accepted", "rework"]).annotate({ 
    description: "The new status of the task. For workers, use 'awaiting-verification' (done) or 'blocked'. For verifiers, use 'accepted' or 'rework'." 
  }),
  output: Schema.String.annotate({ 
    description: "A summary of the work completed, the reason for being blocked, or verifier feedback." 
  }),
}).annotate({ identifier: "CompleteTask.Input" })

const Output = Schema.Struct({
  taskID: Schema.String,
  status: Schema.String,
}).annotate({ identifier: "CompleteTask.Output" })

export const make = () =>
  Effect.gen(function* () {
    const team = yield* TeamService.Service

    return Tool.make({
      description: "Complete your assigned team task or mark it as blocked. This transitions the task out of the 'running' state, satisfying the completion contract so your session can finish.",
      input: Input,
      output: Output,
      execute: (input, context) =>
        Effect.gen(function* () {
          const task = yield* team.getTaskBySession(context.sessionID)
          
          if (!task) {
            return yield* new Tool.Failure({
              message: "No active task found for the current session.",
            })
          }

          if (task.status !== "running" && task.status !== "rework") {
            return yield* new Tool.Failure({
              message: `Task is already in terminal or non-running state: ${task.status}`,
            })
          }

          const newStatus = input.status === "rework" ? "planned" : input.status;

          yield* team.completeTask({
            taskID: task.id,
            ownerID: task.leaseOwner!,
            output: input.output,
            cost: 0,
            tokensInput: 0,
            tokensOutput: 0,
            artifacts: [], // Scheduler will attach git diff artifacts later
            statusOverride: newStatus as any,
          })

          return { taskID: task.id, status: input.status }
        }),
      toModelOutput: ({ output }) => [{
        type: "text",
        text: `Task marked as ${output.status}. You may now stop.`,
      }],
    })
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    yield* tools.register({ "complete-task": yield* make() }).pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/complete-task",
  layer,
  deps: [ToolRegistry.node, TeamService.node],
})
