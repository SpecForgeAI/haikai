# Specification: Capture data-type format defaults

## Goal
Add a new wizard Step 5 "Data-type formats" to the API Behaviour Baseline capture flow where the operator reviews and confirms per-data-type format defaults (pre-filled from real code/contract evidence), persisted on the session and fed to the capture LLM as a "try-this-first" nudge so it stops mis-formatting values (especially dates) and burning attempts.

## User Stories
- As a capture operator, I want to confirm or override a default format per data type (date, datetime, decimal, etc.) discovered in this API, so the capture LLM tries the right format first instead of guessing ISO when a legacy API uses `dd-MMM-yyyy`.
- As a capture operator, I want to deliberately say "no default" for a data type I am unsure about (e.g. enum), so the run gets no operator nudge for that type and falls back to the contract / its own judgment.

## Specific Requirements

**New wizard Step 5 "Data-type formats" + renumber (F1)**
- Insert a NEW step 5 BETWEEN Endpoints (current step 4) and Start; the old Start becomes step 6.
- Widen `WizardStep` (`StartCaptureSessionWizard.tsx` ~line 92) from `1|2|3|4|5` to include `6`.
- Extend the hardcoded stepper array `[1,2,3,4,5]` (~line 1007) to `[1,2,3,4,5,6]` and extend the label switch so 5 = "Data-type formats" and 6 = "Start".
- Renumber the advance handlers: step 4 -> 5 keeps the existing `handleAdvanceToStep5` persistence of operation include flags (~line 713), then a NEW step 5 -> 6 handler; the existing `handleStart` (~line 910) logic moves to the step-6 footer button.
- Renumber the footer buttons (~lines 2104-2181): the current `step === 5` Start block becomes `step === 6`; add a `step === 5` Next block.
- The draft session already exists by step 4 (via `draftSessionRef`), so the step persists through the existing `updateCaptureSession` PATCH path (~line 916) — no new draft-creation logic.

**amvs preview endpoint `POST /api/capture-sessions/:id/data-type-defaults-preview` (Q1, C1)**
- REQUIRED (not merely preferred): the code-format inputs live in `request_contract.param_formats`, reachable only amvs-side via `archModelClient.listEndpointsForArchitecture`; the frontend has NO `request_contract`/`param_formats` access (verified in `apiBehaviourClient.ts`).
- Returns the classified rows (one per discovered category) and the seeded Col-4 value per row.
- Colocate classification with the LLM wiring that consumes it so generation and the preview cannot drift.
- Each returned row carries: category, distinct Col-2 (code) format variations, distinct Col-3 (contract) format variations, seeded Col-4 value, and the contributing-fields list (name + location + raw code/contract format) for the per-row transparency UI.

**Data-type taxonomy + classification (F3, Q2, Q3, Q4)**
- Taxonomy: `date`, `datetime`, `time`, `numeric_id`, `string_id`, `boolean`, `decimal` (covers currency), `enum`, `uuid`; anything else falls to a `string` catch-all.
- Rows shown = ONLY categories actually discovered in this API (never an empty category).
- Classification signal precedence: code-annotation format (`@JsonFormat`/`@DateTimeFormat` via `param_formats`) > OAS `type`+`format` > pattern hints > param-name hints. Param-name hints (id/date/amount) are the LAST resort so they never override real format evidence.
- date vs datetime decided by presence of a time component; keep the numeric_id vs string_id split.

**Col-4 seed precedence — chain (a) (F4a)**
- The pre-filled Col-4 value follows: `code(field) > contract(field) > standard/LLM guess` (e.g. ISO 8601 for dates).
- Distinct from the scan-time chain: contract sits at position 2 when SEEDING because no operator default exists yet to seed from.
- The user always has final say over the seeded value.

**Col-4 editing, autocomplete + explicit "no default" (F2, Q6, operator refinement)**
- Col-4 is an editable autocomplete; options = union of distinct Col-2/Col-3 values + a small per-category standards list; free text accepted; NO validation of the format string.
- The operator can deliberately clear Col-4 to "no default" — a recorded decision distinct from the seed and from an untouched row.
- Surface "no default" explicitly so it is not an accidental blank: e.g. clearing shows a hint like "(no default — the run gets no operator nudge for this type)", or offer a selectable "(no default)" option in the autocomplete.

**Persist new session JSONB field `data_type_defaults_json` (F7, Q5 + refinement)**
- A plain map `category -> format string`: non-null string = operator default; `null` = explicit "no default"; absent key = untouched/never-decided. Example: `{ "date": "dd-MMM-yyyy", "enum": null }`.
- AMS changeset 195 mirroring the `coverage_summary_json` precedent (changeset 189; highest existing verified = 194). New nullable JSONB column, reference type, no backfill, not-columnExists precondition idiom.
- Touch points mirroring coverage_summary_json: `ApiBehaviourCaptureSessionEntity` (new `@Type(JsonType.class)` `@Column(name="data_type_defaults_json")` field beside `coverageSummaryJson` ~lines 277-279); `ApiBehaviourCaptureSessionDto` record (new canonical field — each of the 4 backward-compat delegating constructors must pass an extra `null`); `ApiBehaviourMapper.toDto` (hand-written positional — add the new getter ~line 81); `ApiBehaviourCaptureSessionService` null-guarded create/patch write path.
- Snake_case wire (AMS default) — NO `@CamelCaseWire`; consumers (gateway proxy, amvs client) expect snake_case. NO per-endpoint/per-field override in v1.

