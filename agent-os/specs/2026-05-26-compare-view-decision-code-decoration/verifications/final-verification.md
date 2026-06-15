# Verification Report: Compare View Decoration with Decision Codes

**Spec:** `2026-05-26-compare-view-decision-code-decoration`
**Date:** 2026-05-25
**Verifier:** implementation-verifier
**Status:** Passed

---

## Executive Summary

All five implementation task groups (1-5) are complete and their behavioural anchors verified end-to-end against the source. The six new frontend tests pass; the targeted regression sweeps (`TargetArchitectureWorkspace.test.tsx` + all nine `targetState/architectConversation/__tests__/*` files) pass cleanly with no regressions. Q1 risk is verified clean (AMS DTO + mapper already surface `conversationThreadId` + `conversationTurnRef`); Q2 / Q3 / Q4 anchors all hold; out-of-scope confirmations all hold; Task Group 6 manual smoke remains unticked per spec policy. The full frontend suite shows a large pre-existing failure population (Dashboard, Discovery, UnifiedChatPanel routing) that is unrelated to this spec.

---

## 1. Tasks Verification

**Status:** All Complete (Group 6 deliberately unticked - user-driven smoke)

### Completed Tasks

- [x] Task Group 1: Verify/add typed client + verify AMS DTO conversation refs
  - [x] 1.1 Audit `architectConversationApi.ts` for existing exporter
  - [x] 1.2 Add `listCapturedDecisions` typed client function
  - [x] 1.3 Declare or extend the `CapturedDecisionDto` type
  - [x] 1.4 Verify AMS GET surfaces `conversationThreadId` + `conversationTurnRef` (Q1 risk check)
  - [x] 1.5 Confirm gateway pass-through proxy unchanged
  - [x] 1.6 No test sub-task at this level
- [x] Task Group 2: `CapturedDecisionChip` component + CSS additions
  - [x] 2.1 Write 3 chip-level tests
  - [x] 2.2 Create the chip component file
  - [x] 2.3 Implement popover dismissal: click-outside + ESC + click-chip-again
  - [x] 2.4 Add chip + popover CSS classes
  - [x] 2.5 Ensure chip tests pass
- [x] Task Group 3: `TargetArchitectureCompareView.tsx` banner + per-row chips
  - [x] 3.1 Write 3 integration tests
  - [x] 3.2 Add new props to `TargetArchitectureCompareView.tsx`
  - [x] 3.3 Render architecture-scope banner above `compareViewPanel`
  - [x] 3.4 Render per-row element-scope chips inline within Target cell
  - [x] 3.5 Overflow handling = plain `flex-wrap`
  - [x] 3.6 Ensure integration tests pass
- [x] Task Group 4: `TargetArchitectureWorkspace.tsx` fetch + callback path
  - [x] 4.1 Add captured-decisions fetch slot
  - [x] 4.2 Add `capturedDecisions` state slice
  - [x] 4.3 Add `scrollToDecisionId` transient state slice
  - [x] 4.4 Add `handleOpenInConversation` callback
  - [x] 4.5 Pass new props to `TargetArchitectureCompareView`
  - [x] 4.6 Pass `scrollToDecisionId` + clear-callback down to conversation pane
  - [x] 4.7 Test sub-task covered by Task Group 3 Test 3
- [x] Task Group 5: `ConversationMainPane.tsx` scroll-to-decision wiring
  - [x] 5.1 Add the two new props
  - [x] 5.2 Stamp `id="conv-turn-decision-${turn.decisionId}"` ONLY on `decision-captured` turns
  - [x] 5.3 Add scroll-on-mount + scroll-on-prop-change effect
  - [x] 5.4 No new test file at this layer

### Deliberately Unticked (Spec-Sanctioned)

- [ ] Task Group 6: End-to-end manual smoke + regression check
  - Manual smoke sub-tasks 6.1-6.9 are user-driven (architect-on-real-data). Spec policy is to leave Group 6 unticked; verification covers everything verifiable from source.

### Incomplete or Issues

None.

---

## 2. Documentation Verification

**Status:** No Implementation Reports (per spec design)

### Implementation Documentation

