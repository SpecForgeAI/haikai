# Specification: Candidate Evidence Data Contract

## Goal
Introduce a normalized frontend evidence data contract (`CandidateEvidenceDetails`) and refactor the Candidate Details Panel to render three generic evidence section cards from that contract instead of from candidate-type-specific mapper output. This is Spec 3 of a 7-spec roadmap for discovery candidate evidence explainability.

## User Stories
- As a discovery reviewer, I want the candidate details UI to be driven by one stable evidence shape so that future log and LLM evidence sections render the same way as code detection without per-section UI rewrites.
- As a frontend developer, I want a single generic evidence section component that takes a `testIdPrefix` so that all three columns (Code Detection, Log Scans, LLM Review) share one renderer and the existing testids continue to be emitted unchanged.
- As a future spec author (Specs 5/6/7), I want the contract to already define `partial`/`warning` statuses, optional `notes`, and optional `confidenceImpactLabel`/`confidenceImpactReason` so that adding runtime/log evidence and confidence badges is strictly additive.

## Specific Requirements

**Frontend-only refactor, no backend changes**
- Pure frontend refactor over the data flowing out of Spec 2's `codeDetectionMappers.ts`.
- No changes to discovery-service, backend APIs, DTOs, persistence, confidence score calculations, tier labels, or candidate.data shape.
- The Spec 2 mapper module is consumed verbatim by a new wrapper builder; it is not modified.

**New contract types (`candidateEvidenceTypes.ts`)**
- Defines the following TypeScript types verbatim:
  - `type CandidateEvidenceStatus = "available" | "not_available" | "partial" | "warning"`
  - `type CandidateEvidenceField = { label: string; value: string | string[] }`
  - `type CandidateEvidenceNote = { level: "info" | "warning" | "success"; text: string }`
  - `type CandidateEvidenceSection = { title: string; status: CandidateEvidenceStatus; summary?: string; reason?: string; fields: CandidateEvidenceField[]; sourceFiles?: string[]; detectedBy?: string; notes?: CandidateEvidenceNote[]; confidenceImpactLabel?: string; confidenceImpactReason?: string }`
  - `type CandidateEvidenceDetails = { candidateId: string; candidateType: string; codeDetection: CandidateEvidenceSection; logScans: CandidateEvidenceSection; llmReview: CandidateEvidenceSection }`
- `sourceFiles` and `detectedBy` are added to the section type beyond the brief because the existing Code Detection rendering uses them; both optional so log-scans and llm-review sections omit them.
- All four status values are defined now. `available` and `not_available` carry the semantic styling shipping today. `partial` and `warning` are defined for forward-compatibility only (Spec 5/6 will populate `partial`).
- Pure module: no React, no CSS, no API imports.

**New top-level builder (`candidateEvidenceBuilder.ts`)**
- Exports `buildCandidateEvidenceDetails(candidate: DiscoveryCandidateDto): CandidateEvidenceDetails`.
- Composes the three section builders into a single object: `{ candidateId: candidate.id, candidateType: candidate.candidate_type, codeDetection: ..., logScans: ..., llmReview: ... }`.
- Also exports `buildLogScansEvidenceSection(candidate)` returning the hardcoded placeholder: `{ title: 'Log Scans', status: 'not_available', summary: 'Log scan evidence is not available for this run.', fields: [] }`.
- Also exports `buildLlmReviewEvidenceSection(candidate)` returning the hardcoded placeholder: `{ title: 'LLM Review', status: 'not_available', summary: 'No candidate-specific LLM review details are available yet.', fields: [] }`.
- Pure module: no React, no CSS, no API imports.

**New code-detection wrapper builder (`codeDetectionEvidenceBuilder.ts`)**
- Exports `buildCodeDetectionEvidenceSection(candidate: DiscoveryCandidateDto): CandidateEvidenceSection`.
- Internally calls `buildCodeDetectionDetails(candidate)` from Spec 2's `codeDetectionMappers.ts` (consumed unchanged).
- Maps the returned `CodeDetectionDisplay` to a `CandidateEvidenceSection`:
  - `title: 'Code Detection'`
  - `status: display.isMostlyEmpty ? 'not_available' : 'available'`
  - `reason: display.reason`
  - `fields: display.fields` (shape-compatible: `{ label, value: string | string[] }`)
  - `detectedBy: display.detectedBy`
  - `sourceFiles: display.sourceFiles`
