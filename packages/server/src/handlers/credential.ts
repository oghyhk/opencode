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
    ),
)
