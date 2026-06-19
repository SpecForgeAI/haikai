# Task Breakdown: Request Contract from Code Evidence

## Overview
Total Tasks: 7 task groups

This work is **explicitly PHASED**. Phase 1 (Task Groups 1-4) fully lands fix #3
(the 415 on body-less PUTs) deterministically from already-extracted code facts:
it builds the storage + save-back + capture-time enrichment pipeline and broadens
the executor Content-Type default. Phase 2 (Task Groups 5-6) extends the scanner
to mine request date-formats + validation (fixing #1, and therefore the #2
no-capture cascade) and pushes those into the OAS param formats. Task Group 7 is
a focused cross-layer test review.

Binding constraints throughout:
- The "Resolved Clarifications" R1-R6 + save-back in
  `planning/requirements.md` are authoritative. R1 = option (iii): OAS enrichment
  reading AMS endpoints directly.
- AMS wire is snake_case (CLAUDE.md): the `request_contract` wire key and all
  JSONB keys are snake_case; NO `@CamelCaseWire` on the DTO.
- Mirror the `responseContract` precedent exactly; embed an internal
  `schema_version`; confidence is a boxed `Double` INSIDE the blob, never a
  separate column.
- **NO REGRESSION** of changesets 189-193 (the A/B/C/D specs) or of existing
  single-shot capture/reconcile. Changeset 194 is NEW with a `not columnExists`
  guard; never edit an applied changeset.
- Precedence is an OVERRIDE, not a blind merge: code-evidence > contract >
  runtime levers; all three layers retained, none removed.

## Task List

---

# PHASE 1 — Fix #3 (415) deterministically from code evidence

### Database / AMS Storage Layer

#### Task Group 1: AMS `request_contract` column, entity, DTO, mapper
**Service:** `architecture-model-service` (Java / Spring / Postgres)
**Dependencies:** None

- [x] 1.0 Add the `request_contract` JSONB storage, mirroring `response_contract`
  - [x] 1.1 Write 2-8 focused tests for the `request_contract` round-trip
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) `EndpointEntity.requestContract` persists + reads back a
      `Map<String,Object>` blob; (b) `EntityMapper.toDto`/`toEntity` round-trip
      `requestContract` without loss; (c) `EndpointDto` serialises the wire key
      as `request_contract` (snake_case, no `@CamelCaseWire`)
    - Skip exhaustive blob-shape / null-permutation coverage
  - [x] 1.2 Add the `request_contract` field to `EndpointEntity`
    - `model/entity/EndpointEntity.java` (mirror `responseContract` at lines
      113-115): `@Type(JsonType.class) @Column(name = "request_contract",
      columnDefinition = "jsonb") private Map<String, Object> requestContract;`
    - Reference type so a PATCH with no value preserves the column
  - [x] 1.3 Add the `request_contract` field to `EndpointDto`
    - `EndpointDto.java` (mirror `response_contract` at lines 82-83):
      `@JsonProperty("request_contract") Map<String,Object> requestContract`
    - snake_case, reference type, **NO `@CamelCaseWire`** (matches the DTO's
      snake_case convention; CLAUDE.md)
  - [x] 1.4 Wire `requestContract` through `EntityMapper`
    - `EntityMapper.java` `toDto` (sibling to line 402) and `toEntity` (sibling
      to line 430): pass `requestContract` through next to `responseContract`
  - [x] 1.5 Create Liquibase changeset 194
    - **Verify 194 is next-free first** (highest on disk = 193; 189-193 are the
      A/B/C/D specs and MUST NOT be disturbed)
    - New SQL file `194-endpoint-request-contract.sql`, cloning
      `168-endpoint-response-contract.sql`:
      `ALTER TABLE endpoints ADD COLUMN request_contract JSONB;` (additive,
      nullable; embed the internal `schema_version` semantics in the header
      comment; no separate confidence column)
    - New master block in `db.changelog-master.yaml` (mirror the block at
      3606-3622): `changeSet id: 194-endpoint-request-contract`, author,
      `onFail: MARK_RAN`, `onError: HALT`, `not columnExists` precondition guard
      on `request_contract`, `sqlFile` with `splitStatements: true` +
      `stripComments: true`
  - [x] 1.6 Verification + no-regression check
    - AMS compiles (full module build)
    - Run ONLY the 2-8 tests written in 1.1
    - Confirm changeset 194 applies on a clean DB and is idempotent (the
      `not columnExists` guard MARK_RANs on re-run); existing rows round-trip
      with a null `request_contract`
    - **No-regression check:** changesets 189-193 are unedited; their checksums
      are unchanged; the master changelog still applies cleanly through 194

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass; AMS compiles
- `request_contract` round-trips through entity -> DTO -> wire as snake_case
- Changeset 194 is additive, nullable, idempotent, and disturbs nothing in
  189-193

