# Subagent Orchestration Plan

Status: planning only. This document does not authorize implementation by itself.

## Goal

Build durable, user-configurable subagent orchestration without introducing a separate team UI or making child sessions look different from normal sessions.

The system must give:

- Users one dashboard section for choosing the model and reasoning effort of three compute tiers.
- Main agents bounded control over when to use fast, balanced, or deep workers.
- Main agents explicit control over continuing, compacting, retargeting, abandoning, replacing, cancelling, and creating one-off subagent sessions.
- Persisted child sessions and durable run/result-delivery state across process restarts.
- Clean context isolation for new workers and explicit continuity only when a persisted child is resumed.
- Hard limits that prevent recursive or accidental token explosions.
- A foundation for a later deterministic workflow mode and an optional Ultra preset.

## Product Decisions

- [ ] Keep agent role and compute tier as separate concepts.
- [ ] Keep roles such as `explore`, `general`, and `reviewer` responsible for instructions, tools, and permissions.
- [ ] Add exactly three compute tiers: `fast`, `balanced`, and `deep`.
- [ ] Let compute tiers select model plus effort, not agent instructions.
- [ ] Let the main agent choose a tier, but never an arbitrary model or effort outside user policy.
- [ ] Make `balanced` the fallback when a task does not provide a tier.
- [ ] Store tier configuration in server-owned global OpenCode configuration, not browser local storage.
- [ ] Use the same enabled and connected model catalog already used by OpenCode's model selector.
- [ ] Apply dashboard tier changes to newly created child sessions only.
- [ ] Snapshot the resolved model, effort, role, and permissions when a child is created.
- [ ] Preserve a resumed child's model and effort for cache continuity.
- [ ] Require explicit compact-and-retarget or abandon-and-replace to change an existing child's compute tier.
- [ ] Keep child sessions as ordinary `session` rows with `parentID`.
- [ ] Keep one-off child transcripts for audit and token usage, then archive them instead of deleting them.
- [ ] Keep default nesting depth at one.
- [ ] Do not restore the old team scheduler, team tables, claimed-path system, or team-specific UI.
- [ ] Do not implement recursive uncapped delegation.
- [ ] Do not implement arbitrary workflow JavaScript in the first orchestration release.
- [ ] Treat a future Ultra control as a bounded preset, not as a prompt that encourages recursive spawning.

## Terminology

- **Role**: Behavioral profile, instructions, permission rules, and available tools.
- **Tier**: User-controlled model and reasoning-effort profile.
- **Child session**: A normal persisted OpenCode session whose `parentID` points to its owning session.
- **Subagent session state**: Durable lifecycle metadata attached to a child session.
- **Run**: One admitted prompt and execution attempt within a child session.
- **Continue**: Add a prompt to an existing active child session.
- **Steer**: Add context to a currently running child at its next safe prompt boundary.
- **Compact**: Summarize and reduce the child's active model context while retaining its durable transcript.
- **Retarget**: Change tier after compaction and before the next provider turn.
- **Abandon**: Mark a child terminal for orchestration, cancel active execution, and reject ordinary continuation.
- **Replace**: Abandon a child and create a fresh child for the new task.
- **One-off**: A fresh child that is automatically marked complete and archived after one task.
- **Persistent child**: A child that remains eligible for later continuation by its owner.

## Current Baseline

- [ ] Confirm `packages/opencode/src/tool/task.ts` remains the active legacy task implementation during phase one.
- [ ] Confirm `task_id` currently reuses an existing session without validating owner, role, or lifecycle.
- [ ] Confirm child sessions already persist through `Session.create({ parentID })`.
- [ ] Confirm `BackgroundJob` remains instance-memory state and does not survive restart.
- [ ] Confirm background completion injection can currently be lost or duplicated around process shutdown.
- [ ] Confirm a running background task can currently be extended in memory by reusing its child session ID.
- [ ] Confirm `subagent_depth` defaults to one.
- [ ] Confirm child permissions are derived from parent permissions and subagent role permissions.
- [ ] Confirm the dashboard currently contains only the token usage view.
- [ ] Confirm current model selection reads enabled, visible models from connected providers.
- [ ] Confirm provider/model variants are the current mechanism used for model-specific effort behavior.
- [ ] Confirm global config writes preserve JSONC formatting through `Config.updateGlobal`.
- [ ] Record exact V1 and V2 ownership boundaries before changing public schemas.
- [ ] Decide whether the first implementation lands on V1 and is migrated, or waits for V2 subagent support to reach `dev`.
- [ ] Prefer one implementation on the runtime that will remain authoritative; avoid maintaining parallel orchestration engines.

## Proposed Configuration

Add one global configuration block with a browser-safe schema and generated config schema support:

```jsonc
{
  "subagents": {
    "default_tier": "balanced",
    "tiers": {
      "fast": {
        "model": "provider/model-id",
        "effort": "low"
      },
      "balanced": {
        "model": "provider/model-id",
        "effort": "medium"
      },
      "deep": {
        "model": "provider/model-id",
        "effort": "high"
      }
    },
    "limits": {
      "max_concurrent": 4,
      "max_total_per_parent_turn": 12
    }
  },
  "subagent_depth": 1
}
```

