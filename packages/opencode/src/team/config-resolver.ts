import { Config } from "@/config/config"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Team } from "@opencode-ai/schema/team"
import { Effect, Schema } from "effect"

export class InvalidContextLimitError extends Schema.TaggedErrorClass<InvalidContextLimitError>()(
  "Team.InvalidContextLimit",
  {
    modelID: Schema.String,
    contextLimit: Schema.Int,
    minAllowed: Schema.Int,
    maxAllowed: Schema.Int,
    source: Schema.String,
  },
) {
  override get message() {
    return `Invalid context limit of ${this.contextLimit} for model ${this.modelID} resolved from ${this.source}. Limit must be between ${this.minAllowed} and ${this.maxAllowed}.`
  }
}

export type Role = "orchestrator" | "worker" | "verifier"

export const resolveRoleConfig = (options: {
  readonly teamName?: string
  readonly role: Role
  readonly taskOverride?: { readonly provider?: string; readonly model?: string; readonly contextLimit?: number }
}) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    const cfg = yield* config.get()

    // 1. Resolve precedence
    const teamDefaults = cfg.team_defaults
    const teams = cfg.team
    const globalDefaultModel = cfg.model

    const teamConfig = options.teamName && teams ? teams[options.teamName] : undefined

    // Determine the source path for descriptive errors
    let source = "existing provider/model defaults"

    // 1. Resolve Provider and Model ID
    let providerID: string | undefined = undefined
    let modelID: string | undefined = undefined

    if (options.taskOverride?.provider && options.taskOverride?.model) {
      providerID = options.taskOverride.provider
      modelID = options.taskOverride.model
      source = "task-specific override"
    } else if (teamConfig?.[options.role]?.provider && teamConfig?.[options.role]?.model) {
      providerID = teamConfig[options.role]!.provider
      modelID = teamConfig[options.role]!.model
      source = `team (${options.teamName}) role (${options.role}) override`
    } else if (teamDefaults?.[options.role]?.provider && teamDefaults?.[options.role]?.model) {
      providerID = teamDefaults[options.role]!.provider
      modelID = teamDefaults[options.role]!.model
      source = `global team_defaults role (${options.role}) override`
    } else if (globalDefaultModel) {
      const parsed = ModelV2.parse(globalDefaultModel)
      providerID = parsed.providerID
      modelID = parsed.modelID
      source = "global default model"
    }

    // 2. Resolve Model Catalog Entry
    let modelInfo: ModelV2.Info | undefined = undefined
    if (providerID && modelID) {
      modelInfo = yield* catalog.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))
    }

    if (!modelInfo) {
      // Fallback to default catalog model
      modelInfo = yield* catalog.model.default()
      if (modelInfo) {
        providerID = modelInfo.providerID
        modelID = modelInfo.id
      }
    }

    if (!modelInfo || !providerID || !modelID) {
      return yield* Effect.fail(new Error("Unable to resolve model or provider for team execution."))
    }

    // 3. Resolve Context Limit
    let contextLimit: number | undefined = undefined
    const minLimit = 64_000
    const maxLimit = modelInfo.limit.context

    if (options.taskOverride?.contextLimit !== undefined) {
      contextLimit = options.taskOverride.contextLimit
      source = "task-specific context override"
    } else if (teamConfig?.[options.role]?.context_limit !== undefined) {
      contextLimit = teamConfig[options.role]!.context_limit
      source = `team (${options.teamName}) role (${options.role}) context override`
    } else if (teamConfig?.context_limit !== undefined) {
      contextLimit = teamConfig.context_limit
      source = `team (${options.teamName}) shared context defaults`
    } else if (teamDefaults?.[options.role]?.context_limit !== undefined) {
      contextLimit = teamDefaults[options.role]!.context_limit
      source = `global team_defaults role (${options.role}) context override`
    } else if (teamDefaults?.context_limit !== undefined) {
      contextLimit = teamDefaults.context_limit
      source = "global team_defaults shared context defaults"
    } else {
      contextLimit = modelInfo.limit.context
    }

    // 4. Validate context limit
    const limit = contextLimit !== undefined ? contextLimit : maxLimit
    if (limit < minLimit || limit > maxLimit) {
      return yield* new InvalidContextLimitError({
        modelID: `${providerID}/${modelID}`,
        contextLimit: limit,
        minAllowed: minLimit,
        maxAllowed: maxLimit,
        source,
      })
    }

    return {
      providerID: ProviderV2.ID.make(providerID),
      modelID: ModelV2.ID.make(modelID),
      contextLimit: limit,
      agentName: teamConfig?.[options.role]?.agent || teamDefaults?.[options.role]?.agent,
      concurrency: options.role === "worker" ? (teamConfig?.worker?.concurrency || teamDefaults?.worker?.concurrency || 1) : undefined,
      workspace: options.role === "worker" ? (teamConfig?.worker?.workspace || teamDefaults?.worker?.workspace || "worktree" as const) : undefined,
    }
  })
