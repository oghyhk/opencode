export * as TeamService from "."

import { Context, Effect, Layer, Schema, Option } from "effect"
import { Database } from "../database/database"
import { TeamRunTable, TeamTaskTable, TaskAttemptTable, TaskArtifactTable, VerificationTable } from "./sql"
import { Team } from "@opencode-ai/schema/team"
import { eq, and } from "drizzle-orm"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { DateTime } from "effect"
import { SessionV2 } from "../session"

export interface Interface {
  readonly createRun: (input: {
    readonly sessionID: string
    readonly teamName: string
  }) => Effect.Effect<Team.RunInfo>

  readonly getRun: (runID: Team.RunID) => Effect.Effect<Team.RunInfo | undefined>
  readonly getRunBySession: (sessionID: string) => Effect.Effect<Team.RunInfo | undefined>

  readonly listRuns: () => Effect.Effect<Team.RunInfo[]>

  readonly listTasks: (runID: Team.RunID) => Effect.Effect<Team.TaskInfo[]>

  readonly getTask: (runID: Team.RunID, taskID: Team.TaskID) => Effect.Effect<Team.TaskInfo | undefined>
  readonly getTaskBySession: (sessionID: string) => Effect.Effect<Team.TaskInfo | undefined>

  readonly createTask: (input: {
    readonly runID: Team.RunID
    readonly description: string
    readonly prompt: string
    readonly role: "worker" | "verifier"
    readonly dependencies: readonly Team.TaskID[]
    readonly claimedPaths?: readonly string[]
    readonly workspace?: "worktree" | "shared"
    readonly provider?: string
    readonly model?: string
    readonly contextLimit?: number
  }) => Effect.Effect<Team.TaskInfo>

  readonly leaseTask: (taskID: Team.TaskID) => Effect.Effect<Team.TaskInfo | undefined>

  readonly completeTask: (input: {
    readonly taskID: Team.TaskID
    readonly output: string
    readonly cost: number
    readonly tokensInput: number
    readonly tokensOutput: number
    readonly artifacts: readonly { readonly type: string; readonly path: string; readonly content?: string }[]
  }) => Effect.Effect<void>

  readonly failTask: (taskID: Team.TaskID, error: string) => Effect.Effect<void>

  readonly cancelRun: (runID: Team.RunID) => Effect.Effect<void, never, SessionV2.Service>

  readonly cleanAbandonedWorktrees: () => Effect.Effect<readonly string[], never, any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Team") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* EventV2.Service