Configuration rules:

- [ ] Name the public block `subagents`; do not overload existing `agent` role configuration.
- [ ] Define `SubagentTier = fast | balanced | deep` in the canonical schema package.
- [ ] Define each tier as a provider/model reference plus normalized effort.
- [ ] Decide whether the stored model uses `provider/model` string compatibility or structured `{ providerID, modelID }` data.
- [ ] Prefer structured wire contracts and serialize to documented config syntax at the config boundary.
- [ ] Include `variant` only if effort cannot be represented independently for the selected model.
- [ ] Define normalized effort values: `default`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- [ ] Do not show unsupported efforts for a selected model.
- [ ] Do not silently coerce an unsupported effort to another value.
- [ ] Permit `default` when a provider/model has no explicit reasoning-effort controls.
- [ ] Validate that a configured model exists, is enabled, supports tools, and belongs to a connected provider at dispatch time.
- [ ] Keep unavailable persisted selections visible with a warning instead of deleting them.
- [ ] Fall back in a deterministic order when a configured tier is unavailable.
- [ ] Proposed fallback order: selected tier, balanced tier, role-pinned model, parent model.
- [ ] Record fallback reason in run metadata and logs.
- [ ] Never rewrite user configuration merely because a provider is temporarily disconnected.
- [ ] Keep `OPENCODE_CONFIG_CONTENT` and managed configuration precedence intact.
- [ ] Respect managed configuration that locks tier values or limits.
- [ ] Retain shipped top-level `subagent_depth` as the only depth setting.
- [ ] Do not add a second `subagents.limits.max_depth` value.
- [ ] Let any advanced dashboard depth control read and write existing `subagent_depth` atomically with tier settings.
- [ ] Add migration behavior only after confirming whether any fork users have persisted an earlier tier shape.
- [ ] Do not add speculative compatibility code for an unshipped schema.

## Model and Effort Capability Resolution

- [ ] Inventory how current model variants map to reasoning effort for every built-in provider.
- [ ] Inventory provider request fields used for Anthropic thinking, OpenAI reasoning effort, Gemini thinking budget, and compatible providers.
- [ ] Create one shared capability resolver used by config validation, dashboard options, and dispatch.
- [ ] Return exact supported effort IDs and labels for each model.
- [ ] Distinguish an effort control from unrelated variants such as speed, pricing, or context modes.
- [ ] Preserve custom provider-defined variants.
- [ ] Decide whether custom provider effort options require an explicit config annotation.
- [ ] Ensure a model with tools disabled cannot be selected for implementation-capable subagents.
- [ ] Allow read-only roles to use a model with narrower capabilities only if their tool contract supports it.
- [ ] Verify reasoning settings are sent once through the existing provider request path.
- [ ] Verify resumed children preserve the same provider/model/effort prefix where possible.
- [ ] Verify compact-and-retarget starts a new cache lineage intentionally.
- [ ] Add model-catalog refresh handling without resetting unsaved dashboard edits.
- [ ] Add tests for disconnected providers, disabled models, deleted custom models, and unsupported efforts.

## Dashboard Information Architecture

Convert the dashboard from a one-view dialog into two top-level sections:

- **Usage**: Existing token analytics.
- **Subagents**: Tier and orchestration settings.

Dashboard checklist:

- [ ] Preserve the existing dashboard button above Settings.
- [ ] Preserve the existing usage endpoint and usage view behavior.
- [ ] Add a restrained section switcher appropriate for the existing dialog.
- [ ] Keep mobile and desktop layouts usable without horizontal clipping.
- [ ] Do not add Google-account, provider-authentication, or quota-management sections.
- [ ] Do not nest cards inside cards.
- [ ] Use one full-width configuration row for each tier.
- [ ] Label tiers `Fast`, `Balanced`, and `Deep`.
- [ ] Use a model selector based on the existing model-list components and provider grouping.
- [ ] Do not mutate the active chat model when selecting a tier model.
- [ ] Add a dedicated selector state rather than reusing `useLocal().model.current()`.
- [ ] Filter to enabled models from connected providers.
- [ ] Show provider and model names, not raw IDs alone.
- [ ] Preserve search, keyboard navigation, and accessibility behavior from the existing selector.
- [ ] Use an effort menu populated by the capability resolver for the selected model.
- [ ] Disable effort selection until a model is selected.
- [ ] Show `Default` for models without explicit effort controls.
- [ ] Add a compact default-tier segmented control with Fast, Balanced, and Deep.
- [ ] Add numeric controls for maximum concurrent workers and maximum workers per parent turn.
- [ ] Keep depth at one in the primary UI.
- [ ] Place depth changes under an advanced disclosure if exposed at all.
- [ ] Add a reset-to-recommended action.
- [ ] Recommended initial defaults: concurrency 4, total 12, depth 1.
- [ ] Do not guess default models before evaluating the user's connected catalog.
- [ ] Provide an explicit unconfigured/inherit state when no valid model can be recommended.
- [ ] Use one atomic Apply action for all tier changes.
- [ ] Disable Apply while validation is pending or any tier is invalid.
- [ ] Show save failures without discarding edits.
- [ ] Handle external config changes with revision conflict detection.
- [ ] Prompt to reload or overwrite when the server revision changed during editing.
- [ ] Keep the usage auto-refresh timer scoped only to the Usage section or harmless while hidden.
- [ ] Add loading, empty, invalid-selection, disconnected-provider, conflict, and save-error states.
- [ ] Add tooltips for unfamiliar controls and icon-only actions.
- [ ] Add localization keys for every visible label and error.
- [ ] Add focused component tests for tier editing and model/effort dependencies.
- [ ] Add browser tests at desktop and mobile viewport sizes.
- [ ] Verify long provider/model names wrap or truncate without overlapping controls.
- [ ] Verify all controls remain keyboard reachable.

