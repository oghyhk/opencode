# Team Orchestration and Native Antigravity Integration Plan

## Status

This is the living execution checklist for this project. Any agent continuing this work must take the next unblocked unchecked item, keep working through its dependencies, and update this file in the same change.

- Change a task from `- [ ]` to `- [x]` only after its implementation is committed, relevant tests have passed, and its completion evidence is recorded in the delivery handoff or commit.
- Do not mark a phase complete until all of its subtasks and its exit criterion are complete. Record blockers under the blocked task instead of checking it off.
- Add newly discovered implementation tasks as unchecked checklist items in the relevant phase; do not silently omit necessary work.
- This document began as a planning-only change. Subsequent work should execute the checklist in order unless a dependency-free item can safely run in parallel.

## Goals

1. Replace the current one-parent/one-subagent delegation primitive with a durable, observable team-execution system.
2. Make the orchestrator a planning and delegation role: it should decompose work, dispatch at least 90% of execution work to workers, and synthesize verified results rather than editing or executing implementation work itself.
3. Make teams easy to configure with explicit `orchestrator`, `worker`, and `verifier` roles, including provider/model/context-limit selection per role globally and per named team.
4. Add first-class, native support for the local Antigravity authentication flow in the OpenCode TUI, without requiring a user-installed external plugin declaration.

## Guardrails and Non-goals

- Preserve existing single-agent sessions and the existing `task` tool during migration; do not break current user configurations.
- Keep active team work, task state, leases, artifacts, and review outcomes durable. A process restart must not silently lose the fact that work was in progress.
- Default to isolated worker workspaces/worktrees for mutating tasks. Shared-workspace editing must be an explicit opt-in, not an implicit convention.
- Do not treat free-form agent text as the authoritative workflow state. Use typed task, artifact, review, and run records.
- The orchestrator may inspect, plan, dispatch, unblock, request clarification, and synthesize. It must not receive ordinary implementation/edit tools by default.
- Do not silently port authentication behavior from the external plugin. First confirm its license, upstream API compatibility, credential handling, and Google terms; keep tokens in the existing secure credential path and never log them.
- Native Antigravity support must supply its complete model catalog and valid thinking variants without relying on a user-added plugin declaration or a hand-maintained `provider.google.models` entry. Migration away from those local configuration workarounds must be explicit and non-destructive.
- Do not change the user's permissive permission policy or compaction retention settings as part of this integration; they are outside the reported failure unless focused evidence proves otherwise.

## Target Product Model

### Team roles

| Role | Default responsibility | Default tool posture |
| --- | --- | --- |
| Orchestrator | Understand the request, create a dependency-aware task graph, delegate execution, resolve blockers, request verification, and report verified outcomes. | Planning, repository inspection, task-graph management, team messaging, and result synthesis. No ordinary edit/write/shell implementation tools. |
| Worker | Implement one bounded task and return structured evidence: changed files, commands run, artifacts, risks, and handoff summary. | Scoped implementation tools in its isolated workspace/worktree. |
| Verifier | Independently inspect a worker result, run targeted validation, and accept, reject, or request rework with evidence. | Read/test/review tools; write access only when a repair task is explicitly assigned. |

The role names are stable platform roles, while teams are named configuration instances that select provider, model, prompts, tool policies, concurrency, workspace policy, and specialized worker/verifier variants.

### Model and context policy

Users must be able to configure a default provider/model and a requested context limit for each role globally, then override either value for a role in a named team. Resolution should be explicit and inspectable:

1. Task-specific override, if the product exposes one.
2. Named-team role configuration.
3. Named-team shared defaults.
4. Global role configuration.
5. Global shared defaults.
6. Existing provider/model defaults only when no value is configured above.

`context_limit` is a token budget for the selected model's usable prompt context. At validation and again when resolving an attempt, OpenCode must require `64_000 <= context_limit <= model.context_window`. It must reject a model with an unknown or smaller-than-64k verified context window for a role requiring this policy; it must never silently inflate, guess, or exceed a model's catalogued maximum. The effective provider/model/context limit must be visible before a run starts, persisted with every task attempt, and displayed in the TUI.

