# Team Orchestration and Native Antigravity Integration Plan

## Status

Planning only. This document defines the target architecture, delivery order, and acceptance criteria. It intentionally makes no runtime, configuration, provider, or TUI changes.

## Goals

1. Replace the current one-parent/one-subagent delegation primitive with a durable, observable team-execution system.
2. Make the orchestrator a planning and delegation role: it should decompose work, dispatch at least 90% of execution work to workers, and synthesize verified results rather than editing or executing implementation work itself.
3. Make teams easy to configure with explicit `orchestrator`, `worker`, and `verifier` roles, including provider/model selection per role and per named team.
4. Add first-class, native support for the local Antigravity authentication flow in the OpenCode TUI, without requiring a user-installed external plugin declaration.

## Guardrails and Non-goals

- Preserve existing single-agent sessions and the existing `task` tool during migration; do not break current user configurations.
- Keep active team work, task state, leases, artifacts, and review outcomes durable. A process restart must not silently lose the fact that work was in progress.
- Default to isolated worker workspaces/worktrees for mutating tasks. Shared-workspace editing must be an explicit opt-in, not an implicit convention.
- Do not treat free-form agent text as the authoritative workflow state. Use typed task, artifact, review, and run records.
- The orchestrator may inspect, plan, dispatch, unblock, request clarification, and synthesize. It must not receive ordinary implementation/edit tools by default.
- Do not silently port authentication behavior from the external plugin. First confirm its license, upstream API compatibility, credential handling, and Google terms; keep tokens in the existing secure credential path and never log them.

## Target Product Model

### Team roles

| Role | Default responsibility | Default tool posture |
| --- | --- | --- |
| Orchestrator | Understand the request, create a dependency-aware task graph, delegate execution, resolve blockers, request verification, and report verified outcomes. | Planning, repository inspection, task-graph management, team messaging, and result synthesis. No ordinary edit/write/shell implementation tools. |
| Worker | Implement one bounded task and return structured evidence: changed files, commands run, artifacts, risks, and handoff summary. | Scoped implementation tools in its isolated workspace/worktree. |
| Verifier | Independently inspect a worker result, run targeted validation, and accept, reject, or request rework with evidence. | Read/test/review tools; write access only when a repair task is explicitly assigned. |

The role names are stable platform roles, while teams are named configuration instances that select provider, model, prompts, tool policies, concurrency, workspace policy, and specialized worker/verifier variants.

### Example configuration direction

The exact schema will be finalized after the config and protocol audit, but the intended ergonomics are:

```json
{
  "team": {
    "product-engineering": {
      "orchestrator": {
        "provider": "openai",
        "model": "gpt-5.6",
        "agent": "product-orchestrator"
      },
      "worker": {
        "provider": "anthropic",
        "model": "claude-sonnet",
        "agent": "implementation-worker",
        "concurrency": 4,
        "workspace": "worktree"
      },
      "verifier": {
        "provider": "openai",
        "model": "gpt-5.6",
        "agent": "change-verifier"
      }
    }
  },
  "default_team": "product-engineering"
}
```

Teams may later support named worker pools (for example `frontend`, `backend`, and `research`), but the first release must make the three core roles reliable before introducing broad specialization.

### Execution lifecycle

1. The user starts a team run by selecting a team or invoking a team-oriented primary agent.
2. The orchestrator admits the user request, creates a typed plan and task graph, marks each task with a role, dependencies, requested files/areas, workspace policy, and completion criteria.
3. The scheduler leases dependency-ready worker tasks subject to the team concurrency limit and workspace/file-conflict policy.
4. Each worker runs in a dedicated child session plus an isolated worktree by default, produces durable artifacts and a structured completion report, and never directly causes a parent model turn merely by finishing.
5. The scheduler dispatches a verifier task with the worker report, diff/artifacts, and acceptance criteria. A verifier returns `accepted`, `rework-required`, or `rejected` with evidence.
6. The orchestrator observes state changes, creates follow-up tasks when needed, and only synthesizes a user-facing completion when all required tasks are verified or explicitly waived by the user.
7. On restart, unfinished tasks are recoverable and visibly require resume/release/retry decisions; stale leases are never mistaken for completed work.

## Workstreams and Delivery Order

### Phase 0 — Discovery and executable design