## Dashboard API

- [ ] Add a typed read endpoint for effective global subagent configuration.
- [ ] Add a typed atomic update endpoint for global subagent configuration.
- [ ] Keep config endpoints separate from usage analytics endpoints.
- [ ] Return a config revision or content hash with reads.
- [ ] Require the expected revision on writes to prevent lost updates.
- [ ] Return field-level validation errors for invalid model or effort selections.
- [ ] Return unavailable-model warnings separately from schema errors.
- [ ] Validate limits server-side regardless of UI controls.
- [ ] Define conservative hard ceilings above user-configurable limits.
- [ ] Proposed hard ceilings: concurrency 16, total 100, depth 3.
- [ ] Keep shipped defaults lower than hard ceilings.
- [ ] Write through `Config.updateGlobal` so CLI and desktop share settings.
- [ ] Invalidate relevant config caches after a successful write.
- [ ] Publish a config-updated event so open clients can refresh.
- [ ] Ensure remote server dashboards edit that server's global config, not the local browser's settings.
- [ ] Redact unrelated secrets from config responses.
- [ ] Do not expose the full global config merely to edit subagent settings.
- [ ] Regenerate Protocol, Client, and legacy JavaScript SDK surfaces.
- [ ] Add endpoint authorization and malformed-payload tests.

## Tier Resolution Policy

- [ ] Add optional `tier` to the task invocation contract.
- [ ] Keep `tier` optional for compatibility and resolve omission to `default_tier`.
- [ ] Update task-tool guidance so the main agent chooses tiers intentionally.
- [ ] Recommend Fast for search, inventory, documentation, and narrow read-only checks.
- [ ] Recommend Balanced for routine implementation, tests, and moderate debugging.
- [ ] Recommend Deep for ambiguous architecture, security, difficult debugging, and final adversarial review.
- [ ] Prevent the main agent from supplying a raw model ID or raw effort in task calls.
- [ ] Resolve the tier against the user's effective global config.
- [ ] Resolve the role independently from the tier.
- [ ] Preserve role-specific permission derivation.
- [ ] Snapshot resolved tier, provider, model, effort, role, and fallback reason into durable metadata.
- [ ] Emit the snapshot in task progress metadata for diagnostics.
- [ ] Do not retroactively mutate running children after dashboard changes.
- [ ] Do not silently switch a resumed child to a newly configured tier model.
- [ ] Reject incompatible tier changes on continue with an actionable compact-retarget or replace result.
- [ ] Add deterministic tests for every precedence and fallback branch.

## Main-Agent Tool Contract

Evolve `task` for work submission and add a separate control tool for lifecycle operations.

Proposed task additions:

```ts
{
  description: string
  prompt: string
  subagent_type: string
  tier?: "fast" | "balanced" | "deep"
  task_id?: string
  lifecycle?: "persistent" | "one_off" | "replace"
  background?: boolean
}
```

Proposed control operations:

```ts
{ action: "compact", task_id: string, retarget_tier?: Tier }
{ action: "abandon", task_id: string }
{ action: "cancel", task_id: string }
{ action: "status", task_id: string }
```

Tool checklist:

- [ ] Keep new-task submission in `task`.
- [ ] Keep `task_id` continuation in `task`.
- [ ] Add `tier` with clear descriptions and examples.
- [ ] Add `lifecycle` with `persistent` as default.
- [ ] Define `replace` to require an owned `task_id`.
- [ ] Define `replace` as atomic abandon-old/create-new from the caller's perspective.
- [ ] Define `one_off` as fresh context with automatic terminal lifecycle after result delivery.
- [ ] Add a focused control tool rather than overloading prompt submission with no-prompt actions.
- [ ] Decide the final tool name after checking namespace collisions in V1 and V2.
- [ ] Keep status primarily event-driven; discourage polling in model-facing descriptions.
- [ ] Permit status for recovery and explicit user requests.
- [ ] Include child session ID, lifecycle, role, tier, model, effort, and state in structured outputs.
- [ ] Keep model-facing text concise and machine-readable.
- [ ] Use typed schemas rather than parsing XML-like output for internal state.
- [ ] Retain a readable rendered result for model context.
- [ ] Validate that continued children belong to the requesting parent.
- [ ] Validate that the child role matches the requested role.
- [ ] Validate that the child is not abandoned or one-off-complete.
- [ ] Validate workspace/location ownership before resuming.
- [ ] Validate current permissions before every new run, not only child creation.
- [ ] Prevent one parent from adopting another parent's child by guessing an ID.
- [ ] Add explicit typed failures for not found, wrong owner, wrong role, busy, abandoned, and invalid tier.
- [ ] Add tool-contract tests and generated schema snapshots.

