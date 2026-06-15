# Specification: Spec File Auto-Linking (Phase 3)

## Goal
Close the gap where the capture wizard's `parse-oas` action sees `interface.spec_link === null` on most interfaces even when discovery already saw the spec file on disk, by adding deterministic file-to-interface matching for both standalone OpenAPI spec files and WSDLs discovered by Phase 1's SOAP pass, and by teaching AMVS's `parseOasFromFile` to resolve repo-relative `spec_link` values via Phase 2's source endpoint.

## User Stories
- As an architect running discovery against a project containing `src/main/resources/openapi.yaml`, I want the matching REST interface candidate's `spec_link` set to that file's repo-relative path so the capture wizard auto-selects the spec in Step 1 and pre-populates Step 4 without me uploading anything.
- As an architect running discovery against a Spring Classic SOAP service that ships its `service.wsdl` alongside the code, I want the parent SOAP interface candidate's `spec_link` set to the WSDL's repo-relative path so the same auto-pickup flow works for SOAP as for REST.
- As a reviewer, I want spec-file ambiguity (two interfaces matching one spec, or one interface matching two specs) and orphan spec files surfaced as `evidence_gap` findings rather than silently guessed so I can intervene rather than chase a wrong default.

## Specific Requirements

**Scanner sub-module layout (P-1, P-12, P-13)**
- New folder `discovery-service/src/services/findings/packFindingScanners/specFileLinker/` mirroring Phase 1's `springClassicSoap/` convention.
- `index.ts` — public entry, registered as a stage of the existing pack-scanner pipeline, invoked AFTER framework adapters have produced their interface candidates so the linker has the candidates to match against.
- Pure functions over already-loaded source strings plus `js-yaml` / `JSON.parse`; no I/O beyond reads the pipeline already does.
- Colocated test file `specFileLinker.test.ts`. Phase 1's `soapEndpointEmitter.test.ts` gets a small extension for the WSDL `spec_link` promotion (Workstream B).

**Workstream A — Standalone OAS spec file discovery (P-2, P-15, P-17)**
- Walks three scopes, in order: `src/main/resources/**/*.{yaml,yml,json}`, the root of `src/main/resources/`, and the project root.
- Service-root scoping per P-17 — files outside the run's target service root are NOT scanned; cross-service spec sharing in a monorepo emits `oas_spec_orphan` when no in-scope interface matches.
- File-signature detection — file qualifies if any of:
  - Top-level `openapi:` key with any 3.x value.
  - Top-level `swagger: '2.0'` key.
  - Has the `info.title` + `info.version` + `paths` shape.
- YAML parsed via `js-yaml` (new dependency added to `discovery-service/package.json` if not already present; lockfile refresh is an explicit deliverable). JSON parsed via `JSON.parse`.
- Match priority order, first match wins; once matched, lower-priority heuristics are NOT consulted for that interface:
  1. `info.title` exact match against an interface candidate's `name`.
  2. `paths` base-prefix match against the interface's `data.basePath` (Spring Boot adapter already captures this).
  3. springdoc `@Tag(name=...)` match against the interface's `data.openApiTag`.
- On unique match: set `interface.spec_link = <repo-relative-path>` and emit `[diag-pack] scanner=spec_file_linker match=ok ...`.
- Ambiguity and orphan cases emit `evidence_gap` findings — never guess.

**Workstream B — Promote WSDL paths to SOAP `spec_link` (P-3)**
- Extends Phase 1's `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`.
- When the emitter has a WSDL matched to a parent interface candidate, set that interface's `spec_link` to the WSDL's repo-relative path. The endpoint-level `data.wsdl_source` from Phase 1 stays as-is for per-operation context — both fields coexist.
- Match strategy: exact, byte-for-byte WSDL `definitions.targetNamespace` against the namespace recorded on the parent interface (Phase 1 captures `data.request_namespace` on endpoint candidates; the parent interface inherits this). No fuzzy matching, no case-insensitive matching, no trailing-slash tolerance.
- Same evidence-gap sentinels as Workstream A for ambiguous / orphan WSDL cases.

**`spec_link` value semantics and idempotence (P-6, P-8, P-16)**
- All discovery-set `spec_link` values are repo-relative paths, matching the Phase 2 source-endpoint convention.
- Pre-existing non-null `spec_link` is NEVER overwritten — user's manual choice always wins; skip + log `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<discovered>`.
- Re-runs are idempotent for existing matches; new matches set new candidates' fields; re-runs never DELETE `spec_link` values.
- Absolute paths remain valid on legacy manual-upload rows; existing rows are NOT touched.

