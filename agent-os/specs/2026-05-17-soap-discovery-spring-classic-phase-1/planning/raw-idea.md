# Raw idea — Phase 1: SOAP service discovery in Spring Classic

## Why this spec exists

The discovery-service's Spring Classic framework adapter
(`discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts`)
recognises Spring MVC (`@Controller` / `@RequestMapping`) and emits one
`endpoints` candidate per REST controller method. It is silent on every
SOAP-style pattern. A real Spring Classic SOAP service on the user's
machine produced **zero** endpoint candidates from a discovery run; the
api-migration-validation-service (AMVS) capture wizard's Step 4 therefore
has nothing to pre-populate for that service, even after the recently-
shipped Phase A pre-population helper (which reads `endpoints` candidates
linked to an interface and synthesises operation rows for the wizard).

Phase 1 closes that gap **deterministically**, using structural signals
already present in the codebase. A future Phase 2 spec will add an LLM
fallback for non-conforming codebases AND enrich the capture loop's LLM
with per-operation payload metadata. Phase 2 is explicitly **not** part
of this spec.

## In scope (Phase 1)

A new SOAP-aware pass inside the Spring Classic finding scanner that
emits endpoint candidates from three deterministic signals. Each signal
is independently sufficient — a service that has only annotations, or
only a WSDL, or both, all produce useful candidates.

### Signal A — Spring-WS annotations

Class-level `@Endpoint` plus method-level `@PayloadRoot(namespace=...,
localPart=...)`. One endpoint candidate per `@PayloadRoot`-annotated
method. This is the most common SOAP-in-Spring-Classic pattern.

### Signal B — JAX-WS annotations

`@WebService` on the class, `@WebMethod` on each method. One endpoint
candidate per method. Sometimes layered under Apache CXF; the annotations
themselves are JAX-WS standard.

### Signal C — WSDL files

`.wsdl` files in `src/main/resources/` (and conventional sibling
locations under the service module). The WSDL is the authoritative
operation list when present — contract-first SOAP projects rely on it.
Embedded `<xsd:schema>` blocks are parsed for type signatures;
externally-referenced `.xsd` imports follow relative paths within the
repo when present.

## Output shape — endpoint candidates

Each emitted candidate carries:

- `interface_id` linking to a SOAP-typed interface candidate. The
  interface candidate's `interface_type` field MUST be set to
  `'SOAP_API'` (the existing vocab in
  `discovery-service/src/utils/.../interfaceTypeInference.ts` already
  supports this value alongside REST_API / GRAPHQL_API / etc.).
- `operation_verb` -- the wizard's verb column. See open design point
  D-3 below.
- `path_or_address` -- the servlet endpoint URL where the SOAP message
  lands (e.g., the Spring `MessageDispatcherServlet` mapping derived
  from `web.xml` or `WebApplicationInitializer`). When the URL can't
  be inferred, leave it null and emit an `evidence_gap` finding
  (`gapType='soap_endpoint_url_unknown'`) rather than fabricating a
  value.
- New `data` fields surfaced through the model layer:
  - `soap_action`            -- SOAP operation/action name.
  - `request_root_element`   -- root XML element name (Spring-WS
                                `@PayloadRoot.localPart`, JAX-WS
                                `@RequestWrapper.localName`, or
                                WSDL message part).
  - `request_namespace`      -- XML namespace URI for the request.
  - `response_root_element`  -- root XML element name for the response.
  - `request_dto_class`      -- fully-qualified Java class name of the
                                JAXB request type (when derivable
                                from annotations).
  - `response_dto_class`     -- same for response.
  - `wsdl_source`            -- repo-relative path to the source WSDL
                                when Signal C contributed.

## WSDL parsing

Lives in the discovery-service (TypeScript) so the WSDL data flows to
both AMVS and the architecture model from a single source of truth (per
the design discussion 2026-05-17). The parser MUST:

- Tolerate malformed WSDLs by emitting `evidence_gap` findings rather
  than throwing.
- Walk `wsdl:portType` operations and resolve their input / output
  message parts back to `xsd:element` definitions.
- Parse embedded `<xsd:schema>` blocks for top-level element and
  complex-type signatures (enough to populate `request_root_element`,
  `request_namespace`, and `response_root_element`).
- Follow `<xsd:import>` / `<xsd:include>` references whose `schemaLocation`
  is a relative path within the repo (skip absolute URLs in v1).
- Stay deterministic and side-effect-free: pure functions over
  parsed XML; no network access.

## Save-back implications

