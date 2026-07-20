import { useServerSDK } from "@/context/server-sdk"
import type { SessionUsage } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Match, Show, Switch, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

type Range = "day" | "week" | "month" | "all"

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

        <Switch>
          <Match when={state.status === "error"}>
            <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Icon name="warning" class="text-icon-warning-base" />
              <div class="text-14-medium text-text-strong">Usage could not be loaded</div>
              <Button size="large" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </Match>
          <Match when={state.status !== "error"}>
            <div class="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-weak-base bg-border-weak-base md:grid-cols-4">
              <Metric label="Total processed" value={format(total())} />
              <Metric label="Input" value={format(state.usage.input)} />
              <Metric label="Output" value={format(state.usage.output + state.usage.reasoning)} />
              <Metric label="Cache read" value={format(state.usage.cache.read)} />
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-12-medium uppercase text-text-weak">Models</span>
                <span class="text-12-regular text-text-weak">${state.usage.cost.toFixed(2)}</span>
              </div>
              <Show
                when={state.usage.models.length > 0}
                fallback={
                  <div class="flex min-h-40 flex-1 items-center justify-center rounded-md border border-border-weak-base text-13-regular text-text-weak">
                    {state.status === "loading" ? "Loading usage..." : "No token usage in this period"}
                  </div>
                }
              >
                <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border-weak-base">
                  <For each={state.usage.models}>
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
                              style={{ width: `${Math.max(2, (modelTotal() / max()) * 100)}%` }}
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
      </div>
    </Dialog>
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
