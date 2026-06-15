# Task Breakdown: Candidate Details Expansion UI

## Overview
Total Tasks: 4 task groups
Scope: Frontend-only addition of an expandable details row in `DiscoveryCandidateTable` revealing a three-column evidence panel (Code Detection, Log Scans, LLM Review) for an allowlist of candidate types. No backend changes.

## Task List

### Helpers & Constants

#### Task Group 1: Candidate Type Allowlist + supportsDetails Helper
**Dependencies:** None

- [x] 1.0 Complete the supports-details helper module
  - [x] 1.1 Write 2-4 focused tests for the allowlist helper
    - New test file: `frontend/src/components/DashboardView/__tests__/supportsDetails.test.ts`
    - Test that `supportsDetails` returns `true` for each of the four allowlisted types: `endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`
    - Test that `supportsDetails` returns `false` for at least one non-allowlisted type (e.g., `clusters`, `services`)
    - Test that `supportsDetails` returns `false` for empty string / undefined-ish input
    - Limit to 2-4 highly focused tests; do NOT exhaustively enumerate every possible string
  - [x] 1.2 Create the helper module
    - New file: `frontend/src/components/DashboardView/candidateDetailsSupport.ts`
    - Export `SUPPORTED_DETAIL_TYPES: ReadonlySet<string>` initialized with the four allowlisted types
    - Export `supportsDetails(candidateType: string): boolean` backed by `SUPPORTED_DETAIL_TYPES.has(candidateType)`
    - Keep file tiny and dependency-free (no React, no DTO imports)
  - [x] 1.3 Ensure helper tests pass
    - Run ONLY the new `supportsDetails.test.ts` file
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- `supportsDetails` returns `true` exclusively for the four allowlisted types
- Module has no React or CSS dependencies

---

### Detail Panel Components

#### Task Group 2: CodeDetectionPanel and CandidateDetailsPanel Components
**Dependencies:** Task Group 1

- [x] 2.0 Build the two new presentational components
  - [x] 2.1 Write 4-8 focused tests for the new components
    - New test file: `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`
    - Use Vitest + Testing Library with the standard CSS module Proxy identity mock (`get: (_t, prop) => String(prop)`)
    - Mock `ArchitectureContext` (`useActiveArchitectureId`, `useArchitectureContext`) per project convention
    - Cover: (a) `CandidateDetailsPanel` renders the three column headings (Code Detection, Log Scans, LLM Review) and the three `data-testid`s `code-detection-panel`, `log-scans-panel`, `llm-review-panel`
    - Cover: (b) Log Scans column shows the exact placeholder string `"Log scan evidence is not available for this run."`
    - Cover: (c) LLM Review column shows the exact placeholder string `"No candidate-specific LLM review details are available yet."`
    - Cover: (d) `CodeDetectionPanel` shows `Detected by: {data._addedBy}` when present
    - Cover: (e) `CodeDetectionPanel` falls back to `"deterministic code analysis"` when `_addedBy` is absent
    - Cover: (f) `CodeDetectionPanel` joins `source_cluster_ids` with `, ` when present and renders an em-dash `—` when empty
    - Cover: (g) Missing/empty `candidate.data` does not throw and panel still renders
    - Limit to 4-8 highly focused tests maximum
  - [x] 2.2 Create `CodeDetectionPanel.tsx`
    - New file: `frontend/src/components/DashboardView/CodeDetectionPanel.tsx`
    - Props: `{ candidate: DiscoveryCandidateDto }`
    - Internal `getAddedBy(candidate)` mirroring the existing helper in `DiscoveryCandidateTable.tsx`
    - Render in order, each line conditional (omit if source missing):
      - `Detected by: {addedBy ?? "deterministic code analysis"}`
      - `Source: {source_cluster_ids.join(', ') || "—"}`
      - Up to ~5 scalar fields from `candidate.data` (skip keys starting with `_`, skip arrays/objects, truncate long strings to a sensible length, e.g., 120 chars)
      - Reason line: `"Detected by a framework/language adapter during code analysis."` when `_addedBy` is present, otherwise `"Detected from deterministic code analysis."`
    - Wrap in a container with `data-testid="code-detection-panel"`
    - Use a real heading element (e.g., `<h4>`) for the panel heading; reuse CSS classes from group 4
    - All field accesses must be safe (null/undefined-tolerant); never throw
  - [x] 2.3 Create `CandidateDetailsPanel.tsx`
    - New file: `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`
    - Props: `{ candidate: DiscoveryCandidateDto }`
    - Render a wrapper `<div>` with `data-testid="candidate-details-panel-{candidate.id}"` and the `detailsPanel` CSS class (added in group 4)
    - Inside, render three `<div className={styles.detailsColumn}>` columns:
      - Column 1: heading `"Code Detection"`, body `<CodeDetectionPanel candidate={candidate} />`
      - Column 2: heading `"Log Scans"`, body `<div data-testid="log-scans-panel">Log scan evidence is not available for this run.</div>`
      - Column 3: heading `"LLM Review"`, body `<div data-testid="llm-review-panel">No candidate-specific LLM review details are available yet.</div>`
    - Use real heading elements (`<h4>` or `<strong>`) for the column headings, consistent with surrounding components
    - Do NOT render any candidate row-level summary fields (name, tier, type, confidence, review status, synthesized timestamp)
  - [x] 2.4 Ensure component tests pass
    - Run ONLY `candidateDetailsPanel.test.tsx`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 2.1 pass
