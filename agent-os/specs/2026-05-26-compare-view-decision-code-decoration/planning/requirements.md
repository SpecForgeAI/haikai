# Spec Requirements: Compare View Decoration with Decision Codes

## Initial Description

See `planning/raw-idea.md` for the full design. Summary: decorate the Compare View
(`TargetArchitectureCompareView.tsx`) with captured-decisions chips — architecture-scope
decisions in a header banner, element-scope decisions inline per row. Read-only.
Click chip → small popover with answer + standards ref + "View in conversation" link.
v1 covers architecture + element scopes only (service / interface deferred).

---

## Validated Reuse Inventory (investigation findings)

### Gateway proxy — ALREADY EXISTS, REUSE AS-IS

`gateway/src/routes/targetArchitectures.ts` (lines 602–779) already exposes pure
pass-through proxies for the full AMS captured-decisions REST surface, including:

- `GET  /api/projects/:projectId/target-architectures/:targetArchitectureId/captured-decisions`
  — forwards `?includeSuperseded` verbatim. Defaults to latest-only.
- `POST` / `GET /:decisionId` / `GET /by-code/:decisionCode` also wired.
- Plus `GET /api/projects/:projectId/active-target-architecture-id`.

**No gateway change required for this spec.**

### Frontend typed client — DOES NOT EXIST FOR DIRECT `GET captured-decisions`

There is no dedicated `targetStateCapturedDecisionsApi.ts` client file. The two
closest neighbours are:

1. **`frontend/src/api/architectConversationApi.ts`** — exposes `loadConversation()`
   which returns a `ConversationEnvelope` whose `capturedDecisions: CapturedDecisionRow[]`
   field is server-side-derived inside the gateway's `/architect-conversation` route
   handler (calls `fetchLatestCapturedDecisions` internally). It does NOT call the
   AMS `GET /captured-decisions` endpoint directly from the browser — it goes through
   the envelope-shaped conversation endpoint.

2. **`frontend/src/api/epicCapturedDecisionsApi.ts`** — a totally different entity
   (epic-scoped, snake_case + camelCase tolerant). Not reusable; different table /
   route structure.

**Conclusion:** The spec must ADD a small new file
`frontend/src/api/targetStateCapturedDecisionsApi.ts` that calls the existing
gateway proxy. Type can match (or import) the existing `CapturedDecisionRow`
shape already declared in `architectConversationApi.ts` (lines 262–289), so we
should re-export / import that type rather than redeclaring it.

The existing `CapturedDecisionRow` interface already has all the fields the spec
needs: `decisionId, decisionCode, scopeKind, scopeRefType, scopeRefId, answerValue,
answerSummary, standardsLookupRef, supersededById, createdByTask`. **It is missing
`conversationThreadId` and `conversationTurnRef`** which the raw-idea calls out as
required for the "View in conversation" link. **This is a meaningful surprise — see
"Surprises" below.**

### Existing chip / popover primitives — NONE GENERIC, BUT LOCAL PATTERNS EXIST

- **No** generic Chip or Popover/Tooltip component in `frontend/src/components/common/`.
- **No** other reusable popover anywhere in the codebase.
- Local chip patterns exist in `TargetArchitectureWorkspace.module.css`:
  `.provenanceChip` (+ 5 variants), `.decommissionChip`, `.decomInTargetChip`,
  `.brandNewChip` — all small pills with `border-radius: 10px; padding: 2px 8px;
  font-size: 11–12px; font-weight: 600;`. The new captured-decision chip should
  reuse this exact visual contract (probably add a `.decisionCodeChip` style next
  to them).
- A specialised chip pattern with click-to-popover doesn't exist anywhere —
  this spec is the first popover-on-chip surface.

