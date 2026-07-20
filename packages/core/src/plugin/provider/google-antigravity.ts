import { Effect, Schema, Scope } from "effect"
import { define } from "../internal"
import type { PluginInternal } from "../internal"
import { Integration } from "../../integration"
import { Credential } from "../../credential"
import { ProviderV2 } from "../../provider"
import { ModelV2 } from "../../model"
import { startOAuthListener } from "../../oauth/callback"
import crypto from "node:crypto"

const decode = (s: string) => s.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 1)).join("")
const clientID = decode("21821171716:2.unittjo3i32mdsf346wupmpki5h514fq/bqqt/hpphmfvtfsdpoufou/dpn")
const clientSecret = decode("HPDTQY.L69GXS597MeMK2nMC9tYD5{7rEBg")
const scopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
]
const redirectURI = "http://localhost:51121/oauth-callback"

const currentActiveCredIdByFamily: Record<string, string | undefined> = {
  claude: undefined,
  gemini: undefined,
}

const signatureCache = new Map<string, string>()
const hashText = (text: string) => crypto.createHash("sha256").update(text).digest("hex")

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String.pipe(Schema.optional),
  expires_in: Schema.Number,
})

const UserInfo = Schema.Struct({
  email: Schema.String.pipe(Schema.optional),
})

function oauth() {
  const methodID = Integration.MethodID.make("device")
  return {
    integrationID: Integration.ID.make("google-antigravity"),
    method: {
      id: methodID,
      type: "oauth" as const,
      label: "Google Antigravity Account",
    },
    authorize: (inputs: any) =>
      Effect.gen(function* () {
        // Native PKCE challenge generation
        const verifier = crypto.randomBytes(32).toString("base64url")
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
        const state = crypto.randomBytes(16).toString("hex")

        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
        url.searchParams.set("client_id", clientID)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("redirect_uri", redirectURI)
        url.searchParams.set("scope", scopes.join(" "))
        url.searchParams.set("code_challenge", challenge)
        url.searchParams.set("code_challenge_method", "S256")
        url.searchParams.set("state", state)
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("prompt", "consent")

        const listener = (yield* Effect.promise(() => startOAuthListener({ port: 51121, path: "/oauth-callback", state, timeoutMs: 5 * 60 * 1000 }))) as any

          return {
            mode: "auto" as const,
            url: url.toString(),
            instructions: "Sign in using Google Antigravity in the browser window",
            callback: Effect.gen(function* () {
              const callbackResult = (yield* Effect.promise(() => listener.waitForCallback())) as any
              const code = callbackResult.code
              const res = yield* Effect.promise(() =>
                fetch("https://oauth2.googleapis.com/token", {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    client_id: clientID,
                    client_secret: clientSecret,
                    code,
                    grant_type: "authorization_code",
                    redirect_uri: redirectURI,
                    code_verifier: verifier,
                  }),
                }),
              )

              if (!res.ok) {
                return yield* Effect.fail(new Error(`OAuth token exchange failed: ${res.statusText}`))
              }

              const token = yield* Schema.decodeUnknownEffect(Token)(yield* Effect.promise(() => res.json()))

              // Fetch email
              const userRes = yield* Effect.promise(() =>
                fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
                  headers: { Authorization: `Bearer ${token.access_token}` },
                }),
              )
              const userInfo = userRes.ok
                ? yield* Schema.decodeUnknownEffect(UserInfo)(yield* Effect.promise(() => userRes.json()))
                : { email: undefined }

              // Fetch project ID
              let projectId: string | undefined = undefined
              try {
                const projectRes = yield* Effect.promise(() =>
                  fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token.access_token}`,
                      "User-Agent": "google-api-nodejs-client/9.15.1",
                      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                    },
                    body: JSON.stringify({
                      metadata: {
                        ideType: "ANTIGRAVITY",
                        platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
                        pluginType: "GEMINI",
                      },
                    }),
                  }),
                )
                if (projectRes.ok) {
                  const payload = (yield* Effect.promise(() => projectRes.json())) as any
                  if (typeof payload?.cloudaicompanionProject === "string") {
                    projectId = payload.cloudaicompanionProject
                  } else if (typeof payload?.cloudaicompanionProject?.id === "string") {
                    projectId = payload.cloudaicompanionProject.id
                  }
                }

                // If still missing, auto-provision via onboarding
                if (!projectId) {
                  const onboardRes = yield* Effect.promise(() =>
                    fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token.access_token}`,
                        "User-Agent": "antigravity/windows/amd64",
                      },
                      body: JSON.stringify({
                        tierId: "FREE",
                        metadata: {
                          ideType: "ANTIGRAVITY",
                          platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
                          pluginType: "GEMINI",
                        }
                      })
                    })
                  )
                  if (onboardRes.ok) {
                    const onboardData = (yield* Effect.promise(() => onboardRes.json())) as any
                    projectId = onboardData.response?.cloudaicompanionProject?.id
                  }
                }
              } catch (err) {
                console.error("Failed to load managed project from Antigravity", err)
              }

              return Credential.OAuth.make({
                type: "oauth" as const,
                methodID,
                access: token.access_token,
                refresh: token.refresh_token ?? "", // Should not be empty on initial grant
                expires: Date.now() + token.expires_in * 1000,
                metadata: {
                  email: userInfo.email,
                  projectId,
                },
              })
            }).pipe(Effect.ensuring(Effect.promise(() => listener.close()))),
          }
      }),
    refresh: (credential: Credential.OAuth) =>
      Effect.gen(function* () {
        const res = yield* Effect.promise(() =>
          fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: credential.refresh,
              client_id: clientID,
              client_secret: clientSecret,
            }),
          }),
        )

        if (!res.ok) {
          return yield* Effect.fail(new Error(`Token refresh failed: ${res.statusText}`))
        }

        const token = yield* Schema.decodeUnknownEffect(Token)(yield* Effect.promise(() => res.json()))
        return {
          ...credential,
          access: token.access_token,
          refresh: token.refresh_token ?? credential.refresh,
          expires: Date.now() + token.expires_in * 1000,
        }
      }),
  }
}

