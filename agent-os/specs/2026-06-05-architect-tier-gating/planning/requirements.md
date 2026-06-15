# Spec Requirements: Architect Tier-Gating (Half B)

## Status

SPLIT 2026-06-05 from the combined "multi-service review scope + tier-gating"
idea (former Spec ⑤). TWO specs. **Half A — Per-service scan selection** is BUILT
+ verified (`agent-os/specs/2026-06-05-per-service-scan-selection/`). **THIS is
Half B — tier-gating the target-state Architect conversation.** They share the
pure `deriveServiceTier` helper introduced in Half A
(`frontend/src/components/Discovery/deriveServiceTier.ts`); there is NO runtime
data handoff between the two surfaces. The full combined investigation is at
`agent-os/specs/2026-06-05-multi-service-review-scope-and-tier-gating/planning/requirements.md`.

## Description (original triage point 6)

The target-state Architect conversation currently asks ALL ~51 questions —
including every UI question (`ui.framework`, `ui.buildTool`, …) — even for a
backend-only migration. Only the Frontend group (Group E) is relevance-gated
(by `hasUiScreens`), and the frontend never even SENDS that flag, so it defaults
true and UI is ALWAYS asked. Half B: group questions by TECHNOLOGY tier
(UI / Service / Persistence), CONFIRM the tiers in play at the START of the
conversation (derived from the target architecture's
`application_components.tech_type`), then only ask the applicable question groups.

## Confirmed Decisions (user, 2026-06-05 — LOCKED)

1. **Tier confirmation = IN-SESSION ONLY** (NO durable captured-decision row),
   matching how `hasUiScreens` is ephemeral today. A start-of-conversation
   confirmation turn derives the DEFAULT tier set client-side from the loaded
   target model, the user confirms/adjusts it, and it gates the questions for
   that session only.
2. **Tier → question-group classification (LOCKED):**
   - **Service:** A (Service runtime), B (API surface), D (Domain/DTO),
     H (Inter-service comms).
   - **Persistence:** C (Data persistence).
   - **UI:** E (Frontend).
   - **Generic — ALWAYS asked:** F (Cross-cutting), G (Infrastructure),
     I (Testing), J (Cut-over).
   A group is SKIPPED only when its tier is confirmed ABSENT.
3. **`RelevanceContext` extension (LOCKED):** add `hasUiTier` / `hasServiceTier`
   / `hasPersistenceTier`; **fold `hasUiScreens` ENTIRELY into `hasUiTier` — NO
   backward-compat alias.** The existing `onlyWhenUiPresent` (Group E) becomes
   `onlyWhenUiTier` reading `hasUiTier`; add `onlyWhenServiceTier` /
   `onlyWhenPersistenceTier` predicates and tag groups A/B/D/H (Service) + C
   (Persistence). Leave F/G/I/J ungated (generic).

## Tier → question-group mapping (the full A-J taxonomy)

| Group | Theme | Codes | Tier |
|---|---|---|---|
| A | Service runtime | service.language, service.framework, service.runtime, service.processModel, service.config, service.healthcheck | **Service** |
| B | API surface | api.protocol, api.versioning, api.contractFormat, api.auth, api.errorContract, api.rateLimiting | **Service** |
| C | Data persistence | db.engine, db.migrations, db.connectionPool, db.transactionStrategy, db.readReplicaUsage, db.driver | **Persistence** |
| D | Domain / DTO | dto.style, validation.framework, domain.mappingStrategy, domain.errorModel | **Service** |
| E | Frontend | ui.framework, ui.buildTool, ui.testing, ui.stateManagement, ui.designSystem | **UI** (already gated; predicate renamed to `onlyWhenUiTier`) |
| F | Cross-cutting | logging.framework, logging.format, metrics.framework, tracing.framework, secrets.management | **Generic** |
| G | Infrastructure | build.tool, container.runtime, container.baseImage, ci.pipeline, deployment.target | **Generic** |
| H | Inter-service comms | interservice.syncProtocol, interservice.asyncBus, interservice.messageFormat, interservice.discoveryMechanism, interservice.retryStrategy | **Service** |
| I | Testing | testing.unit, testing.integration, testing.e2e, testing.contractTesting, testing.mocking | **Generic** |
| J | Cut-over | cutover.strategy, cutover.dataMigration, cutover.rollback, cutover.parallelRunWindow | **Generic** |