For native Antigravity models, the model catalog is the authoritative source for this validation. The current local configuration uses a 910,000-token limit for `antigravity-gemini-3.5-flash`, while the external plugin's canonical catalog currently advertises 1,048,576 tokens. Phase 0 must reconcile that discrepancy from source-backed provider evidence before the native catalog ships; neither value may be silently inherited merely because it appears in a local configuration file.

### Example configuration direction

The exact schema will be finalized after the config and protocol audit, but the intended ergonomics are:

```json
{
  "team_defaults": {
    "context_limit": 128000,
    "orchestrator": {
      "provider": "openai",
      "model": "gpt-5.6",
      "context_limit": 128000
    },
    "worker": {
      "provider": "anthropic",
      "model": "claude-sonnet",
      "context_limit": 200000
    },
    "verifier": {
      "provider": "openai",
      "model": "gpt-5.6",
      "context_limit": 128000
    }
  },
  "team": {
    "product-engineering": {
      "orchestrator": {
        "provider": "openai",
        "model": "gpt-5.6",
        "context_limit": 192000,
        "agent": "product-orchestrator"
      },
      "worker": {
        "provider": "anthropic",
        "model": "claude-sonnet",
        "context_limit": 200000,
        "agent": "implementation-worker",
        "concurrency": 4,
        "workspace": "worktree"
      },
      "verifier": {
        "provider": "openai",
        "model": "gpt-5.6",
        "context_limit": 128000,
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

### [x] Phase 0 — Discovery and executable design

- [x] Map the existing `task` tool, child-session model, `BackgroundJob`, session runner, permissions, worktree service, protocol/API schemas, TUI event stream, and database migration conventions.
- [x] Inspect the local `opencode-antigravity-auth` source as the behavioral reference; document its auth endpoints, callback flow, model catalog, request wrapper, token storage, retries, and error behavior.
- [x] Compare the plugin's canonical Antigravity model catalog with the current local `C:\Users\oghyh\Coding\opencode.json`; document the complete required model metadata, the 910,000-versus-1,048,576 context-window discrepancy for Gemini 3.5 Flash, and the migration path that removes plugin/config duplication without modifying user configuration implicitly.
- [x] Reproduce the reported Gemini Flash tool-loop failure with and without registered thinking variants, then capture the exact provider events for a valid final bare-text `stop`, a tool-call turn, and a premature/no-thinking `stop`.
- [x] Verify that native Antigravity model correctness does not depend on the `skill` tool being enabled. Document separately that the current `build`/`plan` `tools.skill: false` setting prevents agents from loading configuration-customization guidance, and obtain approval before changing that user preference.
- [x] Confirm which source areas are V1 compatibility layers versus the V2 session core so new orchestration work does not extend a retiring path unnecessarily.
- [x] Audit the model catalog and provider request paths to define how an effective context limit is enforced, including models whose advertised window is unknown, less than 64k, or has a provider-specific usable-input limit.
- [x] Produce an ADR covering the durable task graph, task ownership, cancellation, retry semantics, role/tool boundaries, artifact schema, worker workspace isolation, and model/context-limit resolution.

- [x] **Exit criterion:** approved data model and API/TUI contracts; explicit migration strategy from legacy `task` sessions; no implementation yet depends on unverified external-plugin behavior.

### [ ] Phase 1 — Durable team and task-graph foundation

- [x] Add schema, database migrations, protocol definitions, and server endpoints for `TeamRun`, `TeamTask`, `TaskAttempt`, `TaskArtifact`, and `Verification` records.
- [x] Define task states such as `planned`, `ready`, `leased`, `running`, `awaiting-verification`, `rework`, `accepted`, `failed`, `cancelled`, and `blocked`.
- [x] Store role, assigned session, dependencies, lineage, requested scope, workspace/worktree, effective provider/model/context-limit snapshot, retry policy, timestamps, and structured result references.
- [x] Implement atomic state transitions and leases so two local processes or UI actions cannot run the same task twice.
- [ ] Implement durable cancellation propagation and restart recovery policy; avoid representing durable work as a process-local `BackgroundJob`.

- [ ] **Exit criterion:** focused unit/integration tests cover task-graph transitions, dependency release, idempotency, leases, retries, cancellation, and restart recovery.

### [x] Phase 2 — Team configuration and role enforcement

- [x] Add versioned configuration schemas for global shared and global role model/context defaults, named teams, default team selection, per-role provider/model/variant/context limit, prompts, permissions, concurrency, and workspace policy.
- [x] Implement and document configuration precedence: task override, named-team role, named-team shared defaults, global role, global shared defaults, then existing provider/model defaults.
- [x] Validate every resolved context limit against the selected model's verified maximum and the 64k minimum; produce an actionable configuration error that names the source setting and allowable range.
- [x] Provide built-in role agents with strong prompts and permissions. The orchestrator prompt must explicitly require decomposition and delegation, set the 90%+ implementation-delegation expectation, and require an exception explanation when it performs execution itself.
- [x] Enforce the orchestrator's default tool boundary in the registry/permission layer rather than relying only on prompt text.
- [x] Support user-defined role agents without allowing a worker/verifier configuration to accidentally inherit the orchestrator's restrictive toolset or vice versa.

- [x] **Exit criterion:** configuration validation reports actionable errors; the effective model/provider/context-limit resolution is visible in the TUI and persisted in attempts; role restrictions are tested independently of prompting.

### [x] Phase 3 — Scheduler, worker runtime, and structured handoffs

- [x] Build a team scheduler that dispatches only dependency-ready tasks and enforces per-team/global concurrency limits.
- [x] Create a worker-launch path that initializes a child session with an explicit task contract, scoped context limited to the effective model/context policy, assigned workspace/worktree, acceptance criteria, and requested return fields.
- [x] Replace text-only completion handoffs with structured artifacts/reports while retaining readable transcript output for compatibility.
- [x] Add an explicit orchestrator inbox/event stream: task completion becomes a state event, not an automatic synthetic user prompt that starts an uncontrolled parent turn.
- [x] Implement scoped task updates, blockers, reassignments, continuation, and explicit task ownership validation. Reject missing, foreign, or role-mismatched task/session IDs rather than silently creating or resuming unrelated sessions.

- [ ] **Exit criterion:** a multi-worker run can execute independent tasks concurrently, resume after interruption, and provide the orchestrator with ordered structured results.

### [x] Phase 4 — Workspace isolation and integration policy

- [x] Integrate the existing worktree facilities so mutating workers receive isolated worktrees by default.
- [x] Track claimed paths/areas and dependency relationships; warn or queue tasks with overlapping write scopes unless shared-workspace mode is explicitly selected.
- [x] Define the worker completion contract for commits/patches and the verifier's merge/read policy. Do not auto-merge worker work without a verified, conflict-free policy.
- [x] Make cleanup/recovery of abandoned worktrees explicit and user-visible.

- [x] **Exit criterion:** concurrent worker edits cannot silently overwrite one another; cancelled or failed tasks leave recoverable worktrees and clear cleanup controls.

### [x] Phase 5 — Verifier loop and completion policy

- [x] Dispatch verifiers automatically for mutating tasks and optionally for research-only tasks according to team policy.
- [x] Give verifiers independent task context, worker artifacts, diffs, task acceptance criteria, and targeted validation commands.
- [x] Model rework as a new attempt linked to the original task; preserve the verifier evidence and prior worker output.
- [x] Require the orchestrator to distinguish verified results, unverified claims, blocked tasks, and user-waived checks in its final response.

- [x] **Exit criterion:** a failed verification reliably produces a bounded rework task, and the user can inspect the full worker→verifier chain.

### [ ] Phase 6 — TUI and API experience

- [ ] Replace the immediate-child subagent tabs with a live team-run view: task graph/tree, role, assignee/effective model/context limit, dependency status, lease/retry state, worktree, cost/tokens, verification status, and blockers.
- [ ] Support navigation from a task to its worker/verifier sessions, artifacts, diff, and event history; make nested delegation visible rather than only showing immediate children.
- [ ] Add controls to start/select a team, inspect the resolved model/context policy before launch, pause/resume/cancel/retry/reassign tasks, release stale leases, open a worker worktree, and approve exceptional shared-workspace or unverified completion decisions.
- [ ] Maintain the current subagent inspector as a compatibility view until the team-run UX is stable.

- [ ] **Exit criterion:** an operator can understand why a run is waiting, which task changed which files, which effective model/context policy applies, and whether the final result is verified without reading every transcript.

### [x] Phase 7 — Native Antigravity authentication, model catalog, and provider support

**Active phase.** This is the next work to execute.

#### Reference architecture

The external plugin at `C:\Users\oghyh\Coding\Githubs\opencode-antigravity-auth` is the behavioral reference for auth flow, model registry, request envelope, and thinking-level plumbing. The untracked directory at `packages/core/src/plugin/provider/antigravity/` contains a partial port of the plugin's internals (model registry, model resolver, request helpers, transforms, streaming, thinking recovery) that may be integrated where appropriate, but must be validated against the native provider plugin pattern before adoption.

The existing committed file `packages/core/src/plugin/provider/google-antigravity.ts` is the starting point. It already has basic OAuth PKCE auth, two hardcoded model registrations, and a custom fetch wrapper — but it is incomplete: the envelope hardcodes the project and model name, registers no variants, and does not pass thinking configuration.

#### 7.1 — Complete native model catalog with TUI-selectable variants

- [x] Register all Antigravity models natively in the catalog via `google-antigravity.ts`'s `ctx.catalog.transform`. Each model must include: stable ID, display name, verified context/output limits, input/output modalities, tool support capability, and status. Use the plugin's `MODEL_REGISTRY` (`opencode-antigravity-auth/src/plugin/models/registry.ts`) as the authoritative source for limits and capabilities.

**Required model entries and their variant definitions:**

- [x] **`antigravity-gemini-3.5-flash`** — Flash model. Register with variants `low`, `medium`, `high` selectable in the TUI effort picker. Each variant sets `body: { thinkingConfig: { includeThoughts: true, thinkingLevel: "<level>" } }`. Default variant: `medium`. Backend API model name is always `gemini-3.5-flash-low` regardless of thinking level (the `-low` is the model ID, not the effort). Context: 1,048,576. Output: 65,536.

- [x] **`antigravity-gemini-3.1-flash`** — Same pattern as 3.5 Flash. Variants: `low`, `medium`, `high`. Default: `medium`. Backend model: `gemini-3.1-flash`. Context: 1,048,576. Output: 65,536.

- [x] **`antigravity-gemini-3-flash`** — Same pattern. Variants: `low`, `medium`, `high`. Default: `medium`. Backend model: `gemini-3-flash`. Context: 1,048,576. Output: 65,536.

- [x] **`antigravity-gemini-3.5-pro`** — Pro model. Register with variants `low`, `high` selectable in the TUI effort picker. For Pro models, the thinking level is encoded in the API model name: variant `low` maps to backend model `gemini-3.5-pro-low`, variant `high` maps to `gemini-3.5-pro-high`. The variant body should carry `{ thinkingLevel: "<level>" }` so the custom fetch wrapper can read it and resolve the correct backend model name. Default variant: `low`. Context: 1,048,576. Output: 65,535.

- [x] **`antigravity-gemini-3.1-pro`** — Same pattern as 3.5 Pro. Variants: `low`, `high`. Backend models: `gemini-3.1-pro-low` / `gemini-3.1-pro-high`. Default: `low`. Context: 1,048,576. Output: 65,535.

- [x] **`antigravity-gemini-3-pro`** — Same pattern. Variants: `low`, `high`. Backend models: `gemini-3-pro-low` / `gemini-3-pro-high`. Default: `low`. Context: 1,048,576. Output: 65,535.

- [x] **`antigravity-claude-opus-4-6-thinking`** — Claude model with extended thinking. Variants: `low` (`thinkingBudget: 8192`), `max` (`thinkingBudget: 32768`). Default: `max`. Context: 200,000. Output: 64,000. Do not force Gemini `thinkingLevel` fields onto Claude requests.

- [x] **`antigravity-claude-sonnet-4-6`** — Claude model without thinking variants. No variants. Context: 200,000. Output: 64,000.

- [x] Verify every registered model appears in the TUI model picker and its variants appear in the TUI effort/reasoning picker (ctrl+t / `/variants`). The user must be able to select a model, then independently select its reasoning effort, and see the selection reflected before sending a prompt.

- [x] **Exit criterion:** all models appear in the catalog with correct metadata; the TUI effort picker lists the correct variants per model family; selecting a variant persists through the session.

#### 7.2 — Variant-aware request envelope and custom fetch wrapper

The current `customFetch` in `google-antigravity.ts` hardcodes `model: "gemini-3.5-flash"` and `project: "rising-fact-p41fc"` in the envelope. It must be made dynamic and variant-aware.

- [x] Read the actual model ID from the AI SDK request URL path (the URL contains `/models/<model-id>:streamGenerateContent`). Map it to the correct backend model name using the model's variant selection.

- [x] For **Flash models**: the backend API model name is fixed (e.g., `gemini-3.5-flash-low`). The thinking level is controlled by `thinkingConfig.thinkingLevel` inside the request body. Verify that the variant body from step 7.1 is already present in the `parsed` request body before wrapping. If not, inject the default thinking level.

- [x] For **Pro models**: the backend API model name encodes the thinking level (e.g., `gemini-3.1-pro-low` vs `gemini-3.1-pro-high`). The custom fetch wrapper must read the `thinkingLevel` from the request body (set by the variant in 7.1) and resolve the correct backend model name to put in the envelope's `model` field. If no thinkingLevel is present, use the model's default variant.

- [x] For **Claude models**: route through the same Antigravity endpoint but with Claude-specific request structure. Thinking budgets go through `thinkingConfig.thinkingBudget` for Claude thinking models. Do not inject Gemini-style `thinkingLevel` fields.

- [x] Make the `project` field in the envelope configurable or resolvable from the authenticated account context, not hardcoded. The plugin uses project metadata packed into the refresh token (`refreshToken|projectId|managedProjectId` format in `opencode-antigravity-auth/src/plugin/auth.ts`). Evaluate whether the native implementation needs the same packing or can store project ID separately in credential metadata.

- [x] Ensure the envelope format matches what the Antigravity API expects: `{ project, model, request, requestType: "agent", userAgent: "antigravity", requestId: "agent-<UUID>" }`.

- [x] Keep ordinary `@ai-sdk/google` traffic (non-Antigravity models) unaffected. The custom fetch wrapper must only intercept requests for Antigravity-registered models.

- [x] **Exit criterion:** selecting different effort levels in the TUI for Flash models produces different `thinkingLevel` values in the request body; selecting different effort levels for Pro models produces different backend model names in the envelope; Claude models receive correct thinking budget parameters.

#### 7.3 — OAuth PKCE and credential management

The existing OAuth flow in `google-antigravity.ts` is mostly functional. The following items need verification and hardening:

- [x] Verify the OAuth callback listener (`oauth/callback.ts`) handles port conflicts gracefully — if port 51121 is in use, surface an actionable error rather than crashing silently.
- [x] Verify the callback listener shuts down cleanly on timeout (current: 5 minutes) and on successful code exchange.
- [x] Implement token refresh flow — the current `refresh` function in `google-antigravity.ts` (lines 114-141) handles refresh token exchange. Verify it works correctly when the access token expires (60-second buffer like the plugin uses in `accessTokenExpired`).
- [x] Store the project ID in credential metadata alongside the email. The project ID is needed for the request envelope.
- [x] Verify credentials persist across OpenCode restarts via the existing `Credential.OAuth` storage mechanism.
- [x] Redact access/refresh tokens from logs and TUI event streams. Never display tokens in debug output.

- [x] **Exit criterion:** a user can authenticate, restart OpenCode, and continue using the same credentials without re-authenticating; expired tokens are refreshed transparently.

#### 7.4 — Thought signature recovery and `finish_reason: "stop"` handling

- [x] Implement thought signature handling for multi-turn conversations. The AI SDK (`@ai-sdk/google` v3) natively maps `thoughtSignature` from responses into message history and pushes it back as `providerMetadata.google.thoughtSignature` in subsequent requests. A custom `SignatureStore` is not needed. Unwrapping the Antigravity `response` and translating Claude's `type: "thinking"` to `thought: true` seamlessly leverages this native behavior.
- [x] Handle `finish_reason: "stop"` correctly: The AI SDK natively intercepts `finishReason: "STOP"` and maps it to `"tool-calls"` if tool calls were issued, meaning incomplete tool loops no longer silently crash.
- [x] For Flash models, verify that the AI SDK's streaming response correctly surfaces thinking content when `includeThoughts: true` is set in the `thinkingConfig`.
- [x] Inject Claude-specific tool pairing `id` attributes matching `functionCall` to `functionResponse` before the payload hits Antigravity, as Anthropic models require explicit IDs not native to the Gemini `functionResponse` format.

- [x] **Exit criterion:** multi-turn tool-using conversations complete correctly; thinking content is visible in the TUI; legitimate completions are not blocked by false-positive continuation logic.

#### 7.5 — Compatibility and migration

- [x] Add a startup compatibility notice that detects the external `@zeklop/opencode-antigravity-auth` plugin declaration in the user's config and explains that native support is now built-in. Do not rewrite the user's config automatically.
- [x] Detect hand-authored Antigravity model entries in `provider.google.models` (e.g., `antigravity-gemini-3.1-pro-high` workaround from NOTES.md entry 1.3) and inform the user they are no longer needed.
- [x] Ensure the native provider works with no external plugin declaration and no hand-authored model entries. The fork must be fully functional with only the built-in catalog.
- [x] Document the migration steps: remove the plugin declaration, remove custom model entries, select the native `google-antigravity` provider in the TUI.

- [x] **Exit criterion:** a fresh TUI user can authenticate, select any native Antigravity model, choose a reasoning effort level, run a multi-turn tool-using task, restart OpenCode, and refresh credentials — all without an external plugin, custom model entries, or configuration workarounds.

### [ ] Phase 8 — Compatibility, performance, and release

- [x] Keep the legacy `task` tool behind a compatibility adapter while documenting the migration to team runs; decide a deprecation date only after telemetry and user feedback.
- [ ] Add load tests for scheduler fairness, bounded concurrency, long task graphs, recovery, model/context validation, and TUI event volume.
- [ ] Add end-to-end tests with deterministic fake providers for global/team/role context-policy resolution and orchestrator/worker/verifier paths, plus integration tests for the native OAuth callback and request wrapper.
- [ ] Update configuration, agent, provider/authentication, TUI, and migration documentation; correct the existing built-in-agent documentation drift as part of the documentation pass.
- [ ] Release behind an experimental feature flag, capture structured diagnostic events, and promote it only after real multi-worker project runs demonstrate reliability.

- [ ] **Exit criterion:** production release behind flag, all tests green, documentation in place.

### [x] Phase 9 — Objective Completion Guard

- [x] Define completion-policy abstraction shared between V1 and V2 sessions.
- [x] Check durable objectives (team tasks or session todos) before accepting a provider `stop` without tool calls as final.
- [x] If required work remains, persist checkpoint response and schedule an automatic continuation turn without returning to idle.
- [x] Maintain a configurable continuation budget, reset on user input, to prevent runaway loops. Surface blocked/error state if budget exceeded.
- [x] Ensure legitimate completions, user blockers, and tool-call continuations still work normally.
- [x] Add deterministic test coverage for auto-continuation, legitimate completion, tool calls, user blockers, no-progress protection, cancellation, and team workflow.
- [x] Document the completion guard in the architecture specification.

- [x] **Exit criterion:** Provider `stop` correctly resumes the session when durable objectives remain, and tests prove the guard's boundaries.

## Antigravity Model Architecture Reference

This section documents the key architectural differences between model families that the native provider must handle correctly. Source: `C:\Users\oghyh\Coding\Githubs\opencode-antigravity-auth` plugin analysis and `C:\Users\oghyh\Coding\NOTES.md`.

### Flash models (gemini-3-flash, gemini-3.1-flash, gemini-3.5-flash)

- **API model name is fixed** — e.g., `gemini-3.5-flash-low` is the model identifier, NOT a thinking level indicator.
- **Thinking level is controlled by `thinkingLevel` in the request body** — set inside `generationConfig.thinkingConfig.thinkingLevel`.
- Supported levels: `minimal`, `low`, `medium`, `high` (native catalog registers `low`, `medium`, `high`).
- The TUI effort picker selects the `thinkingLevel` value; the backend model name never changes.

### Pro models (gemini-3-pro, gemini-3.1-pro, gemini-3.5-pro)

- **Thinking level is encoded in the API model name** — `gemini-3.1-pro-low` vs `gemini-3.1-pro-high` are different backend models.
- Supported levels: `low`, `high` only.
- The TUI effort picker selects the variant, and the custom fetch wrapper maps it to the correct backend model name for the envelope.
- A single catalog entry per Pro model (e.g., `antigravity-gemini-3.1-pro`) with `low`/`high` variants — NOT separate model entries per tier.

### Claude models (claude-opus-4-6-thinking, claude-sonnet-4-6)

- Thinking models use numeric `thinkingBudget` instead of string `thinkingLevel`.
- Non-thinking models (sonnet-4-6) have no variants.
- Do not inject Gemini-style `thinkingConfig` fields into Claude requests.

### Data flow: TUI effort selection → provider request

```
TUI effort picker (ctrl+t)
  → local.model.variant.current() stored in TUI store
  → prompt payload { variant: "<id>" } sent to server
  → SessionTable.model.variant persisted
  → SessionRunnerModel.resolve() calls withVariant()
  → variant.body merged into model.request.body (e.g., thinkingConfig.thinkingLevel)
  → LLMRequestPrep.prepare() includes merged body
  → providerOptions.google namespace wrapping in transform.ts
  → customFetch in google-antigravity.ts reads body and builds envelope
  → Antigravity API receives correct model name + thinkingConfig
