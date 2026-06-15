# Specification: Compare View Decoration with Decision Codes

## Goal

Decorate the existing Compare View with read-only chips that surface captured architect decisions (architecture-scope in a header banner, element-scope inline on each row's Target cell), with a click-to-popover detail surface and a "View in conversation" callback that switches the workspace's view-mode tab and scrolls the Architect Conversation pane to the source `decision-captured` turn.

## User Stories

- As a migration architect reviewing the Compare View, I want to see the captured decisions that shaped each target element (e.g. `db.engine: PostgreSQL` on a data-entity row) so that I understand the *why* behind the target shape without leaving the Compare View tab.
- As an architect investigating a specific decision, I want to click a chip and jump straight to the conversation turn where that decision was captured so that I can read the full back-and-forth that produced it.

## Specific Requirements

**Frontend typed client for captured decisions**
- Verify whether `frontend/src/api/architectConversationApi.ts` already exposes a direct `GET /captured-decisions` caller. If yes, reuse; if not, add a new function (in that file or a new `frontend/src/api/targetStateCapturedDecisionsApi.ts`).
- Function signature: `listCapturedDecisions(projectId, targetArchitectureId, { includeSuperseded?: boolean = false }): Promise<CapturedDecisionDto[]>`.
- Type matches AMS `TargetStateCapturedDecisionDto` (camelCase via `@CamelCaseWire`): `decisionId, projectId, targetArchitectureId, decisionCode, scopeKind, scopeRefType, scopeRefId, answerValue, answerSummary, standardsLookupRef, conversationThreadId, conversationTurnRef, createdAt, createdByTask, supersededById`.
- Risk note (Q1): the gateway's `mapCapturedDecisionRow` (used by the conversation envelope) strips `conversationThreadId` + `conversationTurnRef`. The direct AMS DTO should surface them; spec-writer verifies during implementation. Tiny additive AMS DTO change ONLY if Q1 risk materialises.

**Gateway proxy reuse**
- Reuse the existing pass-through proxy in `gateway/src/routes/targetArchitectures.ts` (lines 602–779) for `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions`. No gateway change expected.
- If implementation verification finds the GET-list proxy missing despite the inventory note, add it as a thin pass-through forwarding `?includeSuperseded` verbatim.

**New `CapturedDecisionChip` component**
- New file `frontend/src/components/Architecture/CapturedDecisionChip.tsx` (~80–120 LOC).
- Props: `{ decision: CapturedDecisionDto; onOpenInConversation?: (decisionId: string) => void }`.
- Renders a small neutral-grey pill chip with `decisionCode` as the label.
- Click toggles a small floating popover (absolutely-positioned, anchored to chip) showing: `answerSummary` (bold, top), `answerValue` (full body), `standardsLookupRef` (small link/badge if non-null), and a "View in conversation" button (only when `conversationThreadId !== null`) that calls `onOpenInConversation(decision.decisionId)`.
- Popover dismissal: click-outside + ESC + click-chip-again, all three (Q8).
- Defense-in-depth: render nothing if `supersededById !== null` (caller is the primary filter; chip is belt-and-braces).

**CSS additions to `TargetArchitectureWorkspace.module.css`**
- `.capturedDecisionChip` — neutral-grey pill matching the existing `provenanceChipDefault` shape (border-radius 10px, padding 2px 8px, font-size 11–12px, font-weight 600).
- `.capturedDecisionChipGroup` — flex-wrap container for inline chip groups (used both in the Target cell and in the architecture-scope banner).
- `.capturedDecisionPopover` — floating popover positioned absolutely relative to the chip; reasonable right-edge clamping.
- `.architectureScopeDecisionsBanner` — horizontal banner sitting above the entire `compareViewPanel`.

**Compare View — architecture-scope banner**
- Q6 placement: the banner sits ABOVE the entire `compareViewPanel`, not above the first group header. Frames the whole compare surface as "with these architecture-wide defaults applied".
- Render the new `.architectureScopeDecisionsBanner` containing one `CapturedDecisionChip` per `decision.scopeKind === 'architecture'` entry.
- Render nothing when zero architecture-scope decisions exist (no empty-state noise).
- Forwards the parent's `onOpenInConversation` callback to each chip.

**Compare View — per-row element-scope chips (inline in Target cell)**
- Q4 decoration shape: inline within the existing Target cell, stacked BELOW the name/type lines. Table stays at 5 columns (Current / Mapping / Target / Provenance / Status). Does NOT introduce a new column.
- For each row, render a `.capturedDecisionChipGroup` inside the Target cell containing one `CapturedDecisionChip` per `decision.scopeKind === 'element' AND decision.scopeRefId === targetElementId` entry.
- Render nothing when zero element-scope decisions match (no `--` placeholder added; existing column placeholders unchanged).
- Brand-new (target-only) rows get the same element-scope decoration logic — element-scope decisions can attach to brand-new target elements.
- Current-only (decommissioned) rows get no element-scope chips (no target element exists to attach to).
- Q5 overflow: plain `flex-wrap` within the Target cell. Row height grows as needed. "+N more" affordance deferred to v2.

**`TargetArchitectureCompareView.tsx` prop changes**
- New props: `capturedDecisions: CapturedDecisionDto[]` (latest-only — superseded filter applied at workspace level) and `onOpenInConversation?: (decisionId: string) => void`.
- Above the existing `groupKeys.map(...)` block, render the new architecture-scope banner.
- All chip click events forward `onOpenInConversation` to the parent.
- ~30–50 LOC added.

**`TargetArchitectureWorkspace.tsx` changes**
- Fetch captured decisions via `listCapturedDecisions(projectId, targetArchitectureId)` on mount + when the selected target draft changes. `useEffect` + `useState`. Q9: progressive enhancement — Compare table renders immediately; banner + chips appear when fetch resolves. Silent fail-soft on error (matches existing workspace pattern around line 673–678).
- Filter to `supersededById === null` (defense in depth; API default already does this — pass `includeSuperseded=false` explicitly).
- New transient state `scrollToDecisionId: string | null`, set when a chip's "View in conversation" fires; cleared by the conversation pane after it scrolls.
- New callback `handleOpenInConversation(decisionId: string)` does: `setViewMode('conversation')` + `setScrollToDecisionId(decisionId)`.
- Pass `capturedDecisions` + `handleOpenInConversation` down to `TargetArchitectureCompareView`.
- Pass `scrollToDecisionId` + a clear-callback down to the Architect Conversation pane.
- ~40–60 LOC added.

**Navigation: callback path, NOT URL hash (Q3 override of raw-idea Q6)**
- `viewMode` in `TargetArchitectureWorkspace.tsx` is local `useState`, not URL-driven, so a URL hash alone cannot switch the tab.
- Chip's "View in conversation" calls `onOpenInConversation(decisionId)` → workspace `setViewMode('conversation')` + stashes `scrollToDecisionId` in transient state → conversation pane reads on mount + when prop changes, scrolls, then invokes the clear callback so the same id doesn't trigger again on re-render.
- No URL plumbing, no `window.hashchange` subscription, no history pollution.

**Conversation turn anchoring by `decisionId`, NOT `turn_ref` (Q2)**
- In `ConversationMainPane.tsx`, emit `id="conv-turn-decision-${turn.decisionId}"` ONLY on turns of type `decision-captured` (which exist for every captured row by construction). No-op for other turn types.
- The `conversation_turn_ref` field stays unused in v1; v2 can do proper turn-ref plumbing if needed.
- Pure UI-side change; no AMS / gateway / payload changes.

**`ConversationMainPane.tsx` changes**
- New optional prop `scrollToDecisionId?: string | null` + clear callback prop.
- On mount AND when `scrollToDecisionId` changes (and is non-null), find the DOM node with `id="conv-turn-decision-${scrollToDecisionId}"` and call `scrollIntoView({ behavior: 'smooth', block: 'center' })`. Then invoke the clear callback so the same id doesn't trigger again on re-render.
- Add the `id` attribute to every `decision-captured` turn render path.
- ~20–40 LOC added.

**Tests (6 frontend, 0 backend — Q11)**
- Banner renders when ≥1 architecture-scope decision exists.
- Banner hidden when zero architecture-scope decisions.
- Per-row chips render for matching element-scope decisions; defense-in-depth assertion that `supersededById !== null` rows are filtered out even if returned.
- Chip click opens popover with `answerValue` + `standardsLookupRef` + "View in conversation" link when conversation refs exist.
- Popover hides "View in conversation" link when conversation refs are null.
- "View in conversation" callback switches viewMode to `'conversation'` and sets `scrollToDecisionId`.

## Existing Code to Leverage

**`gateway/src/routes/targetArchitectures.ts` (lines 602–779) — captured-decisions proxy**
- Already exposes full pass-through proxies for the AMS captured-decisions REST surface, including `GET /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions` with `?includeSuperseded` forwarded verbatim.
- Reused as-is by the new frontend typed client. No gateway change expected.

**`frontend/src/api/architectConversationApi.ts` — `CapturedDecisionRow` type + envelope loader**
- Existing `CapturedDecisionRow` interface (lines 262–289) declares most of the fields the new chip needs. Spec verifies whether `conversationThreadId` + `conversationTurnRef` are present; extends or re-declares the type in the new client to include them.
- Existing `loadConversation()` and envelope shape stay untouched; the new client calls AMS directly for the latest-decisions list.

**`TargetArchitectureWorkspace.tsx` lazy-fetch pattern (lines 644–683)**
- Existing `useEffect` already parallel-fetches Compare View data (`getElementsInventory`, `listDecommissionedInTargetAnnotations`, `listArchitectureMappings`) on view-mode switch with silent fail-soft on error.
- New captured-decisions fetch slots into the same orchestration shape and pipes a new `capturedDecisions` prop into `TargetArchitectureCompareView`.

**`TargetArchitectureWorkspace.module.css` chip pattern**
- Existing `.provenanceChip` (+ variants), `.decommissionChip`, `.decomInTargetChip`, `.brandNewChip` define the small-pill aesthetic (border-radius 10px, padding 2px 8px, font-size 11–12px, font-weight 600).
- New `.capturedDecisionChip` style adds next to them, reusing the same visual contract with a neutral-grey palette matching `provenanceChipDefault`.

**`ConversationMainPane.tsx` turn rendering**
- Existing turn map (`key={`${turn.kind}-${idx}`}`) renders each `ConversationTurn` with a `data-testid` but no stable DOM `id`. The spec adds an `id="conv-turn-decision-${decisionId}"` attribute ONLY on `decision-captured` turns — a minimal, additive change that does not alter any other turn-kind rendering.

## Out of Scope

- Service-scope or interface-scope decoration (v2 — requires element → owning-service resolution that the Compare View doesn't have today).
- Decision creation / revision from the Compare View. Architect Conversation tab stays the single writer.
- Reverse "decisions → affected rows" surface.
- Color-coding chips by `decision_code` prefix family (e.g. `db.*` blue, `api.*` green). Single neutral-grey chip in v1 (Q7).
- Hover tooltips on chips — click-only popover (Q10). Two interaction modes for one chip is overkill.
- Decoration of the Mapping Review modal / Selective Copy wizard surfaces.
- Changes to the Provenance + Status placeholder `--` columns. Untouched.
- Backend persistence changes — no schema, no new endpoints, no new controllers.
- Supersession history UI.
- "+N more" affordance for chip overflow within the Target cell (v2 if real-world overflow surfaces).
- Hash-based URL routing for tab switching — callback path used instead (Q3 overrides raw-idea Q6).
- Surfacing the `conversation_turn_ref` field on the wire — matching by `decisionId` instead (Q2). The `conversation_turn_ref` column stays unused in v1.