(Verify the exact codes against `questionLibrary.ts` during build — the table is
the shaper's verified A-J read; the LOCKED tier assignment is the contract.)

## Tier source + the shared `deriveServiceTier` helper

Tier comes from the TARGET architecture's components:
`service.app_component_id → app_component.tech_type` ('UI Tier'/'Service
Tier'/'Persistence Tier'/'Other'), via the full-model GET already cached by the
AppShell — **NO new backend endpoint.** Half B computes the set of distinct
technology tiers present in the TARGET architecture's components (NOT from the
discovery scan selection — that is Half A; no cross-surface handoff, by design).
Reuse the pure `deriveServiceTier` helper from Half A
(`frontend/src/components/Discovery/deriveServiceTier.ts`); **relocate it to a
more neutral shared location** if appropriate (it currently lives under
`components/Discovery/`, but Half B consumes it from the target-state surface).

**"tier" is overloaded:** `DiscoveryRunDto.tier` is the V3 CONFIDENCE ladder
(A/B/C), UNRELATED to technology tier. Disambiguate in all new prose/identifiers.

## Half B — grounded (current state, verified)

- `RelevanceContext` (`questionLibrary.ts:111-114`) has EXACTLY ONE field:
  `hasUiScreens: boolean`. No tier fields.
- The ONLY gated group is **E (Frontend)** via `relevanceCondition:
  onlyWhenUiPresent` (`questionLibrary.ts:174` → `ctx.hasUiScreens === true`),
  applied to all five Group E entries (~lines 825/840/860/882/904). Every other
  group is asked unconditionally.
- `evaluateRelevance` (`relevanceEvaluator.ts:66-87`) is pure; an absent
  predicate ⇒ always relevant; a false predicate ⇒ `{ relevant: false, reason }`
  → orchestrator writes a `not_applicable` captured-decision + a `system-skip`
  turn. `selectNextQuestion` (`questionSequencer.ts`) consults
  `entry.relevanceCondition(ctx)` to skip.
- The route builds `RelevanceContext` from a query param / body field, NEVER from
  the model: `next-question` reads `?hasUiScreens` defaulting true
  (`architectConversation.ts:485, 501-504`); `open` reads
  `body.relevanceContext?.hasUiScreens` defaulting TRUE
  (`architectConversation.ts:636-642`).
- **The frontend never sends it.**
  `ArchitectConversationTab.tsx:309` calls `openConversation(projectId,
  targetArchitectureId, { openedBy })` with NO `relevanceContext`. So today
  `hasUiScreens` is ALWAYS true → Group E (UI) is ALWAYS asked — exactly the bug
  Half B fixes. There is NO pre-confirmation turn today; app_components are never
  fetched at open.

## The tier-confirmation opening turn (design)

- At conversation OPEN, BEFORE the first question, surface a **tier-confirmation
  turn** ("I see this migration involves Service Tier and Persistence Tier — is
  that right?") with confirm / adjust controls. This is a NEW opening turn kind
  in the architect-conversation turn union + a new coordinator step (parallels
  the Discovery Review Room's `open`-turn pattern).
- The DEFAULT tier set is derived **client-side** from the already-loaded target
  model (`services[].app_component_id → app_components[].tech_type` via
  `deriveServiceTier`), so no new fetch. The user can adjust (e.g. tick UI on/off).
- The confirmed tier set becomes the `RelevanceContext` tier flags the sequencer
  gates on. The `open` route already ACCEPTS `body.relevanceContext`
  (`architectConversation.ts:636`) and the frontend simply doesn't send it — so
  the channel half-exists. Half B: (a) derives the default tier set client-side,
  (b) sends it on `open`, (c) lets the user adjust via the confirmation turn,
  (d) threads the adjusted set into every `next-question` call (which today only
  carries `hasUiScreens`).
- IN-SESSION ONLY (Decision 1): no durable decision row; ephemeral like
  `hasUiScreens` is today.

## Existing Code to Reference

- `gateway/src/config/architect-conversation/questionLibrary.ts` —
  `RelevanceContext` (111-114), `onlyWhenUiPresent` (174), all A-J entries
  (Group E ~778-906).
- `gateway/src/services/architectConversation/relevanceEvaluator.ts`,
  `questionSequencer.ts`, `architectConversationCoordinator.ts`.
- `gateway/src/routes/architectConversation.ts` — `open` (621+, RelevanceContext
  build 636-642) and `next-question` (481+, 501-504).
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
  — `handleStartConversation` (306-331; the open call that omits
  `relevanceContext`).
- `frontend/src/api/architectConversationApi.ts` — `openConversation` (510+), the
  `next-question` client (461+).
- The architect-conversation TURN UNION (the gateway architectConversation
  turn-shape module) — where the new tier-confirmation opening turn hooks in.
- `frontend/src/types/model.ts` — `TechType` (260-281), `ApplicationComponent`
  (301-318, `tech_type`).
- `frontend/src/components/Discovery/deriveServiceTier.ts` — the shared helper
  (Half A) to reuse / relocate.
- The AppShell per-(project,architecture) model cache — the already-loaded source.

## Requirements Summary

### Functional Requirements
- Extend `RelevanceContext` with `hasUiTier`/`hasServiceTier`/`hasPersistenceTier`;
  fold `hasUiScreens` entirely into `hasUiTier` (no alias).
- Add `onlyWhenServiceTier`/`onlyWhenPersistenceTier` predicates; rename Group E's
  `onlyWhenUiPresent` → `onlyWhenUiTier`; tag groups A/B/D/H (Service) + C
  (Persistence); leave F/G/I/J ungated.
- Add a start-of-conversation tier-confirmation turn: derive the default tier set
  client-side from the target model's `app_component.tech_type` (via
  `deriveServiceTier`), let the user confirm/adjust, gate the questions on the
  confirmed set. IN-SESSION ONLY.
- Thread the confirmed tier set through `open` + `next-question` (the frontend
  must actually SEND the relevance context, which it doesn't today).

### Reusability Opportunities
- Reuse the pure `deriveServiceTier` helper from Half A (relocate to a neutral
  shared location).
- The existing `evaluateRelevance`/`relevanceCondition`/`system-skip` machinery is
  reused as-is — only the context fields + predicates + group tags grow.
- The Discovery Review Room's `open`-turn pattern is the template for the new
  tier-confirmation opening turn.
- The model is already loaded + cached client-side (AppShell) — no new backend
  fetch.

### Scope Boundaries
**In scope:** `RelevanceContext` tier extension; the `onlyWhenServiceTier`/
`onlyWhenPersistenceTier`/`onlyWhenUiTier` predicates + A/B/C/D/E/H group tags;
the tier-confirmation opening turn (gateway turn kind + coordinator step +
frontend UI); client-side default-tier derivation; threading the tier set through
`open` + `next-question`.

**Out of scope:** Half A (per-service scan selection — done); any new AMS endpoint
(full-model GET suffices); persisting the tier set as a durable decision
(in-session only, Decision 1); the agenda redesign + reject-cascade specs (done).

### Technical Considerations
- "tier" overload: V3 confidence tier (A/B/C) vs technology tier — disambiguate.
- Fail-open on unknown tiers: a component with `tech_type='Other'`/missing, or a
  service with NULL `app_component_id`, contributes no tier — NEVER block; if the
  derived set is empty/ambiguous, default to asking (don't wrongly skip). The
  confirmation turn lets the user correct an under-derived set.
- Folding `hasUiScreens` into `hasUiTier` must keep Group E's behaviour identical
  when UI is present (the only consumer today).
- IN-SESSION only: the tier set is ephemeral; re-deriving on reopen is idempotent.

## Visual Assets
None provided (`planning/visuals/` empty — a tier-confirmation turn UI; wireframe
optional, not required).
