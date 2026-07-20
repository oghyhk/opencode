import { For, Show, createSignal, onMount } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { setDashboardOpen } from "@/context/dashboard"
import { Icon } from "@opencode-ai/ui/icon"

// ── Cockpit JSON parser (ported from GPTSession2CPAandSub2API) ──────────────
function str(val: unknown): string {
  return typeof val === "string" && val.trim() ? val.trim() : ""
}

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".")
  if (parts.length < 2) return undefined
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
  } catch {
    return undefined
  }
}

function collectSessionLikeObjects(value: unknown, sourceName = "pasted"): any[] {
  const found: any[] = []
  const visited = new WeakSet()

  function visit(item: unknown, path: string) {
    if (!item || typeof item !== "object") return
    if (Array.isArray(item)) {
      item.forEach((child, i) => visit(child, `${path}[${i}]`))
      return
    }
    if (visited.has(item)) return
    visited.add(item)
    const obj = item as Record<string, any>

    const token =
      str(obj.accessToken) || str(obj.access_token) ||
      str(obj.tokens?.access_token) || str(obj.tokens?.accessToken) ||
      str(obj.credentials?.access_token)

    const hasIdentity = obj.user || str(obj.email) || str(obj.name) || str(obj.label) ||
      str(obj.meta?.label) || str(obj.tokens?.account_id) ||
      str(obj.providerSpecificData?.chatgptAccountId) || str(obj.id)

    if (token && hasIdentity) {
      found.push({ value: obj, sourceName, path })
      return
    }

    for (const [key, child] of Object.entries(obj)) {
      if (key === "accessToken" || key === "access_token" || key === "sessionToken") continue
      visit(child, `${path}.${key}`)
    }
  }

  visit(value, "$")
  return found
}

function convertToCockpitFormat(record: Record<string, any>): {
  access_token: string
  refresh_token: string
  session_token: string
  id_token: string
  email?: string
  account_id?: string
  plan?: string
} | null {
  const accessToken =
    str(record.accessToken) || str(record.access_token) ||
    str(record.tokens?.access_token) || str(record.tokens?.accessToken) ||
    str(record.credentials?.access_token)

  if (!accessToken) return null

  const refreshToken =
    str(record.refreshToken) || str(record.refresh_token) ||
    str(record.tokens?.refresh_token) || str(record.tokens?.refreshToken) ||
    str(record.credentials?.refresh_token)

  const idToken =
    str(record.idToken) || str(record.id_token) ||
    str(record.tokens?.id_token) || str(record.tokens?.idToken) ||
    str(record.credentials?.id_token)

  const sessionToken =
    str(record.session_token) || str(record.sessionToken) ||
    str(record.tokens?.session_token) || str(record.tokens?.sessionToken)

  const email =
    str(record.user?.email) || str(record.email) ||
    str(record.meta?.label) || str(record.label) ||
    str(record.credentials?.email)

  const accountId =
    str(record.account?.id) || str(record.account_id) ||
    str(record.tokens?.account_id) || str(record.chatgpt_account_id) ||
    str(record.providerSpecificData?.chatgptAccountId)

  // Try to extract from JWT
  const payload = parseJwtPayload(accessToken)
  const auth = (payload?.["https://api.openai.com/auth"] || {}) as Record<string, any>
  const profile = (payload?.["https://api.openai.com/profile"] || {}) as Record<string, any>

  const plan =
    str(record.account?.planType) || str(record.plan_type) ||
    str(record.providerSpecificData?.chatgptPlanType) ||
    str(auth.chatgpt_plan_type) ||
    str(record.chatgpt_plan_type)

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    session_token: sessionToken,
    id_token: idToken,
    email: email || str(profile.email) || str(payload?.email as string),
    account_id: accountId || str(auth.chatgpt_account_id),
    plan,
  }
}