**New `evidence_gap` gapType sentinels (P-4, P-5, P-14)**
- `gapType = 'oas_spec_ambiguous_match'` — emitted when multiple interfaces match the same spec, OR multiple specs match the same interface. Leave `spec_link` null on ALL involved candidates. Log all candidate IDs at `[diag-pack]` level.
- `gapType = 'oas_spec_orphan'` — emitted when a spec file is discovered but no in-scope interface candidate matches. Record the file path on the gap. Do NOT create a new interface candidate from a spec file alone.
- Dedicated builder functions added to `discovery-service/src/services/findings/emissionSources.ts` alongside Phase 1's `soap_endpoint_url_unknown` and `wsdl_parse_failed` builders:
  - `buildOasSpecAmbiguousGap(input)`
  - `buildOasSpecOrphanGap(input)`
- Both sentinels MUST be registered wherever `gapType` strings are centralised and MUST be asserted by tests.

**Workstream C — Wizard auto-pickup via Phase 2's source endpoint (P-7, P-11)**
- Modify `parseOasFromFile` in `api-migration-validation-service/src/services/oasParser.ts` (confirm exact path during implementation per P-11).
- Single function with internal branching on path shape — no new public function:
  - `path.isAbsolute(spec_link)` → existing local `fs.readFile` path (back-compat for legacy absolute-path values).
  - Repo-relative → fetch via Phase 2's source endpoint `GET /discovery/projects/:p/architectures/:a/runs/:r/source/*` through a private helper.
- The capture session must carry the discovery run id (Phase 2 wired this in `OrchestratorDeps`) so the source-endpoint fetch knows which clone to read from.
- The wizard's `parse-oas` action already reads `interface.spec_link` — no wizard-side code change needed; the new `spec_link` values are picked up automatically.

**Diagnostic logging conventions (P-10)**
- Every log line produced by the new scanner uses prefix `[diag-pack] scanner=spec_file_linker ...`, mirroring Phase 1's `scanner=spring_classic_soap` convention.
- Enumerated line shapes:
  - Start: `[diag-pack] scanner=spec_file_linker start files_scanned=<N> interfaces_in_scope=<N>`
  - Per-file scan: `[diag-pack] scanner=spec_file_linker file=<rel-path> signature=<openapi3|swagger2|info-paths|none>`
  - Match found: `[diag-pack] scanner=spec_file_linker match=ok interface=<short-id> path=<rel-path> heuristic=<title|base_path|tag>`
  - Ambiguity skipped: `[diag-pack] scanner=spec_file_linker match=ambiguous candidates=[<id>,<id>,...] path=<rel-path>` (paired with `oas_spec_ambiguous_match` finding)
  - Orphan skipped: `[diag-pack] scanner=spec_file_linker match=orphan path=<rel-path>` (paired with `oas_spec_orphan` finding)
  - Pre-existing-link skipped: `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<discovered>`

**Tests (enumerated as concrete test cases)**
- *Workstream A — OAS YAML file signature detection (positive)*: a file with top-level `openapi: 3.0.0` qualifies; a file with `info.title`+`info.version`+`paths` shape qualifies; a file with `swagger: '2.0'` qualifies.
- *Workstream A — OAS YAML file signature detection (negative)*: a YAML file that lacks all three signature shapes is NOT scanned for matches.
- *Workstream A — OAS JSON file signature detection*: a `.json` file with `openapi: '3.0.0'` qualifies; parsed via `JSON.parse`; one candidate `spec_link` set to its repo-relative path.
- *Workstream A — title-match priority*: when `info.title` exactly equals an interface candidate's `name`, that interface wins even if a different interface's `basePath` would also match.
- *Workstream A — base-path-match priority*: with no title match, the spec's `paths` base prefix matches the interface's `data.basePath`; that interface wins.
- *Workstream A — tag-name-match priority*: with no title or base-path match, a springdoc `@Tag(name=...)` value matches the interface's `data.openApiTag`; that interface wins.
- *Workstream A — ambiguous match*: two interfaces match the same spec via base-path → one `evidence_gap` with `gapType='oas_spec_ambiguous_match'`; both involved candidates left with `spec_link=null`.
- *Workstream A — orphan spec*: a qualifying spec file with no matching in-scope interface → one `evidence_gap` with `gapType='oas_spec_orphan'`; no new interface candidate created.
- *Workstream A — pre-existing `spec_link` skip*: an interface with non-null `spec_link` already set is NEVER overwritten; one `spec_link_skipped` log line emitted.
- *Workstream A — service-root scoping*: a spec file outside the run's target service root in a monorepo is ignored (not scanned, not matched, not orphaned for cross-scope service candidates).
- *Workstream B — WSDL namespace exact match*: a WSDL whose `definitions.targetNamespace` exactly matches an interface's `data.request_namespace` → that interface's `spec_link` set to the WSDL's repo-relative path; endpoint-level `data.wsdl_source` preserved.
- *Workstream B — ambiguous WSDL*: a WSDL whose `targetNamespace` matches two parent interfaces → `evidence_gap` with `gapType='oas_spec_ambiguous_match'`; both interfaces left with `spec_link=null`.
- *Workstream B — orphan WSDL*: a WSDL whose `targetNamespace` matches no in-scope interface → `evidence_gap` with `gapType='oas_spec_orphan'`.
- *Workstream C — branch on `path.isAbsolute()`*: `parseOasFromFile` called with a repo-relative `spec_link` value routes through the source-endpoint helper; called with an absolute path routes through `fs.readFile`.
- *Workstream C — repo-relative resolves via source endpoint*: a repo-relative `spec_link` triggers `GET /discovery/projects/:p/architectures/:a/runs/:r/source/<path>`; the fetched body is parsed by the existing OAS parser path.
- *Workstream C — absolute path uses local `fs.readFile`*: a legacy absolute `spec_link` value still parses via the local-read code path (back-compat regression guard).
- *End-to-end fixture test*: in-memory fixture repo containing `reference-springdoc-petstore.yaml` and a Spring Boot interface candidate with matching `data.basePath` produces one interface candidate with `spec_link` set; AMVS `parseOasFromFile` (Workstream C) fetches the file via the source endpoint and parses successfully.

