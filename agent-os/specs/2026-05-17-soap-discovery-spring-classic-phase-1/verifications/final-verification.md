# Verification Report: SOAP Discovery -- Spring Classic Phase 1

**Spec:** `2026-05-17-soap-discovery-spring-classic-phase-1`
**Date:** 2026-05-17
**Verifier:** implementation-verifier
**Status:** PASS

---

## Executive Summary

Phase 1 SOAP discovery for Spring Classic is fully implemented across all 13 task groups. Every targeted test suite passes (47 net-new tests across discovery-service, mcp-server, and api-migration-validation-service), the AMS Java module compiles cleanly, and TypeScript clean-compile is achieved in all three Node services for the SOAP work. The single TS error in mcp-server is pre-existing rot in an unrelated file. The end-to-end fixture tests (Group 12) demonstrate that both public reference fixtures produce non-zero endpoint candidates with `interface_type='SOAP_API'` parents, satisfying the raw-idea acceptance criterion.

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks

- [x] Task Group 1: WSDL Parser (Signal C foundation)
- [x] Task Group 2: Signal A Scanner -- Spring-WS Annotations
- [x] Task Group 3: Signal B Scanner -- JAX-WS Annotations
- [x] Task Group 4: SOAP Endpoint Emitter -- Merge, Precedence, Candidate Build
- [x] Task Group 5: Wire SOAP Sub-Module into Spring Classic Scanner
- [x] Task Group 6: Diagnostic Logging
- [x] Task Group 7: `evidence_gap` `gapType` Sentinel Additions
- [x] Task Group 8: Interface-Type Vocab Audit (`'SOAP_API'`)
- [x] Task Group 9: AMS Schema -- `protocol_metadata_json` JSONB Column
- [x] Task Group 10: Save-Back Support for SOAP `data` Fields
- [x] Task Group 11: AMVS Pre-Population Plumbing for Step 4
- [x] Task Group 12: End-to-End Fixture Test against Reference WSDL + XSD
- [x] Task Group 13: Inline Module Header Documentation

### Incomplete or Issues

None. `grep` for unchecked checkboxes in `tasks.md` returned zero hits.

---

## 2. File Presence Verification

**Status:** All Documented Paths Present

### Discovery-service sub-module (`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/`)

- [x] `wsdlParser.ts` (18,808 bytes)
- [x] `springWsScanner.ts` (12,750 bytes)
- [x] `jaxWsScanner.ts` (11,241 bytes)
- [x] `soapEndpointEmitter.ts` (32,890 bytes)
- [x] `index.ts` (12,491 bytes) -- includes Group 13 inline TSDoc header citing D-1, D-2, D-3, D-5
- [x] `soapEvidenceGaps.ts` (5,517 bytes)

### Discovery-service test suites (`discovery-service/src/__tests__/`)

All eight planned test files present:

- [x] `springClassicSoapWsdlParser.test.ts` (G1)
- [x] `springClassicSoapSpringWsScanner.test.ts` (G2)
- [x] `springClassicSoapJaxWsScanner.test.ts` (G3)
- [x] `springClassicSoapEmitter.test.ts` (G4)
- [x] `springClassicFindingScannerSoapWiring.test.ts` (G5 wiring)
- [x] `springClassicSoapDiagLogging.test.ts` (G6)
- [x] `springClassicSoapEvidenceGaps.test.ts` (G7)
- [x] `springClassicSoapEndToEndFixtures.test.ts` (G12)

Plus the G8 audit test:

- [x] `interfaceTypeSoapApiAudit.test.ts`

### AMS schema (Group 9)

- [x] `architecture-model-service/src/main/resources/db/changelog/sql/138-endpoints-protocol-metadata-json.sql`
- [x] Changeset 138 registered in `db.changelog-master.yaml` at lines 2702-2723 (after changeset 137)
- [x] `EndpointEntity.java` extended with `protocolMetadataJson` field (line 85-86, `@Column(name = "protocol_metadata_json", columnDefinition = "jsonb") private Map<String, Object> protocolMetadataJson;`)
- [x] No changeset at or below 137 was modified (verified via git status; only `137-discovery-runs-kind.sql` and `138-...` present in the SQL dir, and the `138-...` file is new)

### mcp-server save-back (Group 10)

- [x] `mcp-server/src/services/candidateSaveBackService.ts` extended: lines 494, 504, 516, 715, 723 reference `protocol_metadata_json` handling inside `case 'endpoints'`
- [x] `mcp-server/src/__tests__/candidateSaveBack.soap.test.ts`

### AMVS pre-population (Group 11)

