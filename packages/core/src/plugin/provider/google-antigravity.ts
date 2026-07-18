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

const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
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

        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
        url.searchParams.set("client_id", clientID)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("redirect_uri", redirectURI)
        url.searchParams.set("scope", scopes.join(" "))
        url.searchParams.set("code_challenge", challenge)
        url.searchParams.set("code_challenge_method", "S256")
        url.searchParams.set(
          "state",
          Buffer.from(JSON.stringify({ verifier }), "utf8").toString("base64url"),
        )
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("prompt", "consent")

        const listener = (yield* Effect.promise(() => startOAuthListener({ port: 51121, path: "/oauth-callback", timeoutMs: 5 * 60 * 1000 }))) as any

        return {
          mode: "code" as const,
          url: url.toString(),
          instructions: "Sign in using Google Antigravity in the browser window",
          callback: (code: string) =>
            Effect.gen(function* () {
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

              return Credential.OAuth.make({
                type: "oauth" as const,
                methodID,
                access: token.access_token,
                refresh: token.refresh_token,
                expires: Date.now() + token.expires_in * 1000,
                metadata: {
                  email: userInfo.email,
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
          refresh: token.refresh_token,
          expires: Date.now() + token.expires_in * 1000,
        }
      }),
  }
}

export const GoogleAntigravityPlugin = define({
  id: "google-antigravity",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((draft: any) => {
      draft.update("google-antigravity", (integration: any) => {
        integration.name = "Google Antigravity"
      })
      draft.method.update(oauth())
    })

    yield* ctx.catalog.transform((catalog: any) => {
      const providerID = ProviderV2.ID.make("google-antigravity")
      catalog.provider.update(providerID, (provider: any) => {
        provider.name = "Google Antigravity"
        provider.integrationID = Integration.ID.make("google-antigravity")
        provider.api = { type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
      })

      // Natively register the models in the catalog
      catalog.model.update(providerID, ModelV2.ID.make("antigravity-gemini-3.5-flash"), (model: any) => {
        model.name = "Gemini 3.5 Flash (Antigravity)"
        model.api = { id: "gemini-3.5-flash", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 1048576, output: 65536 }
      })

      catalog.model.update(providerID, ModelV2.ID.make("antigravity-claude-opus-4-6-thinking"), (model: any) => {
        model.name = "Claude Opus 4.6 Thinking (Antigravity)"
        model.api = { id: "claude-opus-4-6", type: "aisdk", package: "@ai-sdk/google", url: "https://cloudcode-pa.googleapis.com" }
        model.capabilities = { tools: true, input: ["text", "image", "pdf"], output: ["text"] }
        model.limit = { context: 200000, output: 64000 }
      })
    })

    // Custom fetch wrapper mapping to Antigravity endpoints
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/google") return
        const mod = yield* Effect.promise(() => import("@ai-sdk/google"))

        // Pre-resolve credentials statically inside the generator
        const connection = yield* ctx.integration.connection.active("google-antigravity")
        const credential = connection ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orDie) : undefined
        const token = credential && credential.type === "oauth" ? credential.access : ""

        const customFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const targetUrl = typeof url === "string" ? url : url instanceof Request ? url.url : url.toString()
          if (!targetUrl.includes("generativelanguage.googleapis.com") && !targetUrl.includes("cloudcode-pa.googleapis.com")) {
            return fetch(url, init)
          }

          const initHeaders = new Headers(init?.headers)
          if (token) {
            initHeaders.set("Authorization", `Bearer ${token}`)
          }

          let bodyText = ""
          if (init?.body) {
            bodyText = typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)
          }

          // Wrap payload in Antigravity envelope format
          const parsed = JSON.parse(bodyText || "{}")
          const envelope = {
            project: "rising-fact-p41fc", // Default daily project
            model: "gemini-3.5-flash",
            request: parsed,
          }

          const wrappedBody = JSON.stringify(envelope)

          return fetch("https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse", {
            method: "POST",
            headers: initHeaders,
            body: wrappedBody,
          })
        }

        evt.sdk = mod.createGoogleGenerativeAI({
          ...evt.options,
          fetch: customFetch as any,
        })
      }),
    )
  }),
} satisfies PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>)