**Conclusion:** The spec must add a new `CapturedDecisionChip.tsx` component
plus a popover element. The popover can be implemented with vanilla CSS
absolute-positioning + a React portal (or inline absolute child since the
parent cells aren't deeply nested). No new dependency.

### Scroll-to-turn wiring in the Architect Conversation tab — DOES NOT EXIST

Investigation of `ArchitectConversationTab.tsx` + `ConversationMainPane.tsx`:

- Each turn renders with a `data-testid` (e.g. `architect-conversation-turn-question-${decisionCode}`)
  but NO stable DOM `id` per turn.
- The only `scrollIntoView` call is for the SummaryPanel (line 568) — pre-fill
  review affordance, not turn-anchored.
- No `window.location.hash` reading anywhere in the conversation pane.
- Turn objects themselves have no stable `turnRef` in the typed shape
  (`ConversationTurn` union in `architectConversationApi.ts` lines 92–256) —
  they're keyed by `(kind, decisionCode, roundIndex)` in the UI map (line 106:
  `key={\`${turn.kind}-${idx}\`}`).

**This is the second meaningful surprise — see "Surprises" below.**

### Workspace data-loading pattern — CLEAN PLACE TO ADD `useEffect`

`TargetArchitectureWorkspace.tsx` already fetches Compare View data lazily on
view-mode switch (lines 644–683): when `viewMode === 'compare'`, parallel-fetch
`getElementsInventory`, `listDecommissionedInTargetAnnotations`,
`listArchitectureMappings`. Captured-decisions fetch should slot into the same
`Promise.all` block and pipe a new `capturedDecisions` prop into
`TargetArchitectureCompareView`. Clean, low-risk addition.

The workspace already passes `currentInventory`, `targetInventory`, `mappings`,
`decommissionedAnnotations` to the Compare View — adding a fifth prop is the
natural pattern.

### View-mode is local React state, not URL-driven — NAVIGATION SURPRISE

The `viewMode` ('table' | 'compare' | 'conversation') is `useState` inside the
workspace (line 237). Switching tabs is `setViewMode(...)`. **There is no URL
mechanism to deep-link to a specific view-mode.** The URL only goes as deep as
`/projects/:p/architectures/:a/architecture-design/target-state`.

So a "View in conversation" link from the popover that needs to:
1. Switch viewMode to `'conversation'`, AND
2. Scroll the conversation pane to a specific turn,

…cannot be a plain `<a href="...#conv-turn-X">` because clicking that wouldn't
flip viewMode from 'compare' to 'conversation'. Two options for v1:

- **(a)** URL hash + workspace reads hash on mount → if hash matches
  `#conv-turn-...`, calls `setViewMode('conversation')` AND passes the turnRef
  down to the conversation tab via a prop, which then scrolls to the matching
  DOM `id` after the turns render. Hash is consumed once and cleared.
- **(b)** Plain callback up to the workspace: `onOpenInConversation(turnRef)`
  → workspace calls `setViewMode('conversation')` and stuffs the turnRef into
  a transient state slot that's prop-piped to the conversation tab.

Both work. **(b) is simpler — no URL plumbing, no hash-parse on mount, no
history pollution, no risk of stale hashes lingering when the user switches
view-modes back.** I recommend (b) and call out the question below.

---

## Surprises / Hidden Constraints

### Surprise 1 — Captured-decisions wire does NOT carry `conversation_thread_id` / `conversation_turn_ref`

The raw-idea assumes these fields are populated and clickable. Checking the
existing `CapturedDecisionRow` interface (`architectConversationApi.ts` line 262)
and the gateway mapper (`architectConversation.ts` line 497, function
`mapCapturedDecisionRow`): **these fields are not on the wire shape at all.**

The AMS DTO `TargetStateCapturedDecisionDto` (per spec context) does carry
`conversationThreadId, conversationTurnRef`, but the gateway's existing
envelope-mapper strips them out. Two possibilities:

- The AMS endpoint `GET .../captured-decisions` (called directly by this spec's
  new client) might return these fields — they're persisted in the DB per Spec
  2026-05-24. **The spec's new typed client should declare them as
  `conversationThreadId: string | null` and `conversationTurnRef: string | null`
  and trust the AMS DTO surfaces them.**
