# Shaping Notes -- Spec 3: Candidate Evidence Data Contract

Date: 2026-05-10
Brief: `planning/raw-idea.md`
Roadmap position: Spec 3 of 7 (discovery candidate evidence explainability).
Auto mode active -- non-blocking decisions taken below; only genuine product
calls are surfaced in section 6.

## 1. What's on disk today (verified by reading every file the brief listed)

### 1.1 `CandidateDetailsPanel.tsx` (orchestrator)
- Takes `candidate: DiscoveryCandidateDto` directly.
- Renders the outer wrapper `<div data-testid="candidate-details-panel-{candidate.id}" className={styles.detailsPanel}>`.
- Renders three columns, each with `<h4 className={styles.detailsColumnHeading}>` headings ("Code Detection", "Log Scans", "LLM Review").
- Code Detection delegates to `<CodeDetectionPanel candidate={candidate} />`.
- Log Scans is INLINE: `<div data-testid="log-scans-panel" className={styles.detailsColumnBody}>Log scan evidence is not available for this run.</div>`.
- LLM Review is INLINE: `<div data-testid="llm-review-panel" className={styles.detailsColumnBody}>No candidate-specific LLM review details are available yet.</div>`.

### 1.2 `CodeDetectionPanel.tsx` (Spec 2 thin renderer)
- Takes `candidate`, calls `buildCodeDetectionDetails(candidate)` from `codeDetectionMappers.ts`, walks the returned `CodeDetectionDisplay`.
- Renders, in order:
  - `<div data-testid="code-detection-panel" className={styles.detailsColumnBody}>` wrapper.
  - `<div data-testid="code-detection-detected-by">Detected by: {display.detectedBy}</div>`.
  - `<div data-testid="code-detection-source-files">` block containing `Source files:` header + one `<div>` per path.
  - `<div data-testid="code-detection-reason">Reason: {display.reason}</div>`.
  - One `<div data-testid="code-detection-field-{slug}">` per field. Arrays render as `label:` + one `<div>` per item.
  - When `display.isMostlyEmpty` is true, an additional `<div data-testid="code-detection-empty">Type-specific details: not available.</div>`.
- Local `slugifyLabel(label: string)` helper lowercases + kebab-cases the label for the testid suffix.

### 1.3 `codeDetectionMappers.ts` (Spec 2 -- already produces a section-shaped model)
- Exports interfaces `CodeDetectionField { label, value }` and `CodeDetectionDisplay { detectedBy, reason, sourceFiles, fields, isMostlyEmpty }`.
- Dispatcher `buildCodeDetectionDetails(candidate)` switches on `candidate.candidate_type` to one of four per-type builders; defensive default returns an `isMostlyEmpty: true` display with the generic reason `"Detected from deterministic code analysis."`.
- `formatAdapterDisplayName(value)` exported for adapter-name normalisation; returns `"deterministic code analysis"` for null/undefined/empty.
- Pure -- no React, no CSS, no API.

### 1.4 `candidateDetailsSupport.ts`
- Exports `SUPPORTED_DETAIL_TYPES` (Set of 4) and `supportsDetails(candidateType)`.
- UNCHANGED by Spec 3.

### 1.5 `DiscoveryCandidateTable.tsx`
- Owns `expandedCandidateId` state + toggle handler.
- Renders the expansion row inside the same `<tbody>`: double-guarded by `isExpanded && canExpand`, with `<tr data-testid="candidate-details-row-{candidate.id}"><td colSpan={CANDIDATE_TABLE_COLUMN_COUNT}><CandidateDetailsPanel candidate={candidate} /></td></tr>`.
- Imports `<CandidateDetailsPanel>` from `./CandidateDetailsPanel`.
- Today's call site passes `candidate={candidate}` (single prop).

### 1.6 `DiscoveryRunDetailView.module.css` (lines 830-883)
- `.detailsPanel` (3-col grid + 768px stacked fallback)
- `.detailsColumn` (card with border)
- `.detailsColumnHeading` (h4 styling)
- `.detailsColumnBody` (column body container)
- No status-tint classes today, no notes-block classes today, no impact-block classes today.

