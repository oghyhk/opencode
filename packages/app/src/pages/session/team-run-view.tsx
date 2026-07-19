import { For, Show, createSignal, createEffect } from "solid-js"
import { useSDK } from "@/context/sdk"

export function TeamRunView() {
  const sdk = useSDK()
  const [runs, setRuns] = createSignal<any[]>([])
  const [tasks, setTasks] = createSignal<any[]>([])
  const [selectedRunID, setSelectedRunID] = createSignal<string>("")

  const fetchRuns = async () => {
    try {
      const res = await (sdk().client as any).team.listRuns()
      if (res.data) {
        setRuns(res.data)
        if (res.data.length > 0 && !selectedRunID()) {
          setSelectedRunID(res.data[0].id)
        }
      }
    } catch {}
  }

  const fetchTasks = async () => {
    const runID = selectedRunID()
    if (!runID) return
    try {
      const res = await (sdk().client as any).team.listTasks({ runID })
      if (res.data) {
        setTasks(res.data)
      }
    } catch {}
  }

  createEffect(() => {
    fetchRuns()
    const id = setInterval(fetchRuns, 5000)
    return () => clearInterval(id)
  })

  createEffect(() => {
    fetchTasks()
    const id = setInterval(fetchTasks, 3000)
    return () => clearInterval(id)
  })

  const cancelRun = async (runID: string) => {
    try {
      await (sdk().client as any).team.cancelRun({ runID })
      fetchRuns()
      fetchTasks()
    } catch (e: any) {
      console.error(e)
    }
  }

  return (
    <div class="flex flex-col h-full bg-v2-background-bg-base overflow-y-auto w-full">
      <div class="p-4 border-b border-v2-border-default shrink-0">
        <h2 class="text-14-medium text-v2-text-primary mb-2">Team Execution Runs</h2>
        <Show when={runs().length > 0} fallback={
          <div class="text-12-regular text-v2-text-tertiary">No active team runs found.</div>
        }>
          <div class="flex flex-col gap-2">
            <For each={runs()}>
              {(run) => (
                <div class={"flex flex-row justify-between items-center p-2 rounded border cursor-pointer " + (
                    selectedRunID() === run.id 
                      ? "bg-v2-background-bg-subtle border-v2-border-strong" 
                      : "bg-v2-background-bg-base border-v2-border-default"
                  )}
                  onClick={() => setSelectedRunID(run.id)}
                >
                  <div class="flex flex-col min-w-0">
                    <span class="text-13-medium text-v2-text-primary truncate">{run.teamName}</span>
                    <span class="text-11-regular text-v2-text-tertiary truncate">{run.status} &middot; {run.id}</span>
                  </div>
                  <Show when={run.status === "running"}>
                    <button 
                      class="shrink-0 ml-2 px-2 py-1 bg-v2-background-bg-base hover:bg-v2-background-bg-subtle text-12-medium text-red-500 rounded border border-v2-border-default transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelRun(run.id)
                      }}
                    >
                      Cancel
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={selectedRunID()}>
        <div class="p-4 flex-1 flex flex-col gap-2 min-h-0">
          <h2 class="text-14-medium text-v2-text-primary mb-2 shrink-0">Task Graph / Statuses</h2>
          <div class="flex flex-col gap-2 overflow-y-auto pr-2 pb-4">
            <For each={tasks()}>
              {(task) => {
                const statusColorClass = 
                  task.status === "accepted" ? "text-green-500 border-green-500" :
                  task.status === "failed" || task.status === "cancelled" ? "text-red-500 border-red-500" :
                  task.status === "running" ? "text-blue-500 border-blue-500" : "text-v2-text-tertiary border-v2-border-default"
                
                const statusTextClass = 
                  task.status === "accepted" ? "text-green-500" :
                  task.status === "failed" || task.status === "cancelled" ? "text-red-500" :
                  task.status === "running" ? "text-blue-500" : "text-v2-text-tertiary"

                return (
                  <div class={"flex flex-col p-3 rounded border-l-4 bg-v2-background-bg-subtle " + statusColorClass}>
                    <div class="flex flex-row justify-between items-start mb-1 gap-4">
                      <span class="text-13-medium text-v2-text-primary break-words">
                        <span class="font-bold">{task.role.toUpperCase()}</span>: {task.description}
                      </span>
                      <span class={"text-12-medium shrink-0 " + statusTextClass}>
                        {task.status.toUpperCase()}
                      </span>
                    </div>
                    <div class="flex flex-col gap-0.5 pl-2 border-l border-v2-border-default ml-1 mt-1">
                      <Show when={task.model}>
                        <span class="text-11-regular text-v2-text-tertiary break-all">
                          Model: {task.model} ({task.contextLimit ? task.contextLimit + " limit" : "auto"})
                        </span>
                      </Show>
                      <Show when={task.workspacePath}>
                        <span class="text-11-regular text-v2-text-tertiary break-all">
                          Workspace: {task.workspacePath}
                        </span>
                      </Show>
                      <Show when={task.dependencies.length > 0}>
                        <span class="text-11-regular text-v2-text-tertiary break-words">
                          Depends on: {task.dependencies.join(", ")}
                        </span>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