## Child Lifecycle Semantics

### Persistent

- [ ] Create a normal child session with `parentID`.
- [ ] Store lifecycle state as active.
- [ ] Allow later continuation by the owning parent.
- [ ] Preserve child context across continuation.
- [ ] Allow steering while running at safe boundaries.
- [ ] Allow compacting while idle.
- [ ] Allow compact requests while running only as queued safe-boundary operations, or reject in the first release.
- [ ] Prefer rejecting running compaction in the first release for simpler semantics.

### One-Off

- [ ] Always create a fresh child session.
- [ ] Never accept `task_id` with `one_off`.
- [ ] Prevent nested subagents unless explicitly permitted by depth policy.
- [ ] Deliver one result to the parent.
- [ ] Mark lifecycle one-off-complete after delivery.
- [ ] Archive the session after completion.
- [ ] Keep messages, usage, costs, and audit metadata.
- [ ] Reject continuation with a clear result.

### Abandon

- [ ] Verify ownership before abandonment.
- [ ] Interrupt active model execution.
- [ ] Cancel associated background runs.
- [ ] Mark pending inputs and run state consistently.
- [ ] Mark child lifecycle abandoned durably.
- [ ] Prevent future ordinary continuation.
- [ ] Prevent late completion delivery from reviving the parent task.
- [ ] Archive the child by default without deleting it.
- [ ] Make repeated abandon calls idempotent.
- [ ] Define an explicit administrative recovery path rather than silently un-abandoning.

### Replace

- [ ] Abandon the old child first under one durable orchestration transaction.
- [ ] Create a new child with fresh context.
- [ ] Resolve the requested tier using current configuration.
- [ ] Preserve role and requested description unless explicitly changed.
- [ ] Return both old and new child IDs in structured metadata.
- [ ] Ensure late old-child completion cannot be delivered as the replacement's result.

### Compact and Retarget

- [ ] Compact only an owned, active persistent child.
- [ ] Reuse OpenCode's session compaction pipeline rather than inventing a second summarizer.
- [ ] Persist the compaction boundary and summary before changing model settings.
- [ ] Keep the full transcript in storage while reducing selected provider context.
- [ ] If `retarget_tier` is omitted, preserve current tier and model snapshot.
- [ ] If `retarget_tier` is supplied, resolve it after compaction succeeds.
- [ ] Update child model/effort only before the next provider turn.
- [ ] Record old and new tier snapshots in a durable event or run metadata.
- [ ] Reject retarget without successful compaction to avoid mixed-model cache assumptions.
- [ ] Define behavior when the target tier is unavailable before starting compaction.
- [ ] Prefer validating target availability first, then compacting, then atomically retargeting.
- [ ] Add tests proving compact-retarget does not lose durable messages.

## Durable Storage Model

Use ordinary sessions for transcripts and add narrow orchestration metadata rather than reviving the old team subsystem.

- [ ] Add a `subagent_session` table keyed by child session ID.
- [ ] Store parent session ID, role, original tier, current tier, lifecycle, and timestamps.
- [ ] Add lifecycle values `active`, `abandoned`, and `one_off_complete`.
- [ ] Add a `subagent_run` table with one row per child prompt execution.
- [ ] Store run ID, child session ID, parent session ID, parent message ID, and tool call ID.
- [ ] Store the resolved provider, model, effort, tier, and role snapshot.
- [ ] Store run state `admitted`, `running`, `completed`, `error`, `cancelled`, or `interrupted`.
- [ ] Store result-delivery state `pending`, `delivering`, `delivered`, or `suppressed`.
- [ ] Add a unique correlation constraint for parent message ID plus tool call ID.
- [ ] Add indexes for child session, parent session, run state, and pending delivery.
- [ ] Keep result text in the child transcript; store only delivery metadata unless recovery requires a bounded snapshot.
- [ ] Use snake_case Drizzle fields and generated migrations.
- [ ] Keep foreign keys cascading only where deletion semantics are intentional.
- [ ] Never delete a normal session merely because orchestration metadata is cleaned up.
- [ ] Add migration tests from a database with pre-feature child sessions.
- [ ] Treat existing child sessions without extension rows as legacy resumable candidates only after ownership validation.
- [ ] Backfill lazily when a valid legacy child is first continued.

## Durable Run State Machine

- [ ] Define allowed state transitions centrally.
- [ ] Permit `admitted -> running` after durable prompt admission.
- [ ] Permit `running -> completed | error | cancelled | interrupted`.
- [ ] Permit restart recovery from `admitted` without duplicating prompt admission.
- [ ] Do not blindly retry an uncertain provider turn recorded as `running`.
- [ ] Reconcile `running` against the durable transcript before deciding recovery behavior.
- [ ] Mark a run completed when its terminal assistant message is durably projected.
- [ ] Mark unresolved running work interrupted after process loss.
- [ ] Require explicit resume for interrupted uncertain work unless an exact safe boundary is proven.
- [ ] Make every transition conditional on expected current state.
- [ ] Make completion, cancellation, and abandonment idempotent.
- [ ] Record timestamps for admission, start, completion, and delivery.
- [ ] Emit structured events after transaction commit.
- [ ] Add state-machine property tests for illegal and duplicate transitions.

