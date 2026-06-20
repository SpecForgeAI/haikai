# Spec Requirements: Capture data-type format defaults

## Initial Description

(From `planning/raw-idea.md`.)

Add a new "Data-type formats" step to the API Behaviour Baseline capture wizard.

**Problem:** The capture LLM keeps mis-formatting values (especially dates: it guesses ISO when a legacy API really uses e.g. `dd-MMM-yyyy`), burning attempts. Legacy contracts (WADL/XSD/OAS) frequently declare a vague/wrong format (`xsd:date`/ISO) that does not match reality. We have code-evidence (`@JsonFormat`/`@DateTimeFormat`-derived formats from the recently-shipped request-contract scan) and contract formats, but no operator-confirmed per-API default to steer the LLM.

**Solution:** A new wizard step where the operator reviews and confirms per-DATA-TYPE format defaults, pre-filled from real evidence, then fed to the capture LLM as a "try-this-first" default (NOT global hardcoding).

## Requirements Discussion

The 8 decisions below were FIXED in `raw-idea.md` ("do NOT relitigate") and are carried verbatim in intent. The 10 questions after them were the open shaping questions; the operator answered "defaults are fine" — all recommended defaults are accepted, with one refinement to Q5 (explicit "NO DEFAULT" per row).

### Fixed Decisions (carried from raw-idea.md — NOT relitigated)

**F1 — New wizard step + renumber.** Insert a NEW step 5 "Data-type formats" BETWEEN the existing Endpoints step (4) and the Start step. Current wizard is 5 steps: 1 OAS source, 2 API config, 3 DB sampling, 4 Endpoints, 5 Start. The old Start becomes step 6. The draft session already exists by step 4, so the new step persists via the existing `updateCaptureSession` PATCH path.

**F2 — 4-column table.** Exactly 4 columns: `Data Type | Code Format(s) | Contract Format(s) | Default Format`.
- Col 2 Code Format(s): READ-ONLY, from the code scan (`request_contract.param_formats` — `@JsonFormat`/`@DateTimeFormat`-derived, e.g. `dd-MMM-yyyy`).
- Col 3 Contract Format(s): READ-ONLY, from contract parsing (OAS/WADL/XSD `format`/`pattern`). Often semantic (e.g. `format: date` = ISO 8601, `xsd:date`) and may be blank for legacy WADL — the column shows whatever the contract declares.
- Col 4 Default Format: EDITABLE; autocomplete pre-populated with the union of discovered variations (cols 2+3) plus free-text override. THE USER HAS THE FINAL SAY. Whatever sits in Col 4 when the user advances = "the default" passed to the LLM.

**F3 — Rows derived from discovered data types.** Rows are DERIVED from the data types actually discovered in THIS API (do NOT show empty categories — no "Currency" row if there are no currency fields). A taxonomy classifies each discovered field/param format into a category; only categories present are shown.

**F4 — Two separate precedence chains (the crux).**
- (a) SEEDING Col 4 (the value the modal pre-fills): `code(field) > contract(field) > standard/LLM guess`. Col 4 starts as the Col 2 value if present, else Col 3, else a sensible standard default (e.g. ISO 8601 for dates). The user can then override.
- (b) SCAN-TIME per-field attempt order (what the capture LLM follows across its up-to-5 attempts): `code-evidence(field) > [Col-4 user default for that field's data type] > contract(field) > LLM free attempt`. The operator's Col-4 default WEDGES ABOVE the contract (an informed override beats a misleading legacy contract) but BELOW a field's own code-evidence (code annotations are ground truth). The default mainly bites for fields the code scan did NOT pin.
- The difference between (a) and (b) is deliberate: contract is position 2 when SEEDING (no user default exists yet to seed from), but the user's Col-4 default outranks the contract at SCAN time.

**F5 — "Defaults not absolutes."** The capture LLM may still adapt per-field from live response evidence during its attempts (a FAILED learned fact overrides for that field).

