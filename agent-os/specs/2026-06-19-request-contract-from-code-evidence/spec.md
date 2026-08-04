# Specification: Request Contract from Code Evidence

## Goal
Mine the current-state CODE SCAN for per-endpoint request-construction facts (request content-type, required headers, request date-formats, request-field validation), persist them as a new non-reviewed `request_contract` JSONB on the endpoint (mirroring `response_contract`), and ENRICH the capture-time OAS so the capture LLM builds correct requests on the FIRST attempt — fixing three real SampleSvc-API failures from code evidence rather than runtime guessing.

## User Stories
- As the API-behaviour capture loop, I want code-derived request facts (date format, content-type, required headers) layered onto the OAS operation I read, so I send a correctly-formatted request the first time instead of burning my per-scenario budget reverse-engineering a misleading `xsd:date`/Joda mismatch.
- As an integration engineer reviewing a capture trace, I want code-scan-sourced overrides of the WADL/XSD/uploaded-OAS contract to be provenance-tagged (`x-amvs-source: code-scan`), so I can see exactly when code evidence overrode the contract.

## Specific Requirements

**Precedence model (binding, R1 PRECEDENCE)**
- Three layers, all retained, none removed: code-evidence > WADL/XSD-or-uploaded-OAS contract > runtime levers (error-driven format correction + accepted-value reuse).
- Code-evidence OVERRIDES the contract where they conflict (provenance-tagged); the contract value stands where the code is silent; runtime levers remain the final net.
- Enrichment is an OVERRIDE, not a blind merge: a present code-evidence value REPLACES the contract value for that field; an absent code-evidence value leaves the contract value untouched.

**AMS `request_contract` storage (Phase 1; R2)**
- Add ONE nullable `request_contract` JSONB column to the existing `endpoints` table via a NEW Liquibase changeset `194-endpoint-request-contract` (verified next-free; highest on disk is 193, and 189–193 are the A/B/C/D specs that MUST NOT be disturbed).
- Clone `168-endpoint-response-contract.sql` and its master-changelog block (`changeSet id: 194-endpoint-request-contract`, author, `onFail: MARK_RAN`, `onError: HALT`, `not columnExists` guard on `request_contract`, `sqlFile` with `splitStatements: true` + `stripComments: true`). Additive + nullable so existing rows round-trip with a null `request_contract`.
- NO review/accept/reject lifecycle; NOT the discovery findings table and NOT captured-decisions.
- Embed an internal `schema_version` inside the blob (e.g. `request_contract.v1`); confidence is a boxed `Double` INSIDE the blob, never a separate column (per `project_primitive_double_dto_overwrite.md`).