- Does NOT set `confidenceImpactLabel`, `confidenceImpactReason`, or `notes` in this spec. Population of impact fields is deferred to Spec 7 (Confidence, Tier, and Runtime Badges).
- Pure module: no React, no CSS, no API imports.

**New generic renderer (`CandidateEvidenceSectionCard.tsx`)**
- Props: `{ section: CandidateEvidenceSection; testIdPrefix: string }`.
- Knows nothing about candidate types; operates only on the `CandidateEvidenceSection` shape.
- Wrapper: `<div data-testid={`${testIdPrefix}-panel`} className={styles.detailsColumnBody}>`.
- Conditional rendering rules (each line emitted only when its source field is present and non-empty):
  - When `section.detectedBy` is non-empty: `<div data-testid={`${testIdPrefix}-detected-by`}>Detected by: {detectedBy}</div>`.
  - When `section.sourceFiles?.length`: `<div data-testid={`${testIdPrefix}-source-files`}>` containing `Source files:` header plus one inner `<div>` per path.
  - When `section.reason` is non-empty: `<div data-testid={`${testIdPrefix}-reason`}>Reason: {reason}</div>`. Otherwise, when `section.summary` is non-empty: render the summary as the wrapper's body text (preserves the exact placeholder string contract for Log Scans and LLM Review where `summary` IS the body).
  - For each `field` in `section.fields`: `<div data-testid={`${testIdPrefix}-field-{slug}`}>` rendering `label: value`. Arrays render as a label header plus one inner `<div>` per item. Slug is derived via the existing `slugifyLabel` helper (lowercase + kebab-case), moved verbatim from Spec 2's `CodeDetectionPanel.tsx` into this card.
  - Empty-state line `<div data-testid={`${testIdPrefix}-empty`}>Type-specific details: not available.</div>` is emitted ONLY when there is literally nothing else to show: `fields.length === 0` AND no `sourceFiles` AND no `reason` AND no `summary`. This preserves Spec 2's behaviour: the line appears for the Code Detection section when `display.isMostlyEmpty` is true and curated fields are absent, but does NOT appear for the Log Scans / LLM Review placeholders (whose `summary` IS the body).
  - When `section.confidenceImpactLabel` is non-empty: render an impact block with `Impact: {label}` and the optional `confidenceImpactReason` underneath. Defined in renderer for Spec 7; never triggered in Spec 3 because the builder does not set the field.
  - When `section.notes?.length`: render each as a small line keyed by index with the level as a class hint. Defined in renderer for forward compatibility; never triggered in Spec 3.
- Status-aware styling: `available` and `not_available` get the visual treatment that shipped in Spec 2 (reuse `detailsColumnBody`). `partial` and `warning` are defined now and render with the same styling as `not_available` for now (forward-compatible no-op).

**Modified orchestrator (`CandidateDetailsPanel.tsx`)**
- Prop signature is unchanged: `{ candidate: DiscoveryCandidateDto }`. The call site in `DiscoveryCandidateTable.tsx` is NOT touched.
- Outer wrapper testid `candidate-details-panel-{candidate.id}` is preserved verbatim (Spec 1 backstop asserts this).
- The body is replaced. The new body:
  1. Calls `buildCandidateEvidenceDetails(candidate)` to obtain a `CandidateEvidenceDetails`.
  2. Renders three columns inside the existing `.detailsPanel` grid. Each column is `<div className={styles.detailsColumn}><h4 className={styles.detailsColumnHeading}>{section.title}</h4><CandidateEvidenceSectionCard section={section} testIdPrefix={prefix} /></div>`.
  3. Mappings: `section=evidence.codeDetection, prefix="code-detection"`; `section=evidence.logScans, prefix="log-scans"`; `section=evidence.llmReview, prefix="llm-review"`.