## Restart Recovery and Result Delivery

- [ ] Replace in-memory-only ownership with durable run admission before execution begins.
- [ ] Keep in-memory fibers as execution handles, not as the source of truth.
- [ ] Scan nonterminal runs during server startup.
- [ ] Reconcile each run with child messages and terminal provider output.
- [ ] Mark uncertain work interrupted rather than issuing a duplicate provider request.
- [ ] Resume delivery for completed runs whose delivery state is pending.
- [ ] Suppress delivery for abandoned children and cancelled parent turns.
- [ ] Use correlation IDs so repeated startup scans cannot inject duplicate results.
- [ ] Check parent existence and ownership before delivery.
- [ ] Deliver structured synthetic results only once.
- [ ] Persist delivery completion after parent message projection succeeds.
- [ ] Recover safely if projection succeeds but delivery-state update is interrupted.
- [ ] Detect an already projected correlation ID before retrying delivery.
- [ ] Keep event notifications advisory; derive truth from persisted state.
- [ ] Add restart tests at every transition boundary.
- [ ] Add crash simulations before prompt, during provider work, after completion, during delivery, and after delivery.

## Concurrency, Depth, and Budgets

- [ ] Implement one admission controller shared by foreground and background subagents.
- [ ] Enforce user-configured maximum concurrency per parent session.
- [ ] Enforce maximum total workers admitted per parent assistant turn.
- [ ] Enforce maximum nesting depth from durable ancestry.
- [ ] Reject cycles and malformed ancestry.
- [ ] Count resumed execution against concurrency while it runs.
- [ ] Define whether steering an existing running child consumes a new total-worker slot.
- [ ] Proposed rule: steering does not consume a new slot; a new provider run does.
- [ ] Define whether replace consumes one or two total slots.
- [ ] Proposed rule: only the newly admitted run consumes a slot after old cancellation completes.
- [ ] Use a FIFO queue only if queuing is explicitly added later.
- [ ] Prefer immediate typed limit errors in the first release.
- [ ] Release permits on every success, failure, cancellation, and interruption path.
- [ ] Reconcile leaked permits from durable state after restart.
- [ ] Add stress tests with simultaneous foreground and background submissions.
- [ ] Add tests showing max depth cannot be bypassed through resumed children.
- [ ] Add tests showing one-off children cannot recursively fan out by default.

## Permissions and Safety

- [ ] Preserve parent-to-child permission narrowing.
- [ ] Re-evaluate effective permissions before every continued run.
- [ ] Never let tier choice expand tool permissions.
- [ ] Never let compaction or retargeting expand permissions.
- [ ] Keep `todowrite` and nested `task` denies unless the role explicitly permits them.
- [ ] Keep project and workspace boundaries attached to child ownership.
- [ ] Reject continuation after the parent changes to an incompatible workspace.
- [ ] Cancel active execution before abandonment becomes visible as complete.
- [ ] Sanitize model-facing control output and do not include config secrets.
- [ ] Bound descriptions, prompts, result snapshots, and recovery metadata.
- [ ] Audit lifecycle operations with parent, child, actor, action, and timestamp.
- [ ] Add hostile-ID and cross-parent access tests.

## Context Compaction

- [ ] Locate the authoritative compaction entry point used by normal sessions.
- [ ] Expose a service-level compaction operation independent of UI commands.
- [ ] Require a child to be idle before first-release compaction.
- [ ] Persist a compaction summary as an ordinary child message part.
- [ ] Preserve files, tool outputs, and original messages in durable storage.
- [ ] Build subsequent provider context from the summary and retained tail.
- [ ] Make compaction cancellation safe.
- [ ] Do not mark compaction complete until the summary is durably stored.
- [ ] Return token estimates before and after compaction when available.
- [ ] Record the summarizer model and cost in normal usage accounting.
- [ ] Make repeated compact requests idempotent for the same boundary.
- [ ] Test children containing text, tools, reasoning, attachments, errors, and prior compactions.
- [ ] Test retarget immediately after compaction and after process restart.

## Observability and Usage

- [ ] Keep all child model usage in the canonical message tables.
- [ ] Ensure the existing dashboard usage aggregation automatically includes child runs.
- [ ] Add tier, role, and lifecycle metadata without duplicating token totals.
- [ ] Decide whether the Usage section should later filter by parent versus subagent usage.
- [ ] Defer new charts until tier execution is correct and data is trustworthy.
- [ ] Log dispatch decisions with role, requested tier, resolved tier, model, effort, and fallback.
- [ ] Log lifecycle transitions and recovery outcomes.
- [ ] Never log prompts, credentials, or provider request secrets by default.
- [ ] Add metrics for active runs, queued/admission failures, interrupted runs, and pending deliveries.
- [ ] Add diagnostics for stale unavailable tier configuration.
- [ ] Provide enough structured metadata for support without requiring a team-management UI.