**AMS entity / DTO / mapper (Phase 1; R2)**
- Clone the `responseContract` triplet for `requestContract`: `EndpointEntity` `@Type(JsonType.class) @Column(name="request_contract", columnDefinition="jsonb") private Map<String,Object> requestContract;`.
- `EndpointDto` adds `@JsonProperty("request_contract") Map<String,Object> requestContract` — snake_case, reference type, NO `@CamelCaseWire` (matches the DTO's snake_case convention; CLAUDE.md).
- `EntityMapper.toDto` and `EntityMapper.toEntity` pass `requestContract` through, sibling to the `responseContract` passthrough.
- AMS wire is snake_case: the wire key and the JSONB keys are all snake_case.

**`request_contract` blob shape (R2; spec-writer's call within "mirror responseContract")**
- `content_type` (string) and/or `consumes[]` (request media types) — Phase 1.
- `required_headers[]`: `{ name, source }` — Phase 1.
- `param_formats[]`: `{ name, location, format, pattern, source }` — Phase 2.
- `request_validation[]`: `{ field, constraint, failure_status, message }` — Phase 2.
- `provenance`: `{ source_files[], method_id }` with top-level `provenance: 'code-scan'` semantics; `confidence` (boxed Double); `schema_version` (internal). Loose-but-structured JSONB whose internal `schema_version` evolves without DDL.

**Discovery request-contract scanner (R6; Phase 1 + Phase 2)**
- NEW `requestContractScanner.ts` sibling to `responseContractScanner.ts` (do NOT inline into `emitEndpointsForMethod`), with a `scanRequestContracts(files)` + `attachRequestContractsToCandidates(candidates, output)` pair mirroring `scanResponseContracts` / `attachResponseContractsToCandidates`.
- Attach rides on `candidate.data.request_contract` keyed by endpoint name (`${httpMethod} ${fullPath}` == candidate `name`) so it auto-persists to `discovery_candidates.data`; invoke it soft-failing in `index.ts` right after the response-contract scan block (~2504-2517).
- Phase 1 projection: request content-type from `consumes` discriminators and required headers from `headers`/`requestHeaders` (required) into the blob's `content_type`/`consumes[]` + `required_headers[]`. The adapter already extracts these (`extractDiscriminators`, `extractRequestHeaders` at `springClassic/index.ts:607-688`); the scanner reshapes them into the structured blob.
- Phase 2 projection: read request-side `@JsonFormat`/`@DateTimeFormat` (request-body DTO fields AND `@RequestParam`/`@PathVariable` params) into `param_formats[]`, and request validation into `request_validation[]`. The universal IR already carries these annotations (`languageIR.ts` `AnnotationIR.args`, `ParameterIR.annotations`, `FieldIR.annotations`); reuse the existing request-side `readValidation` (`responseContractScanner.ts:790-820`) for `request_validation[]`. Note `readSerialization` reads only the RESPONSE DTO today, so the request date-format reader is genuinely new.

**Save-back pass-through (Phase 1 core; the gap)**
- Extend `candidateSaveBackService.ts` `case 'endpoints':` (~1073-1125) with a `request_contract` arm cloning the `response_contract` arm at 1119-1124: `const requestContract = data.request_contract ?? data.requestContract; if (requestContract !== undefined && requestContract !== null) entity.request_contract = requestContract;`.
- Snake/camel-tolerant, additive, absent-key semantics: undefined → ABSENT key (never null), so a tier-gated-off / empty scan does NOT wipe an existing value. Today this arm drops `consumes`/`headers`/`requestParams`/`requestHeaders`, so the already-scanned facts die before reaching `EndpointEntity` — this pass-through is the Phase-1 unblock.

**Capture-time OAS enrichment from AMS endpoints (R1=iii; Phase 1 content-type+headers, Phase 2 formats)**
- At capture `/start`, after the in-memory OAS inventory is loaded (`oasInventoryStore.get`, `captureSessionActions.ts:1539`; built at `:1149`) and the discovery context is fetched (`:1652`), fetch AMS endpoints via the existing `archModelClient.listEndpointsForArchitecture(projectId, session.architecture_id)` (each row carries `request_contract` once AMS surfaces it).
- MERGE each endpoint's `request_contract` facts into the matching in-memory `ParsedOasOperation` by method+path, reusing the `synthesiseOperationFromEndpoint` / `protocol_metadata_json` layering precedent (`captureSessionActions.ts:431-464`). Mutate the same in-memory inventory object that is passed to `spawnOrchestrator` (`:1745`), so all three consumers see the enriched values.
- Phase 1: content-type → the operation's request media type (`oasOperation.requestBody.content`, used by the executor's Content-Type default); required headers → header `parameters[]` (`in: header`, `required: true`) on `oasOperation`.
- Phase 2: param `format`/`pattern` → `oasOperation.parameters[].schema.format`/`pattern` (overriding a misleading `xsd:date`→ISO), which `extractOasParams` (`captureSessionOrchestrator.ts:909-931`) and `get_oas_operation_detail` then surface.
- Fail-soft (like the discovery-context fetch): an AMS error or unmatched endpoint leaves the contract-derived OAS unchanged; never block `/start`.

**Provenance tagging of overrides (R3)**
- Stamp each overridden OAS operation/param with an `x-amvs-source: code-scan` extension (operation-level for content-type/headers; param-level `schema`/param extension for formats) so the trace and `get_oas_operation_detail` (which returns `op.oasOperation`) show the value came from the code scan, not the contract. Only stamp where code-evidence actually overrode/added a value; contract-sourced fields stay unmarked.

**Executor Content-Type default broadening (Fix #3; R4)**
- In `execute_http_request.ts:330-337`, broaden the default from `if (body !== undefined)` to ALSO cover mutating verbs (PUT/POST/PATCH) regardless of body — fixing the 415 on body-less PUTs (setFavourite/unsetFavourite/revertFilterPromotionRequest).
- Source the media type from the operation's contract/`requestContract` request media type (read from the enriched `oasOperation.requestBody.content` via `ctx.oasInventory`/`args.operationId`), falling back to `application/json` (R4).
- Preserve a caller-set Content-Type, case-insensitively (existing behaviour). Do NOT touch the shared `httpExecutor` — the bare connection probe and target replay paths flow through it and MUST NOT be force-defaulted.

## Visual Design
No visual assets provided. This is a backend, multi-service data-pipeline spec; no mockups expected.

## Existing Code to Leverage

**`responseContract` AMS triplet + changeset 168**
- `168-endpoint-response-contract.sql` + master block `db.changelog-master.yaml:3606-3622`; entity `EndpointEntity.java:113-115`; DTO `EndpointDto.java:82-83`; mapper `EntityMapper.java:402,430`. Clone wholesale for `request_contract`/changeset 194 (snake_case, no `@CamelCaseWire`, internal `schema_version`, boxed confidence, `not columnExists` guard).

**`responseContractScanner.ts` (discovery)**
- `scanResponseContracts`/`attachResponseContractsToCandidates` (attach at `:1215-1230`) + soft-fail invocation in `index.ts:2504-2517`. Mirror for `requestContractScanner.ts`. Reuse `readValidation` (`:790-820`, already request-side) for Phase-2 `request_validation[]`; the request date-format reader is new because `readSerialization` (`:841-884`) reads only the response DTO.

**Adapter request extractors (`springClassic/index.ts`)**
- `extractDiscriminators` (`:607-619` → `consumes`/`headers`), `extractRequestHeaders` (`:669-688`), `extractRequestParams` (`:646-665`), and the `emitEndpointsForMethod` data writes (`:866-872`). These already produce the Phase-1 facts; the scanner reshapes them into the blob and save-back promotes them.

**`candidateSaveBackService.ts` `case 'endpoints':` response_contract arm**
- `:1119-1124` — the exact snake/camel-tolerant, additive, absent-key pattern to clone for `request_contract`.

**`synthesiseOperationFromEndpoint` + `listEndpointsForArchitecture` (amvs)**
- `captureSessionActions.ts:431-464` layers `protocol_metadata_json` off the endpoint row into the operation — the precedent for layering `request_contract`. `archModelClient.listEndpointsForArchitecture` (`:1239-1248`) already fetches all endpoint rows; `ParsedOasOperation.oasOperation` (`types/oas.ts:30-58`) is the in-memory override target; `extractOasParams` (`captureSessionOrchestrator.ts:909-931`) and `get_oas_operation_detail.ts` are the read sites.

## Out of Scope
- Any UI accept/reject/review lifecycle for `request_contract` (it is non-reviewed, code-scan provenance only).
- Removing or weakening the WADL/XSD/uploaded-OAS contract layer or the runtime levers — all three layers stay; code-evidence only OVERRIDES.
- Storing request facts in the discovery findings table or captured-decisions (both explicitly rejected — wrong semantics).
- Shape-spec / book-of-work generation consuming `request_contract` (persist + apply at capture only).
- Force-defaulting Content-Type on the shared `httpExecutor` bare connection probe or target replay paths.
- Per-scenario HTTP attempt cap changes (already raised 3→5 separately).
- Editing any applied changeset (189–193 / the A/B/C/D specs); 194 is NEW with a `not columnExists` guard.
- Languages/frameworks other than Spring Classic for the request-contract scanner in this spec.
- A separate `confidence` column or a separate provenance/review column on `endpoints`.