---

### Save-Back Layer

#### Task Group 2: mcp-server save-back pass-through of `request_contract`
**Service:** `mcp-server`
**Dependencies:** Task Group 1 (AMS surfaces the `request_contract` field)

- [x] 2.0 Pass `request_contract` through the endpoints save-back arm
  - [x] 2.1 Write 2-8 focused tests for the save-back pass-through
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) an endpoint candidate whose `data.request_contract` is
      present reaches the save-back payload / `EndpointEntity.request_contract`;
      (b) snake/camel tolerance (`request_contract` and `requestContract` both
      accepted); (c) absent-key semantics — an undefined value yields an ABSENT
      key (never null), so an empty/tier-gated scan does NOT wipe an existing
      value
    - Skip exhaustive field-permutation coverage
  - [x] 2.2 Extend `candidateSaveBackService.ts` `case 'endpoints':`
    - File `src/services/candidateSaveBackService.ts` (~1073-1125)
    - Clone the `response_contract` arm (1119-1124) into a `request_contract`
      arm: `const requestContract = data.request_contract ?? data.requestContract;
      if (requestContract !== undefined && requestContract !== null)
      entity.request_contract = requestContract;`
    - Additive / absent-key: undefined -> ABSENT key, never null
    - Note this arm today drops `consumes`/`headers`/`requestParams`/
      `requestHeaders` the scanner already produces — this pass-through is the
      Phase-1 unblock
  - [x] 2.3 Verification + no-regression check
    - `mcp-server` typecheck passes
    - Run ONLY the 2-8 tests written in 2.1
    - **No-regression check:** the existing `response_contract`,
      `protocol_metadata_json`, `operation_verb`, and `path_or_address`
      pass-throughs in the same `case 'endpoints':` arm are unchanged

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass; mcp-server typechecks
- A request-bearing endpoint candidate's request facts reach the save-back
  payload; absent values never wipe an existing column

---

### Capture-Loop Enrichment Layer (Phase 1)

#### Task Group 3: AMS-endpoint OAS enrichment at `/start` (content-type + headers)
**Service:** `api-migration-validation-service`
**Dependencies:** Task Groups 1, 2 (AMS endpoints carry `request_contract`)

