# Task Breakdown: Architect Tier-Gating (Half B)

## Overview
Total Tasks: 4 task groups

Stop the target-state Architect conversation from asking irrelevant question
groups (e.g. every UI question on a backend-only migration) by classifying the
A-J question library by technology tier, confirming the tiers in play at
conversation open (derived client-side from the target architecture's
`app_components.tech_type`), and only asking the groups whose tier is present.

## Top-Level Guard Rails (apply to EVERY task below)

- **Scope = gateway + frontend ONLY. NO AMS change.** The full-model GET already
  carries `services` + `app_components`, and the AppShell caches the
  per-(project, architecture) model. Do NOT add or touch any
  `architecture-model-service` endpoint, DTO, migration, or Liquibase changeset.
- **Reuse Half A's pure `deriveServiceTier` helper** at
  `frontend/src/components/Discovery/deriveServiceTier.ts` — never re-implement
  the two-hop `service → app_component_id → tech_type → ServiceTier` resolution.
  If relocating it to a neutral shared location (it is now consumed from the
  target-state surface too), update Half A's import in
  `DiscoveryReviewRoom.tsx:68` and its tests in the same change; the helper is
  code-shared only — there is NO runtime data handoff between the halves.
- **FAIL-OPEN everywhere.** An empty/ambiguous derived tier set — a component
  with `tech_type='Other'`/missing, or a service with NULL `app_component_id`
  (both resolve to `'Unknown'` via `deriveServiceTier`, contributing no tier) —
  MUST default to ASKING all groups. Never wrongly skip. A group is skipped ONLY
  when its tier is confirmed ABSENT. The confirmation turn (Task Group 4) lets
  the user correct an under-derived set.
- **IN-SESSION ONLY (Decision 1).** The tier set is ephemeral, exactly like
  `hasUiScreens` is today — no durable captured-decision row, no persistence;
  re-deriving on each reopen is idempotent.
- **Disambiguate "tier".** `DiscoveryRunDto.tier` is the V3 CONFIDENCE ladder
  (A/B/C) and is UNRELATED to the technology tier (UI/Service/Persistence) this
  spec gates on. Keep all new prose/identifiers unambiguous.
- **Reuse the existing relevance machinery as-is.** `evaluateRelevance`
  (`relevanceEvaluator.ts:66-87`), `selectNextQuestion`
  (`questionSequencer.ts:65-79`), and the `system-skip` orchestration all
  consume `entry.relevanceCondition(ctx)` already. VERIFY they keep working with
  the widened context — do NOT rewrite them; only the context fields, the
  predicates, and the per-group tags grow.

## Task List

### Gateway Config Layer (foundational)

#### Task Group 1: RelevanceContext extension + group classification
**Dependencies:** None
**Stack:** Gateway (TypeScript config). All edits in
`gateway/src/config/architect-conversation/questionLibrary.ts`.

- [x] 1.0 Extend `RelevanceContext` and retag groups A/B/C/D/E/H by tier
  - [x] 1.1 Write 2-8 focused tests in
        `gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`
        (extend the existing file if present, else add it)
    - Limit to 2-8 highly focused tests maximum
    - `onlyWhenUiTier`/`onlyWhenServiceTier`/`onlyWhenPersistenceTier` each
      return `true` only when their respective flag is `true`
    - Every Group A/B/D/H entry carries `relevanceCondition: onlyWhenServiceTier`;
      every Group C entry carries `onlyWhenPersistenceTier`; every Group E entry
      carries `onlyWhenUiTier`; Groups F/G/I/J carry NO `relevanceCondition`
    - Skip exhaustive per-code assertions beyond confirming the group tagging
  - [x] 1.2 Replace the single-field `RelevanceContext` (lines 111-114)
    - Remove `hasUiScreens`; add `hasUiTier`, `hasServiceTier`,
      `hasPersistenceTier` (all `boolean`). Add NO backward-compat alias.
    - Update the doc-comment to describe the three tier flags and note that
      `DiscoveryRunDto.tier` (V3 confidence A/B/C) is unrelated.
  - [x] 1.3 Rename + add the tier predicates
    - Rename `onlyWhenUiPresent` (line 174) → `onlyWhenUiTier`, reading
      `ctx.hasUiTier === true`
    - Add `onlyWhenServiceTier` (`ctx.hasServiceTier === true`) and
      `onlyWhenPersistenceTier` (`ctx.hasPersistenceTier === true`)
  - [x] 1.4 Re-point the five Group E entries
    - The `relevanceCondition` at lines ~825/840/860/882/904 must now reference
      `onlyWhenUiTier` (was `onlyWhenUiPresent`). Group E behaviour must be
      IDENTICAL when UI is present (its only consumer today).
  - [x] 1.5 Tag the Service + Persistence groups
    - Add `relevanceCondition: onlyWhenServiceTier` to every Group A, B, D, H
      entry; add `onlyWhenPersistenceTier` to every Group C entry
    - Verify the exact per-group codes against the library during the build —
      the A-J tier→group table in `planning/requirements.md` (§Confirmed
      Decisions point 2) is the LOCKED contract; codes are the shaper's read
    - Leave Groups F, G, I, J ungated (no `relevanceCondition`)
  - [x] 1.6 Run ONLY the Task Group 1 tests
    - `npx jest questionLibrary` (gateway)
    - Verify the 2-8 tests from 1.1 pass; do NOT run the whole gateway suite

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `RelevanceContext` has exactly `hasUiTier`/`hasServiceTier`/`hasPersistenceTier`;
  no `hasUiScreens`, no alias