- Heading text comes from `section.title` (the contract owns the strings) so the orchestrator can drive all three columns with one map.
- Three preserved column headings: `Code Detection`, `Log Scans`, `LLM Review` — emitted via the section titles.

**Deleted file (`CodeDetectionPanel.tsx`)**
- Replaced wholesale by the generic `CandidateEvidenceSectionCard`. Its `slugifyLabel` helper moves into the new card unchanged.
- All testids previously emitted by this component (`code-detection-panel`, `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-{slug}`, `code-detection-empty`) are emitted by the generic card when invoked with `testIdPrefix="code-detection"`. The DOM structure for the codeDetection section is byte-identical to today.

**What does NOT change**
- `DiscoveryCandidateTable.tsx` — call site stays `<CandidateDetailsPanel candidate={candidate} />`.
- `candidateDetailsSupport.ts` — the four-type allowlist (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`) is unchanged; unsupported types remain non-expandable.
- `codeDetectionMappers.ts` — Spec 2 mapper consumed verbatim; not modified.
- `DiscoveryRunDetailView.module.css` — no new classes required (the generic card reuses `detailsColumnBody`); any new note/impact styling is deferred until a populator first uses those fields (Spec 6/7).
- The three column headings (`Code Detection`, `Log Scans`, `LLM Review`).
- The exact Log Scans placeholder string (`"Log scan evidence is not available for this run."`) and the exact LLM Review placeholder string (`"No candidate-specific LLM review details are available yet."`).
- Approve / Reject / Defer behaviour, table filtering, sorting, paging, single-row expansion, disabled-button semantics for unsupported types.
- All preserved testids: `candidate-details-panel-{id}`, `candidate-details-row-{id}`, `code-detection-panel`, `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-{slug}`, `code-detection-empty`, `log-scans-panel`, `llm-review-panel`.
- `discoveryApi.ts`, `DiscoveryCandidateDto`, all backend code.

## Visual Design

The `planning/visuals/` folder is empty for this spec. The visual reference is Spec 1's three-column layout combined with Spec 2's curated Code Detection body — both preserved byte-identical by this spec for the codeDetection section, and the Log Scans / LLM Review columns continue to render their exact placeholder strings as they do today.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/codeDetectionMappers.ts` (Spec 2)**
- Consumed unchanged by `codeDetectionEvidenceBuilder.ts`. The `CodeDetectionDisplay` shape (`{ detectedBy, reason, sourceFiles, fields, isMostlyEmpty }`) maps cleanly onto `CandidateEvidenceSection`. The new builder is a thin adapter — no mapper logic is duplicated.

**`frontend/src/components/DashboardView/CodeDetectionPanel.tsx` (Spec 2 — to be deleted)**
- Source of the `slugifyLabel(label: string)` helper (lowercase + kebab-case). Move this helper verbatim into `CandidateEvidenceSectionCard.tsx`.
- Source of the rendering rules for Code Detection (detected-by line, source-files block, reason line, per-field rows, empty fallback). All rules are reproduced inside the generic card with `testIdPrefix` parameterisation so emitted DOM is byte-identical for the codeDetection section.

**`frontend/src/components/DashboardView/CandidateDetailsPanel.tsx` (Spec 1 + 2)**
- Outer wrapper testid `candidate-details-panel-{candidate.id}` is preserved. The three-column grid (`.detailsPanel`), per-column container (`.detailsColumn`), and heading (`.detailsColumnHeading`) classes are preserved. The body is replaced by three `<CandidateEvidenceSectionCard>` instances driven by the new builder.

**`frontend/src/components/DashboardView/candidateDetailsSupport.ts` (Spec 1)**
- Unchanged. The expandability gate (`supportsDetails`) remains the source of truth for which candidate rows render an expansion.

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` (Spec 1)**
- Reuse `.detailsColumnBody` for the generic card wrapper. No new classes added in this spec; note/impact styling is deferred to the spec that first populates those fields.

## Out of Scope
- Backend evidence/explainability contract, DTO changes, database schema changes (frontend-only refactor).
- Log upload, log parsing, runtime endpoint matches, runtime evidence display (Specs 4–6).
- Confidence score recalculation, tier label changes, runtime badges (Spec 7).
- Populating `confidenceImpactLabel` / `confidenceImpactReason` — Spec 7 owns the impact-wording rules and population logic.
- Populating `notes` for any section — defer to the spec that first introduces a populator.
- LLM-generated reasoning or any LLM enrichment of any column.
- Showing raw source code snippets or line numbers.
- Adding or removing candidate types from the supported allowlist.
- Changes to `DiscoveryCandidateTable.tsx` (call site, expansion state, filtering, sorting, paging) or `candidateDetailsSupport.ts`.
- Renaming any of the preserved testids listed above.

## Test Plan

**New file: `frontend/src/components/DashboardView/__tests__/candidateEvidenceBuilder.test.ts`** (pure unit tests; no React, no rendering)
- `buildCandidateEvidenceDetails` returns an object containing all three sections (`codeDetection`, `logScans`, `llmReview`) plus `candidateId` and `candidateType` derived from the input candidate.
- `buildLogScansEvidenceSection` returns the exact placeholder shape: `title: 'Log Scans'`, `status: 'not_available'`, `summary: 'Log scan evidence is not available for this run.'`, `fields: []`.
- `buildLlmReviewEvidenceSection` returns the exact placeholder shape: `title: 'LLM Review'`, `status: 'not_available'`, `summary: 'No candidate-specific LLM review details are available yet.'`, `fields: []`.
- `buildCodeDetectionEvidenceSection` on a populated server-shape Spring Boot endpoint candidate returns `status: 'available'`, populates `reason`, `fields`, `detectedBy`, and `sourceFiles` from the Spec 2 mapper output.
- `buildCodeDetectionEvidenceSection` on a sparse candidate where Spec 2's mapper sets `isMostlyEmpty: true` returns `status: 'not_available'`.
- `buildCodeDetectionEvidenceSection` does NOT set `confidenceImpactLabel`, `confidenceImpactReason`, or `notes` in any case (deferred to Spec 7).
- `buildCandidateEvidenceDetails` carries `candidate.candidate_type` through to the top-level `candidateType` field unchanged for each of the four supported types.
- A defensive test confirming that when the underlying Spec 2 mapper returns its defensive default (unknown candidate type), the section's `status` is `'not_available'` and `reason` is the Spec 2 default reason string.

**New file: `frontend/src/components/DashboardView/__tests__/candidateEvidenceSectionCard.test.tsx`** (renderer tests over the generic card)
- All three `testIdPrefix` values (`"code-detection"`, `"log-scans"`, `"llm-review"`) emit the wrapper testid `{prefix}-panel`.
- A populated section with `detectedBy`, `sourceFiles`, `reason`, and `fields` renders all four corresponding testid lines under the chosen prefix (driven with `prefix="code-detection"` to match Spec 2 testid expectations).
- A placeholder section (no fields, no sourceFiles, no reason, only `summary`) renders the summary as wrapper body text and does NOT emit `{prefix}-empty`, `{prefix}-detected-by`, `{prefix}-source-files`, `{prefix}-reason`, or any `{prefix}-field-*` lines.
- An empty section (no fields, no sourceFiles, no reason, no summary) emits `{prefix}-empty` with the exact text `Type-specific details: not available.`.
- Each of the four `CandidateEvidenceStatus` values renders without throwing; `partial` and `warning` render with the same DOM as `not_available`.
- The impact block (`Impact: {label}` + reason) is hidden when `confidenceImpactLabel` is absent and rendered when present.
- The notes block is hidden when `notes` is absent/empty and rendered when present, one entry per note keyed by index.
- Per-field testid slugs match Spec 2's `slugifyLabel` (lowercase + kebab-case): a field labelled `HTTP method` produces `{prefix}-field-http-method`.

**Rewritten file: `frontend/src/components/DashboardView/__tests__/candidateDetailsPanel.test.tsx`** (orchestrator-level integration tests)
- Recommendation: keep the file as a thin orchestrator integration suite. The `CandidateDetailsPanel` describe block (wrapper testid, three column headings via `getByRole('heading', { level: 4, name: ... })`, three body testids `code-detection-panel` / `log-scans-panel` / `llm-review-panel`, the exact placeholder strings) is preserved unchanged because the generic card emits the same DOM. The previous `CodeDetectionPanel` describe block is rewritten to drive `<CandidateDetailsPanel candidate={...} />` directly (the dedicated component is gone) and continues to assert the same `code-detection-*` testids, which remain byte-identical. The per-type field-coverage matrix (server-shape Spring Boot, client-shape React/axios, Spring controller, Spring bean, sparse logical entity, sparse interface_logical_entity, isMostlyEmpty empty-state, source-files list) is preserved as orchestrator-level integration coverage; deeper unit coverage of the wrapper builder lives in `candidateEvidenceBuilder.test.ts`.
- Imports: drop `CodeDetectionPanel`; keep `CandidateDetailsPanel`. No other import changes.

**Non-regression backstop**
- `frontend/src/components/DashboardView/__tests__/candidateDetailsExpansion.test.tsx` (Spec 1 integration test) MUST continue to pass with ZERO edits. The wrapper testid `candidate-details-panel-{candidate.id}`, the row testid `candidate-details-row-{candidate.id}`, the three column headings, and the three body testids are all preserved by this spec. This is the explicit guardrail that the table call site, expansion state, and three-column structural contract are intact.
- `frontend/src/components/DashboardView/__tests__/candidateReviewWorkflow.test.tsx` and any other tests importing `DiscoveryCandidateTable` or `DiscoveryRunDetailView` MUST continue to pass unchanged.
- `frontend/src/components/DashboardView/__tests__/codeDetectionMappers.test.ts` (Spec 2 pure unit tests) MUST continue to pass unchanged because `codeDetectionMappers.ts` is consumed verbatim.

## Acceptance Criteria
- The frontend defines the normalized evidence contract types (`CandidateEvidenceStatus`, `CandidateEvidenceField`, `CandidateEvidenceNote`, `CandidateEvidenceSection`, `CandidateEvidenceDetails`) in a dedicated module.
- The `CandidateDetailsPanel` renders from a `CandidateEvidenceDetails` object built internally by `buildCandidateEvidenceDetails(candidate)`.
- Spec 2's curated Code Detection mapper output feeds the normalized model via `buildCodeDetectionEvidenceSection`, with `status: 'available'` when useful details exist and `status: 'not_available'` when the mapper flags `isMostlyEmpty`.
- The rendering component (`CandidateEvidenceSectionCard`) is generic, takes a `testIdPrefix`, and is not coupled to candidate-type-specific shapes.
- The four supported candidate types (`endpoints`, `interfaces`, `logical_data_entities`, `interface_logical_entities`) still expand into the three-column details panel; unsupported types remain non-expandable.
- Code Detection content remains curated and readable as defined in Spec 2 (byte-identical DOM under the `code-detection-*` testids).
- Log Scans always renders the exact string `"Log scan evidence is not available for this run."` under `data-testid="log-scans-panel"`.
- LLM Review always renders the exact string `"No candidate-specific LLM review details are available yet."` under `data-testid="llm-review-panel"`.
- Optional `confidenceImpactLabel` / `confidenceImpactReason` are defined in the contract and the renderer reads them when present, but the builder does not populate them in this spec (deferred to Spec 7); they must not change the actual confidence score.
- Approve / Reject / Defer behaviour, table filtering, sorting, paging, and review-status row tinting are unchanged.
- No backend, discovery-service, log-processing, or tier-label changes are introduced by this spec.
- The Spec 1 expansion integration test (`candidateDetailsExpansion.test.tsx`) passes unchanged.

## Roadmap Context
Spec 3 of 7 in the discovery candidate evidence explainability roadmap: (1) Candidate Details Expansion UI, (2) Code Detection Detail Mappers, (3) Candidate Evidence Data Contract [this spec], (4) Runtime Log Input at Discovery Run Start, (5) Web Access Log Runtime Endpoint Evidence, (6) Log Evidence in Candidate Details UI, (7) Confidence, Tier, and Runtime Badges.
