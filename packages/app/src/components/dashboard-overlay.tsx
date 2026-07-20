import { For, Show, createSignal, onMount } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { setDashboardOpen } from "@/context/dashboard"
import { Icon } from "@opencode-ai/ui/icon"

export function DashboardOverlay() {
  const sdk = useServerSDK()
  const [activeTab, setActiveTab] = createSignal<"google" | "usage">("google")
  const [googleCreds, setGoogleCreds] = createSignal<any[]>([])
  const [position, setPosition] = createSignal({ x: 150, y: 100 })
  const [refreshTokenInput, setRefreshTokenInput] = createSignal("")
  const [timeFilter, setTimeFilter] = createSignal<"1d" | "1w" | "1m" | "all">("all")
  const [isMigrating, setIsMigrating] = createSignal(false)
  const [usageData, setUsageData] = createSignal<{
    modelTotals: Array<{ model: string; input: number; output: number; cache: number }>
    totalInput: number
    totalOutput: number
    totalCache: number
  } | null>(null)

  let dragStart = { x: 0, y: 0 }
  let isDragging = false

  const handlePointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return
    if ((e.target as HTMLElement).closest("input")) return
    if ((e.target as HTMLElement).closest("select")) return
    isDragging = true
    dragStart = { x: e.clientX - position().x, y: e.clientY - position().y }
    document.addEventListener("pointermove", handlePointerMove)
    document.addEventListener("pointerup", handlePointerUp)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging) return
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const handlePointerUp = () => {
    isDragging = false
    document.removeEventListener("pointermove", handlePointerMove)
    document.removeEventListener("pointerup", handlePointerUp)
  }

  const fetchGoogleCreds = async () => {
    try {
      const res = await (sdk().client as any).v2.integration.get({ integrationID: "google-antigravity" })
      const info = res?.data?.data ?? res?.data ?? res ?? {}
      const conns = (info.connections ?? []).filter((c: any) => c.type === "credential")
      setGoogleCreds(conns)
    } catch (e) {
      console.error("Failed to fetch Google accounts:", e)
    }
  }

  const fetchUsage = async () => {
    try {
      const res = await (sdk().client as any).credentials.usage()
      const data = res?.data ?? res
      if (data && data.modelTotals) setUsageData(data)
    } catch (e) {
      console.error("Failed to fetch usage:", e)
    }
  }

  const fetchAll = () => {
    fetchGoogleCreds()
    fetchUsage()
  }

  onMount(() => {
    fetchAll()
    const id = setInterval(fetchAll, 5000)
    return () => clearInterval(id)
  })

  const addGoogleAccount = async () => {
    const token = refreshTokenInput().trim()
    if (!token) return
    try {
      await (sdk().client as any).v2.integration.connect.key({
        integrationID: "google-antigravity",
        label: `Antigravity (${token.substring(0, 8)}...)`,
        key: token,
      })
      setRefreshTokenInput("")
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to add Google account", e)
    }
  }

  const setActiveGoogleAccount = async (id: string, family: string) => {
    try {
      const client = sdk().client as any
      if (client.v2?.integration?.setActiveAccount) {
        await client.v2.integration.setActiveAccount({ integrationID: "google-antigravity", credentialID: id, family })
      } else {
        await client.integrations.setActiveAccount({ integrationID: "google-antigravity", credentialID: id, family })
      }
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to set active account", e)
    }
  }

  const migrateLegacyAccounts = async () => {
    setIsMigrating(true)
    try {
      const client = sdk().client as any
      const res = client.v2?.integration?.migratePlugin
        ? await client.v2.integration.migratePlugin({ integrationID: "google-antigravity" })
        : await client.integrations.migratePlugin({ integrationID: "google-antigravity" })

      const data = res?.data ?? res
      if (data && typeof data.migrated === "number") {
        alert(`Successfully migrated ${data.migrated} account(s) from plugin config (${data.skipped} skipped/existing)!`)
      } else {
        alert("Migration completed.")
      }
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to migrate plugin accounts:", e)
      alert("Migration failed or endpoint unavailable.")
    } finally {
      setIsMigrating(false)
    }
  }

  const removeGoogleAccount = async (id: string) => {
    try {
      await (sdk().client as any).v2.credential.remove({ credentialID: id })
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to remove Google account", e)
    }
  }

  const resetUsage = async () => {
    try {
      for (const c of googleCreds()) {
        await (sdk().client as any).v2.credential.remove({ credentialID: c.id })
      }
      fetchAll()
    } catch (e) {
      console.error("Failed to reset usage:", e)
    }
  }

  const tabs = [
    { id: "google" as const, label: "Google", color: "text-blue-400", bgActive: "bg-blue-500/10 border-blue-500/30" },
    { id: "usage" as const, label: "Usage", color: "text-amber-400", bgActive: "bg-amber-500/10 border-amber-500/30" },
  ]

  const usageModelTotals = () => usageData()?.modelTotals ?? []
  const usageTotalInput = () => usageData()?.totalInput ?? 0
  const usageTotalOutput = () => usageData()?.totalOutput ?? 0
  const usageTotalCache = () => usageData()?.totalCache ?? 0

  return (
    <div
      class="absolute z-50 flex flex-col w-[880px] h-[600px] rounded-xl shadow-2xl overflow-hidden pointer-events-auto"
      style={{
        left: position().x + "px",
        top: position().y + "px",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        border: "1px solid rgba(148, 163, 184, 0.15)",
      }}
    >
      <div
        class="flex flex-row justify-between items-center px-5 py-3 cursor-move select-none shrink-0"
        style={{ background: "rgba(15, 23, 42, 0.8)", "border-bottom": "1px solid rgba(148, 163, 184, 0.1)" }}
        onPointerDown={handlePointerDown}
      >
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
            <Icon name={"gauge" as any} size="small" class="text-white" />
          </div>
          <span class="text-sm font-bold text-white tracking-wide">Dashboard</span>
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/20">
            {googleCreds().length} Google
          </span>
        </div>
        <button
          class="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
          onClick={() => setDashboardOpen(false)}
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      <div class="flex flex-row flex-1 min-h-0">
        <div class="w-40 flex flex-col gap-1.5 p-3 shrink-0" style={{ background: "rgba(15, 23, 42, 0.6)", "border-right": "1px solid rgba(148, 163, 184, 0.08)" }}>
          <For each={tabs}>
            {(tab) => (
              <button
                class={
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold w-full text-left transition-all duration-200 border " +
                  (activeTab() === tab.id
                    ? tab.bgActive + " " + tab.color
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border-transparent")
                }
                onClick={() => setActiveTab(tab.id)}
              >
                <div
                  class={"w-2 h-2 rounded-full transition-all " + (activeTab() === tab.id ? "scale-100 opacity-100" : "scale-75 opacity-40")}
                  style={{
                    background: tab.id === "google" ? "#3b82f6" : "#f59e0b",
                  }}
                />
                <span>{tab.label}</span>
              </button>
            )}
          </For>

          <div class="mt-auto pt-3 flex flex-col gap-2" style={{ "border-top": "1px solid rgba(148, 163, 184, 0.08)" }}>
            <div class="flex flex-col px-2">
              <span class="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Total Accounts</span>
              <span class="text-lg font-black text-white">{googleCreds().length}</span>
            </div>
          </div>
        </div>

        <div class="flex-1 min-w-0 h-full overflow-y-auto p-5" style={{ background: "rgba(15, 23, 42, 0.3)" }}>

          {/* ═══════════════ GOOGLE TAB ═══════════════ */}
          <Show when={activeTab() === "google"}>
            <div class="flex flex-col gap-4">
              <div class="flex flex-row justify-between items-center pb-3" style={{ "border-bottom": "1px solid rgba(59, 130, 246, 0.2)" }}>
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" style={{ background: "#3b82f6" }} />
                  <h3 class="text-sm font-bold text-white">Google Antigravity</h3>
                  <button
                    class="ml-1 p-1 rounded hover:bg-white/10 transition-colors"
                    style={{ color: "#94a3b8" }}
                    onClick={fetchAll}
                    title="Refresh"
                  >
                    <Icon name={"rotate-cw" as any} size="small" />
                  </button>
                </div>
                <button
                  class="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.2)" }}
                  disabled={isMigrating()}
                  onClick={migrateLegacyAccounts}
                >
                  {isMigrating() ? "Migrating..." : "Migrate Plugin Accounts"}
                </button>
              </div>

              <div class="flex flex-col gap-2 p-3 rounded-lg" style={{ background: "rgba(59, 130, 246, 0.06)", border: "1px solid rgba(59, 130, 246, 0.15)" }}>
                <span class="text-xs font-semibold text-blue-300">Add via Refresh Token</span>
                <div class="flex flex-row gap-2">
                  <input
                    type="text"
                    placeholder="1//0xxxxxxxxx..."
                    value={refreshTokenInput()}
                    onInput={(e) => setRefreshTokenInput(e.currentTarget.value)}
                    class="flex-1 px-3 py-2 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(148, 163, 184, 0.15)" }}
                  />
                  <button
                    class="px-4 py-2 text-xs font-bold rounded-lg text-white transition-all disabled:opacity-40 hover:brightness-110"
                    style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
                    disabled={!refreshTokenInput().trim()}
                    onClick={addGoogleAccount}
                  >
                    Add
                  </button>
                </div>
              </div>

              <Show
                when={googleCreds().length > 0}
                fallback={
                  <div class="text-xs text-slate-500 mt-2 text-center py-8">No Google Antigravity accounts configured yet.</div>
                }
              >
                <div class="flex flex-col gap-3">
                  <For each={googleCreds()}>
                    {(cred) => {
                      const accountId = cred.id
                      const accountLabel = cred.label || "Unknown account"

                      return (
                        <div class="flex flex-col p-3 rounded-lg gap-2.5" style={{ background: "rgba(30, 27, 75, 0.4)", border: "1px solid rgba(99, 102, 241, 0.15)" }}>
                          <div class="flex flex-row justify-between items-center">
                            <div class="flex flex-col">
                              <span class="text-xs font-bold text-white">{accountLabel}</span>
                              <span class="text-[10px] text-slate-500 font-mono">{accountId.substring(0, 16)}...</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                              <button
                                class="px-2 py-0.5 text-[9px] font-bold rounded-md bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors border border-slate-700 hover:border-indigo-500"
                                onClick={() => setActiveGoogleAccount(accountId, "claude")}
                              >
                                Active (Claude)
                              </button>
                              <button
                                class="px-2 py-0.5 text-[9px] font-bold rounded-md bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white transition-colors border border-slate-700 hover:border-sky-500"
                                onClick={() => setActiveGoogleAccount(accountId, "gemini")}
                              >
                                Active (Gemini)
                              </button>
                              <button
                                class="ml-1 p-1 rounded hover:bg-red-500/20 transition-colors text-slate-600 hover:text-red-400"
                                onClick={() => removeGoogleAccount(accountId)}
                                title="Remove account"
                              >
                                <Icon name="close" size="small" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* ═══════════════ USAGE TAB ═══════════════ */}
          <Show when={activeTab() === "usage"}>
            <div class="flex flex-col gap-4">
              <div class="flex flex-row justify-between items-center pb-3" style={{ "border-bottom": "1px solid rgba(245, 158, 11, 0.2)" }}>
                <div class="flex items-center gap-3">
                  <div class="w-3 h-3 rounded-full" style={{ background: "#f59e0b" }} />
                  <h3 class="text-sm font-bold text-white">Token Usage</h3>
                  <button
                    class="p-1 rounded hover:bg-white/10 transition-colors"
                    style={{ color: "#94a3b8" }}
                    onClick={fetchAll}
                    title="Refresh"
                  >
                    <Icon name={"rotate-cw" as any} size="small" />
                  </button>
                </div>
                <button
                  class="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors"
                  style={{ background: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.15)" }}
                  onClick={resetUsage}
                >
                  Reset
                </button>
              </div>

              <div class="grid grid-cols-3 gap-3">
                <div class="flex flex-col p-3 rounded-lg" style={{ background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.15)" }}>
                  <span class="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">Total Processed</span>
                  <span class="text-xl font-black text-white mt-1">
                    {(usageTotalInput() + usageTotalOutput() + usageTotalCache()).toLocaleString()}
                  </span>
                </div>
                <div class="flex flex-col p-3 rounded-lg" style={{ background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.15)" }}>
                  <span class="text-[9px] font-bold text-amber-400 uppercase tracking-wider">Cache Reads</span>
                  <span class="text-xl font-black mt-1" style={{ color: "#fbbf24" }}>
                    {usageTotalCache().toLocaleString()}
                  </span>
                </div>
                <div class="flex flex-col p-3 rounded-lg" style={{ background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.15)" }}>
                  <span class="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">I/O Tokens</span>
                  <span class="text-xl font-black mt-1" style={{ color: "#4ade80" }}>
                    {(usageTotalInput() + usageTotalOutput()).toLocaleString()}
                  </span>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Per-Model Breakdown</span>
                <Show
                  when={usageModelTotals().length > 0}
                  fallback={<div class="text-xs text-slate-600 py-4 text-center">No usage recorded yet. Start a chat with a Gemini or Claude model to generate usage data.</div>}
                >
                  <div class="flex flex-col gap-2 overflow-y-auto pr-1 pb-4" style={{ "max-height": "300px" }}>
                    <For each={usageModelTotals()}>
                      {(item) => {
                        const total = item.input + item.output + item.cache
                        const maxTotal = usageModelTotals()[0]
                          ? usageModelTotals()[0].input + usageModelTotals()[0].output + usageModelTotals()[0].cache
                          : 1
                        const barPercent = Math.max(5, Math.round((total / maxTotal) * 100))

                        return (
                          <div class="flex flex-col gap-1.5 p-2.5 rounded-lg" style={{ background: "rgba(148, 163, 184, 0.04)", border: "1px solid rgba(148, 163, 184, 0.08)" }}>
                            <div class="flex flex-row justify-between items-center">
                              <span class="text-xs font-semibold text-white truncate mr-3">{item.model}</span>
                              <span class="text-xs font-bold text-slate-300 shrink-0">{total.toLocaleString()}</span>
                            </div>
                            <div class="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(148, 163, 184, 0.08)" }}>
                              <div
                                class="h-full rounded-full"
                                style={{
                                  width: barPercent + "%",
                                  background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                                }}
                              />
                            </div>
                            <div class="flex gap-3 text-[9px] text-slate-500">
                              <span>In: <span class="text-blue-400">{item.input.toLocaleString()}</span></span>
                              <span>Out: <span class="text-purple-400">{item.output.toLocaleString()}</span></span>
                              <span>Cache: <span class="text-amber-400">{item.cache.toLocaleString()}</span></span>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

        </div>
      </div>
    </div>
  )
}
