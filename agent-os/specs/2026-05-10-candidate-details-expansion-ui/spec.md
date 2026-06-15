# Specification: Candidate Details Expansion UI

## Goal
Add an expandable per-row details area to the Discovery Candidate Review table that reveals a three-column evidence panel (Code Detection, Log Scans, LLM Review) for eligible candidate types, derived entirely from existing candidate payload fields with no backend changes. This is Spec 1 of a 7-spec roadmap for discovery candidate evidence explainability.

## User Stories
- As a discovery reviewer, I want to expand a candidate row to see why it was detected so that I can decide whether to approve, reject, or defer it with more context.
- As a discovery reviewer, I want only one expanded row at a time so that the table stays compact and easy to scan.
- As a discovery reviewer, I want the details button to be visibly disabled for candidate types that do not yet support details so that I do not waste time clicking on rows with no evidence.

## Specific Requirements

**Eligible candidate types (allowlist)**
- Allowlist: `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`.
- Add a `supportsDetails(candidateType: string): boolean` helper backed by a `Set` constant.
- For all other candidate types, the Show Details button is rendered but disabled.
- Disabled button must have the native `disabled` attribute, the existing `actionButtonDisabled` CSS class, and a `title="Details not available for this candidate type"` tooltip.
- Disabled rows must NOT render an expanded panel even if `expandedCandidateId` somehow points at them.

**Action button order and labelling**
- Collapsed row order inside the actions `<td>`: `Show Details`, `Approve`, `Reject`, `Defer`.
- Expanded row order: `Close Details`, `Approve`, `Reject`, `Defer`.
- Only the first button (Show/Close Details) toggles; existing Approve/Reject/Defer behaviour is unchanged.
- Reuse existing CSS classes `actionButton` and `actionButtonDisabled` from `DiscoveryRunDetailView.module.css`.
- Add `data-testid="show-details-{candidate.id}"` to the toggle button for tests.

**Single-row expansion state**
- Add local state `expandedCandidateId: string | null` inside `DiscoveryCandidateTable.tsx`.
- Toggling the same id sets it back to `null`; toggling a different id replaces the value (single-row guarantee).
- State does not need to be lifted into `DiscoveryRunDetailView.tsx`; the parent does not need to observe expansion.
- If a filter, sort, or paging change removes the expanded candidate from the rendered list, the expansion row simply disappears with no extra clearing logic required.

**Expanded row rendering**
- Render the expansion as a SECOND `<tr>` immediately after the candidate `<tr>`, inside the same `<tbody>`.
- The expansion row contains a single `<td colSpan={N}>` where N matches the visible column count of the candidate table.
- Use `data-testid="candidate-details-panel-{candidate.id}"` on the wrapper.
- Do NOT repeat any row-level summary fields (name, tier, type, confidence, review status, synthesized timestamp).
- The expansion row must not interfere with existing row tint classes (`rowApproved`, `rowRejected`, `rowDeferred`) on the candidate row above it.

**Three-column panel layout**
- New component `CandidateDetailsPanel.tsx` renders three section panels: Code Detection, Log Scans, LLM Review.
- Layout uses CSS Grid: `grid-template-columns: repeat(3, 1fr)` with a comfortable gap.
- Each column has a clear heading and a card-like body matching the existing table aesthetic.
- Add a `@media (max-width: 768px)` rule that collapses the grid to `1fr` (vertical stack) for narrow screens.
- Add new CSS classes (e.g., `.detailsPanel`, `.detailsColumn`, `.detailsColumnHeading`, `.detailsColumnBody`) appended to `DiscoveryRunDetailView.module.css`; do NOT create a new module file.

