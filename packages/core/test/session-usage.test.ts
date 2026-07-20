import { describe, expect } from "bun:test"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { MessageTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const layer = AppNodeBuilder.build(LayerNode.group([Database.node, SessionV2.node]), [
  [SessionExecution.node, SessionExecution.noopLayer],
])
const it = testEffect(layer)
const sessionID = SessionV2.ID.make("ses_usage_test")
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

function assistant(input: {
  id: string
  seq: number
  created: number
  providerID: string
  modelID: string
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  cost?: number
}) {
  const id = SessionMessage.ID.make(input.id)
  const message = SessionMessage.Assistant.make({
    id,
    type: "assistant",
    agent: "build",
    model: {
      providerID: ProviderV2.ID.make(input.providerID),
      id: ModelV2.ID.make(input.modelID),
    },
    content: [],
    tokens: input.tokens,
    cost: input.cost,
    time: { created: DateTime.makeUnsafe(input.created) },
  })
  const { id: _, type, ...data } = encodeMessage(message)
  return { id, session_id: sessionID, type, seq: input.seq, time_created: input.created, data }
}

function legacyAssistant(input: {
  id: string
  created: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  cost: number
}) {
  const id = SessionV1.MessageID.make(input.id)
  const message = SessionV1.Assistant.make({
    id,
    sessionID,
    role: "assistant",
    parentID: SessionV1.MessageID.make("msg_parent"),
    providerID: ProviderV2.ID.make("anthropic"),
    modelID: ModelV2.ID.make("claude"),
    mode: "build",
    agent: "build",
    path: { cwd: "/project", root: "/project" },
    tokens: input.tokens,
    cost: input.cost,
    time: { created: input.created },
  })
  const { id: _, sessionID: __, ...data } = message
  return { id, session_id: sessionID, time_created: input.created, data }
}

describe("Session usage", () => {
  it.effect("aggregates persisted token usage by model and time", () =>
    Effect.gen(function* () {
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
          slug: "usage",
          directory: "/project",
          title: "usage",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistant({
            id: "msg_old",
            seq: 1,
            created: 100,
            providerID: "anthropic",
            modelID: "claude",
            tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 40, write: 5 } },
            cost: 0.25,
          }),
          assistant({
            id: "msg_new",
            seq: 2,
            created: 200,
            providerID: "openai",
            modelID: "gpt",
            tokens: { input: 100, output: 50, reasoning: 25, cache: { read: 10, write: 0 } },
            cost: 1.5,
          }),
          assistant({ id: "msg_pending", seq: 3, created: 300, providerID: "openai", modelID: "gpt" }),
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(MessageTable)
        .values([
          legacyAssistant({
            id: "msg_legacy",
            created: 50,
            tokens: { input: 2, output: 2, reasoning: 1, cache: { read: 3, write: 1 } },
            cost: 0.05,
          }),
          legacyAssistant({
            id: "msg_new",
            created: 200,
            tokens: { input: 999, output: 999, reasoning: 999, cache: { read: 999, write: 999 } },
            cost: 99,
          }),
        ])
        .run()
        .pipe(Effect.orDie)

      const sessions = yield* SessionV2.Service
      expect(yield* sessions.usage()).toEqual({
        models: [
          {
            providerID: "openai",
            modelID: "gpt",
            input: 100,
            output: 50,
            reasoning: 25,
            cache: { read: 10, write: 0 },
            cost: 1.5,
          },
          {
            providerID: "anthropic",
            modelID: "claude",
            input: 12,
            output: 22,
            reasoning: 4,
            cache: { read: 43, write: 6 },
            cost: 0.3,
          },
        ],
        input: 112,
        output: 72,
        reasoning: 29,
        cache: { read: 53, write: 6 },
        cost: 1.8,
      })
      expect(yield* sessions.usage({ since: 150 })).toEqual({
        models: [
          {
            providerID: "openai",
            modelID: "gpt",
            input: 100,
            output: 50,
            reasoning: 25,
            cache: { read: 10, write: 0 },
            cost: 1.5,
          },
        ],
        input: 100,
        output: 50,
        reasoning: 25,
        cache: { read: 10, write: 0 },
        cost: 1.5,
      })
    }),
  )
})
