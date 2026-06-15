# Shaping Notes — Candidate Details Expansion UI

**Date:** 2026-05-10
**Mode:** Auto (curated; minimal user interruption)

## Visual Assets

`planning/visuals/` exists but is empty. No designs supplied — the brief contains an ASCII layout sketch which is sufficient for spec-writer.

## Code Inspection Findings

### Target component (the one to modify)

- **File:** `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
- **Note:** The table lives under `DashboardView/`, NOT under `frontend/src/components/Discovery/` as the brief guessed. The `Discovery/` folder only contains `ArchitectureRunTargetPicker` and `SaveBackConfirmModal`.
- **Parent that owns candidate state:** `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (passes `candidates` and `onCandidatesChange` into the table; this is where any expansion-state lift would land if needed — but local table state is fine for spec scope).
- **CSS module:** `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` — already contains `.actionButton`, `.actionButtonApprove/Reject/Defer`, `.actionButtonDisabled`, `.candidateTable`, `.childRow`, `.filterRow`, `.countSummary`, row tint classes (`.rowApproved/Rejected/Deferred`).

### Candidate payload shape (from `frontend/src/api/discoveryApi.ts`)

```ts
export interface DiscoveryCandidateDto {
  id: string;
  run_id: string;
  candidate_type: string;          // gates the Show Details enable/disable
  name: string;
  confidence: number | null;
  status: string;                  // pipeline status
  source_cluster_ids: string[];    // useful for "Source file/path" in Code Detection
  data: Record<string, unknown>;   // contains _addedBy, plus type-specific fields
  synthesized_at: string;
  parent_candidate_id: string | null;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  previous_review_status: string | null;
}
```

Existing helper already extracts `data._addedBy` as the adapter tag (used by `TierBadge`):
```ts
function getAddedBy(candidate: DiscoveryCandidateDto): string | null {
  const data = candidate.data as Record<string, unknown> | null | undefined;
  const tag = data?._addedBy;
  return typeof tag === 'string' ? tag : null;
}
```
Spec-writer should reuse this pattern (or extend it) inside the new `CodeDetectionPanel`.

### Test conventions (from `__tests__/candidateReviewWorkflow.test.tsx`)

- Vitest + Testing Library
- Mock `discoveryApi` with `vi.mock` (preserve unmocked fns via spread or full re-list)
- Mock the CSS module via Proxy identity mapping (`get: (_t, prop) => String(prop)`)
- Mock `ArchitectureContext` (`useActiveArchitectureId`, `useArchitectureContext`)
- `data-testid` is the standard query mechanism — apply same to new elements (`show-details-{id}`, `candidate-details-panel-{id}`, `code-detection-panel`, `log-scans-panel`, `llm-review-panel`).

### Action button row (current code, lines 374-399)

The new "Show Details / Close Details" button must be inserted BEFORE the existing Approve/Reject/Defer trio inside the same `<td>`. Disabled state class `actionButtonDisabled` already exists and is used for the active-status pattern.

### Eligible candidate types

Brief specifies allowlist: `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`. A constant set + helper `supportsDetails(candidateType: string): boolean` is the obvious shape.

## Decisions Made (no need to ask user)

1. **File layout** — three new files alongside the table:
   - `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` (the three-column container)
   - `frontend/src/components/DashboardView/CodeDetectionPanel.tsx` (generic-data renderer)
   - Style additions appended to `DiscoveryRunDetailView.module.css` (no new module — keeps theme cohesion)
   - Test file: `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`
2. **Expanded-row rendering** — emit a second `<tr>` immediately after the candidate `<tr>` with one `<td colSpan={7}>` wrapping the three-column panel. Standard accessible HTML-table expansion pattern; works inside the existing `<tbody>` and respects sort/filter/paging because each expanded row is keyed off the visible candidate row.
3. **State location** — `expandedCandidateId: string | null` lives in `DiscoveryCandidateTable` local state (parent doesn't need to know). Single-expansion enforced by setter assignment.
4. **Closing on filter/sort** — if a filter excludes the currently expanded row, render naturally drops the expansion row. No extra clearing logic needed.
5. **Disabled button accessibility** — reuse `disabled={true}` + `actionButtonDisabled` class (matches the existing pattern for Approve when already approved). Add `title="Details not available for this candidate type"` for hover hint.
6. **Code Detection content** — when present, render in this order:
   - `Detected by: {data._addedBy ?? "deterministic code analysis"}`
   - `Source: {source_cluster_ids.join(', ') || "—"}`
   - Up to ~5 candidate-type-relevant fields from `data` (skip private keys starting with `_`, skip large objects, render scalars/short strings)
   - One-line reason text (adapter vs deterministic, per brief's two suggested strings)
7. **Log Scans / LLM Review** — pure placeholder text components (per brief).
8. **Responsive stacking** — CSS grid with `grid-template-columns: repeat(3, 1fr)` and a `@media (max-width: 768px)` fallback to `1fr`.

## Open Product Questions

None. The brief is fully specified for product/UX decisions: target types, button labels, button order, single-expansion behavior, three column headings, exact placeholder strings, out-of-scope list, accessibility for disabled state, and even the layout concept are all spelled out. Remaining decisions are implementation craft (file paths, CSS approach, test wiring) which the spec-writer can settle from the inspection notes above.

**Recommendation: proceed directly to spec-writer.**