**Code Detection column content**
- New component `CodeDetectionPanel.tsx` accepts the candidate as a prop.
- Reuse the existing `getAddedBy(candidate)` helper pattern from `DiscoveryCandidateTable.tsx` to read `candidate.data._addedBy`.
- Render in this order, each on its own line, omitting lines whose source is empty:
  - `Detected by: {addedBy ?? "deterministic code analysis"}`
  - `Source: {source_cluster_ids.join(', ') || "—"}`
  - Up to ~5 scalar fields from `candidate.data` (skip keys starting with `_`, skip arrays/objects, truncate long strings).
  - Reason line: `"Detected by a framework/language adapter during code analysis."` when `_addedBy` is present, otherwise `"Detected from deterministic code analysis."`
- Missing or null fields must render gracefully (em-dash or omitted line) — never throw.
- `data-testid="code-detection-panel"`.

**Log Scans column content**
- Inline placeholder inside `CandidateDetailsPanel` (no separate component file needed).
- Hardcoded text: `"Log scan evidence is not available for this run."`
- `data-testid="log-scans-panel"`.

**LLM Review column content**
- Inline placeholder inside `CandidateDetailsPanel` (no separate component file needed).
- Hardcoded text: `"No candidate-specific LLM review details are available yet."`
- `data-testid="llm-review-panel"`.

**Preserved existing behaviour**
- Approve, Reject, Defer click handlers and their disabled-when-active semantics remain unchanged.
- Existing table filtering, sorting, paging, and review-status row tinting must continue to work.
- No changes to `discoveryApi.ts`, no changes to candidate DTO, no changes to any backend service.
- `DiscoveryRunDetailView.tsx` props/state and its `onCandidatesChange` contract remain unchanged.

## Visual Design

The `planning/visuals/` folder is empty. The raw idea includes an ASCII layout sketch (lines 96-115 of `planning/raw-idea.md`) which is the canonical visual reference for this spec:

**ASCII layout sketch (raw-idea.md lines 96-115)**
- The candidate row keeps its existing columns with the actions column showing four buttons stacked or wrapped.
- The expansion row sits flush below the candidate row, spanning the full table width.
- Three equally-sized panels (Code Detection, Log Scans, LLM Review) are arranged left-to-right with visible gaps.
- Each panel has a bold heading bar at the top and body text underneath.
- Code Detection body shows labelled lines (`Detected by:`, `Source file:`, `Reason:`).
- Log Scans and LLM Review bodies show only their placeholder sentence.
- The expansion area is visually contained (card/panel styling) so it reads as belonging to the row above.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`**
- Target component for the entire change. Already renders the candidate `<tr>` rows with the Approve/Reject/Defer action buttons (around lines 374-399) — insert the new toggle button at the front of that group.
- Already contains the `getAddedBy(candidate)` helper used by `TierBadge` — reuse the same pattern (or export and share) inside `CodeDetectionPanel`.
- Holds local table state today; add `expandedCandidateId` here without touching the parent.

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`**
- Parent that owns candidate data and passes `candidates` + `onCandidatesChange` into the table. No changes required by this spec; called out so the implementer knows where the state boundary sits.

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`**
- Reuse `actionButton`, `actionButtonDisabled`, `actionButtonApprove/Reject/Defer`, `candidateTable`, `childRow`, `rowApproved/Rejected/Deferred`.
- Append new classes for the expanded panel (`detailsPanel`, `detailsColumn`, `detailsColumnHeading`, `detailsColumnBody`) to the same module rather than creating a new CSS module file.

**`frontend/src/api/discoveryApi.ts`**
- `DiscoveryCandidateDto` fields used: `id`, `candidate_type`, `source_cluster_ids`, `data` (especially `data._addedBy`). No changes to this file.

**`frontend/src/components/DashboardView/__tests__/candidateReviewWorkflow.test.tsx`**
- Reference for test conventions: Vitest + Testing Library, `vi.mock('discoveryApi', ...)`, CSS-module Proxy identity mock, `ArchitectureContext` mocks (`useActiveArchitectureId`, `useArchitectureContext`), `data-testid` queries. Mirror this style in the new test file.

## Component Changes (file-by-file)

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`** (modify)
- Add `expandedCandidateId` state and toggle handler.
- Add `SUPPORTED_DETAIL_TYPES` constant and `supportsDetails()` helper.
- Insert the Show/Close Details button at the front of the actions cell.
- After each candidate `<tr>`, conditionally render the expansion `<tr>` containing `<CandidateDetailsPanel candidate={...} />`.