    const createRun = Effect.fn("TeamService.createRun")(function* (input: {
      readonly sessionID: string
      readonly teamName: string
    }) {
      const id = Team.RunID.make(`tr_${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`)
      const now = Date.now()
      yield* db
        .insert(TeamRunTable)
        .values({
          id,
          session_id: input.sessionID,
          team_name: input.teamName,
          status: "running",
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)

      return {
        id,
        sessionID: Schema.decodeUnknownSync(Team.RunInfo.fields.sessionID)(input.sessionID),
        teamName: input.teamName,
        status: "running" as const,
        timeCreated: DateTime.makeUnsafe(now),
        timeUpdated: DateTime.makeUnsafe(now),
      }
    })

    const getRun = Effect.fn("TeamService.getRun")(function* (runID: Team.RunID) {
      const row = yield* db
        .select()
        .from(TeamRunTable)
        .where(eq(TeamRunTable.id, runID))
        .get()
        .pipe(Effect.orDie)

      if (!row) return undefined

      return {
        id: Team.RunID.make(row.id),
        sessionID: Schema.decodeUnknownSync(Team.RunInfo.fields.sessionID)(row.session_id),
        teamName: row.team_name,
        status: row.status as any,
        timeCreated: DateTime.makeUnsafe(row.time_created),
        timeUpdated: DateTime.makeUnsafe(row.time_updated),
      }
    })

    const getRunBySession = Effect.fn("TeamService.getRunBySession")(function* (sessionID: string) {
      const row = yield* db
        .select()
        .from(TeamRunTable)
        .where(eq(TeamRunTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)

      if (!row) return undefined

      return {
        id: Team.RunID.make(row.id),
        sessionID: Schema.decodeUnknownSync(Team.RunInfo.fields.sessionID)(row.session_id),
        teamName: row.team_name,
        status: row.status as Team.RunInfo["status"],
        timeCreated: Schema.decodeUnknownSync(Team.RunInfo.fields.timeCreated)(row.time_created),
        timeUpdated: Schema.decodeUnknownSync(Team.RunInfo.fields.timeUpdated)(row.time_updated),
      }
    })

    const listRuns = Effect.fn("TeamService.listRuns")(function* () {
      const rows = yield* db.select().from(TeamRunTable).all().pipe(Effect.orDie)
      return rows.map((row) => ({
        id: Team.RunID.make(row.id),
        sessionID: Schema.decodeUnknownSync(Team.RunInfo.fields.sessionID)(row.session_id),
        teamName: row.team_name,
        status: row.status as any,
        timeCreated: DateTime.makeUnsafe(row.time_created),
        timeUpdated: DateTime.makeUnsafe(row.time_updated),
      }))
    })

    const listTasks = Effect.fn("TeamService.listTasks")(function* (runID: Team.RunID) {
      const rows = yield* db.select().from(TeamTaskTable).where(eq(TeamTaskTable.run_id, runID)).all().pipe(Effect.orDie)

      return rows.map((row) => ({
        id: Team.TaskID.make(row.id),
        runID: Team.RunID.make(row.run_id),
        sessionID: row.session_id ? Schema.decodeUnknownSync(Team.TaskInfo.fields.sessionID)(row.session_id) : undefined,
        description: row.description,
        prompt: row.prompt,
        role: row.role as any,
        status: row.status as any,
        dependencies: JSON.parse(row.dependencies),
        claimedPaths: row.claimed_paths ? JSON.parse(row.claimed_paths) : [],
        workspace: row.workspace ? row.workspace as any : undefined,
        workspacePath: row.workspace_path || undefined,
        provider: row.provider || undefined,
        model: row.model || undefined,
        contextLimit: row.context_limit || undefined,
        timeCreated: DateTime.makeUnsafe(row.time_created),
        timeUpdated: DateTime.makeUnsafe(row.time_updated),
      }))
    })

    const getTask = Effect.fn("TeamService.getTask")(function* (runID: Team.RunID, taskID: Team.TaskID) {
      const row = yield* db
        .select()
        .from(TeamTaskTable)
        .where(and(eq(TeamTaskTable.run_id, runID), eq(TeamTaskTable.id, taskID)))
        .get()
        .pipe(Effect.orDie)

      if (!row) return undefined

      return {
        id: Team.TaskID.make(row.id),
        runID: Team.RunID.make(row.run_id),
        sessionID: row.session_id ? Schema.decodeUnknownSync(Team.TaskInfo.fields.sessionID)(row.session_id) : undefined,
        description: row.description,
        prompt: row.prompt,
        role: row.role as any,
        status: row.status as any,
        dependencies: JSON.parse(row.dependencies),
        claimedPaths: row.claimed_paths ? JSON.parse(row.claimed_paths) : [],
        workspace: row.workspace ? row.workspace as any : undefined,
        workspacePath: row.workspace_path || undefined,
        provider: row.provider || undefined,
        model: row.model || undefined,
        contextLimit: row.context_limit || undefined,
        timeCreated: DateTime.makeUnsafe(row.time_created),
        timeUpdated: DateTime.makeUnsafe(row.time_updated),
      }
    })

    const getTaskBySession = Effect.fn("TeamService.getTaskBySession")(function* (sessionID: string) {
      const row = yield* db
        .select()
        .from(TeamTaskTable)
        .where(eq(TeamTaskTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)

      if (!row) return undefined

      return {
        id: Team.TaskID.make(row.id),
        runID: Team.RunID.make(row.run_id),
        sessionID: row.session_id ? Schema.decodeUnknownSync(Team.TaskInfo.fields.sessionID)(row.session_id) : undefined,
        description: row.description,
        prompt: row.prompt,
        role: row.role as Team.TaskInfo["role"],
        status: row.status as Team.TaskInfo["status"],
        dependencies: JSON.parse(row.dependencies) as Team.TaskID[],
        claimedPaths: row.claimed_paths ? (JSON.parse(row.claimed_paths) as string[]) : undefined,
        workspace: row.workspace as "worktree" | "shared" | undefined,
        workspacePath: row.workspace_path ?? undefined,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
        contextLimit: row.context_limit ?? undefined,
        timeCreated: Schema.decodeUnknownSync(Team.TaskInfo.fields.timeCreated)(row.time_created),
        timeUpdated: Schema.decodeUnknownSync(Team.TaskInfo.fields.timeUpdated)(row.time_updated),
      }
    })

    const createTask = Effect.fn("TeamService.createTask")(function* (input: {
      readonly runID: Team.RunID
      readonly description: string
      readonly prompt: string
      readonly role: "worker" | "verifier"
      readonly dependencies: readonly Team.TaskID[]
      readonly claimedPaths?: readonly string[]
      readonly workspace?: "worktree" | "shared"
      readonly provider?: string
      readonly model?: string
      readonly contextLimit?: number
    }) {
      const id = Team.TaskID.make(`tt_${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`)
      const now = Date.now()
      yield* db
        .insert(TeamTaskTable)
        .values({
          id,
          run_id: input.runID,
          description: input.description,
          prompt: input.prompt,
          role: input.role,
          status: "planned",
          dependencies: JSON.stringify(input.dependencies),
          claimed_paths: input.claimedPaths ? JSON.stringify(input.claimedPaths) : null,
          workspace: input.workspace || null,
          provider: input.provider,
          model: input.model,
          context_limit: input.contextLimit,
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)

      return {
        id,
        runID: input.runID,
        description: input.description,
        prompt: input.prompt,
        role: input.role,
        status: "planned" as const,
        dependencies: [...input.dependencies],
        claimedPaths: input.claimedPaths ? [...input.claimedPaths] : [],
        workspace: input.workspace,
        provider: input.provider,
        model: input.model,
        contextLimit: input.contextLimit,
        timeCreated: DateTime.makeUnsafe(now),
        timeUpdated: DateTime.makeUnsafe(now),
      }
    })

    const leaseTask = Effect.fn("TeamService.leaseTask")(function* (taskID: Team.TaskID) {
      const now = Date.now()
      // Run inside a database transaction to ensure atomicity of the lease
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const task = yield* tx
              .select()
              .from(TeamTaskTable)
              .where(eq(TeamTaskTable.id, taskID))
              .get()
              .pipe(Effect.orDie)

            if (!task || task.status !== "planned") {
              return undefined
            }

            yield* tx
              .update(TeamTaskTable)
              .set({ status: "leased", time_updated: now })
              .where(eq(TeamTaskTable.id, taskID))
              .run()
              .pipe(Effect.orDie)

            return task
          }),
        )
        .pipe(Effect.orDie)

      if (!result) return undefined

      return {
        id: Team.TaskID.make(result.id),
        runID: Team.RunID.make(result.run_id),
        sessionID: result.session_id ? Schema.decodeUnknownSync(Team.TaskInfo.fields.sessionID)(result.session_id) : undefined,
        description: result.description,
        prompt: result.prompt,
        role: result.role as any,
        status: "leased" as const,
        dependencies: JSON.parse(result.dependencies),
        claimedPaths: result.claimed_paths ? JSON.parse(result.claimed_paths) : [],
        workspace: result.workspace ? result.workspace as any : undefined,
        workspacePath: result.workspace_path || undefined,
        provider: result.provider || undefined,
        model: result.model || undefined,
        contextLimit: result.context_limit || undefined,
        timeCreated: DateTime.makeUnsafe(result.time_created),
        timeUpdated: DateTime.makeUnsafe(now),
      }
    })

    const completeTask = Effect.fn("TeamService.completeTask")(function* (input: {
      readonly taskID: Team.TaskID
      readonly output: string
      readonly cost: number
      readonly tokensInput: number
      readonly tokensOutput: number
      readonly artifacts: readonly { readonly type: string; readonly path: string; readonly content?: string }[]
    }) {
      const now = Date.now()
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            // 1. Update task status to awaiting-verification
            yield* tx
              .update(TeamTaskTable)
              .set({ status: "awaiting-verification", time_updated: now })
              .where(eq(TeamTaskTable.id, input.taskID))
              .run()
              .pipe(Effect.orDie)

            // 2. Insert attempt record
            const attemptID = `ta_${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`
            yield* tx
              .insert(TaskAttemptTable)
              .values({
                id: attemptID,
                task_id: input.taskID,
                status: "completed",
                output: input.output,
                cost: input.cost,
                tokens_input: input.tokensInput,
                tokens_output: input.tokensOutput,
                time_created: now,
                time_completed: now,
              })
              .run()
              .pipe(Effect.orDie)

            // 3. Write artifacts
            for (const artifact of input.artifacts) {
              const artifactID = `art_${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`
              yield* tx
                .insert(TaskArtifactTable)
                .values({
                  id: artifactID,
                  task_id: input.taskID,
                  type: artifact.type,
                  path: artifact.path,
                  content: artifact.content,
                  time_created: now,
                })
                .run()
                .pipe(Effect.orDie)
            }
          }),
        )
        .pipe(Effect.orDie)
    })

    const failTask = Effect.fn("TeamService.failTask")(function* (taskID: Team.TaskID, error: string) {
      const now = Date.now()
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(TeamTaskTable)
              .set({ status: "failed", time_updated: now })
              .where(eq(TeamTaskTable.id, taskID))
              .run()
              .pipe(Effect.orDie)

            const attemptID = `ta_${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`
            yield* tx
              .insert(TaskAttemptTable)
              .values({
                id: attemptID,
                task_id: taskID,
                status: "failed",
                output: error,
                time_created: now,
                time_completed: now,
              })
              .run()
              .pipe(Effect.orDie)
          }),
        )
        .pipe(Effect.orDie)
    })

    const cancelRun = Effect.fn("TeamService.cancelRun")(function* (runID: Team.RunID) {
      const sessionService = yield* SessionV2.Service
      const now = Date.now()
      const runningTasks = yield* db
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

      // Interrupt active session runners for running tasks
      for (const task of runningTasks) {
        if (task.session_id) {
          const sessionID = SessionV2.ID.make(task.session_id)
          yield* sessionService.interrupt(sessionID).pipe(Effect.ignore)
        }
      }

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(TeamRunTable)
              .set({ status: "cancelled", time_updated: now })
              .where(eq(TeamRunTable.id, runID))
              .run()
              .pipe(Effect.orDie)

            yield* tx
              .update(TeamTaskTable)
              .set({ status: "cancelled", time_updated: now })
              .where(
                and(
                  eq(TeamTaskTable.run_id, runID),
                  eq(TeamTaskTable.status, "planned"),
                ),
              )
              .run()
              .pipe(Effect.orDie)

            yield* tx
              .update(TeamTaskTable)
              .set({ status: "cancelled", time_updated: now })
              .where(
                and(
                  eq(TeamTaskTable.run_id, runID),
                  eq(TeamTaskTable.status, "running"),
                ),
              )
              .run()
              .pipe(Effect.orDie)
          }),
        )
        .pipe(Effect.orDie)
    })

    class WorktreeService extends Context.Service<WorktreeService, any>()("@opencode/Worktree") {}

    const cleanAbandonedWorktrees = Effect.fn("TeamService.cleanAbandonedWorktrees")(function* () {
      const opt = yield* Effect.serviceOption(WorktreeService)
      const worktreeService = Option.getOrUndefined(opt) as any

      if (!worktreeService) return []

      const activeTasks = yield* db
        .select()
        .from(TeamTaskTable)
        .where(eq(TeamTaskTable.status, "running"))
        .all()
        .pipe(Effect.orDie)

      const activePaths = new Set(activeTasks.flatMap((t: any) => t.workspace_path ? [t.workspace_path.toLowerCase()] : []))
      const worktrees = yield* (worktreeService.list() as Effect.Effect<any[], any, any>).pipe(Effect.orDie)

      const cleaned: string[] = []
      for (const wt of worktrees) {
        if (!wt.directory) continue
        const dirKey = wt.directory.toLowerCase()
        if (!activePaths.has(dirKey)) {
          yield* (worktreeService.remove({ directory: wt.directory }) as Effect.Effect<any, any, any>).pipe(Effect.ignore)
          cleaned.push(wt.directory)
        }
      }

      return cleaned
    })

    return Service.of({
      createRun,
      getRun,
      getRunBySession,
      listRuns,
      listTasks,
      getTask,
      getTaskBySession,
      createTask,
      leaseTask,
      completeTask,
      failTask,
      cancelRun,
      cleanAbandonedWorktrees,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node],
})
