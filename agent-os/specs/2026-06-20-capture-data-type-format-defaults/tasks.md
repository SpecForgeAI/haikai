# Task Breakdown: Capture data-type format defaults

## Overview
Total Tasks: 7 task groups

A new wizard Step 5 "Data-type formats" for the API Behaviour Baseline capture
flow. The operator reviews/confirms per-data-type format defaults (pre-filled
from real code/contract evidence), persisted on the session and fed to the
capture LLM as a "try-this-first" nudge. Spec is authoritative:
`agent-os/specs/2026-06-20-capture-data-type-format-defaults/spec.md`.

---

## ⚠️ IMPLEMENTER GUARDRAIL — READ BEFORE TOUCHING ANY FILE ⚠️

Implementer subagents have `Write` but **NO `Edit`**. A whole-file `Write`
against a large existing file has **CLOBBERED files in this repo before**.
Follow these rules without exception:

1. **EXISTING files = ANCHORED in-place edits ONLY.** Never re-`Write` a whole
   existing file. Make surgical edits via `Bash`/Node string splices keyed to a
   **unique anchor string** you first locate by reading the file. This applies
   especially to:
   - `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
   - `frontend/src/api/apiBehaviourClient.ts`
   - `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
   - `api-migration-validation-service/src/routes/captureSessionActions.ts`
   - `api-migration-validation-service/src/services/requestContractEnrichment.ts`
   - `api-migration-validation-service/src/types/captureSession.ts`
   - `architecture-model-service/.../ApiBehaviourCaptureSessionEntity.java`
   - `architecture-model-service/.../ApiBehaviourCaptureSessionDto.java`
   - `architecture-model-service/.../ApiBehaviourMapper.java`
   - `architecture-model-service/.../ApiBehaviourCaptureSessionService.java`
   - `gateway/src/routes/apiMigrationValidation.ts`
2. **NEW files MAY use `Write`.** The classifier module, new test files, and
   the changeset 195 SQL are net-new and may be written wholesale.
3. **NEVER use `git checkout` / `git stash` / `git reset`.**
4. **After EVERY edit to an existing file:**
   - Grep the file for the mojibake marker `â€"` — expect **zero** hits.
   - Re-read the spliced region **plus surrounding lines** and confirm
     byte-intactness: balanced braces, intact imports/exports, no truncation.
5. **AMS DTO record special care:** there are **4 backward-compat delegating
   constructors**. Each one must pass the **extra `null`** for the new field in
   the **correct positional slot**. Verify each constructor individually after
   the edit.

---

## Task List

### AMS Persistence Layer

#### Task Group 1: `data_type_defaults_json` session field + changeset 195
**Dependencies:** None

Mirror the `coverage_summary_json` precedent end-to-end (changeset 189).
The map is `category -> format string` where a non-null string = operator
default, `null` = explicit "no default", absent key = untouched. The round-trip
**MUST** preserve `null` values inside the map.

