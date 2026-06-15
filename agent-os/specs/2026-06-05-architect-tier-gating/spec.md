# Specification: Architect Tier-Gating (Half B)

## Goal
Stop the target-state Architect conversation from asking irrelevant question groups (e.g. every UI question on a backend-only migration) by classifying the A-J question library by technology tier, confirming the tiers in play at conversation open (derived client-side from the target architecture's `application_components.tech_type`), and only asking the groups whose tier is present.

## User Stories
- As an architect migrating a backend-only service, I want the conversation to skip the UI (Frontend) questions so I only answer what is relevant to my migration.
- As an architect opening the conversation, I want to see and adjust the detected technology tiers (UI / Service / Persistence) before the first question, so an under-derived or mis-derived tier set never silently drops or adds a question group.

## Specific Requirements

**Extend `RelevanceContext` with tier flags (LOCKED)**
- In `gateway/src/config/architect-conversation/questionLibrary.ts:111-114`, replace the single-field `RelevanceContext` (`hasUiScreens: boolean`) with three fields: `hasUiTier`, `hasServiceTier`, `hasPersistenceTier` (all `boolean`).
- Fold `hasUiScreens` ENTIRELY into `hasUiTier` — remove `hasUiScreens`; add NO backward-compat alias. Group E behaviour must be identical when UI is present (its only consumer today).
- Update the `RelevanceContext` doc-comment to describe the three tier flags; note `DiscoveryRunDto.tier` (V3 confidence ladder A/B/C) is unrelated.

**Add tier predicates and retag groups A/B/C/D/E/H (LOCKED)**
- Rename `onlyWhenUiPresent` (`questionLibrary.ts:174`) to `onlyWhenUiTier`, reading `ctx.hasUiTier === true`. Re-point all five Group E entries (`relevanceCondition` at ~825/840/860/882/904) to it.
- Add `onlyWhenServiceTier` (`ctx.hasServiceTier === true`) and `onlyWhenPersistenceTier` (`ctx.hasPersistenceTier === true`).
- Tag every Group A, B, D, H entry with `relevanceCondition: onlyWhenServiceTier`; tag every Group C entry with `onlyWhenPersistenceTier`.
- Leave Groups F, G, I, J ungated (no `relevanceCondition`) — they are generic/always-asked.
- Verify the exact per-group codes against the library during build; the tier→group assignment in the planning table is the contract. A group is skipped ONLY when its tier is confirmed ABSENT.

**Add a tier-confirmation opening turn kind**
- Add one new kind to the closed turn union in `gateway/src/services/architectConversation/turnShape.ts` (currently 14 kinds, `ConversationTurnKind` line 26) and mirror it in the frontend copy (`frontend/src/api/architectConversationApi.ts:70`). Suggested kind: `tier-confirmation`.
- Payload carries the derived default tier set and the confirmed set (e.g. `{ kind: 'tier-confirmation'; derivedTiers: {...}; confirmedTiers: {...} }` using the three boolean flags), so the transcript is self-contained.
- Surface it at conversation OPEN, BEFORE the first question, parallel to the Discovery Review Room `OpenTurn` template (`gateway/src/services/discoveryReviewConversation/reviewTurnShape.ts:150`).
- Update `assertExhaustiveTurnKind` consumers / switch statements that walk the union so the new kind is handled.

**Thread the tier set through `open`**
- `architectConversation.ts:636-642` already builds `RelevanceContext` from `body.relevanceContext`; replace the single `hasUiScreens` default-true read with reads of `hasUiTier`/`hasServiceTier`/`hasPersistenceTier`, each defaulting to `true` when absent (fail-open — never silently drop a group).
- The open route already runs auto-skip → pre-fill over the relevance-filtered library (`architectConversation.ts:664-665`); this now honours all three tier flags automatically.
- Append the new tier-confirmation turn from the open handler carrying the supplied set (or the all-true default).

**Thread the tier set through `next-question`**
- `architectConversation.ts:485, 501-504` reads `?hasUiScreens` (default true) and builds `{ hasUiScreens }`. Replace with reading `?hasUiTier`/`?hasServiceTier`/`?hasPersistenceTier` (each default `true`) and passing all three into `selectNextQuestion`'s `relevanceContext`.
- `selectNextQuestion` (`questionSequencer.ts:65-79`) and its `{ hasUiScreens: true }` defaults (lines 57, 68) must default to all-three-true; `evaluateRelevance` (`relevanceEvaluator.ts`) is reused unchanged.

**Client-side default tier derivation (no new fetch)**
- In `ArchitectConversationTab.tsx`, read the already-cached model via `useArchitecture()` (same pattern as `DiscoveryReviewRoom.tsx:336-346`): build `appComponentsById` from `model.metaModel.entities.app_components` and iterate `model.metaModel.entities.services`.
- For each service call `deriveServiceTier(service, appComponentsById)`; collapse the resulting `ServiceTier[]` into the three booleans: `hasUiTier = anyService → 'UI'`, etc. `'Unknown'` contributes to no tier.
- NO new AMS endpoint — the full-model GET already carries `services` + `app_components` and the AppShell caches it. Derive from the TARGET architecture's components only (NOT the discovery scan selection — that is Half A; no cross-surface handoff).

**Tier-confirmation turn UI (confirm / adjust)**
- Render the confirmation turn at conversation open before the first question is fetched: "I see this migration involves <tiers> — is that right?" with controls to toggle UI / Service / Persistence on/off and a confirm action.
- The confirmed set is held in component state (in-session only) and used for the `open` body and every subsequent `next-question` call. Re-deriving on reopen is idempotent.

**Wire the tier set into the frontend open + next-question calls (the core bug fix)**
- `handleStartConversation` (`ArchitectConversationTab.tsx:306-331`) currently calls `openConversation(projectId, targetArchitectureId, { openedBy })` with NO `relevanceContext` — so `hasUiScreens` defaults true and UI is ALWAYS asked. It must now send the confirmed tier set as `relevanceContext`.
- Extend `OpenConversationRequest` (`architectConversationApi.ts:501-503`) with an optional `relevanceContext` carrying the three tier booleans, and POST it.
- Extend `fetchNextQuestion` (`architectConversationApi.ts:464-477`) to take the three tier flags and append `hasUiTier`/`hasServiceTier`/`hasPersistenceTier` query params (replacing the single `hasUiScreens` param); update its callers in the tab.

**Relocate the shared `deriveServiceTier` helper (optional)**
- The pure helper lives at `frontend/src/components/Discovery/deriveServiceTier.ts` (Half A). If relocating to a neutral shared location (it is now consumed from the target-state surface too), update Half A's import in `DiscoveryReviewRoom.tsx:68` and its tests. The helper itself is code-shared only — there is no runtime handoff.

**Fail-open on unknown / ambiguous tiers**
- A component with `tech_type='Other'`/missing, or a service with NULL `app_component_id`, resolves to `'Unknown'` (per `deriveServiceTier`) and contributes no tier — NEVER block.
- If the derived set is empty/ambiguous, the default is to ASK (do not wrongly skip): all three flags default true on both the open route (`architectConversation.ts:636-642`) and next-question (`architectConversation.ts:485`). The confirmation turn lets the user correct an under-derived set.

## Visual Design
No visual assets provided (`planning/visuals/` empty). A wireframe for the tier-confirmation turn is optional and not required; it follows the existing transcript-turn rendering chrome in `ConversationMainPane`.

## Existing Code to Leverage

**`deriveServiceTier` helper — `frontend/src/components/Discovery/deriveServiceTier.ts`**
- Pure, never-throws, never-blocks `service → app_component_id → tech_type → ServiceTier` two-hop resolver returning `'UI' | 'Service' | 'Persistence' | 'Unknown'`.
- Reused verbatim by Half B to derive the default tier set; relocate to a neutral path if appropriate.
- Already disambiguates technology tier from the V3 confidence tier in its doc-comment.

**Relevance machinery — `relevanceEvaluator.ts` + `questionSequencer.ts`**
- `evaluateRelevance` (`relevanceEvaluator.ts:66-87`): absent predicate ⇒ relevant; false predicate ⇒ `{ relevant: false, reason }` → orchestrator writes a `not_applicable` row + `system-skip` turn; predicate throw ⇒ fail-open. Reused as-is — only the context fields/predicates grow.
- `selectNextQuestion` (`questionSequencer.ts:65-79`) consults `entry.relevanceCondition(ctx)` to skip; only its `RelevanceContext` default needs the new tier flags.

**`useArchitecture()` model-cache read — `DiscoveryReviewRoom.tsx:336-346`**
- The exact pattern for building `appComponentsById`/`serviceById` from `model.metaModel.entities.*` off the AppShell cache. Replicate in `ArchitectConversationTab.tsx` for the same `(project, architecture)` model — no new fetch.

**Discovery Review Room open-turn pattern — `reviewTurnShape.ts:150` (`OpenTurn`) + its coordinator**
- The template for the new tier-confirmation opening turn kind and the open-before-first-question surfacing.

**`open` / `next-question` routes — `architectConversation.ts:481-513`, `621-721`**
- The `open` route already ACCEPTS `body.relevanceContext` (line 636) and runs auto-skip+pre-fill over the filtered library (664-665); `next-question` already reads a relevance query param. The channel half-exists — Half B widens the field set and makes the frontend SEND it.

## Out of Scope
- Half A (per-service scan selection) — already BUILT + verified; no runtime data handoff to Half B.
- Any new AMS endpoint — the existing full-model GET (services + app_components) and AppShell cache suffice; AMS is untouched.
- Persisting the tier set as a durable captured-decision row — Decision 1 is IN-SESSION ONLY (ephemeral, like `hasUiScreens` today); re-derived on each reopen.
- Re-deriving tier from the discovery scan selection or any cross-surface handoff — tier comes from the TARGET architecture's components only.
- The agenda redesign and reject-cascade specs — already done.
- Any change to the V3 confidence tier (`DiscoveryRunDto.tier` A/B/C) — unrelated to technology tier.
- LLM-paraphrasing of the confirmation prompt or any change to the 51-entry question prompts/cascades.

## Testing Strategy

**Gateway (Jest)** — under `gateway/src/services/architectConversation/__tests__/` and `gateway/src/routes/__tests__/`:
- Relevance/predicates: `onlyWhenUiTier`/`onlyWhenServiceTier`/`onlyWhenPersistenceTier` return correct booleans; `evaluateRelevance` skips A/B/C/D/E/H when their tier flag is false and asks F/G/I/J regardless (extend the existing relevance coverage).
- `questionSequencer.test.ts`: `selectNextQuestion` skips the right groups for each tier combination; default (no context) asks everything (fail-open).
- New turn kind: `conversationTranscript.test.ts` (or a new test) asserts the `tier-confirmation` turn round-trips and `assertExhaustiveTurnKind` stays exhaustive.
- Routes: `open` reads all three tier flags from `body.relevanceContext` (defaulting true) and appends the confirmation turn; `next-question` reads the three query params (defaulting true) and gates the walk. Cover the fail-open default (omit the body/params → all groups asked).

**Frontend (Vitest)** — under `frontend/src/components/targetState/architectConversation/__tests__/`:
- Default-tier derivation: given a mocked `useArchitecture()` model with mixed `tech_type`s, the tab derives the correct three booleans (incl. `'Other'`/NULL → no tier; empty/ambiguous → all true, ask).
- Tier-confirmation turn renders before the first question; toggling a tier and confirming threads the adjusted set into the `open` body and into `fetchNextQuestion` query params (assert the bug fix — `relevanceContext` is now SENT, previously omitted at `ArchitectConversationTab.tsx:309`).
- `architectConversationApi`: `openConversation` POSTs the `relevanceContext`; `fetchNextQuestion` emits `hasUiTier`/`hasServiceTier`/`hasPersistenceTier` params (extend `StartConversation.test.tsx` / `QuestionDriver.test.tsx`).
