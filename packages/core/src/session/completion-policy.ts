export * as CompletionPolicy from "./completion-policy"

import { Context, Effect, Layer } from "effect"
import { SessionTodo } from "./todo"
import { TeamService } from "../team"
import { SessionSchema } from "./schema"
import { makeLocationNode } from "../effect/app-node"

export interface CompletionGuardResult {
  readonly needsContinuation: boolean
  readonly instruction?: string
}

export interface Interface {
  readonly evaluate: (sessionID: SessionSchema.ID) => Effect.Effect<CompletionGuardResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CompletionPolicy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const todos = yield* SessionTodo.Service
    const team = yield* TeamService.Service

    const evaluate = Effect.fn("CompletionPolicy.evaluate")(function* (sessionID: SessionSchema.ID) {
      // 1. Check Team Orchestrator Run
      const run = yield* team.getRunBySession(sessionID)
      if (run) {
        const tasks = yield* team.listTasks(run.id)
        const nonTerminal = tasks.filter(t => 
          ["planned", "ready", "leased", "running", "awaiting-verification", "rework"].includes(t.status)
        )
        if (nonTerminal.length > 0) {
          const descriptions = nonTerminal.map(t => `- [${t.status}] ${t.description}`).join("\n")
          return {
            needsContinuation: true,
            instruction: `The following team tasks remain non-terminal:\n${descriptions}\n\nPlease proceed with the next step or synthesize the final result if all work is complete. Do not finalize the run until all tasks are accepted, failed, or cancelled.`
          }
        }
      }

      // 2. Check Team Worker Task
      const task = yield* team.getTaskBySession(sessionID)
      if (task && ["running", "rework"].includes(task.status)) {
        return {
          needsContinuation: true,
          instruction: "Your assigned task is not yet marked as complete. You must satisfy the task completion contract and report structured evidence before finishing."
        }
      }

      // 3. Check Session Todos
      const todoList = yield* todos.get(sessionID)
      const incompleteTodos = todoList.filter(t => ["pending", "in_progress"].includes(t.status))
      if (incompleteTodos.length > 0) {
        const descriptions = incompleteTodos.map(t => `- [${t.status}] ${t.content}`).join("\n")
        return {
          needsContinuation: true,
          instruction: `The following objectives remain incomplete:\n${descriptions}\n\nPlease proceed with the next objective. Do not stop until all required objectives are completed.`
        }
      }

      return { needsContinuation: false }
    })

    return Service.of({ evaluate })
  })
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionTodo.node, TeamService.node],
})

