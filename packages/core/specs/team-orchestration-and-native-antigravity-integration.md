# Team Orchestration and Native Antigravity Integration Design Specification (ADR)

This specification details the discovery, design, data model, and API/TUI contracts for introducing a durable team execution system and native Google Antigravity provider integration into OpenCode.

---

## 1. Discovery and System Mapping

### 1.1 Existing Systems Analysis
- **Task Tool (`packages/opencode/src/tool/task.ts`)**: Currently spins up a child session using the `sessions.create` method and executes the subagent inline. It uses the `BackgroundJob` service to manage execution state.
- **BackgroundJob (`packages/core/src/background-job.ts`)**: Process-local, in-memory Map of active jobs. Process restarts or CLI session restarts cause complete loss of job execution state and interrupt active work.
- **Session Runner (`packages/core/src/session/runner/llm.ts`)**: Manages the multi-turn execution loop by pulling context history, compiling system prompts (incorporating `systemContextRegistry`, `skillGuidance`, and `referenceGuidance`), fetching tools from the registry, calling `LLMClient.stream`, and executing/settling tools via `ToolRegistry.Service`.
- **Worktree Service (`packages/opencode/src/control-plane/adapters/worktree.ts`)**: Manages creating and destroying git worktrees for sessions to prevent mutating active working directory state directly.
- **Database Migrations (`packages/core/src/database/migration.ts`)**: SQL schemas are defined in `src/**/*.sql.ts`. Migrations are generated via `bun run script/migration.ts` using `drizzle-kit` and applied programmatically via `DatabaseMigration.apply` at database initialization.

---

## 2. Google Antigravity Integration Design

### 2.1 Behavior Reference (from `opencode-antigravity-auth`)
- **OAuth Flow**: Standard Google OAuth2 PKCE flow. Needs redirect URI `http://localhost:51121/oauth-callback`. Spins up a local listener on port `51121` to capture authorization code, then exchanges it for a refresh token.
- **Token Storage**: Credentials must be stored securely using the existing `@opencode-ai/core/src/credential.ts` schema (which includes SQLite credential tables).
- **Request Wrapping**: Custom Assist API envelope format (`{project, model, request: geminiPayload}`) sent to `cloudcode-pa.googleapis.com`.
- **Device Fingerprinting**: Randomized user agents and device IDs generated per account.
- **Thinking Recovery**: Handles thought signature caching and injection across multi-turn tool calling. Resolves tool definitions to prevent invalid parameter names.

### 2.2 Model Catalog & Discrepancies
- **Discrepancy**: Global `opencode.json` overrides context limits. The actual context window for `gemini-3.5-flash` is 1,048,576 tokens. The 910k configuration was a local override for buffer safety.
- **Resolution**: Integrate the models directly in the native catalog of the new `google-antigravity` provider with their verified maximum context size (1,048,576 for flash, 2,000,000 for pro) and capabilities explicitly registered (including `tools: true` so they support skills).
- **Model Registry mapping**: Add native Google Antigravity catalog definitions.
- **Flash Thinking Variants**: Flash models support `thinkingLevel: "low" | "medium" | "high"`. By default, we use `"medium"`.

---

## 3. Durable Team & Task-Graph Data Model

To support goal #1 (Durable team execution) and resolve the non-durability of `BackgroundJob`, we will add the following SQLite tables in a new schema file `packages/core/src/team/sql.ts`:

### 3.1 SQLite Tables

#### `team_run`
Tracks a complete multi-agent orchestrator session execution.
- `id`: `text` (primary key, e.g. `tr_...`)
- `session_id`: `text` (foreign key to `session.id`)
- `team_name`: `text` (name of the configured team)
- `status`: `text` (`running`, `completed`, `failed`, `cancelled`)
- `created_at`: `integer`
- `updated_at`: `integer`

#### `team_task`
Tracks a specific unit of work (planned, running, or finished).
- `id`: `text` (primary key, e.g. `tt_...`)
- `run_id`: `text` (foreign key to `team_run.id`)
- `session_id`: `text` (optional, foreign key to child `session.id` when running)
- `description`: `text` (user-visible description)
- `prompt`: `text` (prompt instructions)
- `role`: `text` (`worker` | `verifier`)
- `status`: `text` (`planned`, `ready`, `leased`, `running`, `awaiting-verification`, `rework`, `accepted`, `failed`, `cancelled`, `blocked`)
- `dependencies`: `text` (JSON array of `team_task.id` dependencies)
- `workspace_path`: `text` (git worktree path for isolation)
- `provider`: `text` (resolved provider ID)
- `model`: `text` (resolved model ID)
- `context_limit`: `integer` (resolved context token limit)
- `created_at`: `integer`
- `updated_at`: `integer`

