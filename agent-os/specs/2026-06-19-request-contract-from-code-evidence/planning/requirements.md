# Spec Requirements: Request Contract from Code Evidence

## Initial Description

Mine the current-state CODE SCAN for per-endpoint request-construction facts
(request date FORMATS, request CONTENT-TYPE, required HEADERS, request-field
VALIDATION), store them as separate non-reviewed facts (a new `requestContract`
JSONB on the endpoint, mirroring `responseContract`), and ENRICH the
capture-time OAS so the API-behaviour capture LLM builds correct requests on the
FIRST attempt — instead of reverse-engineering them at runtime.

Motivating real failures (a "HiFi" API capture run, 34% success):
1. Date-format mismatch — API uses Joda `dd-MMM-yyyy` (e.g. `17-JUN-2026`); the
   LLM sends ISO (`2024-01-01`) → 400 "Invalid format ... malformed". The
   WADL/XSD contract is MISLEADING here (types it as `xsd:date` → ISO).
2. "No capture was recorded" on ~38 later `/views/*` scenarios — a cascade of
   #1: those endpoints are `businessDate`-parameterized, so the LLM burned its
   per-scenario budget wrestling the date format and never persisted a request.
3. 415 Unsupported Media Type on body-less PUTs (setFavourite / unsetFavourite /
   revertFilterPromotionRequest): the executor's Content-Type default is gated
   on `body !== undefined`, so body-less PUTs get no Content-Type → Jersey 415.

Cross-service: discovery-service (scanner extension + save-back),
architecture-model-service (AMS `requestContract` column/changeset + DTO/mapper +
surfacing into capture), api-migration-validation-service (capture-time OAS
enrichment + executor Content-Type default). AMS wire is snake_case. Must not
regress the A/B/C/D specs (changesets 189–193) or existing capture/reconcile.

## Requirements Discussion

The requester is the requirements authority and pre-locked the key decisions.
No end-user clarifying round was run; questions are answered against the locked
decisions below and returned to the orchestrator with a "Locked?" verdict.

### Locked Decisions (fixed — authoritative)

1. **PRECEDENCE.** code-evidence > WADL/XSD-or-uploaded-OAS contract > runtime
   levers (error-driven format correction + accepted-value reuse). All three
   layered; none removed. Code-evidence OVERRIDES the contract where they
   conflict; the contract stands where the code is silent; runtime is the final
   net.
2. **STORAGE.** A NEW non-reviewed `requestContract` JSONB on the endpoint model,
   mirroring the EXISTING `EndpointEntity.responseContract`. Code-scan
   provenance, NO UI accept/reject lifecycle. NOT the discovery findings table
   (has a review lifecycle) and NOT captured-decisions (wrong semantic).
3. **APPLICATION.** Enrich the capture-time OAS so the facts reach
   `get_oas_operation_detail`, `defaultScenarioSet.extractOasParams`, and the
   executor — overriding misleading WADL/XSD/uploaded-OAS values for param
   format/pattern, request content-type, and required headers.
