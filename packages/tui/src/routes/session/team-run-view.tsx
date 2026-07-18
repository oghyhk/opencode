import { For, Show, createSignal, createEffect } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useToast } from "../../ui/toast"

export function TeamRunView(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const [runs, setRuns] = createSignal<any[]>([])
  const [tasks, setTasks] = createSignal<any[]>([])
  const [selectedRunID, setSelectedRunID] = createSignal<string>("")

  // Fetch team runs periodically
  const fetchRuns = async () => {
    try {
      const res = await (sdk.client as any).team.listRuns()
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
      const res = await (sdk.client as any).team.listTasks({ runID })
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
      await (sdk.client as any).team.cancelRun({ runID })
      toast.show({ variant: "success", message: "Team run cancelled successfully." })
      fetchRuns()
      fetchTasks()
    } catch (e: any) {
      toast.error(e)
    }
  }

  return (
    <box flexDirection="column" gap={1} height="100%">
      <text fg={theme.text}>
        <b>Team Execution Runs</b>
      </text>

      <Show when={runs().length === 0} fallback={
        <box flexDirection="column" gap={1}>
          <For each={runs()}>
            {(run) => (
              <box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
                padding={1}
                backgroundColor={selectedRunID() === run.id ? theme.backgroundElement : theme.backgroundPanel}
                onMouseUp={() => setSelectedRunID(run.id)}
              >
                <box flexDirection="column">
                  <text fg={theme.text}>{run.teamName}</text>
                  <text fg={theme.textMuted}>{run.status} &middot; {run.id}</text>
                </box>
                <Show when={run.status === "running"}>
                  <box
                    backgroundColor={theme.background}
                    paddingLeft={1}
                    paddingRight={1}
                    onMouseUp={() => cancelRun(run.id)}
                  >
                    <text fg={theme.error}>Cancel</text>
                  </box>
                </Show>
              </box>
            )}
          </For>
        </box>
      }>
        <text fg={theme.textMuted}>No active team runs found.</text>
      </Show>

      <Show when={selectedRunID()}>
        <box flexDirection="column" gap={1} paddingTop={2}>
          <text fg={theme.text}>
            <b>Task Graph / Statuses</b>
          </text>
          <For each={tasks()}>
            {(task) => {
              const statusColor =
                task.status === "accepted"
                  ? theme.success
                  : task.status === "failed" || task.status === "cancelled"
                    ? theme.error
                    : task.status === "running"
                      ? theme.accent
                      : theme.textMuted;

              return (
                <box
                  flexDirection="column"
                  padding={1}
                  border={["left"]}
                  borderColor={statusColor}
                  backgroundColor={theme.backgroundPanel}
                  gap={0.5}
                >
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>{task.role.toUpperCase()}</b>: {task.description}
                    </text>
                    <text fg={statusColor}>
                      <b>{task.status.toUpperCase()}</b>
                    </text>
                  </box>
                  <box flexDirection="column" gap={0.2} paddingLeft={1}>
                    <Show when={task.model}>
                      <text fg={theme.textMuted}>
                        Model: {task.model} ({task.contextLimit ? `${task.contextLimit} limit` : "auto"})
                      </text>
                    </Show>
                    <Show when={task.workspacePath}>
                      <text fg={theme.textMuted}>
                        Workspace: {task.workspacePath}
                      </text>
                    </Show>
                    <Show when={task.dependencies.length > 0}>
                      <text fg={theme.textMuted}>
                        Depends on: {task.dependencies.join(", ")}
                      </text>
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}
