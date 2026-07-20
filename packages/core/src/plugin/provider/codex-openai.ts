import { Effect, Schema } from "effect"
import { define } from "../internal"
import type { PluginInternal } from "../internal"
import { Integration } from "../../integration"
import { Credential } from "../../credential"
import { ProviderV2 } from "../../provider"
import { ModelV2 } from "../../model"
import crypto from "node:crypto"

const CODEX_ISSUER = "https://auth.openai.com"
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const OPENAI_API_BASE = "https://api.openai.com"

const currentActiveCodexCredId: { value: string | undefined } = { value: undefined }

/** Parse a cockpit-format JSON to extract tokens */
function parseCockpitJson(raw: unknown): {
  accessToken: string
  refreshToken: string
  idToken: string
  email?: string
  accountId?: string
}[] {
  const results: {
    accessToken: string
    refreshToken: string
    idToken: string
    email?: string
    accountId?: string
  }[] = []

  const items = Array.isArray(raw) ? raw : [raw]
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const obj = item as Record<string, unknown>

    // Support cockpit format: {access_token, refresh_token, id_token, email, account_id}
    // Support codex auth.json: {tokens: {access_token, refresh_token, id_token, account_id}}
    // Support 9router format: {accessToken, refreshToken}
    const accessToken =
      str(obj.access_token) ||
      str(obj.accessToken) ||
      str((obj.tokens as Record<string, unknown>)?.access_token) ||
      str((obj.tokens as Record<string, unknown>)?.accessToken) ||
      str((obj.credentials as Record<string, unknown>)?.access_token)

    const refreshToken =
      str(obj.refresh_token) ||
      str(obj.refreshToken) ||
      str((obj.tokens as Record<string, unknown>)?.refresh_token) ||
      str((obj.tokens as Record<string, unknown>)?.refreshToken)

    const idToken =
      str(obj.id_token) ||
      str(obj.idToken) ||
      str((obj.tokens as Record<string, unknown>)?.id_token) ||
      str((obj.tokens as Record<string, unknown>)?.idToken) ||
      ""

    const email =
      str(obj.email) ||
      str((obj.user as Record<string, unknown>)?.email) ||
      str((obj.meta as Record<string, unknown>)?.label)

    const accountId =
      str(obj.account_id) ||
      str(obj.chatgpt_account_id) ||
      str((obj.tokens as Record<string, unknown>)?.account_id) ||
      str((obj.providerSpecificData as Record<string, unknown>)?.chatgptAccountId)

    if (!accessToken) continue

    results.push({ accessToken, refreshToken: refreshToken || "", idToken, email, accountId })
  }

  return results
}

function str(val: unknown): string {
  return typeof val === "string" && val.trim() ? val.trim() : ""
}

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".")
  if (parts.length < 2) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

function extractEmailFromToken(accessToken: string, idToken?: string): string | undefined {
  const idClaims = idToken ? parseJwtPayload(idToken) : undefined
  if (idClaims && typeof idClaims.email === "string") return idClaims.email
  const atClaims = parseJwtPayload(accessToken)
  if (atClaims && typeof atClaims.email === "string") return atClaims.email
  const profile = atClaims?.["https://api.openai.com/profile"] as Record<string, unknown> | undefined
  if (profile && typeof profile.email === "string") return profile.email
  return undefined
}

function extractAccountIdFromToken(accessToken: string, idToken?: string): string | undefined {
  const idClaims = idToken ? parseJwtPayload(idToken) : undefined
  const idAuth = idClaims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined
  if (idAuth && typeof idAuth.chatgpt_account_id === "string") return idAuth.chatgpt_account_id
  const atClaims = parseJwtPayload(accessToken)
  const atAuth = atClaims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined
  if (atAuth && typeof atAuth.chatgpt_account_id === "string") return atAuth.chatgpt_account_id
  if (typeof atClaims?.chatgpt_account_id === "string") return atClaims.chatgpt_account_id
  return undefined
}

function extractPlanFromToken(accessToken: string, idToken?: string): string | undefined {
  const claims = idToken ? parseJwtPayload(idToken) : parseJwtPayload(accessToken)
  const auth = claims?.["https://api.openai.com/auth"] as Record<string, unknown> | undefined
  if (auth && typeof auth.chatgpt_plan_type === "string") return auth.chatgpt_plan_type
  return undefined
}