**LLM wiring — new `dataTypeDefaults` prompt block (F8, Q7, operator refinement)**
- Inject a NEW `dataTypeDefaults` block into `buildScenarioPrompt` (`captureSessionOrchestrator.ts` ~lines 315-443) ALONGSIDE the existing `discoveryContext` (~366-389) and `knownGood` (~413-426) blocks, threaded from the session at the call site (~1329-1339).
- Categories whose persisted value is `null` are OMITTED from the block (no nudge).
- It is a SEPARATE prompt block, NOT an OAS override — do NOT touch `enrichInventoryWithRequestContracts`'s code>contract>runtime OAS enrichment (stamped `x-amvs-source: code-scan`).
- Block phrasing must refine, not contradict, the existing "build the request using the contract formats" instruction (~line 339): "Per-data-type default formats confirmed by the operator. When a field has NO code-evidence format, use the default for its data type and PREFER it over the contract's declared format. A field's own code-evidence still wins; you may still adapt from live response evidence; never retry a rejected format."

**Scan-time per-field precedence the prompt expresses — chain (b) (F4b, F5, operator refinement)**
- Type WITH a chosen default: `code-evidence(field) > [Col-4 operator default for that data type] > contract(field) > LLM free attempt`. The operator default wedges ABOVE the contract but BELOW a field's own code-evidence.
- Type with explicit "no default" (`null`): the operator slot is simply absent -> `code-evidence(field) > contract(field) > LLM free attempt`.
- "Defaults not absolutes": the LLM may still adapt per-field from live response evidence; a FAILED learned fact overrides for that field.

**Extend the amvs `CaptureSession` projection (Q10c, C2)**
- The `CaptureSession` interface (`types/captureSession.ts` ~lines 48-67) ends at `updatedAt` and omits late AMS fields (it does not even carry `coverageSummaryJson`).
- ADD `dataTypeDefaultsJson` (shape `Record<string, string | null>`) to the interface AND to its hydration/mapping path — it will not arrive for free.

**Reuse `param_formats` projection for classification (C3)**
- `readRequestContractFacts` (`requestContractEnrichment.ts` ~lines 104-163) already projects `param_formats` into `{ name, location, format, pattern }` but is module-private (not exported).
- Export it (or refactor the `param_formats` projection into a shared helper) so the preview-endpoint classifier can reuse it rather than re-deriving the projection.

**Auto-skip + per-row transparency (Q8, Q9)**
- AUTO-SKIP the step when no classifiable data types are discovered (Endpoints advances straight to Start) — no "nothing to configure" screen.
- Per-row expandable/tooltip lists the contributing fields (name + location + raw code/contract formats) that fed the row.

## Existing Code to Leverage

**`StartCaptureSessionWizard.tsx` (frontend wizard)**
- `WizardStep` type (~92), stepper array + label switch (~1007), step state (~220), advance handlers (~575/713), footer Back/Next/Start (~2104-2181), `draftSessionRef` (~575/587), `updateCaptureSession` (~916), `handleStart` (~910) are the exact insertion/renumber points.
- Reuse the existing `updateCaptureSession` PATCH path to persist Col-4 defaults; the draft session already exists by step 4.

**`coverage_summary_json` AMS precedent (changeset 189)**
- `ApiBehaviourCaptureSessionEntity` JSONB column (~277-279), `ApiBehaviourCaptureSessionDto` record + its 4 delegating constructors, `ApiBehaviourMapper.toDto` positional mapping (~81), and `ApiBehaviourCaptureSessionService` write path are the end-to-end template to mirror for `data_type_defaults_json`.
- `189-capture-coverage-summary.sql` is the changelog template (nullable JSONB, no backfill, not-columnExists precondition).

**`buildScenarioPrompt` blocks (`captureSessionOrchestrator.ts`)**
- The `discoveryContext` (~366-389) and `knownGood` (~413-426) blocks show the established `userPayload.<block> = { guidance, ... }` pattern to replicate for `dataTypeDefaults`; the call site (~1329-1339) shows how session-threaded args reach the builder.

**`readRequestContractFacts` / OAS extractors (`requestContractEnrichment.ts`)**
- Its `param_formats` -> `{ name, location, format, pattern }` projection (~143-156) is the code-format source for classification (export/refactor per C3).
- `extractOasParams` / `defaultScenarioSet` provide OAS `type`/`format`/`pattern` for the contract-format source and classification signals.

**`archModelClient.listEndpointsForArchitecture`**
- The same call the capture flow already uses to read endpoints (carrying `request_contract`) — the preview endpoint reuses it to gather code-format evidence.

## Out of Scope
- Runtime/log formats and value profiling (no Runtime column) — dropped per F6.
- Response-format conventions / format-aware reconciliation (separate larger spec touching `jsonShapeComparator` + `volatile_paths_json`).
- Per-endpoint / per-field override (v1 = per-session, per-data-type only).
- Changing the existing `code>contract>runtime` OAS enrichment in `enrichInventoryWithRequestContracts` (the operator default is a separate prompt block, not an OAS override).
- Storing the seed value or its source for audit in `data_type_defaults_json` (plain map only in v1).
- Any validation of the free-text Col-4 format string.
- Backfilling existing sessions (`null`/absent `data_type_defaults_json` is the valid empty state).

## Load-bearing Test Surfaces
- Preview endpoint classifies code + contract evidence into the taxonomy rows and seeds Col-4 by `code > contract > guess`; rows appear only for discovered categories.
- Persisting a chosen default AND a `null` (no-default) value round-trips through AMS, including `null` values within the map.
- The orchestrator's `dataTypeDefaults` prompt block INCLUDES non-null categories and OMITS `null` ones.
- The scan-time precedence is reflected in the prompt both WITH a default (`code > operator default > contract > LLM`) and WITHOUT (`code > contract > LLM`, operator slot skipped).
- The wizard step inserts and renumbers correctly (stepper, labels, advance handlers, footer), and auto-skips when no classifiable data types are discovered.