- A/B/D/H tagged Service, C tagged Persistence, E tagged UI (via the renamed
  `onlyWhenUiTier`); F/G/I/J ungated
- `tsc` shows no NEW errors attributable to this file

### Gateway Turn Shape + Coordinator Layer

#### Task Group 2: Tier-confirmation opening turn — turn unions + coordinator
**Dependencies:** Task Group 1
**Stack:** Gateway (turn shape + coordinator) + the FRONTEND turn-union mirror.

- [x] 2.0 Add the `tier-confirmation` opening turn kind and emit it at OPEN
  - [x] 2.1 Write 2-8 focused tests in
        `gateway/src/services/architectConversation/__tests__/conversationTranscript.test.ts`
        (extend) and/or a coordinator test
    - Limit to 2-8 highly focused tests maximum
    - A `tier-confirmation` turn round-trips through the union; the payload
      carries the three derived + three confirmed tier booleans
    - `assertExhaustiveTurnKind` stays exhaustive with the new kind handled
    - The coordinator emits a `tier-confirmation` turn at OPEN, BEFORE the first
      question
  - [x] 2.2 Add the `tier-confirmation` kind to the gateway turn union
    - In `gateway/src/services/architectConversation/turnShape.ts`: add the
      literal to `ConversationTurnKind` (line 26 — currently 14 kinds despite the
      "13-kind" doc-comment; correct the comment) and add the
      `TierConfirmationTurn` interface to the `ConversationTurn` union (line 264)
    - Payload shape:
      `{ kind: 'tier-confirmation'; derivedTiers: { hasUiTier; hasServiceTier; hasPersistenceTier }; confirmedTiers: { hasUiTier; hasServiceTier; hasPersistenceTier } }`
      so the transcript is self-contained
    - Template: the Discovery Review Room `OpenTurn` in `reviewTurnShape.ts:150`
  - [x] 2.3 Mirror the kind in the FRONTEND turn union (field-for-field)
    - In `frontend/src/api/architectConversationApi.ts`: add the literal to the
      frontend's own `ConversationTurnKind` copy (line 70 — the spec flagged the
      frontend keeps a SEPARATE union) and add the matching
      `TierConfirmationTurn` interface to the frontend `ConversationTurn` union
    - GOTCHA: the mirror must match the gateway payload field-for-field
      (`derivedTiers`/`confirmedTiers`, same three booleans) — drift here breaks
      transcript rendering
  - [x] 2.4 Add the coordinator step that emits the turn at OPEN
    - In `architectConversationCoordinator.ts` (or whichever module owns the
      open-turn orchestration), append the `tier-confirmation` turn after the
      `open` turn and BEFORE the first question, carrying the supplied (or
      all-true default) tier set — parallel to the Review Room open-turn step
  - [x] 2.5 Update `assertExhaustiveTurnKind` consumers
    - Walk every switch/`assertExhaustiveTurnKind` consumer over the union (both
      stacks) and handle the new kind so the closed union stays honest at
      type-check time
  - [x] 2.6 Run ONLY the Task Group 2 tests
    - `npx jest conversationTranscript` (and the coordinator test) in gateway
    - Verify the 2-8 tests from 2.1 pass; do NOT run the whole suite

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Both the gateway and frontend turn unions carry an identical
  `tier-confirmation` kind/payload
