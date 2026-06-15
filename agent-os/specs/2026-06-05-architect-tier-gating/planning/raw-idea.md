# Architect Tier-Gating (Half B — split from the former combined Spec ⑤)

This is **Half B** of the now-SPLIT "multi-service review scope + tier-gating" idea. TWO specs. Half A (per-service scan selection) is BUILT + verified. This is **Half B = tier-gating the target-state Architect conversation.** They share the pure `deriveServiceTier` helper introduced in Half A (`frontend/src/components/Discovery/deriveServiceTier.ts`).

## What Half B does (original triage point 6)
The target-state Architect conversation currently asks ALL ~51 questions — including every UI question — even for a backend-only migration. Only the Frontend group (Group E) is relevance-gated (by `hasUiScreens`, which the frontend never even sends, so UI is always asked). Half B: group questions by TECHNOLOGY tier (UI/Service/Persistence), CONFIRM the tiers in play at the START of the conversation (derived from the target architecture's `application_components.tech_type`), then only ask the applicable groups.

## Confirmed decisions (user, 2026-06-05 — LOCKED)
1. **Tier confirmation = IN-SESSION ONLY** (NO durable captured-decision row), matching how `hasUiScreens` is ephemeral today. A start-of-conversation confirmation turn derives the DEFAULT tier set client-side from the loaded target model, the user confirms/adjusts it, and it gates the questions for that session only.
2. **Tier → question-group classification (LOCKED):**
   - **Service:** A (Service runtime), B (API surface), D (Domain/DTO), H (Inter-service comms).
   - **Persistence:** C (Data persistence).
   - **UI:** E (Frontend).
   - **Generic (ALWAYS asked):** F (Cross-cutting), G (Infrastructure), I (Testing), J (Cut-over).
   A group is SKIPPED only when its tier is confirmed ABSENT.
3. **`RelevanceContext` extension (LOCKED):** add `hasUiTier` / `hasServiceTier` / `hasPersistenceTier`; **fold `hasUiScreens` ENTIRELY into `hasUiTier` — NO backward-compat alias.** The existing `onlyWhenUiPresent` (Group E) becomes `onlyWhenUiTier` reading `hasUiTier`; add `onlyWhenServiceTier` / `onlyWhenPersistenceTier` predicates and tag groups A/B/D/H (Service) + C (Persistence). Leave F/G/I/J ungated (generic).

## The tier source / deriveServiceTier (reused from Half A)
Tier comes from the TARGET architecture's components: `service.app_component_id → app_component.tech_type` ('UI Tier'/'Service Tier'/'Persistence Tier'/'Other'), via the full-model GET already cached by the AppShell — NO new backend endpoint. Half B derives the set of distinct tiers present in the TARGET architecture's components (NOT from the discovery scan selection — that is Half A; there is NO cross-surface handoff, by design). Reuse the pure `deriveServiceTier` helper from Half A (`frontend/src/components/Discovery/deriveServiceTier.ts`); relocate it to a more neutral shared location if appropriate (it currently lives under `components/Discovery/`). NOTE: "tier" is overloaded — `DiscoveryRunDto.tier` is the V3 CONFIDENCE ladder (A/B/C), UNRELATED to technology tier.

## Code grounding (verify against current source)
- `gateway/src/config/architect-conversation/questionLibrary.ts` — `RelevanceContext` (~111-114), `onlyWhenUiPresent` (~174), all A-J group entries (Group E ~778-906).
- `gateway/src/services/architectConversation/{relevanceEvaluator,questionSequencer,architectConversationCoordinator}.ts`.
- `gateway/src/routes/architectConversation.ts` — `open` (~621+, RelevanceContext build ~636-642 defaulting `hasUiScreens=true`) + `next-question` (~481+, ~501-504).
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` — `handleStartConversation` (~306-331; the `open` call that currently OMITS `relevanceContext`).
- `frontend/src/api/architectConversationApi.ts` — `openConversation` (~510+), the `next-question` client (~461+).
- The architect-conversation TURN UNION (the gateway architectConversation `turnShape`-equivalent) — where the new tier-confirmation OPENING turn kind hooks in (parallels the Review Room's `open`-turn pattern).
- `frontend/src/types/model.ts` — `TechType` (~260-281), `ApplicationComponent` (~301-318, `tech_type`).
- The AppShell per-(project,architecture) model cache — the already-loaded source the tier derivation reads from.
- The shared helper: `frontend/src/components/Discovery/deriveServiceTier.ts` (Half A).

## Scope
- **Gateway:** extend `RelevanceContext` (`hasUiTier`/`hasServiceTier`/`hasPersistenceTier`, fold in `hasUiScreens`); add `onlyWhenServiceTier`/`onlyWhenPersistenceTier` predicates + retag groups A/B/C/D/E/H; the start-of-conversation tier-confirmation turn (new turn kind + coordinator step); thread the confirmed tier set through `open` + `next-question`.
- **Frontend:** derive the default tier set client-side from the loaded target model (via `deriveServiceTier` over the architecture's components); the tier-confirmation turn UI (confirm/adjust); send the tier set on `open` + `next-question`.
- **Shared:** reuse (possibly relocate) the pure `deriveServiceTier` helper.
- **OUT of scope:** Half A (per-service scan selection — done); any new AMS endpoint (full-model GET suffices); persisting the tier set as a durable decision (in-session only per decision 1); the agenda/cascade specs (done).

The full combined investigation (both halves' grounding) is at `agent-os/specs/2026-06-05-multi-service-review-scope-and-tier-gating/planning/requirements.md` (Half B grounded section + the A-J taxonomy table).
