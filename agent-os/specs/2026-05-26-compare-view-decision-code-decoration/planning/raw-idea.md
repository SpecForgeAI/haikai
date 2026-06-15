# Raw Idea: Compare View Decoration with Decision Codes

## Why this spec exists

The existing **Compare View** (`frontend/src/components/Architecture/TargetArchitectureCompareView.tsx`, 358 LOC) renders a stacked-rows comparison table contrasting the current architecture against a selected target draft. Five columns: Current element / Mapping / Target element / Provenance / Status. Each row tells the user *what* the target shape is — but not *why* the architect chose it.

Meanwhile, the **target_state_captured_decisions** table (shipped 2026-05-24) is rich with the *why*: every architect-conversation answer is persisted as a captured-decision row, keyed by `decision_code` (e.g. `db.engine`, `api.protocol`, `service.framework`), scoped at one of four levels (`architecture` / `service` / `interface` / `element`), and carrying the architect's answer + summary + standards reference + conversation turn pointer.

Today the Compare View has zero awareness of captured decisions. To answer "why is the target using PostgreSQL?" a user has to switch to the Architect Conversation tab, find the right decision, and mentally correlate it back to the compare row they were looking at. That's a workflow gap with a small fix.

This spec decorates each Compare View row with the captured decisions that apply to that row — architecture-wide defaults rendered in a header banner, element-specific overrides rendered as inline chips on the target element column. Click a chip → small popover showing the full answer + a link to the conversation turn that produced it.

This is a **read-only decoration** — no schema changes, no new decisions get created, no decision-lifecycle logic added. The infrastructure to fetch + display already exists; this spec is the threading.

## What this spec is (and isn't)

**This spec is:**