### 1.7 Existing tests that constrain Spec 3

**`__tests__/candidateDetailsPanel.test.tsx` (Spec 2 file -- 9 tests)**
- `CandidateDetailsPanel` describe block (2 tests):
  - Asserts wrapper testid `candidate-details-panel-{candidate.id}`, the three `<h4>` headings ("Code Detection", "Log Scans", "LLM Review"), and the three body testids (`code-detection-panel`, `log-scans-panel`, `llm-review-panel`).
  - Asserts the EXACT placeholder strings in `log-scans-panel` and `llm-review-panel`.
- `CodeDetectionPanel` describe block (7 tests): drives `<CodeDetectionPanel candidate={...} />` directly; asserts adapter-display, reason, per-type field testids (`code-detection-field-{slug}`), source-files block, empty-state testid.

**`__tests__/candidateDetailsExpansion.test.tsx` (Spec 1 file -- 7 tests)**
- Renders the full table. Asserts wrapper `candidate-details-panel-{candidate.id}` and the row testid `candidate-details-row-{candidate.id}`. Asserts the panel does NOT contain row-summary fields. Does NOT touch Code Detection internals.

### 1.8 Exact testids that MUST survive Spec 3

| Testid | Source | Asserted in |
|--------|--------|-------------|
| `candidate-details-panel-{id}` | `CandidateDetailsPanel` wrapper | both test files |
| `candidate-details-row-{id}` | `DiscoveryCandidateTable` expansion `<tr>` | expansion test |
| `code-detection-panel` | code-detection body wrapper | panel test |
| `code-detection-detected-by` | "Detected by: ..." line | panel test |
| `code-detection-source-files` | source files block | panel test |
| `code-detection-reason` | "Reason: ..." line | panel test |
| `code-detection-field-{slug}` | per-field row | panel test (many slugs) |
| `code-detection-empty` | isMostlyEmpty fallback line | panel test |
| `log-scans-panel` | Log Scans column body | panel test |
| `llm-review-panel` | LLM Review column body | panel test |

The h4 headings ("Code Detection", "Log Scans", "LLM Review") are also asserted by role+name. The exact placeholder strings for Log Scans and LLM Review are asserted by `toHaveTextContent`.

### 1.9 Exact reason strings + field labels emitted by Spec 2 mappers (must be preserved through the new contract)

Reasons (from mapper constants):
- `REASON_ENDPOINT_SERVER`: `"Detected as a controller method exposed through framework route annotations."`
- `REASON_ENDPOINT_CLIENT`: `"Detected as an HTTP call from frontend code making framework HTTP-client calls."`
- `REASON_ENDPOINT_FALLBACK`: `"Detected as an HTTP endpoint from framework route metadata in code."`
- `REASON_INTERFACE_BEAN`: `"Detected as a Spring bean definition from a @Configuration class."`
- `REASON_INTERFACE_CONTROLLER`: `"Detected as an interface/API surface from framework controller metadata."`
- `REASON_LOGICAL_TS`: `"Detected as a logical data shape from TypeScript or JavaScript model/type metadata."`
- `REASON_LOGICAL_DEFAULT`: `"Detected as a logical data shape referenced by interface or endpoint code."`
- `REASON_INTERFACE_LOGICAL`: `"Detected because interface code references this logical data entity."`
- `REASON_DEFAULT` (defensive default branch): `"Detected from deterministic code analysis."`

Field labels per type (verified against mapper source):
- `endpoints` server: HTTP method, Path, Controller, Handler method, Request body type, Response type, Path variables, Request parameters, Security, OpenAPI operation, Transactional.
- `endpoints` client: HTTP method, URL, Calling function, API library, Response type.
- `interfaces` controller: Class, Interface type, Base path, Package, Resource, OpenAPI tag, Security.
- `interfaces` bean: Bean name, Bean return type, Configuration class, Package, Scope, Primary, Lazy.
- `logical_data_entities`: Type, Package, Kind, Extends.
- `interface_logical_entities`: Interface, Logical data entity.