This spec did not produce per-task implementation reports under `implementation/` or `implementations/`. The spec's Commit Boundary (Q12) called for a single commit covering all six task groups; per-task implementation reports were not part of the deliverable. The verification anchors below are the substitute documentation surface.

### Verification Documentation

- `verifications/final-verification.md` (this report).

### Missing Documentation

None - the spec did not require per-task implementation reports.

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

None.

### Notes

`agent-os/product/roadmap.md` contains no items matching "compare view", "captured decision", "decision code", or "decoration". This spec is a UI enrichment of an existing surface; it does not advance a top-level roadmap milestone. No roadmap edit required.

---

## 4. Test Suite Results

**Status:** Passed (with large pre-existing failure population, unchanged by this spec)

### Test Summary

**Targeted spec tests (this spec's 6 tests + workspace regression + conversation regression):**

- Total relevant tests: 50 (6 new + 6 workspace + 38 conversation)
- Passing: 50
- Failing: 0
- Errors: 0

Breakdown:

- `CapturedDecisionChip.test.tsx` - 3 / 3 passed
- `TargetArchitectureCompareView.decisions.test.tsx` - 3 / 3 passed
- `TargetArchitectureWorkspace.test.tsx` - 6 / 6 passed
- `src/components/targetState/architectConversation/__tests__/*` (9 files) - 38 / 38 passed

**Full frontend Vitest run:**

- Total tests: 9920
- Passing: 9295
- Failing: 625
- Errors: 8 (uncaught exceptions in unrelated routing/dashboard tests)
- Test files: 989 (768 passed, 221 failed)
- Duration: ~150s

### Failed Tests

The 625 failing tests are all in surfaces this spec did not touch:

- `src/__tests__/DashboardView.test.tsx` (obsolete snapshots + dashboard summary fetching - matches MEMORY.md pre-existing failures)
- `src/__tests__/dashboard-increment-3-gap-tests.test.tsx` (UnifiedChatPanel context wiring; uncaught exception around `useActivateTemporaryDiagram` - pre-existing)
- `src/__tests__/routing/discoverySubRoutes.test.tsx` + `routing/dashboardCleanup.test.tsx` (DiscoveryRunDetailPage `candidates.filter` on undefined - pre-existing)
- `src/__tests__/bootstrap-summary-fetching.test.ts` (URL assertion - listed in MEMORY.md pre-existing failures)
- `src/__tests__/conversation-memory-edge-cases.test.ts` (listed in MEMORY.md)
- `src/__tests__/hub-bootstrap-4-task-definition.test.ts` (availableFrom - MEMORY.md)
- `src/__tests__/chatV2-panel-integration.test.ts` + `chatV2-panel-context-and-filtering.test.ts` (availableFrom - MEMORY.md)
- Various other Dashboard / Discovery / chatV2 / metaModel suites tagged as pre-existing per MEMORY.md

None of the failed tests touch the files this spec modified or added:

- `frontend/src/api/architectConversationApi.ts` (added types + new function)
- `frontend/src/components/Architecture/CapturedDecisionChip.tsx` (new)
- `frontend/src/components/Architecture/CapturedDecisionChip.test.tsx` (new)
- `frontend/src/components/Architecture/TargetArchitectureCompareView.tsx`
- `frontend/src/components/Architecture/TargetArchitectureCompareView.decisions.test.tsx` (new)
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.module.css`
- `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx`
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`

### Notes

The failure population matches the pre-existing baseline documented in MEMORY.md plus additional pre-existing failures in Dashboard / Discovery / UnifiedChatPanel surfaces that are outside this spec's scope. Per project policy, this verifier did not attempt to fix any failing test. Per the spec's commit boundary, this is a green pass.

---

## 5. Behavioural Anchor Verification

All anchors named in the verification brief verified directly against source.

### Q1 (AMS DTO conversation refs) - Verified Clean

- `TargetStateCapturedDecisionDto` declares `conversationThreadId` (line 35) and `conversationTurnRef` (line 36) as record fields.
- `TargetStateCapturedDecisionMapper.toDto` populates both from `entity.getConversationThreadId()` and `entity.getConversationTurnRef()` (lines 41-42).
- Gateway proxy `GET /captured-decisions` (lines 662-701 of `gateway/src/routes/targetArchitectures.ts`) is a pure `fetch` + `pipeUpstream`, no field stripping.
- The conversation envelope `mapCapturedDecisionRow` (lines 497-525 of `gateway/src/routes/architectConversation.ts`) still omits both fields - untouched, separate code path used by the conversation flow.
- No additive AMS change was required (Q1 risk did not materialise).

### Q2 (Turn anchor by `decisionId`, not `turn_ref`) - Verified

- `ConversationMainPane.tsx` line 361 emits `id={\`conv-turn-decision-${turn.decisionId}\`}` inside the `case 'decision-captured'` branch ONLY (line 353).
- Other turn kinds in the switch render path are untouched.
- `conversationTurnRef` appears only in: (a) the DTO type declaration (mirrors AMS), (b) test fixtures, (c) negative documentation comments explicitly stating it stays unused in v1.
- No code path reads or routes on `conversationTurnRef`.

### Q3 (Navigation via callback, NOT URL hash) - Verified

- `CapturedDecisionChip.tsx` line 136 calls `onOpenInConversation(decision.decisionId)`.
- `TargetArchitectureWorkspace.tsx` lines 269-272 defines `handleOpenInConversation` which sets `viewMode = 'conversation'` + `scrollToDecisionId`.
- `window.location.hash` appears nowhere in any of the changed files - only as a negative comment ("no window.location.hash plumbing, no hashchange listener, no history pollution") inside `TargetArchitectureWorkspace.tsx`.
- No `window.hashchange` listener anywhere.

### Q4 (Column count stays at 5; chips inline in Target cell) - Verified

- `TargetArchitectureCompareView.tsx` lines 331-338 declare exactly 5 `<th>` elements: Current element / Mapping / Target element / Provenance / Status.
- `renderTargetCellChips(targetId)` (lines 257-275) renders inside the existing Target cell via `<td>` wrapping `{renderTargetCellChips(tid)}` calls at lines 422 and 456 - inline, not as a new column.
- Architecture-scope banner is rendered OUTSIDE the `.compareViewPanel` wrapper (lines 285-303), ABOVE the `compareViewPanel` `<div>` (line 304+).

### Files added / modified - Verified

Added:

- `frontend/src/components/Architecture/CapturedDecisionChip.tsx` (151 lines).
- `frontend/src/components/Architecture/CapturedDecisionChip.test.tsx` (3 tests).
- `frontend/src/components/Architecture/TargetArchitectureCompareView.decisions.test.tsx` (3 tests).

Modified:

- `frontend/src/api/architectConversationApi.ts` - `CapturedDecisionDto` interface (around line 734) + `listCapturedDecisions` function (around line 764). Existing `CapturedDecisionRow` envelope shape untouched.
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.module.css` - chip / popover / banner CSS classes appended.
- `frontend/src/components/Architecture/TargetArchitectureCompareView.tsx` - new props, banner render, per-row chip render via `renderTargetCellChips`.
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx` - fetch slot, state slices, callback, prop wiring (`handleOpenInConversation`, `scrollToDecisionId`, `handleScrolledToDecision`).
- `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` - `scrollToDecisionId` + `onScrolledToDecision` props (lines 63-64), scroll effect (lines 94-106), id stamp on `decision-captured` turn (line 361).
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` - prop threading through both ConversationMainPane mount sites (lines 91-92, 100-101, 628-629, 677-678).

### Out-of-scope confirmations - All Held

- No AMS changes beyond the pre-existing DTO/mapper that already supported the fields.
- No gateway changes (proxy already existed and is a pure pass-through).
- No new column on the Compare View (table stays at 5 columns).
- No URL hash routing.
- No `conversation_turn_ref` wiring (field present in DTO type only, not used by any code path).
- No service-scope or interface-scope decoration.
- No decoration on Mapping Review / Selective Copy surfaces.
- No changes to Provenance + Status placeholder columns.
- No hover tooltips on chips (click-only popover, three dismissal modes implemented).
- No color-coding by decision-code prefix (single neutral grey).