- `CodeDetectionPanel` and `CandidateDetailsPanel` render with safe fallbacks for missing data
- All required `data-testid`s are present
- Placeholder strings exactly match spec

---

### CSS Module Additions

#### Task Group 3: Expanded Panel Styles
**Dependencies:** None (can run in parallel with Group 1/2 but is consumed by Group 2 and Group 4)

- [x] 3.0 Append details-panel styles to the existing CSS module
  - [x] 3.1 No tests required (CSS-only change verified visually + via the integration tests in groups 2 and 4)
  - [x] 3.2 Append new classes to `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`
    - `.detailsPanel` — outer wrapper; `display: grid; grid-template-columns: repeat(3, 1fr); gap` matching surrounding spacing (e.g., `1rem`); padding consistent with `.childRow`
    - `.detailsColumn` — card-like body matching the existing table aesthetic (subtle border or background, padding, border-radius)
    - `.detailsColumnHeading` — bold heading bar at the top of each column
    - `.detailsColumnBody` — body text container with comfortable line-height
    - `@media (max-width: 768px)` rule that overrides `.detailsPanel` to `grid-template-columns: 1fr` (vertical stack)
    - Do NOT create a new CSS module file; append to the existing one
    - Do NOT modify or remove any existing classes (`actionButton`, `actionButtonDisabled`, `candidateTable`, `childRow`, `rowApproved/Rejected/Deferred`, etc.)
  - [x] 3.3 No test run for this group; correctness is observable through groups 2 and 4

**Acceptance Criteria:**
- New classes exist in `DiscoveryRunDetailView.module.css`
- Existing classes are untouched
- Three-column grid collapses to single column at `max-width: 768px`

---

### Wire-up & Integration