// ── Dashboard Component ─────────────────────────────────────────────────────
export function DashboardOverlay() {
  const sdk = useServerSDK()
  const [activeTab, setActiveTab] = createSignal<"google" | "codex" | "usage">("google")
  const [googleCreds, setGoogleCreds] = createSignal<any[]>([])
  const [codexCreds, setCodexCreds] = createSignal<any[]>([])
  const [position, setPosition] = createSignal({ x: 150, y: 100 })
  const [refreshTokenInput, setRefreshTokenInput] = createSignal("")
  const [codexImportStatus, setCodexImportStatus] = createSignal("")
  const [isMigrating, setIsMigrating] = createSignal(false)

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

  const extractConnections = (res: any): any[] => {
    const info = res?.data?.data ?? res?.data ?? {}
    return (info.connections ?? []).filter((c: any) => c.type === "credential")
  }

  const fetchGoogleCreds = async () => {
    try {
      const res = await sdk().client.v2.integration.get({ integrationID: "google-antigravity" })
      setGoogleCreds(extractConnections(res))
    } catch (e) {
      console.error("Failed to fetch Google creds:", e)
    }
  }

  const fetchCodexCreds = async () => {
    try {
      const res = await sdk().client.v2.integration.get({ integrationID: "codex-openai" })
      setCodexCreds(extractConnections(res))
    } catch (e) {
      console.error("Failed to fetch Codex creds:", e)
    }
  }

  const fetchAllCreds = () => {
    fetchGoogleCreds()
    fetchCodexCreds()
  }

  onMount(() => {
    fetchAllCreds()
    const id = setInterval(fetchAllCreds, 5000)
    return () => clearInterval(id)
  })

  // ── Google: Add account via refresh token ──
  const addGoogleAccount = async () => {
    const token = refreshTokenInput().trim()
    if (!token) return
    try {
      await sdk().client.v2.integration.connect.key({
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

  // ── Google: Migrate legacy accounts ──
  const migrateLegacyAccounts = async () => {
    setIsMigrating(true)
    try {
      let migrated = 0

      // Try env-based migration (legacy credentials can't be read via HTTP API - only id+label are exposed)
      const envTokens = (import.meta as any).env?.VITE_MIGRATE_TOKENS
      if (envTokens) {
        const userTokens = JSON.parse(envTokens)
        for (const user of userTokens) {
          const exists = googleCreds().some((c: any) => c.label === user.email)
          if (!exists) {
            await sdk().client.v2.integration.connect.key({
              integrationID: "google-antigravity",
              label: user.email,
              key: user.token,
            })
            migrated++
          }
        }
      }

      if (migrated > 0) {
        alert(`Migrated ${migrated} accounts!`)
      } else {
        alert("No legacy accounts found to migrate. Use 'Add via Refresh Token' to add accounts manually.")
      }
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to migrate", e)
      alert("Migration failed. Check console.")
    } finally {
      setIsMigrating(false)
    }
  }

  // ── Codex: Import from JSON files (cockpit / 9router / codex auth.json / etc.) ──
  const importCodexFromFiles = async () => {
    try {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".json,application/json"
      input.multiple = true
      input.onchange = async () => {
        if (!input.files || input.files.length === 0) return
        setCodexImportStatus("Reading files...")

        let totalImported = 0
        let totalSkipped = 0
        const errors: string[] = []

        for (const file of Array.from(input.files)) {
          try {
            const text = await file.text()
            const parsed = JSON.parse(text)
            const sessions = collectSessionLikeObjects(parsed, file.name)

            // Also try the parsed object directly (single-account format like {type:"codex", access_token, session_token, ...})
            if (sessions.length === 0 && !Array.isArray(parsed)) {
              const direct = convertToCockpitFormat(parsed)
              if (direct) {
                sessions.push({ value: parsed, sourceName: file.name, path: "$" })
              }
            }

            if (sessions.length === 0) {
              errors.push(`${file.name}: No accounts found`)
              continue
            }

            for (const session of sessions) {
              const cockpit = convertToCockpitFormat(session.value)
              if (!cockpit) {
                totalSkipped++
                continue
              }

              // Determine the key to store: prefer refresh_token > session_token > access_token
              const keyToken = cockpit.refresh_token || cockpit.session_token || cockpit.access_token
              if (!keyToken) {
                totalSkipped++
                continue
              }

              // Check for duplicate by label (email)
              const exists = codexCreds().some((c: any) => {
                return c.label === cockpit.email || (cockpit.email && c.label?.includes(cockpit.email))
              })
              if (exists) {
                totalSkipped++
                continue
              }

              // Import as codex-openai credential
              await sdk().client.v2.integration.connect.key({
                integrationID: "codex-openai",
                label: cockpit.email || `Codex (${cockpit.account_id?.substring(0, 8) || "account"}...)`,
                key: keyToken,
              })
              totalImported++
            }
          } catch (e) {
            errors.push(`${file.name}: ${e instanceof Error ? e.message : "Parse error"}`)
          }
        }

        setCodexImportStatus(
          `Imported ${totalImported} account(s)` +
          (totalSkipped > 0 ? `, skipped ${totalSkipped}` : "") +
          (errors.length > 0 ? `. Errors: ${errors.join("; ")}` : ""),
        )
        fetchCodexCreds()
        setTimeout(() => setCodexImportStatus(""), 8000)
      }
      input.click()
    } catch (e) {
      console.error("File import failed", e)
      setCodexImportStatus("File import failed")
    }
  }

  // ── Codex: Remove account ──
  const removeCodexAccount = async (id: string) => {
    try {
      await sdk().client.v2.credential.remove({ credentialID: id })
      fetchCodexCreds()
    } catch (e) {
      console.error("Failed to remove Codex account", e)
    }
  }

  // ── Google: Remove account ──
  const removeGoogleAccount = async (id: string) => {
    try {
      await sdk().client.v2.credential.remove({ credentialID: id })
      fetchGoogleCreds()
    } catch (e) {
      console.error("Failed to remove Google account", e)
    }
  }

  // ── Sidebar tab config ──
  const tabs = [
    { id: "google" as const, label: "Google", color: "text-blue-400", bgActive: "bg-blue-500/10 border-blue-500/30" },
    { id: "codex" as const, label: "Codex", color: "text-emerald-400", bgActive: "bg-emerald-500/10 border-emerald-500/30" },
    { id: "usage" as const, label: "Usage", color: "text-amber-400", bgActive: "bg-amber-500/10 border-amber-500/30" },
  ]

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
      {/* ── Header ── */}
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
          <div class="flex gap-1.5 ml-2">
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/20">
              {googleCreds().length} Google
            </span>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">
              {codexCreds().length} Codex
            </span>
          </div>
        </div>
        <button
          class="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white"
          onClick={() => setDashboardOpen(false)}
        >
          <Icon name="close" size="small" />
        </button>
      </div>

      {/* ── Main Layout ── */}
      <div class="flex flex-row flex-1 min-h-0">
        {/* ── Sidebar ── */}
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
                    background:
                      tab.id === "google" ? "#3b82f6" : tab.id === "codex" ? "#10b981" : "#f59e0b",
                  }}
                />
                <span>{tab.label}</span>
              </button>
            )}
          </For>

          {/* Stats in sidebar */}
          <div class="mt-auto pt-3 flex flex-col gap-2" style={{ "border-top": "1px solid rgba(148, 163, 184, 0.08)" }}>
            <div class="flex flex-col px-2">
              <span class="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Total Accounts</span>
              <span class="text-lg font-black text-white">{googleCreds().length + codexCreds().length}</span>
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div class="flex-1 min-w-0 h-full overflow-y-auto p-5" style={{ background: "rgba(15, 23, 42, 0.3)" }}>
          {/* ═══════════════ GOOGLE TAB ═══════════════ */}
          <Show when={activeTab() === "google"}>
            <div class="flex flex-col gap-4">
              {/* Header */}
              <div class="flex flex-row justify-between items-center pb-3" style={{ "border-bottom": "1px solid rgba(59, 130, 246, 0.2)" }}>
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" style={{ background: "#3b82f6" }} />
                  <h3 class="text-sm font-bold text-white">Google Antigravity</h3>
                </div>
                <button
                  class="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", border: "1px solid rgba(34, 197, 94, 0.2)" }}
                  disabled={isMigrating()}
                  onClick={migrateLegacyAccounts}
                >
                  {isMigrating() ? "Migrating..." : "Migrate Legacy"}
                </button>
              </div>

              {/* Add Account */}
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

              {/* Pool info */}
              <div class="p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.1)", color: "#94a3b8" }}>
                <span class="font-bold text-blue-300">Pool Switch Mechanism:</span> The provider selects accounts per model family (claude / gemini-pro / gemini-flash).
                It uses <span class="text-blue-300">sticky selection</span> (preserves prompt cache) and falls back to
                <span class="text-blue-300"> highest-remaining-quota</span> selection. On HTTP 429, the account gets a 5-min cooldown.
                Accounts with 0% weekly quota are excluded automatically.
              </div>

              {/* Account Cards */}
              <Show
                when={googleCreds().length > 0}
                fallback={
                  <div class="text-xs text-slate-500 mt-2 text-center py-8">No Google Antigravity accounts configured yet.</div>
                }
              >
                <div class="flex flex-col gap-3">
                  <For each={googleCreds()}>
                    {(cred) => (
                      <div class="flex flex-col p-3 rounded-lg gap-2" style={{ background: "rgba(30, 27, 75, 0.4)", border: "1px solid rgba(99, 102, 241, 0.15)" }}>
                        <div class="flex flex-row justify-between items-center">
                          <div class="flex flex-col">
                            <span class="text-xs font-bold text-white">{cred.label || "Unknown account"}</span>
                            <span class="text-[10px] text-slate-500 font-mono">{cred.id.substring(0, 16)}...</span>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80" }}>
                              In Pool
                            </span>
                            <button
                              class="ml-1 p-1 rounded hover:bg-red-500/20 transition-colors text-slate-600 hover:text-red-400"
                              onClick={() => removeGoogleAccount(cred.id)}
                              title="Remove account"
                            >
                              <Icon name="close" size="small" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* ═══════════════ CODEX TAB ═══════════════ */}
          <Show when={activeTab() === "codex"}>
            <div class="flex flex-col gap-4">
              {/* Header */}
              <div class="flex flex-row justify-between items-center pb-3" style={{ "border-bottom": "1px solid rgba(16, 185, 129, 0.2)" }}>
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full" style={{ background: "#10b981" }} />
                  <h3 class="text-sm font-bold text-white">Codex (OpenAI)</h3>
                </div>
                <button
                  class="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)", color: "white" }}
                  onClick={importCodexFromFiles}
                >
                  + Add Accounts (JSON)
                </button>
              </div>

              {/* Import status */}
              <Show when={codexImportStatus()}>
                <div
                  class="px-3 py-2 rounded-lg text-[11px] font-medium"
                  style={{ background: "rgba(16, 185, 129, 0.1)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.2)" }}
                >
                  {codexImportStatus()}
                </div>
              </Show>

              {/* Info box */}
              <div class="p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.12)", color: "#94a3b8" }}>
                <span class="font-bold text-emerald-300">Import from cockpit-tools:</span> Click "Add Accounts" and select one or more JSON files exported from
                Cockpit Tools, 9router, Codex auth.json, AxonHub, CPA, sub2api, or Codex-Manager.
                The <span class="text-emerald-300 font-mono">session_token</span> (or <span class="text-emerald-300 font-mono">refresh_token</span> if available) will be stored as the key for API pool rotation.
              </div>

              {/* Available GPT models */}
              <Show when={codexCreds().length > 0}>
                <div class="p-3 rounded-lg" style={{ background: "rgba(16, 185, 129, 0.04)", border: "1px solid rgba(16, 185, 129, 0.1)" }}>
                  <span class="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Available Models</span>
                  <div class="flex flex-wrap gap-1.5 mt-2">
                    <For each={["GPT-4.1", "GPT-4.1 Mini", "GPT-4.1 Nano", "o3", "o4-mini", "Codex Mini"]}>
                      {(model) => (
                        <span
                          class="px-2 py-1 text-[10px] font-bold rounded-md"
                          style={{ background: "rgba(16, 185, 129, 0.12)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.15)" }}
                        >
                          {model}
                        </span>
                      )}
                    </For>
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-1.5">
                    <span class="text-[9px] text-slate-500">Effort levels: </span>
                    <For each={["low", "medium", "high"]}>
                      {(effort) => (
                        <span
                          class="px-1.5 py-0.5 text-[9px] font-semibold rounded capitalize"
                          style={{
                            background: effort === "low" ? "rgba(59, 130, 246, 0.1)" : effort === "medium" ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
                            color: effort === "low" ? "#60a5fa" : effort === "medium" ? "#fbbf24" : "#f87171",
                          }}
                        >
                          {effort}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Account Cards */}
              <Show
                when={codexCreds().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-12 gap-3">
                    <div class="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.15)" }}>
                      <span class="text-xl">+</span>
                    </div>
                    <span class="text-xs text-slate-500">No Codex accounts yet. Click "Add Accounts" to import.</span>
                  </div>
                }
              >
                <div class="flex flex-col gap-2.5">
                  <For each={codexCreds()}>
                    {(cred) => (
                      <div class="flex flex-col p-3 rounded-lg gap-2" style={{ background: "rgba(16, 185, 129, 0.04)", border: "1px solid rgba(16, 185, 129, 0.12)" }}>
                        <div class="flex flex-row justify-between items-center">
                          <div class="flex flex-col">
                            <span class="text-xs font-bold text-white">{cred.label || "Codex Account"}</span>
                            <span class="text-[9px] text-slate-600 font-mono">{cred.id.substring(0, 16)}...</span>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: "rgba(34, 197, 94, 0.15)", color: "#4ade80" }}>
                              In Pool
                            </span>
                            <button
                              class="ml-1 p-1 rounded hover:bg-red-500/20 transition-colors text-slate-600 hover:text-red-400"
                              onClick={() => removeCodexAccount(cred.id)}
                              title="Remove account"
                            >
                              <Icon name="close" size="small" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
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
                </div>
              </div>

              {/* Summary Cards */}
              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col p-3 rounded-lg" style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.15)" }}>
                  <span class="text-[9px] font-bold text-blue-400 uppercase tracking-wider">Google Accounts</span>
                  <span class="text-xl font-black text-white mt-1">{googleCreds().length}</span>
                </div>
                <div class="flex flex-col p-3 rounded-lg" style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.15)" }}>
                  <span class="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Codex Accounts</span>
                  <span class="text-xl font-black mt-1" style={{ color: "#4ade80" }}>{codexCreds().length}</span>
                </div>
              </div>

              {/* Info */}
              <div class="p-3 rounded-lg text-[11px] leading-relaxed" style={{ background: "rgba(245, 158, 11, 0.06)", border: "1px solid rgba(245, 158, 11, 0.12)", color: "#94a3b8" }}>
                <span class="font-bold text-amber-300">Note:</span> Detailed per-model token usage and quota breakdowns are tracked server-side
                in credential metadata. The dashboard shows account pool counts. Use the Google and Codex tabs to manage accounts.
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
