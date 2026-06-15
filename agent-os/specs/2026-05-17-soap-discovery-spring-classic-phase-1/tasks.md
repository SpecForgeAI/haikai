# Task Breakdown: SOAP Discovery — Spring Classic Phase 1

## Overview
Total Task Groups: 13
Total Tasks: ~90 (across 13 groups)

This spec extends the existing Spring Classic finding scanner with a SOAP-aware pass driven by three deterministic signals (Spring-WS annotations, JAX-WS annotations, WSDL files). The 13 task groups below are ordered so each group can be built and verified in isolation:

- Groups 1-3 build the three signal scanners as pure functions over inputs.
- Group 4 merges the signals into candidates (the only place D-1 layered naming and D-2 split-source precedence are applied).
- Group 5 wires the new sub-module into the existing Spring Classic scanner.
- Groups 6-8 cover the cross-cutting concerns (logging, evidence_gap sentinels, interface-type vocab audit).
- Groups 9-11 cover the persistence chain (AMS schema, save-back, AMVS pre-population).
- Group 12 is the end-to-end fixture acceptance test.
- Group 13 is the inline header documentation deliverable.

## Standing Constraints (apply to every group)

- Liquibase changesets at or below 137 are immutable. NEW changesets only at 138+.
- Per `feedback_liquibase_immutable_changesets.md`: never edit applied changesets, even comments.
- Per `feedback_no_src_edits_during_run.md`: no edits to `discovery-service/src/**` while a discovery run is active.
- Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics MUST be boxed (`Boolean`, `Long`, `Double`) with null guards in the update handler.
- The existing REST emit path in `discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts` is the **structural template** for finding emission shape, regex / AST patterns, and diagnostic log format — match its conventions everywhere.
- All new structured log lines use the `[diag-pack] scanner=spring_classic_soap ...` prefix.
- The parent interface candidate's `interface_type` field MUST be `'SOAP_API'` in every emitted SOAP candidate stream.
- The WSDL parser MUST soft-fail on malformed WSDL — never throw; return empty operation list + parse-error reason for the caller to translate into a `wsdl_parse_failed` `evidence_gap` finding.
- No network access from the WSDL parser; absolute-URL `xsd:import`/`xsd:include` are skipped in v1, relative paths only.
- The candidate-side `data` field set and the AMVS-side enumeration in `synthesiseInventoryFromEndpoints` MUST match exactly (the contract between the discovery emitter and the wizard's pre-population pass).

---

## Task List

### Foundation Layer

#### Task Group 1: WSDL Parser (Signal C foundation)
**Dependencies:** None

- [x] 1.0 Implement the pure WSDL walker
  - [x] 1.1 Write 4-6 focused tests for `wsdlParser.ts`
    - Test file: `discovery-service/src/__tests__/springClassicSoapWsdlParser.test.ts`
    - Test 1: parses `planning/visuals/reference-jaxws-document-literal-wrapped.wsdl` and returns one `wsdl:portType` with one operation `greet`
    - Test 2: extracts `targetNamespace` and the embedded `<xsd:schema>`'s top-level `greet` / `greetResponse` element wrappers from the same fixture
    - Test 3: malformed-XML fixture (inline string) — walker does NOT throw; returns `{ operations: [], parseError: { reason, sourcePath } }`
    - Test 4: multi-port WSDL (inline-string fixture with two `<wsdl:port>` bindings) — returns operations for every `port × operation` pair (no dedup)
    - Test 5: relative `xsd:import` is followed against an in-memory file map; absolute-URL `xsd:import` is silently skipped (no network)
    - Test 6 (optional): `reference-spring-ws-countries.xsd` parses cleanly as a standalone `xsd:schema` block (top-level `getCountryRequest` + `getCountryResponse` elements extracted)
  - [x] 1.2 Add `fast-xml-parser` as a new npm dependency
    - File: `discovery-service/package.json` — add to `dependencies`
    - Run `npm install` in `discovery-service/` to refresh `discovery-service/package-lock.json` (lockfile refresh is an explicit deliverable per D-4)
    - Confirm no transitive conflicts with existing deps
  - [x] 1.3 Create `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/wsdlParser.ts`
    - Pure, side-effect-free; only reads already-loaded source strings (caller supplies the file map)
    - Public function shape: `parseWsdl(source: string, opts: { sourcePath: string; relatedFiles: Map<string, string> }): WsdlParseResult`
    - `WsdlParseResult` shape: `{ ports: WsdlPort[]; portTypes: WsdlPortType[]; operations: WsdlOperation[]; embeddedSchemas: XsdSchema[]; parseError?: { reason: string; sourcePath: string } }`
    - Each `WsdlOperation` carries: `portName`, `portTypeName`, `operationName`, `soapAction`, `inputMessage`, `outputMessage`, `requestRootElement`, `requestNamespace`, `responseRootElement`
    - Walker scope (deliberately narrow per D-4):
      - `wsdl:portType` operations + their `input` / `output` message parts
      - Message parts resolved back to `xsd:element` definitions (embedded or imported)
      - Embedded `xsd:schema` top-level `xsd:element` and `xsd:complexType` signatures
      - Relative `xsd:import` / `xsd:include` resolved via `opts.relatedFiles` map (file-system relative paths within the repo); absolute URLs skipped
      - Multi-port WSDLs: iterate every `wsdl:port` binding and emit operations for each `port × operation` pair
    - Soft-fail behaviour: catches any thrown error from `fast-xml-parser`, returns empty `operations: []` with `parseError` populated
  - [x] 1.4 Run ONLY the 4-6 tests from 1.1
    - Do NOT run the entire discovery-service test suite

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `fast-xml-parser` appears in `discovery-service/package.json` and `package-lock.json`
- Walker is side-effect-free (no `fs`, no `http`, no `process` usage)
- Malformed WSDL returns a result, never throws

---

### Signal Scanners

#### Task Group 2: Signal A Scanner — Spring-WS Annotations
**Dependencies:** None (independent of Group 1)

- [x] 2.0 Implement the Spring-WS annotation scanner
  - [x] 2.1 Write 3-5 focused tests for `springWsScanner.ts`
    - Test file: `discovery-service/src/__tests__/springClassicSoapSpringWsScanner.test.ts`
    - Test 1: inline Java source with `@Endpoint` class + two `@PayloadRoot(namespace=..., localPart=...)` methods returns two raw signal entries
    - Test 2: `@PayloadRoot` namespace + localPart values flow through to the result struct verbatim
    - Test 3: class with no SOAP-relevant annotations returns an empty list (back-compat: REST controllers must not be misclassified)
    - Test 4: emitter raw inputs exposed (per D-1) — class simple name, package, `@WebService(name=...)` if also present, and any namespace seen — so the emitter can apply layered naming centrally
    - Test 5 (optional): `@PayloadRoots({...})` multi-mapping variant produces one signal per inner `@PayloadRoot`
  - [x] 2.2 Create `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/springWsScanner.ts`
    - Public function shape: `scanSpringWsSources(sources: { path: string; content: string }[]): SpringWsSignal[]`
    - `SpringWsSignal` carries: `sourcePath`, `simpleClassName`, `packageName`, `webServiceNameAttribute` (if also annotated `@WebService(name=...)`), `operations: { methodName, namespace, localPart, requestDtoClass, responseDtoClass }[]`
    - Regex / AST patterns mirror the existing `@Controller` / `@RequestMapping` scanning style in `springClassicFindingScanner.ts`
    - Resolves `@PayloadRoot.localPart` into `requestRootElement`, `namespace` into `requestNamespace`
    - Pulls `requestDtoClass` from the method's first parameter type's FQN; `responseDtoClass` from the return type FQN
    - MUST expose raw inputs needed by D-1 (class simple name, package, namespace) — the emitter applies the layered rule, not this scanner
  - [x] 2.3 Run ONLY the 3-5 tests from 2.1

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- Scanner is pure (no I/O beyond reading the passed-in source strings)
- Empty / non-SOAP sources return `[]` cleanly (no false positives on REST controllers)

---

#### Task Group 3: Signal B Scanner — JAX-WS Annotations
**Dependencies:** None (independent of Groups 1 and 2)

- [x] 3.0 Implement the JAX-WS annotation scanner
  - [x] 3.1 Write 3-5 focused tests for `jaxWsScanner.ts`
    - Test file: `discovery-service/src/__tests__/springClassicSoapJaxWsScanner.test.ts`
    - Test 1: inline Java source with `@WebService` class + two `@WebMethod` methods returns two raw signal entries
    - Test 2: `@WebService(name="X")` attribute is captured for the D-1 layered naming rule
    - Test 3: `@RequestWrapper(localName=...)` and `@ResponseWrapper(localName=...)` flow through to `requestRootElement` / `responseRootElement`
    - Test 4: `@WebMethod(operationName="...")` overrides the Java method name when present
    - Test 5: class with only `@WebService` and no `@WebMethod` returns an empty operations list (D-2 hint: bare class with no methods produces no candidates)
  - [x] 3.2 Create `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/jaxWsScanner.ts`
    - Public function shape: `scanJaxWsSources(sources: { path: string; content: string }[]): JaxWsSignal[]`
    - `JaxWsSignal` carries: `sourcePath`, `simpleClassName`, `packageName`, `webServiceNameAttribute` (from `@WebService(name=...)`), `targetNamespace` (from `@WebService(targetNamespace=...)` when present), `operations: { methodName, operationName, requestRootElement, responseRootElement, requestDtoClass, responseDtoClass }[]`
    - Regex / AST patterns match the existing scanner style
    - Apache CXF generated sources are OUT OF SCOPE per Q-10 — hand-written `@WebService` classes are picked up; do NOT special-case files under `target/generated-sources/cxf/`
    - MUST expose the raw inputs the emitter needs for D-1 layered naming
  - [x] 3.3 Run ONLY the 3-5 tests from 3.1

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- Scanner is pure (no I/O beyond reading passed-in source strings)
- `@WebService(name=...)` is preserved verbatim for the emitter's layered naming rule

---

### Signal Merge and Candidate Construction

#### Task Group 4: SOAP Endpoint Emitter — Merge, Precedence, Candidate Build
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Implement the signal-merging candidate emitter
  - [x] 4.1 Write 6-8 focused tests for `soapEndpointEmitter.ts`
    - Test file: `discovery-service/src/__tests__/springClassicSoapEmitter.test.ts`
    - Test 1 (Signal A in isolation): Spring-WS signals only — one candidate per `@PayloadRoot` method, parent interface candidate has `interface_type='SOAP_API'`
    - Test 2 (Signal B in isolation): JAX-WS signals only — one candidate per `@WebMethod`, parent interface candidate has `interface_type='SOAP_API'`
    - Test 3 (Signal C in isolation): WSDL signals only — one candidate per `wsdl:operation`, including multi-port WSDLs (every `port × operation` pair)
    - Test 4 (A+C combined — D-2 precedence): WSDL wins for `operation_verb`-adjacent fields — `request_root_element`, `request_namespace`, `response_root_element` come from WSDL; `request_dto_class` / `response_dto_class` come from annotations; NO duplicate operations
    - Test 5 (D-1 layered naming pinned): class annotated `@WebService(name="X")` in package `com.foo` with class `BarService` produces parent interface name `X` — NOT `BarService`, NOT `com.foo.BarService`
    - Test 6 (D-1 fall-through): class annotated only `@Endpoint` with class `OrdersEndpoint` in package `com.foo` produces parent interface name `OrdersEndpoint` (rule 2: simple Java name)
    - Test 7 (D-1 tiebreaker): two classes both named `OrdersEndpoint` in different packages disambiguate via package (rule 3 only kicks in on collision)
    - Test 8 (candidate shape audit): emitted endpoint candidate carries `operation_verb='POST'` (D-3), `interface_id` linking to parent, and the seven new `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) at the documented keys
  - [x] 4.2 Create `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`
    - Public function shape: `emitSoapCandidates(input: { springWs: SpringWsSignal[]; jaxWs: JaxWsSignal[]; wsdl: WsdlParseResult[]; servletPaths: Map<interfaceKey, string | null> }): { interfaceCandidates: DiscoveryCandidate[]; endpointCandidates: DiscoveryCandidate[]; diagnostics: DiagLine[] }`
    - **D-1 Layered naming rule** (applied centrally here, top-down, first match wins):
      1. `@WebService(name=...)` attribute on the class, when present
      2. `@Endpoint` / `@WebService`-annotated class's **simple Java name** (no package prefix)
      3. Package name + namespace-derived names as **tiebreakers only** — used to disambiguate when two candidates collide on the same display name
    - **D-2 Split-source precedence** (applied per field, not per signal):
      - **WSDL wins** for: operation list, `request_root_element`, `request_namespace`, `response_root_element`
      - **Annotations win** for: `request_dto_class`, `response_dto_class` (annotations are the only source for fully-qualified Java class names)
      - Merge MUST be per field — never duplicate operations when A and C both describe the same one
    - **Candidate output shape** (mirror the existing REST emit path's `DiscoveryCandidate` row for type `'endpoints'`):
      - `interface_id` — links to the parent SOAP interface candidate
      - `operation_verb` — literal `'POST'` (D-3); the SOAP kind signal is `soap_action` + parent `interface_type='SOAP_API'`
      - `path_or_address` — servlet endpoint URL where the SOAP message lands (e.g., the `MessageDispatcherServlet` mapping derived from `web.xml` / `WebApplicationInitializer`); nullable. When null, emitter records the need for a `soap_endpoint_url_unknown` `evidence_gap` finding (Group 7 wires the actual emission)
      - `data` fields: `soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`
    - **Parent interface candidate**: type `'interfaces'`, `interface_type='SOAP_API'`, name from the D-1 layered rule
    - The diagnostic log lines for `signal=A|B|C` are emitted by the emitter (one per signal × interface), forwarded by the caller (Group 5)
    - Verify candidate row shape against the existing REST emit path in `springClassicFindingScanner.ts` to mirror conventions
  - [x] 4.3 Run ONLY the 6-8 tests from 4.1

**Acceptance Criteria:**
- The 6-8 tests written in 4.1 pass
- D-1 layered naming and D-2 split-source precedence are honoured exactly
- No duplicate operations when both annotations and WSDL describe the same service
- Parent interface candidate has `interface_type='SOAP_API'` in every test
- Endpoint candidate shape matches the existing REST emit path's `DiscoveryCandidate` row conventions

---

### Integration

#### Task Group 5: Wire SOAP Sub-Module into Spring Classic Scanner
**Dependencies:** Task Groups 1-4

- [x] 5.0 Wire the new SOAP pass into the existing Spring Classic scanner
  - [x] 5.1 Write 2-3 focused integration tests
    - Test file: `discovery-service/src/__tests__/springClassicFindingScannerSoapWiring.test.ts`
    - Test 1: scanner receives a mixed file set (REST controllers + Spring-WS endpoints) and emits BOTH REST endpoint candidates AND SOAP endpoint candidates in a single pass; back-compat — REST candidates unchanged
    - Test 2: scanner with only REST sources still works (no regressions); SOAP pass returns empty arrays cleanly
    - Test 3 (optional): scanner with only SOAP sources emits SOAP candidates and zero REST candidates
  - [x] 5.2 Create `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/index.ts`
    - Public entry: `runSpringClassicSoapPass(input: ScannerInput): ScannerOutput`
    - Orchestrates: `scanSpringWsSources` (Group 2) → `scanJaxWsSources` (Group 3) → `parseWsdl` over discovered `.wsdl` files (Group 1) → `emitSoapCandidates` (Group 4)
    - Discovers `.wsdl` files via the same file-walk infrastructure the REST pass uses (typically `src/main/resources/**/*.wsdl` plus conventional sibling locations)
    - Forwards diagnostic log lines from the emitter to the scanner runner's diagnostic stream
  - [x] 5.3 Modify `discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts`
    - Invoke `runSpringClassicSoapPass` as a **peer pass** alongside the existing REST emit path
    - Position the call so REST and SOAP candidates are emitted in the same scanner run
    - Merge both passes' candidate output into the scanner's existing return shape — no parallel emitter, no new finding pipeline
    - One call site change only; no broader refactor of the REST path
  - [x] 5.4 Run ONLY the 2-3 tests from 5.1

**Acceptance Criteria:**
- The 2-3 tests written in 5.1 pass
- REST scanning behaviour is unchanged for projects with no SOAP signals
- SOAP candidates surface alongside REST candidates in a single scanner run
- The scanner has exactly one new call site for the SOAP sub-module

---

### Cross-Cutting Concerns

#### Task Group 6: Diagnostic Logging
**Dependencies:** Task Groups 1-5

- [x] 6.0 Wire structured `[diag-pack]` log lines through every emit path
  - [x] 6.1 Write 2-4 focused tests for log-line shape
    - Test file: `discovery-service/src/__tests__/springClassicSoapDiagLogging.test.ts`
    - Test 1: a scanner run with N source files emits exactly one `[diag-pack] scanner=spring_classic_soap start files=<N>` line at the start
    - Test 2: a signal A emit produces `[diag-pack] scanner=spring_classic_soap signal=A interface=<short-id> operations=<N>` (and similar for B and C)
    - Test 3: a successful WSDL parse produces `[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=<rel> operations=<N> ports=<N>`
    - Test 4: a failed WSDL parse produces `[diag-pack] scanner=spring_classic_soap wsdl_parse=fail path=<rel> reason=<...>` AND the run state records the need for a `wsdl_parse_failed` `evidence_gap` finding (actual emission lives in Group 7)
  - [x] 6.2 Add log emission to `springClassicSoap/index.ts` and `soapEndpointEmitter.ts`
    - All log lines use the prefix `[diag-pack] scanner=spring_classic_soap`
    - Exact line shapes (enumerated per spec.md):
      - Start: `[diag-pack] scanner=spring_classic_soap start files=<N>`
      - Per-signal emit: `[diag-pack] scanner=spring_classic_soap signal=<A|B|C> interface=<short-id> operations=<N>`
      - WSDL parse ok: `[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=<rel> operations=<N> ports=<N>`
      - WSDL parse fail: `[diag-pack] scanner=spring_classic_soap wsdl_parse=fail path=<rel> reason=<...>`
      - URL unknown: `[diag-pack] scanner=spring_classic_soap servlet_path=unknown interface=<short-id>`
    - Reuse the existing scanner runner's diagnostic sink — do NOT introduce a parallel logger
  - [x] 6.3 Run ONLY the 2-4 tests from 6.1

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- Every diagnostic log line uses the `[diag-pack] scanner=spring_classic_soap` prefix
- Log shapes exactly match the enumeration in spec.md
- WSDL parse fail and URL unknown lines are paired with the corresponding `evidence_gap` records (Group 7 emits the actual findings)

---

#### Task Group 7: `evidence_gap` `gapType` Sentinel Additions
**Dependencies:** Task Group 4 (emitter needs to record the gaps) — can be built in parallel with Groups 5 and 6

- [x] 7.0 Register the two new `evidence_gap` `gapType` sentinels
  - [x] 7.1 Write 2-3 focused tests
    - Test file: `discovery-service/src/__tests__/springClassicSoapEvidenceGaps.test.ts`
    - Test 1: a SOAP candidate emitted with `path_or_address=null` because the servlet path could not be inferred produces an `evidence_gap` finding with `gapType='soap_endpoint_url_unknown'` and a reference to the interface short-id
    - Test 2: a malformed WSDL produces an `evidence_gap` finding with `gapType='wsdl_parse_failed'`, carrying the parser's `reason` and `sourcePath` from `WsdlParseResult.parseError`
    - Test 3 (optional): both sentinels appear in the centralised `gapType` enum / constant table (whichever file the existing discovery-service uses)
  - [x] 7.2 Add the two sentinels wherever `gapType` strings are centralised
    - Most likely files (verify during implementation):
      - `discovery-service/src/services/findings/evidenceGapScanner.ts` — existing `gapType` strings: `endpoint_missing_response_schema`, `interface_missing_contract_detail`, `service_missing_owner`, `data_entity_missing_attributes`
      - Any union type / constant table that enumerates `gapType` values
    - Add: `'soap_endpoint_url_unknown'`, `'wsdl_parse_failed'`
    - Reuse the existing `FindingEmitter` from `2026-05-16-discovery-findings-first-class/`; do NOT introduce a parallel emitter
  - [x] 7.3 Wire the emitter calls
    - In `soapEndpointEmitter.ts` (or `springClassicSoap/index.ts` depending on which side has the run context): when a candidate's `path_or_address` is null due to unresolvable servlet mapping, emit a `soap_endpoint_url_unknown` finding
    - When `WsdlParseResult.parseError` is populated, emit a `wsdl_parse_failed` finding with `reason` and `sourcePath`
  - [x] 7.4 Run ONLY the 2-3 tests from 7.1

**Acceptance Criteria:**
- The 2-3 tests written in 7.1 pass
- Both new sentinels are registered in the central `gapType` location
- WSDL parse failures soft-fail with a finding (parser never throws)
- Candidates with unresolvable servlet paths are still emitted (with `path_or_address=null`) and paired with a finding

---

#### Task Group 8: Interface-Type Vocab Audit (`'SOAP_API'`)
**Dependencies:** None (read-only audit; can run in parallel with any other group)

- [x] 8.0 Audit `'SOAP_API'` end-to-end across discovery-service, AMS, and frontend
  - [x] 8.1 Write 1-2 focused tests asserting `'SOAP_API'` round-trips
    - Test file: `discovery-service/src/__tests__/interfaceTypeSoapApiAudit.test.ts`
    - Test 1: an interface candidate with `interface_type='SOAP_API'` is accepted by the discovery-service emitter and is NOT coerced / stripped
    - Test 2 (optional, AMS-side): an `InterfaceEntity` with `interface_type='SOAP_API'` persists and reloads with the value intact (run as a small Java test, OR — if mainly an audit — a one-line note in the audit doc confirming the entity has no enum coercion)
  - [x] 8.2 Audit discovery-service inference
    - Find the inference site (spec mentions `interfaceTypeInference.ts` but no such file exists yet — confirm by grep, the value `'SOAP_API'` already lives in `frontend/src/types/model.ts:80` as part of the `InterfaceType` union)
    - Confirm `'SOAP_API'` is accepted by whatever discovery-service code constructs interface candidates
    - If a one-line fix-up is needed (e.g., a missing branch in a switch / inference function), make it
  - [x] 8.3 Audit architecture-model-service
    - Files to read: `InterfaceEntity`, `InterfaceDto`, `InterfaceMapper`, `InterfaceRepository` under `architecture-model-service/src/main/java/com/example/architecturemodel/`
    - Confirm `'SOAP_API'` round-trips through persistence and the REST API without coercion or stripping (no enum that excludes it, no validator that rejects it)
    - If a one-line fix-up is needed (e.g., add to an enum), make it
  - [x] 8.4 Audit frontend
    - `'SOAP_API'` is already in the `InterfaceType` union at `frontend/src/types/model.ts:80` — confirm
    - Check the interface-type filter dropdown (if any) and any badge / icon mapping in the Interfaces grid (likely `frontend/src/components/Grid/Grid.tsx` and related)
    - If a one-line fix-up is needed (e.g., add a badge label / icon entry), make it
  - [x] 8.5 Produce audit outcome
    - In-line as a code comment at the top of `springClassicSoap/index.ts` (Group 13's README header includes this), with one of two outcomes:
      - "Confirmed end-to-end: 'SOAP_API' flows through discovery → AMS → frontend without coercion."
      - "Wired through: <list of one-line fix-ups applied during audit>."
  - [x] 8.6 Run ONLY the 1-2 tests from 8.1

**Acceptance Criteria:**
- The 1-2 tests written in 8.1 pass
- `'SOAP_API'` is honoured at all three layers (discovery / AMS / frontend) — either confirmed already-working or wired through with one-line fix-ups
- Audit outcome is recorded in code (not in a separate doc)

---

### Persistence Chain

#### Task Group 9: AMS Schema — `protocol_metadata_json` JSONB Column
**Dependencies:** None (independent schema change; Group 10 depends on it)

- [x] 9.0 Add `protocol_metadata_json` JSONB column to the AMS `endpoints` table
  - [x] 9.1 Write 2-3 focused tests
    - Test file: `architecture-model-service/src/test/java/com/example/architecturemodel/repository/entity/EndpointProtocolMetadataPersistenceTest.java`
    - Test 1: Liquibase changeset 138 applies cleanly on an existing populated `endpoints` table (existing rows backfill to `NULL`)
    - Test 2: an `EndpointEntity` with `protocolMetadataJson` set round-trips through persist + reload (JSONB content matches)
    - Test 3 (PATCH semantics): PATCH endpoint with `protocol_metadata_json` field omitted does NOT wipe the column (boxed-type / null-guard pattern per `project_primitive_double_dto_overwrite.md`)
  - [x] 9.2 Author Liquibase changeset 138
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/138-endpoints-protocol-metadata-json.sql`
    - DDL: `ALTER TABLE endpoints ADD COLUMN protocol_metadata_json JSONB NULL;`
    - Add changeset entry to `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` immediately after changeset 137 (the last applied changeset per the file's tail)
    - Numbering rationale: 137 is the most recent (`137-discovery-runs-kind`); 138 is the next free slot
    - Do NOT edit any changeset ≤137 (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 9.3 Extend `EndpointEntity`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/EndpointEntity.java` (verify exact path during implementation)
    - New field `protocolMetadataJson` typed as `String` or a JSONB-compatible Hibernate type (mirror the existing JSONB columns in the codebase, e.g., the `summary_json` / `oas_operation_json` patterns)
    - Boxed type / nullable — never primitive
  - [x] 9.4 Extend endpoint DTO and mapper
    - DTO: `EndpointDto` (or equivalent) — add `protocolMetadataJson` field, boxed type, with null-guard in any PATCH handler so an omitted field on update does NOT overwrite to null (per `project_primitive_double_dto_overwrite.md`)
    - Mapper: `EndpointMapper` — round-trip the new field
    - All seven SOAP `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) ride inside the JSONB blob — no new explicit columns (D-5 defers promotion to a future spec)
  - [x] 9.5 Run ONLY the 2-3 tests from 9.1
    - Verify migration applies on both empty and populated `endpoints` tables

**Acceptance Criteria:**
- The 2-3 tests written in 9.1 pass
- Liquibase 138 applies cleanly on existing data (existing rows backfill to NULL)
- PATCH semantics preserve `protocol_metadata_json` when omitted (boxed type + null guard)
- No changeset at or below 137 was touched
- No new explicit columns added; all SOAP fields live inside the JSONB blob

---

#### Task Group 10: Save-Back Support for SOAP `data` Fields
**Dependencies:** Task Groups 4 (candidate shape) and 9 (AMS schema)

- [x] 10.0 Extend `candidateSaveBackService.ts` `case 'endpoints'` to write SOAP fields
  - [x] 10.1 Write 2-3 focused tests
    - Test file: `mcp-server/src/__tests__/candidateSaveBack.soap.test.ts`
    - Test 1 (round-trip): an `endpoints` candidate carrying the seven new SOAP `data` fields lands on the AMS `endpoints` row's `protocol_metadata_json` column cleanly; round-trip read returns the same payload byte-for-byte
    - Test 2 (back-compat): a REST-shaped `endpoints` candidate (no SOAP `data` fields) saves back unchanged — `protocol_metadata_json` is left NULL, existing REST columns populate as before
    - Test 3 (partial SOAP fields): a SOAP candidate with only `soap_action` and `wsdl_source` populated (other fields undefined) still saves back without throwing; missing fields land as absent keys in the JSONB blob, not as `null` values
  - [x] 10.2 Modify `mcp-server/src/services/candidateSaveBackService.ts`
    - In `case 'endpoints'`: when the candidate's `data` carries any of the seven SOAP fields, bundle them into a `protocol_metadata_json` JSONB blob and forward to AMS
    - Existing REST-shape arm stays unchanged
    - No new switch case — extend the existing `'endpoints'` arm only (per D-5: "existing arm carries the new `data` fields into the JSONB column without further routing")
  - [x] 10.3 Run ONLY the 2-3 tests from 10.1

**Acceptance Criteria:**
- The 2-3 tests written in 10.1 pass
- Round-trip of all seven SOAP `data` fields through `mcp-server` → AMS → reload returns identical payload
- REST candidate save-back is unchanged (back-compat verified)

---

#### Task Group 11: AMVS Pre-Population Plumbing for Step 4
**Dependencies:** Task Group 10 (candidates must round-trip through AMS first)

- [x] 11.0 Extend `synthesiseInventoryFromEndpoints` to surface SOAP fields into Step 4 rows
  - [x] 11.1 Write 2-3 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/captureSessionActions.soapPrepop.test.ts`
    - Test 1: an endpoint row whose parent interface is `interface_type='SOAP_API'` and whose `protocol_metadata_json` carries the seven SOAP fields produces a Step 4 operation row with `soap_action` populating the operation name column, `request_root_element` / `response_root_element` in the shape-preview columns, `request_namespace` in the namespace badge slot, `request_dto_class` / `response_dto_class` in the "open in IDE" affordance slot, and `wsdl_source` in the row footer
    - Test 2 (back-compat): an endpoint row with `interface_type='REST_API'` and no `protocol_metadata_json` produces a Step 4 row exactly as before — no regression on REST rows
    - Test 3 (partial SOAP fields): an endpoint with `interface_type='SOAP_API'` but only `soap_action` populated renders a Step 4 row with the operation name column set and the other SOAP columns empty (no thrown errors, no `undefined` strings)
  - [x] 11.2 Modify `api-migration-validation-service/src/routes/captureSessionActions.ts` — `synthesiseInventoryFromEndpoints`
    - When the parent interface has `interface_type='SOAP_API'`, read the seven SOAP fields off the candidate's `data.protocol_metadata_json` (whichever shape the AMS endpoint row exposes them — typically deserialised from the JSONB column into a nested object on the endpoint DTO)
    - Map fields into the operation row per the contract enumeration:

      | `data` field           | Step 4 column / use                              |
      |------------------------|--------------------------------------------------|
      | `soap_action`          | Operation name column                            |
      | `request_root_element` | Request shape preview                            |
      | `request_namespace`    | XML namespace badge                              |
      | `response_root_element`| Response shape preview                           |
      | `request_dto_class`    | Java class hyperlink / "open in IDE" affordance  |
      | `response_dto_class`   | As above                                         |
      | `wsdl_source`          | "Source: <repo-relative path>" footer in row     |

    - Surface mapped values into the operation row's `summary` / `description` / `oas_operation_json` fields so the wizard renders meaningfully without further Step 4 UI changes
    - The candidate-side enumeration (Group 4) and this AMVS-side enumeration MUST match exactly — this is the contract between the discovery emitter and the wizard's pre-population pass
  - [x] 11.3 Run ONLY the 2-3 tests from 11.1

**Acceptance Criteria:**
- The 2-3 tests written in 11.1 pass
- Step 4 SOAP rows pre-populate from the candidate's SOAP `data` fields without manual entry
- REST row pre-population is unchanged (no regression)
- The candidate-side and AMVS-side field enumerations match exactly

---

### End-to-End Verification

#### Task Group 12: End-to-End Fixture Test against Reference WSDL + XSD
**Dependencies:** Task Groups 1-11

- [x] 12.0 Run the new SOAP pass against both reference fixtures and assert expected candidate counts + shapes
  - [x] 12.1 Write 4-6 end-to-end fixture tests
    - Test file: `discovery-service/src/__tests__/springClassicSoapEndToEndFixtures.test.ts`
    - Fixture 1: `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-jaxws-document-literal-wrapped.wsdl` — JAX-WS document-literal-wrapped WSDL; single `wsdl:portType` `GreetingsPortType` with one operation `greet`
      - Expected: one SOAP interface candidate (name `GreetingsService` derived from the WSDL service name OR the JAX-WS `@WebService(name=...)` if paired with a hand-written Java fixture), one endpoint candidate for `greet`, `request_root_element='greet'`, `response_root_element='greetResponse'`, `request_namespace` matches the WSDL target namespace, `wsdl_source` set to the fixture path
      - Diagnostic log: `[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=<rel> operations=1 ports=1`
    - Fixture 2: `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-spring-ws-countries.xsd` paired with an inline Spring-WS Java fixture (`@Endpoint` + `@PayloadRoot(namespace="https://spring.io/guides/gs-producing-web-service", localPart="getCountryRequest")`) — anchors Signal A
      - Expected: one SOAP interface candidate, one endpoint candidate for the `@PayloadRoot` method, `request_root_element='getCountryRequest'`, `response_root_element='getCountryResponse'`, `request_namespace='https://spring.io/guides/gs-producing-web-service'`
    - Fixture 3: parent interface candidate carries `interface_type='SOAP_API'` in BOTH fixture tests
    - Fixture 4 (servlet path unknown): same Spring-WS fixture but no `web.xml` / `WebApplicationInitializer` in the file set — `path_or_address=null` AND a paired `soap_endpoint_url_unknown` `evidence_gap` finding
    - Fixture 5 (malformed WSDL): inline-string malformed WSDL fixture — `wsdl_parse_failed` finding emitted, no candidate, scanner does not throw
    - Fixture 6 (A+C combined): JAX-WS fixture WSDL + a matching `@WebService(name="GreetingsService")` Java source — D-2 precedence honoured per Group 4 Test 4 but at the end-to-end level
  - [x] 12.2 Run ONLY the 4-6 tests from 12.1
    - Acceptance signal per the raw idea: "the user's reference Spring Classic SOAP service produces non-zero endpoint candidates that match the WSDL's operation list 1:1 after this spec ships"

**Acceptance Criteria:**
- The 4-6 tests written in 12.1 pass
- Both reference fixtures (`reference-jaxws-document-literal-wrapped.wsdl`, `reference-spring-ws-countries.xsd`) produce non-zero endpoint candidates
- Candidate shapes match the spec enumeration exactly (interface type, verb, data fields, evidence gaps)
- Diagnostic log lines appear as enumerated in spec.md
- Fixture provenance is documented inline as "derived from public reference repos" (per Q-6)

---

### Documentation

#### Task Group 13: Inline Module Header Documentation
**Dependencies:** Task Groups 1-12

- [x] 13.0 Add a short README-style header inside `springClassicSoap/index.ts`
  - [x] 13.1 Add inline TSDoc / JSDoc header at the top of `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/index.ts`
    - Describe the three signals: Spring-WS annotations (Signal A), JAX-WS annotations (Signal B), WSDL files (Signal C)
    - State the D-1 layered naming rule (top-down, first match wins; same order as in the emitter)
    - State the D-2 split-source precedence rule (WSDL wins for operation list + XML signatures; annotations win for `request_dto_class` / `response_dto_class`; per-field, not per-signal)
    - Reference the Group 8 audit outcome ("'SOAP_API' confirmed end-to-end" OR a list of fix-ups applied)
    - Reference the spec path: `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/spec.md`
    - Reference D-3 `operation_verb='POST'` rationale
    - Reference D-5 — all new fields ride inside `protocol_metadata_json` JSONB; promotion to explicit columns deferred
  - [x] 13.2 No standalone `.md` file
    - The header lives inside `index.ts` only — do NOT create a separate README.md file (per the standing instruction "NEVER create documentation files (*.md) or README files unless explicitly requested")

**Acceptance Criteria:**
- The header is present at the top of `index.ts` and describes the three signals + precedence rule
- The Group 8 audit outcome is recorded in the header (single source of truth for the audit result)
- No standalone documentation file was created

---

## Execution Order

Recommended implementation sequence:

1. **Foundation parallel block** — Groups 1 (WSDL parser), 2 (Signal A), 3 (Signal B), 8 (interface-type audit), 9 (AMS schema). All independent; can be parallelised by separate engineers.
2. **Merge layer** — Group 4 (emitter). Depends on Groups 1-3.
3. **Integration** — Group 5 (wire into scanner). Depends on Group 4.
4. **Cross-cutting** — Groups 6 (diag logging), 7 (evidence_gap sentinels). Depend on Groups 4 and 5.
5. **Persistence** — Group 10 (save-back). Depends on Groups 4 and 9.
6. **AMVS pre-population** — Group 11. Depends on Group 10.
7. **End-to-end fixture test** — Group 12. Depends on Groups 1-11.
8. **Documentation** — Group 13. Depends on Groups 1-12.

**Dependency map:**

```
Group 1 (WSDL parser) ----+
Group 2 (Signal A)        |
Group 3 (Signal B) -------+--> Group 4 (Emitter) --> Group 5 (Wire-in) --> Group 6 (Diag logs)
Group 8 (vocab audit)     |                                         \
Group 9 (AMS schema) -----+                                          +--> Group 7 (Evidence gaps)
                         |
                         +--> Group 10 (Save-back) --> Group 11 (AMVS prepop) --> Group 12 (E2E fixtures) --> Group 13 (Header docs)
```

Groups 1-3, 8, and 9 are parallelisable on day one. Group 12 is the gating end-to-end check. Group 13 is a tiny documentation deliverable folded in at the end.
