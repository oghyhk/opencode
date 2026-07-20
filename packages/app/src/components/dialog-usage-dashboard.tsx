import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLocal } from "@/context/local"
import type { SessionUsage } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

type Range = "day" | "week" | "month" | "all"
type Section = "usage" | "subagents"
type Tier = "fast" | "balanced" | "deep"
type TierProfile = { model?: string; effort?: string }

const tiers: Array<{ id: Tier; label: string; description: string }> = [
  { id: "fast", label: "Fast", description: "Narrow exploration and quick checks" },
  { id: "balanced", label: "Balanced", description: "Routine implementation and debugging" },
  { id: "deep", label: "Deep", description: "Difficult implementation and review" },
]

const ranges: Array<{ value: Range; label: string; duration?: number }> = [
  { value: "day", label: "24 hours", duration: 24 * 60 * 60 * 1000 },
  { value: "week", label: "7 days", duration: 7 * 24 * 60 * 60 * 1000 },
  { value: "month", label: "30 days", duration: 30 * 24 * 60 * 60 * 1000 },
  { value: "all", label: "All time" },
]

const empty: SessionUsage = {
  models: [],
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
  cost: 0,
}

const format = (value: number) =>
  Intl.NumberFormat(undefined, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value)

export function DialogUsageDashboard() {
  const sdk = useServerSDK()
  const [state, setState] = createStore({
    section: "usage" as Section,
    range: "all" as Range,
    status: "loading" as "loading" | "ready" | "error",
    usage: empty,
  })

  const load = async () => {
    setState("status", "loading")
    const range = ranges.find((item) => item.value === state.range)
    const since = range?.duration === undefined ? undefined : Date.now() - range.duration
    await sdk()
      .client.v2.session.usage({ since: since?.toString() })
      .then((response) => {
        const usage = response.data?.data
        if (!usage) throw new Error("Usage response is empty")
        setState("usage", usage)
        setState("status", "ready")
      })
      .catch(() => setState("status", "error"))
  }

  onMount(() => {
    void load()
    const refresh = window.setInterval(() => void load(), 30_000)
    onCleanup(() => window.clearInterval(refresh))
  })

  const total = createMemo(
    () =>
      state.usage.input + state.usage.output + state.usage.reasoning + state.usage.cache.read + state.usage.cache.write,
  )
  const max = createMemo(() =>
    Math.max(
      1,
      ...state.usage.models.map(
        (model) => model.input + model.output + model.reasoning + model.cache.read + model.cache.write,
      ),
    ),
  )

  return (
    <Dialog title="Usage dashboard" size="x-large" transition>
      <div class="flex h-full min-h-0 flex-col gap-5 px-6 pb-6">
        <div class="flex items-center gap-1 border-b border-border-weak-base pb-3">
          <For each={["usage", "subagents"] as Section[]}>
            {(section) => (
              <button
                type="button"
                class="h-7 rounded px-2.5 text-12-medium transition-colors"
                classList={{
                  "bg-background-strong text-text-strong": state.section === section,
                  "text-text-weak hover:text-text-base": state.section !== section,
                }}
                onClick={() => setState("section", section)}
              >
                {section === "usage" ? "Usage" : "Subagents"}
              </button>
            )}
          </For>
        </div>

        <Show when={state.section === "usage"} fallback={<SubagentSettings />}>
          <div class="flex min-h-0 flex-1 flex-col gap-5">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border-weak-base pb-4">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-14-medium text-text-strong">Token usage</span>
                <span class="text-12-regular text-text-weak">Provider-reported usage from persisted sessions</span>
              </div>
              <div class="flex items-center gap-1 rounded-md border border-border-weak-base bg-background-base p-1">
                <For each={ranges}>
                  {(range) => (
                    <button
                      type="button"
                      class="h-7 whitespace-nowrap rounded px-2.5 text-12-medium transition-colors"
                      classList={{
                        "bg-background-strong text-text-strong": state.range === range.value,
                        "text-text-weak hover:text-text-base": state.range !== range.value,
                      }}
                      onClick={() => {
                        if (state.range === range.value) return
                        setState("range", range.value)
                        void load()
                      }}
                    >
                      {range.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <UsageContent state={state} load={load} total={total} max={max} />
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

function UsageContent(props: {
  state: { status: "loading" | "ready" | "error"; usage: SessionUsage }
  load: () => Promise<void>
  total: () => number
  max: () => number
}) {
  return (
    <Switch>
      <Match when={props.state.status === "error"}>
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Icon name="warning" class="text-icon-warning-base" />
          <div class="text-14-medium text-text-strong">Usage could not be loaded</div>
          <Button size="large" onClick={() => void props.load()}>
            Retry
          </Button>
        </div>
      </Match>
      <Match when={props.state.status !== "error"}>
        <div class="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-weak-base bg-border-weak-base md:grid-cols-4">
          <Metric label="Total processed" value={format(props.total())} />
          <Metric label="Input" value={format(props.state.usage.input)} />
          <Metric label="Output" value={format(props.state.usage.output + props.state.usage.reasoning)} />
          <Metric label="Cache read" value={format(props.state.usage.cache.read)} />
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-12-medium uppercase text-text-weak">Models</span>
            <span class="text-12-regular text-text-weak">${props.state.usage.cost.toFixed(2)}</span>
          </div>
          <Show
            when={props.state.usage.models.length > 0}
            fallback={
              <div class="flex min-h-40 flex-1 items-center justify-center rounded-md border border-border-weak-base text-13-regular text-text-weak">
                {props.state.status === "loading" ? "Loading usage..." : "No token usage in this period"}
              </div>
            }
          >
            <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-weak-base">
              <For each={props.state.usage.models}>
                {(model) => {
                  const modelTotal = () =>
                    model.input + model.output + model.reasoning + model.cache.read + model.cache.write
                  return (
                    <div class="flex flex-col gap-2 border-b border-border-weak-base p-3 last:border-b-0">
                      <div class="flex min-w-0 items-start justify-between gap-4">
                        <div class="min-w-0">
                          <div class="truncate text-13-medium text-text-strong">{model.modelID}</div>
                          <div class="truncate text-11-regular text-text-weak">{model.providerID}</div>
                        </div>
                        <div class="shrink-0 text-right">
                          <div class="text-13-medium tabular-nums text-text-strong">{format(modelTotal())}</div>
                          <div class="text-11-regular tabular-nums text-text-weak">${model.cost.toFixed(2)}</div>
                        </div>
                      </div>
                      <div class="h-1 overflow-hidden rounded-sm bg-background-strong">
                        <div
                          class="h-full bg-icon-info-base"
                          style={{ width: `${Math.max(2, (modelTotal() / props.max()) * 100)}%` }}
                        />
                      </div>
                      <div class="flex flex-wrap gap-x-4 gap-y-1 text-11-regular tabular-nums text-text-weak">
                        <span>In {format(model.input)}</span>
                        <span>Out {format(model.output)}</span>
                        <Show when={model.reasoning > 0}>
                          <span>Reasoning {format(model.reasoning)}</span>
                        </Show>
                        <span>Cache {format(model.cache.read)}</span>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  )
}

function SubagentSettings() {
  const local = useLocal()
  const sync = useServerSync()
  const [state, setState] = createStore({
    defaultTier: "balanced" as Tier,
    tiers: {
      fast: {} as TierProfile,
      balanced: {} as TierProfile,
      deep: {} as TierProfile,
    },
    dirty: false,
    status: "ready" as "ready" | "saving" | "error",
  })

  const models = createMemo(() =>
    local.model
      .list()
      .filter((model) => local.model.visible({ providerID: model.provider.id, modelID: model.id }))
      .map((model) => ({
        id: `${model.provider.id}/${model.id}`,
        label: `${model.provider.name} / ${model.name}`,
        variants: Object.keys(model.variants ?? {}),
      })),
  )

  const load = () => {
    const config = sync().data.config.subagents
    setState({
      defaultTier: config?.default_tier ?? "balanced",
      tiers: {
        fast: { ...config?.tiers?.fast },
        balanced: { ...config?.tiers?.balanced },
        deep: { ...config?.tiers?.deep },
      },
      dirty: false,
      status: "ready",
    })
  }

  createEffect(() => {
    sync().data.config.subagents
    if (state.dirty) return
    load()
  })

  const variants = (tier: Tier) => models().find((model) => model.id === state.tiers[tier].model)?.variants ?? []

  const setModel = (tier: Tier, model: string | undefined) => {
    const available = models().find((item) => item.id === model)?.variants ?? []
    const effort = state.tiers[tier].effort
    setState("tiers", tier, {
      model,
      effort: effort && available.includes(effort) ? effort : undefined,
    })
    setState("dirty", true)
  }

  const setEffort = (tier: Tier, effort: string | undefined) => {
    setState("tiers", tier, "effort", effort)
    setState("dirty", true)
  }

  const save = async () => {
    setState("status", "saving")
    try {
      await sync().updateConfig({
        subagents: {
          default_tier: state.defaultTier,
          tiers: {
            fast: state.tiers.fast,
            balanced: state.tiers.balanced,
            deep: state.tiers.deep,
          },
        },
      })
      setState("dirty", false)
      setState("status", "ready")
    } catch {
      setState("status", "error")
    }
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-5">
      <div class="flex flex-col gap-1 border-b border-border-weak-base pb-4">
        <span class="text-14-medium text-text-strong">Subagent compute tiers</span>
        <span class="text-12-regular text-text-weak">
          Choose the model and reasoning effort available to each worker tier.
        </span>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-12-medium uppercase text-text-weak">Default tier</span>
        <div class="flex items-center gap-1 rounded-md border border-border-weak-base bg-background-base p-1">
          <For each={tiers}>
            {(tier) => (
              <button
                type="button"
                class="h-7 rounded px-2.5 text-12-medium transition-colors"
                classList={{
                  "bg-background-strong text-text-strong": state.defaultTier === tier.id,
                  "text-text-weak hover:text-text-base": state.defaultTier !== tier.id,
                }}
                onClick={() => {
                  setState("defaultTier", tier.id)
                  setState("dirty", true)
                }}
              >
                {tier.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-weak-base">
        <For each={tiers}>
          {(tier) => (
            <div class="grid gap-3 border-b border-border-weak-base p-4 last:border-b-0 md:grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,1.7fr)_minmax(9rem,1fr)] md:items-end">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-13-medium text-text-strong">{tier.label}</span>
                <span class="text-11-regular text-text-weak">{tier.description}</span>
              </div>
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-11-medium uppercase text-text-weak">Model</span>
                <select
                  class="h-8 min-w-0 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong outline-none focus:border-border-base"
                  value={state.tiers[tier.id].model ?? ""}
                  onChange={(event) => setModel(tier.id, event.currentTarget.value || undefined)}
                >
                  <option value="">Use role or parent model</option>
                  <For each={models()}>{(model) => <option value={model.id}>{model.label}</option>}</For>
                </select>
              </label>
              <label class="flex min-w-0 flex-col gap-1">
                <span class="text-11-medium uppercase text-text-weak">Effort</span>
                <select
                  class="h-8 min-w-0 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong outline-none disabled:cursor-not-allowed disabled:opacity-50 focus:border-border-base"
                  disabled={!state.tiers[tier.id].model}
                  value={state.tiers[tier.id].effort ?? ""}
                  onChange={(event) => setEffort(tier.id, event.currentTarget.value || undefined)}
                >
                  <option value="">Default</option>
                  <For each={variants(tier.id)}>{(variant) => <option value={variant}>{variant}</option>}</For>
                </select>
              </label>
            </div>
          )}
        </For>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base pt-4">
        <span class="text-12-regular text-text-weak">
          {state.status === "error" ? "Could not save subagent settings" : "Changes apply to new subagent tasks."}
        </span>
        <div class="flex items-center gap-2">
          <Button size="small" variant="secondary" disabled={state.status === "saving" || !state.dirty} onClick={load}>
            Reset
          </Button>
          <Button size="small" disabled={state.status === "saving" || !state.dirty} onClick={() => void save()}>
            {state.status === "saving" ? "Saving..." : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div class="flex min-h-20 flex-col justify-between bg-background-base p-3">
      <span class="text-11-medium uppercase text-text-weak">{props.label}</span>
      <span class="text-20-medium tabular-nums text-text-strong">{props.value}</span>
    </div>
  )
}