## Future Workflow Mode

Build this only after tier dispatch, lifecycle control, persistence, and recovery are stable.

- [ ] Add a declarative finite workflow graph instead of arbitrary JavaScript initially.
- [ ] Define nodes with ID, role, tier, prompt template, dependencies, permissions, timeout, and output schema.
- [ ] Define graph-level concurrency, total-node, depth, token, cost, and wall-time budgets.
- [ ] Validate acyclic graphs before execution.
- [ ] Reject missing dependencies and duplicate node IDs.
- [ ] Execute independent ready nodes through the same subagent admission controller.
- [ ] Keep intermediate node results outside the parent model context.
- [ ] Pass only explicitly referenced outputs into downstream nodes.
- [ ] Persist graph, node states, resolved tier snapshots, and final synthesis delivery.
- [ ] Resume only nodes at proven safe boundaries after restart.
- [ ] Provide sequential pipeline and bounded parallel fan-out as graph conveniences.
- [ ] Add an explicit verification phase convention without hard-coding every workflow shape.
- [ ] Require a final synthesis node whose bounded output enters the parent context.
- [ ] Keep normal child sessions underneath workflow nodes for audit and usage.
- [ ] Do not add a separate team page or workflow control center in the first release.
- [ ] Expose progress through ordinary task parts and events.
- [ ] Add graph validation, scheduling, failure-policy, cancellation, and recovery tests.

## Future Ultra Preset

- [ ] Treat Ultra as a preset layered over the workflow engine.
- [ ] Set parent reasoning effort to the highest supported value, bounded by the selected parent model.
- [ ] Enable automatic workflow planning for sufficiently complex requests.
- [ ] Let planned nodes choose Fast, Balanced, or Deep only.
- [ ] Require an independent verification node for code-changing workflows.
- [ ] Keep default depth at one even in Ultra.
- [ ] Apply explicit concurrency, total-worker, token, cost, and time caps.
- [ ] Require user confirmation before a projected budget exceeds a configurable threshold.
- [ ] Show the resolved budget before execution without marketing claims.
- [ ] Permit cancellation and durable recovery through the same orchestration state machine.
- [ ] Do not implement Ultra as a system-prompt phrase that encourages unbounded delegation.
- [ ] Do not claim deterministic termination unless graph validation and hard runtime limits enforce it.
- [ ] Defer sandboxed JavaScript workflows until declarative graphs prove insufficient.
- [ ] If scripting is later added, isolate it from filesystem, network, credentials, and process APIs.
- [ ] Add instruction-count, wall-time, output-size, spawn-count, and memory limits to any script runtime.

## Implementation Phases

### Phase 0: Architecture Spikes

- [ ] Map V1 task execution to the V2 durable prompt architecture described in repository guidance.
- [ ] Choose one authoritative implementation path and document why.
- [ ] Prototype effort-capability discovery for representative providers.
- [ ] Verify config round trips for JSON and JSONC.
- [ ] Verify the existing model selector can be reused without mutating chat-local state.
- [ ] Verify normal compaction can target an idle child session through a service boundary.
- [ ] Write short architecture decision records for storage, effort mapping, and restart semantics.
- [ ] Stop the phase if any design requires duplicate V1/V2 state machines.

### Phase 1: Schemas and Configuration

- [ ] Add canonical tier, tier-profile, limits, and effective-config schemas.
- [ ] Add `subagents` to global config validation and generated config schema.
- [ ] Add defaults and hard-limit validation.
- [ ] Implement shared model/effort capability resolution.
- [ ] Implement deterministic tier resolution and fallback reasons.
- [ ] Add config read/update service methods.
- [ ] Add server endpoints and Protocol definitions.
- [ ] Regenerate clients with `bun run generate` from `packages/client`.
- [ ] Regenerate the legacy JavaScript SDK with `packages/sdk/js/script/build.ts`.
- [ ] Add schema, config parser, JSONC patching, endpoint, and resolver tests.
- [ ] Do not alter task execution in this phase.

### Phase 2: Dashboard Configuration

- [ ] Add Usage and Subagents sections to the dashboard.
- [ ] Add isolated tier-editing state.
- [ ] Reuse model catalog search and grouping.
- [ ] Add effort selectors driven by selected-model capabilities.
- [ ] Add default tier and bounded limit controls.
- [ ] Implement revision-aware atomic Apply and Reset actions.
- [ ] Add all loading, warning, conflict, and error states.
- [ ] Add localization and accessibility coverage.
- [ ] Add component and browser tests.
- [ ] Verify desktop and mobile screenshots.
- [ ] Keep this phase configuration-only; no tier dispatch until backend tests are ready.

### Phase 3: Tier-Aware Dispatch

- [ ] Add optional `tier` to task input.
- [ ] Resolve omission to configured default tier.
- [ ] Snapshot the dispatch decision.
- [ ] Preserve role permission behavior.
- [ ] Keep existing foreground behavior working.
- [ ] Keep existing background feature gating until durable jobs replace it.
- [ ] Validate model and effort before child creation.
- [ ] Add clear fallbacks and typed failures.
- [ ] Add integration tests for each tier, each role, and continuation behavior.
- [ ] Release behind one experimental feature flag.

