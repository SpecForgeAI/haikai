# Task Breakdown: Compare View Decoration with Decision Codes

## Overview
Total Tasks: 6 task groups, 32 sub-tasks
Commit Boundary: One commit covering all six task groups (per spec Commit Boundary / Q12). All-frontend, ~250-350 LOC.

## Critical Pitfalls (read before starting any task group)

1. **Q3 Navigation via callback, NOT URL hash.** `viewMode` in `TargetArchitectureWorkspace.tsx` is local `useState`; URL hash alone cannot switch tabs. Task Groups 4 and 5 must use the callback path (`onOpenInConversation` -> `setViewMode('conversation')` + `setScrollToDecisionId`). No `window.hashchange` subscriber, no URL plumbing.
2. **Q4 Inline within Target cell, NOT a new column.** The Compare View table stays at 5 columns (Current / Mapping / Target / Provenance / Status). Task Group 3 must NOT alter the `<thead>` structure. Chips render BELOW the name/type lines inside the existing Target cell.
3. **Q2 Turn anchor by `decisionId`, NOT `turn_ref`.** Task Group 5 emits `id="conv-turn-decision-${turn.decisionId}"` ONLY on turns of type `decision-captured`. The `conversation_turn_ref` field stays unused in v1.
4. **Q1 AMS DTO conversation refs risk.** The gateway's `mapCapturedDecisionRow` (used by the conversation envelope) strips `conversationThreadId` + `conversationTurnRef`. The direct AMS GET path SHOULD surface them, but this must be verified in Task Group 1 BEFORE proceeding. If AMS strips them, add a tiny additive AMS DTO change as part of Group 1.

## Task List

### Frontend Typed Client

#### Task Group 1: Verify/add typed client + verify AMS DTO conversation refs
**Dependencies:** None

- [x] 1.0 Establish the frontend typed-client path for direct AMS captured-decisions fetch
  - [x] 1.1 Audit `frontend/src/api/architectConversationApi.ts` for an existing `listCapturedDecisions` exporter
    - Per the requirements reuse inventory (lines 27-55), this file exposes `loadConversation()` returning a `ConversationEnvelope.capturedDecisions: CapturedDecisionRow[]`, but does NOT call AMS `GET /captured-decisions` directly.
    - Grep the file for any function whose path / verb matches `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions`.
    - If a direct caller exists: document the reuse path in a code comment on the new chip + workspace call sites; skip 1.2.
    - If absent (expected): proceed to 1.2.
  - [x] 1.2 Add `listCapturedDecisions` typed client function
    - Preferred home: extend `frontend/src/api/architectConversationApi.ts` to keep all decision-related calls colocated. Alternative: new file `frontend/src/api/targetStateCapturedDecisionsApi.ts` if the existing file's scope feels narrowly conversation-shaped.
    - Signature: `listCapturedDecisions(projectId: string, targetArchitectureId: string, opts?: { includeSuperseded?: boolean }): Promise<CapturedDecisionDto[]>`.
    - Default `includeSuperseded` to `false` (explicit query-param pass for defense-in-depth even though the AMS API also defaults to latest-only).
    - GET URL: `/api/projects/${projectId}/target-architectures/${targetArchitectureId}/captured-decisions?includeSuperseded=${includeSuperseded}`.
    - Reuse the project's standard fetch wrapper / error handling pattern from neighbouring functions in the chosen file.
  - [x] 1.3 Declare or extend the `CapturedDecisionDto` type
    - If reusing the existing `CapturedDecisionRow` interface (`architectConversationApi.ts` lines 262-289): extend it (or declare a sibling `CapturedDecisionDto` interface) that ADDS `conversationThreadId: string | null` and `conversationTurnRef: string | null` to the existing field set.
    - If introducing a new file: declare the full type from scratch matching the AMS `TargetStateCapturedDecisionDto` (`@CamelCaseWire`): `decisionId, projectId, targetArchitectureId, decisionCode, scopeKind, scopeRefType, scopeRefId, answerValue, answerSummary, standardsLookupRef, conversationThreadId, conversationTurnRef, createdAt, createdByTask, supersededById`.
  - [x] 1.4 Verify the AMS GET endpoint surfaces `conversationThreadId` + `conversationTurnRef` on the wire (Q1 risk check)
    - Trace the AMS Java side: `architecture-model-service/src/main/java/.../TargetStateCapturedDecisionDto.java` (or equivalent) - confirm `@JsonProperty("conversationThreadId")` + `@JsonProperty("conversationTurnRef")` exist and the controller GET path returns them in the JSON response.
    - If the fields are present: no AMS change. Proceed to 1.5.
    - If the fields are absent or stripped: add a tiny additive AMS DTO change exposing them in the GET-list serialisation. This is the ONLY backend change permitted by this spec and only if Q1 risk materialises.
    - If a backend change is required, the single-commit boundary still holds (one commit covers all changes).
  - [x] 1.5 Confirm the gateway pass-through proxy still works as-is
    - Per the spec "Existing Code to Leverage" section: `gateway/src/routes/targetArchitectures.ts` lines 602-779 already expose the GET pass-through for `/captured-decisions` with `?includeSuperseded` forwarded verbatim. No gateway change expected.
    - Smoke-check that the route is mounted in `gateway/src/server.ts` (or equivalent) and that no auth middleware blocks the call.
    - If implementation verification finds the proxy missing despite the inventory note: add a thin pass-through forwarding the query string verbatim. No business logic.
  - [x] 1.6 No test sub-task at this level
    - The 6-test cap (per Q11) covers chip + integration behaviour only. The typed client is exercised transitively by the integration test in Task Group 3. No dedicated unit test for `listCapturedDecisions`.

