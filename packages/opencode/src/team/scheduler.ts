import { Context, Effect, Fiber, Layer, Queue, Schedule, Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { TeamService } from "@opencode-ai/core/team"
import { TaskAttemptTable, TeamRunTable, TeamTaskTable, VerificationTable, TaskArtifactTable } from "@opencode-ai/core/team/sql"
import { Team } from "@opencode-ai/schema/team"
import { eq, and, desc } from "drizzle-orm"
import { SessionV2 } from "@opencode-ai/core/session"
import { resolveRoleConfig } from "./config-resolver"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Config } from "@/config/config"
import { Catalog } from "@opencode-ai/core/catalog"
import { DateTime } from "effect"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { EventV2 } from "@opencode-ai/core/event"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Worktree } from "@/worktree"
import { AppProcess } from "@opencode-ai/core/process"
import { ChildProcess } from "effect/unstable/process"

export interface Interface {
  readonly start: () => Effect.Effect<void, never, Scope.Scope | SessionV2.Service | SessionExecution.Service | EventV2.Service | LocationServiceMap.Service>
  readonly trigger: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/TeamScheduler") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const team = yield* TeamService.Service
    const worktreeService = yield* Worktree.Service
    const appProcess = yield* AppProcess.Service
    const triggerQueue = yield* Queue.unbounded<void>()

    const getReadyTasks = (runID: Team.RunID) =>
      Effect.gen(function* () {
        const tasks = yield* team.listTasks(runID)
        const taskMap = new Map(tasks.map((t) => [t.id, t]))

        return tasks.filter((task) => {
          if (task.status !== "planned") return false
          // Verify dependencies based on role
          return task.dependencies.every((depID) => {
            const dep = taskMap.get(depID)
            if (!dep) return false
            if (task.role === "verifier") {
              return dep.status === "awaiting-verification" || dep.status === "accepted"
            }
            return dep.status === "accepted"
          })
        })
      })

    const hasPathOverlap = (pathsA: readonly string[], pathsB: readonly string[]): boolean => {
      for (const a of pathsA) {
        for (const b of pathsB) {
          if (a === b) return true
          const normA = a.replace(/\\/g, "/").toLowerCase()
          const normB = b.replace(/\\/g, "/").toLowerCase()
          const dirA = normA.endsWith("/") ? normA : normA + "/"
          const dirB = normB.endsWith("/") ? normB : normB + "/"
          if (dirA.startsWith(dirB) || dirB.startsWith(dirA)) return true
        }
      }
      return false
    }

    const runSchedulerIteration = Effect.fn("TeamScheduler.iteration")(function* () {
      yield* team.releaseStaleLeases()
      
      const runs = yield* db.select().from(TeamRunTable).where(eq(TeamRunTable.status, "running")).all().pipe(Effect.orDie)

      for (const runRow of runs) {
        const runID = Team.RunID.make(runRow.id)
        const readyTasks = yield* getReadyTasks(runID)
        if (readyTasks.length === 0) continue

        // Enforce concurrency limit (default 4 for team runs)
        const runningRows = yield* db
          .select()
          .from(TeamTaskTable)
          .where(
            and(
              eq(TeamTaskTable.run_id, runID),
              eq(TeamTaskTable.status, "running"),
            ),
          )
          .all()
          .pipe(Effect.orDie)

        const activeCount = runningRows.length
        const limit = 4 // Default concurrency limit
        const availableSlots = Math.max(0, limit - activeCount)
        if (availableSlots === 0) continue

        // Extract claimed paths of active running tasks
        const activeClaimedPaths = runningRows.flatMap((row) =>
          row.claimed_paths ? (JSON.parse(row.claimed_paths) as string[]) : []
        )

        const toStart: Team.TaskInfo[] = []
        for (const task of readyTasks) {
          if (toStart.length >= availableSlots) break

          const claimed = task.claimedPaths ?? []
          const workspaceMode = task.workspace ?? "worktree"

          // If the task claims files, check for write-scope conflicts
          if (workspaceMode !== "shared" && claimed.length > 0) {
            if (hasPathOverlap(claimed, activeClaimedPaths)) {
              // Path conflict — queue/delay this task
              continue
            }
          }

          toStart.push(task)
        }

        for (const task of toStart) {
          // Atomically lease the task
          const ownerID = crypto.randomUUID()
          const leased = yield* team.leaseTask(task.id, ownerID)
          if (!leased) continue

          // Spawn the task runner as a background fiber
          yield* startTaskRunner(leased, ownerID, runID).pipe(
            Effect.forkScoped,
          )
        }
      }
    })

