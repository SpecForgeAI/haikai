# Task Breakdown: Batch "Resolve Conflicts" Modal

## Overview
Total Tasks: 4 task groups (33 sub-tasks)

This is a PURE-FRONTEND feature (React/TypeScript, Vite). No backend endpoint, no schema change, no Liquibase migration. The commit path REUSES the existing `resolveDiscoveryConflict` client unchanged.

### Build constraints every task group MUST respect

1. **Cross-package mirror (NO cross-imports).** `SOURCE_TIER_RANK` / `classifySourceTier` (discovery-service `src/services/candidateIdentity.ts` ~line 205/246) and the `CandidateType` union (discovery-service `src/types/candidate.ts` ~line 77) live in a DIFFERENT package. The frontend must NOT import from discovery-service. Build a small frontend-side mirror in a dedicated, isolated module (TG1): (a) a source-authority rank helper, and (b) a `CandidateType -> human-friendly label` map with a title-case fallback for unmapped/new tokens. Keep the values in sync with the discovery-service originals as a hand-mirrored copy (note this in a code comment pointing at the source files).

2. **Anti-clobber / edit-safety (MANDATORY).** `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` is a LARGE existing file (~1600+ lines). It must be changed with SURGICAL, ANCHORED edits ONLY. NEVER overwrite this file wholesale. The bulk of the feature lives in NEW files (the new batch modal + its CSS module + the support module + the orchestration helper + their tests), written fresh. The large-file change (TG4) is intentionally the last, smallest, most isolated step.

3. **Reuse the commit client.** The batch commit loops the existing `resolveDiscoveryConflict(...)` (`discoveryApi.ts` ~line 1126) once per (candidate, attribute) with `ResolveDiscoveryConflictBody` (~line 1090). Stamp `resolved_by = "reviewer (batch)"` (distinct from the single-row `"reviewer"`). No client changes — only a thin batch-orchestration helper (TG3) that the modal calls.

### Tooling (run from `frontend/`)
- Typecheck + build: `npm run build` (`tsc && vite build`)
- Lint: `npm run lint` (`eslint . --ext ts,tsx --max-warnings 0`)
- Tests: `npm test` (vitest) — scope to the new files only during development (e.g. `npx vitest run <path>`).

### Test conventions (existing precedent)
- Co-located `*.test.ts` / `*.test.tsx` next to the unit (e.g. `findingTypeLabels.ts` + `findingTypeLabels.test.tsx`; `resolveBulkActionSet.ts` + `resolveBulkActionSet.test.ts`).
- `@testing-library/react` + `@testing-library/user-event` + `jsdom` for component tests; `data-testid` selectors (mirror `ConflictResolutionModal.tsx`).

## Task List

### Frontend Support Module (pure, unit-testable)

#### Task Group 1: Source-authority mirror + label map + pre-selection helpers
**Dependencies:** None

- [x] 1.0 Build the frontend support module `frontend/src/components/Discovery/batchResolveConflictsSupport.ts`
  - [x] 1.1 Write 2-8 focused tests in `batchResolveConflictsSupport.test.ts`
    - Limit to 2-8 highly focused tests maximum.
    - Cover only critical behaviors: (a) authority rank ordering structural-framework-pack > contract-pack > runtime-evidence > llm-gap-fill and the unknown-label-defaults-to-structural-framework rule; (b) label map returns a friendly label for a known `CandidateType` and a title-case fallback for an unmapped token; (c) "most-authoritative" pre-selection picks the highest-tier option and breaks ties by FIRST option; (d) "prefer-source" pre-selection selects that source where present and leaves rows where it is absent UNSELECTED.
    - Skip exhaustive coverage of every `CandidateType` member and every label string.
  - [x] 1.2 Mirror the source-authority ladder (NO cross-import)
    - Hand-copy the tier order and the contract-pack label set from discovery-service `candidateIdentity.ts` (~line 205 `SOURCE_TIER_RANK`, ~line 226 `CONTRACT_PACK_LABELS`, ~line 246 `classifySourceTier`).
    - Expose a single `sourceLabelRank(label: string | undefined): number` (LOWER wins) plus the underlying classify helper.
    - Add a code comment pointing at the discovery-service source files and noting this is a hand-mirrored copy that must be kept in sync.
  - [x] 1.3 Build the `CandidateType -> human label` map
    - Reference the existing precedent `frontend/src/components/Discovery/findingTypeLabels.ts` for shape/style.
    - Cover every member of the `CandidateType` union (discovery-service `candidate.ts` ~line 77; ~22 members incl. `logical_data_entity_relationships`, `interface_logical_entities`, `ui_screens`, etc.).
    - Provide a `candidateTypeLabel(type: string): string` that returns the mapped label or a title-cased fallback for any unmapped/new token (split on `_`, capitalize words).
  - [x] 1.4 Implement the pure pre-selection helpers
    - Define the row shape consumed by the modal: a conflict row = `{ candidateId, candidateName, type, attr, options: { value: unknown; source: string }[] }`.
    - `selectMostAuthoritative(rows)` -> a selection map keyed by row identity = the highest-authority option index per row; tie within a tier -> FIRST option.
    - `selectPreferredSource(rows, source)` -> select that source's option index on every row where the source is present; rows lacking it stay UNSELECTED (absent from the map).
    - `markMostAuthoritative(row)` -> the index to flag with the "★ most authoritative" tag (single highest-ranked; tie -> FIRST). Pure; no React.
    - `presentSourceLabels(rows)` -> the de-duplicated, ranked list of source labels actually present (drives the prefer-source dropdown).
  - [x] 1.5 Run ONLY the 2-8 tests written in 1.1 and the typecheck/lint gate for these new files
    - `npx vitest run frontend/src/components/Discovery/batchResolveConflictsSupport.test.ts`
    - `npm run build` and `npm run lint` (must pass with zero warnings for the new module).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- No import from the discovery-service package anywhere in the module.
