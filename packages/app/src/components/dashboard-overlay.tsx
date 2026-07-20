import { For, Show, createSignal, createEffect, onMount } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { setDashboardOpen } from "@/context/dashboard"
import { Icon } from "@opencode-ai/ui/icon"

export function DashboardOverlay() {
  const sdk = useServerSDK()
  const [activeTab, setActiveTab] = createSignal<"accounts" | "usage">("accounts")
  const [creds, setCreds] = createSignal<any[]>([])
  const [position, setPosition] = createSignal({ x: 150, y: 100 })
  const [refreshTokenInput, setRefreshTokenInput] = createSignal("")
  
  const [timeFilter, setTimeFilter] = createSignal<"1d" | "1w" | "1m" | "all">("all")
  
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

  const usageStats = () => {
    let totalInput = 0
    let totalOutput = 0
    let totalCache = 0
    
    const cutoff = Date.now() - (
      timeFilter() === "1d" ? 1 * 24 * 60 * 60 * 1000 :
      timeFilter() === "1w" ? 7 * 24 * 60 * 60 * 1000 :
      timeFilter() === "1m" ? 30 * 24 * 60 * 60 * 1000 :
      0
    )

    const modelTotals: Record<string, { input: number, output: number, cache: number }> = {}

    for (const c of creds()) {
      const history = c.value?.metadata?.usageHistory || []
      for (const h of history) {
        if (timeFilter() !== "all" && h.timestamp < cutoff) continue
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

    // Sort models by total tokens descending
    const sortedModelTotals = Object.entries(modelTotals).sort((a, b) => {
      const aTotal = a[1].input + a[1].output + a[1].cache
      const bTotal = b[1].input + b[1].output + b[1].cache
      return bTotal - aTotal
    })

    return { totalInput, totalOutput, totalCache, modelTotals: sortedModelTotals }
  }

  const resetUsage = async () => {
    try {
      for (const c of creds()) {
        const meta = c.value?.metadata || {}
        if (meta.usageHistory || meta.usage) {
          const updatedMeta = { ...meta }
          delete updatedMeta.usageHistory
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

  const addAccountFromToken = async () => {
    const token = refreshTokenInput().trim()
    if (!token) return
    try {
      await (sdk().client as any).integrations.connectKey({
        integrationID: "google-antigravity",
        label: `Antigravity (${token.substring(0, 5)}...)`,
        key: token
      })
      setRefreshTokenInput("")
      fetchCreds()
    } catch (e) {
      console.error("Failed to add account via refresh token", e)
    }
  }

  const [isMigrating, setIsMigrating] = createSignal(false)
  const migrateLegacyAccounts = async () => {
    setIsMigrating(true)
    try {
      const oldCreds = await (sdk().client as any).credential.list({ integrationID: "@zeklop/opencode-antigravity-auth" })
      if (oldCreds.data && oldCreds.data.length > 0) {
        for (const cred of oldCreds.data) {
          if (cred.value?.refreshToken) {
            await (sdk().client as any).integrations.connectKey({
              integrationID: "google-antigravity",
              label: cred.label,
              key: cred.value.refreshToken
            })
            await (sdk().client as any).credentials.remove({ credentialID: cred.id })
          }
        }
        alert(`Successfully migrated ${oldCreds.data.length} accounts to the native Antigravity integration!`)
      } else {
        alert("No legacy plugin accounts found to migrate. Please use the Add Account via Refresh Token input above.")
      }
      fetchCreds()
    } catch (e) {
      console.error("Failed to migrate legacy accounts", e)
      alert("Failed to migrate accounts. Check the console for details.")
    } finally {
      setIsMigrating(false)
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
              <div class="flex flex-row justify-between items-center border-b border-v2-border-default pb-2">
                <h3 class="text-15-bold font-bold text-v2-text-primary">Antigravity Accounts</h3>
                <button
                  class="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-12-medium rounded transition-colors disabled:opacity-50"
                  disabled={isMigrating()}
                  onClick={migrateLegacyAccounts}
                >
                  {isMigrating() ? "Migrating..." : "Migrate Legacy Plugin Accounts"}
                </button>
              </div>
              
              {/* Add Account Section */}
              <div class="flex flex-col gap-2 p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                <span class="text-13-medium text-v2-text-primary">Add Account via Refresh Token</span>
                <div class="flex flex-row gap-2">
                  <input
                    type="text"
                    placeholder="1//0xxxxxxxxx..."
                    value={refreshTokenInput()}
                    onInput={(e) => setRefreshTokenInput(e.currentTarget.value)}
                    class="flex-1 px-3 py-1.5 bg-v2-background-bg-base border border-v2-border-default rounded text-13-regular text-v2-text-primary focus:outline-none focus:border-blue-500"
                  />
                  <button
                    class="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-13-medium rounded transition-colors disabled:opacity-50"
                    disabled={!refreshTokenInput().trim()}
                    onClick={addAccountFromToken}
                  >
                    Add
                  </button>
                </div>
              </div>

              <Show when={creds().length > 0} fallback={
                <div class="text-12-regular text-v2-text-tertiary mt-2">No Antigravity accounts configured yet.</div>
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

  const [isMigrating, setIsMigrating] = createSignal(false)
  const migrateLegacyAccounts = async () => {
    setIsMigrating(true)
    try {
      const oldCreds = await (sdk().client as any).credential.list({ integrationID: "@zeklop/opencode-antigravity-auth" })
      if (!oldCreds.data || oldCreds.data.length === 0) {
        alert("No legacy plugin accounts found to migrate.")
        setIsMigrating(false)
        return
      }

      for (const cred of oldCreds.data) {
        await (sdk().client as any).credential.create({
          integrationID: "google-antigravity",
          label: cred.label,
          value: cred.value
        })
        await (sdk().client as any).credential.delete({ id: cred.id })
      }
      alert(`Successfully migrated ${oldCreds.data.length} accounts to the native Antigravity integration!`)
      fetchCreds()
    } catch (e) {
      console.error("Failed to migrate legacy accounts", e)
      alert("Failed to migrate accounts. Check the console for details.")
    } finally {
      setIsMigrating(false)
    }
  }

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
                <div class="flex items-center gap-4">
                  <h3 class="text-15-bold font-bold text-v2-text-primary">Token Usage Analysis</h3>
                  <select 
                    class="bg-v2-background-bg-subtle border border-v2-border-default text-12-medium text-v2-text-primary rounded px-2 py-1 outline-none"
                    value={timeFilter()}
                    onChange={(e) => setTimeFilter(e.currentTarget.value as any)}
                  >
                    <option value="1d">Recent 1 Day</option>
                    <option value="1w">Recent 1 Week</option>
                    <option value="1m">Recent 1 Month</option>
                    <option value="all">All Time</option>
                  </select>
                </div>
                <button 
                  class="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-12-medium text-red-500 border border-red-500/20 rounded transition-colors"
                  onClick={resetUsage}
                >
                  Reset Stats
                </button>
              </div>

              {/* Totals Summary Board */}
              <div class="grid grid-cols-4 gap-3 shrink-0">
                <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle col-span-2">
                  <span class="text-11-medium text-v2-text-tertiary">TOTAL TOKENS PROCESSED</span>
                  <span class="text-22-bold font-bold text-v2-text-primary mt-1">
                    {(usageStats().totalInput + usageStats().totalOutput + usageStats().totalCache).toLocaleString()}
                  </span>
                </div>
                <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                  <span class="text-11-medium text-v2-text-tertiary">CACHE READS</span>
                  <span class="text-22-bold font-bold text-v2-text-primary mt-1 text-orange-500">
                    {usageStats().totalCache.toLocaleString()}
                  </span>
                </div>
                <div class="flex flex-col p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                  <span class="text-11-medium text-v2-text-tertiary">TOTAL I/O</span>
                  <span class="text-22-bold font-bold text-v2-text-primary mt-1 text-green-500">
                    {(usageStats().totalInput + usageStats().totalOutput).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Detailed Breakdown */}
              <div class="flex flex-col gap-2 min-h-0 flex-1">
                <span class="text-13-bold font-bold text-v2-text-primary">Per-Model Breakdown</span>
                <div class="flex flex-col gap-2 overflow-y-auto pr-2 pb-4">
                  <Show when={usageStats().modelTotals.length > 0} fallback={
                    <div class="text-12-regular text-v2-text-tertiary mt-2">No usage recorded in the selected period.</div>
                  }>
                    <For each={usageStats().modelTotals}>
                      {([modelName, usage]) => (
                        <div class="flex flex-row justify-between items-center p-3 rounded border border-v2-border-default bg-v2-background-bg-subtle">
                          <div class="flex flex-col min-w-0 mr-4">
                            <span class="text-13-medium text-v2-text-primary truncate">{modelName}</span>
                            <span class="text-11-regular text-v2-text-tertiary truncate">
                              In: {usage.input.toLocaleString()} &middot; Out: {usage.output.toLocaleString()} &middot; Cache: {usage.cache.toLocaleString()}
                            </span>
                          </div>
                          <span class="text-14-bold font-bold text-v2-text-primary shrink-0">
                            {(usage.input + usage.output + usage.cache).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
          </Show>

        </div>
      </div>
    </div>
  )
}