#### Task Group 4: Integrate Expansion into DiscoveryCandidateTable
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Wire the new button, state, and expansion row into the table
  - [x] 4.1 Write 5-8 focused integration tests for the table changes
    - New test file: `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`
    - Mirror the conventions of `__tests__/candidateReviewWorkflow.test.tsx` exactly: `vi.mock('../../../api/discoveryApi', ...)` preserving unmocked exports via spread; CSS module Proxy identity mock; `ArchitectureContext` mocks
    - Cover: (a) Show Details button is rendered on every candidate row, with `data-testid="show-details-{candidate.id}"`
    - Cover: (b) Action button order in the actions cell is exactly `Show Details`, `Approve`, `Reject`, `Defer`
    - Cover: (c) Show Details is enabled for an allowlisted type (`endpoints`) and disabled for a non-allowlisted type — disabled instance has the native `disabled` attribute and `title="Details not available for this candidate type"`
    - Cover: (d) Clicking Show Details on an eligible row reveals the panel (assert `candidate-details-panel-{id}` is in document) and the toggle label flips to `Close Details`; clicking Close Details collapses it
    - Cover: (e) Opening details on a second eligible row collapses the first (single-row expansion guarantee)
    - Cover: (f) The expanded panel does NOT contain the candidate name, tier, type label, confidence, review status, or synthesized timestamp string from the row above
    - Cover: (g) A disabled (non-allowlisted) row never renders an expansion panel even if forcibly toggled (state cannot lead to render)
    - Limit to 5-8 highly focused tests maximum
  - [x] 4.2 Add expansion state and helpers to `DiscoveryCandidateTable.tsx`
    - Add `const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);`
    - Import `supportsDetails` from `./candidateDetailsSupport`
    - Import `CandidateDetailsPanel` from `./CandidateDetailsPanel`
    - Add toggle handler: `const handleToggleDetails = (id: string) => setExpandedCandidateId(prev => prev === id ? null : id);`
    - Determine the visible column count `N` for the `colSpan` (read from the table header definition currently in the file; do not hardcode a magic number if the existing structure exposes a count)
  - [x] 4.3 Insert the Show/Close Details button at the front of the actions cell
    - Inside the existing actions `<td>` (around lines 374-399), insert a new button BEFORE the existing Approve/Reject/Defer trio
    - Label: `expandedCandidateId === candidate.id ? "Close Details" : "Show Details"`
    - `data-testid={`show-details-${candidate.id}`}`
    - When `!supportsDetails(candidate.candidate_type)`: set `disabled={true}`, add the `actionButtonDisabled` CSS class alongside `actionButton`, and add `title="Details not available for this candidate type"`
    - When enabled: `onClick={() => handleToggleDetails(candidate.id)}`, class `actionButton`
    - Do NOT change the existing Approve/Reject/Defer buttons' handlers, classes, or disabled semantics
  - [x] 4.4 Render the second `<tr>` for expanded rows
    - Immediately after each candidate `<tr>`, conditionally render a second `<tr>` when `expandedCandidateId === candidate.id && supportsDetails(candidate.candidate_type)`
    - The second `<tr>` contains a single `<td colSpan={N}>` wrapping `<CandidateDetailsPanel candidate={candidate} />`
    - Use a stable React `key` on the expansion row (e.g., `${candidate.id}-details`)
    - Ensure the expansion row does NOT receive any of the row-tint classes (`rowApproved`, `rowRejected`, `rowDeferred`); those remain on the candidate `<tr>` above
    - Do NOT touch filtering, sorting, or paging logic; the expansion row is rendered inline so it disappears naturally when the candidate row is filtered out
  - [x] 4.5 Ensure integration tests pass and existing table tests still pass
    - Run ONLY the new `candidateDetailsExpansion.test.tsx` file plus the existing `candidateReviewWorkflow.test.tsx` (since this group modifies the same component)
    - Expected total at this stage: approximately 5-8 new + the existing review-workflow test count
    - Verify Approve/Reject/Defer flows, filtering, paging, and review-status tints still work
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 5-8 tests written in 4.1 pass
- `candidateReviewWorkflow.test.tsx` continues to pass unmodified
- Show/Close Details button appears in the correct position with correct labels
- Disabled button has the native `disabled` attribute, the `actionButtonDisabled` class, and the explanatory `title`
- Single-row expansion guarantee is enforced
- Expansion row never appears for disallowed candidate types
- No changes to `discoveryApi.ts`, `DiscoveryRunDetailView.tsx` props/state, or any backend file

## Execution Order

Recommended implementation sequence:
1. Task Group 1 (Helpers & Constants) — pure, no dependencies
2. Task Group 3 (CSS additions) — independent; can run in parallel with Group 1 or just before Group 2
3. Task Group 2 (Detail panel components) — depends on Group 1 (helper) and Group 3 (styles)
4. Task Group 4 (Wire-up & integration) — depends on all prior groups

Total expected new tests across the spec: approximately 11-20 (2-4 in Group 1, 4-8 in Group 2, 5-8 in Group 4). No additional gap-analysis test group is needed; the test plan in the spec is fully covered by the per-group tests above.
