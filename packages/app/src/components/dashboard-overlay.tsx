import { For, Show, createSignal, createEffect, onMount } from "solid-js"
import { useSDK } from "@/context/sdk"
import { setDashboardOpen } from "@/context/dashboard"
import { Icon } from "@opencode-ai/ui/icon"

export function DashboardOverlay() {
  const sdk = useSDK()
  const [activeTab, setActiveTab] = createSignal<"accounts" | "usage">("accounts")
  const [creds, setCreds] = createSignal<any[]>([])
  const [position, setPosition] = createSignal({ x: 150, y: 100 })
  
  let dragStart = { x: 0, y: 0 }
  let isDragging = false

  const handlePointerDown = (e: PointerEvent) => {
    // Only drag from the header bar, not buttons
    if ((e.target as HTMLElement).closest("button")) return
    isDragging = true
    dragStart = { x: e.clientX - position().x, y: e.clientY - position().y }
    document.addEventListener("pointermove", handlePointerMove)
    document.addEventListener("pointerup", handlePointerUp)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    })
  }

  const handlePointerUp = () => {
    isDragging = false
    document.removeEventListener("pointermove", handlePointerMove)
    document.removeEventListener("pointerup", handlePointerUp)
  }

  const fetchCreds = async () => {
    try {
      const res = await (sdk().client as any).credential.list({ integrationID: "google-antigravity" })
      if (res.data) {
        setCreds(res.data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  onMount(() => {
    fetchCreds()
    const id = setInterval(fetchCreds, 5000)
    return () => clearInterval(id)
  })

  // Calculations for Usage Analytics
  const usageStats = () => {
    let totalInput = 0
    let totalOutput = 0
    let totalCache = 0
    let totalCost = 0
    
    for (const c of creds()) {
      const usage = c.value?.metadata?.usage
      if (usage) {
        totalInput += usage.inputTokens || 0
        totalOutput += usage.outputTokens || 0
        totalCache += usage.cacheReadTokens || 0
        totalCost += usage.cost || 0
      }
    }

    return { totalInput, totalOutput, totalCache, totalCost }
  }

  const resetUsage = async () => {
    try {
      for (const c of creds()) {
        const meta = c.value?.metadata || {}
        if (meta.usage) {
          const updatedMeta = { ...meta }
          delete updatedMeta.usage
          await (sdk().client as any).credential.update({
            id: c.id,
            value: { ...c.value, metadata: updatedMeta }
          })
        }
      }
      fetchCreds()
    } catch (e) {
      console.error("Failed to reset usage statistics:", e)
    }
  }

  return (
    <div 
      class="absolute z-50 flex flex-col w-[800px] h-[550px] bg-v2-background-bg-base border border-v2-border-default rounded-lg shadow-2xl overflow-hidden pointer-events-auto"
      style={{
        left: position().x + "px",
        top: position().y + "px"
      }}
    >
      {/* Header bar serving as Drag Handle */}
      <div 
        class="flex flex-row justify-between items-center px-4 py-3 bg-v2-background-bg-subtle border-b border-v2-border-default cursor-move select-none shrink-0"
        onPointerDown={handlePointerDown}
      >
        <div class="flex items-center gap-2">
          <Icon name={"gauge" as any} size="small" class="text-v2-text-primary" />
          <span class="text-14-bold text-v2-text-primary font-bold">Dashboard</span>
        </div>
        <button 
          class="p-1 hover:bg-v2-background-bg-subtle rounded transition-colors text-v2-text-secondary"
          onClick={() => setDashboardOpen(false)}
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      {/* Main Layout containing Side Navigation and Content */}
      <div class="flex flex-row flex-1 min-h-0">
        
        {/* Left Side Navigation (Copied style from Cockpits) */}
        <div class="w-44 border-r border-v2-border-default flex flex-col gap-1 p-2 bg-v2-background-bg-subtle shrink-0">
          <button 
            class={"flex items-center gap-2.5 p-2 rounded text-13-medium w-full text-left transition-colors " + (
              activeTab() === "accounts" 
                ? "bg-v2-background-bg-subtle text-v2-text-primary border border-v2-border-default" 
                : "text-v2-text-secondary hover:bg-v2-background-bg-subtle border border-transparent"
            )}
            onClick={() => setActiveTab("accounts")}
          >
            <Icon name={"user" as any} size="small" />
            <span>Accounts</span>
          </button>
          
          <button 
            class={"flex items-center gap-2.5 p-2 rounded text-13-medium w-full text-left transition-colors " + (
              activeTab() === "usage" 
                ? "bg-v2-background-bg-subtle text-v2-text-primary border border-v2-border-default" 
                : "text-v2-text-secondary hover:bg-v2-background-bg-subtle border border-transparent"
            )}
            onClick={() => setActiveTab("usage")}
          >
            <Icon name={"subagent" as any} size="small" />
            <span>Usage</span>
          </button>
        </div>

        {/* Content Area */}
        <div class="flex-1 min-w-0 h-full overflow-y-auto p-4 bg-v2-background-bg-base">
          
          <Show when={activeTab() === "accounts"}>
            <div class="flex flex-col gap-4">
              <h3 class="text-15-bold font-bold text-v2-text-primary border-b border-v2-border-default pb-2">Antigravity Accounts</h3>
              <Show when={creds().length > 0} fallback={
                <div class="text-12-regular text-v2-text-tertiary">No Antigravity accounts configured yet.</div>
              }>
                <div class="flex flex-col gap-3">
                  <For each={creds()}>
                    {(cred) => {
                      const meta = (cred.value?.metadata || {}) as any
                      const quota = meta.cachedQuota || {}

                      return (
                        <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle gap-2">
                          <div class="flex flex-row justify-between items-center">
                            <div class="flex flex-col">
                              <span class="text-13-bold font-bold text-v2-text-primary">{meta.email || cred.label}</span>
                              <span class="text-11-regular text-v2-text-tertiary">Project ID: {meta.projectId || "rising-fact-p41fc"}</span>
                            </div>
                            <div class="flex items-center gap-2">
                              <Show when={meta.activeForFamily}>
                                {(family) => (
                                  <span class="px-2 py-0.5 text-11-medium text-blue-500 bg-blue-500/10 rounded capitalize">
                                    Active {family() === "claude" ? "Claude" : "Gemini"}
                                  </span>
                                )}
                              </Show>
                              <Show when={meta.rateLimitedUntil && Date.now() < meta.rateLimitedUntil}>
                                <span class="px-2 py-0.5 text-11-medium text-red-500 bg-red-500/10 rounded">Rate Limited</span>
                              </Show>
                              <Show when={meta.coolingDownUntil && Date.now() < meta.coolingDownUntil}>
                                <span class="px-2 py-0.5 text-11-medium text-orange-500 bg-orange-500/10 rounded">Cooling Down</span>
                              </Show>
                              <Show when={!meta.rateLimitedUntil && !meta.coolingDownUntil}>
                                <span class="px-2 py-0.5 text-11-medium text-green-500 bg-green-500/10 rounded">Active</span>
                              </Show>
                            </div>
                          </div>

                          {/* Quota Progress Bars */}
                          <div class="flex flex-col gap-2 mt-1">
                            <For each={["claude", "gemini-pro", "gemini-flash"]}>
                              {(group) => {
                                const groupData = quota[group]
                                const fraction = groupData?.remainingFraction !== undefined ? groupData.remainingFraction : 1.0
                                const percent = Math.round(fraction * 100)
                                const colorClass = percent > 50 ? "bg-green-500" : percent > 20 ? "bg-orange-500" : "bg-red-500"

                                return (
                                  <div class="flex flex-col gap-1">
                                    <div class="flex flex-row justify-between text-11-medium text-v2-text-secondary">
                                      <span class="capitalize">{group.replace("-", " ")} Quota</span>
                                      <span>{percent}% Remaining</span>
                                    </div>
                                    <div class="w-full h-1.5 bg-v2-background-bg-base rounded overflow-hidden">
                                      <div class={"h-full " + colorClass} style={{ width: percent + "%" }} />
                                    </div>
                                  </div>
                                )
                              }}
                            </For>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={activeTab() === "usage"}>
            <div class="flex flex-col gap-4">
              <div class="flex flex-row justify-between items-center border-b border-v2-border-default pb-2 shrink-0">
                <h3 class="text-15-bold font-bold text-v2-text-primary">Token Usage Analysis</h3>
                <button 
                  class="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-12-medium text-red-500 border border-red-500/20 rounded transition-colors"
                  onClick={resetUsage}
                >
                  Reset Stats
                </button>
              </div>

              {/* Totals Summary Board */}
              <div class="grid grid-cols-2 gap-3 shrink-0">
                <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                  <span class="text-11-medium text-v2-text-tertiary">ESTIMATED COST (USD)</span>
                  <span class="text-22-bold font-bold text-v2-text-primary mt-1">${usageStats().totalCost.toFixed(4)}</span>
                </div>
                <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                  <span class="text-11-medium text-v2-text-tertiary">TOTAL TOKENS PROCESSED</span>
                  <span class="text-22-bold font-bold text-v2-text-primary mt-1">
                    {(usageStats().totalInput + usageStats().totalOutput).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Detailed Breakdown */}
              <div class="flex flex-col gap-2 min-h-0 flex-1">
                <span class="text-13-bold font-bold text-v2-text-primary">Per-Account Breakdown</span>
                <div class="flex flex-col gap-2 overflow-y-auto pr-2 pb-4">
                  <For each={creds()}>
                    {(cred) => {
                      const meta = (cred.value?.metadata || {}) as any
                      const usage = meta.usage || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0 }
                      return (
                        <div class="flex flex-row justify-between items-center p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                          <div class="flex flex-col min-w-0 mr-4">
                            <span class="text-13-medium text-v2-text-primary truncate">{meta.email || cred.label}</span>
                            <span class="text-11-regular text-v2-text-tertiary truncate">
                              In: {usage.inputTokens.toLocaleString()} &middot; Out: {usage.outputTokens.toLocaleString()} &middot; Cache: {usage.cacheReadTokens.toLocaleString()}
                            </span>
                          </div>
                          <span class="text-14-bold font-bold text-v2-text-primary shrink-0">${usage.cost.toFixed(4)}</span>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>
            </div>
          </Show>

        </div>
      </div>
    </div>
  )
}