- A new "Decisions" panel/banner above the Compare View table showing **architecture-scope** captured decisions for the selected target draft.
- A new "Decisions" column (or inline chip group within the Target element cell — implementer's choice based on visual density) on each Compare View row, populated with **element-scope** captured decisions whose `scope_ref_id` matches the row's target element id.
- A small popover (or tooltip → click → modal) per chip showing the full `answer_value` + `answer_summary` + `standards_lookup_ref` + a link to the Architect Conversation tab scrolled/anchored to the source conversation turn (if `conversation_thread_id` + `conversation_turn_ref` are populated).
- Use the existing AMS endpoint `GET /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions` (no `?includeSuperseded` — we only show the latest per scope). No new AMS work needed.
- Use whatever existing gateway proxy / typed-client wrapper Spec 2 of the migration-workflow rework (`2026-05-24-target-state-captured-decisions-data-plane`) already shipped. If none exists for this read endpoint, add a thin proxy + client method.
- A small client-side grouping helper that buckets the fetched decisions by `(scope_kind, scope_ref_id)` for fast per-row lookup.

**This spec is not:**

- A change to the captured-decisions data plane (no new fields, no new endpoints, no schema changes).
- A change to the Architect Conversation tab.
- A new decision-creation flow from inside the Compare View. Decisions are still created exclusively in the Architect Conversation tab.
- A reverse-direction "for this decision code, which Compare View rows are affected?" surface. Out of scope (probably a v2 if useful).
- A way to **edit** a decision from the Compare View. Read-only. The popover may link to the source conversation turn for context, but does not enable revision in-place.
- A decision-impact analytics surface ("which decisions affect the most elements?"). Out of scope.
- Service-scope or interface-scope decoration in v1. The Compare View today does not surface element → owning service / interface membership (the row-grouping uses physical-domain buckets, not logical service membership). Decorating service-scope decisions per-row would require resolving service-membership for every target element, which adds non-trivial logic. **v1: architecture-scope + element-scope only.** Service / interface scope deferred to v2.
- A change to the existing 5-column layout structure beyond adding the new chip column (or in-cell chips). Provenance and Status columns stay as `--` placeholders, untouched.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Read-only decoration.** No write paths into captured-decisions from the Compare View. Architect Conversation tab stays the single writer.
2. **Reuse existing AMS endpoint** (`GET /captured-decisions`, latest-only by default). No new AMS persistence, no new controller. Already returns exactly what we need.
3. **v1 scope: architecture-scope + element-scope only.** Service-scope and interface-scope deferred to v2 because the Compare View doesn't currently know which service / interface a target element belongs to.
4. **Architecture-scope decisions render in a header banner** above the table; element-scope decisions render as inline chips per row.
5. **Decision-code is the chip label.** Hover shows `answer_summary` (short); click opens a popover with `answer_value` (full) + `standards_lookup_ref` + a link back to the conversation.
6. **No decision-lifecycle UI in this spec.** No supersession history shown. The view shows the LATEST decision per scope only (default API behaviour).
7. **One commit boundary** (Small-medium spec, no per-layer split needed unless the implementer prefers).
8. **No new test files for the captured-decisions plumbing itself** — that's already covered by Spec 2026-05-24. New tests cover only the Compare View decoration behaviour.

## Specific requirements (rough — let shape-spec refine)

### Frontend client

If a typed client doesn't already exist for this endpoint, add one:

- New file `frontend/src/api/targetStateCapturedDecisionsApi.ts` (or extension to an existing file if there is one) with:
  - TypeScript type `CapturedDecisionDto` (camelCase per `@CamelCaseWire` on the AMS DTO — Spec 2 made this DTO camelCase explicitly).
  - Function `listCapturedDecisions(projectId, targetArchitectureId, { includeSuperseded? = false })` returning `CapturedDecisionDto[]`.

(Check `frontend/src/api/architectConversationApi.ts` first — given the Architect Conversation tab consumes these too, the client may already exist there.)

### Gateway proxy

If no gateway proxy already exists for the `GET /captured-decisions` endpoint, add one as a thin pass-through. Otherwise no gateway change.

### Compare View — header banner (architecture-scope)

In `TargetArchitectureCompareView.tsx`, above the first group header (`<h4>Components</h4>`), render a new "Architecture decisions" banner when at least one decision with `scope_kind === 'architecture'` exists for the selected target architecture:

```
┌─ Architecture decisions ──────────────────────────────────────────┐
│ [db.engine: PostgreSQL]  [api.protocol: REST/OpenAPI]            │
│ [service.framework: Spring Boot]  [auth.protocol: OAuth2/OIDC]   │
└────────────────────────────────────────────────────────────────────┘
```

Each chip:
- Label: `decision_code` (e.g. `db.engine`).
- Hover tooltip: `answer_summary` (or `answer_value` if summary is null).
- Click: opens a small popover with full `answer_value`, `standards_lookup_ref` (if non-null, rendered as a small link/badge), and a "View in conversation" link (if `conversation_thread_id` + `conversation_turn_ref` are populated) that navigates to the Architect Conversation tab anchored on the source turn.

When zero architecture-scope decisions exist for the target: don't render the banner at all (no empty-state noise).

### Compare View — per-row decoration (element-scope)

Add a new column "Decisions" between Target element and Provenance (so columns become: Current / Mapping / Target / **Decisions** / Provenance / Status), OR render the chip group inline within the Target element cell (visually denser). Shape-spec to pick based on responsive-design concerns.

For each row:
- Look up captured decisions where `scope_kind === 'element'` AND `scope_ref_id === <row.targetElementId>`.
- Render one chip per matching decision (same chip shape as the banner).
- Brand-new rows (target-only): same lookup applies — element-scope decisions can attach to brand-new target elements.
- Current-only rows (decommissioned): no element-scope chips (the target element doesn't exist).

When zero element-scope decisions attach to a target element: render `--` in the new column (matches the existing placeholder convention).

### Chip + popover component

A small reusable component, e.g. `frontend/src/components/Architecture/CapturedDecisionChip.tsx`:

```ts
interface CapturedDecisionChipProps {
  decision: CapturedDecisionDto;
  onOpenInConversation?: (threadId: string, turnRef: string) => void;
}
```

Reusable across the header banner and the per-row cells.

### Conversation-link navigation

When the user clicks "View in conversation" in the popover:

- Navigate to `/projects/:p/architectures/:a/architecture-design/target-state` (the existing target-state tab route).
- Switch the sub-tab to "Architect Conversation".
- Scroll/anchor to the conversation turn identified by `conversation_thread_id` + `conversation_turn_ref`.

If the conversation thread / turn refs are null (older decisions): the link is hidden, popover shows answer + standards-ref only.

The scroll-to-turn behaviour requires that the Architect Conversation tab read these query params or hash anchor and act on them. **If that wiring doesn't already exist, this spec adds a minimal version**: a hash anchor (`#conv-turn-<turnRef>`) the conversation pane scrolls to on mount. No deep React-Router state plumbing.

### Tests

- Compare View renders the architecture-decisions banner when decisions exist (and does not when they don't).
- Per-row element-scope decoration: a target element with N element-scope decisions renders N chips on its row.
- Chip popover shows answer_value + standards_lookup_ref + conversation link when applicable.
- Decisions with null conversation refs render the popover without the link.
- Latest-only behaviour: the view does NOT show superseded decisions even if the API somehow returned them (defense in depth — passes `includeSuperseded=false`).

Target test count: 4-6 frontend tests. No backend tests (no backend changes).

### Verification

- Open a target draft Compare View. Confirm the architecture-decisions banner appears with the chips for whatever decisions were captured during the Architect Conversation.
- Confirm element-scope decisions appear as chips on the rows for the elements they target.
- Confirm clicking a chip opens the popover with full answer + standards link + "View in conversation" link (when conversation refs exist).
- Confirm "View in conversation" navigates to the Architect Conversation tab and scrolls to the right turn.
- Confirm zero existing tests regress.

## Out of Scope

- Service-scope or interface-scope decoration (deferred to v2 — requires element → owning-service resolution that the Compare View doesn't have today).
- Decision-impact analytics ("which decisions affect the most elements?").
- Decision creation / revision from the Compare View. Architect Conversation tab stays the single writer.
- Supersession history UI.
- New AMS endpoints / persistence changes.
- Changes to the Provenance + Status placeholder columns. They stay `--` until a separate spec surfaces those fields on the AMS inventory wire.
- Changes to the Architect Conversation tab beyond the minimal scroll-to-turn wiring (and even that is conditional: skip if it already exists).
- A reverse "decisions → affected rows" surface.
- Decoration of the existing Mapping Review modal (selective copy) — out of scope; that's a different surface.
- A change to the Compare View's row grouping (still domain buckets: components / APIs / data entities / infrastructure).
- A new captured-decision API client wholesale — reuse if one exists; add minimally if not.

## Dependencies

- `2026-05-24-target-state-captured-decisions-data-plane` (shipped) — provides the `target_state_captured_decisions` table, AMS DTOs/controllers, and (presumably) the gateway proxy + frontend client this spec consumes.
- `2026-05-24-target-state-architect-conversation` (shipped) — provides the Architect Conversation tab that this spec links back to from the popover.
- `2026-05-20-target-architecture-authoring-flow` (shipped) — provides the Compare View itself.
- `2026-05-24-target-state-subtab-deterministic-suggest` (shipped) — removed the workspace-side provenance overlay map; this spec is compatible with the resulting `--` placeholder convention on Provenance/Status.

No new external dependencies.

## Open questions for shape-spec to clarify

1. **Decoration shape — new column vs inline-in-Target-cell?** New column is layout-cleaner; inline is visually denser. My instinct: **new column**, between Target and Provenance. Cleaner for users scanning; doesn't compress Target element cell.

2. **Existing frontend client?** Verify whether `frontend/src/api/targetStateCapturedDecisionsApi.ts` (or equivalent) already exists from Spec 2. If yes, extend; if no, add. The investigation script — `grep -l "captured-decisions" frontend/src/api/` — will answer this.

3. **Existing gateway proxy?** Verify whether `GET /api/projects/.../target-architectures/.../captured-decisions` is already proxied. If yes, reuse; if no, add a thin proxy.

4. **Chip color-coding?** All chips one neutral color, or color-coded by decision_code prefix (e.g. `db.*` blue, `api.*` green, `service.*` purple)? My instinct: **one neutral color** in v1; color-coding adds visual interest but also visual noise and requires a curated palette per code-prefix family that the spec doesn't own.

5. **Popover vs modal?** Click on chip → small floating popover (anchored to chip) vs full modal (overlay)? My instinct: **popover** — modal is too heavy for what's essentially a tooltip with details. CSS positioning needs reasonable care for chips near the right edge.

6. **"View in conversation" navigation — anchor-only vs full router state?** If we're adding scroll-to-turn wiring, do we update the URL hash or push a route with state? My instinct: **URL hash** — simpler, browser-natural, doesn't pollute history.

7. **What if `conversation_thread_id` is set but `conversation_turn_ref` isn't?** Render the link as "View in conversation" without anchor, or hide it? My instinct: **render without anchor** (it still scrolls them to the conversation; less precise but better than nothing).

8. **Latest-only enforcement.** The API defaults to latest-only; the client should explicitly pass `includeSuperseded=false` as defense in depth, AND the rendering should filter `superseded_by_id !== null` rows just in case. My instinct: **belt-and-braces both**.

9. **Loading state.** While the decisions are loading, render the banner skeleton + chips as `…`? Or just don't render the banner until ready? My instinct: **don't render until ready** — Compare View is already a heavy table; a slow-loading decisions fetch shouldn't gate it. Banner and chips appear once available.

10. **Commit boundary.** One commit covering everything (small frontend + maybe small gateway) vs split per layer? My instinct: **one commit** — this is genuinely small-medium and the per-layer split for this spec is overkill.

11. **Test cap.** 4-6 frontend tests; 0 backend tests. Confirm? My instinct: **yes**. No backend changes, so backend tests aren't applicable.

## Verification

After this spec:
- Compare View opens for a target draft with captured decisions → architecture-scope decisions appear in a header banner; element-scope decisions appear as chips on the matching rows.
- Clicking a chip opens a popover with the full answer, standards reference, and a "View in conversation" link.
- Clicking the link navigates to the Architect Conversation tab and scrolls to the source turn.
- Compare View still works correctly when no decisions exist (no banner, all rows show `--` in the new Decisions column).
- No regressions to existing Compare View functionality.

## Commit boundary

Default: one commit (frontend + small gateway-proxy addition if needed). Shape-spec may split per layer if the gateway change turns out non-trivial.