### Phase 4: Durable Lifecycle Storage

- [ ] Add orchestration tables and migrations.
- [ ] Implement child lifecycle and run repositories.
- [ ] Implement ownership and workspace validation.
- [ ] Persist admission before execution.
- [ ] Add idempotent state transitions and correlation IDs.
- [ ] Add persistent, one-off, abandon, cancel, and replace semantics.
- [ ] Preserve old task behavior when the experimental feature is disabled.
- [ ] Add database, service, and tool integration tests.

### Phase 5: Compaction and Retargeting

- [ ] Add the control-tool contract.
- [ ] Implement idle-child compaction through the existing compaction service.
- [ ] Add optional retarget tier.
- [ ] Update the child model snapshot only after successful compaction.
- [ ] Add normal usage accounting for compaction.
- [ ] Add failure, cancellation, unavailable-target, and restart tests.

### Phase 6: Recovery and Delivery

- [ ] Add startup reconciliation for nonterminal runs.
- [ ] Add exactly-once logical result delivery using correlation checks.
- [ ] Suppress obsolete delivery after abandonment or replacement.
- [ ] Add interrupted-run status and explicit resume behavior.
- [ ] Add crash-boundary and restart integration tests.
- [ ] Remove reliance on in-memory state as the source of truth.

### Phase 7: Limits and Hardening

- [ ] Route all subagent starts through one admission controller.
- [ ] Enforce concurrency, per-turn total, and depth limits.
- [ ] Add security, hostile input, race, load, and cancellation tests.
- [ ] Add structured logs and diagnostics.
- [ ] Remove the experimental flag only after V1/V2 ownership is resolved and migration is proven.

### Phase 8: Declarative Workflows

- [ ] Revisit workflow scope using production tier and lifecycle data.
- [ ] Implement graph schemas, validation, persistence, and scheduling.
- [ ] Implement bounded synthesis and verification patterns.
- [ ] Add workflow cancellation and recovery.
- [ ] Keep the feature separately gated from ordinary subagents.

### Phase 9: Ultra Preset

- [ ] Add Ultra only as a bounded configuration preset over workflows.
- [ ] Add projected-budget review and explicit user limits.
- [ ] Measure quality, latency, and cost against Balanced mode.
- [ ] Keep Ultra opt-in until measurements justify broader exposure.

## Expected File Areas

Exact locations must be confirmed during Phase 0; this is an ownership map, not permission to edit every file listed.

- [ ] `packages/schema/src`: shared tier, profile, lifecycle, and API data schemas.
- [ ] `packages/core/src/v1/config`: global config schema and migration surface.
- [ ] `packages/core/src/database`: orchestration tables, migrations, and repositories.
- [ ] `packages/protocol/src`: typed config and orchestration endpoint definitions.
- [ ] `packages/server/src/handlers`: narrow config and control handlers.
- [ ] `packages/client`: generated protocol clients; regenerate, do not hand-edit generated files.
- [ ] `packages/sdk/js`: legacy SDK generation when public legacy APIs change.
- [ ] `packages/opencode/src/tool/task.ts`: tier selection and lifecycle submission contract if V1 remains authoritative.
- [ ] `packages/opencode/src/session`: compaction, prompt admission, and child session integration.
- [ ] `packages/opencode/src/background`: compatibility and eventual replacement of in-memory truth.
- [ ] `packages/app/src/components/dialog-usage-dashboard.tsx`: dashboard section shell.
- [ ] `packages/app/src/components/dialog-select-model.tsx`: reusable selector extraction only if needed.
- [ ] `packages/app/src/context/local.tsx`: model catalog access, not persisted tier settings.
- [ ] `packages/app/src/context/settings.tsx`: avoid storing server-owned tier config here.
- [ ] Relevant package test directories: focused unit, database, endpoint, component, and browser coverage.

## Verification Matrix

### Configuration

- [ ] Fresh install with no `subagents` block resolves stable defaults.
- [ ] JSON and JSONC updates preserve unrelated keys and comments where supported.
- [ ] Managed config precedence remains unchanged.
- [ ] Disconnected configured provider produces a warning and deterministic fallback.
- [ ] Reconnected provider restores the persisted selection without user re-entry.
- [ ] Unsupported effort is rejected with a field-level error.
- [ ] Concurrent dashboard edits trigger revision conflict handling.

### Dispatch

- [ ] Fast, Balanced, and Deep each resolve the expected model and effort.
- [ ] Role permissions remain identical when only tier changes.
- [ ] Omitted tier uses the configured default.
- [ ] Active runs retain their snapshots after dashboard changes.
- [ ] Resumed children retain their original snapshot.
- [ ] Invalid fallback chains fail clearly rather than selecting an arbitrary model.

### Lifecycle

- [ ] Persistent child can be continued by its owner.
- [ ] One-off child is fresh, delivered once, archived, and not resumable.
- [ ] Abandoned child is cancelled, archived, and not resumable.
- [ ] Replacement suppresses late output from the old child.
- [ ] Wrong parent, role, project, or workspace cannot resume a child.
- [ ] Repeated cancel and abandon operations are idempotent.
- [ ] Compact preserves durable transcript and reduces selected context.
- [ ] Retarget changes model only after successful compaction.