- `assertExhaustiveTurnKind` remains exhaustive on both stacks
- The coordinator emits the turn at OPEN before the first question

### Gateway Routes + Frontend Wiring Layer (the core bug fix)

#### Task Group 3: Thread the tier set + client-side derivation
**Dependencies:** Task Groups 1, 2
**Stack:** Gateway routes (`architectConversation.ts`) + frontend API client +
the conversation tab's open/next-question call sites.

- [x] 3.0 Read the tier set on the routes and SEND it from the frontend
  - [x] 3.1 Write 2-8 focused tests split across the two stacks
    - Gateway Jest in `gateway/src/routes/__tests__/` (a new
      `architectConversationTierGating.test.ts` or extend an existing route
      test): `open` reads all three tier flags from `body.relevanceContext`
      (each defaulting `true`) and appends the confirmation turn; `next-question`
      reads `hasUiTier`/`hasServiceTier`/`hasPersistenceTier` query params (each
      defaulting `true`) and gates the walk; FAIL-OPEN default (omit
      body/params → all groups asked). Limit gateway to ~4 tests.
    - Frontend Vitest in
      `frontend/src/components/targetState/architectConversation/__tests__/`:
      the default-tier derivation produces the correct three booleans from a
      mocked `useArchitecture()` model (incl. `'Other'`/NULL → no tier;
      empty/ambiguous → all true). Limit frontend to ~4 tests.
    - Limit to 2-8 tests TOTAL across both stacks
  - [x] 3.2 Widen the gateway `open` route tier reads
    - `architectConversation.ts:636-642`: replace the single `hasUiScreens`
      default-true read with reads of `hasUiTier`/`hasServiceTier`/
      `hasPersistenceTier`, each defaulting `true` when absent (fail-open)
    - The auto-skip → pre-fill over the relevance-filtered library (664-665) now
      honours all three flags automatically — verify, do NOT rewrite
    - Append the new `tier-confirmation` turn from the open handler carrying the
      supplied set (or all-true default) — coordinate with Task 2.4 so the turn
      is emitted exactly once
  - [x] 3.3 Widen the gateway `next-question` route tier reads
    - `architectConversation.ts:485, 501-504`: replace `?hasUiScreens` (default
      true) with reads of `?hasUiTier`/`?hasServiceTier`/`?hasPersistenceTier`
      (each default `true`) and pass all three into `selectNextQuestion`'s
      `relevanceContext`
    - In `questionSequencer.ts` update the `{ hasUiScreens: true }` defaults
      (lines 57, 68) to default all THREE flags true; `evaluateRelevance` is
      reused unchanged
  - [x] 3.4 Extend the frontend API client
    - `architectConversationApi.ts`: add an optional `relevanceContext`
      (carrying the three tier booleans) to `OpenConversationRequest`
      (lines 501-503) and POST it
    - Extend `fetchNextQuestion` (lines 464-477) to take the three tier flags
      and append `hasUiTier`/`hasServiceTier`/`hasPersistenceTier` query params
      (replacing the single `hasUiScreens` param); update its callers in the tab
  - [x] 3.5 Client-side default tier derivation (no new fetch)
    - In `ArchitectConversationTab.tsx`, read the already-cached model via
      `useArchitecture()` (same pattern as `DiscoveryReviewRoom.tsx:336-346`):
      build `appComponentsById` from `model.metaModel.entities.app_components`
      and iterate `model.metaModel.entities.services`
    - For each service call `deriveServiceTier(service, appComponentsById)`;
      collapse the `ServiceTier[]` into the three booleans (`hasUiTier = any
      'UI'`, etc.); `'Unknown'` contributes to no tier
    - Derive from the TARGET architecture's components only (NOT the discovery
      scan selection — that is Half A; no cross-surface handoff)
  - [x] 3.6 Wire the tier set into `handleStartConversation` (THE CORE BUG FIX)
    - `ArchitectConversationTab.tsx:306-331`: the `openConversation(...)` call at
      line 309 currently omits `relevanceContext`, so `hasUiScreens` defaults
      true and UI is ALWAYS asked. It must now send the derived (then
      Task-Group-4-confirmed) tier set as `relevanceContext`, and every
      `fetchNextQuestion` call must pass the three tier flags
  - [x] 3.7 Run ONLY the Task Group 3 tests
    - Gateway: `npx jest architectConversation` (route tests only)
    - Frontend: `npx vitest run` the derivation test file(s) only
    - Verify the 2-8 tests from 3.1 pass; do NOT run whole suites

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- `open` and `next-question` read all three tier flags, each defaulting `true`
  (fail-open) when absent
