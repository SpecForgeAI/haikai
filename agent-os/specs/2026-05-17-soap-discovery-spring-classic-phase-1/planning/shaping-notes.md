# Shaping Notes — Phase 1: SOAP service discovery in Spring Classic

Spec path: `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/`
Raw idea: `planning/raw-idea.md`
Shaping status: **COMPLETE** — all open design points resolved; ready for `/write-spec`.

---

## 1. Resolved open design points

Every open design point from the raw idea has been resolved. The user
accepted the recommended default on each item; the resolutions below
are the authoritative inputs for `spec.md`.

### D-1 — Interface candidate identity (annotations-only)

**Resolution:** Layered naming rule, evaluated top-down, first match wins:

1. `@WebService(name=...)` attribute on the class, when present.
2. `@Endpoint` / `@WebService` annotated class's **simple Java name**
   (no package prefix).
3. Package name and namespace-derived names are **tiebreakers only** —
   used to disambiguate when two candidates would otherwise collide on
   the same display name.

**Implications for `spec.md`:**
- `springWsScanner.ts` and `jaxWsScanner.ts` must both expose the raw
  inputs (annotation attribute, simple class name, package, namespace)
  so `soapEndpointEmitter.ts` can apply the layered rule centrally.
- A unit test should pin the rule: a class annotated `@WebService(name="X")`
  in package `com.foo` with class `BarService` produces interface name
  `X` — not `BarService`, not `com.foo.BarService`.

### D-2 — Precedence when WSDL and annotations both describe the same service

**Resolution:** Split-source precedence:

- **WSDL wins** for the operation list and XML signatures
  (`request_root_element`, `request_namespace`, `response_root_element`).
- **Annotations win** for `request_dto_class` and `response_dto_class`
  — annotations are the only source for fully-qualified Java class
  names.

**Implications for `spec.md`:**
- `soapEndpointEmitter.ts` merges three signal streams and applies the
  precedence rule per field, not per signal.
- An A+C combined test must assert both halves of the rule: the
  operation list matches the WSDL even when annotations disagree on
  shape, AND the DTO class names come through from the Java annotations
  even when the WSDL is the dominant source for everything else.

### D-3 — SOAP `operation_verb` vocabulary

**Resolution:** Keep the literal `'POST'`.

SOAP-over-HTTP is `POST` on the wire. The kind signal is carried
elsewhere:
- `soap_action` on the candidate's `data` blob, and
- the parent `interface_type = 'SOAP_API'`.

No cross-cutting vocab change in Phase 1; the wizard's verb column
needs no changes, and the existing REST-shaped grid renders SOAP
candidates without modification.

### D-4 — WSDL parser library

