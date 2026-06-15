# Specification: SOAP Discovery — Spring Classic Phase 1

## Goal
Extend the Spring Classic finding scanner with a deterministic SOAP-aware pass that emits endpoint candidates from three independent signals (Spring-WS annotations, JAX-WS annotations, and WSDL files), so real-world Spring Classic SOAP services produce non-zero endpoint candidates and the AMVS capture wizard's Step 4 pre-populates meaningfully.

## User Stories
- As an architect running discovery against a Spring Classic SOAP service, I want each WSDL operation and `@PayloadRoot` / `@WebMethod` to surface as an endpoint candidate so the architecture model captures SOAP services with the same fidelity as REST.
- As a migration engineer, I want SOAP candidates to carry the `soap_action`, request/response root elements, namespaces, DTO classes, and source WSDL path on the candidate `data` so the AMVS capture wizard's Step 4 renders meaningful operation rows without manual entry.
- As a project lead, I want SOAP interfaces to appear in the Interfaces grid with `interface_type='SOAP_API'` so SOAP and REST services are first-class peers in the architecture model.

## Specific Requirements

**Scanner sub-module layout (Q-7)**
- New folder `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/`.
- `index.ts` — public entry, invoked from `springClassicFindingScanner.ts` as a peer pass alongside the existing REST emit path.
- `wsdlParser.ts` — pure, side-effect-free WSDL walker built on `fast-xml-parser`.
- `springWsScanner.ts` — Signal A; detects class-level `@Endpoint` plus method-level `@PayloadRoot(namespace=..., localPart=...)`.
- `jaxWsScanner.ts` — Signal B; detects class-level `@WebService` plus method-level `@WebMethod`, including `@RequestWrapper.localName` and `@ResponseWrapper.localName` where present.
- `soapEndpointEmitter.ts` — merges all three signal streams, applies D-2 precedence per field, builds candidate payloads, emits the parent SOAP interface candidate.
- Match the existing REST emit path's conventions for regex / AST patterns, finding emission shape, and diagnostic log format.

**Signal pass behaviour (D-2 precedence)**
- Each of Signal A, B, C is independently sufficient — a service that has only annotations, only a WSDL, or both, all produce useful candidates.
- Split-source precedence merging in `soapEndpointEmitter.ts`:
  - **WSDL wins** for operation list, `request_root_element`, `request_namespace`, `response_root_element`.
  - **Annotations win** for `request_dto_class` and `response_dto_class` (annotations are the only source for fully-qualified Java class names).
- Merge happens per field, not per signal — never duplicate operations when A and C both describe the same one.

**WSDL parser scope (D-4)**
- New npm dependency `fast-xml-parser` added to `discovery-service/package.json`; lockfile refreshed as an explicit deliverable.
- Walker scope (deliberately narrow):
  - `wsdl:portType` operations + input/output message parts.
  - Message parts resolved back to `xsd:element` definitions.
  - Embedded `xsd:schema` top-level `xsd:element` and `xsd:complexType` signatures.
  - Relative `xsd:import` / `xsd:include` resolution (file-system relative paths within the repo); skip absolute URLs in v1, no network access.
  - Multi-port WSDLs IN SCOPE: when `wsdl:definitions` declares several `wsdl:port` bindings, iterate every port and emit candidates for each `port × operation` pair.
- Pure functions over parsed XML; no I/O beyond reading already-loaded source strings.
- Soft-fails on malformed WSDL — never throws; returns an empty operation list and a parse-error reason for the caller to translate into a finding.

**Interface candidate identity (D-1)**
- Layered naming rule in `soapEndpointEmitter.ts`, evaluated top-down, first match wins:
  1. `@WebService(name=...)` attribute on the class, when present.
  2. `@Endpoint` / `@WebService`-annotated class's **simple Java name** (no package prefix).
  3. Package name and namespace-derived names as **tiebreakers only** — used to disambiguate when two candidates would otherwise collide on the same display name.
- `springWsScanner.ts` and `jaxWsScanner.ts` MUST both expose the raw inputs (annotation attribute, simple class name, package, namespace) so the emitter applies the rule centrally.
- Parent SOAP interface candidate's `interface_type` field MUST be set to `'SOAP_API'`.

**Candidate output shape**
- `interface_id` — links to the parent SOAP interface candidate.
- `operation_verb` — literal `'POST'` (D-3); SOAP-over-HTTP is `POST` on the wire; the kind signal is carried by `soap_action` and the parent `interface_type='SOAP_API'`.
- `path_or_address` — servlet endpoint URL where the SOAP message lands (e.g., the Spring `MessageDispatcherServlet` mapping derived from `web.xml` or `WebApplicationInitializer`); nullable. When the URL cannot be inferred, leave it null and emit a `soap_endpoint_url_unknown` `evidence_gap` finding.
- New `data` fields:
  - `soap_action` — SOAP operation/action name.
  - `request_root_element` — root XML element name (Spring-WS `@PayloadRoot.localPart`, JAX-WS `@RequestWrapper.localName`, or WSDL message part).
  - `request_namespace` — XML namespace URI for the request.
  - `response_root_element` — root XML element name for the response.
  - `request_dto_class` — fully-qualified Java class name of the JAXB request type (annotation-derived).
  - `response_dto_class` — fully-qualified Java class name of the JAXB response type.
  - `wsdl_source` — repo-relative path to the source WSDL when Signal C contributed.