- The frontend derives the default tier set from the cached model and SENDS it
  on `open` + every `next-question` (the omission at
  `ArchitectConversationTab.tsx:309` is fixed)
- `'Other'`/NULL/missing → `'Unknown'` → no tier; empty/ambiguous set → all
  three flags true (ask everything)

### Frontend Tier-Confirmation Turn UI Layer

#### Task Group 4: Frontend tier-confirmation turn UI
**Dependencies:** Task Groups 2, 3
**Stack:** Frontend (React component + Vitest).

- [x] 4.0 Render the tier-confirmation turn and thread the chosen set
  - [x] 4.1 Write 2-8 focused tests in
        `frontend/src/components/targetState/architectConversation/__tests__/`
        (extend `StartConversation.test.tsx`/`QuestionDriver.test.tsx` or add a
        new `TierConfirmation.test.tsx`)
    - Limit to 2-8 highly focused tests maximum
    - The tier-confirmation turn renders before the first question is fetched,
      showing the detected tiers with toggle + confirm controls
    - Toggling a tier and confirming threads the ADJUSTED set into the `open`
      body AND into the `fetchNextQuestion` query params (assert the adjusted
      booleans actually reach `openConversation` / `fetchNextQuestion`)
    - GOTCHA: add `import { describe, it, expect } from 'vitest'` to any NEW
      vitest file so it does not add tsc-global noise
    - GOTCHA: the `architectConversationApi` mock factory MUST list EVERY export
      the component imports (the `OPT_OUT_ANSWER_VALUE`-style partial-mock
      gotcha — copy the export list from the existing
      `StartConversation.test.tsx` factory and add any newly imported symbols)
  - [x] 4.2 Render the `tier-confirmation` turn
    - In the transcript-rendering surface (`ConversationMainPane`, matching the
      existing per-kind turn chrome): render the turn as "I see this migration
      involves <tiers> — is that right?" with controls to toggle UI / Service /
      Persistence on/off and a confirm action
    - Surface it at conversation open BEFORE the first question is fetched
  - [x] 4.3 Hold the confirmed set in component state (in-session only)
    - Initialise from the client-derived default (Task 3.5); the confirmed set
      is held in component state (NO persistence) and used for the `open` body
      and every subsequent `next-question` call
    - On confirm/adjust, drive the `open` + `next-question` calls with the chosen
      set (coordinate with Tasks 3.4-3.6); re-deriving on reopen is idempotent
  - [x] 4.4 Run ONLY the Task Group 4 tests
    - Frontend: `npx vitest run` the tier-confirmation test file(s) only
    - Verify the 2-8 tests from 4.1 pass; do NOT run the whole frontend suite

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- The tier-confirmation turn renders before the first question with working
  toggle + confirm controls
- Confirming/adjusting threads the chosen tier set into `open` and every
  `next-question` (in-session only; no persistence)

## Testing Notes (apply across all groups)

- **Feature tests ONLY.** Run only the newly written tests per group's final
  sub-task; never run the whole gateway or frontend suite.
- **Frontend tsc baseline.** The frontend has a large pre-existing `tsc`
  baseline — verify NET-ZERO NEW errors by FILE PRESENCE (the files you touched
  are clean), NOT by total error count.
- **Vitest globals.** Every NEW vitest file must
  `import { describe, it, expect } from 'vitest'` (plus `vi`/`beforeEach`/etc. as
  used) so it does not contribute tsc-global noise.
- **Mock completeness.** Any architect-conversation vitest mocking
  `architectConversationApi` must include ALL exports the component imports —
  follow the existing `StartConversation.test.tsx` mock factory exactly and add
  the newly introduced symbols.

## Execution Order

Recommended implementation sequence (foundational first; each layer unlocks the
next):
1. Gateway config — RelevanceContext extension + group classification (Task Group 1)
2. Gateway turn shape + coordinator — tier-confirmation opening turn, both unions (Task Group 2)
3. Gateway routes + frontend wiring — thread the tier set + client-side derivation, the core bug fix (Task Group 3)
4. Frontend — tier-confirmation turn UI (Task Group 4)