**Acceptance Criteria:**
- A `listCapturedDecisions` typed client function exists and is callable from `TargetArchitectureWorkspace.tsx`.
- The returned `CapturedDecisionDto` (or extended `CapturedDecisionRow`) type carries `conversationThreadId` and `conversationTurnRef` as `string | null`.
- The AMS GET response carries both fields on the wire (verified via running service + curl, or via reading the DTO class).
- If a backend DTO change was required, it is additive only (no removed fields, no behavioural change).
- No gateway changes beyond the smoke check.

### Frontend Chip Component

#### Task Group 2: `CapturedDecisionChip` component + CSS additions
**Dependencies:** Task Group 1 (the chip imports the `CapturedDecisionDto` type)

- [x] 2.0 Build the read-only chip + popover primitive
  - [x] 2.1 Write 2-8 focused chip-level tests
    - File: `frontend/src/components/Architecture/__tests__/CapturedDecisionChip.test.tsx`
    - Limit to 2-8 highly focused tests. Target THREE tests covering the chip+popover behaviour. The remaining tests live in Task Group 3.
    - Test 1 (chip click opens popover with full payload): render a chip for a decision whose `conversationThreadId` and `conversationTurnRef` are non-null. Click the chip. Assert the popover renders `answerSummary` (visible), `answerValue` (visible), `standardsLookupRef` (visible), and a "View in conversation" button.
    - Test 2 (no conversation refs hides the link): render a chip for a decision whose `conversationThreadId` is null. Click the chip. Assert the popover renders the summary/value/standards content but does NOT render "View in conversation".
    - Test 3 ("View in conversation" callback): click the chip on a decision with conversation refs, click the "View in conversation" button, assert the `onOpenInConversation` mock was called exactly once with the decision's `decisionId`.
    - Skip exhaustive popover dismissal tests (click-outside, ESC, click-chip-again) - the requirement (Q8) specifies all three but the implementation is mechanical; covered by manual smoke in Task Group 6.
  - [x] 2.2 Create the chip component file
    - File: `frontend/src/components/Architecture/CapturedDecisionChip.tsx` (~80-120 LOC).
    - Props: `{ decision: CapturedDecisionDto; onOpenInConversation?: (decisionId: string) => void }`.
    - Renders a small neutral-grey pill with `decision.decisionCode` as the label.
    - Click toggles a small floating popover (absolutely-positioned, anchored to chip) showing in order: `answerSummary` (bold, top), `answerValue` (full body), `standardsLookupRef` (small link/badge if non-null), "View in conversation" button (only when `decision.conversationThreadId !== null`) which calls `onOpenInConversation(decision.decisionId)` on click.
    - Defense-in-depth: render nothing (return `null`) if `decision.supersededById !== null`. The caller (workspace) is the primary filter; the chip is belt-and-braces.
  - [x] 2.3 Implement popover dismissal: click-outside + ESC + click-chip-again (Q8 - all three)
    - Use a `useEffect` mounted while the popover is open that registers a `document`-level `mousedown` listener; if `event.target` is outside the chip + popover refs, close.
    - Same `useEffect` (or a sibling) registers `keydown` and closes on `Escape`.
    - The chip's own onClick toggles open/closed (handles the click-chip-again case naturally).
    - Cleanup all listeners on close + on unmount.
  - [x] 2.4 Add the chip + popover CSS classes
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.module.css`
    - Add `.capturedDecisionChip` - neutral-grey pill matching the existing `.provenanceChipDefault` shape (border-radius 10px, padding 2px 8px, font-size 11-12px, font-weight 600). Cursor `pointer`. Hover state subtle (slight background lift).
    - Add `.capturedDecisionChipGroup` - flex-wrap container with reasonable gap (4-6px). Used both in the Target cell and in the architecture-scope banner.
    - Add `.capturedDecisionPopover` - floating popover positioned absolutely relative to the chip wrapper. Reasonable right-edge clamping (e.g. via `right: 0` fallback when near viewport edge, or simpler: fixed max-width with overflow handling).
    - Add `.architectureScopeDecisionsBanner` - horizontal banner with light background, padding, sitting above the entire `.compareViewPanel`. Uses `.capturedDecisionChipGroup` internally.
    - Reuse colour variables from the existing module CSS where possible; do not introduce new design tokens.
  - [x] 2.5 Ensure chip tests pass
    - Run ONLY the 3 tests written in 2.1: `npm test -- CapturedDecisionChip.test.tsx` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 3 chip tests in 2.1 pass.
- `CapturedDecisionChip.tsx` exists and renders nothing for `supersededById !== null` decisions.
- Popover dismisses on click-outside, ESC, and click-chip-again (verified manually if not unit-tested).
- CSS classes additive - no modifications to existing `.provenanceChip*`, `.decommissionChip`, `.decomInTargetChip`, `.brandNewChip` rules.

### Frontend Compare View Integration

#### Task Group 3: `TargetArchitectureCompareView.tsx` banner + per-row chips
**Dependencies:** Task Group 2

- [x] 3.0 Integrate chips into the Compare View: banner above the panel + inline within Target cell
  - [x] 3.1 Write 2-8 focused integration tests
    - File: `frontend/src/components/Architecture/__tests__/TargetArchitectureCompareView.decisions.test.tsx`
    - Limit to 2-8 highly focused tests. Target THREE tests covering the Compare View integration. Combined with Task Group 2's 3 chip tests = 6 tests total (matches the Q11 cap).
    - Test 1 (banner renders when >=1 architecture-scope decision exists): render the Compare View with a `capturedDecisions` prop containing one `scopeKind === 'architecture'` decision. Assert the architecture-scope banner is in the DOM, contains the chip with the decision's `decisionCode`, and sits ABOVE the `.compareViewPanel` element (not inside any group header).
    - Test 2 (banner hidden when zero architecture-scope decisions): render with `capturedDecisions` containing only element-scope decisions. Assert no element with class `.architectureScopeDecisionsBanner` exists.
    - Test 3 (per-row chips render for matching element-scope decisions + supersededById filter): render with one element-scope decision matching a row's `targetElementId` AND one element-scope decision with the same `scopeRefId` but `supersededById` set (should NOT render). Assert the matching row's Target cell contains the live decision's chip but NOT the superseded one's chip. Confirms defense-in-depth.
    - Skip exhaustive scope-permutation testing; skip overflow-wrap tests (Q5 deferred); skip brand-new vs current-only row coverage (logic is identical and trivially branched).
  - [x] 3.2 Add new props to `TargetArchitectureCompareView.tsx`
    - File: `frontend/src/components/Architecture/TargetArchitectureCompareView.tsx`
    - New props: `capturedDecisions: CapturedDecisionDto[]` (latest-only - superseded filter applied at workspace level; chip also defends) and `onOpenInConversation?: (decisionId: string) => void`.
    - Update the component's TypeScript props interface.
    - Pass `onOpenInConversation` through to every chip render site (banner + per-row).
  - [x] 3.3 Render the architecture-scope banner (Q6 placement: above the entire `compareViewPanel`)
    - Above the existing `groupKeys.map(...)` block - specifically OUTSIDE / ABOVE the `.compareViewPanel` wrapper, NOT inside it and NOT above the first group header.
    - Filter `capturedDecisions` to `decision.scopeKind === 'architecture'`.
    - When the filtered list is empty: render nothing (no banner, no empty-state copy).
    - When non-empty: render a `<div className={styles.architectureScopeDecisionsBanner}>` containing a `<div className={styles.capturedDecisionChipGroup}>` with one `<CapturedDecisionChip>` per decision, forwarding `onOpenInConversation`.
  - [x] 3.4 Render per-row element-scope chips inline within the Target cell (Q4 - NOT a new column)
    - Locate the Target cell render block within the existing row template.
    - CRITICAL: do NOT alter the `<thead>` structure. The table stays at 5 columns: Current / Mapping / Target / Provenance / Status.
    - Inside the Target cell, BELOW the existing name/type lines, render a `<div className={styles.capturedDecisionChipGroup}>` containing one `<CapturedDecisionChip>` per decision where `decision.scopeKind === 'element'` AND `decision.scopeRefId === <row.targetElementId>`.
    - When the per-row filtered list is empty: render nothing (no `--` placeholder).
    - Brand-new (target-only) rows: same logic applies - element-scope decisions can attach to brand-new target elements.
    - Current-only (decommissioned) rows: no target element exists, so the per-row filter naturally yields nothing. No special-case branch needed.
  - [x] 3.5 Confirm overflow handling = plain `flex-wrap` (Q5 - "+N more" deferred to v2)
    - The chip group container relies on `flex-wrap: wrap` from the CSS class added in 2.4.
    - Row height grows as needed. No truncation, no "+N more" affordance.
  - [x] 3.6 Ensure integration tests pass
    - Run ONLY the 3 tests written in 3.1 plus the 3 chip tests from 2.1 (total 6).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 6 frontend tests (3 from 2.1 + 3 from 3.1) pass.
- The Compare View table still has exactly 5 columns (Current / Mapping / Target / Provenance / Status).
- The architecture-scope banner sits ABOVE `.compareViewPanel`, not inside any group header.
- Element-scope chips render inline within the Target cell, below the existing name/type lines.
- No regressions to the Provenance or Status placeholder columns (still `--`).
- ~30-50 LOC added to `TargetArchitectureCompareView.tsx`.

### Frontend Workspace Data Fetch + Callback Wiring

#### Task Group 4: `TargetArchitectureWorkspace.tsx` fetch + callback path
**Dependencies:** Task Groups 1 + 3

- [x] 4.0 Fetch decisions, propagate to Compare View, wire the callback path for "View in conversation"
  - [x] 4.1 Add captured-decisions fetch slot into the existing Compare View `useEffect` (lines 644-683 per spec)
    - File: `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
    - Slot the new `listCapturedDecisions(projectId, targetArchitectureId, { includeSuperseded: false })` call into the existing parallel-fetch `Promise.all` block alongside `getElementsInventory`, `listDecommissionedInTargetAnnotations`, `listArchitectureMappings`.
    - Trigger on mount AND when `selectedTargetArchitectureId` (or equivalent) changes.
    - Q9 progressive enhancement: Compare table renders immediately on the existing inventory + mappings data; banner + chips appear when this fourth promise resolves.
    - Silent fail-soft on error - match the existing workspace pattern around lines 673-678 (catch the rejection, log, leave the captured-decisions state empty). Do NOT surface an error banner.
  - [x] 4.2 Add `capturedDecisions` state slice
    - `useState<CapturedDecisionDto[]>([])`.
    - Populated by the fetch in 4.1.
    - Belt-and-braces filter on assignment: filter to `decision.supersededById === null` (the API also defaults to this, but explicit is better).
  - [x] 4.3 Add `scrollToDecisionId` transient state slice
    - `useState<string | null>(null)`.
    - Set when a chip's "View in conversation" callback fires (see 4.4).
    - Cleared by the conversation pane after it scrolls (see 5.3).
  - [x] 4.4 Add `handleOpenInConversation(decisionId: string)` callback
    - Body: `setViewMode('conversation'); setScrollToDecisionId(decisionId);`.
    - CRITICAL (Q3): callback path only. Do NOT add `window.location.hash` manipulation. Do NOT add `window.hashchange` listeners. `viewMode` is local state - URL plumbing won't switch the tab.
    - Memoise with `useCallback` if the workspace's existing convention does the same for sibling handlers.
  - [x] 4.5 Pass new props to `TargetArchitectureCompareView`
    - Add `capturedDecisions={capturedDecisions}` and `onOpenInConversation={handleOpenInConversation}` to the existing `<TargetArchitectureCompareView ... />` render site.
  - [x] 4.6 Pass `scrollToDecisionId` + a clear-callback down to the Architect Conversation pane
    - Locate the `<ArchitectConversationTab />` or `<ConversationMainPane />` mount site within the workspace (whichever the existing pattern uses).
    - Add `scrollToDecisionId={scrollToDecisionId}` prop.
    - Add `onScrolledToDecision={() => setScrollToDecisionId(null)}` clear-callback prop.
    - These two props thread through any intermediate wrapper to land on `ConversationMainPane.tsx` per Task Group 5.
  - [x] 4.7 Test sub-task: covered by Test 6 in Task Group 3
    - The "View in conversation callback switches viewMode" assertion lives in the chip test (Task Group 2 Test 3) which verifies the callback contract. The workspace-side wiring (setViewMode + setScrollToDecisionId) is verified by manual smoke in Task Group 6.
    - No new test file at this layer; the 6-test cap is already reached.