export const GoogleAntigravityPlugin = define({
  id: "google-antigravity",
  effect: Effect.fn(function* (ctx) {
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service

    yield* ctx.integration.transform((draft: any) => {
      draft.update("google-antigravity", (integration: any) => {
        integration.name = "Google Antigravity"
      })
      draft.method.update(oauth())
      draft.method.update({
        integrationID: Integration.ID.make("google-antigravity"),
        method: {
          id: Integration.MethodID.make("refresh-token"),
          type: "key" as const,
          label: "Manual Refresh Token",
        }
      })
    })

    yield* ctx.catalog.transform((catalog: any) => {
      const providerID = ProviderV2.ID.make("google-antigravity")
      catalog.provider.update(providerID, (provider: any) => {
        provider.name = "Google Antigravity"
        provider.integrationID = Integration.ID.make("google-antigravity")
        provider.api = { type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
      })

      // Natively register the models in the catalog
      // 1. antigravity-gemini-3.5-flash
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3.5-flash"), (model: any) => {
        model.name = "Gemini 3.5 Flash (Antigravity)"
        model.api = { id: "gemini-3.5-flash", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65536 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } } },
          { id: "medium", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } } },
          { id: "high", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } }
        ]
        model.request.variant = "medium"
      })

      // 2. antigravity-gemini-3.1-flash
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3.1-flash"), (model: any) => {
        model.name = "Gemini 3.1 Flash (Antigravity)"
        model.api = { id: "gemini-3.1-flash", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65536 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } } },
          { id: "medium", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } } },
          { id: "high", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } }
        ]
        model.request.variant = "medium"
      })

      // 3. antigravity-gemini-3-flash
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3-flash"), (model: any) => {
        model.name = "Gemini 3 Flash (Antigravity)"
        model.api = { id: "gemini-3-flash", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65536 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } } },
          { id: "medium", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "medium" } } },
          { id: "high", headers: {}, body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } }
        ]
        model.request.variant = "medium"
      })

      // 4. antigravity-gemini-3.5-pro
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3.5-pro"), (model: any) => {
        model.name = "Gemini 3.5 Pro (Antigravity)"
        model.api = { id: "gemini-3.5-pro", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65535 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingLevel: "low" } },
          { id: "high", headers: {}, body: { thinkingLevel: "high" } }
        ]
        model.request.variant = "low"
      })

      // 5. antigravity-gemini-3.1-pro
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3.1-pro"), (model: any) => {
        model.name = "Gemini 3.1 Pro (Antigravity)"
        model.api = { id: "gemini-3.1-pro", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65535 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingLevel: "low" } },
          { id: "high", headers: {}, body: { thinkingLevel: "high" } }
        ]
        model.request.variant = "low"
      })

      // 6. antigravity-gemini-3-pro
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3-pro"), (model: any) => {
        model.name = "Gemini 3 Pro (Antigravity)"
        model.api = { id: "gemini-3-pro", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65535 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingLevel: "low" } },
          { id: "high", headers: {}, body: { thinkingLevel: "high" } }
        ]
        model.request.variant = "low"
      })

      // 7. antigravity-claude-opus-4-6-thinking
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-claude-opus-4-6-thinking"), (model: any) => {
        model.name = "Claude Opus 4.6 Thinking (Antigravity)"
        model.api = { id: "claude-opus-4-6-thinking", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 200000, output: 64000 }
        model.variants = [
          { id: "low", headers: {}, body: { thinkingConfig: { thinkingBudget: 8192 } } },
          { id: "max", headers: {}, body: { thinkingConfig: { thinkingBudget: 32768 } } }
        ]
        model.request.variant = "max"
      })

      // 8. antigravity-claude-sonnet-4-6
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-claude-sonnet-4-6"), (model: any) => {
        model.name = "Claude Sonnet 4.6 (Antigravity)"
        model.api = { id: "claude-sonnet-4-6", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 200000, output: 64000 }
        model.variants = []
      })
    })

    // Custom fetch wrapper mapping to Antigravity endpoints
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/google") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google"))

        const context = yield* Effect.context()
        const runEffect = <A, E>(eff: Effect.Effect<A, E, any>) =>
          Effect.runPromise(eff.pipe(Effect.provide(context)) as any)

        const classifyQuotaGroup = (modelName: string, displayName?: string): string | null => {
          const combined = `${modelName} ${displayName ?? ""}`.toLowerCase()
          if (combined.includes("claude")) {
            return "claude"
          }
          const isGemini3 = combined.includes("gemini-3") || combined.includes("gemini 3")
          if (!isGemini3) {
            return null
          }
          const isFlash = combined.includes("flash")
          return isFlash ? "gemini-flash" : "gemini-pro"
        }

        const getQuotaGroupForModel = (modelName: string): string => {
          const lower = modelName.toLowerCase()
          if (lower.includes("claude")) return "claude"
          if (lower.includes("flash")) return "gemini-flash"
          return "gemini-pro"
        }

        const fetchQuotaForCredential = async (accessToken: string, projectId: string): Promise<any> => {
          try {
            const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "User-Agent": "antigravity/windows/amd64",
              },
              body: JSON.stringify({ project: projectId }),
            })
            if (!res.ok) return null
            const payload = (await res.json()) as any
            if (!payload || !payload.models) return null

            const groups: Record<string, { remainingFraction: number; resetTime?: string }> = {}
            for (const [modelName, entry] of Object.entries(payload.models)) {
              const anyEntry = entry as any
              const group = classifyQuotaGroup(modelName, anyEntry.displayName || anyEntry.modelName)
              if (!group) continue

              const quotaInfo = anyEntry.quotaInfo
              if (!quotaInfo) continue

              const rawFraction = quotaInfo.remainingFraction
              const remainingFraction = typeof rawFraction === "number" && Number.isFinite(rawFraction)
                ? Math.max(0, Math.min(1, rawFraction))
                : 0

              const existing = groups[group]
              const nextRemaining = existing === undefined ? remainingFraction : Math.min(existing.remainingFraction, remainingFraction)

              groups[group] = {
                remainingFraction: nextRemaining,
                resetTime: quotaInfo.resetTime,
              }
            }
            return groups
          } catch (err) {
            console.error("Failed to fetch available models quota:", err)
            return null
          }
        }

        const getThinkingLevel = (parsed: any): string | undefined => {
          if (typeof parsed.thinkingLevel === "string") return parsed.thinkingLevel
          if (parsed.thinkingConfig && typeof parsed.thinkingConfig.thinkingLevel === "string") return parsed.thinkingConfig.thinkingLevel
          if (parsed.generationConfig?.thinkingConfig && typeof parsed.generationConfig.thinkingConfig.thinkingLevel === "string") {
            return parsed.generationConfig.thinkingConfig.thinkingLevel
          }
          if (parsed.providerOptions?.google && typeof parsed.providerOptions.google.thinkingLevel === "string") {
            return parsed.providerOptions.google.thinkingLevel
          }
          if (evt.options && typeof evt.options.thinkingLevel === "string") {
            return evt.options.thinkingLevel
          }
          if (evt.options?.thinkingConfig && typeof evt.options.thinkingConfig.thinkingLevel === "string") {
            return evt.options.thinkingConfig.thinkingLevel
          }
          return undefined
        }

        const getThinkingBudget = (parsed: any): number => {
          if (parsed.thinkingConfig && typeof parsed.thinkingConfig.thinkingBudget === "number") {
            return parsed.thinkingConfig.thinkingBudget
          }
          if (parsed.generationConfig?.thinkingConfig && typeof parsed.generationConfig.thinkingConfig.thinkingBudget === "number") {
            return parsed.generationConfig.thinkingConfig.thinkingBudget
          }
          if (parsed.providerOptions?.google?.thinkingConfig && typeof parsed.providerOptions.google.thinkingConfig.thinkingBudget === "number") {
            return parsed.providerOptions.google.thinkingConfig.thinkingBudget
          }
          if (evt.options && typeof evt.options.thinkingBudget === "number") {
            return evt.options.thinkingBudget
          }
          if (evt.options?.thinkingConfig && typeof evt.options.thinkingConfig.thinkingBudget === "number") {
            return evt.options.thinkingConfig.thinkingBudget
          }
          return 32768
        }

        const resolveBackendModel = (lowerModel: string, parsed: any): string => {
          if (lowerModel.includes("gemini-3.5-flash")) {
            return "gemini-3.5-flash-low"
          }
          if (lowerModel.includes("gemini-3.1-flash")) {
            return "gemini-3.1-flash"
          }
          if (lowerModel.includes("gemini-3-flash")) {
            return "gemini-3-flash"
          }
          if (lowerModel.includes("gemini-3.5-pro")) {
            const level = getThinkingLevel(parsed) === "high" ? "high" : "low"
            return `gemini-3.5-pro-${level}`
          }
          if (lowerModel.includes("gemini-3.1-pro")) {
            const level = getThinkingLevel(parsed) === "high" ? "high" : "low"
            return `gemini-3.1-pro-${level}`
          }
          if (lowerModel.includes("gemini-3-pro")) {
            const level = getThinkingLevel(parsed) === "high" ? "high" : "low"
            return `gemini-3-pro-${level}`
          }
          if (lowerModel.includes("claude-opus-4-6-thinking")) {
            return "claude-opus-4-6-thinking"
          }
          if (lowerModel.includes("claude-sonnet-4-6")) {
            return "claude-sonnet-4-6"
          }
          return lowerModel
        }

        const customFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const targetUrl = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString()
          const isGoogleEndpoint = targetUrl.includes("generativelanguage.googleapis.com") || targetUrl.includes("cloudcode-pa.googleapis.com")
          if (!isGoogleEndpoint) {
            return fetch(url, init)
          }

          const match = targetUrl.match(/\/models\/([^:/?]+)/)
          const extractedModel = match ? match[1] : ""
          const lowerModel = extractedModel.toLowerCase()

          const antigravityModels = [
            "gemini-3.5-flash",
            "gemini-3.1-flash",
            "gemini-3-flash",
            "gemini-3.5-pro",
            "gemini-3.1-pro",
            "gemini-3-pro",
            "claude-opus-4-6-thinking",
            "claude-sonnet-4-6",
            "antigravity-gemini-3.5-flash",
            "antigravity-gemini-3.1-flash",
            "antigravity-gemini-3-flash",
            "antigravity-gemini-3.5-pro",
            "antigravity-gemini-3.1-pro",
            "antigravity-gemini-3-pro",
            "antigravity-claude-opus-4-6-thinking",
            "antigravity-claude-sonnet-4-6"
          ]

          if (!antigravityModels.includes(lowerModel)) {
            return fetch(url, init)
          }

          // Pre-resolve active connection as fallback
          const connection = await runEffect(integrations.connection.active(Integration.ID.make("google-antigravity")))
          const credential = connection ? await runEffect(integrations.connection.resolve(connection as any)) as any : undefined
          const fallbackToken = credential && credential.type === "oauth" ? credential.access : ""

          // List all credentials for google-antigravity to apply selection logic
          const creds = await runEffect(credentials.list(Integration.ID.make("google-antigravity"))) as any[]
          const resolvedCreds: any[] = []
          for (const c of creds) {
            const val = await runEffect(integrations.connection.resolve({
              id: c.id,
              type: "credential",
            } as any)) as any
            if (val) {
              resolvedCreds.push({
                id: c.id,
                label: c.label,
                integrationID: c.integrationID,
                value: {
                  ...val,
                  metadata: { ...(val.metadata || {}) }
                }
              })
            }
          }

          const now = Date.now()
          const quotaGroup = getQuotaGroupForModel(lowerModel)

          // Filter out disabled/cooling down/rate-limited credentials, or 0% remaining weekly quota
          const available = []
          for (const cred of resolvedCreds) {
            const meta = cred.value.metadata as any
            if (meta.disabled === true) continue
            if (meta.coolingDownUntil && now < meta.coolingDownUntil) continue
            if (meta.rateLimitedUntil && now < meta.rateLimitedUntil) continue

            // Check if cached quota exists and is expired or missing
            let cachedQuota = meta.cachedQuota
            let cachedQuotaUpdatedAt = meta.cachedQuotaUpdatedAt
            
            // Get the access token for the account
            let token = ""
            if ((cred.value as any).type === "key") {
              // Manual Refresh Token: check if cached access token is still valid
              if (meta.accessToken && meta.expiresAt && now + 5 * 60 * 1000 < meta.expiresAt) {
                token = meta.accessToken
              } else {
                try {
                  const res = await fetch("https://oauth2.googleapis.com/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                      grant_type: "refresh_token",
                      refresh_token: (cred.value as any).key,
                      client_id: clientID,
                      client_secret: clientSecret,
                    }),
                  })
                  if (res.ok) {
                    const tokenInfo = (await res.json()) as any
                    token = tokenInfo.access_token
                    const expiresAt = now + tokenInfo.expires_in * 1000

                    // Fetch email dynamically if missing
                    let email = meta.email
                    if (!email) {
                      const userRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
                        headers: { Authorization: `Bearer ${token}` },
                      })
                      email = userRes.ok ? ((await userRes.json()) as any).email : undefined
                    }

                    // Fetch project ID dynamically if missing
                    let projectId = meta.projectId
                    if (!projectId) {
                      const projectRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                          "User-Agent": "google-api-nodejs-client/9.15.1",
                          "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
                        },
                        body: JSON.stringify({
                          metadata: {
                            ideType: "ANTIGRAVITY",
                            platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
                            pluginType: "GEMINI",
                          },
                        }),
                      })
                      if (projectRes.ok) {
                        const payload = (await projectRes.json()) as any
                        if (typeof payload?.cloudaicompanionProject === "string") {
                          projectId = payload.cloudaicompanionProject
                        } else if (typeof payload?.cloudaicompanionProject?.id === "string") {
                          projectId = payload.cloudaicompanionProject.id
                        }
                      }

                      // If still missing, auto-provision via onboarding
                      if (!projectId) {
                        try {
                          const onboardRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${token}`,
                              "User-Agent": "antigravity/windows/amd64",
                            },
                            body: JSON.stringify({
                              tierId: "FREE",
                              metadata: {
                                ideType: "ANTIGRAVITY",
                                platform: process.platform === "win32" ? "WINDOWS" : "MACOS",
                                pluginType: "GEMINI",
                              }
                            })
                          })
                          if (onboardRes.ok) {
                            const onboardData = (await onboardRes.json()) as any
                            projectId = onboardData.response?.cloudaicompanionProject?.id
                          }
                        } catch (err) {
                          console.error("Failed to onboard managed project:", err)
                        }
                      }
                    }

                    // Save the refreshed token & details in metadata
                    Object.assign(meta, { accessToken: token, expiresAt, email, projectId })
                    const updatedValue = { ...(cred.value as any), metadata: { ...meta } }
                    await runEffect(credentials.update(cred.id, { value: updatedValue as any }))
                    cred.value = updatedValue
                  }
                } catch (e) {
                  console.error("Failed to refresh manual Google token:", e)
                }
              }
            } else {
              token = (cred.value as any).access
            }

            const credProjectId = meta.projectId || "rising-fact-p41fc"

            if (token && (!cachedQuota || !cachedQuotaUpdatedAt || (now - cachedQuotaUpdatedAt) > 60 * 1000)) {
              const freshQuota = await fetchQuotaForCredential(token, credProjectId)
              if (freshQuota) {
                cachedQuota = freshQuota
                cachedQuotaUpdatedAt = now
                // Persist the updated quota in the credential metadata
                Object.assign(meta, { cachedQuota, cachedQuotaUpdatedAt })
                const updatedValue = { ...(cred.value as any), metadata: { ...meta } }
                await runEffect(credentials.update(cred.id, { value: updatedValue as any }))
                cred.value = updatedValue
              }
            }

            if (cachedQuota && cachedQuotaUpdatedAt && (now - cachedQuotaUpdatedAt) <= 60 * 1000) {
              const groupData = cachedQuota[quotaGroup]
              if (groupData && groupData.remainingFraction !== undefined && groupData.remainingFraction <= 0) {
                // 0% remaining weekly quota fraction -> exclude
                continue
              }
            }

            available.push(cred)
          }

          // Sticky account selection check (preserve prompt cache stickiness)
          const stickyCred = (() => {
            const currentId = currentActiveCredIdByFamily[quotaGroup === "claude" ? "claude" : "gemini"]
            if (!currentId) return undefined
            
            // Check if the current sticky credential is in the available pool
            return available.find((c) => c.id === currentId)
          })()

          // Select the best credential
          const selectedCred = (() => {
            if (stickyCred) {
              return stickyCred
            }

            if (available.length === 0) {
              return resolvedCreds[0]
            }

            // Find max remainingFraction
            let maxRem = -1
            const scored = available.map((c) => {
              const meta = c.value.metadata as any
              let rem = 1.0
              if (meta.cachedQuota) {
                const groupData = meta.cachedQuota[quotaGroup]
                if (groupData && groupData.remainingFraction !== undefined) {
                  rem = Math.max(0, Math.min(1, groupData.remainingFraction))
                }
              }
              if (rem > maxRem) {
                maxRem = rem
              }
              return { cred: c, rem }
            })

            // Select randomly among candidates with equal top remaining fraction
            const topCandidates = scored.filter((item) => Math.abs(item.rem - maxRem) <= 0.001)
            const randomIndex = Math.floor(Math.random() * topCandidates.length)
            return topCandidates[randomIndex].cred
          })()

          // Update active ID for the family
          if (selectedCred) {
            currentActiveCredIdByFamily[quotaGroup === "claude" ? "claude" : "gemini"] = selectedCred.id

            // Clear activeForFamily on other credentials and set on selected one
            for (const c of resolvedCreds) {
              const meta = c.value.metadata as any
              const isActive = c.id === selectedCred.id
              const isFamily = meta.activeForFamily === quotaGroup
              
              if (isActive && !isFamily) {
                const updatedMeta = { ...meta, activeForFamily: quotaGroup }
                const updatedValue = { ...(c.value as any), metadata: updatedMeta }
                await runEffect(credentials.update(c.id, { value: updatedValue as any }))
                c.value = updatedValue
              } else if (!isActive && isFamily) {
                const updatedMeta = { ...meta }
                delete updatedMeta.activeForFamily
                const updatedValue = { ...(c.value as any), metadata: updatedMeta }
                await runEffect(credentials.update(c.id, { value: updatedValue as any }))
                c.value = updatedValue
              }
            }
          }

          // Resolve final token to use
          let token = ""
          if (selectedCred) {
            const meta = selectedCred.value.metadata as any
            if ((selectedCred.value as any).type === "key") {
              token = meta.accessToken || ""
            } else {
              token = (selectedCred.value as any).access
            }
          } else {
            token = fallbackToken
          }

          const selectedMeta = (selectedCred?.value.metadata || credential?.metadata || {}) as any
          const projectId = selectedMeta.projectId || "rising-fact-p41fc"

          // Update lastUsed timestamp of selected credential
          if (selectedCred) {
            Object.assign(selectedMeta, { lastUsed: now })
            const updatedValue = { ...(selectedCred.value as any), metadata: { ...selectedMeta } }
            await runEffect(credentials.update(selectedCred.id, { value: updatedValue as any }))
          }

          const initHeaders = new Headers(init?.headers)
          if (token) {
            initHeaders.set("Authorization", `Bearer ${token}`)
          }

          const bodyText = init?.body
            ? typeof init.body === "string"
              ? init.body
              : new TextDecoder().decode(init.body as ArrayBuffer)
            : ""

          const parsed = JSON.parse(bodyText || "{}")

          // Apply model transformations and resolve backend model name
          const resolvedBackendModel = resolveBackendModel(lowerModel, parsed)

          // 1. Thinking Recovery for Claude models (if we are in a tool loop but the turn has no thinking)
          if (lowerModel.includes("claude") && Array.isArray(parsed.contents) && parsed.contents.length > 0) {
            const contents = parsed.contents
            const lastMsg = contents[contents.length - 1]
            const isToolResponse = lastMsg && lastMsg.role === "user" && Array.isArray(lastMsg.parts) && lastMsg.parts.some((p: any) => p && p.functionResponse)

            if (isToolResponse) {
              // Find the last assistant message
              let lastAssistantMsg: any = null
              for (let i = contents.length - 2; i >= 0; i--) {
                if (contents[i] && (contents[i].role === "model" || contents[i].role === "assistant")) {
                  lastAssistantMsg = contents[i]
                  break
                }
              }
              const hasThinking = lastAssistantMsg && Array.isArray(lastAssistantMsg.parts) && lastAssistantMsg.parts.some((p: any) => p && (p.thought === true || p.type === "reasoning"))

              if (!hasThinking) {
                // Trigger thinking recovery: close the tool loop
                const syntheticModel = {
                  role: "model",
                  parts: [{ text: "[Tool execution completed.]" }],
                }
                const syntheticUser = {
                  role: "user",
                  parts: [{ text: "[Continue]" }],
                }
                parsed.contents = [...contents, syntheticModel, syntheticUser]
              }
            }
          }

          // 2. Filter unsigned thinking blocks & inject cached signatures for Claude
          if (lowerModel.includes("claude") && Array.isArray(parsed.contents)) {
            parsed.contents = parsed.contents.map((content: any) => {
              if (!content || !Array.isArray(content.parts)) return content
              const filteredParts = content.parts.filter((part: any) => {
                if (part && (part.thought === true || part.type === "reasoning")) {
                  const text = part.text || ""
                  const sig = part.thoughtSignature || signatureCache.get(hashText(text))
                  if (sig) {
                    part.thoughtSignature = sig
                    return true
                  }
                  return false // Strip unsigned thinking block
                }
                return true
              })
              // Keep at least one dummy part if we stripped everything to avoid empty message
              if (filteredParts.length === 0 && content.parts.length > 0) {
                return { ...content, parts: [{ text: "[Thinking]" }] }
              }
              return { ...content, parts: filteredParts }
            })
          }

          // Mutate parsed body in place to match backend expectations
          if (lowerModel.includes("flash")) {
            const level = getThinkingLevel(parsed) || "medium"
            delete parsed.thinkingLevel
            if (parsed.thinkingConfig) delete parsed.thinkingConfig.thinkingLevel
            parsed.generationConfig = parsed.generationConfig || {}
            parsed.generationConfig.thinkingConfig = {
              includeThoughts: true,
              thinkingLevel: level
            }
          }

          if (lowerModel.includes("pro")) {
            delete parsed.thinkingLevel
            if (parsed.thinkingConfig) delete parsed.thinkingConfig
            if (parsed.generationConfig?.thinkingConfig) delete parsed.generationConfig.thinkingConfig
            if (parsed.providerOptions?.google) {
              delete parsed.providerOptions.google.thinkingLevel
              if (Object.keys(parsed.providerOptions.google).length === 0) {
                delete parsed.providerOptions.google
              }
            }
            if (parsed.providerOptions && Object.keys(parsed.providerOptions).length === 0) {
              delete parsed.providerOptions
            }
          }

          if (lowerModel.includes("claude-opus-4-6-thinking")) {
            const budget = getThinkingBudget(parsed)
            delete parsed.thinkingLevel
            if (parsed.thinkingConfig) delete parsed.thinkingConfig
            parsed.generationConfig = parsed.generationConfig || {}
            parsed.generationConfig.thinkingConfig = {
              thinkingBudget: budget
            }
          }

          if (lowerModel.includes("claude-sonnet-4-6")) {
            delete parsed.thinkingLevel
            if (parsed.thinkingConfig) delete parsed.thinkingConfig
            if (parsed.generationConfig?.thinkingConfig) delete parsed.generationConfig.thinkingConfig
          }

          // Apply tool pairing fixes for Claude models (required because Gemini format lacks tool call IDs)
          if (lowerModel.includes("claude") && Array.isArray(parsed.contents)) {
            const pendingCallIdsByName = new Map<string, string[]>()
            // First pass: assign IDs to function calls
            parsed.contents = parsed.contents.map((content: any) => {
              if (!content || !Array.isArray(content.parts)) return content
              const newParts = content.parts.map((part: any) => {
                if (part?.functionCall && typeof part.functionCall.name === "string") {
                  const call = { ...part.functionCall }
                  if (!call.id) {
                    call.id = `call_${crypto.randomUUID()}`
                  }
                  const queue = pendingCallIdsByName.get(call.name) || []
                  queue.push(call.id)
                  pendingCallIdsByName.set(call.name, queue)
                  return { ...part, functionCall: call }
                }
                return part
              })
              return { ...content, parts: newParts }
            })

            // Second pass: match function responses to calls
            parsed.contents = parsed.contents.map((content: any) => {
              if (!content || !Array.isArray(content.parts)) return content
              const newParts = content.parts.map((part: any) => {
                if (part?.functionResponse && typeof part.functionResponse.name === "string") {
                  const resp = { ...part.functionResponse }
                  if (!resp.id) {
                    const queue = pendingCallIdsByName.get(resp.name)
                    if (queue && queue.length > 0) {
                      resp.id = queue.shift()
                      pendingCallIdsByName.set(resp.name, queue)
                    }
                  }
                  return { ...part, functionResponse: resp }
                }
                return part
              })
              return { ...content, parts: newParts }
            })
          }

          const envelope = {
            project: projectId,
            model: resolvedBackendModel,
            request: parsed,
            requestType: "agent",
            userAgent: "antigravity",
            requestId: `agent-${crypto.randomUUID()}`
          }

          const response = await fetch("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse", {
            method: "POST",
            headers: initHeaders,
            body: JSON.stringify(envelope),
          })

          if (response.status === 429 && selectedCred) {
            const meta = (selectedCred.value.metadata || {}) as any
            const updatedMeta = { ...meta, rateLimitedUntil: Date.now() + 5 * 60 * 1000 }
            const updatedValue = { ...(selectedCred.value as any), metadata: updatedMeta }
            await runEffect(credentials.update(selectedCred.id, { value: updatedValue as any }))
          }

          if (!response.ok) return response

          const contentType = response.headers.get("content-type") ?? ""
          const isEventStream = contentType.includes("text/event-stream")

          const recordUsage = (innerResponse: any) => {
            if (innerResponse.usageMetadata && selectedCred) {
              const usage = innerResponse.usageMetadata
              const meta = selectedCred.value.metadata as any
              const history = meta.usageHistory || []
              history.push({
                timestamp: Date.now(),
                model: lowerModel,
                inputTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                cacheReadTokens: usage.cachedContentTokenCount || 0
              })
              
              const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
              const filteredHistory = history.filter((h: any) => h.timestamp > thirtyDaysAgo)
              meta.usageHistory = filteredHistory
              const updatedValue = { ...(selectedCred.value as any), metadata: meta }
              void runEffect(credentials.update(selectedCred.id, { value: updatedValue as any }).pipe(Effect.ignoreCause))
            }
          }

          if (isEventStream && response.body) {
            const encoder = new TextEncoder()
            const decoder = new TextDecoder()
            let buffer = ""

            const transformStream = new TransformStream({
              transform(chunk, controller) {
                buffer += decoder.decode(chunk, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() ?? ""

                for (const line of lines) {
                  if (!line.startsWith("data:")) {
                    controller.enqueue(encoder.encode(line + "\n"))
                    continue
                  }

                  const jsonStr = line.slice(5).trim()
                  if (!jsonStr) {
                    controller.enqueue(encoder.encode(line + "\n"))
                    continue
                  }

                  try {
                    const parsedData = JSON.parse(jsonStr)
                    if (parsedData.response !== undefined) {
                      let innerResponse = parsedData.response
                      
                      // Transform Claude's type: "thinking" blocks to Gemini's thought: true format
                      if (lowerModel.includes("claude") && innerResponse && typeof innerResponse === "object") {
                        if (Array.isArray(innerResponse.candidates)) {
                          innerResponse.candidates = innerResponse.candidates.map((candidate: any) => {
                            if (!candidate?.content || !Array.isArray(candidate.content.parts)) return candidate
                            candidate.content.parts = candidate.content.parts.map((part: any) => {
                              if (part?.type === "thinking" || part?.type === "redacted_thinking") {
                                const transformed: any = {
                                  text: part.thinking || part.text || "",
                                  thought: true,
                                }
                                const sig = part.signature || part.thoughtSignature
                                if (sig) {
                                  transformed.thoughtSignature = sig
                                  signatureCache.set(hashText(transformed.text), sig)
                                }
                                return transformed
                              }
                              return part
                            })
                            return candidate
                          })
                        }
                      }
                      recordUsage(innerResponse)
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(innerResponse)}\n`))
                    } else {
                      controller.enqueue(encoder.encode(line + "\n"))
                    }
                  } catch (e) {
                    controller.enqueue(encoder.encode(line + "\n"))
                  }
                }
              },
              flush(controller) {
                buffer += decoder.decode()
                if (buffer) {
                  try {
                    if (buffer.startsWith("data:")) {
                      const jsonStr = buffer.slice(5).trim()
                      if (jsonStr) {
                        const parsedData = JSON.parse(jsonStr)
                        if (parsedData.response !== undefined) {
                          // Note: flush chunk is usually empty or just end-of-stream, 
                          // but apply transform just in case
                          let innerResponse = parsedData.response
                          if (lowerModel.includes("claude") && innerResponse && typeof innerResponse === "object") {
                            if (Array.isArray(innerResponse.candidates)) {
                              innerResponse.candidates = innerResponse.candidates.map((candidate: any) => {
                                if (!candidate?.content || !Array.isArray(candidate.content.parts)) return candidate
                                candidate.content.parts = candidate.content.parts.map((part: any) => {
                                  if (part?.type === "thinking" || part?.type === "redacted_thinking") {
                                    const transformed: any = {
                                      text: part.thinking || part.text || "",
                                      thought: true,
                                    }
                                    const sig = part.signature || part.thoughtSignature
                                    if (sig) {
                                      transformed.thoughtSignature = sig
                                      signatureCache.set(hashText(transformed.text), sig)
                                    }
                                    return transformed
                                  }
                                  return part
                                })
                                return candidate
                              })
                            }
                          }
                          recordUsage(innerResponse)
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(innerResponse)}\n`))
                          return
                        }
                      }
                    }
                  } catch (e) {}
                  controller.enqueue(encoder.encode(buffer + "\n"))
                }
              }
            })

            return new Response(response.body.pipeThrough(transformStream), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            })
          }

          if (contentType.includes("application/json")) {
            const text = await response.text()
            try {
              const parsedData = JSON.parse(text)
              if (parsedData.response !== undefined) {
                let innerResponse = parsedData.response
                if (lowerModel.includes("claude") && innerResponse && typeof innerResponse === "object") {
                  if (Array.isArray(innerResponse.candidates)) {
                    innerResponse.candidates = innerResponse.candidates.map((candidate: any) => {
                      if (!candidate?.content || !Array.isArray(candidate.content.parts)) return candidate
                      candidate.content.parts = candidate.content.parts.map((part: any) => {
                        if (part?.type === "thinking" || part?.type === "redacted_thinking") {
                          const transformed: any = {
                            text: part.thinking || part.text || "",
                            thought: true,
                          }
                          const sig = part.signature || part.thoughtSignature
                          if (sig) {
                            transformed.thoughtSignature = sig
                            signatureCache.set(hashText(transformed.text), sig)
                          }
                          return transformed
                        }
                        return part
                      })
                      return candidate
                    })
                  }
                }
                recordUsage(innerResponse)
                return new Response(JSON.stringify(innerResponse), {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                })
              }
            } catch (e) {
              // Fall through to returning raw text
            }
            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            })
          }

          return response
        }

        evt.sdk = mod.createGoogleGenerativeAI({
          ...evt.options,
          fetch: customFetch as any,
        })
      }),
    )
  }),
} satisfies PluginInternal.Plugin<any>)