- Label map covers every `CandidateType` member and title-cases unmapped tokens.
- Pre-selection helpers are pure (no React), and the absent-source rows stay unselected.
- Typecheck + lint clean for the new files.

### Frontend Modal Component

#### Task Group 2: BatchResolveConflictsModal component + CSS module
**Dependencies:** Task Group 1

- [x] 2.0 Build the new modal `frontend/src/components/Discovery/BatchResolveConflictsModal.tsx` (+ `BatchResolveConflictsModal.module.css`)
  - [x] 2.1 Write 2-8 focused tests in `BatchResolveConflictsModal.test.tsx`
    - Limit to 2-8 highly focused tests maximum.
    - Cover only critical behaviors: (a) renders one row per (candidate, attribute) conflict, grouped by type with friendly group headers, sorted by name; (b) the "★ most authoritative" tag lands on the highest-ranked option in a row; (c) "Use most authoritative source" pre-selects rows and "Prefer a source…" pre-selects only where present; (d) the prefer-source dropdown lists ONLY sources present; (e) the empty/all-resolved state shows "No unresolved conflicts." with only Close.
    - Skip exhaustive interaction/state coverage; the commit/result-banner wiring is exercised in TG3.
  - [x] 2.2 Build the modal shell (mirror existing precedents)
    - Reuse the `ConflictResolutionModal.tsx` shell shape: overlay + header/content/footer, `isOpen` guard, Escape-key dismiss, overlay-click dismiss, `data-testid` selectors.
    - Reuse the grouped list-with-context layout precedent from `BulkCandidateActionConfirmModal.tsx`.
    - Reuse the `renderValue` approach from `ConflictResolutionModal.tsx` (strings pass through; objects/arrays JSON-stringified).
  - [x] 2.3 Aggregate + group + sort the conflict rows
    - Accept already-aggregated rows as a prop (aggregation across candidates is done by the parent via `getUnresolvedConflicts`; see TG4) — keep the modal presentational + selection-owning.
    - Group rows by entity/relationship `type`, render PLAIN NON-collapsible section headers using `candidateTypeLabel` (TG1), and sort by candidate `name` within each group.
  - [x] 2.4 Per-conflict row layout
    - Show TYPE (via group header), candidate NAME, conflicting ATTRIBUTE, and each competing option as a selectable control showing VALUE + SOURCE label.
    - One selection per attribute/row (`ConflictSelections = Record<string, number | undefined>` semantics, keyed per row identity).
    - Apply the subtle "★ most authoritative" tag (net-new UI) on the option index returned by `markMostAuthoritative` (TG1).
    - NO per-option finding/evidence/vote count anywhere (that data does not exist).
  - [x] 2.5 The two Resolve-All controls
    - "Use most authoritative source" button -> calls `selectMostAuthoritative` (TG1) and merges the result into selection state (pre-select only; user can still change any row).
    - "Prefer a source…" dropdown/select listing ONLY `presentSourceLabels(rows)` (TG1); on choose -> `selectPreferredSource` merges in; rows lacking that source stay unselected.
  - [x] 2.6 Confirm/Retry button + inline result banner + empty state (UI only)
    - Confirm button enabled when >=1 row is selected; calls an `onConfirm(selections)` prop (commit logic lands in TG3).
    - Reserve an inline result banner pinned at the TOP of the content area driven by a `result` prop ({ resolved, failed }); relabel Confirm to "Retry failed (N)" when failures are present (behavior verified in TG3).
    - Empty / all-resolved state: copy "No unresolved conflicts." with only a Close button (race-condition guard).
  - [x] 2.7 CSS module
    - Author `BatchResolveConflictsModal.module.css` consistent with `ConflictResolutionModal.module.css` / `BulkCandidateActionConfirmModal.module.css` (scrollable content, group headers, option buttons, selected state, the ★ tag, the result banner).
  - [x] 2.8 Run ONLY the 2-8 tests written in 2.1 and the typecheck/lint gate
    - `npx vitest run frontend/src/components/Discovery/BatchResolveConflictsModal.test.tsx`
    - `npm run build` and `npm run lint` for the new files.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- One row per conflict, grouped by type (friendly headers, non-collapsible), sorted by name.