All of these are testid-asserted as `code-detection-field-{slug}` lines in `candidateDetailsPanel.test.tsx`.

## 2. The big architectural decisions Spec 3 must make

### 2.1 Where does `buildCandidateEvidenceDetails` get called?

Two viable seams:
- **Option A (panel-builds):** `<CandidateDetailsPanel candidate={candidate} />` keeps its current prop. Inside, it calls `buildCandidateEvidenceDetails(candidate)` and renders from the returned `CandidateEvidenceDetails`. Table is unchanged.
- **Option B (table-builds):** Table calls `buildCandidateEvidenceDetails(candidate)` and passes `<CandidateDetailsPanel evidence={...} />`. Panel becomes purely presentational over an `CandidateEvidenceDetails` prop.

**Recommendation: Option A (panel-builds).** Reasons:
1. Zero call-site change in the table. The expansion test (`candidateDetailsExpansion.test.tsx`) imports the table, mounts it with raw candidates, and asserts on the wrapper testid -- it MUST keep passing unchanged. Option A is a strictly internal refactor. Option B requires either (a) updating the table OR (b) accepting BOTH props on the panel for compatibility (worse).
2. The panel has been the natural "one input -> three columns" boundary since Spec 1. Pushing build to the table leaks evidence-shape concerns into a component whose job is candidate-table layout/state.
3. Future Spec 6 (Log Evidence in Candidate Details UI) will likely need to enrich the evidence model from a different source (per-run log results). Doing it in the panel keeps the enrichment seam single and obvious; doing it at the table would scatter concerns.
4. Tests can directly drive `<CandidateDetailsPanel candidate={...} />` exactly as today -- no plumbing to update beyond the internal renderer.
5. Spec 7 (badges) benefits from the section's `confidenceImpactLabel` being computed alongside the evidence, not at the table layer.

The brief leaves this open ("These exact names can be adjusted to match project conventions") so this is a defensible default. Surfacing as **Q1** in case the user has a strong preference for Option B.

### 2.2 Does `CodeDetectionPanel.tsx` survive?