#### `task_attempt`
Tracks execution attempts for tasks (needed for re-runs and reworks).
- `id`: `text` (primary key)
- `task_id`: `text` (foreign key to `team_task.id`)
- `status`: `text` (`running`, `completed`, `failed`)
- `output`: `text` (stored text response)
- `cost`: `real`
- `tokens_input`: `integer`
- `tokens_output`: `integer`
- `created_at`: `integer`
- `completed_at`: `integer`

---

## 4. Precedence of Model & Context Policies
Enforce context limits explicitly during named-team and global overrides configuration:
- Resolves context limits by verifying `64_000 <= context_limit <= model.context_window`.
- Actionable config error is thrown if the selected model context size is smaller than 64k or unknown.

---

## 5. Exit Criteria Reconciliations
- **Migration Strategy**: Legacy `task` subagent launches remain functional. If a team-run is started, a new `TeamRun` record is inserted in the SQLite database and the scheduler manages the lifecycle.
- **License/Safety**: Credentials for the native Antigravity provider are encrypted and managed using the existing `Credential.Service` database model. Tokens are never logged.

## 6. Verification of Skill Tool & Model Correctness
- **Skill Tool Isolation**: Correct execution of Antigravity model requests (formatting, wrapping, signing, and streaming) is entirely handled at the provider/protocol level and is independent of whether the `skill` tool or the `customize-opencode` skill is enabled.
- **TUI Customization Warning**: The local workspace configuration `opencode.json` defines `"tools": { "skill": false }` for both the `build` and `plan` agents. This disables the `skill` tool entirely. When these agents run, they will NOT load or use the `customize-opencode` skill or show it in `<available_skills>`, meaning configuration instructions are omitted. This is a user-level configuration preference; do not alter it without user consent.

## 7. Session V1 Compatibility vs Session V2 Core
- **Session V1 Compatibility (`packages/core/src/v1/session.ts` / `packages/schema/src/v1/session.ts`)**: Retained purely for backward compatibility with older database rows, legacy events, and client integrations.
- **Session V2 Core (`packages/core/src/session.ts` / `packages/core/src/session/*`)**: The active execution model that owns the TUI loop, message projections, database tables (`session_message`, `session_input`), and system context registry. All new Team Orchestration and scheduling logic must integrate directly with the V2 Core and event stream (`packages/core/src/session/runner/llm.ts`), avoiding old V1 structures.

## 8. Model Catalog Context Limit Enforcement
- **Effective Context Limit Resolution**:
  1. Retrieve `context_limit` from team-task attempt, falling back to team definition, global setting, or the model's catalog maximum.
  2. Validate `64_000 <= context_limit <= model.context_window`.
  3. If the model window is unknown or smaller than 64k, reject request immediately.
- **Max Limit Verification**: Verify resolved context size against the verified catalog maximum at preparation time. Under `google-antigravity` provider, Gemini 3.5 Flash's window is explicitly 1,048,576 tokens, and Claude Opus is 200,000 tokens.

## 9. Architecture Decision Record (ADR)

### 9.1 Durable Task Graph and Scheduler
- **Decision**: Task scheduling and dependencies will be stored in SQLite. The scheduler (`TeamScheduler`) will query the database for runnable tasks (status `ready`) and execute them up to the team concurrency limit.
- **Rationale**: Keeps execution robust across restarts and avoids memory leaks.

### 9.2 Task Ownership and Cancellation
- **Decision**: Each running task attempt will be bound to a child session ID. If a task or its parent team run is cancelled, we will recursively locate all descendant sessions/processes and send interrupt/abort signals.
- **Rationale**: Prevents orphaned sub-agents from continuing execution in the background.

### 9.3 Retry Semantics and Backoff
- **Decision**: Failed tasks will retry up to a configured threshold (`max_retries`). A task will back off exponentially on API/Network errors. If it fails due to code validation errors, it will schedule a verifier review for human or subagent intervention.

### 9.4 Role and Tool Boundaries
- **Decision**: Orchestrator, Worker, and Verifier will have strict tool limits:
  - **Orchestrator**: Only gets planning, status, and task tool. Cannot edit, write, or execute shell commands.
  - **Worker**: Scoped write/edit/shell tools restricted to its isolated workspace.
  - **Verifier**: Read-only, grep, glob, and test commands. Write access is blocked unless explicitly overridden.

### 9.5 Worker Workspace Isolation
- **Decision**: By default, each worker runs in a separate git worktree created dynamically using the `WorkspaceV2` and `Worktree` service. This prevents concurrent workers from overwriting or conflicting with each other.

### 9.6 Model and Context-Limit Resolution
- **Decision**: Resolved using a 6-tier precedence list. The computed token size must be verified against the catalog maximum and must never exceed it.