**Interface-type vocab audit (Q-8)**
- Audit task touching three layers to confirm `'SOAP_API'` flows end-to-end:
  1. discovery-service `interfaceTypeInference.ts` — confirm `'SOAP_API'` already supported.
  2. architecture-model-service — interface entity, DTO, repository — confirm `'SOAP_API'` round-trips through persistence and the API without coercion or stripping.
  3. frontend — interface-type filter dropdown (if any), badge / icon mapping in the Interfaces grid.
- Audit produces either a "confirmed end-to-end" note or one-line tasks to wire `'SOAP_API'` through wherever it falls out.

**AMS schema change — `protocol_metadata_json` column (D-5)**
- New Liquibase changeset (next free number after `137-discovery-runs-kind.sql`) adds a `protocol_metadata_json JSONB NULL` column to the AMS `endpoints` table.
- Never edit applied changesets per `feedback_liquibase_immutable_changesets.md`; only add a NEW changeset.
- All new SOAP `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) ride inside that JSONB blob.
- Extend `EndpointEntity` and the endpoint DTO with the JSONB field; PATCH-eligible companion fields stay boxed (`Boolean`, `Long`, `Double`) per `project_primitive_double_dto_overwrite.md`.
- Save-back path in `mcp-server/src/services/candidateSaveBackService.ts` `case 'endpoints'`: existing arm carries the new `data` fields into the JSONB column without further routing.
- Promotion to explicit columns is deferred to a future spec when the UI needs SOAP fields as sortable / filterable grid columns.

**New `evidence_gap` gapType sentinels (Q-9)**
- `gapType = 'soap_endpoint_url_unknown'` — emitted when the SOAP servlet mapping (e.g., `MessageDispatcherServlet`) cannot be inferred from `web.xml` / `WebApplicationInitializer`; the candidate is still emitted with `path_or_address=null`.
- `gapType = 'wsdl_parse_failed'` — emitted when the WSDL parser encounters malformed XML or unresolvable schema references; the gap finding carries the reason and the source path; the parser soft-fails.
- Both sentinels MUST be registered wherever `gapType` strings are centralised in the discovery service (the `evidence_gap` enum or constant table).
- Both sentinels MUST be asserted by tests in the test plan.

**AMVS pre-population helper plumbing**
- The Phase-A pre-population helper `synthesiseInventoryFromEndpoints` in `api-migration-validation-service/src/routes/captureSessionActions.ts` must read the following SOAP `data` fields off each candidate so the wizard's Step 4 renders meaningful rows:

  | `data` field           | Step 4 column / use                              |
  |------------------------|--------------------------------------------------|
  | `soap_action`          | Operation name column                            |
  | `request_root_element` | Request shape preview                            |
  | `request_namespace`    | XML namespace badge                              |
  | `response_root_element`| Response shape preview                           |
  | `request_dto_class`    | Java class hyperlink / "open in IDE" affordance  |
  | `response_dto_class`   | As above                                         |
  | `wsdl_source`          | "Source: <repo-relative path>" footer in row     |

- The candidate-side and AMVS-side field lists must match exactly — this enumeration is the contract between the discovery emitter and the wizard's pre-population pass.
- If the helper currently only reads REST-shaped fields and needs extending to surface `soap_action` / etc., the extension is a small explicit deliverable under this spec.

**Diagnostic logging conventions**
- Every new emit path produces structured `[diag-pack] scanner=spring_classic_soap ...` lines so the runbook can correlate.
- Log line shapes (enumerated):
  - Start: `[diag-pack] scanner=spring_classic_soap start files=<N>`
  - Per-signal emit: `[diag-pack] scanner=spring_classic_soap signal=<A|B|C> interface=<short-id> operations=<N>`
  - WSDL parse ok: `[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=<rel> operations=<N> ports=<N>`
  - WSDL parse fail: `[diag-pack] scanner=spring_classic_soap wsdl_parse=fail path=<rel> reason=<...>` (paired with a `wsdl_parse_failed` `evidence_gap` finding)
  - URL unknown: `[diag-pack] scanner=spring_classic_soap servlet_path=unknown interface=<short-id>` (paired with a `soap_endpoint_url_unknown` `evidence_gap` finding)

**Tests (enumerated as concrete test cases)**
- Signal A in isolation — fixture with `@Endpoint`/`@PayloadRoot` classes produces one candidate per method.
- Signal B in isolation — fixture with `@WebService`/`@WebMethod` classes produces one candidate per method.
- Signal C in isolation — fixture WSDL produces one candidate per `wsdl:operation` (uses `planning/visuals/reference-jaxws-document-literal-wrapped.wsdl`).
- A+C combined — when both signals exist for the same interface, D-2 precedence is honoured: operation list matches the WSDL even when annotations disagree on shape; DTO class names come through from the Java annotations even when the WSDL dominates; no duplicate candidates.
- SOAP-typed interface in every case — parent interface candidate has `interface_type='SOAP_API'` in every test above.
- Malformed WSDL — parser does NOT throw; a `wsdl_parse_failed` `evidence_gap` finding is emitted with reason + source path.
- Unresolvable servlet path — `soap_endpoint_url_unknown` `evidence_gap` finding emitted; candidate still emitted with `path_or_address=null`.
- Save-back round-trip — candidate carrying the new SOAP `data` fields lands on the AMS `endpoints` row's `protocol_metadata_json` column cleanly; round-trip read returns the same payload.
- D-1 layered naming rule pinned — a class annotated `@WebService(name="X")` in package `com.foo` with class `BarService` produces interface name `X`, not `BarService`, not `com.foo.BarService`.
- Multi-port WSDL — a `wsdl:definitions` with multiple `wsdl:port` bindings produces candidates for every `port × operation` pair.

## Visual Design

No frontend mockups supplied — the spec has no UI surface changes beyond Step 4 row pre-population fallout. Two public reference fixtures stand in for visual assets and anchor the parser fixtures plus acceptance tests.

**`planning/visuals/reference-spring-ws-countries.xsd`**
- Spring-WS contract-first XSD from `spring-guides/gs-producing-web-service`.
- Top-level elements `getCountryRequest` and `getCountryResponse`, namespace `https://spring.io/guides/gs-producing-web-service`.
- Anchors Signal A fixtures paired with an auto-generated WSDL flow.
- Validates the parser's handling of `targetNamespace`, `elementFormDefault="qualified"`, and `xs:simpleType` enumerations.

**`planning/visuals/reference-jaxws-document-literal-wrapped.wsdl`**
- JAX-WS document-literal-wrapped WSDL from `stefan-kolb/jaxws-samples`.
- Single `wsdl:portType` `GreetingsPortType` with one operation `greet`; embedded `<xsd:schema>` with `greet` / `greetResponse` element wrappers.
- Anchors Signal C parser tests and the Signal B + Signal C co-occurrence test.
- `soap:address location="http://localhost:8080/document-literal-wrapped/GreetingsService"` exercises servlet-path inference paths.

## Existing Code to Leverage

**`discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts`**
- Structural template for the new SOAP pass: regex / AST patterns, finding emission shape, diagnostic log format.
- The SOAP pass is invoked as a peer to the existing REST emit path within this file.
- The new `springClassicSoap/index.ts` is wired in here; no other call-site changes needed in the scanner runner.

**`api-migration-validation-service/src/routes/captureSessionActions.ts` — `synthesiseInventoryFromEndpoints`**
- Phase-A pre-population helper that reads candidate `data` fields and synthesises wizard Step 4 operation rows.
- Spec extends this helper to read the seven SOAP `data` fields (`soap_action`, `request_root_element`, `request_namespace`, `response_root_element`, `request_dto_class`, `response_dto_class`, `wsdl_source`) when the parent interface has `interface_type='SOAP_API'`.

**`mcp-server/src/services/candidateSaveBackService.ts` — `case 'endpoints'`**
- Existing save-back arm for endpoint candidates.
- New SOAP `data` fields ride through this arm into AMS via the new `protocol_metadata_json` JSONB column; arm logic extends only to forward the JSONB blob.

**`discovery-service/src/utils/.../interfaceTypeInference.ts`**
- Already supports `'SOAP_API'` alongside `REST_API` / `GRAPHQL_API` / etc.
- Q-8 audit confirms this; emitter sets `interface_type='SOAP_API'` directly when SOAP signals are present.

**`FindingEmitter` (from `2026-05-16-discovery-findings-first-class/`)**
- Used as-is for emitting `evidence_gap` findings with the two new `gapType` sentinels (`soap_endpoint_url_unknown`, `wsdl_parse_failed`).

## Out of Scope
- LLM-driven endpoint extraction for codebases that have neither annotations nor WSDLs — deferred to Phase 2 spec.
- Capture-loop LLM payload enrichment with per-operation payload metadata (WSDL schemas, JAXB DTO class sources) — deferred to Phase 2 spec.
- Wizard UI changes to Step 4 beyond what falls out of more rows being pre-populated — no new columns, no new badges, no layout changes.
- WS-Security metadata extraction.
- WS-Addressing metadata extraction.
- MTOM attachment handling.
- Apache CXF code-generation-specific patterns (e.g., generated artefacts under `target/generated-sources/cxf/`); JAX-WS annotations on hand-written sources are still picked up by Signal B.
- Promotion of SOAP `data` fields from `protocol_metadata_json` JSONB into explicit AMS columns — deferred to a future spec when the UI needs them as sortable / filterable grid columns.
- Absolute-URL `xsd:import` / `xsd:include` resolution (network fetch) — relative paths only in v1.
- New `operation_verb` vocabulary (e.g., adding `'SOAP'` as a sentinel); literal `'POST'` is retained per D-3.
