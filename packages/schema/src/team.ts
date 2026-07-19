import { Schema } from "effect"
import { SessionID } from "./session-id"
import { DateTimeUtcFromMillis, optional } from "./schema"

export const RunID = Schema.String.pipe(Schema.brand("TeamRun.ID"))
export type RunID = typeof RunID.Type

export const TaskID = Schema.String.pipe(Schema.brand("TeamTask.ID"))
export type TaskID = typeof TaskID.Type

export const AttemptID = Schema.String.pipe(Schema.brand("TaskAttempt.ID"))
export type AttemptID = typeof AttemptID.Type

export const ArtifactID = Schema.String.pipe(Schema.brand("TaskArtifact.ID"))
export type ArtifactID = typeof ArtifactID.Type

export const VerificationID = Schema.String.pipe(Schema.brand("Verification.ID"))
export type VerificationID = typeof VerificationID.Type

export const RunInfo = Schema.Struct({
  id: RunID,
  sessionID: SessionID,
  teamName: Schema.String,
  status: Schema.Literals(["running", "completed", "failed", "cancelled"]),
  timeCreated: DateTimeUtcFromMillis,
  timeUpdated: DateTimeUtcFromMillis,
}).annotate({ identifier: "TeamRun.Info" })
export interface RunInfo extends Schema.Schema.Type<typeof RunInfo> {}

export const TaskInfo = Schema.Struct({
  id: TaskID,
  runID: RunID,
  sessionID: SessionID.pipe(optional),
  description: Schema.String,
  prompt: Schema.String,
  role: Schema.Literals(["worker", "verifier"]),
  status: Schema.Literals([
    "planned",
    "ready",
    "leased",
    "running",
    "awaiting-verification",
    "rework",
    "accepted",
    "failed",
    "cancelled",
    "blocked",
  ]),
  dependencies: Schema.Array(TaskID),
  claimedPaths: Schema.Array(Schema.String).pipe(optional),
  workspace: Schema.Literals(["worktree", "shared"]).pipe(optional),
  workspacePath: Schema.String.pipe(optional),
  provider: Schema.String.pipe(optional),
  model: Schema.String.pipe(optional),
  contextLimit: Schema.Finite.pipe(optional),
  leaseOwner: Schema.String.pipe(optional),
  leaseExpiresAt: DateTimeUtcFromMillis.pipe(optional),
  timeCreated: DateTimeUtcFromMillis,
  timeUpdated: DateTimeUtcFromMillis,
}).annotate({ identifier: "TeamTask.Info" })
export interface TaskInfo extends Schema.Schema.Type<typeof TaskInfo> {}

export const AttemptInfo = Schema.Struct({
  id: AttemptID,
  taskID: TaskID,
  status: Schema.Literals(["running", "completed", "failed"]),
  output: Schema.String.pipe(optional),
  cost: Schema.Finite,
  tokensInput: Schema.Finite,
  tokensOutput: Schema.Finite,
  timeCreated: DateTimeUtcFromMillis,
  timeCompleted: DateTimeUtcFromMillis.pipe(optional),
}).annotate({ identifier: "TaskAttempt.Info" })
export interface AttemptInfo extends Schema.Schema.Type<typeof AttemptInfo> {}

export const ArtifactInfo = Schema.Struct({
  id: ArtifactID,
  taskID: TaskID,
  type: Schema.String,
  path: Schema.String,
  content: Schema.String.pipe(optional),
  timeCreated: DateTimeUtcFromMillis,
}).annotate({ identifier: "TaskArtifact.Info" })
export interface ArtifactInfo extends Schema.Schema.Type<typeof ArtifactInfo> {}

export const VerificationInfo = Schema.Struct({
  id: VerificationID,
  taskID: TaskID,
  status: Schema.Literals(["accepted", "rework-required", "rejected"]),
  evidence: Schema.String.pipe(optional),
  timeCreated: DateTimeUtcFromMillis,
}).annotate({ identifier: "Verification.Info" })
export interface VerificationInfo extends Schema.Schema.Type<typeof VerificationInfo> {}

export * as Team from "./team"