## Visual Design
No frontend mockups supplied. Four reference fixtures stand in for visual assets and anchor the parser fixtures plus acceptance tests.

**`agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-spring-ws-countries.xsd`** (reused from Phase 1)
- Spring-WS contract-first XSD; namespace `https://spring.io/guides/gs-producing-web-service`.
- Anchors Workstream B's namespace-match flow when paired with the JAX-WS reference WSDL.

**`agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-jaxws-document-literal-wrapped.wsdl`** (reused from Phase 1)
- JAX-WS document-literal-wrapped WSDL; single `GreetingsPortType` operation.
- Anchors Workstream B happy-path (namespace exact match) and orphan-WSDL (namespace mismatch) tests.

**`planning/visuals/reference-springdoc-petstore.yaml`** (new under THIS spec)
- OpenAPI 3.0 YAML fixture; exercises Workstream A's title + base-path + tag-name match heuristics (one file covers all three priorities by carrying matching values for each).
- Drives the end-to-end fixture test and the three priority-order test cases.

**`planning/visuals/reference-springdoc-petstore.json`** (new under THIS spec)
- Minimal OpenAPI 3.0 JSON variant of the YAML fixture.
- Drives the JSON parse-path test case to ensure `JSON.parse` and `js-yaml` paths both work.

## Existing Code to Leverage

**`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/` (Phase 1)**
- Folder layout, `index.ts` public-entry pattern, and colocated test file convention copied directly to the new `specFileLinker/` folder.
- `soapEndpointEmitter.ts` extended with the WSDL `spec_link` promotion for Workstream B — small additive change, same emitter function.

**`discovery-service/src/services/findings/emissionSources.ts`**
- Phase 1 added builders for `'soap_endpoint_url_unknown'` and `'wsdl_parse_failed'`; Phase 2 added `'llm_endpoint_extract_malformed'` (in its own spec but same file).
- This spec adds `buildOasSpecAmbiguousGap(...)` and `buildOasSpecOrphanGap(...)` alongside, matching the existing builder shape.

**`discovery-service/src/routes/source.ts` (Phase 2)**
- The `GET /discovery/projects/:p/architectures/:a/runs/:r/source/*` endpoint is reused as-is by Workstream C's private helper inside `parseOasFromFile`. No route changes needed.
- Inherits Phase 2's auth posture, path-traversal rejection, and 410-Gone cache-eviction behaviour.

**`api-migration-validation-service/src/services/oasParser.ts` (`parseOasFromFile`)**
- Single existing function extended with internal branching on `path.isAbsolute(spec_link)`. No new public function; no wizard-side change.
- Capture session already carries the discovery run id via Phase 2's `OrchestratorDeps` — the new helper reads it from there.

**Spring Boot adapter `data.basePath` / `data.openApiTag` capture**
- The Spring Boot framework adapter already records `basePath` (from `@RequestMapping` on the controller class) and `openApiTag` (from springdoc `@Tag` annotation) on interface-candidate `data`. Workstream A's matching heuristics consume these fields directly — no new capture step in the adapter.

## Out of Scope
- LLM-assisted matching when deterministic heuristics fail — Phase 4 territory.
- Spec-file content validation against OpenAPI / WSDL XSD — already handled by `parse-oas`.
- Storing spec file contents in AMS as a separate entity — file lives in discovery-service cache and is fetched on demand via the Phase 2 source endpoint.
- Multi-file OAS spec resolution (specs that `$ref` external YAML files) — emit `evidence_gap` instead.
- XSD-only files without a parent WSDL — they enrich the WSDL flow when paired but have no interface owner on their own.
- AsyncAPI specs, gRPC `.proto` files, GraphQL SDL files — future phases if they materialise.
- Creating new interface candidates from orphan spec files — would conflict with adapter-driven candidate identity.
- Overwriting any pre-existing non-null `spec_link` — user's manual choice always wins.
- Wizard UI changes — the wizard already reads `interface.spec_link`; no Step 1 or Step 4 layout changes needed.