export const CodexOpenAIPlugin = define({
  id: "codex-openai",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service

    yield* ctx.integration.transform((draft: any) => {
      draft.update("codex-openai", (integration: any) => {
        integration.name = "Codex (OpenAI)"
      })
      // Key-based method: user pastes JSON or a refresh token
      draft.method.update({
        integrationID: Integration.ID.make("codex-openai"),
        method: {
          id: Integration.MethodID.make("codex-json-import"),
          type: "key" as const,
          label: "Import Codex Account (JSON / Token)",
        },
      })
    })

    yield* ctx.catalog.transform((catalog: any) => {
      const providerID = ProviderV2.ID.make("codex-openai")
      catalog.provider.update(providerID, (provider: any) => {
        provider.name = "Codex (OpenAI)"
        provider.integrationID = Integration.ID.make("codex-openai")
        provider.api = { type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
      })

      // GPT-4.1
      catalog.model.update(providerID, ModelV2.ID.make("codex-gpt-4.1"), (model: any) => {
        model.name = "GPT-4.1 (Codex)"
        model.api = { id: "gpt-4.1", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
        model.limit = { context: 1047576, output: 32768 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "medium"
      })

      // GPT-4.1-mini
      catalog.model.update(providerID, ModelV2.ID.make("codex-gpt-4.1-mini"), (model: any) => {
        model.name = "GPT-4.1 Mini (Codex)"
        model.api = { id: "gpt-4.1-mini", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
        model.limit = { context: 1047576, output: 32768 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "medium"
      })

      // GPT-4.1-nano
      catalog.model.update(providerID, ModelV2.ID.make("codex-gpt-4.1-nano"), (model: any) => {
        model.name = "GPT-4.1 Nano (Codex)"
        model.api = { id: "gpt-4.1-nano", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
        model.limit = { context: 1047576, output: 32768 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "low"
      })

      // o3
      catalog.model.update(providerID, ModelV2.ID.make("codex-o3"), (model: any) => {
        model.name = "o3 (Codex)"
        model.api = { id: "o3", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
        model.limit = { context: 200000, output: 100000 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "medium"
      })

      // o4-mini
      catalog.model.update(providerID, ModelV2.ID.make("codex-o4-mini"), (model: any) => {
        model.name = "o4-mini (Codex)"
        model.api = { id: "o4-mini", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text", "image"], output: ["text"] }
        model.limit = { context: 200000, output: 100000 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "medium"
      })

      // codex-mini (the official Codex small model)
      catalog.model.update(providerID, ModelV2.ID.make("codex-codex-mini"), (model: any) => {
        model.name = "Codex Mini (Codex)"
        model.api = { id: "codex-mini-latest", type: "aisdk", package: "@ai-sdk/openai", url: OPENAI_API_BASE }
        model.capabilities = { tools: true, input: ["text"], output: ["text"] }
        model.limit = { context: 192000, output: 16384 }
        model.variants = [
          { id: "low", headers: {}, body: { reasoning: { effort: "low" } } },
          { id: "medium", headers: {}, body: { reasoning: { effort: "medium" } } },
          { id: "high", headers: {}, body: { reasoning: { effort: "high" } } },
        ]
        model.request.variant = "medium"
      })
    })

    // Custom fetch wrapper: pool rotation + token injection
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/openai") return
        // Only handle codex-openai provider models
        const modelId = evt.model?.id ?? ""
        if (!modelId.startsWith("codex-")) return

        const context = yield* Effect.context()
        const runEffect = <A, E>(eff: Effect.Effect<A, E, any>) =>
          Effect.runPromise(eff.pipe(Effect.provide(context)) as any)

        const mod = yield* Effect.promise(() => import("@ai-sdk/openai"))

        const customFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const targetUrl = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString()
          const isOpenAI = targetUrl.includes("api.openai.com")
          if (!isOpenAI) return fetch(url, init)

          // List all codex-openai credentials
          const creds = (await runEffect(credentials.list(Integration.ID.make("codex-openai")))) as any[]
          if (creds.length === 0) return fetch(url, init)

          const resolvedCreds: any[] = []
          for (const c of creds) {
            const val = (await runEffect(
              integrations.connection.resolve({ id: c.id, type: "credential" } as any),
            )) as any
            if (val) {
              resolvedCreds.push({
                id: c.id,
                label: c.label,
                value: { ...val, metadata: { ...(val.metadata || {}) } },
              })
            }
          }

          if (resolvedCreds.length === 0) return fetch(url, init)

          const now = Date.now()

          // Filter out disabled, rate-limited, and expired credentials
          const available: any[] = []
          for (const cred of resolvedCreds) {
            const meta = cred.value.metadata as any
            if (meta.disabled === true) continue
            if (meta.rateLimitedUntil && now < meta.rateLimitedUntil) continue
            if (meta.coolingDownUntil && now < meta.coolingDownUntil) continue

            // Check if access token needs refresh
            let token = ""
            if ((cred.value as any).type === "key") {
              // Stored as key: the key field is the refresh token
              const refreshToken = (cred.value as any).key
              if (meta.accessToken && meta.expiresAt && now + 5 * 60 * 1000 < meta.expiresAt) {
                token = meta.accessToken
              } else if (refreshToken) {
                // Refresh the token
                try {
                  const res = await fetch(`${CODEX_ISSUER}/oauth/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                      grant_type: "refresh_token",
                      refresh_token: refreshToken,
                      client_id: CODEX_CLIENT_ID,
                    }),
                  })
                  if (res.ok) {
                    const tokenInfo = (await res.json()) as any
                    token = tokenInfo.access_token
                    const expiresAt = now + (tokenInfo.expires_in || 3600) * 1000

                    // Extract email and account ID from tokens
                    const email = meta.email || extractEmailFromToken(token, tokenInfo.id_token)
                    const accountId = meta.accountId || extractAccountIdFromToken(token, tokenInfo.id_token)
                    const plan = meta.plan || extractPlanFromToken(token, tokenInfo.id_token)

                    Object.assign(meta, {
                      accessToken: token,
                      expiresAt,
                      email,
                      accountId,
                      plan,
                      lastRefresh: now,
                    })
                    const updatedValue = { ...(cred.value as any), metadata: { ...meta } }
                    await runEffect(credentials.update(cred.id, { value: updatedValue as any }))
                    cred.value = updatedValue
                  } else {
                    const errorText = await res.text().catch(() => "")
                    console.error(`Codex token refresh failed (${res.status}): ${errorText}`)
                    // Mark as rate limited for 60 seconds
                    Object.assign(meta, { rateLimitedUntil: now + 60_000 })
                    const updatedValue = { ...(cred.value as any), metadata: { ...meta } }
                    await runEffect(credentials.update(cred.id, { value: updatedValue as any }))
                    continue
                  }
                } catch (e) {
                  console.error("Failed to refresh Codex token:", e)
                  continue
                }
              }
            } else {
              token = (cred.value as any).access || ""
            }

            if (!token) continue
            available.push({ ...cred, resolvedToken: token })
          }

          // Select credential: sticky first, then round-robin
          let selected = available.find((c) => c.id === currentActiveCodexCredId.value)
          if (!selected && available.length > 0) {
            // Pick the one with the most remaining balance, or round-robin
            selected = available[Math.floor(Math.random() * available.length)]
          }
          if (!selected && resolvedCreds.length > 0) {
            // Fallback to first resolved even if filtered out
            const meta = resolvedCreds[0].value.metadata as any
            const token = meta.accessToken || (resolvedCreds[0].value as any).access || ""
            selected = { ...resolvedCreds[0], resolvedToken: token }
          }

          if (!selected) return fetch(url, init)

          // Update sticky
          currentActiveCodexCredId.value = selected.id

          // Mark active
          for (const c of resolvedCreds) {
            const meta = c.value.metadata as any
            const isActive = c.id === selected.id
            if (isActive && !meta.activeForCodex) {
              Object.assign(meta, { activeForCodex: true })
              const updatedValue = { ...(c.value as any), metadata: { ...meta } }
              await runEffect(credentials.update(c.id, { value: updatedValue as any }))
            } else if (!isActive && meta.activeForCodex) {
              delete meta.activeForCodex
              const updatedValue = { ...(c.value as any), metadata: { ...meta } }
              await runEffect(credentials.update(c.id, { value: updatedValue as any }))
            }
          }

          // Inject token and account headers
          const initHeaders = new Headers(init?.headers)
          if (selected.resolvedToken) {
            initHeaders.set("Authorization", `Bearer ${selected.resolvedToken}`)
          }
          const accountId = (selected.value.metadata as any)?.accountId
          if (accountId) {
            initHeaders.set("Openai-Organization", accountId)
          }

          // Update lastUsed
          const selectedMeta = selected.value.metadata as any
          Object.assign(selectedMeta, { lastUsed: now })
          const updatedValue = { ...(selected.value as any), metadata: { ...selectedMeta } }
          await runEffect(credentials.update(selected.id, { value: updatedValue as any }))

          const newInit = { ...init, headers: initHeaders }
          const response = await fetch(url, newInit)

          // Handle 429 rate limiting
          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after")
            const cooldownMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000
            Object.assign(selectedMeta, { rateLimitedUntil: now + cooldownMs })
            const rateLimitedValue = { ...(selected.value as any), metadata: { ...selectedMeta } }
            await runEffect(credentials.update(selected.id, { value: rateLimitedValue as any }))

            // Try next available credential
            const others = available.filter((c) => c.id !== selected!.id)
            if (others.length > 0) {
              const next = others[0]
              currentActiveCodexCredId.value = next.id
              const retryHeaders = new Headers(init?.headers)
              retryHeaders.set("Authorization", `Bearer ${next.resolvedToken}`)
              const nextAccountId = (next.value.metadata as any)?.accountId
              if (nextAccountId) retryHeaders.set("Openai-Organization", nextAccountId)
              return fetch(url, { ...init, headers: retryHeaders })
            }
          }

          return response
        }

        evt.sdk = mod.createOpenAI({
          ...evt.options,
          fetch: customFetch as any,
        })
      }),
    )

    yield* ctx.aisdk.language(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("codex-openai")) return
        evt.language = evt.sdk.responses(evt.model.api.id)
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements>)
