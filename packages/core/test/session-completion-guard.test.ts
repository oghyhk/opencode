import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { TeamService } from "@opencode-ai/core/team"
import { CompletionPolicy } from "@opencode-ai/core/session/completion-policy"
import { SessionV2 } from "@opencode-ai/core/session"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable, TodoTable } from "@opencode-ai/core/session/sql"
import { TeamRunTable, TeamTaskTable } from "@opencode-ai/core/team/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([
  Database.node, 
  EventV2.node, 
  SessionTodo.node, 
  TeamService.node, 
  CompletionPolicy.node
])))

const sessionID = SessionV2.ID.make("ses_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "todo",
      directory: "/project",
      title: "todo",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

describe("CompletionPolicy", () => {
  it.effect("allows normal completion when no incomplete objectives remain", () => Effect.gen(function* () {
    yield* setup
    const policy = yield* CompletionPolicy.Service
    
    const result = yield* policy.evaluate(sessionID)
    expect(result.needsContinuation).toBeFalse()
  }))

  it.effect("schedules continuation when pending todos exist", () => Effect.gen(function* () {
    yield* setup
    const policy = yield* CompletionPolicy.Service
    const todos = yield* SessionTodo.Service

    yield* todos.update({
      sessionID,
      todos: [
        { content: "Finish Phase 1", status: "pending", priority: "high" }
      ]
    })
    
    const result = yield* policy.evaluate(sessionID)
    expect(result.needsContinuation).toBeTrue()
    expect(result.instruction).toContain("Finish Phase 1")
    expect(result.instruction).toContain("remain incomplete")
  }))

  it.effect("schedules continuation for incomplete team tasks (orchestrator)", () => Effect.gen(function* () {
    yield* setup
    const policy = yield* CompletionPolicy.Service
    const team = yield* TeamService.Service

    const run = yield* team.createRun({ sessionID, teamName: "test-team" })
    yield* team.createTask({
      runID: run.id,
      description: "Do the work",
      prompt: "Go",
      role: "worker",
      dependencies: []
    })

    const result = yield* policy.evaluate(sessionID)
    expect(result.needsContinuation).toBeTrue()
    expect(result.instruction).toContain("Do the work")
    expect(result.instruction).toContain("team tasks remain non-terminal")
  }))

  it.effect("schedules continuation for incomplete team task (worker)", () => Effect.gen(function* () {
    yield* setup
    const policy = yield* CompletionPolicy.Service
    const team = yield* TeamService.Service
    const { db } = yield* Database.Service

    const run = yield* team.createRun({ sessionID, teamName: "test-team" })
    const task = yield* team.createTask({
      runID: run.id,
      description: "Do the work",
      prompt: "Go",
      role: "worker",
      dependencies: []
    })

    // Assign session to task and set to running
    const workerSessionID = SessionV2.ID.make("ses_worker")
    yield* db
      .insert(SessionTable)
      .values({
        id: workerSessionID,
        project_id: Project.ID.global,
        slug: "worker",
        directory: "/project",
        title: "worker",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
      
    yield* db
      .update(TeamTaskTable)
      .set({ session_id: workerSessionID, status: "running" })
      .run()
      .pipe(Effect.orDie)

    const result = yield* policy.evaluate(workerSessionID)
    expect(result.needsContinuation).toBeTrue()
    expect(result.instruction).toContain("Your assigned task is not yet marked as complete")
  }))
})



