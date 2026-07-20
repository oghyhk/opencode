import { Integration } from "@opencode-ai/core/integration"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { response } from "../location"
import path from "node:path"

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.oauth",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.oauth({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.attempt.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.attempt.status(ctx.params.attemptID))
        }),
      )
      .handle(
        "integration.attempt.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidRequestError({
                  message:
                    error._tag === "Integration.CodeRequired"
                      ? "Authorization code is required"
                      : "Authentication failed",
                  kind:
                    error._tag === "Integration.CodeRequired"
                      ? "integration_code_required"
                      : "integration_authorization",
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.attempt.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.migratePlugin",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          const fs = yield* FSUtil.Service
          const configDir = Global.Path.config
          const pluginAccountsPath = path.join(configDir, "..", "opencode", "antigravity-accounts.json")

          let migrated = 0
          let skipped = 0

          const exists = yield* fs.exists(pluginAccountsPath).pipe(Effect.orElseSucceed(() => false))
          if (exists) {
            const content = yield* fs.readFileString(pluginAccountsPath).pipe(Effect.orElseSucceed(() => ""))
            if (content) {
              try {
                const parsed = JSON.parse(content)
                if (parsed && Array.isArray(parsed.accounts)) {
                  for (const acc of parsed.accounts) {
                    if (acc && acc.refreshToken && acc.enabled !== false) {
                      const label = acc.email || `Antigravity (${acc.refreshToken.substring(0, 8)}...)`
                      const ok = yield* authorize(
                        service.connection.key({
                          integrationID: ctx.params.integrationID,
                          key: acc.refreshToken,
                          label,
                        }),
                      ).pipe(
                        Effect.as(true),
                        Effect.orElseSucceed(() => false),
                      )
                      if (ok) {
                        migrated++
                      } else {
                        skipped++
                      }
                    } else {
                      skipped++
                    }
                  }
                }
              } catch (e) {
                // Ignore parse failure
              }
            }
          }

          return yield* response(Effect.succeed({ migrated, skipped }))
        }),
      )
  }),
)