The save-back service (`mcp-server/src/services/candidateSaveBackService.ts`)
already has a switch arm for `case 'endpoints'`. Confirm during writing
which of the new `data` fields require AMS schema columns vs which can
ride inside a JSONB blob. If the AMS `endpoints` table is missing fields
the spec must include a Liquibase changeset to add them. See open
design point D-5 below.

## Diagnostic logging

Every new emit path produces structured `[diag-pack]
scanner=spring_classic_soap ...` lines so the runbook can correlate:

- `[diag-pack] scanner=spring_classic_soap start files=<N>`
- `[diag-pack] scanner=spring_classic_soap signal=<A|B|C>
  interface=<short-id> operations=<N>`
- `[diag-pack] scanner=spring_classic_soap wsdl_parse=<ok|fail>
  path=<rel> reason=<...>` (fail line + a paired `evidence_gap` finding)

## Tests (in scope)

- Signal A in isolation: a fixture with `@Endpoint`/`@PayloadRoot`
  classes produces one candidate per method.
- Signal B in isolation: a `@WebService`/`@WebMethod` fixture produces
  one candidate per method.
- Signal C in isolation: a fixture WSDL produces one candidate per
  `wsdl:operation`.
- A+C combined: when both signals exist for the same interface, the
  precedence rule (see open design point D-2) is honoured and
  candidates are not duplicated.
- SOAP-typed interface inference: the parent interface candidate has
  `interface_type = 'SOAP_API'` in every test above.
- Malformed WSDL: the parser does NOT throw; an `evidence_gap` finding
  appears in the run with the right `gapType`.
- Save-back wiring: a `physical_data_attributes`/`endpoints` shaped
  candidate carrying the new SOAP `data` fields round-trips into AMS
  cleanly, with the new fields surfacing on the persisted entity row.

## Explicitly NOT in scope (Phase 2 spec)

- LLM-driven endpoint extraction for codebases that have neither
  annotations nor WSDLs. Until Phase 2 ships, those services still
  fall through to "0 operations, manual entry" in the wizard.
- Enriching AMVS's capture-loop LLM with per-operation payload
  metadata (WSDL schemas, JAXB DTO class sources). Phase 2's job.
- UI changes to the wizard's Step 4 beyond what falls out of more
  rows being pre-populated.

## Open design points to surface during shaping

These are the calls the user needs to make before write-spec produces
the final spec.md:

- D-1 Interface candidate identity (annotations-only). When no WSDL is
  present, how do we name the parent interface candidate? Options:
  the `@Endpoint`-annotated class name, the `@WebService(name=...)`
  attribute, the class's package, a derivation from `@PayloadRoot`
  namespace, or a different deterministic rule entirely.

- D-2 Precedence when WSDL and annotations agree on the same service.
  Recommended default: WSDL wins for operation list + XML
  signatures; annotations win for `request_dto_class` /
  `response_dto_class` (annotations are the only source for the Java
  class names).

- D-3 SOAP `operation_verb` vocabulary. Options: keep as literal
  `'POST'` (REST-compatible, the wizard's verb column needs no
  changes), or add a new sentinel like `'SOAP'` (kind is explicit,
  but the column vocab grows). Recommended default: keep `'POST'`;
  the new `soap_action` field on `data` disambiguates SOAP rows.

- D-4 WSDL parser library. Options: roll-our-own minimal XML walker
  (no new npm deps, we own all edge cases), or pull an off-the-shelf
  parser like `wsdlrdr` / `soap`. Recommended default: minimal walker
  built on the project's existing XML parser (e.g., `fast-xml-parser`
  if present); the WSDL surface we need (operations + message parts
  + embedded xsd:elements) is small and well-defined.

- D-5 AMS schema extension. Options: add explicit columns for the
  SOAP fields (`soap_action`, `request_root_element`, etc.) on the
  `endpoints` table, OR stuff the SOAP-specific bits into a single
  `protocol_metadata_json` JSONB column. Recommended default: JSONB
  blob for now (faster to land, no migration risk on existing
  endpoint rows), promoted to explicit columns later when the UI
  needs them in grids. The spec should still call out which
  fields the AMVS pre-population helper needs to read off the
  candidate's `data` so the wizard renders meaningful rows.

## Acceptance signal

- The user's reference Spring Classic SOAP service produces non-zero
  endpoint candidates that match the WSDL's operation list 1:1 after
  this spec ships.
- The capture wizard's Step 4 pre-population fills the SOAP
  interface's operation grid without manual entry.
- The architecture model's Interfaces grid shows the SOAP service
  with `interface_type = 'SOAP_API'`.