**Acceptance Criteria:**
- `listCapturedDecisions` is called on mount + when selected target changes; fetch failure leaves the chips empty without surfacing an error.
- `capturedDecisions` state is filtered to `supersededById === null`.
- Clicking a chip's "View in conversation" causes the workspace's `viewMode` to flip to `'conversation'` AND stashes the `decisionId` in `scrollToDecisionId`.
- No URL hash manipulation, no `window.hashchange` listener, no history pollution.
- `~40-60 LOC` added to `TargetArchitectureWorkspace.tsx`.

### Frontend Conversation Pane Scroll Wiring

#### Task Group 5: `ConversationMainPane.tsx` scroll-to-decision wiring
**Dependencies:** Task Group 4 (the workspace prop-pipes `scrollToDecisionId` + clear callback into the conversation pane)

- [x] 5.0 Accept the scroll prop, stamp ids on `decision-captured` turns, scroll on mount + prop change
  - [x] 5.1 Add the two new props to `ConversationMainPane.tsx`
    - File: `frontend/src/components/Architecture/ConversationMainPane.tsx`
    - New optional prop: `scrollToDecisionId?: string | null`.
    - New optional prop: `onScrolledToDecision?: () => void` (the clear-callback from the workspace).
    - Update the component's TypeScript props interface.
  - [x] 5.2 Stamp `id="conv-turn-decision-${turn.decisionId}"` ONLY on turns of type `decision-captured` (Q2)
    - Locate the turn map (`turns.map((turn, idx) => ...)` around line 106 per requirements).
    - In the per-turn render switch / conditional, when `turn.kind === 'decision-captured'` (exact discriminator name per the `ConversationTurn` union), add `id={\`conv-turn-decision-${turn.decisionId}\`}` to the outermost rendered DOM node for that turn.
    - All other turn kinds: NO id attribute (no-op). Do not touch their render paths.
    - CRITICAL (Q2): the id uses `turn.decisionId`, NOT `turn.turnRef` or `turn.conversationTurnRef`. The `conversation_turn_ref` field stays unused in v1.
  - [x] 5.3 Add the scroll-on-mount + scroll-on-prop-change effect
    - `useEffect` with dependency array `[scrollToDecisionId]`.
    - On effect run: if `scrollToDecisionId` is non-null, find the DOM node via `document.getElementById(\`conv-turn-decision-${scrollToDecisionId}\`)`.
    - If the node exists: call `node.scrollIntoView({ behavior: 'smooth', block: 'center' })`. Then call `onScrolledToDecision?.()` to clear the prop in the workspace so the same id does not trigger again on re-render.
    - If the node does not exist (e.g. the conversation has not finished loading the turns yet): no-op, do NOT clear the prop. The effect will re-run when the turns finish loading and the parent re-renders. Optionally: add a second effect dependency on the turns list length so a late-arriving turn triggers a re-scroll.
    - Decide between the two strategies based on whether the conversation pane's turns are synchronously rendered on mount or asynchronously loaded. If async: include the turns-loaded signal in the dependency array.
  - [x] 5.4 No new test file at this layer
    - The 6-test cap (Q11) is fully consumed by Task Groups 2 + 3. Scroll-to-decision DOM behaviour is verified by manual smoke in Task Group 6.