**F6 — No logs/runtime formats (DROPPED).** Too expensive AND a log's output/response format need not match the request format. No Runtime column, no value-profiling.

**F7 — Persist on the session as a new JSONB field.** Persist the operator's confirmed Col-4 defaults on the capture session as a NEW JSONB field `data_type_defaults_json` (per-session, per-data-type map, e.g. `{ "date": "dd-MMM-yyyy", "datetime": "...", "numeric_id": "...", ... }`). AMS changeset mirrors the `coverage_summary_json` precedent (changeset 189). NO per-endpoint/per-field override in v1.

**F8 — LLM wiring as a SEPARATE prompt block (not an OAS override).** Inject a NEW `dataTypeDefaults` block into `buildScenarioPrompt` (amvs `captureSessionOrchestrator.ts`) ALONGSIDE the existing `discoveryContext`/`knownGood` blocks, threaded from `session.dataTypeDefaultsJson`. CRITICAL: the operator default must NOT join the existing OAS-override chain (`enrichInventoryWithRequestContracts` does code>contract>runtime OAS overrides stamped `x-amvs-source: code-scan`). It is a SEPARATE prompt block phrased as "try this default for this data type when a field has no code-evidence; prefer it over the contract; a field's own code-evidence still wins; you may still adapt from live evidence." The phrasing must not contradict the existing "read contract format first" instruction in `buildScenarioPrompt` — it refines it.

### Open Shaping Questions (operator: "defaults are fine" — all recommended defaults accepted)

**Q1 — Where the table is computed (client vs amvs preview endpoint).**
**Answer (default accepted):** New amvs preview endpoint `POST /capture-sessions/:id/data-type-defaults-preview` that returns the classified rows + seeded Col-4. Keeps classification in one place for reuse/testing. (Reinforced by grounding correction C1: the frontend cannot compute it anyway — it has no access to `request_contract`.)

**Q2 — The data-type taxonomy.**
**Answer (default accepted):** `date / datetime / time / numeric_id / string_id / boolean / decimal / enum / uuid`, plus a `string` catch-all.