**Recommendation: Delete `CodeDetectionPanel.tsx`. Replace it with a generic `CandidateEvidenceSectionCard` (per the brief's suggested file name) that the orchestrator iterates three times (once per section).** Reasons:
1. The brief explicitly says "The rendering component should be generic" and "It does not need to know candidate-type-specific details." Keeping a dedicated `CodeDetectionPanel` per-section component contradicts that.
2. All section-shaped rendering work (label, list, empty state) is identical for the three sections; a single generic card is simpler and avoids the "what if a fourth section appears" branch that would otherwise be tempting.
3. The Code Detection section's testids (`code-detection-panel`, `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-{slug}`, `code-detection-empty`) MUST be preserved -- 7 panel tests + the expansion-row integration test depend on them. The generic `CandidateEvidenceSectionCard` will accept a `testIdPrefix` prop (e.g. `"code-detection"`, `"log-scans"`, `"llm-review"`) so the same render can produce `code-detection-*` testids for the codeDetection section, `log-scans-panel` and `llm-review-panel` for the placeholder sections.

**Concrete testid mapping** (preserving every existing testid):
- Section wrapper: `data-testid="{prefix}-panel"` (`code-detection-panel`, `log-scans-panel`, `llm-review-panel`).
- Detected-by: `data-testid="{prefix}-detected-by"` -- but this only appears for sections whose model has a non-null adapter line. For `code-detection` section we always emit it (preserving today's behaviour). For `log-scans` / `llm-review` sections, no detected-by line is rendered (matches today's inline placeholders, which only render the placeholder string).
- Source files: `data-testid="{prefix}-source-files"` -- same gating.
- Reason: `data-testid="{prefix}-reason"` -- same gating. (Note: for Log Scans and LLM Review today, the placeholder string IS the body content. To preserve `log-scans-panel` and `llm-review-panel` testids matching the EXACT placeholder string via `toHaveTextContent`, we'll render the placeholder section's `summary`/`reason` as the wrapper's text content. The wrapper's testid carries the full placeholder string.)
- Per-field rows: `data-testid="{prefix}-field-{slug}"`. For codeDetection this means `code-detection-field-{slug}` -- unchanged. The other two sections have empty `fields` so this never renders for them.
- Empty fallback: `data-testid="{prefix}-empty"`. For codeDetection this means `code-detection-empty` -- unchanged. (The brief's status taxonomy adds `not_available`; the existing empty-line rendering is now driven by `status === 'not_available'` for the codeDetection section, OR by the legacy `isMostlyEmpty` flag carried through into the section -- see 4.2 below.)

This is the only real risk in the spec: if the generic card doesn't perfectly preserve every testid above, both test files break. The shaping note's job is to call this out so spec-writer is explicit: the card MUST accept `testIdPrefix` and emit identical DOM to today for the codeDetection section.

### 2.3 Status taxonomy: define all 4 now or trim to 2?

Brief specifies four: `"available" | "not_available" | "partial" | "warning"`.
- `"available"` -- needed (codeDetection populated case).
- `"not_available"` -- needed (logScans + llmReview always; codeDetection when `isMostlyEmpty`).
- `"partial"` -- no consumer in this spec.
- `"warning"` -- no consumer in this spec.

**Recommendation: Define all 4 in the contract NOW; only the renderer needs to handle `"available"` and `"not_available"` in this spec; document `"partial"` and `"warning"` as forward-compatible values that the renderer treats identically to `"available"` for now (no special styling / icon).** Reasons:
1. The contract is the explicit deliverable of this spec; defining the taxonomy once avoids a follow-up breaking change in Spec 6/7.
2. Adding a value to a string-literal union later is a TypeScript breaking change for every exhaustive switch -- locking the four now makes Spec 7 (status-driven badges) a strictly additive change.
3. Renderer keeps a 2-branch implementation today (cheap), but the type system already permits the future values.
4. Brief explicitly lists all four; no benefit to trimming.

Surfacing as **Q2** in case the user prefers a strict YAGNI cut.

### 2.4 `confidenceImpactLabel` / `confidenceImpactReason` -- populate now (Spec 3) or defer (Spec 7)?

The brief's example shows `confidenceImpactLabel: "High"` populated on a Spring Boot endpoint. Acceptance criterion says "Optional confidence impact fields may be displayed but must not change the actual confidence score." Spec 7 is explicitly "Confidence, Tier, and Runtime Badges."

**Recommendation: Define the optional fields in the contract but DO NOT populate them in Spec 3. Populating is Spec 7's job.** Reasons:
1. Choosing the impact label rules ("High for adapter-sourced server endpoints", "Medium for sparse logical entities", etc.) is a real product call about how confidence is explained -- it belongs in the spec that owns the confidence/tier UX, not the data-contract spec.
2. Spec 3's job per the brief is to "introduce a normalized frontend evidence data contract so the details UI renders from one stable evidence model." That goal is fully met without populating impact text.
3. Renderer must support displaying impact text when present (covered by the contract being optional + the section card rendering it conditionally with a testid like `code-detection-confidence-impact`). Spec 7 then populates the field and adds tests for the impact wording.
4. Premature population means Spec 7 has to either accept Spec 3's wording as a fait accompli or revisit it -- worse for both specs.

Surfacing as **Q3** in case the user wants Spec 3 to ship a first-cut population now.

### 2.5 Notes -- define type, no populator yet

`notes?: CandidateEvidenceNote[]` with `level: "info" | "warning" | "success"`.

**Decision (autonomous, low-stakes):** Define the type. Do not populate notes for any section in this spec. Renderer must render notes conditionally if present (testid pattern `{prefix}-note-{index}` with the level as a class hint). No new CSS classes added by this spec for note styling -- defer to Spec 6 or Spec 7 when a populator first uses notes.

Same as 2.4 in spirit: contract-only, no behaviour.

## 3. Implementation decisions taken autonomously (no user input needed)

### 3.1 File layout

New files in `frontend/src/components/DashboardView/`:
- `candidateEvidenceTypes.ts` -- pure types only (`CandidateEvidenceStatus`, `CandidateEvidenceField`, `CandidateEvidenceNote`, `CandidateEvidenceSection`, `CandidateEvidenceDetails`).
- `codeDetectionEvidenceBuilder.ts` -- exports `buildCodeDetectionEvidenceSection(candidate): CandidateEvidenceSection`. Internally calls `buildCodeDetectionDetails` from `codeDetectionMappers.ts` and maps the `CodeDetectionDisplay` -> `CandidateEvidenceSection`.
- `candidateEvidenceBuilder.ts` -- exports `buildCandidateEvidenceDetails(candidate): CandidateEvidenceDetails`. Composes the three section builders. Exports `buildLogScansEvidenceSection(candidate)` and `buildLlmReviewEvidenceSection(candidate)` (placeholder builders -- trivial).
- `CandidateEvidenceSectionCard.tsx` -- new generic renderer. Props: `{ section: CandidateEvidenceSection; testIdPrefix: string }`.

Modified files:
- `CandidateDetailsPanel.tsx` -- body replaced. Calls `buildCandidateEvidenceDetails(candidate)`, renders three `<CandidateEvidenceSectionCard>` instances with `testIdPrefix` `"code-detection"`, `"log-scans"`, `"llm-review"`. Outer wrapper testid `candidate-details-panel-{candidate.id}` PRESERVED. Three `<h4>` column headings PRESERVED.
- `CodeDetectionPanel.tsx` -- DELETED. (Decision 2.2.)

New test file:
- `__tests__/candidateEvidenceBuilder.test.ts` -- pure unit tests over the builders.

Modified test files:
- `__tests__/candidateDetailsPanel.test.tsx` -- the `CandidateDetailsPanel` describe block (column headings + placeholder strings) stays. The `CodeDetectionPanel` describe block is rewritten to drive `<CandidateDetailsPanel candidate={...} />` (since the dedicated component is gone) and assert the same testids on the rendered output. Net effect: the test file imports change (drop `CodeDetectionPanel` import), the assertions stay intact because the testids are preserved.

UNCHANGED files:
- `candidateDetailsSupport.ts`
- `codeDetectionMappers.ts` (Spec 2's mapper is consumed verbatim; Spec 3 adds a wrapper, not a replacement)
- `DiscoveryCandidateTable.tsx`
- `DiscoveryRunDetailView.module.css` (no new classes -- the generic card reuses `detailsColumnBody`; if the brief's notes/impact need styling, it's deferred to Spec 6/7 when actually populated)
- `__tests__/candidateDetailsExpansion.test.tsx` (Spec 1 backstop -- MUST stay green unmodified)
- `discoveryApi.ts`, `DiscoveryCandidateDto`, all backend code

### 3.2 `CandidateEvidenceSectionCard` rendering rules

Given `{ section, testIdPrefix }`:
1. Wrapper: `<div data-testid="{testIdPrefix}-panel" className={styles.detailsColumnBody}>`.
2. If `section.fields.length === 0` AND `section.status === 'not_available'`:
   - Render the `summary` (or `reason`) string directly as the wrapper text content. NO additional testids. This produces the EXACT current rendering for log-scans and llm-review (`<div data-testid="log-scans-panel" className={styles.detailsColumnBody}>{string}</div>`).
3. Otherwise (the "available" / populated case -- effectively the codeDetection path):
   - If `section.fields[]` contains a synthetic Detected-by entry (see 3.3), render it as `<div data-testid="{prefix}-detected-by">Detected by: {value}</div>`.
   - If `section.sourceFiles` (carried as a sibling on the section -- see 3.3) is non-empty, render `<div data-testid="{prefix}-source-files">Source files:` block + one inner div per path.
   - Render `<div data-testid="{prefix}-reason">Reason: {section.reason}</div>` when `section.reason` is set.
   - Iterate `section.fields[]` (excluding the synthetic Detected-by and sourceFiles entries) and render `<div data-testid="{prefix}-field-{slug}">label: value</div>` (or label + child divs for arrays).
   - When the `isMostlyEmpty` flag is true (carried on the section -- see 3.3), render `<div data-testid="{prefix}-empty">Type-specific details: not available.</div>`.
4. If `section.confidenceImpactLabel` is set (will not be in Spec 3), render `<div data-testid="{prefix}-confidence-impact">` containing label + reason. Defined in renderer for forward compatibility.
5. If `section.notes?.length`, render each note as `<div data-testid="{prefix}-note-{index}">{text}</div>`. Defined in renderer for forward compatibility.

The `slugifyLabel` helper from today's `CodeDetectionPanel.tsx` moves into the new card unchanged.

### 3.3 How `CodeDetectionDisplay` maps to `CandidateEvidenceSection`

The Spec 2 mapper output has shape `{ detectedBy, reason, sourceFiles, fields, isMostlyEmpty }`. The brief's section shape is `{ title, status, summary?, reason?, fields, notes?, confidenceImpactLabel?, confidenceImpactReason? }`.

**Decision:** Extend the section shape with two optional fields beyond the brief to carry source-files and isMostlyEmpty WITHOUT losing them. Specifically:
```ts
type CandidateEvidenceSection = {
  title: string;
  status: CandidateEvidenceStatus;
  summary?: string;
  reason?: string;
  fields: CandidateEvidenceField[];
  notes?: CandidateEvidenceNote[];
  confidenceImpactLabel?: string;
  confidenceImpactReason?: string;
  // Spec 3 additions to carry through Spec 2's display nuances --
  // see codeDetectionEvidenceBuilder for usage. Optional so the
  // log-scans / llm-review placeholders need not set them.
  sourceFiles?: string[];
  detectedBy?: string;
  isMostlyEmpty?: boolean;
};
```
Rationale: the brief explicitly says "These exact names can be adjusted to match project conventions, but the contract should preserve the same conceptual structure." Adding three optional fields preserves the conceptual structure and avoids the alternative of jamming sourceFiles into `notes` or smuggling adapter info into `fields[0]`.

`buildCodeDetectionEvidenceSection(candidate)`:
- Calls `buildCodeDetectionDetails(candidate)` to get the `CodeDetectionDisplay`.
- Returns:
  ```ts
  {
    title: 'Code Detection',
    status: display.isMostlyEmpty ? 'not_available' : 'available',
    reason: display.reason,
    fields: display.fields, // shape-compatible (label + value: string|string[])
    detectedBy: display.detectedBy,
    sourceFiles: display.sourceFiles,
    isMostlyEmpty: display.isMostlyEmpty,
    // notes/confidenceImpact* deliberately not set in Spec 3.
  }
  ```

`buildLogScansEvidenceSection(candidate)`:
- Returns:
  ```ts
  {
    title: 'Log Scans',
    status: 'not_available',
    summary: 'Log scan evidence is not available for this run.',
    fields: [],
  }
  ```

`buildLlmReviewEvidenceSection(candidate)`:
- Returns:
  ```ts
  {
    title: 'LLM Review',
    status: 'not_available',
    summary: 'No candidate-specific LLM review details are available yet.',
    fields: [],
  }
  ```

### 3.4 Renderer placement of column headings

Today the orchestrator (`CandidateDetailsPanel`) renders the `<h4>` headings, NOT the body component. The Spec 2 docblock notes this explicitly. The integration test asserts headings via `getByRole('heading', { level: 4, name: 'Code Detection' })`. **Decision:** Keep heading rendering in the orchestrator, NOT in `CandidateEvidenceSectionCard`. This means the card is only the body. The orchestrator continues to render `<div className={styles.detailsColumn}><h4 className={styles.detailsColumnHeading}>{section.title}</h4><CandidateEvidenceSectionCard section={section} testIdPrefix={...} /></div>` per column. Heading text comes from the section's `title` so the orchestrator can drive all three with one map.

### 3.5 Test-fixture preservation

The `candidateDetailsPanel.test.tsx` `CandidateDetailsPanel` describe block (2 tests) keeps its assertions unchanged -- the wrapper testid, three headings via role, three body testids, and the placeholder strings are all still produced.

The `CodeDetectionPanel` describe block (7 tests) is rewritten to render `<CandidateDetailsPanel candidate={...} />` instead of `<CodeDetectionPanel candidate={...} />`. All assertions on `code-detection-*` testids stay byte-identical because the generic card emits the same DOM with `testIdPrefix="code-detection"`. Imports change: drop `CodeDetectionPanel`, keep `CandidateDetailsPanel`.

### 3.6 Acceptance criteria coverage map (brief -> implementation)

| Brief criterion | Coverage |
|-----------------|----------|
| Frontend has normalized evidence contract | `candidateEvidenceTypes.ts` defines all 5 types |
| Details UI renders from normalized model | `CandidateDetailsPanel` calls `buildCandidateEvidenceDetails` and renders cards |
| Spec 2 mappers feed normalized model | `buildCodeDetectionEvidenceSection` wraps `buildCodeDetectionDetails` |
| Generic rendering component | `CandidateEvidenceSectionCard` knows nothing about candidate types |
| Four supported types still expandable | `candidateDetailsSupport.ts` UNCHANGED |
| Unsupported types remain non-expandable | Table's `supportsDetails` gate UNCHANGED |
| Code Detection content remains curated | Spec 2 mapper consumed verbatim |
| Log Scans exact string | `buildLogScansEvidenceSection` returns the exact string |
| LLM Review exact string | `buildLlmReviewEvidenceSection` returns the exact string |
| Confidence impact may be displayed | Renderer supports it; Spec 3 does not populate (Q3) |
| Approve/Reject/Defer unchanged | Table UNCHANGED |
| Filtering/sorting/paging unchanged | Table UNCHANGED |
| No backend / discovery-service / log changes | Out of scope |
| Tests updated | `candidateEvidenceBuilder.test.ts` new; `candidateDetailsPanel.test.tsx` rewritten |

## 4. Out of scope (reaffirmed)

Per brief and roadmap context, OUT for Spec 3:
- Backend evidence/explainability contract (frontend-only).
- Log upload, log parsing, runtime endpoint matches (Specs 4-6).
- Confidence/tier/runtime badge changes (Spec 7) -- including populating `confidenceImpactLabel` (Q3 default).
- Notes population (no consumer yet).
- Adapter changes / discovery-service changes.
- Adding/removing candidate types from the supported allowlist.
- Source-code snippet rendering.
- Renaming today's preserved testids.

## 5. Risk register (resolved-by-design)

1. **Testid drift breaks both test files.** Mitigated by 2.2 (testIdPrefix-based card) and 3.5 (rewrite imports only, preserve assertions).
2. **Heading-rendering location ambiguity.** Resolved 3.4: orchestrator renders headings, card renders body only. Matches Spec 2 docblock and existing test.
3. **`sourceFiles` / `detectedBy` / `isMostlyEmpty` lost in translation to the brief's section shape.** Resolved 3.3: contract extends the brief's section type with three optional fields; brief explicitly permits adjustment to match project conventions.
4. **Status union grows later, breaking exhaustive switches.** Mitigated 2.3: define all four values now.
5. **Future Spec 6 needs to enrich evidence from per-run logs.** Panel-builds (2.1) keeps the build seam single -- Spec 6 plugs into `buildCandidateEvidenceDetails` instead of adding plumbing through the table.

## 6. Genuine product/architecture questions for the user

Three real calls; one bonus call I'd default but worth surfacing.

1. **Build seam: panel-builds vs table-builds.** I recommend the panel builds the evidence model internally (`<CandidateDetailsPanel candidate={...} />` keeps its current prop), so this is a strictly internal refactor with no table change and no test plumbing change. Alternative: the table calls the builder and passes `<CandidateDetailsPanel evidence={...} />`. Confirm panel-builds is fine?

2. **Status taxonomy.** Define all four values now (`"available" | "not_available" | "partial" | "warning"`) with renderer treating unknown statuses as available, OR trim to `"available" | "not_available"` and broaden later when a consumer appears? I recommend defining all four now to avoid a breaking-change cycle in Spec 7.

3. **`confidenceImpactLabel` / `confidenceImpactReason`.** Define the optional fields in the contract but DO NOT populate them in Spec 3 -- defer population to Spec 7 (Confidence, Tier, and Runtime Badges) which owns the impact-wording rules. The brief's example shows `confidenceImpactLabel: "High"` populated, but the acceptance criterion only says "may be displayed" and Spec 7 is the dedicated badge spec. Confirm we defer population to Spec 7?

4. **(Bonus) Delete `CodeDetectionPanel.tsx`.** I recommend deleting it and replacing with a generic `CandidateEvidenceSectionCard` that accepts a `testIdPrefix` so all `code-detection-*` testids are preserved on the codeDetection section. Alternative: keep `CodeDetectionPanel.tsx` as the codeDetection-specific card and only add the generic card for log-scans/llm-review (more code, two ways to do the same thing). Confirm we delete the dedicated component?

## 7. Visual assets

`planning/visuals/` exists but is empty. No design mockups for this spec; the rendered output is constrained to be byte-identical to today for the codeDetection section and identical to today's inline placeholders for the other two sections.

---

## Resolved decisions (user-confirmed 2026-05-10)

The four clarifying questions raised during shaping have been resolved by the user. All four match the shaper's recommended defaults.

1. **Build seam → Panel builds internally.**
   `<CandidateDetailsPanel candidate={candidate} />` keeps its current prop signature. The table call site in `DiscoveryCandidateTable.tsx` is NOT touched. The evidence model stays an internal frontend refactor; `buildCandidateEvidenceDetails(candidate)` is called inside the panel. Spec 1's `candidateDetailsExpansion.test.tsx` requires zero edits as a result.

2. **Status taxonomy → define all four values now.**
   `type CandidateEvidenceStatus = "available" | "not_available" | "partial" | "warning"`. The renderer must handle all four safely — `available` and `not_available` carry semantic styling differences; `partial` and `warning` are defined for forward-compatibility (Spec 5/6 will populate `partial`; future specs may use `warning`). Renderer treats unknown/future statuses as `not_available` styling for now.

3. **`confidenceImpactLabel` / `confidenceImpactReason` → define only, do not populate.**
   The fields exist on `CandidateEvidenceSection` (both optional) and the renderer reads them when present. Spec 3's `buildCodeDetectionEvidenceSection` does NOT set either field. Spec 7 ("Confidence, Tier, and Runtime Badges") owns the UX rules and the population logic. The renderer must conditionally render the impact block ONLY when `confidenceImpactLabel` is non-empty (i.e., for now, never).

4. **Delete `CodeDetectionPanel.tsx`.**
   Replaced by one generic `CandidateEvidenceSectionCard` component that takes a `testIdPrefix` prop (e.g. `"code-detection"`). All existing testids — `{prefix}-panel`, `{prefix}-detected-by`, `{prefix}-source-files`, `{prefix}-reason`, `{prefix}-field-{slug}`, `{prefix}-empty` — are emitted by the generic card so:
   - Spec 1 `candidateDetailsExpansion.test.tsx` stays unchanged (asserts `code-detection-panel` only via the wrapper testid pattern).
   - Spec 2 `candidateDetailsPanel.test.tsx` stays largely unchanged (asserts `code-detection-detected-by`, `code-detection-source-files`, `code-detection-reason`, `code-detection-field-*`, `code-detection-empty`).
   The `log-scans-panel` and `llm-review-panel` testids are also emitted via the generic card with `testIdPrefix` set to `"log-scans"` and `"llm-review"`, but these sections render as the not-available status branch (no source files / fields / impact blocks; only the placeholder summary line).

---