- Map the existing `task` tool, child-session model, `BackgroundJob`, session runner, permissions, worktree service, protocol/API schemas, TUI event stream, and database migration conventions.
- Inspect the local `opencode-antigravity-auth` source as the behavioral reference; document its auth endpoints, callback flow, model catalog, request wrapper, token storage, retries, and error behavior.
- Confirm which source areas are V1 compatibility layers versus the V2 session core so new orchestration work does not extend a retiring path unnecessarily.
- Produce an ADR covering the durable task graph, task ownership, cancellation, retry semantics, role/tool boundaries, artifact schema, and worker workspace isolation.

Exit criteria: approved data model and API/TUI contracts; explicit migration strategy from legacy `task` sessions; no implementation yet depends on unverified external-plugin behavior.

### Phase 1 — Durable team and task-graph foundation

- Add schema, database migrations, protocol definitions, and server endpoints for `TeamRun`, `TeamTask`, `TaskAttempt`, `TaskArtifact`, and `Verification` records.
- Define task states such as `planned`, `ready`, `leased`, `running`, `awaiting-verification`, `rework`, `accepted`, `failed`, `cancelled`, and `blocked`.
- Store role, assigned session, dependencies, lineage, requested scope, workspace/worktree, model/provider snapshot, retry policy, timestamps, and structured result references.
- Implement atomic state transitions and leases so two local processes or UI actions cannot run the same task twice.
- Implement durable cancellation propagation and restart recovery policy; avoid representing durable work as a process-local `BackgroundJob`.

Exit criteria: focused unit/integration tests cover task-graph transitions, dependency release, idempotency, leases, retries, cancellation, and restart recovery.

### Phase 2 — Team configuration and role enforcement

- Add versioned configuration schemas for named teams, default team selection, per-role provider/model/variant, prompts, permissions, concurrency, and workspace policy.
- Resolve configuration precedence clearly: team role settings, referenced agent settings, project configuration, then global defaults.
- Provide built-in role agents with strong prompts and permissions. The orchestrator prompt must explicitly require decomposition and delegation, set the 90%+ implementation-delegation expectation, and require an exception explanation when it performs execution itself.
- Enforce the orchestrator’s default tool boundary in the registry/permission layer rather than relying only on prompt text.
- Support user-defined role agents without allowing a worker/verifier configuration to accidentally inherit the orchestrator’s restrictive toolset or vice versa.

Exit criteria: configuration validation reports actionable errors; model/provider resolution is visible in the TUI and persisted in attempts; role restrictions are tested independently of prompting.

### Phase 3 — Scheduler, worker runtime, and structured handoffs

- Build a team scheduler that dispatches only dependency-ready tasks and enforces per-team/global concurrency limits.
- Create a worker-launch path that initializes a child session with an explicit task contract, scoped context, assigned workspace/worktree, acceptance criteria, and requested return fields.
- Replace text-only completion handoffs with structured artifacts/reports while retaining readable transcript output for compatibility.
- Add an explicit orchestrator inbox/event stream: task completion becomes a state event, not an automatic synthetic user prompt that starts an uncontrolled parent turn.
- Implement scoped task updates, blockers, reassignments, continuation, and explicit task ownership validation. Reject missing, foreign, or role-mismatched task/session IDs rather than silently creating or resuming unrelated sessions.

Exit criteria: a multi-worker run can execute independent tasks concurrently, resume after interruption, and provide the orchestrator with ordered structured results.

### Phase 4 — Workspace isolation and integration policy

- Integrate the existing worktree facilities so mutating workers receive isolated worktrees by default.
- Track claimed paths/areas and dependency relationships; warn or queue tasks with overlapping write scopes unless shared-workspace mode is explicitly selected.
- Define the worker completion contract for commits/patches and the verifier’s merge/read policy. Do not auto-merge worker work without a verified, conflict-free policy.
- Make cleanup/recovery of abandoned worktrees explicit and user-visible.

Exit criteria: concurrent worker edits cannot silently overwrite one another; cancelled or failed tasks leave recoverable worktrees and clear cleanup controls.

### Phase 5 — Verifier loop and completion policy

- Dispatch verifiers automatically for mutating tasks and optionally for research-only tasks according to team policy.
- Give verifiers independent task context, worker artifacts, diffs, task acceptance criteria, and targeted validation commands.
- Model rework as a new attempt linked to the original task; preserve the verifier evidence and prior worker output.
- Require the orchestrator to distinguish verified results, unverified claims, blocked tasks, and user-waived checks in its final response.

Exit criteria: a failed verification reliably produces a bounded rework task, and the user can inspect the full worker→verifier chain.

### Phase 6 — TUI and API experience

