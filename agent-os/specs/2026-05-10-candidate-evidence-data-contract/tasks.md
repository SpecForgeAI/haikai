# Task Breakdown: Candidate Evidence Data Contract

## Overview
Total Tasks: 4 task groups (Spec 3 of 7 in the discovery candidate evidence explainability roadmap). Frontend-only refactor that introduces a normalized evidence contract and collapses two renderer components into one generic card driven by `testIdPrefix`.

## Task List

### Pure Logic Layer

#### Task Group 1: Types Module + Section Builders + Pure Unit Tests
**Dependencies:** None

- [x] 1.0 Complete the pure types module and section builders, with focused unit tests
  - [x] 1.1 Write 8-12 focused unit tests in `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`
    - Pure unit tests only — no React, no Testing Library, no API mocks, no `ArchitectureContext`
    - `buildCandidateEvidenceDetails` returns an object containing `candidateId`, `candidateType`, and all three sections (`codeDetection`, `logScans`, `llmReview`)
    - `buildLogScansEvidenceSection` returns the EXACT placeholder shape: `{ title: 'Log Scans', status: 'not_available', summary: 'Log scan evidence is not available for this run.', fields: [] }`
    - `buildLlmReviewEvidenceSection` returns the EXACT placeholder shape: `{ title: 'LLM Review', status: 'not_available', summary: 'No candidate-specific LLM review details are available yet.', fields: [] }`
    - `buildCodeDetectionEvidenceSection` on a populated server-shape Spring Boot endpoint candidate returns `status: 'available'`, populates `reason`, `fields`, `detectedBy`, `sourceFiles` from the Spec 2 mapper output
    - `buildCodeDetectionEvidenceSection` on a sparse candidate where Spec 2's mapper sets `isMostlyEmpty: true` returns `status: 'not_available'`
    - `buildCodeDetectionEvidenceSection` does NOT set `confidenceImpactLabel`, `confidenceImpactReason`, or `notes` (deferred to Spec 7)
    - `buildCandidateEvidenceDetails` carries `candidate.candidate_type` through unchanged for each of the four supported types (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`)
    - Defensive test: when underlying Spec 2 mapper returns its defensive default (unknown candidate type), the section's `status` is `'not_available'` and `reason` is the Spec 2 default reason string `"Detected from deterministic code analysis."`
    - Limit to 8-12 highly focused tests maximum; skip exhaustive coverage of all per-type field permutations (those live in Spec 2's mapper tests already)
  - [x] 1.2 Create `frontend/src/components/DashboardView/candidateEvidenceTypes.ts`
    - Pure module: NO React imports, NO CSS imports, NO API imports
    - Define `type CandidateEvidenceStatus = "available" | "not_available" | "partial" | "warning"` (all four values defined now per resolved decision 2)
    - Define `type CandidateEvidenceField = { label: string; value: string | string[] }` (shape-compatible with Spec 2's `CodeDetectionField`)
    - Define `type CandidateEvidenceNote = { level: "info" | "warning" | "success"; text: string }`
    - Define `type CandidateEvidenceSection` with: `title: string`, `status: CandidateEvidenceStatus`, `summary?: string`, `reason?: string`, `fields: CandidateEvidenceField[]`, `sourceFiles?: string[]`, `detectedBy?: string`, `notes?: CandidateEvidenceNote[]`, `confidenceImpactLabel?: string`, `confidenceImpactReason?: string`
    - Define `type CandidateEvidenceDetails = { candidateId: string; candidateType: string; codeDetection: CandidateEvidenceSection; logScans: CandidateEvidenceSection; llmReview: CandidateEvidenceSection }`
    - `sourceFiles` and `detectedBy` are optional so log-scans and llm-review placeholders need not set them
  - [x] 1.3 Create `frontend/src/components/DashboardView/codeDetectionEvidenceBuilder.ts`
    - Pure module: NO React, NO CSS, NO API imports
    - Imports `buildCodeDetectionDetails` from `./codeDetectionMappers` (Spec 2 module — consumed VERBATIM, not modified)
    - Imports types from `./candidateEvidenceTypes`
    - Exports `buildCodeDetectionEvidenceSection(candidate: DiscoveryCandidateDto): CandidateEvidenceSection`
    - Mapping: `title: 'Code Detection'`, `status: display.isMostlyEmpty ? 'not_available' : 'available'`, `reason: display.reason`, `fields: display.fields`, `detectedBy: display.detectedBy`, `sourceFiles: display.sourceFiles`
    - Does NOT set `confidenceImpactLabel`, `confidenceImpactReason`, or `notes` (deferred to Spec 7)
  - [x] 1.4 Create `frontend/src/components/DashboardView/candidateEvidenceBuilder.ts`
    - Pure module: NO React, NO CSS, NO API imports
    - Imports `buildCodeDetectionEvidenceSection` from `./codeDetectionEvidenceBuilder`
    - Imports types from `./candidateEvidenceTypes`
    - Exports `buildCandidateEvidenceDetails(candidate: DiscoveryCandidateDto): CandidateEvidenceDetails` — composes the three section builders into `{ candidateId: candidate.id, candidateType: candidate.candidate_type, codeDetection, logScans, llmReview }`
    - Exports `buildLogScansEvidenceSection(candidate)` returning the hardcoded placeholder shape (see 1.1 for exact strings)
    - Exports `buildLlmReviewEvidenceSection(candidate)` returning the hardcoded placeholder shape (see 1.1 for exact strings)
  - [x] 1.5 Ensure pure builder tests pass
    - Run ONLY the 8-12 tests written in 1.1 (e.g. `npx vitest run frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`)
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 8-12 tests written in 1.1 all pass
- `candidateEvidenceTypes.ts` defines all five contract types with all four status values
- `buildCandidateEvidenceDetails` composes three section builders correctly
- Spec 2's `codeDetectionMappers.ts` is imported but NOT modified
- All three new files are pure modules (no React/CSS/API imports)

---

### Generic Renderer Layer

#### Task Group 2: Generic `CandidateEvidenceSectionCard` Component + Renderer Tests
**Dependencies:** Task Group 1

- [x] 2.0 Build the generic section-card renderer with focused renderer tests
  - [x] 2.1 Write 6-10 focused renderer tests in `frontend/src/components/DashboardView/__tests__/candidateEvidenceSectionCard.test.tsx`
    - Use the standard Vitest + Testing Library + Proxy CSS module pattern from Spec 2's existing renderer tests
    - NO `ArchitectureContext` mock needed — the card does not import it
    - All three `testIdPrefix` values (`"code-detection"`, `"log-scans"`, `"llm-review"`) emit the wrapper testid `{prefix}-panel`
    - A populated section with `detectedBy`, `sourceFiles`, `reason`, and `fields` (driven with `testIdPrefix="code-detection"`) renders all four corresponding testid lines
    - A placeholder section (no fields, no sourceFiles, no reason, only `summary`) renders the summary as wrapper body text and does NOT emit `{prefix}-empty`, `{prefix}-detected-by`, `{prefix}-source-files`, `{prefix}-reason`, or any `{prefix}-field-*` lines
    - An empty section (no fields, no sourceFiles, no reason, no summary) emits `{prefix}-empty` with the EXACT text `Type-specific details: not available.`
    - All four `CandidateEvidenceStatus` values (`available`, `not_available`, `partial`, `warning`) render without throwing; `partial` and `warning` render with the same DOM as `not_available`
    - Impact block (`Impact: {label}` + reason) is hidden when `confidenceImpactLabel` is absent and rendered when present
    - Notes block is hidden when `notes` is absent/empty and rendered when present, one entry per note keyed by index
    - Per-field testid slug rule: a field labelled `HTTP method` produces `{prefix}-field-http-method` (matches Spec 2's `slugifyLabel` lowercase + kebab-case)
    - Limit to 6-10 highly focused tests maximum
  - [x] 2.2 Create `frontend/src/components/DashboardView/CandidateEvidenceSectionCard.tsx`
    - Props: `{ section: CandidateEvidenceSection; testIdPrefix: string }`
    - Knows nothing about candidate types — operates only on `CandidateEvidenceSection` shape
    - Imports `styles from './DiscoveryRunDetailView.module.css'` and reuses `styles.detailsColumnBody` (NO new CSS classes added)
    - Move the `slugifyLabel(label: string)` helper VERBATIM from `CodeDetectionPanel.tsx` into this card
  - [x] 2.3 Implement wrapper + conditional rendering rules
    - Wrapper: `<div data-testid={`${testIdPrefix}-panel`} className={styles.detailsColumnBody}>`
    - When `section.detectedBy` is non-empty: emit `<div data-testid={`${testIdPrefix}-detected-by`}>Detected by: {detectedBy}</div>`
    - When `section.sourceFiles?.length`: emit `<div data-testid={`${testIdPrefix}-source-files`}>` containing `Source files:` header plus one inner `<div>` per path
    - When `section.reason` is non-empty: emit `<div data-testid={`${testIdPrefix}-reason`}>Reason: {reason}</div>`. ELSE when `section.summary` is non-empty: render the summary as the wrapper's body text (preserves the exact placeholder string contract for Log Scans and LLM Review)
    - For each `field` in `section.fields`: emit `<div data-testid={`${testIdPrefix}-field-{slugifyLabel(label)}`}>` rendering `label: value`. Arrays render as a label header plus one inner `<div>` per item
  - [x] 2.4 Implement empty-state rule (CRITICAL — preserves Spec 2 semantics)
    - Emit `<div data-testid={`${testIdPrefix}-empty`}>Type-specific details: not available.</div>` ONLY when `fields.length === 0` AND no `sourceFiles` AND no `reason` AND no `summary`
    - This guarantees `code-detection-empty` fires when Spec 2's mapper flags `isMostlyEmpty` AND no curated content survived, but log-scans / llm-review (which always have a `summary`) will NEVER emit `-empty`
  - [x] 2.5 Implement forward-compatible blocks (defined now, not triggered in Spec 3)
    - When `section.confidenceImpactLabel` is non-empty: render an impact block with `Impact: {label}` and the optional `confidenceImpactReason` underneath
    - When `section.notes?.length`: render each as a small line keyed by index with the level as a class hint
    - Status-aware styling: `available` and `not_available` use shipped Spec 2 visual treatment (reuse `detailsColumnBody`); `partial` and `warning` render with the same styling as `not_available` (forward-compatible no-op)
  - [x] 2.6 Ensure renderer tests pass
    - Run ONLY the 6-10 tests written in 2.1 (e.g. `npx vitest run frontend/src/components/DashboardView/__tests__/candidateEvidenceSectionCard.test.tsx`)
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 6-10 tests written in 2.1 all pass
- The generic card emits ALL of these testids when used with `testIdPrefix="code-detection"`: `code-detection-panel`, `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-{slug}`, `code-detection-empty`
- The card emits `log-scans-panel` and `llm-review-panel` for the placeholder sections; those sections never emit `-empty` because they always carry a `summary`
- The card knows nothing about candidate types and contains zero references to `candidate_type`, candidate-specific shapes, or Spec 2 mapper internals
- `slugifyLabel` is moved into the card unchanged

---

### Orchestrator Wiring + Deletion

#### Task Group 3: Wire `CandidateDetailsPanel.tsx` to the Builder + Delete `CodeDetectionPanel.tsx`
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Replace the panel body and remove the dedicated code-detection component
  - [x] 3.1 No new tests in this group — orchestrator integration is verified in Task Group 4
    - The build/render contract is already covered by 1.1 (builder shape) and 2.1 (generic card behaviour); the orchestrator change is a thin compositional rewrite verified end-to-end in 4.x
  - [x] 3.2 Modify `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`
    - Prop signature is UNCHANGED: `{ candidate: DiscoveryCandidateDto }`
    - Outer wrapper testid `candidate-details-panel-{candidate.id}` is PRESERVED VERBATIM (Spec 1's `candidateDetailsExpansion.test.tsx` asserts this — must NOT need edits)
    - Body replaced: call `buildCandidateEvidenceDetails(candidate)` to obtain a `CandidateEvidenceDetails`, then render three columns inside the existing `.detailsPanel` grid
    - Each column structure: `<div className={styles.detailsColumn}><h4 className={styles.detailsColumnHeading}>{section.title}</h4><CandidateEvidenceSectionCard section={section} testIdPrefix={prefix} /></div>`
    - Mappings: `section=evidence.codeDetection, prefix="code-detection"`; `section=evidence.logScans, prefix="log-scans"`; `section=evidence.llmReview, prefix="llm-review"`
    - Heading text comes from `section.title` (the contract owns the strings) so the orchestrator can drive all three columns with one map
    - Drop the import of `CodeDetectionPanel` and the inline placeholder `<div>` blocks for log-scans and llm-review
  - [x] 3.3 Delete `frontend/src/components/DashboardView/CodeDetectionPanel.tsx`
    - This file is replaced wholesale by the generic `CandidateEvidenceSectionCard`
    - Verify `slugifyLabel` was already moved into the card in step 2.2 before deletion
  - [x] 3.4 Confirm grep shows no remaining references to `CodeDetectionPanel`
    - Run a Grep across the frontend tree to confirm zero references in source AND tests (the test file's import will be removed in Task Group 4)
    - Acceptable temporary references: only the test file `__tests__/candidateDetailsPanel.test.tsx` may still import `CodeDetectionPanel` until 4.x removes it
  - [x] 3.5 Files explicitly UNCHANGED in this group — verify they are not modified
    - `DiscoveryCandidateTable.tsx` (call site stays `<CandidateDetailsPanel candidate={candidate} />`)
    - `candidateDetailsSupport.ts` (the four-type allowlist stays as-is)
    - `codeDetectionMappers.ts` (Spec 2 mapper consumed verbatim)
    - `DiscoveryRunDetailView.module.css` (no new CSS classes added in Spec 3)

**Acceptance Criteria:**
- `CandidateDetailsPanel.tsx` calls `buildCandidateEvidenceDetails(candidate)` and renders three `<CandidateEvidenceSectionCard>` instances with the prescribed prefixes
- The wrapper testid `candidate-details-panel-{candidate.id}` is byte-identical to today
- The three column headings (`Code Detection`, `Log Scans`, `LLM Review`) continue to render as `<h4 className={styles.detailsColumnHeading}>` inside the orchestrator, sourced from `section.title`
- `CodeDetectionPanel.tsx` is deleted and grep confirms no remaining source references
- `DiscoveryCandidateTable.tsx`, `candidateDetailsSupport.ts`, `codeDetectionMappers.ts`, and `DiscoveryRunDetailView.module.css` are untouched

---

### Test Update + Non-Regression Verification

#### Task Group 4: Update `candidateDetailsPanel.test.tsx` + Verify All Backstops
**Dependencies:** Task Groups 1, 2, and 3

- [x] 4.0 Rewrite the panel test file as needed and verify ALL non-regression backstops pass with NO edits
  - [x] 4.1 Review existing tests written in Task Groups 1-3
    - 8-12 builder tests from 1.1 (`candidateEvidenceBuilder.test.ts`)
    - 6-10 renderer tests from 2.1 (`candidateEvidenceSectionCard.test.tsx`)
    - Total new tests written so far: approximately 14-22
  - [x] 4.2 Update `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`
    - Drop the `CodeDetectionPanel` import; keep the `CandidateDetailsPanel` import
    - The `CandidateDetailsPanel` describe block (wrapper testid, three column headings via `getByRole('heading', { level: 4, name: ... })`, three body testids `code-detection-panel` / `log-scans-panel` / `llm-review-panel`, exact placeholder strings) is PRESERVED unchanged because the generic card emits the same DOM
    - Rewrite the previous `CodeDetectionPanel` describe block to drive `<CandidateDetailsPanel candidate={...} />` directly (the dedicated component is gone) and continue asserting the same `code-detection-*` testids — they remain byte-identical
    - The per-type field-coverage matrix (server-shape Spring Boot, client-shape React/axios, Spring controller, Spring bean, sparse logical entity, sparse interface_logical_entity, isMostlyEmpty empty-state, source-files list) is preserved as orchestrator-level integration coverage
    - Do NOT add NEW assertions beyond what is needed to swap the component under test; deeper unit coverage of the wrapper builder lives in `candidateEvidenceBuilder.test.ts`
  - [x] 4.3 Add up to 10 additional strategic tests ONLY if a critical gap is found
    - Maximum of 10 NEW tests across the feature, IF NECESSARY to fill gaps related to this spec
    - Focus on integration points and end-to-end candidate-expansion workflows
    - Skip edge cases, performance tests, accessibility tests
    - Most likely outcome: ZERO new tests added — the existing per-type matrix already covers the integration surface
  - [x] 4.4 Verify Spec 1 backstop `candidateDetailsExpansion.test.tsx` passes with ZERO edits
    - Run ONLY this file (e.g. `npx vitest run frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx`)
    - Confirms: wrapper testid `candidate-details-panel-{id}`, row testid `candidate-details-row-{id}`, three column headings, three body testids all preserved
    - If this file required ANY edits, Spec 3 has broken its primary backstop — STOP and revisit Task Group 3
  - [x] 4.5 Verify Spec 2 mapper backstop `codeDetectionMappers.test.ts` passes with ZERO edits
    - Run ONLY this file
    - Confirms `codeDetectionMappers.ts` was consumed verbatim and not modified
  - [x] 4.6 Verify `candidateReviewWorkflow.test.tsx` and any other tests importing `DiscoveryCandidateTable` or `DiscoveryRunDetailView` pass with ZERO edits
    - Run those files individually; confirms the table call site, expansion state, filtering, sorting, paging are all intact
  - [x] 4.7 Run the full set of feature-specific tests for this spec
    - Run ONLY: `candidateEvidenceBuilder.test.ts`, `candidateEvidenceSectionCard.test.tsx`, `candidateDetailsPanel.test.tsx`, `candidateDetailsExpansion.test.tsx`, `codeDetectionMappers.test.ts`, `candidateReviewWorkflow.test.tsx`
    - Expected total: approximately 30-50 tests across these files
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- `candidateDetailsPanel.test.tsx` is updated (import swap + describe-block rewrite to drive `CandidateDetailsPanel` instead of the deleted `CodeDetectionPanel`); all assertions on `code-detection-*` testids stay byte-identical
- Spec 1's `candidateDetailsExpansion.test.tsx` passes with ZERO edits (primary backstop)
- Spec 2's `codeDetectionMappers.test.ts` passes with ZERO edits (mapper consumed verbatim)
- `candidateReviewWorkflow.test.tsx` and other table/detail-view consumers pass with ZERO edits
- No more than 10 additional tests added when filling testing gaps (likely zero)
- All feature-specific tests pass; testing focused exclusively on this spec's frontend surface

---

## Critical Constraints (Cross-Cutting)

These MUST hold at every step; any violation means the corresponding task group is incomplete:

1. **Testid contract is preserved verbatim.** The generic `CandidateEvidenceSectionCard` MUST emit these testids when used with `testIdPrefix="code-detection"`: `code-detection-panel`, `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-{slug}`, `code-detection-empty`. With prefixes `"log-scans"` and `"llm-review"`, it MUST emit `log-scans-panel` and `llm-review-panel`.
2. **`code-detection-empty` semantics.** The `-empty` line emits ONLY when no fields, no source files, no reason, no summary. Log-scans and llm-review always have `summary` populated, so they NEVER emit `-empty`.
3. **Wrapper testid preservation.** The orchestrator wrapper testid `candidate-details-panel-{candidate.id}` MUST be preserved verbatim — Spec 1's expansion test asserts it.
4. **Heading rendering location.** The three column headings (`Code Detection`, `Log Scans`, `LLM Review`) MUST continue to render as `<h4>` inside the orchestrator (sourced from `section.title`). Accessible-name assertions in Spec 2 tests rely on `getByRole('heading', { level: 4, name: ... })`.
5. **`CodeDetectionPanel.tsx` is DELETED.** A grep across the frontend source tree must show zero remaining references after Task Group 3 (the test file's import is removed in Task Group 4).
6. **Pure-module discipline.** `candidateEvidenceTypes.ts`, `candidateEvidenceBuilder.ts`, and `codeDetectionEvidenceBuilder.ts` MUST contain no React, no CSS, no API imports.
7. **No backend or non-target frontend changes.** No edits to discovery-service, gateway, DTOs, persistence, `candidateDetailsSupport.ts`, `codeDetectionMappers.ts`, `DiscoveryRunDetailView.module.css`, or `DiscoveryCandidateTable.tsx`.

---

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — Pure types module + section builders + 8-12 builder unit tests
2. Task Group 2 — Generic `CandidateEvidenceSectionCard` + 6-10 renderer tests
3. Task Group 3 — Wire `CandidateDetailsPanel.tsx` to the builder; delete `CodeDetectionPanel.tsx`
4. Task Group 4 — Update `candidateDetailsPanel.test.tsx`; verify Spec 1, Spec 2, and table-consumer backstops pass with ZERO edits