**Q3 — Classification signal precedence (which evidence decides a field's category).**
**Answer (default accepted):** `code-annotation format > OAS type+format > pattern hints > param-name hints`. Param-name hints (id/date/amount) are the LAST resort.

**Q4 — Keep numeric_id vs string_id split?**
**Answer (default accepted):** Yes — keep the split (numeric vs string identifiers are meaningfully different for format defaults).

**Q5 — Persisted `data_type_defaults_json` shape.**
**Answer (default accepted, EXTENDED with refinement):** A plain map `category -> format`, e.g. `{ "date": "dd-MMM-yyyy" }`. Do NOT also store the seed or its source for audit in v1 (plain map only). **Refinement (operator's explicit instruction):** the map must also be able to represent an explicit "NO DEFAULT" choice per category as a `null` value — see "Explicit NO DEFAULT" below. A non-null string = the operator default; `null` = explicit "no default"; an absent key = untouched/never-decided.

**Q6 — Col-4 autocomplete option set + free-text validation.**
**Answer (default accepted):** Autocomplete = union of cols 2/3 distinct values + per-category common standards. Free text is accepted. NO validation of the format string in v1.

**Q7 — LLM prompt phrasing for the scan-time order.**
**Answer (default accepted):** A separate `dataTypeDefaults` block (see F8) that refines — not contradicts — the existing contract-first instruction. Phrasing conveys: try this default for the data type when a field has no code-evidence; prefer it over the contract; a field's own code-evidence still wins; you may still adapt from live evidence.

**Q8 — Empty-state.**
**Answer (default accepted):** Auto-SKIP the step when no classifiable data types are discovered (no rows). The wizard advances past it without showing a "nothing to configure" screen.

**Q9 — Per-row transparency of contributing fields.**
**Answer (default accepted):** Yes — a per-row expandable/tooltip listing the contributing fields (name + location + raw formats) that fed the row.

**Q10 — Implementation specifics.**
**Answer (defaults accepted):**
- (10a) AMS changeset number 195 (highest current = 194; verified).
- (10b) No per-endpoint override in v1.
- (10c) Extend the amvs `CaptureSession` type to carry `dataTypeDefaultsJson` plus its hydration (it is currently omitted — see grounding correction C2).

### Explicit "NO DEFAULT" per data-type row (operator refinement to Q5)

The operator must be able to deliberately choose "no default" for a data type — distinct from the seeded value and from an untouched row. Operator's words: *"ensure that the user can state there is no default i.e. a genuine I don't know / trust over this and therefore I want NO default and therefore skip the default in the API baseline run e.g. enum -> I've no idea, so I don't want a default!"*

Semantics to encode:

- **UI:** Because Col-4 is SEEDED with a value, an explicitly EMPTY/cleared Col-4 = a deliberate "no default" choice. Surface it explicitly so it is a recorded decision, not an accidental blank — e.g. clearing the field shows a hint like "(no default — the run gets no operator nudge for this type)", or offer a selectable "(no default)" option in the autocomplete.
- **Persistence:** In the plain `data_type_defaults_json` map (Q5), represent "no default" as a `null` value for that category, e.g. `{ "date": "dd-MMM-yyyy", "enum": null }`. A non-null string = the operator default; `null` = explicit "no default".
- **LLM wiring:** Categories whose value is `null` are OMITTED from the `dataTypeDefaults` prompt block — the LLM gets NO operator nudge for that data type.
- **Scan-time precedence for a "no default" type** collapses to `code-evidence(field) > contract(field) > LLM free attempt` (the operator-default position from chain (b) is simply skipped). For types WITH a chosen default it stays `code-evidence(field) > [operator default] > contract(field) > LLM`.
- **Example:** `enum` -> operator sets "no default" -> the baseline run receives no enum-format nudge and falls back to contract / its own judgment.

### Existing Code to Reference

**Similar Features Identified (verified during this research):**

- Frontend wizard — `frontend/src/components/.../StartCaptureSessionWizard.tsx`: `WizardStep` type (~line 92); steps array `[1,2,3,4,5]` (~line 1007); step state (~220); `handleAdvanceToStep4` / `handleAdvanceToStep5` (~575 / ~713); footer Back/Next/Start (~2104-2181); draft session via `draftSessionRef` (~575); `updateCaptureSession` (~916).
- Frontend client — `frontend/src/api/apiBehaviourClient.ts`: `ApiBehaviourCaptureSessionDto` + `Create/UpdateApiBehaviourCaptureSessionRequest`. (Verified: contains NO `request_contract` / `param_formats` references — see C1.)
- AMS — `ApiBehaviourCaptureSessionEntity` (add `data_type_defaults_json` JSONB mirroring `coverage_summary_json`, ~lines 277-279); `ApiBehaviourCaptureSessionDto` record (+ backward-compat delegating ctors); `ApiBehaviourMapper.toDto` (hand-written positional new-DTO); `ApiBehaviourCaptureSessionService` (create/patch null-guard write path). Changeset 195 mirroring `189-capture-coverage-summary.sql` (verified present at `architecture-model-service/src/main/resources/db/changelog/sql/189-capture-coverage-summary.sql`).
- amvs orchestrator — `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`: `buildScenarioPrompt` (verified at line 315; `discoveryContext` block ~366-389, `knownGood` block ~413-426; call site ~1329-1339).
- amvs enrichment — `api-migration-validation-service/src/services/requestContractEnrichment.ts`: `enrichInventoryWithRequestContracts` (verified at line 402); `readRequestContractFacts` (verified at line 104) — reuse its `param_formats` projection for classification; precedence code>contract>runtime. `extractOasParams` / `defaultScenarioSet` for OAS format/pattern.
- amvs type — `api-migration-validation-service/src/types/captureSession.ts`: `CaptureSession` interface (verified lines 48-67).
- discovery — `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts`: `ParamFormatEntry { name, location, format, pattern, source }` (location in body|query|path|header).

### Follow-up Questions

None required. The operator accepted all defaults and supplied the one refinement (explicit "NO DEFAULT"), which is fully captured above.

## Visual Assets

### Files Provided:

No visual assets provided. (Mandatory check run against `planning/visuals/` — folder exists but contains no image/PDF files.)

### Visual Insights:

None.

## Requirements Summary

### Functional Requirements

- New wizard step 5 "Data-type formats" inserted between Endpoints (4) and Start; old Start renumbers to 6 (F1).
- Step renders a 4-column table: `Data Type | Code Format(s) | Contract Format(s) | Default Format`; cols 2/3 read-only, col 4 editable autocomplete with free text (F2, Q6).
- Rows are derived from data types actually discovered in this API; empty categories are not shown (F3).
- A new amvs preview endpoint `POST /capture-sessions/:id/data-type-defaults-preview` returns the classified rows and the seeded Col-4 value per row (Q1).
- Classification taxonomy: `date / datetime / time / numeric_id / string_id / boolean / decimal / enum / uuid` + `string` catch-all (Q2, Q4).
- Classification signal precedence: `code-annotation format > OAS type+format > pattern hints > param-name hints` (Q3).
- Col-4 seed (chain a): `code(field) > contract(field) > standard/LLM guess` (F4a).
- Col-4 autocomplete options = union of cols 2/3 distinct values + per-category common standards; free text accepted; no validation (Q6).
- The operator can choose an explicit "NO DEFAULT" per row (cleared/empty Col-4, surfaced as a deliberate recorded choice) — see "Explicit NO DEFAULT" (operator refinement).
- Confirmed Col-4 defaults persist to a new session JSONB field `data_type_defaults_json` as a plain `category -> format` map, where a non-null string = operator default, `null` = explicit "no default", absent key = untouched (F7, Q5 + refinement).
- The capture LLM receives a SEPARATE `dataTypeDefaults` prompt block in `buildScenarioPrompt`, alongside `discoveryContext`/`knownGood`, threaded from `session.dataTypeDefaultsJson`; it refines (does not contradict) the contract-first instruction (F8, Q7).
- Categories whose persisted value is `null` are OMITTED from the prompt block (no operator nudge) (operator refinement).
- Per-row expandable/tooltip lists the contributing fields (name + location + raw formats) (Q9).
- The step auto-skips when no classifiable data types are discovered (Q8).
- The amvs `CaptureSession` type is extended to carry `dataTypeDefaultsJson` and is hydrated with it (Q10c, C2).

### Scan-time Precedence (the operative behaviour)

- Type WITH a chosen default: `code-evidence(field) > [operator default] > contract(field) > LLM free attempt` (F4b).
- Type with explicit "no default" (`null`): `code-evidence(field) > contract(field) > LLM free attempt` (operator-default slot skipped) (operator refinement).
- "Defaults not absolutes": the LLM may still adapt per-field from live evidence; a failed learned fact overrides for that field (F5).

### Reusability Opportunities

- Reuse `readRequestContractFacts`' `param_formats` projection for classification (currently module-private — must be exported/refactored; see C3).
- Mirror the `coverage_summary_json` AMS precedent end-to-end (entity field, DTO ctor, mapper, service write path, changelog) — changeset 189 -> new 195.
- Mirror the existing `discoveryContext` / `knownGood` prompt-block pattern in `buildScenarioPrompt` for the new `dataTypeDefaults` block.
- Reuse the existing `updateCaptureSession` PATCH path for persistence from the wizard (draft session already exists by step 4).
- Reuse `extractOasParams` / `defaultScenarioSet` for OAS format/pattern extraction.

### Grounding Corrections (found during this research — must inform the spec)

- **C1 — Code-format inputs are amvs-side only.** The frontend has NO `request_contract` access (verified: `apiBehaviourClient.ts` contains no `request_contract` / `param_formats` references, and no frontend file references `request_contract`). Therefore client-side computation of the table is not viable and the amvs preview endpoint (Q1) is REQUIRED, not merely preferred.
- **C2 — The amvs `CaptureSession` projection omits late AMS fields.** The `CaptureSession` interface (`api-migration-validation-service/src/types/captureSession.ts`, lines 48-67) does not even carry the existing `coverageSummaryJson`; it ends at `updatedAt`. The new `dataTypeDefaultsJson` field must be ADDED to this interface and to its hydration/mapping path (Q10c) — it will not arrive for free.
- **C3 — `readRequestContractFacts` is module-private.** It is declared `function readRequestContractFacts(...)` at line 104 of `requestContractEnrichment.ts` and is NOT in the module's export list (only `enrichInventoryWithRequestContracts`, `CODE_SCAN_SOURCE`, and `OpenAPIV3` are exported). To reuse its `param_formats` projection for classification it must be exported or refactored into a shared helper.

### Scope Boundaries

**In Scope:**

- The new wizard step 5 and renumber of Start to step 6.
- The amvs preview endpoint `POST /capture-sessions/:id/data-type-defaults-preview` (classification + Col-4 seeding).
- The data-type taxonomy + classification logic and per-category distinct-variation collection.
- Explicit "NO DEFAULT" semantics across UI, persistence (`null`), prompt-block omission, and scan-time precedence.
- The new AMS `data_type_defaults_json` JSONB field (entity, DTO, mapper, service, changeset 195) and the amvs `CaptureSession` type extension + hydration.
- The new `dataTypeDefaults` prompt block in `buildScenarioPrompt`.
- Per-row contributing-fields tooltip/expandable and the auto-skip empty state.

**Out of Scope (Non-Goals):**

- Runtime/log formats + value profiling (dropped per F6).
- Response-format conventions / format-aware reconciliation (a separate, larger spec touching `jsonShapeComparator` + `volatile_paths_json`).
- Per-endpoint / per-field override (v1 = per-session, per-data-type only).
- Changing the existing `code>contract>runtime` OAS enrichment in `enrichInventoryWithRequestContracts` (the operator default is a separate prompt block, NOT an OAS override).
- Storing the seed value or its source for audit in `data_type_defaults_json` (plain map only in v1).
- Any validation of the free-text format string in Col-4.

### Technical Considerations

- Persistence shape (with refinement): `Record<string, string | null>`, e.g. `{ "date": "dd-MMM-yyyy", "enum": null }`. Non-null = operator default; `null` = explicit "no default"; absent key = untouched.
- The two precedence chains (seed vs scan-time) are deliberately different and must be kept distinct in implementation.
- The prompt block must omit `null`-valued categories and must not contradict the existing contract-first instruction.
- AMS wire format note (repo convention): AMS speaks `snake_case` by default; the new `data_type_defaults_json` follows the `coverage_summary_json` precedent and needs no `@CamelCaseWire` annotation (its consumers — gateway proxy, amvs client — expect snake_case).
- Changeset 195 mirrors `189-capture-coverage-summary.sql`; highest existing changeset verified as 194.

### Load-bearing Test Surfaces

- The preview endpoint classifies code + contract evidence into the taxonomy rows and seeds Col-4 by `code > contract > guess`.
- Persisting a chosen default AND a `null` (no-default) value round-trips correctly.
- The orchestrator's `dataTypeDefaults` prompt block INCLUDES non-null categories and OMITS `null` ones.
- The scan-time precedence is reflected in the prompt both WITH a default (`code > operator default > contract > LLM`) and WITHOUT (`code > contract > LLM`, operator slot skipped).
- The wizard step inserts and renumbers correctly, and auto-skips when no classifiable data types are discovered.
- AMS round-trips the new JSONB field, including `null` values within the map.