**`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`** (new)
- Receives `candidate: DiscoveryCandidateDto`.
- Renders the three-column grid wrapper plus the three panels (Code Detection delegates to `CodeDetectionPanel`; Log Scans and LLM Review are inline placeholders).

**`frontend/src/components/DashboardView/CodeDetectionPanel.tsx`** (new)
- Receives `candidate: DiscoveryCandidateDto`.
- Renders the labelled lines described above with safe fallbacks.

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`** (modify)
- Append new classes for the details panel grid, column cards, headings, body text, and the narrow-screen media query.

**`frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`** (new)
- Test plan covered below.

## Accessibility
- The disabled Show Details button uses the native `disabled` attribute (not just CSS), so screen readers and keyboard users get correct semantics.
- The `title` attribute provides a hover/focus tooltip explaining why it is disabled.
- Buttons keep their visible focus styles via the existing `actionButton` class.
- The expansion `<tr>` is semantically a normal table row, so screen readers announce it as part of the table; no ARIA grid mapping is required.
- Heading text inside each column is rendered with a real heading element (e.g., `<h4>` or `<strong>` consistent with surrounding components) rather than styled divs.

## Test Plan

**New tests in `__tests__/candidateDetailsExpansion.test.tsx`**
- Renders a Show Details button on every candidate row.
- Show Details is enabled for each of the four allowlisted candidate types.
- Show Details is disabled for at least one non-allowlisted candidate type, and the disabled button has the `disabled` attribute and the explanatory `title`.
- Clicking Show Details on an eligible row reveals the panel with all three columns and their headings.
- After expansion, the toggle label changes to "Close Details".
- Clicking Close Details collapses the panel.
- Opening details on a second eligible row collapses the first (single-row expansion guarantee).
- Code Detection column shows `Detected by:` using `data._addedBy` when present, and falls back to "deterministic code analysis" text when absent.
- Code Detection column shows `source_cluster_ids` joined when present, and an em-dash fallback when empty.
- Log Scans column always shows the exact placeholder string.
- LLM Review column always shows the exact placeholder string.
- Missing/empty `candidate.data` does not throw and renders the panel with fallbacks.
- The expanded panel does not contain the candidate name, tier, type, confidence, review status, or synthesized timestamp.

**Existing tests that must still pass**
- `__tests__/candidateReviewWorkflow.test.tsx` — Approve/Reject/Defer flows, filtering, paging, review-status tints all remain green.
- Any other tests that import `DiscoveryCandidateTable` or `DiscoveryRunDetailView` continue to pass.

## Out of Scope
- Parsing, uploading, or processing logs of any kind.
- Matching log lines to candidates.
- Changing confidence scores or tier labels.
- Adding runtime badges (Spec 7).
- Creating a normalized backend evidence/explainability contract (Spec 3).
- Implementing rich type-specific code detection mappers (Spec 2).
- Showing raw source code snippets.
- Showing line numbers unless they already exist verbatim in the candidate payload.
- Generating or inferring LLM reasoning.
- Any backend API, database, or persistence changes.

## Roadmap Context
Spec 1 of 7 in the discovery candidate evidence explainability roadmap: (1) Candidate Details Expansion UI [this spec], (2) Code Detection Detail Mappers, (3) Candidate Evidence Data Contract, (4) Runtime Log Input at Discovery Run Start, (5) Web Access Log Runtime Endpoint Evidence, (6) Log Evidence in Candidate Details UI, (7) Confidence, Tier, and Runtime Badges.