**Acceptance Criteria:**
- `ConversationMainPane.tsx` accepts `scrollToDecisionId` and `onScrolledToDecision` props.
- Every `decision-captured` turn emits a stable `id="conv-turn-decision-${decisionId}"` attribute on its outermost rendered DOM node.
- Non-`decision-captured` turn render paths are untouched.
- The scroll effect fires on mount AND when `scrollToDecisionId` changes; calls `scrollIntoView` then invokes the clear callback.
- No regression to other turn rendering, no regression to existing `data-testid` attributes.
- ~20-40 LOC added.

### Verification

#### Task Group 6: End-to-end manual smoke + regression check
**Dependencies:** Task Groups 1-5

- [ ] 6.0 Manual smoke on a real target draft with actual captured decisions + final regression sweep
  - [ ] 6.1 Run the 6 frontend tests written in Task Groups 2 + 3
    - Command: `npm test -- CapturedDecisionChip.test.tsx TargetArchitectureCompareView.decisions.test.tsx` (or project equivalent).
    - Expected: all 6 pass.
  - [ ] 6.2 Run the wider frontend test suite for regression check
    - Command: `npm test` in `frontend/` (or project equivalent).
    - All previously-passing tests continue to pass. Pre-existing unrelated failures listed in CLAUDE.md may stay red - do NOT touch them.
  - [ ] 6.3 If a backend DTO change was required by Task 1.4, run the backend test suite for the affected service
    - Command: `mvn -pl architecture-model-service test` (or project equivalent).
    - All previously-passing tests continue to pass. No new tests required (the change is additive and serialisation-only).
    - SKIP this sub-task if no backend change was needed (the expected path).
  - [ ] 6.4 Manual smoke: architecture-scope banner
    - On a project with a target draft that has at least one architecture-scope captured decision (e.g. via the Architect Conversation flow), open the Compare View.
    - Confirm the architecture-scope banner appears ABOVE the Compare View panel (not inside any group header).
    - Confirm each banner chip's label is the decision's `decisionCode`.
  - [ ] 6.5 Manual smoke: per-row element-scope chips
    - On the same draft (assuming at least one element-scope decision exists), confirm the chip(s) appear inline within the matching row's Target cell, below the name/type lines.
    - Confirm the table still has exactly 5 columns.
    - Confirm rows without element-scope decisions show NO chip area (no `--` placeholder).
  - [ ] 6.6 Manual smoke: chip popover behaviour
    - Click any chip. Popover opens showing `answerSummary` (bold), `answerValue`, `standardsLookupRef` (if present), and "View in conversation" (if `conversationThreadId` is non-null).
    - Click outside the popover. Popover closes.
    - Reopen the popover. Press ESC. Popover closes.
    - Reopen the popover. Click the same chip again. Popover closes.
    - On a decision whose `conversationThreadId` is null: open the popover and confirm "View in conversation" is NOT rendered.
  - [ ] 6.7 Manual smoke: "View in conversation" navigation + scroll
    - Click "View in conversation" on a chip whose decision has non-null conversation refs.
    - Confirm the workspace's view-mode flips from `'compare'` to `'conversation'` (Architect Conversation tab becomes active).
    - Confirm the Architect Conversation pane scrolls smoothly to the `decision-captured` turn matching the clicked decision's `decisionId`.
    - Switch back to Compare View and click a DIFFERENT chip's "View in conversation". Confirm the scroll re-fires to the new turn (verifies the clear-callback + re-trigger contract).
  - [ ] 6.8 Manual smoke: edge cases
    - Target draft with ZERO captured decisions: Compare View renders normally, no banner, no chip groups, no error.
    - Target draft loaded with a slow network throttle: Compare View renders immediately (progressive enhancement Q9); banner + chips appear when the fetch resolves; no loading skeleton.
    - Force the captured-decisions fetch to fail (block the URL via devtools): Compare View renders normally, no banner, no chips, no error banner (silent fail-soft Q9).
  - [ ] 6.9 Final grep sweep
    - `frontend/src/` for `window.location.hash` introductions within the changed files - confirm none added (Q3 callback path, not URL hash).
    - `frontend/src/` for `conv-turn-decision-` confirms the id stamp only appears in `ConversationMainPane.tsx` and the workspace's wiring (Q2 decisionId path).
    - Confirm the Compare View `<thead>` still has exactly 5 `<th>` elements (Q4 no new column).

**Acceptance Criteria:**
- The 6 frontend tests pass.
- The wider frontend test suite is green (modulo pre-existing unrelated failures in CLAUDE.md).
- All seven manual smoke sub-tasks (6.4 through 6.8 plus the grep sweep in 6.9) verify successfully on a real target draft.
- Single commit covers all six task groups per the spec's Commit Boundary section (Q12).

## Execution Order

Recommended implementation sequence:
1. Task Group 1 - Frontend typed client + AMS DTO verification (foundation; the chip and integration depend on the type + the GET response shape).
2. Task Group 2 - Chip component + CSS (consumed by the Compare View integration in Group 3).
3. Task Group 3 - Compare View integration (banner + per-row chips; consumes the chip from Group 2).
4. Task Group 4 - Workspace data fetch + callback wiring (depends on Groups 1 + 3).
5. Task Group 5 - Conversation pane scroll wiring (depends on Group 4's prop-pipe).
6. Task Group 6 - Manual smoke + regression sweep (final gate before commit).

All six task groups land in a single commit per the spec's Commit Boundary section (Q12).