### Recovery

- [ ] Restart before execution does not lose an admitted task.
- [ ] Restart during uncertain provider work does not duplicate the request.
- [ ] Restart after completion delivers the result once.
- [ ] Restart during delivery detects an already projected result.
- [ ] Abandoned runs remain suppressed after restart.
- [ ] Interrupted runs expose a clear explicit recovery path.

### Limits and Security

- [ ] Concurrency limits hold under simultaneous requests.
- [ ] Per-turn total limits include foreground and background runs.
- [ ] Depth limits derive from durable ancestry.
- [ ] Guessed IDs cannot cross parent ownership.
- [ ] Tier changes never expand permissions.
- [ ] Cancellation releases admission capacity.
- [ ] Logs and endpoints do not disclose credentials or unrelated config.

### UI

- [ ] Existing Usage behavior and 30-second refresh remain correct.
- [ ] Tier editing never changes the active chat model.
- [ ] Model search works across provider and model names.
- [ ] Effort options update when model selection changes.
- [ ] Unavailable saved models remain visible with warnings.
- [ ] Unsaved edits survive catalog refresh.
- [ ] All controls work with keyboard and screen-reader labels.
- [ ] Desktop and mobile layouts have no overlap, clipping, or text overflow.

## Rollout and Compatibility

- [ ] Land schema and config support before task behavior consumes it.
- [ ] Keep runtime behavior unchanged when tier config is absent during initial rollout.
- [ ] Gate tier-aware execution until config, model resolution, and task tests pass.
- [ ] Gate durable lifecycle operations separately if necessary.
- [ ] Provide explicit migration notes for users of experimental background subagents.
- [ ] Preserve ordinary child-session visibility and history.
- [ ] Preserve usage accounting across old and new runs.
- [ ] Avoid changing default depth during rollout.
- [ ] Avoid changing custom role permissions or instructions.
- [ ] Measure fallback rate, interrupted runs, duplicate-delivery prevention, and cost by tier.
- [ ] Remove flags only after restart and race tests pass on Windows, macOS, and Linux.
- [ ] Document config fields and task-tool semantics before declaring stable.

## Acceptance Criteria

- [ ] A user can open Dashboard -> Subagents and assign an existing enabled model and supported effort to Fast, Balanced, and Deep.
- [ ] The configuration persists through the shared global OpenCode config and survives restart.
- [ ] CLI and desktop sessions resolve the same effective tier configuration.
- [ ] A main agent can request any of the three tiers without supplying raw model identifiers.
- [ ] A new child uses the configured tier snapshot and ordinary role permissions.
- [ ] A persisted child can be continued safely only by its owner.
- [ ] A main agent can compact an idle child and optionally retarget it to another tier.
- [ ] A main agent can abandon a child and create a fresh replacement.
- [ ] A main agent can create a one-off child whose transcript and usage remain auditable.
- [ ] Active and completed work survives process restart without silent loss or duplicate result injection.
- [ ] Concurrency, total-worker, and depth limits are enforced server-side.
- [ ] Existing usage analytics remain correct.
- [ ] Existing model selection, sessions, custom agents, and permissions do not regress.
- [ ] No team scheduler, team UI, claimed-path subsystem, or account-manager feature is reintroduced.
- [ ] Workflow and Ultra work remains deferred until the ordinary orchestration acceptance criteria are met.

## Decisions to Confirm Before Implementation

- [ ] Confirm `balanced` as the default tier.
- [ ] Confirm server-global config as the desired scope rather than per-project tier profiles.
- [ ] Confirm tier settings override role-pinned models for newly created children, with fallback to the role model only when the tier is unavailable.
- [ ] Confirm existing children keep their model snapshot until explicit compact-retarget or replacement.
- [ ] Confirm one-off transcripts should be archived and retained rather than deleted.
- [ ] Confirm running compaction should be rejected in the first release rather than queued.
- [ ] Confirm first-release hard ceilings of 16 concurrent workers, 100 workers per parent turn, and depth 3.
- [ ] Confirm no queueing when limits are reached; return a typed limit error instead.
- [ ] Confirm workflow mode uses a declarative DAG before considering sandboxed JavaScript.
- [ ] Confirm Ultra remains a later opt-in preset rather than part of the first implementation milestone.

## Definition of Done

- [ ] All decisions above are resolved and recorded.
- [ ] Every implementation phase has an owner and review boundary.
- [ ] Schema and API documentation are updated.
- [ ] Generated clients are current and contain no manual generated-file edits.
- [ ] Package type checks pass from their package directories.
- [ ] Focused unit, database, endpoint, integration, component, and browser tests pass.
- [ ] Restart and crash-boundary tests pass.
- [ ] Desktop and mobile visual verification passes.
- [ ] Security and ownership review has no unresolved high-severity findings.
- [ ] Usage totals are reconciled before and after rollout.
- [ ] The final implementation is committed and pushed in reviewable phase-sized commits.
