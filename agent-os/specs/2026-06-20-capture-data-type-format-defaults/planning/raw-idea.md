TITLE: Capture data-type format defaults — a new "Data-type formats" step in the API Behaviour Baseline capture wizard.

PROBLEM: The capture LLM keeps mis-formatting values (esp. dates: it guesses ISO when a legacy API really uses e.g. `dd-MMM-yyyy`), burning attempts. Legacy contracts (WADL/XSD/OAS) frequently declare a vague/wrong format (`xsd:date`/ISO) that doesn't match reality. We have code-evidence (`@JsonFormat`/`@DateTimeFormat`-derived formats from the recently-shipped request-contract scan) and contract formats, but no operator-confirmed per-API default to steer the LLM.

SOLUTION: Add a new wizard step where the operator reviews and confirms per-DATA-TYPE format defaults, pre-filled from real evidence, then fed to the capture LLM as a "try-this-first" default (NOT global hardcoding).

DECISIONS ALREADY MADE (FIXED — do NOT relitigate):
1. New wizard step inserted BETWEEN the existing Endpoints step (4) and Start step. Current wizard is 5 steps: 1 OAS source, 2 API config, 3 DB sampling, 4 Endpoints, 5 Start. Add a NEW step 5 "Data-type formats"; the old Start becomes step 6 (renumber). The draft session already exists by step 4, so the new step persists via the existing `updateCaptureSession` PATCH path.
2. The step shows a TABLE with exactly 4 columns: `Data Type | Code Format(s) | Contract Format(s) | Default Format`.
   - Col 2 Code Format(s): READ-ONLY, from the code scan (`request_contract.param_formats` — `@JsonFormat`/`@DateTimeFormat`-derived, e.g. `dd-MMM-yyyy`).
   - Col 3 Contract Format(s): READ-ONLY, from contract parsing (OAS/WADL/XSD `format`/`pattern`). Note these are OFTEN semantic (e.g. `format: date` = ISO 8601, `xsd:date`) and may be blank for legacy WADL — the column shows whatever the contract declares.
   - Col 4 Default Format: EDITABLE; an autocomplete pre-populated with the union of discovered variations (cols 2+3) plus the ability to type a free-text override. THE USER HAS THE FINAL SAY. Whatever sits in Col 4 when the user advances = "the default" passed to the LLM.
3. ROWS are DERIVED from the data types actually discovered in THIS API (do NOT show empty categories — no "Currency" row if there are no currency fields). A data-type taxonomy (Dates, DateTimes/Timestamps, Numeric IDs, String IDs, Booleans, Currency/Decimal, Enums, etc.) is used to classify each discovered field/param format into a category; only categories present are shown.
4. TWO SEPARATE PRECEDENCE CHAINS (this distinction is the crux):
   (a) SEEDING Col 4 (the value the modal pre-fills the editable cell with): `code(field) > contract(field) > standard/LLM guess`. i.e. Col 4 starts as the Col 2 value if present, else Col 3, else a sensible standard default (e.g. ISO 8601 for dates). The user can then override.
   (b) SCAN-TIME per-field attempt order (what the capture LLM is instructed to follow across its up-to-5 attempts): `code-evidence(field) > [Col-4 user default for that field's data type] > contract(field) > LLM free attempt`. The operator's Col-4 default WEDGES ABOVE the contract (so an informed override beats a misleading legacy contract) but BELOW a field's own code-evidence (code annotations are ground truth). The default mainly bites for fields the code scan did NOT pin.
   The difference between (a) and (b) is deliberate: contract is position 2 when SEEDING (no user default exists yet to seed from), but the user's Col-4 default outranks the contract at SCAN time.