4. **EXECUTOR fix (#3).** Default Content-Type for mutating methods
   (PUT/POST/PATCH) regardless of body, from the contract/requestContract media
   type (fallback `application/json`).
5. **PHASING.**
   - **Phase 1** = `requestContract` storage (column + changeset) + save-back of
     the ALREADY-extracted content-type + required headers + capture-time OAS
     enrichment + executor Content-Type default (fixes #3, builds the pipeline).
   - **Phase 2** = extend the discovery scanner for request date-format
     (`@JsonFormat`/`@DateTimeFormat`) + request validation into
     `requestContract` (fixes #1, hence #2).

### Existing Code to Reference

**`responseContract` precedent (mirror exactly for `requestContract`):**
- DB: `architecture-model-service/.../db/changelog/sql/168-endpoint-response-contract.sql`
  — `ALTER TABLE endpoints ADD COLUMN response_contract JSONB;` (additive,
  nullable, embedded internal `schema_version`, no separate confidence column).
- Master changelog entry idiom: `db.changelog-master.yaml:3606-3622` (changeSet
  `168-endpoint-response-contract`; `onFail: MARK_RAN`, `onError: HALT`, `not
  columnExists` guard, `sqlFile` with `splitStatements: true`,
  `stripComments: true`).
- Entity: `EndpointEntity.java:113-115` —
  `@Type(JsonType.class) @Column(name="response_contract", columnDefinition="jsonb") private Map<String,Object> responseContract;`
- DTO: `EndpointDto.java:82-83` — `@JsonProperty("response_contract") Map<String,Object> responseContract` (snake_case, NO `@CamelCaseWire`).
- Mapper: `EntityMapper.java:402` (toDto) and `EntityMapper.java:430` (toEntity)
  — passthrough of `responseContract`.

**Discovery-service scanner / save-back precedent:**
- Response scanner: `discovery-service/.../springClassic/responseContractScanner.ts`
  — `readSerialization` (lines 841-884) reads `@JsonFormat(pattern=)`,
  `@JsonInclude`, `@JsonProperty` off the RESPONSE DTO only; `readValidation`
  (lines 790-820) reads `@Valid`/JSR-380 constraints off request-body bean +
  parameters (so a request-validation reader already exists in shape).
  `attachResponseContractsToCandidates` (lines 1215-1230) rides the blob on
  `candidate.data.response_contract`.
- Adapter request facts: `springClassic/index.ts` `emitEndpointsForMethod`
  (lines 794-891) writes `consumes`/`produces`/`headers`/`params` (866-869) and
  `requestParams`/`requestHeaders` (871-872) onto candidate `data`.
  Extractors: `extractRequestParams` (646-665), `extractRequestHeaders`
  (669-688), `extractDiscriminators` (607-619).
- Universal IR: `languageIR.ts` — `AnnotationIR.args` (24-31) carries every
  annotation arg; `ParameterIR.annotations` (34-39) and `FieldIR.annotations`
  (42-48) carry full annotation lists. Request-side `@JsonFormat`/
  `@DateTimeFormat`/validation ARE present in the IR; only the adapter
  projection is missing.
- Merge: `candidateMerge.ts` — `UNION_LIST_KEYS` (99-104) unions
  `consumes`/`produces`/`headers`/`params`; a `response_contract`/
  `request_contract` object rides as a scalar/object key (preserved).

**THE SAVE-BACK GAP (Phase 1 core):**
- `mcp-server/src/services/candidateSaveBackService.ts` `case 'endpoints':`
  (lines 1073-1125) maps `operation_verb`, `path_or_address`,
  `protocol_metadata_json` (SOAP), and `response_contract` — but DROPS
  `consumes`/`produces`/`headers`/`params`/`requestParams`/`requestHeaders`.
  Request facts reach `discovery_candidates.data` but die here. This is where
  `request_contract` pass-through (snake/camel-tolerant, additive, absent-key)
  must be added, mirroring the `response_contract` arm at 1119-1124.

**AMS capture-context assembly (surfacing path):**
- `MigrationDiscoveryContextService.java` `buildSeedSet` (line 1995+) already
  reads `safeResponseContract(endpoint)` (2015) to seed error/auth scenarios.
  The per-operation `ScenarioSeedSetDto` (`operationKey`, `method`, `path`,
  `safeToExecute`, `seeds[]`) is the per-operation context vehicle.
  `ScenarioSeedDto.exampleRequest` exists (archModelClient `ScenarioSeedDto`
  line 1087) but is currently effectively empty.

**api-migration-validation-service capture/enrichment:**
- OAS inventory build at capture: `captureSessionActions.ts` `parse-oas`
  (`parseOasFromFile`/`parseUploadedContract`/`parseWadlFromSpecLink`); merged
  inventory cached via `oasInventoryStore.set(sessionId, merged)` (line 1149).
- Existing AMS-endpoint→operation enrichment precedent:
  `synthesiseOperationFromEndpoint` (431+) reads `protocol_metadata_json` off
  the endpoint row and "layers it into the operation row" — direct precedent
  for reading `request_contract` off the endpoint and merging into the OAS.
- `get_oas_operation_detail.ts` returns `op.requestSchema`, `op.responseSchema`,
  `op.oasOperation` from `ctx.oasInventory.operations` (in-memory — the override
  target).
- `defaultScenarioSet.extractOasParams` (`captureSessionOrchestrator.ts`
  909-931) reads `param.schema.enum`; the doc comment (942) states params carry
  `enum`/`format` from the "fix-1-enriched" schemas — enriching `schema.format`/
  `pattern` flows here.
- Executor Content-Type gate: `tools/execute_http_request.ts` lines 330-337 —
  `if (body !== undefined) { ...default 'Content-Type': 'application/json' }`.
  Fix #4 broadens this to mutating methods regardless of body, sourced from the
  contract/requestContract media type.
- Discovery context fetch at /start: `captureSessionActions.ts` 1652
  (`getMigrationDiscoveryContext`, fail-soft); `oasInventoryStore` + the fetched
  `discoveryContext` are both in scope at /start (the natural enrichment seam).
- Liquibase next-free changeset = **194** (highest applied on disk = 193;
  191/192/193 = the B/C/D specs whose changesets must not be disturbed).

### Reference specs (idioms)
- `2026-06-16` (volatile values), `2026-06-17` (baseline-integrity-provenance,
  oracle-coverage-scoring, reconcile-full-response-fidelity), `2026-06-18`
  (stateful-sequence-scenarios) — AMS-field + changeset + capture-loop idioms.
- `2026-05-30-response-contract-capture` — the direct `responseContract`
  precedent (spec.md documents the AMS column + DTO + `candidateSaveBackService`
  pass-through this spec mirrors).

## Visual Assets

No visual assets provided. Bash check of
`agent-os/specs/2026-06-19-request-contract-from-code-evidence/planning/visuals/`
returned no image files (directory absent). This is a backend, multi-service
data-pipeline spec; no mockups expected.

## Requirements Summary

### Functional Requirements

**Phase 1 — pipeline + content-type fix (from already-extracted facts):**
- Add a NEW nullable `request_contract` JSONB column to the `endpoints` table
  via a NEW Liquibase changeset (194), mirroring 168. Embed an internal
  `schema_version`; no separate confidence column.
- Add `requestContract` to `EndpointEntity` (Hypersistence `@Type(JsonType)`
  `Map<String,Object>`) and `EndpointDto` (`@JsonProperty("request_contract")`,
  snake_case, no `@CamelCaseWire`); wire through `EntityMapper` toDto/toEntity.
- Discovery: project the ALREADY-extracted request content-type (`consumes`) +
  required headers (`headers`/`requestHeaders` required) into a structured
  `request_contract` blob on the endpoint candidate `data` (own scanner module,
  mirroring `responseContractScanner`'s attach pattern).
- Save-back: add a `request_contract` pass-through to the `case 'endpoints':`
  arm of `candidateSaveBackService.ts` (snake/camel-tolerant, additive,
  absent-key semantics).
- Capture-time OAS enrichment: read the endpoint's `request_contract` from AMS
  and merge its facts into the in-memory OAS operation (request content-type →
  the operation's request media type; required headers → header params) so
  `get_oas_operation_detail`, `extractOasParams`, and the executor see them. The
  override must be provenance-tagged (e.g. `x-amvs-source: code-scan` /
  trace shows `content-type: code-scan`) so a code-scan override of a misleading
  contract value is visible in the trace.
- Executor Content-Type default (Fix #4): default Content-Type for
  PUT/POST/PATCH regardless of body, from the contract/requestContract media
  type (fallback `application/json`); preserve a caller-set Content-Type
  (case-insensitive). Do NOT force-default the bare connection probe / target
  replay paths.

**Phase 2 — scan request date-format + validation (closes the date bug):**
- Extend the discovery scanner to project request-side date-format
  (`@JsonFormat`/`@DateTimeFormat` on request-body DTO fields and on
  `@RequestParam`/`@PathVariable` params) and request-field validation into the
  same `request_contract` blob (universal IR already carries these annotations).
- Enrich the OAS param `format`/`pattern` from the scanned date-format so the
  LLM emits e.g. `dd-MMM-yyyy` on the first attempt — overriding a misleading
  `xsd:date`→ISO contract value.

### `requestContract` blob shape (proposed, to be finalised by spec-writer)
Mirror the `responseContract` style — structured-but-loose JSONB, internal
`schema_version`, snake_case keys, boxed confidence:
- `content_type` / `consumes[]` (request media type)
- `required_headers[]` ({ name, source })
- `param_formats[]` ({ name, location, format, pattern, source }) — Phase 2
- `request_validation[]` ({ field, constraint, failure_status, message }) — Phase 2
- `provenance` ({ source_files[], method_id })
- `confidence`

### Reusability Opportunities
- Clone `168-endpoint-response-contract.sql` + its master-changelog block for
  changeset 194 (`194-endpoint-request-contract.sql`).
- Clone the `EndpointEntity.responseContract` / `EndpointDto.responseContract` /
  `EntityMapper` passthrough triplet for `requestContract`.
- Clone `responseContractScanner.ts`'s attach pattern for a request-side scanner;
  reuse `readValidation` (already request-side) for Phase 2 validation.
- Clone the `response_contract` arm of `candidateSaveBackService.ts` for the
  `request_contract` save-back pass-through.
- Reuse `synthesiseOperationFromEndpoint`'s `protocol_metadata_json`→operation
  layering pattern for reading `request_contract` into the OAS.

### Scope Boundaries

**In Scope:**
- `request_contract` JSONB column + changeset 194 (AMS).
- Entity/DTO/mapper for `requestContract` (AMS).
- Discovery scanner projection of request content-type + required headers
  (Phase 1) and date-format + validation (Phase 2) into `request_contract`.
- Save-back pass-through of `request_contract` (mcp-server).
- Capture-time OAS enrichment from `request_contract` with code-scan provenance
  tagging (amvs).
- Executor default Content-Type for mutating methods (amvs).

**Out of Scope:**
- Any UI accept/reject lifecycle for `request_contract` (it is non-reviewed).
- Removing or weakening the WADL/XSD/uploaded-OAS contract layer or the runtime
  levers (all three layers stay; code-evidence only overrides).
- Shape-spec / book-of-work generation consuming the contract (persist + apply
  at capture only).
- Discovery findings-table or captured-decisions storage (explicitly rejected).
- Per-scenario HTTP attempt cap changes (already raised 3→5 separately).

### Technical Considerations
- AMS wire is snake_case (CLAUDE.md): `request_contract` is snake_case on the
  wire and inside the JSONB; NO `@CamelCaseWire` (matches `EndpointDto`).
- Reference type (`Map<String,Object>`) so a PATCH with no value preserves the
  column (per `project_primitive_double_dto_overwrite.md`); additive + nullable
  so existing rows round-trip with a null `request_contract`.
- Never edit an applied changeset (189–193 are the B/C/D specs); changeset 194
  is NEW with a `not columnExists` guard.
- Save-back must use absent-key semantics (undefined → ABSENT key, not null) so
  a tier-gated-off / empty scan does not wipe an existing value.
- Enrichment must be an OVERRIDE, not a blind merge: where code-evidence and the
  contract disagree (e.g. date format), code-evidence wins and the override is
  provenance-tagged; where code is silent the contract value stands.
- Open design choice (see clarifying questions): the surfacing path for
  `requestContract` into the capture loop — (i) existing
  `MigrationDiscoveryContextDto.scenarioSeeds` (`exampleRequest` + per-param
  facts), (ii) a NEW per-operation field on the context DTO, or (iii) OAS
  enrichment reading AMS endpoints directly.

## Resolved Clarifications (AUTHORITATIVE — bind the spec-writer)

The requirements authority resolves all 6 shaper questions.

**R1 (surfacing path) — (iii) OAS enrichment reading AMS endpoints directly.** At capture `/start`, after the in-memory OAS inventory is built (`captureSessionActions.ts:1149`) and the discovery context is fetched (`:1652`), fetch the AMS endpoints (carrying `requestContract`) and MERGE their facts into the matching in-memory OAS operations (match by method+path), reusing the `synthesiseOperationFromEndpoint` / `protocol_metadata_json` layering precedent (`captureSessionActions.ts:431-464`). Rationale: it lands the facts exactly where all THREE consumers already read (`get_oas_operation_detail`, `defaultScenarioSet.extractOasParams`, and the executor's Content-Type default), reuses an existing precedent, and keeps `requestContract` decoupled from scenario-seeding. (i) is rejected — it couples to seeds (fail-soft, omitted when discovery hasn't run) AND never reaches the executor's Content-Type default, so it can't fix #3. (ii) adds DTO surface for no gain over (iii). CONFIRMED by the requester (2026-06-19): build with (iii) — OAS enrichment reading the AMS endpoints directly.

**R2 (requestContract blob shape) — mirror `responseContract`, snake_case, no `@CamelCaseWire`.** Shape: `{ content_type | consumes[], required_headers[], param_formats[] (per-param name + format/pattern), request_validation[], provenance: 'code-scan', confidence, schema_version }`. Exact key names are the spec-writer's call within "mirror the responseContract precedent." It is a loose JSONB blob whose internal `schema_version` evolves without DDL (like `responseContract`).

**R3 (provenance tagging) — YES.** Mark the overridden OAS operation/param with an `x-amvs-source: code-scan` extension (or equivalent) so the trace + `get_oas_operation_detail` show that a format/content-type/header came from the code scan rather than the contract. Mechanism is spec-writer's discretion.

**R4 (executor Content-Type fallback) — YES, `application/json`.** For mutating methods (PUT/POST/PATCH) with no contract/`requestContract` media type, default `Content-Type: application/json`.

**R5 (header enrichment phase) — Phase 1.** Required-headers projection AND their OAS enrichment are both Phase 1 (alongside content-type).

**R6 (scanner module placement) — a NEW `requestContractScanner.ts`** sibling to `responseContractScanner.ts` (mirrors the precedent), rather than inlining into `emitEndpointsForMethod`.

**Save-back (Phase 1 core, from the analysis):** extend `mcp-server/src/services/candidateSaveBackService.ts` `case 'endpoints':` (~lines 1073-1125) to pass `request_contract` through (cloning the `response_contract` arm, snake/camel-tolerant, additive) — today it drops `consumes`/`headers`/`requestParams`, so those facts die before reaching `EndpointEntity`. AMS adds the `request_contract` JSONB column (changeset 194 — verify next-free; mirror `168-endpoint-response-contract.sql`) + DTO + mapper, sibling to `response_contract`.