    const startTaskRunner = (task: Team.TaskInfo, ownerID: string, runID: Team.RunID) =>
      Effect.gen(function* () {
        const sessionService = yield* SessionV2.Service
        const locations = yield* LocationServiceMap.Service
        const now = Date.now()
        // 1. Update status to running
        yield* db
          .update(TeamTaskTable)
          .set({ status: "running", time_updated: now })
          .where(eq(TeamTaskTable.id, task.id))
          .run()
          .pipe(Effect.orDie)

        yield* Effect.logInfo(`Starting team task: ${task.description}`, { taskID: task.id })

        const run = yield* team.getRun(runID)
        const parentID = run?.sessionID

        const parentSession = parentID ? yield* sessionService.get(parentID).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined))) : undefined
        const parentLocationRef = parentSession ? parentSession.location : Location.Ref.make({ directory: process.cwd() as any })
        
        const resolvedConfig = yield* Effect.provide(
          resolveRoleConfig({
            teamName: run?.teamName,
            role: task.role,
            taskOverride: {
              provider: task.provider,
              model: task.model,
              contextLimit: task.contextLimit
            }
          }),
          LocationServiceMap.Service.get(parentLocationRef)
        )

        // Update task with resolved config values
        yield* db
          .update(TeamTaskTable)
          .set({ 
            provider: resolvedConfig.providerID, 
            model: resolvedConfig.modelID, 
            context_limit: resolvedConfig.contextLimit 
          })
          .where(eq(TeamTaskTable.id, task.id))
          .run()
          .pipe(Effect.orDie)

        // Start heartbeat fiber
        const heartbeatFiber = yield* Effect.repeat(
          team.heartbeatTask(task.id, ownerID),
          Schedule.spaced("10 seconds")
        ).pipe(Effect.forkScoped)

        let workspaceDir = process.cwd()
        let hasWorktree = false

        const workspaceMode = task.workspace ?? "worktree"

        // 2. Spawn session and execute prompt
        try {
          if (workspaceMode !== "shared") {
            // Worker runs in an isolated git worktree by default
            const worktreeInfo = yield* worktreeService.makeWorktreeInfo({ name: task.id })
            yield* worktreeService.createFromInfo(worktreeInfo)
            workspaceDir = worktreeInfo.directory
            hasWorktree = true

            // Save worktree path
            yield* db
              .update(TeamTaskTable)
              .set({ workspace_path: workspaceDir, time_updated: Date.now() })
              .where(eq(TeamTaskTable.id, task.id))
              .run()
              .pipe(Effect.orDie)
          }

          // Create child session
          const childSession = yield* sessionService.create({
            parentID,
            agent: AgentV2.ID.make(resolvedConfig.agentName ?? task.role),
            location: { directory: AbsolutePath.make(workspaceDir) },
            model: {
              providerID: resolvedConfig.providerID,
              id: resolvedConfig.modelID
            }
          })

          // Save session ID to task record
          yield* db
            .update(TeamTaskTable)
            .set({ session_id: childSession.id, time_updated: Date.now() })
            .where(eq(TeamTaskTable.id, task.id))
            .run()
            .pipe(Effect.orDie)

          const verifications = yield* db
            .select()
            .from(VerificationTable)
            .where(eq(VerificationTable.task_id, task.id))
            .all()
            .pipe(Effect.orDie)
          
          let taskPrompt = task.prompt
          if (verifications.length > 0) {
            const feedbacks = verifications.map(v => `- [${new Date(v.time_created).toISOString()}] Verifier feedback:\n${v.evidence}`).join("\n\n")
            taskPrompt = `${task.prompt}\n\n--- PREVIOUS REVIEWS ---\n${feedbacks}\n\nPlease address the above feedback.`
          }

          // Run prompt
          yield* sessionService.prompt({
            sessionID: childSession.id,
            prompt: { text: taskPrompt, agents: [] },
          })

          // Wait for session loop to complete
          yield* sessionService.wait(childSession.id)

          // Fetch final output message
          const messages = yield* sessionService.messages({ sessionID: childSession.id, limit: 1 })
          const lastMsg = messages[0]
          const textPart = lastMsg && lastMsg.type === "assistant"
            ? (lastMsg.content.findLast((p) => p.type === "text") as any)
            : undefined
          const outputText = textPart?.text || ""

          // Check if the task was completed by the worker
          const finalTask = yield* db.select().from(TeamTaskTable).where(eq(TeamTaskTable.id, task.id)).get().pipe(Effect.orDie)
          if (!finalTask || (finalTask.status !== "awaiting-verification" && finalTask.status !== "accepted" && finalTask.status !== "planned" && finalTask.status !== "blocked")) {
            // Task didn't complete via the tool contract
            yield* team.failTask({ taskID: task.id, ownerID, error: "Worker session ended before satisfying completion contract." })
            throw new Error("Worker session ended before satisfying completion contract.")
          }

          // Capture git diff if executing inside isolated worktree
          let artifacts: Array<{ type: string; path: string; content?: string }> = []
          if (hasWorktree && workspaceDir) {
            const gitDiff = yield* appProcess.run(
              ChildProcess.make("git", ["diff", "HEAD"], { cwd: workspaceDir, extendEnv: true, stdin: "ignore" })
            ).pipe(Effect.orDie)

            const diffText = gitDiff.stdout.toString("utf8")
            if (diffText.trim().length > 0) {
              artifacts.push({
                type: "diff",
                path: "workspace.diff",
                content: diffText,
              })
            }
          }

          // If verifier, it was completed via the complete-task tool.
          // We just log VerificationTable.
          if (task.role === "verifier") {
            const workerTaskID = task.dependencies[0]
            if (workerTaskID) {
              const isRework = finalTask.status === "planned"
              yield* db
                .insert(VerificationTable)
                .values({
                  id: crypto.randomUUID(),
                  task_id: workerTaskID,
                  status: isRework ? "rework-required" : "accepted",
                  evidence: outputText,
                  time_created: Date.now(),
                })
                .run()
                .pipe(Effect.orDie)

              if (isRework) {
                yield* Effect.logInfo(`Verifier requested rework for task ${workerTaskID}`, { verifierTaskID: task.id })
              } else {
                yield* Effect.logInfo(`Verifier approved task ${workerTaskID}`, { verifierTaskID: task.id })
                // Mark worker task as accepted
                yield* db
                  .update(TeamTaskTable)
                  .set({ status: "accepted", time_updated: Date.now() })
                  .where(eq(TeamTaskTable.id, workerTaskID))
                  .run()
                  .pipe(Effect.orDie)
              }
            }
          } else {
            // For workers, task was already completed by the complete-task tool.
            // We just need to attach artifacts to the latest attempt.
            if (artifacts.length > 0) {
              const latestAttempt = yield* db
                .select()
                .from(TaskAttemptTable)
                .where(eq(TaskAttemptTable.task_id, task.id))
                .orderBy(desc(TaskAttemptTable.time_created))
                .get()
                .pipe(Effect.orDie)
                
              if (latestAttempt) {
                for (const a of artifacts) {
                  yield* db.insert(TaskArtifactTable).values({
                    id: crypto.randomUUID(),
                    task_id: task.id, // Should point to attempt_id, but schema uses task_id
                    type: a.type,
                    path: a.path,
                    content: a.content,
                    time_created: Date.now()
                  }).run().pipe(Effect.orDie)
                }
              }
            }
          }

          // Handle automatic verification dispatch and rework loops
          if (task.role === "worker") {
            const allTasks = yield* team.listTasks(task.runID)
            const hasPendingVerifier = allTasks.some((t) => t.role === "verifier" && t.dependencies.includes(task.id) && t.status !== "accepted" && t.status !== "failed" && t.status !== "cancelled")
            if (!hasPendingVerifier && finalTask.status === "awaiting-verification") {
              yield* team.createTask({
                runID: task.runID,
                description: `Verify task: ${task.description}`,
                prompt: `Please verify the work done for task: ${task.description}\n\nWorker output:\n${outputText}\n\nReview the diff and output to verify correctness. Use the complete-task tool with status 'accepted' to approve, or 'rework' if changes are required.`,
                role: "verifier",
                dependencies: [task.id],
              })
            }
          }

          yield* Effect.logInfo(`Completed team task successfully: ${task.description}`, { taskID: task.id })
            
            // Notify the orchestrator session
            const run = yield* team.getRun(task.runID)
            if (run) {
              const allTasks = yield* team.listTasks(run.id)
              const nonTerminal = allTasks.filter(t => ["planned", "ready", "leased", "running", "awaiting-verification", "rework"].includes(t.status))
              
              const sessionExecution = yield* SessionExecution.Service
              if (nonTerminal.length === 0) {
                const events = yield* EventV2.Service
                yield* events.publish(SessionEvent.Synthetic, {
                  sessionID: run.sessionID,
                  messageID: SessionMessage.ID.create(),
                  text: "All tasks in the team run are now terminal. Please synthesize the final result.",
                  timestamp: yield* DateTime.now,
                })
                yield* sessionExecution.resume(run.sessionID).pipe(Effect.ignore)
              } else {
                yield* sessionExecution.wake(run.sessionID)
              }
            }
          } catch (error) {
            logError(task.id, error)
            yield* team.failTask({ taskID: task.id, ownerID, error: String(error) }).pipe(Effect.ignore)
          } finally {
            // Stop heartbeat
            yield* Fiber.interrupt(heartbeatFiber)
            // Cleanup worktree if task is accepted
            const finalTask = yield* db.select().from(TeamTaskTable).where(eq(TeamTaskTable.id, task.id)).get().pipe(Effect.orDie)
            if (hasWorktree && workspaceDir && finalTask?.status === "accepted") {
              yield* worktreeService.remove({ directory: workspaceDir }).pipe(Effect.ignore)
            }
          // Trigger next iteration immediately
          yield* Queue.offer(triggerQueue, undefined)
        }
      })

    const logError = (taskID: string, error: unknown) => {
      console.error(`[TeamScheduler] Task ${taskID} failed:`, error)
    }

    const start = () =>
      Effect.gen(function* () {
        // Run loop checking trigger queue
        yield* Effect.repeat(
          Queue.take(triggerQueue).pipe(Effect.andThen(runSchedulerIteration())),
          Schedule.spaced("1 seconds"),
        ).pipe(
          Effect.forkScoped,
        )
        // Seed first run
        yield* Queue.offer(triggerQueue, undefined)
      })

    const trigger = () => Queue.offer(triggerQueue, undefined).pipe(Effect.asVoid)

    const result = Service.of({ start, trigger })
    // Start the team scheduler loop in the background, bound to location scope
    yield* start().pipe(Effect.forkScoped)

    return result
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, TeamService.node, SessionV2.node, SessionExecution.node, EventV2.node, Worktree.node, AppProcess.node, LocationServiceMap.node],
})

export * as TeamScheduler from "./scheduler"