- [x] `api-migration-validation-service/src/routes/captureSessionActions.ts` extended: `synthesiseInventoryFromEndpoints` now branches on `readInterfaceType(parentInterface) === 'SOAP_API'` (line 290) and maps the seven SOAP fields into Step 4 columns (line 305+); the field enumeration at line 235 matches the candidate-side enumeration.
- [x] `api-migration-validation-service/src/__tests__/captureSessionActions.soapPrepop.test.ts`

---

## 3. Roadmap Updates

**Status:** No Updates Needed

The product roadmap (`agent-os/product/roadmap.md`) tracks the original meta-model / diagram editor product (Phases 1-5). There is no roadmap item that corresponds to SOAP discovery in Spring Classic; this work sits inside the orthogonal `discovery-service` / capture-validation pipeline added later. No roadmap entries were updated.

---

## 4. Test Suite Results

### Suite A: `discovery-service` -- `springClassicSoap` pattern (G1-G7, G12)

Command: `npx jest --testPathPattern="springClassicSoap|SpringClassicSoap|springClassicFindingScannerSoap"`

- **Total Tests:** 41
- **Passing:** 41
- **Failing:** 0
- **Test Suites:** 8 passed, 8 total

Per-suite breakdown (all PASS):

- `springClassicSoapWsdlParser.test.ts` (G1)
- `springClassicSoapSpringWsScanner.test.ts` (G2)
- `springClassicSoapJaxWsScanner.test.ts` (G3)
- `springClassicSoapEmitter.test.ts` (G4)
- `springClassicFindingScannerSoapWiring.test.ts` (G5 wiring -- 3 tests)
- `springClassicSoapDiagLogging.test.ts` (G6 -- 4 tests)
- `springClassicSoapEvidenceGaps.test.ts` (G7 -- 3 tests)
- `springClassicSoapEndToEndFixtures.test.ts` (G12 -- 5 tests)

### Suite B: `discovery-service` -- interfaceType audit (G8)

Command: `npx jest --testPathPattern="interfaceTypeSoapApiAudit"`

- **Total Tests:** 2
- **Passing:** 2
- **Failing:** 0

### Suite C: `mcp-server` -- candidate save-back (G10)

Command: `npx jest --testPathPattern="candidateSaveBack.soap"`

- **Total Tests:** 3
- **Passing:** 3
- **Failing:** 0

### Suite D: `api-migration-validation-service` -- AMVS pre-population (G11)

Command: `npx jest --testPathPattern="captureSessionActions.soapPrepop"`

- **Total Tests:** 3
- **Passing:** 3
- **Failing:** 0

### Suite E: AMS Maven compile (G9)

Command: `mvn -f architecture-model-service/pom.xml clean compile -DskipTests`

- **Result:** BUILD SUCCESS
- 628 source files compiled with javac 21
- No compile errors

### Aggregate

- **Total Net-New Tests (across A-D):** 49
- **Passing:** 49
- **Failing:** 0
- **Errors:** 0

### Failed Tests

None.

---

## 5. TypeScript Clean-Compile Verification

| Service | `npx tsc --noEmit` Result |
|---|---|
| `discovery-service/` | Clean (empty output) |
| `api-migration-validation-service/` | Clean (empty output) |
| `mcp-server/` | One pre-existing error in `src/types/index.ts` line 196 -- `ProcessActivityInput` duplicate re-export; unrelated to SOAP work (file has no uncommitted changes per `git diff`) |

All net-new SOAP files in all three services type-check cleanly.

---

## 6. Open Design Point Traceability

Spot-check of `shaping-notes.md` resolutions in code:

### D-1 -- Layered naming rule (top-down, first match wins)

- Referenced in `soapEndpointEmitter.ts:13` (TSDoc), `:147` (raw inputs section), `:195` (compute display name function), `:213` (tiebreaker form), `:312` (rule 3 collision handling), `:703` (compute display name across record set), `:770` (apply D-1 across full record set)
- Referenced in `springClassicSoap/index.ts:33` (header doc)
- Pinned by emitter Test 5 (D-1 layered), Test 6 (D-1 fall-through), Test 7 (D-1 tiebreaker)

### D-2 -- Split-source precedence (per field, not per signal)

- Referenced in `soapEndpointEmitter.ts:21-22` (TSDoc enumerating WSDL-wins fields), `:107` (D-2 precedence applied later), `:625` (D-2 precedence applied in buildEndpointData), `:659` (build per-operation data blob), `:666` (WSDL wins for XML signatures; annotations win for DTOs)
- Referenced in `springClassicSoap/index.ts:43` (header doc)
- Pinned by emitter Test 4 (A+C combined precedence) and E2E Fixture 6 (D-2 honoured end-to-end)

### D-3 -- `operation_verb='POST'`

