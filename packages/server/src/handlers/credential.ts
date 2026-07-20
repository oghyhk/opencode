import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const CredentialHandler = HttpApiBuilder.group(Api, "server.credential", (handlers) =>
  handlers
    .handle(
      "credential.list",
      Effect.fn(function* (ctx) {
        const credentials = yield* Credential.Service
        const list = ctx.query.integrationID
          ? yield* credentials.list(ctx.query.integrationID)
          : yield* credentials.all()
        return yield* response(Effect.succeed(list))
      }),
    )
    .handle(
      "credential.update",
      Effect.fn(function* (ctx) {
        yield* (yield* Integration.Service).connection.update(ctx.params.credentialID, { label: ctx.payload.label })
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.remove",
      Effect.fn(function* (ctx) {
        yield* (yield* Integration.Service).connection.remove(ctx.params.credentialID)
        return HttpApiSchema.NoContent.make()
      }),
    )
    .handle(
      "credential.usage",
      Effect.fn(function* () {
        const all = yield* (yield* Credential.Service).all()
        const modelTotals: Record<string, { input: number; output: number; cache: number }> = {}
        let totalInput = 0
        let totalOutput = 0
        let totalCache = 0

        for (const cred of all) {
          const meta = (cred.value as any)?.metadata
          const history = meta?.usageHistory || []
          for (const h of history) {
            totalInput += h.inputTokens || 0
            totalOutput += h.outputTokens || 0
            totalCache += h.cacheReadTokens || 0
            const model = h.model || "unknown"
            if (!modelTotals[model]) modelTotals[model] = { input: 0, output: 0, cache: 0 }
            modelTotals[model].input += h.inputTokens || 0
            modelTotals[model].output += h.outputTokens || 0
            modelTotals[model].cache += h.cacheReadTokens || 0
          }
        }

        const sorted = Object.entries(modelTotals)
          .sort((a, b) => (b[1].input + b[1].output + b[1].cache) - (a[1].input + a[1].output + a[1].cache))
          .map(([model, { input, output, cache }]) => ({ model, input, output, cache }))

        return yield* response(Effect.succeed({ modelTotals: sorted, totalInput, totalOutput, totalCache }))
      }),
    ),
)