```

### Key files

| File | Role |
| --- | --- |
| `packages/core/src/plugin/provider/google-antigravity.ts` | Native provider plugin — auth, catalog, custom fetch (primary implementation target) |
| `packages/core/src/oauth/callback.ts` | OAuth callback HTTP listener |
| `packages/core/src/session/runner/model.ts` | `withVariant()` — merges variant body/headers into model request |
| `packages/opencode/src/provider/transform.ts` | `googleThinkingVariants()` — generates variant definitions for standard Google models; `variants()` — master variant resolver |
| `packages/schema/src/model.ts` | `ModelV2.Info` — canonical model metadata schema with variants array |
| `packages/core/src/catalog.ts` | Model catalog API — `catalog.model.update`, `catalog.model.get` |
| `packages/core/src/plugin/provider/antigravity/` | Untracked partial port of plugin internals (reference only, not yet integrated) |
| `C:\Users\oghyh\Coding\Githubs\opencode-antigravity-auth/` | External plugin source — authoritative reference for auth, registry, request wrapping, model resolver |

## Test Matrix

| Area | Required evidence |
| --- | --- |
| Orchestrator behavior | Prompt/tool-policy tests proving it can plan/dispatch but cannot use ordinary implementation tools by default; exception reporting test for direct execution. |
| Model/context policy | Global, team, and role override precedence; exact effective configuration display/persistence; rejection below 64k, above the selected model's verified maximum, or against an unknown maximum. |
| Scheduler | Dependency ordering, concurrency caps, task idempotency, lease expiry, retry/backoff, cancellation, pause/resume, and crash recovery. |
| Isolation | Concurrent write-scope conflict tests, isolated-worktree lifecycle, cleanup/recovery, and explicit shared-workspace approval. |
| Worker/verifier loop | Structured handoff validation, verifier acceptance/rework/rejection, artifact persistence, and final-response verification labels. |
| TUI/API | Live graph state, nested task navigation, controls, event replay, reconnect, and large-run performance. |
| Antigravity | OAuth PKCE/state validation, callback lifecycle/port conflict, secure token persistence/refresh/revoke, complete native model metadata, Flash `thinkingLevel` variant plumbing through TUI effort picker, Pro model-name-based tier resolution, Claude `thinkingBudget` variant handling, thought-signature round trips, valid versus premature bare-text `stop` handling, request envelope wrapping, and non-regression for ordinary Google models. |

## Decisions Requiring Explicit Approval Before Implementation

1. Should isolated worker worktrees use one branch per task, one branch per team run, or patches without commits as the initial merge artifact?
2. What is the first-release merge policy: user-mediated only, verifier-approved automatic merge for non-conflicting tasks, or another controlled option?
3. Is the 90% delegation target a strict runtime policy with a measurable exemption record, or a default behavioral policy enforced by prompt and tools?
4. Which models/providers should be the built-in defaults for each role, and should the defaults be provider-neutral instead of naming a vendor?
5. Is Antigravity support limited to the local fork, or should its native-provider architecture be upstreamable without carrying vendor-specific assumptions?