- If AMS doesn't actually surface them on the read DTO, this spec would need
  a tiny AMS DTO update — that would push it out of "pure frontend" territory.

**Action:** the spec-writer should verify the AMS DTO surfaces these two fields
on the GET read path. If yes — no AMS change. If no — that's a meaningful scope
addition (and a Q to flag).

### Surprise 2 — Conversation turns have no stable `id` to scroll to

Turn DOM nodes are keyed by `(kind, idx)` in the React map but have no `id`
attribute, only `data-testid` (which itself isn't unique for many turn kinds —
`turn-cascade-summary-readonly` is a fixed string, not per-turn).

For "View in conversation" to scroll to a specific turn, the conversation pane
MUST emit `id="conv-turn-<conversationTurnRef>"` on each turn DOM node. That's
a small additive change to `ConversationMainPane.tsx` — every turn gains an
`id` attribute derived from a `turnRef` that... **doesn't exist on the typed
turn payload.**

Two interpretations:
- The `conversation_turn_ref` field on the captured-decision row points to
  some external identifier of the turn that isn't actually carried on the turn
  itself today. If so, this spec would need to surface that ref ON the turn
  payload too — which is a non-trivial change to `turnShape.ts`.
- OR: the `conversation_turn_ref` is derivable from `(decisionCode, roundIndex)`
  or similar — in which case the scroll target can be computed by matching the
  decision-code on a `decision-captured` turn.

**Action:** the spec-writer should clarify what `conversation_turn_ref` actually
maps to in DOM terms. If it's a UUID or stable id stamped at write time and
NOT presently surfaced on the turn payload, this spec's scroll-to-turn
sub-feature gets meaningfully bigger. Defer-to-v2 might be the right call.

### Surprise 3 — Spec already specified URL hash navigation as the chosen mechanism (raw-idea Q6), but the workspace's view-mode is not URL-driven

The raw-idea's "instinct: URL hash" answer to Q6 doesn't account for the fact
that viewMode is local state. URL hash alone won't switch tabs. The spec needs
EITHER the workspace to subscribe to `window.hashchange` AND `setViewMode` from
the hash (more code, history side-effects), OR a plain callback path (simpler).
I recommend the callback path — flagged in Q6 below.

---

## Reusability Opportunities Summary

