# Multi-Service Review Scope + Tier-Gating (Spec ⑤)

Two related improvements that both hinge on modelling the DISCOVERED SERVICES and their TIERS (UI / Service / Persistence). Fixes original triage points 6 and 7.

## Half A (point 7) — Per-service scan selection (Discovery Review Room)
Current: the Review Room scan picker allows MAX 1 code scan + 1 database scan (hardcoded). This is wrong — a UI + a Service + a DB scan = 2 code + 1 DB is legitimate. The user wants to choose ONE scan PER SERVICE that was actually scanned: instead of a single "Code Scan" picker + single "Database scan" picker, ONE picker PER scanned service (e.g. "MyApp UI", "MyApp API", "MyApp Sybase Database"). If a service was scanned twice, the user picks which of the 2 runs for THAT service.

Investigation findings (verify against current code):
- Scan-selection UI + the 1-code-1-db constraint: `frontend/src/components/Discovery/DiscoveryReviewRoom.tsx` — `selectedCodeRunId` + `selectedDbRunId` state (strictly 0-or-1 each); help text "Pick up to one code scan and up to one database scan"; two fieldset radio pickers (Code scan / Database scan).
- `DiscoveryRunDto.service_id`: `frontend/src/api/discoveryApi.ts` — the FK linking a run to a scanned service (nullable since Liquibase changeset 126; ON DELETE SET NULL; an identity snapshot lives at `config_snapshot.serviceIdentitySnapshot` for orphan-run UI). Also `discovery_kind: 'code'|'database'|'combined'`.
- `SelectedScanPair`: `gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts` — hardcoded 2-run max (`primaryRunId`/`primaryScanKind`/`secondRunId`/`secondScanKind`, assumes primaryScanKind != secondScanKind).
- The review-model builder already handles a multi-run union (`discovery-service/src/services/reviewModel/buildReviewModel.ts`).

## Half B (point 6) — Tier-gating the Architect conversation (target-state)
Current: the target-state Architect conversation asks ALL questions including UI questions (ui.framework, ui.buildTool, …) even when the migration has NO UI. Only Group E (Frontend) is relevance-gated (by `hasUiScreens`). The user wants:
- Questions grouped by TIER: generic, UI-only, SVC-only (service), DB-only.
- At the START of the conversation a CONFIRMATION statement derived from the discovered scans/components, e.g. "I see these scans involve Service Tier and Persistence Tier only — is that correct?" The user confirms the tiers in play.
- Then ONLY the applicable question groups are asked (e.g. generic + service + DB, skipping UI entirely if there is no UI tier).
- The tier signal: discovered services are `application_components` carrying a "Tech Type" = UI Tier / Service Tier / Persistence Tier.

Investigation findings (verify against current code):
- Question bank: `gateway/src/config/architect-conversation/questionLibrary.ts` (51 questions, groups A-J). Only Group E (Frontend, ~lines 778-906) is relevance-gated via `relevanceCondition` (onlyWhenUiPresent → `ctx.hasUiScreens`). All other groups asked unconditionally.
- `RelevanceContext`: `questionLibrary.ts` (~111-114) — ONLY `hasUiScreens: boolean`. No tier fields.
- Sequencer: `gateway/src/services/architectConversation/questionSequencer.ts` `selectNextQuestion` (~65-79) calls `entry.relevanceCondition(ctx)`.
- Relevance evaluator: `gateway/src/services/architectConversation/relevanceEvaluator.ts` `evaluateRelevance` (~66-87) — emits a system-skip turn (NOT_APPLICABLE_ANSWER_VALUE).
- Coordinator: `gateway/src/services/architectConversation/architectConversationCoordinator.ts` (takes optional relevanceContext).
- Route builds RelevanceContext: `gateway/src/routes/architectConversation.ts` (~477-509, 632-665) — `hasUiScreens` hardcoded to true unless explicitly 'false'.
- application_components.tech_type: `frontend/src/types/model.ts` (tech_type field ~317; TechType enum `'UI Tier'|'Service Tier'|'Persistence Tier'|'Other'` ~260-281).
- No tier data in RelevanceContext today; app_components never fetched at conversation start; no pre-confirmation turn exists.

## The connection (why these are bundled — to be VALIDATED by the shaper)
Both hinge on the discovered services + their tiers. Half A picks runs per service; the SELECTED services' tiers (from their `application_components.tech_type`, or inferred from the scan kinds) determine which tiers are in play, which drives Half B's start-of-conversation tier confirmation + question gating. NOTE: Half A is in the DISCOVERY REVIEW ROOM (current-state review) and Half B is in the TARGET-STATE ARCHITECT conversation — DIFFERENT surfaces. The shared backbone is "discovered services have tiers." Whether this is genuinely ONE spec or TWO (like the earlier reject-cascade/agenda split) is an OPEN question to assess during shaping.

## Open design questions (for the shaper to ground in code + the user to decide)
1. Service identity + grouping: group runs by `service_id`; what is the service DISPLAY name (a `service_name` on the run / component)? How to handle runs with NULL `service_id` (orphan runs)? Use the `serviceIdentitySnapshot`?
2. One-pick-per-service: strictly one run per service, or allow 0 (skip a service)? What new selection shape replaces `SelectedScanPair`'s 2-run primary/second?
3. Tier derivation for a service/run: from `application_components.tech_type` (UI/Service/Persistence), or inferred from `discovery_kind` (code→Service or UI, database→Persistence)? A service might span tiers (a UI scan + an API scan of "MyApp"). How does a run map to its tier(s)?
4. The tier-confirmation turn in the Architect conversation: where it hooks in (a new opening turn before the first question), how the tiers are derived, and what "confirm / adjust" looks like.
5. Question→tier mapping: tag the question groups (A-J) by tier (generic / UI-only / service-only / DB-only). Which groups map to which tier? (Group E = UI; the rest need classifying.) Extend `RelevanceContext` with tier flags (e.g. hasUiTier, hasServiceTier, hasPersistenceTier).
6. How the tier signal flows from discovery (scan selection / app_components) INTO the Architect conversation (a different surface). Does the Architect conversation fetch app_components for the target architecture at open, or is the tier set passed in?

## Scope (to be refined during shaping)
- Frontend: Discovery Review Room scan picker (per-service); Architect conversation tier-confirmation turn + tier-gated rendering.
- Gateway: `SelectedScanPair` → a multi-run-per-service shape; `RelevanceContext` tier extension + question-group tier tagging; the tier-confirmation turn in the architect coordinator; fetching app_components tech_type at conversation open.
- Possibly an AMS read (fetch `application_components` with `tech_type`) — confirm whether an endpoint already exists.
- OUT of scope: the agenda redesign (Spec ④, done), the reject-cascade correctness (Spec A, done), any new discovery scanning logic.