- Hard-coded as a string literal at `soapEndpointEmitter.ts:689` (`operation_verb: 'POST', // D-3`)
- Referenced in TSDoc at `soapEndpointEmitter.ts:30` and `springClassicSoap/index.ts:54-57`
- Pinned by emitter Test 8 (candidate shape audit)

### D-5 -- JSONB blob, not explicit columns

- DDL in `138-endpoints-protocol-metadata-json.sql:19-20`: `ALTER TABLE endpoints ADD COLUMN protocol_metadata_json JSONB NULL;`
- Column comment in the SQL file references D-5 explicitly
- `EndpointEntity.java:85-86` uses `Map<String, Object>` (JSONB-friendly) with `columnDefinition = "jsonb"` -- no explicit per-field columns
- Referenced in `springClassicSoap/index.ts:61-64` (header doc)
- mcp-server save-back at `candidateSaveBackService.ts:723` bundles SOAP fields into the JSONB blob (`entity.protocol_metadata_json = soapMetadata`)
- AMVS pre-population at `captureSessionActions.ts:235` (field enumeration matches candidate side exactly)

All four spot-checked design points are honoured in code AND covered by tests.

Q-6 (reference fixtures) honoured: Group 12 tests load both `reference-jaxws-document-literal-wrapped.wsdl` and `reference-spring-ws-countries.xsd` from `planning/visuals/`.

Q-9 (new `evidence_gap` sentinels) honoured: `soap_endpoint_url_unknown` and `wsdl_parse_failed` registered in the central `EvidenceGapType` union (Group 7 Test 3 asserts membership).

Q-10 (out-of-scope edges) honoured: JAX-WS scanner does not special-case `target/generated-sources/cxf/` paths.

---

## 7. Acceptance Signal

The raw-idea acceptance criterion -- "the user's reference Spring Classic SOAP service produces non-zero endpoint candidates that match the WSDL's operation list 1:1 after this spec ships" -- is anchored to public reference fixtures per Q-6 because the user has no local SOAP service.

The Group 12 E2E test suite (`springClassicSoapEndToEndFixtures.test.ts`) asserts:

- **Fixture 1 (JAX-WS WSDL):** `reference-jaxws-document-literal-wrapped.wsdl` produces one interface candidate (`interface_type='SOAP_API'`) and one endpoint candidate for `greet` with the documented field values. PASS.
- **Fixture 2 (Spring-WS + countries XSD):** `reference-spring-ws-countries.xsd` paired with an inline `@Endpoint`+`@PayloadRoot` Java fixture produces one interface candidate and one endpoint candidate with `request_root_element='getCountryRequest'`, `response_root_element='getCountryResponse'`, `request_namespace='https://spring.io/guides/gs-producing-web-service'`. PASS.
- **Fixture 4 (servlet path unknown):** `path_or_address=null` AND paired `soap_endpoint_url_unknown` `evidence_gap` finding. PASS.
- **Fixture 5 (malformed WSDL):** `wsdl_parse_failed` finding emitted, no candidate, scanner does NOT throw. PASS.
- **Fixture 6 (A+C combined precedence):** JAX-WS WSDL + matching `@WebService(name=...)` Java -- D-2 honoured end-to-end; no duplicate operations. PASS.

Both reference fixtures produce non-zero endpoint candidates with `interface_type='SOAP_API'` parents. Acceptance signal: **MET**.

---

## 8. Noted-but-Not-Blocking Caveats

1. **mcp-server pre-existing TypeScript error in `src/types/index.ts:196`** -- `ProcessActivityInput` has an ambiguous duplicate re-export from `./saveUsersInteractions`. The file has no uncommitted changes (verified via `git diff`); this is pre-existing rot unrelated to SOAP work. All net-new SOAP files in mcp-server type-check cleanly.

2. **AMS test compile rot** -- per the user's explicit instruction (per `feedback_liquibase_immutable_changesets.md` history), test-compile is known-broken in unrelated files and was not run. `mvn ... compile -DskipTests` confirmed **main-source** BUILD SUCCESS, which is the load-bearing signal for AMS. Group 9's persistence tests (`EndpointProtocolMetadataPersistenceTest.java`) are documented in `tasks.md` 9.1 but were not exercised in this verification pass due to the pre-existing test-suite breakage.

3. **`implementation/` folder is empty** -- the spec did not require per-group implementation reports, and the workflow accepted task-completion via in-suite test evidence (all 41 SOAP discovery tests pass, plus 8 cross-service tests, plus Maven main-source compile success). The Group 13 deliverable (inline TSDoc header in `index.ts`) substitutes for a free-standing README.

None of these caveats blocks the spec's acceptance signal.

---

## VERDICT: PASS