**Resolution:** Roll-our-own minimal WSDL walker built on
[`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser).

**`fast-xml-parser` is a NEW npm dependency added by this spec** —
the current `discovery-service/package.json` has no XML parser. The
spec must include the package.json bump and a lockfile refresh as
explicit deliverables.

**Walker scope (v1):**
- `wsdl:portType` operations.
- Message parts and their `xsd:element` references.
- Embedded `xsd:schema` top-level `xsd:element` and `xsd:complexType`
  signatures.
- Relative `xsd:import` / `xsd:include` resolution (file-system
  relative paths within the repo only). Absolute URLs are skipped in
  v1 — no network fetch.
- **Multi-port WSDLs IN SCOPE:** when a single `wsdl:definitions`
  declares several `wsdl:port` bindings, iterate every port.

**Properties:**
- Side-effect-free; pure function over parsed XML.
- Soft-fails on malformed WSDL — never throws; emits an
  `evidence_gap` finding instead (see Q-9).

### D-5 — AMS schema strategy

**Resolution:** Single `protocol_metadata_json` JSONB column on the AMS
`endpoints` table, added via a NEW Liquibase changeset.

**Promotion to explicit columns** is deferred to a future spec, to be
opened when the UI needs the SOAP fields as sortable / filterable grid
columns.

**Mandatory spec deliverable:** the spec must **enumerate by name**
which `data` fields the AMVS Phase-A pre-population helper
(`synthesiseInventoryFromEndpoints` in
`api-migration-validation-service/src/routes/captureSessionActions.ts`)
needs to read off the candidate's `data` so the wizard's Step 4
renders meaningful rows. The candidate-side and AMVS-side field lists
must match exactly — this enumeration is the contract between the
discovery emitter and the wizard's pre-population pass.

**Initial enumeration** (to be confirmed and made authoritative in `spec.md`):

| `data` field           | Source signal(s)        | Purpose at Step 4                                |
|------------------------|-------------------------|--------------------------------------------------|
| `soap_action`          | A / B / C               | Operation name column                            |
| `request_root_element` | A (`@PayloadRoot.localPart`) / B (`@RequestWrapper.localName`) / C (message part → xsd:element) | Request shape preview |
| `request_namespace`    | A / C                   | XML namespace badge                              |
| `response_root_element`| A / B / C               | Response shape preview                           |
| `request_dto_class`    | A / B (annotation only) | Java class hyperlink / "open in IDE" affordance  |
| `response_dto_class`   | A / B (annotation only) | As above                                         |
| `wsdl_source`          | C                       | "Source: <repo-relative path>" footer in row     |

---

## 2. Additional shaping decisions

### Q-6 — Reference repository

The user has **no local Spring Classic SOAP service** to anchor
acceptance tests against. Phase 1 uses **public reference WSDLs/XSDs**
materialised as fixture files instead.

Two excerpts have already been downloaded into `planning/visuals/`
(see Section 4 — Visual / reference assets).

The spec's acceptance test plan must explicitly state that fixtures
are derived from public references rather than a private repo, and
the fixture-load tests run against bundled fixture files (not network
fetches).

### Q-7 — Scanner file structure

A new sub-module folder under the existing scanner directory:

```
discovery-service/src/services/findings/packFindingScanners/
    springClassicSoap/
        index.ts                -- public entry, invoked from
                                   springClassicFindingScanner.ts
        wsdlParser.ts           -- pure WSDL walker (D-4 scope)
        springWsScanner.ts      -- Signal A (@Endpoint / @PayloadRoot)
        jaxWsScanner.ts         -- Signal B (@WebService / @WebMethod)
        soapEndpointEmitter.ts  -- merges all three signals, applies
                                   D-2 precedence, emits candidates
```

`springClassicFindingScanner.ts` invokes the new `springClassicSoap/index.ts`
entry point as a peer pass alongside the existing REST emit path. The
existing REST emit path is the **structural template** — the SOAP pass
should match its conventions for regex / AST patterns, finding
emission shape, and diagnostic log format.

### Q-8 — Interface-type vocab audit

The spec must bundle a small audit task that touches the three layers
where `interface_type` could go wrong:

1. **discovery-service** — `interfaceTypeInference.ts` (the raw idea
   already states `'SOAP_API'` is supported; confirm by reading).
2. **architecture-model-service** — the interface entity and DTO; check
   that `'SOAP_API'` round-trips through persistence and the API
   without being coerced or stripped.
3. **frontend** — the interface-type filter dropdown (if any), and any
   badge / icon mapping in the Interfaces grid.

The audit must produce either a "confirmed end-to-end" note or a
one-line task to wire `'SOAP_API'` through wherever it falls out.

### Q-9 — New `evidence_gap` `gapType` sentinels

The spec must call out as **discrete deliverables**:

- `gapType = 'soap_endpoint_url_unknown'` — emitted when the SOAP
  servlet mapping (e.g., `MessageDispatcherServlet`) cannot be
  inferred from `web.xml` / `WebApplicationInitializer`. The
  candidate is still emitted; `path_or_address` is left null.
- `gapType = 'wsdl_parse_failed'` — emitted when the WSDL parser
  encounters malformed XML or unresolvable schema references.
  The parser soft-fails; the gap finding carries the reason and the
  source path.

Both sentinels need:
- Definition / registration in the `evidence_gap` enum or constant
  table (wherever `gapType` strings are centralised in the discovery
  service).
- An assertion in the test plan.

### Q-10 — Out-of-scope edges (in addition to Phase 2 carve-outs)

Already excluded by raw-idea Phase 2 carve-outs: LLM fallback,
capture-loop LLM payload enrichment, Step 4 UI changes beyond row
pre-population.

**Additional out-of-scope items for Phase 1:**
- WS-Security metadata — **OUT**.
- WS-Addressing metadata — **OUT**.
- MTOM attachments — **OUT**.
- Apache CXF code-generation-specific patterns (e.g., generated
  artefacts under `target/generated-sources/cxf/`) — **OUT**. JAX-WS
  annotations on hand-written sources are still picked up by
  Signal B; the CXF-specific tooling output is not scanned.

**IN scope (reiterated, since this is the one edge that flips IN):**
- **Multi-port WSDLs** (a single `wsdl:definitions` declaring several
  `wsdl:port` bindings) — iterate every port; emit candidates for
  each port × operation pair.

---

## 3. Existing code reuse pointers

The user did not flag similar features explicitly; the following are
the structural references the spec-writer should anchor against.

| Reference                                                                                    | Role for this spec                                                                                              |
|----------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts` | Structural template for the SOAP pass: regex / AST patterns, finding emission conventions, diag log format.     |
| `api-migration-validation-service/src/routes/captureSessionActions.ts` → `synthesiseInventoryFromEndpoints` | The Phase-A pre-population helper that reads candidate `data` fields. Spec must enumerate the SOAP fields it consumes. |
| `mcp-server/src/services/candidateSaveBackService.ts` (`case 'endpoints'`)                   | Existing save-back arm for endpoint candidates; new `data` fields ride through here into AMS.                   |
| `discovery-service/src/utils/.../interfaceTypeInference.ts`                                  | Where `'SOAP_API'` already lives; audit confirms end-to-end honour (Q-8).                                       |

**No existing WSDL or XML parsing in `discovery-service`** — the new
walker is a clean addition, not a refactor of an existing parser.

---

## 4. Visual / reference assets

The user supplied **no frontend mockups** — no Step 4 screenshots, no
Interfaces grid sketch, no data-flow diagram. The visual section of
the spec is "none supplied."

In their place, two public reference fixtures have been downloaded
into `planning/visuals/` to anchor the parser fixtures and acceptance
tests.

### Downloaded reference fixtures (canonical for this spec)

| File                                                              | Source URL                                                              | Tests                                                                                       |
|-------------------------------------------------------------------|-------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `planning/visuals/reference-spring-ws-countries.xsd`              | https://github.com/spring-guides/gs-producing-web-service               | Signal A (`@Endpoint` / `@PayloadRoot`) paired with an auto-generated WSDL flow.            |
| `planning/visuals/reference-jaxws-document-literal-wrapped.wsdl`  | https://github.com/stefan-kolb/jaxws-samples                            | Signal C (WSDL parsing) and Signal B (`@WebService` / `@WebMethod`) co-occurrence.          |

### Additional public references (no download required at shaping time)

The spec-writer can consult these to size edge-case handling; none
need to be vendored into `planning/visuals/`:

- `stefan-kolb/jaxws-samples` — multiple WSDL styles in one repo
  (rpc-encoded, rpc-literal, document-literal, document-literal-wrapped).
  Use to size the WSDL parser's style-handling matrix.
- `jonashackt/soap-spring-boot-cxf` — Spring Boot + Apache CXF + JAX-WS.
  Useful for Signal B with multi-namespace WSDLs.
- `revinate/jaxws-spring` — JAX-WS + Spring legacy integration.
- `rasato/jax-ws-sample-client` — minimal JAX-WS client/server WSDL.

---

## 5. Spec-writer hand-off checklist

Items the spec-writer MUST surface explicitly in `spec.md`:

- [ ] D-1 layered naming rule with concrete fall-through order.
- [ ] D-2 split-source precedence (per field, not per signal).
- [ ] D-3 `operation_verb='POST'` decision rationale referenced near
      the candidate-shape section.
- [ ] D-4 new npm dependency on `fast-xml-parser` — listed as a
      deliverable, with `package.json` and lockfile updates called out.
- [ ] D-4 multi-port WSDL handling in the parser scope.
- [ ] D-5 `protocol_metadata_json` JSONB column + new Liquibase
      changeset.
- [ ] D-5 explicit enumeration of `data` fields consumed by
      `synthesiseInventoryFromEndpoints`.
- [ ] Q-7 sub-module folder layout with the five named files.
- [ ] Q-8 interface-type vocab audit task (discovery / AMS / frontend).
- [ ] Q-9 two new `gapType` sentinels (`soap_endpoint_url_unknown`,
      `wsdl_parse_failed`) — definition + test assertion.
- [ ] Q-10 out-of-scope list (WS-Security, WS-Addressing, MTOM, CXF
      generated sources) AND the one in-scope flip (multi-port WSDLs).
- [ ] Acceptance fixture provenance — fixtures derived from the two
      downloaded reference files, not a private repo.

No outstanding decisions remain. Shaping pass complete.