5. "Defaults not absolutes" is preserved: the capture LLM may still adapt per-field from live response evidence during its attempts (a FAILED learned fact overrides for that field).
6. NO logs/runtime formats — DROPPED. (Too expensive AND a log's output/response format need not match the request format.) No Runtime column, no value-profiling.
7. Persist the operator's confirmed Col-4 defaults on the capture session as a NEW JSONB field `data_type_defaults_json` (per-session, per-data-type map, e.g. `{ "date": "dd-MMM-yyyy", "datetime": "...", "numeric_id": "...", ... }`). AMS changeset (mirror the `coverage_summary_json` precedent, changeset 189). NO per-endpoint/per-field override in v1.
8. LLM wiring: inject a NEW `dataTypeDefaults` block into `buildScenarioPrompt` (amvs `captureSessionOrchestrator.ts`) ALONGSIDE the existing `discoveryContext`/`knownGood` blocks, threaded from `session.dataTypeDefaultsJson`. CRITICAL: the operator default must NOT join the existing OAS-override chain (`enrichInventoryWithRequestContracts` does code>contract>runtime OAS overrides stamped `x-amvs-source: code-scan`). It is a SEPARATE prompt block phrased as "try this default for this data type when a field has no code-evidence; prefer it over the contract; a field's own code-evidence still wins; you may still adapt from live evidence." The phrasing must not contradict the existing "read contract format first" instruction in buildScenarioPrompt — it refines it.

PRE-FILL DATA AVAILABILITY (verified earlier):
- Code formats: `endpoints[].request_contract.param_formats` (AMS `EndpointEntity.request_contract`, on `EndpointDto`); the discovery `requestContractScanner.ts` `ParamFormatEntry { name, location, format, pattern, source }` (location ∈ body|query|path|header). amvs already reads these via `requestContractEnrichment.readRequestContractFacts`. The wizard can fetch via the same `listEndpointsForArchitecture` the capture flow already uses.
- Contract formats: the parsed OAS inventory (`operations[].oas_operation_json`/`request_schema_json`) via `listOperations(sessionId)`; OAS `schema.format`/`schema.type`/`schema.pattern`.

NEW CORE LOGIC:
- Data-type CLASSIFICATION: map each param's code/contract format into a data-type category and collect distinct variations per category (the table rows + cols 2/3). Heuristics from `@JsonFormat`/`@DateTimeFormat` (clearly date/datetime), Java type hints, OAS type/format (integer/number/string+format), and param-name hints (id/date/amount).
- Col-4 seed computation (chain a) + persistence shape.

GROUNDING / KEY CODE:
- frontend: `StartCaptureSessionWizard.tsx` (`WizardStep` type ~line 92; steps array `[1,2,3,4,5]` ~line 1007; step state ~220; `handleAdvanceToStep4`/`handleAdvanceToStep5` ~575/713; footer Back/Next/Start ~2104-2181; draft session via `draftSessionRef` ~575; `updateCaptureSession` ~916). `apiBehaviourClient.ts` `ApiBehaviourCaptureSessionDto` + `Create/UpdateApiBehaviourCaptureSessionRequest`.
- AMS: `ApiBehaviourCaptureSessionEntity` (add `data_type_defaults_json` JSONB mirroring `coverage_summary_json` ~277-279), `ApiBehaviourCaptureSessionDto` record (+4 backward-compat delegating ctors), `ApiBehaviourMapper.toDto` (hand-written positional new-DTO), `ApiBehaviourCaptureSessionService` (create/patch null-guard write path). Changeset 195 (mirror `189-capture-coverage-summary.sql`; highest current = 194).
- amvs: `captureSessionOrchestrator.ts` `buildScenarioPrompt` (~315-443; `discoveryContext` ~366-389, `knownGood` ~413-426; call site ~1329-1339); `requestContractEnrichment.ts` (`enrichInventoryWithRequestContracts`, `readRequestContractFacts` ~104-163 — reuse its param_formats projection for classification; precedence code>contract>runtime). `extractOasParams`/`defaultScenarioSet` for OAS format/pattern.
- discovery: `requestContractScanner.ts` `ParamFormatEntry`.

OPEN QUESTIONS for shaping (shaper decides what to ask):
- WHERE the table is computed: client-side in the wizard from already-fetched `operations` (OAS) + `endpoints` (request_contract), vs a NEW amvs preview action endpoint (e.g. `POST /capture-sessions/:id/data-type-defaults-preview`) that returns the classified rows (better for reuse/testing + keeps classification one place). Recommend the latter if classification is non-trivial.
- The exact data-type taxonomy + classification heuristics.
- The persisted `data_type_defaults_json` shape (map category→format; whether to also store the seed + its source for audit).
- Autocomplete option set (union of cols 2/3 distinct + common standards) and free-text validation (any validation of a format string?).
- The LLM prompt phrasing for the scan-time order without contradicting the existing contract-first instruction.
- Empty-state: if NO data types are discovered (no request bodies/params), skip the step or show "nothing to configure" and allow Next.
- Whether to surface, per row, the fields/params that fed it (tooltip) for transparency.

NON-GOALS:
- Runtime/log formats + value profiling (dropped).
- Response-format conventions / format-aware reconciliation (a separate, larger spec touching `jsonShapeComparator` + `volatile_paths_json`).
- Per-endpoint/per-field override (v1 = per-session, per-data-type).
- Changing the existing `code>contract>runtime` OAS enrichment (the operator default is a separate prompt block, not an OAS override).