- [x] 3.0 Merge `request_contract` content-type + headers into the in-memory OAS
  (R1 = iii; R5 = headers are Phase 1)
  - [x] 3.1 Write 2-8 focused tests for the enrichment merge
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) an AMS endpoint's `request_contract.content_type` overrides
      the matching operation's `requestBody.content` media type, matched by
      method+path; (b) `required_headers[]` become `in: header, required: true`
      params on `oasOperation`; (c) the override is provenance-tagged
      `x-amvs-source: code-scan` (R3) and contract-sourced fields stay unmarked;
      (d) fail-soft — an AMS error or unmatched endpoint leaves the OAS unchanged
      and never blocks `/start`
    - Skip exhaustive content-type / header-shape permutations
  - [x] 3.2 Fetch AMS endpoints at `/start` after inventory + discovery context
    - File `captureSessionActions.ts`
    - After `inventory = oasInventoryStore.get(sessionId)` (~1539) and the
      discovery-context fetch (~1652), fetch AMS endpoints via
      `archModelClient.listEndpointsForArchitecture(projectId,
      session.architecture_id)` (~1239)
    - Mutate the SAME in-memory inventory object passed to `spawnOrchestrator`
      (~1745) so all three consumers see the enriched values
  - [x] 3.3 Merge content-type + required headers as an OVERRIDE
    - Match each endpoint to its `ParsedOasOperation.oasOperation` by method+path
    - `request_contract.content_type` -> the operation's request media type
      (`oasOperation.requestBody.content`); OVERRIDE the contract value where
      present, leave it untouched where the code is silent
    - `required_headers[]` -> header `parameters[]` (`in: header`,
      `required: true`) on `oasOperation`
    - Snake/camel-tolerant read of the blob keys
    - Reuse the `synthesiseOperationFromEndpoint` / `protocol_metadata_json`
      layering precedent (~431-464)
  - [x] 3.4 Provenance-tag every override (R3)
    - Stamp `x-amvs-source: code-scan` at the operation level for content-type/
      headers; only where code-evidence actually overrode/added a value
  - [x] 3.5 Fail-soft like the discovery-context fetch
    - An AMS error or unmatched endpoint leaves the contract-derived OAS
      unchanged; never block `/start`
  - [x] 3.6 Verification + no-regression check
    - `npx tsc --noEmit` passes
    - Run the targeted tests written in 3.1
    - Run the **FULL** `npx jest` suite — it currently sits at 347 pass / 1 skip
      and MUST STAY GREEN
    - **No-regression check:** existing single-shot capture/reconcile and the
      `synthesiseOperationFromEndpoint` SOAP `protocol_metadata_json` layering
      are unaffected; runtime levers (error-driven format correction +
      accepted-value reuse) are untouched

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass; tsc clean; full jest stays 347 pass / 1 skip
- Content-type + required headers from `request_contract` override the matching
  OAS operation, provenance-tagged, fail-soft

---

#### Task Group 4: Executor Content-Type default broadening (Fix #3)
**Service:** `api-migration-validation-service`
**Dependencies:** Task Group 3 (the enriched operation carries the media type)