- The ★ tag, both Resolve-All helpers, the present-only source dropdown, and the empty state all behave per spec.
- All pre-selection logic comes from TG1 (none re-implemented in the component).
- Typecheck + lint clean for the new files.

### Batch-commit Orchestration

#### Task Group 3: Best-effort commit loop + result summary + retry
**Dependencies:** Task Groups 1-2

- [x] 3.0 Build the orchestration helper `frontend/src/components/Discovery/batchResolveCommit.ts` and wire it into the modal's `onConfirm`
  - [x] 3.1 Write 2-8 focused tests in `batchResolveCommit.test.ts`
    - Limit to 2-8 highly focused tests maximum.
    - Mock `resolveDiscoveryConflict`. Cover only: (a) one call per selected (candidate, attribute) with the correct `ResolveDiscoveryConflictBody` incl. `resolved_by = "reviewer (batch)"`; (b) all-success returns `{ resolved: N, failed: 0 }` and the list of resolved (candidate, attr) pairs; (c) partial failure is best-effort/non-atomic (a rejected call does not abort the rest) and returns the failed (candidate, attr) set; (d) re-firing with only the failed selections retries just those.
    - Skip exhaustive error-shape coverage.
  - [x] 3.2 Implement the commit loop (REUSE the existing client)
    - Loop the existing `resolveDiscoveryConflict(projectId, architectureId, runId, candidateId, body)` (`discoveryApi.ts` ~line 1126) once per selected (candidate, attribute).
    - Body per call: `{ attr, chosen_value, chosen_source, resolved_by: 'reviewer (batch)', resolved_at }` (ISO-8601). No client changes.
    - Best-effort + non-atomic: `await` each (or `Promise.allSettled`) so one failure never aborts the others (mirrors the gateway's existing `resolveConflictsByPattern` fan-out).
    - Return a `{ resolved, failed }` summary that includes which (candidate, attr) pairs failed so the modal can keep ONLY those rows selected.
  - [x] 3.3 Local candidate-state update mirroring `handleResolveConflicts`
    - For each successfully resolved (candidate, attribute), apply the same local mutation pattern as `handleResolveConflicts` (~line 980-1098): set the canonical slot `data[attr] = chosenValue`, stamp `data._conflictResolutions[attr]` (camelCase keys: `chosenValue`, `chosenSource`, `resolvedBy`, `resolvedAt`), and `delete data._conflicts[attr]` — so resolved rows do NOT reappear on re-read.
    - Produce the updated candidates array to hand back to the caller (the actual `onCandidatesChange` + backbone-snapshot patch happens in TG4; keep this helper returning data, not calling React setters, so it stays unit-testable).
  - [x] 3.4 Wire the helper into the modal's Confirm/Retry behavior
    - On all-success: surface the success summary in the banner briefly, then auto-close (the auto-close timer can live in the modal; the helper just reports the result).
    - On partial failure: modal STAYS OPEN; keep ONLY the failed rows selected; Confirm relabels to "Retry failed (N)" and re-fires ONLY the failures (re-invokes the helper with the failed selections).
  - [x] 3.5 Run ONLY the 2-8 tests written in 3.1 and the typecheck/lint gate
    - `npx vitest run frontend/src/components/Discovery/batchResolveCommit.test.ts`
    - `npm run build` and `npm run lint` for the new files.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- Exactly one `resolveDiscoveryConflict` call per selected (candidate, attribute); `resolved_by = "reviewer (batch)"`.
- Best-effort/non-atomic: a single failure does not abort the rest; `{ resolved, failed }` summary identifies failures.
- Local candidate mutation matches `handleResolveConflicts` so resolved rows do not reappear.
- Retry re-fires only the failed selections.
- Typecheck + lint clean for the new files.

### Large-File Wiring (anchored, isolated)

#### Task Group 4: Wire into DiscoveryCandidateTable.tsx via surgical edits
**Dependencies:** Task Groups 1-3

- [x] 4.0 Integrate the feature into `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` with ANCHORED edits ONLY (NEVER overwrite the file)
  - [x] 4.1 Write 2-8 focused tests in `DiscoveryCandidateTable.batchResolve.test.tsx`
    - Limit to 2-8 highly focused tests maximum.
    - Cover only: (a) the top "Resolve Conflicts (N)" button renders FIRST in the bulk-actions row with the live N and is disabled when N === 0; (b) clicking it opens the batch modal; (c) the per-row "N conflicts" badge and the single-candidate `ConflictResolutionModal` are UNCHANGED (still present/openable); (d) after a successful batch commit, `onCandidatesChange` is invoked (refresh) and the modal auto-closes.
    - Use a NEW co-located test file; do NOT modify any existing `DiscoveryCandidateTable` tests.
  - [x] 4.2 Add the import + minimal state/handlers (anchored insert)
    - Import `BatchResolveConflictsModal` (and any aggregation helper) near the existing imports.
    - Add a single `batchModalOpen` boolean state near the existing `conflictModalCandidateId` state; add open/close handlers.
    - Build the aggregated rows from `candidates` using the existing `getUnresolvedConflicts(candidate)` (~line 340) across all candidates, carrying `candidateId`, `candidateName`, `type`, `attr`, and the `{ value, source }[]` options.
  - [x] 4.3 Insert the top "Resolve Conflicts (N)" button (anchored at the bulk-actions row ~line 1141)
    - Make it the FIRST child of `styles.bulkActions` (before "Approve All").
    - Label "Resolve Conflicts (N)" where N = the live whole-run `unresolvedConflictCount` (~line 745); neutral/secondary style; enabled only when N > 0; `onClick` opens the batch modal.
    - Do NOT touch the per-row badge (~line 1477) or the Approve/Reject buttons.
  - [x] 4.4 Mount the batch modal (anchored near the single-modal render ~line 1590)
    - Render `<BatchResolveConflictsModal isOpen={batchModalOpen} ... />` adjacent to (not replacing) the existing `<ConflictResolutionModal ... />`.
    - Wire `onConfirm` to the TG3 helper, passing `projectId` / `architectureId` / `runId` (already in component scope at the existing loop ~line 1088).
    - On a successful/partial commit, apply the returned updated candidates via `onCandidatesChange` and patch the held backbone snapshot the SAME way `handleResolveConflicts` does (~line 1044-1082: recompute `conflict_state` + decrement `live_conflict_count`), so the bulk-Approve gate and the top-button N update immediately.
    - Auto-close on all-success; keep open on partial failure.
  - [x] 4.5 Run ONLY the 2-8 tests written in 4.1 and the typecheck/lint gate
    - `npx vitest run frontend/src/components/DashboardView/DiscoveryCandidateTable.batchResolve.test.tsx`
    - `npm run build` and `npm run lint`.
    - After editing, verify the large file for accidental truncation/mojibake (confirm the file still ends at its original final render block and the single `ConflictResolutionModal` + badge are intact). Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- The large file was changed with surgical anchored edits only — never overwritten; the per-row badge and single-candidate modal are untouched.
- Top button is first in the bulk-actions row, count-gated, and opens the batch modal.
- After commit, candidates refresh (`onCandidatesChange`) and the backbone snapshot + N update; auto-close on all-success, stays open on partial failure.
- Typecheck + lint clean.

### Final Test Review

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-8 tests from TG1 (support module), TG2 (modal), TG3 (commit), TG4 (table wiring). Total existing: ~8-32 tests.
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage: e.g. open -> "Use most authoritative source" -> Confirm -> partial failure -> "Retry failed (N)" -> all-success -> auto-close.
    - Focus ONLY on this spec's feature; do NOT assess whole-app coverage. Prioritize end-to-end over unit gaps.
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add a maximum of 10 new tests to fill identified critical gaps (integration / end-to-end of the modal + commit + retry + refresh path).
    - Do NOT write comprehensive coverage; skip edge cases, performance, and accessibility tests unless business-critical.
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests for this feature (TG1-TG4 plus 5.3); expected total ~18-42 tests max.
    - `npm run build` and `npm run lint` once more across the new + edited files.
    - Do NOT run the entire application test suite.

**Acceptance Criteria:**
- All feature-specific tests pass (~18-42 tests total).
- The critical end-to-end resolve/retry/refresh workflow is covered.
- No more than 10 additional tests added when filling gaps.
- Testing focused exclusively on this spec's feature; typecheck + lint clean.

## Execution Order

Recommended implementation sequence:
1. Frontend Support Module — rank mirror + label map + pure pre-selection helpers (Task Group 1)
2. BatchResolveConflictsModal component + CSS (Task Group 2)
3. Batch-commit orchestration — loop + result summary + retry (Task Group 3)
4. Wire into DiscoveryCandidateTable.tsx via anchored edits (Task Group 4) — last, smallest, most isolated large-file change
5. Test Review & Gap Analysis (Task Group 5)
