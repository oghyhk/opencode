import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GoogleAntigravityPlugin } from "@opencode-ai/core/plugin/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Catalog } from "@opencode-ai/core/catalog"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* GoogleAntigravityPlugin.effect(host)
})

describe("GoogleAntigravityPlugin", () => {
  it.effect("registers all 8 models with correct metadata and variants", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* addPlugin()

      const providerID = ProviderV2.ID.make("google-antigravity")

      // Verify Gemini 3.5 Flash
      const flash35 = yield* catalog.model.get(providerID, ModelV2.ID.make("antigravity-gemini-3.5-flash"))
      expect(flash35).toBeDefined()
      expect(flash35?.name).toBe("Gemini 3.5 Flash (Antigravity)")
      expect(flash35?.limit.context).toBe(1048576)
      expect(flash35?.request.variant).toBe("medium")
      expect(flash35?.variants).toHaveLength(3)
      expect((flash35?.variants.find(v => v.id === "low")?.body as any).thinkingConfig.thinkingLevel).toBe("low")

      // Verify Gemini 3.5 Pro
      const pro35 = yield* catalog.model.get(providerID, ModelV2.ID.make("antigravity-gemini-3.5-pro"))
      expect(pro35).toBeDefined()
      expect(pro35?.name).toBe("Gemini 3.5 Pro (Antigravity)")
      expect(pro35?.limit.context).toBe(1048576)
      expect(pro35?.request.variant).toBe("low")
      expect(pro35?.variants).toHaveLength(2)
      expect((pro35?.variants.find(v => v.id === "high")?.body as any).thinkingLevel).toBe("high")

      // Verify Claude Opus Thinking
      const opus = yield* catalog.model.get(providerID, ModelV2.ID.make("antigravity-claude-opus-4-6-thinking"))
      expect(opus).toBeDefined()
      expect(opus?.name).toBe("Claude Opus 4.6 Thinking (Antigravity)")
      expect(opus?.limit.context).toBe(200000)
      expect(opus?.request.variant).toBe("max")
      expect(opus?.variants).toHaveLength(2)
      expect((opus?.variants.find(v => v.id === "max")?.body as any).thinkingConfig.thinkingBudget).toBe(32768)

      // Verify Claude Sonnet
      const sonnet = yield* catalog.model.get(providerID, ModelV2.ID.make("antigravity-claude-sonnet-4-6"))
      expect(sonnet).toBeDefined()
      expect(sonnet?.variants).toHaveLength(0)
    }),
  )

  it.effect("intercepts, wraps and maps Flash model requests correctly", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("google-antigravity"), ModelV2.ID.make("antigravity-gemini-3.5-flash")),
        api: { id: ModelV2.ID.make("gemini-3.5-flash"), type: "aisdk", package: "@ai-sdk/google" },
        request: { headers: {}, body: { apiKey: "test" } }
      })
      const language = yield* aisdk.language(model)

      let calledUrl = ""
      let calledBody = ""
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        calledUrl = typeof url === "string" ? url : url.toString()
        calledBody = init?.body ? String(init.body) : ""
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Hello" }] } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }) as any

      try {
        yield* Effect.promise(() => language.doGenerate({
          inputFormat: "prompt-update",
          mode: "regular",
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
        } as any))
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(calledUrl).toContain("cloudcode-pa.googleapis.com")
      const parsed = JSON.parse(calledBody)
      expect(parsed.project).toBe("rising-fact-p41fc")
      expect(parsed.model).toBe("gemini-3.5-flash-low")
      expect(parsed.request.generationConfig.thinkingConfig.thinkingLevel).toBe("medium")
    }),
  )

  it.effect("intercepts, wraps and maps Pro model variants correctly", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      // Gemini 3.5 Pro with high thinking effort inside model request body
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("google-antigravity"), ModelV2.ID.make("antigravity-gemini-3.5-pro")),
        api: { id: ModelV2.ID.make("gemini-3.5-pro"), type: "aisdk", package: "@ai-sdk/google" },
        request: { headers: {}, body: { apiKey: "test", thinkingLevel: "high" } }
      })
      const language = yield* aisdk.language(model)

      let calledUrl = ""
      let calledBody = ""
      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        calledUrl = typeof url === "string" ? url : url.toString()
        calledBody = init?.body ? String(init.body) : ""
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Hello" }] } }]
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }) as any

      try {
        yield* Effect.promise(() => language.doGenerate({
          inputFormat: "prompt-update",
          mode: "regular",
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
        } as any))
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(calledUrl).toContain("cloudcode-pa.googleapis.com")
      const parsed = JSON.parse(calledBody)
      expect(parsed.model).toBe("gemini-3.5-pro-high")
      expect(parsed.request.providerOptions).toBeUndefined()
    }),
  )

  it.effect("unwraps Antigravity response envelope and translates Claude thinking blocks", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("google-antigravity"), ModelV2.ID.make("antigravity-claude-opus-4-6-thinking")),
        api: { id: ModelV2.ID.make("claude-opus-4-6-thinking"), type: "aisdk", package: "@ai-sdk/google" },
        request: { headers: {}, body: { apiKey: "test" } }
      })
      const language = yield* aisdk.language(model)

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async (url: any, init: any) => {
        // Return wrapped response simulating Antigravity endpoint
        return new Response(JSON.stringify({
          response: {
            candidates: [{ 
              content: { 
                parts: [
                  { type: "thinking", thinking: "I am thinking", signature: "sig123" },
                  { text: "Here is the answer" }
                ] 
              } 
            }]
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } })
      }) as any

      try {
        const response = yield* Effect.promise(() => language.doGenerate({
          inputFormat: "prompt-update",
          mode: "regular",
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
        } as any))

        // Verify the response is correctly unwrapped and parsed by the AI SDK
        const content = response.content as any[]
        expect(content[0].type).toBe("reasoning")
        expect(content[0].text).toBe("I am thinking")
        expect(content[0].providerMetadata.google.thoughtSignature).toBe("sig123")
        
        expect(content[1].type).toBe("text")
        expect(content[1].text).toBe("Here is the answer")
      } finally {
        globalThis.fetch = originalFetch
      }
    }),
  )
})