- [x] 4.0 Broaden the executor Content-Type default for mutating verbs (R4)
  - [x] 4.1 Write 2-8 focused tests for the Content-Type default
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a body-less PUT now sends a Content-Type (the #3 fix);
      (b) the media type is sourced from the enriched operation's content-type,
      falling back to `application/json`; (c) a caller-set Content-Type is
      preserved case-insensitively; (d) POST/PATCH behave the same
    - Skip exhaustive verb/body permutations
  - [x] 4.2 Broaden the default gate in `tools/execute_http_request.ts`
    - Lines 330-337: change `if (body !== undefined)` to ALSO cover mutating
      verbs (PUT/POST/PATCH) regardless of body
    - Source the media type from the enriched operation's content-type (read via
      `ctx.oasInventory` / `args.operationId` -> `oasOperation.requestBody.content`),
      falling back to `application/json` (R4)
    - Preserve a caller-set Content-Type case-insensitively (existing behaviour)
  - [x] 4.3 Do NOT touch the shared `httpExecutor`
    - The bare connection probe and target-replay paths flow through it and MUST
      NOT be force-defaulted (Out of Scope)
  - [x] 4.4 Verification + no-regression check
    - `npx tsc --noEmit` passes
    - Run the targeted tests written in 4.1 (a body-less PUT now sends
      Content-Type)
    - Run the **FULL** `npx jest` suite — MUST STAY GREEN (347 pass / 1 skip)
    - **No-regression check:** the shared `httpExecutor` probe/replay paths are
      unchanged; non-mutating verbs and existing caller-set headers behave as
      before

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass; tsc clean; full jest stays green
- Body-less PUT/POST/PATCH now default a Content-Type (fix #3) from the contract
  media type or `application/json`, without touching `httpExecutor`

---

# PHASE 2 — Fix #1 (date format) -> and therefore #2 (no-capture cascade)

### Discovery Scanner Layer (Phase 2)

#### Task Group 5: `requestContractScanner.ts` — request date-format + validation
**Service:** `discovery-service`
**Dependencies:** Task Groups 1-2 (storage + save-back accept the blob); the
Phase-1 pipeline must be landed so the scanned facts have a path to AMS
**Note:** Phase 1 content-type + required-header projection already reaches AMS
via the existing adapter facts + Task Group 2 save-back; this group adds the
genuinely-new request date-format reader plus request validation.

- [x] 5.0 Add a new request-side scanner mirroring `responseContractScanner.ts`
  - [x] 5.1 Write 2-8 focused tests for the request-contract scanner
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a `@JsonFormat(pattern="dd-MMM-yyyy")` request-body DTO
      field -> a `param_formats[]` entry with that format; (b) a
      `@DateTimeFormat` `@RequestParam`/`@PathVariable` -> a `param_formats[]`
      entry with the right `location`; (c) request validation -> a
      `request_validation[]` entry (via the reused `readValidation`); (d) the
      blob rides on `candidate.data.request_contract` keyed by endpoint name
      (`${httpMethod} ${fullPath}` == candidate `name`)
    - Skip exhaustive annotation-permutation coverage
  - [x] 5.2 Create `requestContractScanner.ts` sibling to
    `responseContractScanner.ts`
    - Do NOT inline into `emitEndpointsForMethod`
    - Provide a `scanRequestContracts(files)` + `attachRequestContractsTo
      Candidates(candidates, output)` pair mirroring `scanResponseContracts` /
      `attachResponseContractsToCandidates`
  - [x] 5.3 Project request date FORMAT into `param_formats[]`
    - Read request-side `@JsonFormat` / `@DateTimeFormat` off request-body DTO
      fields AND `@RequestParam`/`@PathVariable` params; the IR already carries
      these annotations (`languageIR.ts` `AnnotationIR.args` 24-31,
      `ParameterIR.annotations`, `FieldIR.annotations`)
    - Emit `{ name, location, format, pattern, source }` entries
    - This reader is genuinely NEW (`readSerialization` reads only the RESPONSE
      DTO today)
  - [x] 5.4 Project request VALIDATION into `request_validation[]`
    - Reuse the already-request-side `readValidation` (`responseContractScanner.ts`
      790-820); emit `{ field, constraint, failure_status, message }` entries
  - [x] 5.5 Shape + attach the blob
    - Reshape into the `request_contract` blob (internal `schema_version`, boxed
      `confidence`, `provenance: { source_files[], method_id }` with top-level
      `provenance: 'code-scan'` semantics), snake_case keys throughout
    - Attach keyed by endpoint name onto `candidate.data.request_contract` so it
      auto-persists to `discovery_candidates.data`
    - Invoke it soft-failing in `index.ts` right after the response-contract scan
      block (~2504-2517)
  - [x] 5.6 Verification + no-regression check
    - `discovery-service` typecheck passes
    - Run ONLY the 2-8 tests written in 5.1 (a `@JsonFormat(pattern="dd-MMM-yyyy")`
      request field -> `param_formats[]`; request validation -> `request_validation[]`)
    - **No-regression check:** the response-contract scan and its
      `attachResponseContractsToCandidates` are unchanged; the new invocation is
      soft-failing and does not disturb existing candidate emission/merge

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass; discovery-service typechecks
- Request date-formats + validation land in `candidate.data.request_contract`
  via a standalone, soft-failing scanner without disturbing the response scan

---

### Capture-Loop Enrichment Layer (Phase 2)

#### Task Group 6: OAS param-format enrichment from `request_contract.param_formats`
**Service:** `api-migration-validation-service`
**Dependencies:** Task Groups 3, 5 (the Group-3 enrichment seam exists; the
scanner now produces `param_formats`)

- [x] 6.0 Extend the Group-3 enrichment so `param_formats` override OAS param
  `schema.format`/`pattern`
  - [x] 6.1 Write 2-8 focused tests for the param-format override
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a `request_contract.param_formats` entry overrides the
      matching OAS param's `schema.format`/`pattern`, beating a misleading
      `xsd:date`; (b) the value reaches `extractOasParams`; (c) the override is
      provenance-tagged `x-amvs-source: code-scan` at the param level (R3);
      (d) a `dd-MMM-yyyy` request format is present in the operation detail the
      LLM reads (fixes #1)
    - Skip exhaustive param-location permutations
  - [x] 6.2 Extend the enrichment merge to param formats
    - In the Group-3 enrichment site (`captureSessionActions.ts`), map each
      `request_contract.param_formats` entry onto the matching
      `oasOperation.parameters[].schema.format`/`pattern` as an OVERRIDE
      (override where present, leave the contract value where code is silent)
    - Ensure the value reaches `extractOasParams`
      (`captureSessionOrchestrator.ts` 909-931) and the prompt's contract
      guidance / `get_oas_operation_detail`
  - [x] 6.3 Provenance-tag the param-level override (R3)
    - Stamp `x-amvs-source: code-scan` at the param `schema`/param extension
      level; only where code-evidence actually overrode/added a value
  - [x] 6.4 Verification + no-regression check
    - `npx tsc --noEmit` passes
    - Run the targeted tests written in 6.1
    - Run the **FULL** `npx jest` suite — MUST STAY GREEN (347 pass / 1 skip)
    - **No-regression check:** the Phase-1 content-type/header enrichment (Group
      3) and the executor default (Group 4) still behave as before; runtime
      levers untouched; single-shot capture/reconcile unaffected

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass; tsc clean; full jest stays green
- A scanned `dd-MMM-yyyy` request format overrides the misleading `xsd:date` in
  the OAS param schema, reaches `extractOasParams` + the LLM-facing operation
  detail, and is provenance-tagged

---

### Cross-Layer Testing

#### Task Group 7: Cross-layer test review & gap analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical cross-layer gaps only
  - [x] 7.1 Review the tests written in Task Groups 1-6
    - AMS round-trip (1.1), save-back pass-through (2.1), Phase-1 OAS enrichment
      (3.1), executor Content-Type (4.1), request scanner (5.1), param-format
      enrichment (6.1)
  - [x] 7.2 Analyze gaps against THIS spec's load-bearing invariants only
    - code-evidence OVERRIDES the contract (date format + content-type); the
      contract stands where the code is silent; runtime levers stay untouched
    - body-less PUT now gets a Content-Type (fix #3)
    - a `dd-MMM-yyyy` request format reaches the LLM-facing operation detail
      (fix #1, and therefore the #2 no-capture cascade)
    - save-back carries request facts end-to-end (additive, absent-key)
    - Do NOT assess whole-application coverage
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Maximum of 10 new tests across the layers, focused on the integration
      seams (scanner -> save-back -> AMS -> capture enrichment -> executor) and
      the override-vs-silent precedence rule
    - Explicitly assert NO regression of the A/B/C/D specs (changesets 189-193)
      and of single-shot capture/reconcile
    - Skip edge-case, performance, and accessibility tests unless business-critical
  - [x] 7.4 Run feature-specific tests + the full amvs jest gate
    - Run the tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3 (per service)
    - Run the **FULL** `api-migration-validation-service` `npx jest` suite and
      confirm it stays 347 pass / 1 skip green
    - Do NOT run unrelated whole-application suites beyond the per-service gates
      above

**Acceptance Criteria:**
- All feature-specific tests pass; full amvs jest suite stays 347 pass / 1 skip
- No more than 10 additional tests added
- The load-bearing invariants are covered: code-evidence override vs contract-
  silent, untouched runtime levers, body-less-PUT Content-Type, `dd-MMM-yyyy`
  reaching the LLM, save-back carrying request facts
- Explicit no-regression of changesets 189-193 and single-shot capture/reconcile

---

## Execution Order

Recommended implementation sequence (strictly bottom-up; Phase 1 fully lands
fix #3 before any Phase 2 work begins):

**PHASE 1 (fixes #3):**
1. AMS `request_contract` column / entity / DTO / mapper / changeset 194 (Group 1)
2. mcp-server save-back pass-through (Group 2)
3. amvs capture-time OAS enrichment — content-type + headers (Group 3)
4. amvs executor Content-Type default broadening — the #3 fix (Group 4)

**PHASE 2 (fixes #1, therefore #2):**
5. discovery-service `requestContractScanner.ts` — date-format + validation (Group 5)
6. amvs OAS enrichment extended to param formats (Group 6)

**CROSS-LAYER:**
7. Cross-layer test review & gap analysis (Group 7)