| Layer | Reuse | New work |
|---|---|---|
| Gateway proxy | `targetArchitectures.ts` proxy — full reuse, no change | None |
| Frontend client | None for this endpoint | Add `targetStateCapturedDecisionsApi.ts` (~30 LOC) |
| Type | `CapturedDecisionRow` from `architectConversationApi.ts` | Extend with `conversationThreadId`, `conversationTurnRef` (or declare in new file and keep separate from the conversation envelope's row type) |
| Chip CSS | `provenanceChip` / `decomInTargetChip` pattern in `TargetArchitectureWorkspace.module.css` | Add `.decisionCodeChip` style next to them |
| Popover | None | New component (inline absolute positioning, ~50 LOC, no library) |
| Data fetch | `TargetArchitectureWorkspace` lazy-fetch `useEffect` (line 644) | Slot a 4th promise into the `Promise.all` |
| Compare view | `TargetArchitectureCompareView.tsx` — accepts presentational props | Add `capturedDecisions` prop + render banner + render per-row chips |
| Conversation scroll | None — no scroll-to-turn wiring exists | Add `id="conv-turn-..."` per turn in `ConversationMainPane` + read a prop into `ArchitectConversationTab` (or, defer scroll-to-turn to v2 and only switch the tab) |

---

## Open Questions for the User

(See message body — relayed to the user.)

---

## Accepted Answers (placeholder)

### Accepted Answers (2026-05-26)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 AMS DTO conversation refs (risk note).** Assume `conversationThreadId`
  + `conversationTurnRef` ARE surfaced on the `GET /captured-decisions`
  AMS response — the DTO definition includes them. Spec-writer verifies
  during implementation; tiny additive AMS change if missing. Risk flagged
  but does not block.
- **Q2 Conversation turn navigation by `decisionId`, not `turn_ref`.**
  Emit `id="conv-turn-decision-${decisionId}"` only on `decision-captured`
  turns (which exist for every captured row by construction). Pure
  UI-side; no AMS / gateway / payload changes. The `conversation_turn_ref`
  field stays unused in v1; v2 can do proper plumbing if needed.
- **Q3 Navigation: callback path, NOT URL hash.** The viewMode tabs in
  `TargetArchitectureWorkspace.tsx` are local `useState`, not URL-driven,
  so URL hash alone can't switch from Compare to Architect Conversation.
  Chip's "View in conversation" calls
  `onOpenInConversation(decisionId)` → workspace
  `setViewMode('conversation')` + stashes `scrollToDecisionId` into
  transient state → conversation pane reads the prop, scrolls + clears
  on mount. Overrides raw-idea Q6.
- **Q4 Decoration shape: inline within Target element cell, NOT a new
  column.** Stacked below the name/type lines in the existing Target
  cell. Keeps the column count at 5 (Current / Mapping / Target /
  Provenance / Status); visually associates decisions with the element
  they pertain to. Overrides raw-idea Q1.
- **Q5 Volume cap: plain `flex-wrap`** within the Target cell when
  decisions overflow. Row height grows. "+N more" affordance deferred
  to v2 if real-world overflow surfaces.
- **Q6 Architecture-scope banner: above the entire `compareViewPanel`,**
  not above the first group header. Frames the whole compare surface
  as "with these architecture-wide defaults applied". Refines raw-idea's
  positioning.
- **Q7 Chip color: single neutral grey,** matching existing
  `provenanceChipDefault`. Color-coding by `db.*` / `api.*` / `service.*`
  prefix deferred to v2; requires a curated palette this spec doesn't
  own.
- **Q8 Popover dismissal:** click-outside + ESC + click-chip-again, all
  three. Standard a11y expectation, ~5 LOC with a `useEffect` +
  document-level event listener.
- **Q9 Loading state: progressive enhancement,** no gating. Compare
  table renders immediately on existing inventory + mappings data;
  banner + chips appear when decisions fetch resolves. Fetch failure =
  silent no-op (matches existing workspace fail-soft pattern).
- **Q10 Click-only popover, no hover tooltip.** `answerSummary`
  prominent at top of popover; `answerValue` below; `standardsLookupRef`
  rendered as a small link/badge; "View in conversation" link (when
  refs exist). Two interaction modes for one chip is overkill.
- **Q11 Test cap: 6 frontend tests, 0 backend.**
  1. Banner renders when ≥1 architecture-scope decision exists.
  2. Banner hidden when zero architecture-scope decisions.
  3. Per-row chips render for matching element-scope decisions (and
     defense-in-depth `supersededById !== null` filter excludes
     superseded rows even if returned).
  4. Chip click opens popover with answer_value + standards_lookup_ref
     + "View in conversation" link when conversation refs exist.
  5. Popover hides "View in conversation" link when conversation refs
     are null.
  6. "View in conversation" callback switches viewMode to conversation
     (matches Q3's callback shape).
- **Q12 Single commit boundary.** No gateway change needed (existing
  proxy reused). All-frontend, ~250-350 LOC: 1 new typed-client method
  (or reuse if `architectConversationApi.ts` already exports something
  matching), 1 new `CapturedDecisionChip` component, mods to 3 files
  (`TargetArchitectureWorkspace.tsx` to fetch + propagate, 
  `TargetArchitectureCompareView.tsx` to render banner + per-row chips,
  `ConversationMainPane.tsx` to accept + act on the scroll-to-decision
  prop), 1 CSS addition for the chip + popover, 6 tests.

---

## Visual Assets

No visual assets requested or expected — this is a code-only spec on an
existing surface. The chip + popover follow the existing pill aesthetic in
`TargetArchitectureWorkspace.module.css`.