- Replace the immediate-child subagent tabs with a live team-run view: task graph/tree, role, assignee/model, dependency status, lease/retry state, worktree, cost/tokens, verification status, and blockers.
- Support navigation from a task to its worker/verifier sessions, artifacts, diff, and event history; make nested delegation visible rather than only showing immediate children.
- Add controls to start/select a team, pause/resume/cancel/retry/reassign tasks, release stale leases, open a worker worktree, and approve exceptional shared-workspace or unverified completion decisions.
- Maintain the current subagent inspector as a compatibility view until the team-run UX is stable.

Exit criteria: an operator can understand why a run is waiting, which task changed which files, and whether the final result is verified without reading every transcript.

### Phase 7 — Native Antigravity authentication and provider support

- Confirm how the current local `opencode-antigravity-auth` plugin implements OAuth PKCE, local callback handling, token refresh, model discovery/catalog, request envelopes, device identity, thinking recovery, and errors.
- Add a native provider/integration registration in the appropriate current provider architecture. The proposed locations in the supplied report (`packages/core/src/integration.ts`, a native provider plugin, and Google request handling) are starting hypotheses; Phase 0 must confirm the exact extension points before code is written.
- Add a `google-antigravity` provider identity and TUI authentication entry. Start the callback listener only for an explicit auth attempt, prefer the requested port 51121 when available, handle port conflicts safely, validate OAuth state/PKCE, time out cleanly, and surface actionable TUI errors.
- Register supported Claude and Gemini Antigravity models with correct capabilities, context limits, costs/unknown-cost semantics, and tool support. Do not claim model properties without source-backed validation.
- Route only Antigravity-model requests through the required request envelope/wrapping and response/thinking recovery. Keep ordinary Google provider traffic unchanged.
- Store credentials through the existing secure auth/credential mechanism, redact sensitive fields from logs/events, and add migration/cleanup behavior for plugin-originated credentials if applicable.

Exit criteria: a fresh TUI user can authenticate, select a native Antigravity model, run a tool-using task, restart OpenCode, and refresh/revoke credentials without an external plugin declaration or secret leakage.

### Phase 8 — Compatibility, performance, and release

- Keep the legacy `task` tool behind a compatibility adapter while documenting the migration to team runs; decide a deprecation date only after telemetry and user feedback.
- Add load tests for scheduler fairness, bounded concurrency, long task graphs, recovery, and TUI event volume.
- Add end-to-end tests with deterministic fake providers for orchestrator/worker/verifier paths, plus integration tests for the native OAuth callback and request wrapper.
- Update configuration, agent, provider/authentication, TUI, and migration documentation; correct the existing built-in-agent documentation drift as part of the documentation pass.
- Release behind an experimental feature flag, capture structured diagnostic events, and promote it only after real multi-worker project runs demonstrate reliability.

## Test Matrix

| Area | Required evidence |
| --- | --- |
| Orchestrator behavior | Prompt/tool-policy tests proving it can plan/dispatch but cannot use ordinary implementation tools by default; exception reporting test for direct execution. |
| Scheduler | Dependency ordering, concurrency caps, task idempotency, lease expiry, retry/backoff, cancellation, pause/resume, and crash recovery. |
| Isolation | Concurrent write-scope conflict tests, isolated-worktree lifecycle, cleanup/recovery, and explicit shared-workspace approval. |
| Worker/verifier loop | Structured handoff validation, verifier acceptance/rework/rejection, artifact persistence, and final-response verification labels. |
| TUI/API | Live graph state, nested task navigation, controls, event replay, reconnect, and large-run performance. |
| Antigravity | OAuth PKCE/state validation, callback lifecycle/port conflict, secure token persistence/refresh/revoke, model catalog, request wrapping, thinking/tool response handling, and non-regression for ordinary Google models. |

## Decisions Requiring Explicit Approval Before Implementation

1. Should isolated worker worktrees use one branch per task, one branch per team run, or patches without commits as the initial merge artifact?
2. What is the first-release merge policy: user-mediated only, verifier-approved automatic merge for non-conflicting tasks, or another controlled option?
3. Is the 90% delegation target a strict runtime policy with a measurable exemption record, or a default behavioral policy enforced by prompt and tools?
4. Which models/providers should be the built-in defaults for each role, and should the defaults be provider-neutral instead of naming a vendor?
5. Is Antigravity support limited to the local fork, or should its native-provider architecture be upstreamable without carrying vendor-specific assumptions?