- [x] 1.0 Complete the AMS persistence layer for `data_type_defaults_json`
  - [x] 1.1 Write 2-8 focused tests (NEW test file may use `Write`)
    - Test: persistence round-trip of a map that **includes a `null` value**
      (e.g. `{"date":"dd-MMM-yyyy","enum":null}`) survives save + reload with
      the `null` key intact (not dropped, not coerced to a string).
    - Test: PATCH preserves an existing `data_type_defaults_json` when the
      patch does not include it (null-guarded write path does not wipe it).
    - Mirror the existing `coverage_summary_json` round-trip test as the
      template if one exists; keep to 2-8 tests, critical behaviours only.
  - [x] 1.2 Add the entity field (ANCHORED edit)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/apibehaviour/ApiBehaviourCaptureSessionEntity.java`
    - Anchor on the existing `coverageSummaryJson` field (~lines 277-279); add
      the new field directly beside it: `@Type(JsonType.class)`
      `@Column(name = "data_type_defaults_json")`, plus getter/setter mirroring
      `coverageSummaryJson`. Reference/Map type matching the precedent.
  - [x] 1.3 Extend the DTO record + ALL 4 delegating constructors (ANCHORED edit)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/apibehaviour/ApiBehaviourCaptureSessionDto.java`
    - Add the new canonical field to the record header beside
      `coverageSummaryJson`.
    - **Each of the 4 backward-compat delegating constructors must pass an
      extra `null`** in the correct positional slot. Verify each one after the
      splice (see guardrail #5).
    - Snake_case wire (AMS default) — **NO `@CamelCaseWire`**. Explicit
      `@JsonProperty("data_type_defaults_json")` is acceptable belt-and-braces
      per repo convention.
  - [x] 1.4 Add the mapper mapping (ANCHORED edit)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/apibehaviour/ApiBehaviourMapper.java`
    - `toDto` is hand-written positional — anchor on the `coverageSummaryJson`
      getter (~line 81) and add the `getDataTypeDefaultsJson()` argument in the
      matching positional slot.
  - [x] 1.5 Add the null-guarded create/patch write path (ANCHORED edit)
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/apibehaviour/ApiBehaviourCaptureSessionService.java`
    - Mirror the `coverageSummaryJson` null-guard idiom in BOTH create and
      patch so a PATCH that omits the field leaves it unchanged.
  - [x] 1.6 Add changeset 195 SQL (NEW file may use `Write`)
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/195-capture-data-type-defaults.sql`
    - Mirror `189-capture-coverage-summary.sql`: new **nullable JSONB** column
      `data_type_defaults_json`, reference type, **no backfill**, and the
      `not-columnExists` precondition idiom.
    - Register it in the master changelog exactly the way 189/194 are
      registered (verify the include mechanism the repo uses).
    - Highest existing changeset verified = 194; 195 is correct.
  - [x] 1.7 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 1.1 and verify the changeset applies cleanly
      (migration runs). Do NOT run the whole AMS suite.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass.
- A map containing a `null` value round-trips through AMS with the `null` key
  preserved.
- PATCH without the field leaves an existing value unchanged.
- Changeset 195 mirrors 189 (nullable JSONB, no backfill, not-columnExists) and
  applies cleanly.
- DTO carries the field with **no** `@CamelCaseWire`; all 4 delegating
  constructors pass the extra `null` correctly; zero `â€"` mojibake hits.

---

### amvs Classification + Preview Endpoint

#### Task Group 2: Data-type classifier + `data-type-defaults-preview` endpoint
**Dependencies:** Task Group 1 (shares no code, but the round-trip target exists)

Colocate classification with the LLM wiring that consumes it (spec C1/Q1) so
generation and preview cannot drift. Reuses
`archModelClient.listEndpointsForArchitecture` (code via `request_contract`)
+ the session's OAS operations (contract).

- [x] 2.0 Build the classifier and the preview endpoint
  - [x] 2.1 Write 2-8 focused tests
    - Test: classification picks the right category by **each signal in
      precedence order** — code-annotation format > OAS `type`+`format` >
      pattern hint > param-name hint (param-name LAST so it never overrides
      real format evidence).
    - Test: Col-4 **seed precedence** `code(field) > contract(field) > standard
      guess` (chain (a)) — e.g. code present wins; only-contract uses contract;
      neither falls to the standard (ISO 8601 for dates).
    - Test: empty — no classifiable data types discovered → **empty rows**.
    - (Optional within budget) date-vs-datetime split decided by presence of a
      time component; numeric_id vs string_id split kept.
  - [x] 2.2 Export/refactor the `param_formats` projection (ANCHORED edit, C3)
    - File: `api-migration-validation-service/src/services/requestContractEnrichment.ts`
    - `readRequestContractFacts` (~line 104) is module-private; export it (or
      lift the `param_formats` -> `{ name, location, format, pattern }`
      projection ~143-156 into a shared exported helper) so the classifier can
      reuse it.
    - **Do NOT modify `enrichInventoryWithRequestContracts`** or its
      code>contract>runtime OAS enrichment (NON-GOAL).
  - [x] 2.3 Build the data-type CLASSIFIER (NEW module may use `Write`)
    - Taxonomy: `date`, `datetime`, `time`, `numeric_id`, `string_id`,
      `boolean`, `decimal` (covers currency), `enum`, `uuid` + `string`
      catch-all.
    - Signal precedence: code-annotation format > OAS `type`+`format` > pattern
      hints > param-name hints.
    - date vs datetime by time-component presence; keep numeric_id/string_id
      split.
    - Reuse `extractOasParams` / `defaultScenarioSet` for OAS `type`/`format`/
      `pattern` (contract source).
  - [x] 2.4 Build the Col-4 SEED logic (in the classifier module)
    - Seed precedence (chain (a)): `code(field) > contract(field) > standard/LLM
      guess`. Contract sits at position 2 when SEEDING (deliberately distinct
      from the scan-time chain).
  - [x] 2.5 Add the preview endpoint (ANCHORED edit)
    - File: `api-migration-validation-service/src/routes/captureSessionActions.ts`
    - Add `POST /api/capture-sessions/:id/data-type-defaults-preview` mirroring
      the existing action handlers in this file.
    - Response per row: `category`, distinct **Col-2 (code)** format variations,
      distinct **Col-3 (contract)** format variations, **seeded Col-4** value,
      and the **contributing-fields** list (name + location + raw code/contract
      format) for per-row transparency.
    - Rows returned = ONLY categories actually discovered (never an empty
      category).
  - [x] 2.6 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 2.1. Do NOT run the whole amvs suite.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass.
- Classification honours the full signal precedence with param-name last.
- Col-4 seed follows `code > contract > guess`.
- No-data-types case yields empty rows.
- `enrichInventoryWithRequestContracts` and its OAS enrichment are untouched;
  the `param_formats` projection is reused, not re-derived; zero `â€"` hits.

---

### Gateway Proxy

#### Task Group 3: Proxy the `data-type-defaults-preview` action
**Dependencies:** Task Group 2

- [x] 3.0 Register + proxy the new action through the gateway
  - [x] 3.1 Write 2-8 focused tests
    - Test: the `data-type-defaults-preview` action is in the allow-list and is
      proxied to the downstream amvs URL shape
      `/api-migration-validation/api/capture-sessions/:sessionId/data-type-defaults-preview`.
    - Mirror an existing action-proxy test (e.g.
      `gateway/src/__tests__/apiMigrationValidation-action-proxy.test.ts`).
  - [x] 3.2 Add the action to the allow-list (ANCHORED edit)
    - File: `gateway/src/routes/apiMigrationValidation.ts`
    - Add `'data-type-defaults-preview'` to the `API_BEHAVIOUR_ACTION_PATHS`
      array (~line 486). This is a one-line list entry; the existing
      registration loop (~line 645) wires the proxy automatically (it is a JSON
      action, NOT multipart — no `parse-oas`-style special-casing).
  - [x] 3.3 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 3.1. Do NOT run the whole gateway suite.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass.
- The action is registered and proxied with the correct downstream URL shape;
  zero `â€"` hits.

---

### amvs LLM Wiring

#### Task Group 4: `dataTypeDefaults` prompt block + session threading
**Dependencies:** Task Group 1 (field), Task Group 2 (colocated taxonomy)

A SEPARATE prompt block, NOT an OAS override. Categories whose value is `null`
are OMITTED. Phrasing refines (does not contradict) the contract-first
instruction and expresses scan-time precedence `code > operator-default >
contract > LLM`.

- [x] 4.0 Wire the operator defaults into the capture prompt
  - [x] 4.1 Write 2-8 focused tests
    - Test: the `dataTypeDefaults` block **INCLUDES** non-null categories and
      **OMITS** `null` categories.
    - Test: scan-time precedence is expressed both WITH a default
      (`code > operator default > contract > LLM`) and WITHOUT (`code > contract
      > LLM`, operator slot skipped).
    - Test: the block is threaded from `session.dataTypeDefaultsJson` (reaches
      the builder from the call site).
  - [x] 4.2 Extend the `CaptureSession` projection type + hydration (ANCHORED edit, C2)
    - File: `api-migration-validation-service/src/types/captureSession.ts`
    - Add `dataTypeDefaultsJson` (shape `Record<string, string | null>`) to the
      `CaptureSession` interface (~lines 48-67) AND to its hydration/mapping
      path — it does NOT arrive for free (the interface omits even
      `coverageSummaryJson`). Trace and patch wherever the interface is
      populated from the AMS DTO.
  - [x] 4.3 Inject the `dataTypeDefaults` block (ANCHORED edit)
    - File: `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`
    - In `buildScenarioPrompt` (~315-443), add a NEW `dataTypeDefaults` block
      ALONGSIDE `discoveryContext` (~366-389) and `knownGood` (~413-426),
      following the same `userPayload.<block> = { guidance, ... }` pattern.
    - **OMIT `null`-valued categories.**
    - Phrasing must refine, not contradict, the existing "build the request
      using the contract formats" instruction (~line 339): per-data-type
      operator-confirmed defaults; when a field has NO code-evidence format,
      use the default and PREFER it over the contract's declared format; a
      field's own code-evidence still wins; may still adapt from live response
      evidence; never retry a rejected format.
    - Thread the session-derived arg in at the call site (~1329-1339), mirroring
      how `discoveryContext`/`knownGood` args reach the builder.
    - **Do NOT modify `enrichInventoryWithRequestContracts`** (NON-GOAL).
  - [x] 4.4 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 4.1. Do NOT run the whole amvs suite.

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass.
- The block includes non-null categories, omits `null` ones, and expresses both
  precedence forms.
- `CaptureSession` carries and hydrates `dataTypeDefaultsJson`.
- The existing OAS enrichment is untouched; zero `â€"` hits.

---

### Frontend API Client

#### Task Group 5: `dataTypeDefaultsPreview` action client + DTO field
**Dependencies:** Task Group 1 (DTO field), Task Group 3 (gateway action)

- [x] 5.0 Extend the frontend API client
  - [x] 5.1 Write 2-8 focused tests
    - Test: the `dataTypeDefaultsPreview` client posts to the correct action URL
      (`.../capture-sessions/:id/data-type-defaults-preview`).
    - Test: the session DTO + Create/Update request types round-trip
      `data_type_defaults_json` including a `null` value within the map.
  - [x] 5.2 Add the preview action client + DTO field (ANCHORED edit)
    - File: `frontend/src/api/apiBehaviourClient.ts`
    - Add the `dataTypeDefaultsPreview` action client mirroring an existing
      action client in this file.
    - Add `data_type_defaults_json` (`Record<string, string | null>`) to the
      `ApiBehaviourCaptureSessionDto` and to
      `Create`/`UpdateApiBehaviourCaptureSessionRequest`.
    - Snake_case field name on the wire (AMS default). Add the return type for
      the preview rows (category, code formats, contract formats, seeded Col-4,
      contributing fields).
  - [x] 5.3 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 5.1. Do NOT run the whole frontend suite.

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass.
- The client posts to the right action URL; the DTO + request types carry the
  field and round-trip a `null` map value; zero `â€"` hits.

---

### Frontend Wizard Step

#### Task Group 6: Insert Step 5 "Data-type formats" + renumber
**Dependencies:** Task Group 5 (client)

Insert a NEW step 5 BETWEEN Endpoints (current step 4) and Start; the old Start
becomes step 6. The draft session already exists by step 4 (`draftSessionRef`),
so persistence reuses the existing `updateCaptureSession` PATCH path.

⚠️ This is the highest-clobber-risk file. **ANCHORED edits ONLY.**

- [x] 6.0 Build the wizard step + renumber the flow
  - [x] 6.1 Write 2-8 focused tests
    - Test: the step renders the 4-column table and **auto-skips** when no data
      types are discovered (Endpoints advances straight to Start).
    - Test: Col-4 edit works AND the explicit **"(no default)"** choice yields a
      `null` for that category.
    - Test: advancing the step PATCHes via `updateCaptureSession`.
    - Test: the renumber is intact (stepper array/labels, advance handlers,
      footer Back/Next/Start positions).
  - [x] 6.2 Renumber the wizard scaffolding (ANCHORED edits)
    - File: `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
    - Widen `WizardStep` (~line 92) from `1|2|3|4|5` to include `6`.
    - Extend the stepper array `[1,2,3,4,5]` (~line 1007) to `[1,2,3,4,5,6]` and
      extend the label switch so `5 = "Data-type formats"`, `6 = "Start"`.
    - Renumber advance handlers: keep step `4 -> 5` (existing
      `handleAdvanceToStep5` operation-include-flags persistence ~line 713),
      add a NEW step `5 -> 6` handler; move the existing `handleStart`
      (~line 910) logic to the step-6 footer button.
    - Renumber footer buttons (~lines 2104-2181): current `step === 5` Start
      block becomes `step === 6`; add a `step === 5` Next block.
  - [x] 6.3 Build the Step 5 content (ANCHORED edits; extract NEW subcomponent if helpful)
    - On entry, fetch the preview via the `dataTypeDefaultsPreview` client.
    - **AUTO-SKIP** when the preview returns no rows (no "nothing to configure"
      screen).
    - Render the 4-column table `Data Type | Code Format(s) | Contract
      Format(s) | Default Format`; rows derived from the preview; cols 2/3
      read-only.
    - Col-4 = editable **autocomplete**: options = union of cols 2/3 distinct
      values + per-category standards; free text accepted (NO validation); plus
      an explicit **"(no default)"** option that records `null` (surface a hint
      like "(no default — the run gets no operator nudge for this type)").
    - Per-row **expandable transparency** listing contributing fields (name +
      location + raw code/contract formats).
    - A complex new table/autocomplete subcomponent MAY be a NEW file (`Write`
      allowed) and imported into the wizard via an anchored import edit.
  - [x] 6.4 Persist Col-4 defaults on advance (ANCHORED edit)
    - In the step `5 -> 6` handler, persist the `data_type_defaults_json` map
      via the existing `updateCaptureSession` PATCH path (~line 916). Non-null
      string = default; `null` = explicit "no default"; untouched rows behave
      per spec (the seed is what advances unless cleared).
  - [x] 6.5 Run ONLY this group's tests
    - Run ONLY the 2-8 tests from 6.1. Do NOT run the whole frontend suite.

**Acceptance Criteria:**
- The 2-8 tests from 6.1 pass.
- Step inserts and renumbers correctly (stepper, labels, advance handlers,
  footer all intact and consistent).
- The step auto-skips when no data types are discovered.
- Col-4 edits, free text, and the explicit "(no default)" → `null` all work;
  per-row transparency renders.
- Advancing PATCHes via `updateCaptureSession`; zero `â€"` hits; the file is
  byte-intact (balanced JSX/braces, intact imports/exports).

---

### Testing

#### Task Group 7: Test Review & Gap Analysis (feature-only)
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical end-to-end gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the focused tests written in 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
      (approximately 12-48 tests total).
  - [x] 7.2 Analyze gaps for THIS feature only
    - Focus ONLY on this spec's requirements. Prioritize the
      **preview → seed → persist(null) → prompt-omits-null** end-to-end path.
    - Other high-value seams: classification signal precedence end-to-end; the
      explicit "no default" round-trip from wizard to prompt omission; auto-skip
      with empty preview.
    - Do NOT assess whole-application coverage.
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Add a MAXIMUM of 10 new tests to fill identified critical gaps, favouring
      integration / end-to-end over unit gaps.
    - Skip edge cases, performance, and accessibility unless business-critical.
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY the tests related to this spec (from 1.1, 2.1, 3.1, 4.1, 5.1,
      6.1, and 7.3). Do NOT run the entire application test suite.

**Acceptance Criteria:**
- All feature-specific tests pass.
- The `preview → seed → persist(null) → prompt-omits-null` path is covered
  end-to-end.
- No more than 10 additional tests added.
- Testing focused exclusively on this spec's requirements.

---

## NON-GOALS (do not implement)

- Runtime/log formats and value profiling (no Runtime column) — dropped per F6.
- Response-format conventions / format-aware reconciliation (separate larger
  spec touching `jsonShapeComparator` + `volatile_paths_json`).
- Per-endpoint / per-field override (v1 = per-session, per-data-type only).
- Changing the existing `code>contract>runtime` OAS enrichment in
  `enrichInventoryWithRequestContracts` (the operator default is a SEPARATE
  prompt block, NOT an OAS override).
- Storing the seed value or its source for audit in `data_type_defaults_json`
  (plain map only in v1).
- Any validation of the free-text Col-4 format string.
- Backfilling existing sessions (`null`/absent `data_type_defaults_json` is the
  valid empty state).

---

## Execution Order

Recommended implementation sequence:
1. AMS Persistence Layer (Task Group 1)
2. amvs Classification + Preview Endpoint (Task Group 2)
3. Gateway Proxy (Task Group 3)
4. amvs LLM Wiring (Task Group 4)
5. Frontend API Client (Task Group 5)
6. Frontend Wizard Step (Task Group 6)
7. Test Review & Gap Analysis (Task Group 7)
