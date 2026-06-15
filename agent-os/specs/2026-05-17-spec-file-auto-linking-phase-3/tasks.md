# Task Breakdown: Spec File Auto-Linking (Phase 3)

## Overview
Total Task Groups: 8
Total Tasks: ~45 (across 8 groups)

This spec closes the gap where the capture wizard's `parse-oas` action sees `interface.spec_link === null` even when discovery already saw the spec file on disk. The 8 task groups below are ordered so each group can be built and verified in isolation:

- Groups 1-2 build the foundation: YAML parser dependency, new `evidence_gap` sentinels, and the two new OAS test fixtures.
- Groups 3-4 implement Workstream A — the new `specFileLinker` standalone scanner and its pipeline wiring.
- Group 5 implements Workstream B — promoting the WSDL path onto SOAP interface `spec_link` inside Phase 1's existing emitter.
- Group 6 implements Workstream C — AMVS `parseOasFromFile` branch on `path.isAbsolute()` to resolve repo-relative `spec_link` values via Phase 2's source endpoint.
- Group 7 is the end-to-end fixture acceptance test.
- Group 8 is the inline header documentation deliverable.

## Standing Constraints (apply to every group)

- Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets. No AMS schema change is in scope for this spec — `spec_link` already exists on the AMS interface row.
- Per `feedback_no_src_edits_during_run.md`: no edits to `discovery-service/src/**` while a discovery run is active.
- Per `project_primitive_double_dto_overwrite.md`: any DTO field participating in PATCH semantics MUST be boxed with null guards. The `spec_link` field is already a nullable `String` — preserve PATCH null-guard semantics anywhere the field is written.
- All new structured log lines from the scanner use the prefix `[diag-pack] scanner=spec_file_linker ...`, mirroring Phase 1's `scanner=spring_classic_soap` convention.
- Pre-existing non-null `spec_link` values are NEVER overwritten (P-8) — user's manual choice always wins; skip + log `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<discovered>`.
- All discovery-set `spec_link` values are repo-relative paths (P-6), matching Phase 2's source-endpoint convention. Absolute paths remain valid only for legacy manual-upload values; existing rows are NOT touched.
- Service-root scoping per P-17 — files outside the run's target service root are NOT scanned; cross-service spec sharing in a monorepo emits `oas_spec_orphan` when no in-scope interface matches.
- No standalone `.md` documentation files — all docs live as inline TSDoc/JSDoc headers (per the standing instruction "NEVER create documentation files (*.md) or README files unless explicitly requested").

---

## Task List

### Foundation Layer

#### Task Group 1: YAML Parser Dependency + `emissionSources.ts` Sentinel Additions
**Dependencies:** None

- [x] 1.0 Add `js-yaml` and register the two new `evidence_gap` `gapType` sentinels
  - [x] 1.1 Write 2-3 focused tests
    - Test file: `discovery-service/src/__tests__/specFileLinkerSentinels.test.ts`
    - Test 1: the centralised `gapType` enum / constant table includes `'oas_spec_ambiguous_match'` and `'oas_spec_orphan'` alongside Phase 1's `'soap_endpoint_url_unknown'` / `'wsdl_parse_failed'` and Phase 2's `'llm_endpoint_extract_malformed'`
    - Test 2: `buildOasSpecAmbiguousGap({ candidateIds, path })` returns a finding payload with `gapType='oas_spec_ambiguous_match'`, the candidate id array intact, and the spec file path recorded
    - Test 3: `buildOasSpecOrphanGap({ path })` returns a finding payload with `gapType='oas_spec_orphan'` and the file path recorded
  - [x] 1.2 Add `js-yaml` as a new npm dependency (P-15)
    - File: `discovery-service/package.json` — add to `dependencies` if not already present
    - Implementer to verify presence first — `js-yaml` may already be present transitively; if so, promote to a direct dep so the lockfile records the explicit dependency
    - Run `npm install` in `discovery-service/` to refresh `discovery-service/package-lock.json` (lockfile refresh is an explicit deliverable, mirroring Phase 1's `fast-xml-parser` precedent)
    - Confirm no transitive conflicts with existing deps
  - [x] 1.3 Add the two new sentinels to `discovery-service/src/services/findings/emissionSources.ts`
    - Add `'oas_spec_ambiguous_match'` and `'oas_spec_orphan'` to whichever union type / constant table the file uses for `gapType` values
    - Mirror the convention used by Phase 1's `'soap_endpoint_url_unknown'` / `'wsdl_parse_failed'` and Phase 2's `'llm_endpoint_extract_malformed'`
    - Add dedicated builder functions alongside the existing builders:
      - `buildOasSpecAmbiguousGap(input: { candidateIds: string[]; path: string; ... })`
      - `buildOasSpecOrphanGap(input: { path: string; ... })`
    - Builder shape mirrors Phase 1's `soap_endpoint_url_unknown` / `wsdl_parse_failed` builders exactly
  - [x] 1.4 Run ONLY the 2-3 tests from 1.1
    - Do NOT run the entire discovery-service test suite

**Acceptance Criteria:**
- The 2-3 tests written in 1.1 pass
- `js-yaml` appears in `discovery-service/package.json` and `discovery-service/package-lock.json` as a direct dependency
- Both new sentinels are registered in the central `gapType` location next to Phase 1 / Phase 2 sentinels
- Both builders (`buildOasSpecAmbiguousGap`, `buildOasSpecOrphanGap`) follow the existing builder shape exactly

---

#### Task Group 2: Test Fixtures — Two New OAS Reference Files
**Dependencies:** None (can run in parallel with Group 1)

- [x] 2.0 Create the two new OAS fixtures used by Groups 3 and 7
  - [x] 2.1 Create `agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/planning/visuals/reference-springdoc-petstore.yaml`
    - Format: OpenAPI 3.0 YAML
    - MUST include all three signal shapes for the priority-order matching tests:
      - `info.title` (exact-match candidate value for Workstream A title heuristic)
      - `info.version`
      - `paths` with multiple entries sharing a common base prefix (drives the base-path heuristic)
      - `tags` array with at least one `name` value (drives the springdoc `@Tag` heuristic)
    - Drives Workstream A's three priority-order test cases AND the Group 7 end-to-end fixture test
    - Provenance comment at the top of the file: "fixture — derived from public Petstore reference"
  - [x] 2.2 Create `agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/planning/visuals/reference-springdoc-petstore.json`
    - Format: minimal OpenAPI 3.0 JSON variant of the YAML fixture
    - Carries enough shape (`openapi`, `info`, `paths`) to qualify under the signature detector
    - Drives the JSON parse-path test case (ensures `JSON.parse` and `js-yaml` paths both work)
    - Provenance comment in a top-level `description` field
  - [x] 2.3 Verify that the two Phase 1 reuse fixtures are referenceable from Group 5's Workstream B tests
    - `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-spring-ws-countries.xsd` — Spring-WS contract-first XSD; namespace `https://spring.io/guides/gs-producing-web-service`
    - `agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/planning/visuals/reference-jaxws-document-literal-wrapped.wsdl` — JAX-WS document-literal-wrapped WSDL with `targetNamespace`
    - These two fixtures stay in their Phase 1 home — DO NOT duplicate them under Phase 3's visuals folder (P-9)

**Acceptance Criteria:**
- Both new OAS fixtures exist at the documented paths under `planning/visuals/`
- The YAML fixture exercises all three Workstream A heuristics (title + base-path + tag-name) within a single file
- The JSON fixture is a minimal variant exercising the JSON parse path
- The two Phase 1 fixtures are referenceable by path from Workstream B's test files

---

### Workstream A — Standalone OAS Spec File Scanner

#### Task Group 3: `specFileLinker` Scanner Sub-Module
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Implement the new standalone scanner that walks the repo for OpenAPI / Swagger spec files
  - [x] 3.1 Write 7-8 focused tests for the scanner
    - Test file: `discovery-service/src/__tests__/specFileLinker.test.ts`
    - Test 1 (YAML signature detection — positive): a file with top-level `openapi: 3.0.0` qualifies; a file with `info.title`+`info.version`+`paths` shape qualifies; a file with `swagger: '2.0'` qualifies — log line `[diag-pack] scanner=spec_file_linker file=<rel-path> signature=<openapi3|swagger2|info-paths>`
    - Test 2 (YAML signature detection — negative): a YAML file that lacks all three signature shapes is NOT scanned for matches; log line `[diag-pack] scanner=spec_file_linker file=<rel-path> signature=none`
    - Test 3 (JSON signature detection): a `.json` file with `openapi: '3.0.0'` qualifies; parsed via `JSON.parse` (NOT `js-yaml`); one candidate `spec_link` set to its repo-relative path
    - Test 4 (title-match priority): when `info.title` exactly equals an interface candidate's `name`, that interface wins even if a different interface's `basePath` would also match — log line `[diag-pack] scanner=spec_file_linker match=ok interface=<short-id> path=<rel-path> heuristic=title`
    - Test 5 (base-path-match priority): with no title match, the spec's `paths` base prefix matches the interface's `data.basePath`; that interface wins — log line `heuristic=base_path`
    - Test 6 (tag-name-match priority): with no title or base-path match, a `tags[].name` value (springdoc `@Tag(name=...)` shape) matches the interface's `data.openApiTag`; that interface wins — log line `heuristic=tag`
    - Test 7 (ambiguous match): two interfaces match the same spec via base-path → one `evidence_gap` with `gapType='oas_spec_ambiguous_match'`; both involved candidates left with `spec_link=null`; log line `[diag-pack] scanner=spec_file_linker match=ambiguous candidates=[<id>,<id>,...] path=<rel-path>`
    - Test 8 (orphan spec): a qualifying spec file with no matching in-scope interface → one `evidence_gap` with `gapType='oas_spec_orphan'`; no new interface candidate created; log line `[diag-pack] scanner=spec_file_linker match=orphan path=<rel-path>`
    - Test 9 (pre-existing `spec_link` skip): an interface with non-null `spec_link` already set is NEVER overwritten; log line `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<discovered>`
    - Test 10 (service-root scoping per P-17): a spec file outside the run's target service root in a monorepo is ignored — NOT scanned, NOT matched, NOT orphaned for cross-scope candidates
    - (Tests are grouped under one `.test.ts` file but logically address the enumerated test cases in spec.md's "Tests" section)
  - [x] 3.2 Create `discovery-service/src/services/findings/packFindingScanners/specFileLinker/index.ts`
    - Public entry: `runSpecFileLinkerPass(input: ScannerInput): ScannerOutput`
    - Orchestrates: `fileWalker` (3.3) → `signatureDetector` (3.4) → `matcher` (3.5) → emit `spec_link` updates / `evidence_gap` findings via the existing `FindingEmitter`
    - Folder layout mirrors Phase 1's `springClassicSoap/` exactly
    - Forwards diagnostic log lines to the scanner runner's diagnostic stream (same sink as Phase 1)
    - Emits the start line at the very top: `[diag-pack] scanner=spec_file_linker start files_scanned=<N> interfaces_in_scope=<N>`
  - [x] 3.3 Create `discovery-service/src/services/findings/packFindingScanners/specFileLinker/fileWalker.ts`
    - Pure-function repo walker
    - Walks three scopes, in order: `src/main/resources/**/*.{yaml,yml,json}`, the root of `src/main/resources/`, and the project root (NOT recursive across the entire project root — top-level files only)
    - Honours service-root scoping per P-17 — files outside the run's target service root are filtered out
    - Returns a list of `{ path: string; content: string; format: 'yaml' | 'json' }` records (caller pre-loads source strings; walker does no I/O of its own — pipeline-loaded sources)
    - Co-located test file: `discovery-service/src/__tests__/specFileLinkerFileWalker.test.ts` (verifies scope ordering and service-root filter behaviour — covered by Group 3 Test 10 above, no separate test file required)
  - [x] 3.4 Create `discovery-service/src/services/findings/packFindingScanners/specFileLinker/signatureDetector.ts`
    - Public function shape: `detectOasSignature(content: string, format: 'yaml' | 'json'): { signature: 'openapi3' | 'swagger2' | 'info-paths' | 'none'; parsed: object | null }`
    - YAML parsing via `js-yaml` (Group 1 dependency); JSON parsing via `JSON.parse`
    - Detection logic — file qualifies if any of:
      - Top-level `openapi:` key with any 3.x value → signature `'openapi3'`
      - Top-level `swagger: '2.0'` key → signature `'swagger2'`
      - Has the `info.title` + `info.version` + `paths` shape → signature `'info-paths'`
    - Otherwise returns `{ signature: 'none', parsed: null }`
    - Pure, side-effect-free — no I/O beyond reads the caller already did
  - [x] 3.5 Create `discovery-service/src/services/findings/packFindingScanners/specFileLinker/matcher.ts`
    - Public function shape: `matchSpecToInterfaces(input: { parsed: object; candidates: InterfaceCandidate[] }): { matched: InterfaceCandidate[]; heuristic: 'title' | 'base_path' | 'tag' | null }`
    - Match priority order, first match wins; once matched, lower-priority heuristics are NOT consulted for that interface (P-2):
      1. `info.title` exact match against an interface candidate's `name`
      2. `paths` base-prefix match against the interface's `data.basePath` (Spring Boot adapter already captures this)
      3. `tags[].name` (springdoc `@Tag(name=...)` shape) match against the interface's `data.openApiTag`
    - Returns `matched=[]` for orphan, `matched.length===1` for unique match, `matched.length>1` for ambiguous
    - Pure, side-effect-free
  - [x] 3.6 Run ONLY the 7-8 tests from 3.1
    - Do NOT run the entire discovery-service test suite

**Acceptance Criteria:**
- The 7-8 tests written in 3.1 pass
- All scanner sub-modules (`index.ts`, `fileWalker.ts`, `signatureDetector.ts`, `matcher.ts`) are pure with no I/O beyond pipeline-loaded reads
- Match priority order is first-match-wins; lower-priority heuristics are NOT consulted once a match is found
- Pre-existing non-null `spec_link` values are NEVER overwritten
- Service-root scoping is honoured (P-17)
- All log lines use the `[diag-pack] scanner=spec_file_linker ...` prefix

---

#### Task Group 4: Wire `specFileLinker` Into the Pack-Scanner Pipeline
**Dependencies:** Task Group 3

- [x] 4.0 Invoke `specFileLinker` as a stage of the existing pack-scanner pipeline
  - [x] 4.1 Write 2-3 focused integration tests
    - Test file: `discovery-service/src/__tests__/specFileLinkerPipelineWiring.test.ts`
    - Test 1 (mixed-content repo): scanner pipeline receives a fixture repo containing REST controllers + a SOAP service + a standalone `openapi.yaml` and emits correctly-linked candidates — REST interface gets `spec_link` from the spec file, SOAP interface gets `spec_link` from the WSDL (Workstream B), no cross-contamination
    - Test 2 (back-compat): pipeline with no spec files still works (no regressions); `specFileLinker` pass returns empty arrays cleanly; no `evidence_gap` findings for missing spec files (orphan check is about specs that exist but don't match, NOT about absence of specs)
    - Test 3 (invocation ordering): `specFileLinker` runs AFTER framework adapters have produced their interface candidates — verified by passing a candidate set produced by a stubbed adapter pass and asserting the linker consumes them
  - [x] 4.2 Modify the existing pack-scanner pipeline orchestrator
    - File: `discovery-service/src/services/findings/packFindingScanners/index.ts` (verify exact file during implementation — likely the file Phase 1's `springClassicSoap` pass is also invoked from; locate via grep for `runSpringClassicSoapPass` or sibling)
    - Invoke `runSpecFileLinkerPass` as a stage AFTER framework adapters have produced their interface candidates so the linker has candidates to match against
    - Pass the same `FindingEmitter` and run context (P-1, P-12) — same emission pipeline, no parallel emitter
    - Forward diagnostic log lines into the scanner runner's existing diagnostic sink
    - One call-site change only; no broader pipeline refactor
  - [x] 4.3 Run ONLY the 2-3 tests from 4.1

**Acceptance Criteria:**
- The 2-3 tests written in 4.1 pass
- `specFileLinker` runs AFTER framework adapters, as a stage of the existing pipeline (NOT a separate pass / NOT a separate pipeline)
- Reuses the existing `FindingEmitter` and run context
- Mixed-content repos (REST + SOAP + spec files) produce correctly-linked candidates with no cross-contamination
- Pipeline behaviour for repos with no spec files is unchanged (no regressions)

---

### Workstream B — SOAP `spec_link` Promotion

#### Task Group 5: Extend Phase 1's `soapEndpointEmitter.ts` to Promote WSDL Paths to `spec_link`
**Dependencies:** Task Group 1 (for the two new sentinels)

- [x] 5.0 When a WSDL is matched to a parent SOAP interface candidate, set `interface.spec_link` to the WSDL's repo-relative path
  - [x] 5.1 Extend Phase 1's emitter test suite with three new test cases
    - Test file: `discovery-service/src/__tests__/springClassicSoapEmitter.test.ts` (Phase 1's existing test file — small extension, NOT a new file)
    - New Test (WSDL `spec_link` promotion happy path): a WSDL whose `definitions.targetNamespace` exactly matches an interface's `data.request_namespace` → that interface's `spec_link` is set to the WSDL's repo-relative path; the endpoint-level `data.wsdl_source` is preserved (both fields coexist)
    - New Test (ambiguous WSDL): a WSDL whose `targetNamespace` matches two parent interfaces → one `evidence_gap` with `gapType='oas_spec_ambiguous_match'`; both interfaces left with `spec_link=null`; log line `[diag-pack] scanner=spec_file_linker match=ambiguous candidates=[<id>,<id>] path=<wsdl-rel-path>`
    - New Test (orphan WSDL): a WSDL whose `targetNamespace` matches no in-scope interface → one `evidence_gap` with `gapType='oas_spec_orphan'`; log line `[diag-pack] scanner=spec_file_linker match=orphan path=<wsdl-rel-path>`
    - New Test (pre-existing `spec_link` skip — SOAP variant): a SOAP interface candidate with non-null `spec_link` already set is NEVER overwritten by the WSDL promotion step; log line `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<wsdl-rel-path>`
  - [x] 5.2 Modify `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`
    - When the emitter has a WSDL matched to a parent interface candidate, set that interface's `spec_link` to the WSDL's repo-relative path
    - The endpoint-level `data.wsdl_source` from Phase 1 stays as-is for per-operation context — both fields coexist (P-6, Workstream B intent)
    - Match strategy: exact, byte-for-byte WSDL `definitions.targetNamespace` against the namespace recorded on the parent interface (P-3) — Phase 1 captures `data.request_namespace` on endpoint candidates; the parent interface inherits this
    - NO fuzzy matching, NO case-insensitive matching, NO trailing-slash tolerance — false positives are unacceptable on namespace identifiers
    - When ambiguous (one WSDL → ≥2 interfaces, OR one interface → ≥2 WSDLs): leave `spec_link=null` on ALL involved candidates; emit `evidence_gap` via `buildOasSpecAmbiguousGap` (Group 1)
    - When orphan (one WSDL → 0 in-scope interfaces): emit `evidence_gap` via `buildOasSpecOrphanGap` (Group 1)
    - When pre-existing non-null `spec_link`: skip + log `spec_link_skipped` (P-8); user's manual choice always wins
    - All new log lines use the `[diag-pack] scanner=spec_file_linker ...` prefix (NOT the Phase 1 `spring_classic_soap` prefix — these are spec-link promotion lines, not SOAP-candidate-emit lines)
  - [x] 5.3 Run ONLY the new test cases added in 5.1
    - Do NOT run the entire Phase 1 emitter test suite

**Acceptance Criteria:**
- The new test cases added in 5.1 pass
- WSDL `spec_link` promotion is a small additive change to Phase 1's emitter — no new emitter function, no new file
- `data.wsdl_source` (per-operation context) and `interface.spec_link` (per-interface) coexist; neither one replaces the other
- Match strategy is exact-only on `targetNamespace` (no fuzzy)
- Ambiguous and orphan WSDL cases emit `evidence_gap` findings with the new Group 1 sentinels
- Pre-existing non-null `spec_link` values are NEVER overwritten

---

### Workstream C — AMVS `parseOasFromFile` Resolution

#### Task Group 6: Branch `parseOasFromFile` on `path.isAbsolute()`
**Dependencies:** None on Groups 1-5 (independent change-site; depends on Phase 2 Group 1's source endpoint + Phase 2 Group 8's `discoveryServiceClient`)

- [x] 6.0 Resolve repo-relative `spec_link` values via Phase 2's source endpoint inside the existing `parseOasFromFile` function
  - [x] 6.1 Write 3-4 focused tests
    - Test file: `api-migration-validation-service/src/__tests__/oasParserPathResolution.test.ts`
    - Test 1 (branch on `path.isAbsolute()` — repo-relative): `parseOasFromFile` called with a repo-relative `spec_link` value (e.g., `src/main/resources/openapi.yaml`) routes through the source-endpoint helper; mocked `discoveryServiceClient` asserts `GET /discovery/projects/:p/architectures/:a/runs/:r/source/<path>` is invoked
    - Test 2 (branch on `path.isAbsolute()` — absolute legacy): `parseOasFromFile` called with an absolute `spec_link` value (e.g., `C:\manual-uploads\openapi.yaml` on Windows or `/var/uploads/openapi.yaml` on POSIX) routes through `fs.readFile`; mocked `discoveryServiceClient` is NOT invoked (back-compat regression guard)
    - Test 3 (repo-relative resolves via source endpoint): a fetched body from the source endpoint is parsed by the existing OAS parser path; the parsed result matches what `fs.readFile` would have produced for the same file content
    - Test 4 (capture session run id forwarding): the source-endpoint fetch uses the discovery run id wired into `OrchestratorDeps` by Phase 2; mocked `OrchestratorDeps` asserts the run id is read off the capture session and threaded through to the helper
  - [x] 6.2 Modify `api-migration-validation-service/src/services/oasParser.ts` — `parseOasFromFile`
    - Single existing function extended with internal branching on `path.isAbsolute(spec_link)` (P-7) — NO new public function, NO wizard-side change
    - Repo-relative branch:
      - Fetch via Phase 2's `discoveryServiceClient` (already exists from Phase 2 Group 8) using the source endpoint `GET /discovery/projects/:p/architectures/:a/runs/:r/source/*`
      - Read the discovery run id off the capture session (Phase 2 wired this in `OrchestratorDeps` — verify exact accessor during implementation)
      - Wrap the fetch + parse logic in a private helper (do NOT make it a new exported function)
      - On 410-Gone (clone evicted): surface the structured error to the caller without throwing — caller already handles this path from Phase 2
    - Absolute-path branch: existing local `fs.readFile` code path — back-compat for legacy manual-upload values
    - Both branches feed into the same OAS parser path downstream — only the source-read step differs
  - [x] 6.3 Run ONLY the 3-4 tests from 6.1
    - Do NOT run the entire AMVS test suite

**Acceptance Criteria:**
- The 3-4 tests written in 6.1 pass
- `parseOasFromFile` is a single function with internal branching on `path.isAbsolute()` — no new public function
- Repo-relative paths fetch via Phase 2's source endpoint; absolute paths use local `fs.readFile`
- Back-compat is preserved for legacy absolute-path values
- The discovery run id flows through `OrchestratorDeps` (Phase 2 plumbing) — no new plumbing added in this spec
- The wizard's `parse-oas` action is UNCHANGED (it already reads `interface.spec_link`; the new values are picked up automatically)

---

### End-to-End Verification

#### Task Group 7: End-to-End Fixture Test
**Dependencies:** Task Groups 1-6

- [x] 7.0 Run the full pipeline against an in-memory fixture repo containing the new YAML fixture and assert end-to-end success
  - [x] 7.1 Write 1-2 focused end-to-end tests
    - Test file: `discovery-service/src/__tests__/specFileLinkerEndToEndFixture.test.ts`
    - Test 1 (Workstream A E2E): in-memory fixture repo containing `reference-springdoc-petstore.yaml` (Group 2 fixture) + a Spring Boot interface candidate with `data.basePath` matching the spec's `paths` base prefix; run the full scanner pipeline; assert:
      - Exactly one interface candidate has `spec_link` set to the YAML fixture's repo-relative path
      - The diagnostic log emits `[diag-pack] scanner=spec_file_linker match=ok interface=<short-id> path=<rel-path> heuristic=<title|base_path|tag>` (whichever heuristic wins for the fixture's matching values)
      - No `evidence_gap` finding is emitted
    - Test 2 (Workstream C E2E follow-on): AMVS's `parseOasFromFile` (Group 6) called with the same repo-relative `spec_link` value fetches the spec via Phase 2's source endpoint and parses it successfully; mocked `discoveryServiceClient` asserts the correct path is fetched; parsed output contains the fixture's `paths` entries
  - [x] 7.2 Run ONLY the 1-2 tests from 7.1
    - Acceptance signal per the spec: a project containing `src/main/resources/openapi.yaml` (paths matching an existing REST controller's base) produces ONE interface candidate with `spec_link` set to the file's repo-relative path. AMVS resolves the file via the source endpoint.

**Acceptance Criteria:**
- The 1-2 tests written in 7.1 pass
- The end-to-end path from fixture repo → `specFileLinker` scanner → `spec_link` on candidate → AMVS `parseOasFromFile` → source-endpoint fetch → parsed OAS works in a single test run
- The diagnostic log line matches the enumerated shape from spec.md
- Fixture provenance is documented inline as "derived from public Petstore reference"

---

### Documentation

#### Task Group 8: Inline TSDoc / JSDoc Module Headers
**Dependencies:** Task Groups 1-7

- [x] 8.0 Add inline module-header documentation at the top of every new module
  - [x] 8.1 Header at the top of `discovery-service/src/services/findings/packFindingScanners/specFileLinker/index.ts`
    - Describe inputs: source-file map + already-produced interface candidate set (from upstream framework adapters)
    - Describe output schema: `spec_link` updates on existing interface candidates + `evidence_gap` findings for ambiguous / orphan cases — NO new interface candidates ever created (P-5)
    - State the match priority order (P-2): `info.title` → `paths` base prefix → `tags[].name` / `@Tag(name=...)`; first match wins; lower-priority heuristics are NOT consulted once a match is found
    - State the service-root scoping rule (P-17): files outside the run's target service root are NOT scanned; cross-service spec sharing in a monorepo emits `oas_spec_orphan`
    - State the evidence-gap emission rules: ambiguous → `oas_spec_ambiguous_match` with all candidate ids; orphan → `oas_spec_orphan` with the file path
    - State the pre-existing `spec_link` skip rule (P-8): user's manual choice always wins
    - Enumerate the log line shapes (P-10):
      - Start: `[diag-pack] scanner=spec_file_linker start files_scanned=<N> interfaces_in_scope=<N>`
      - Per-file scan: `[diag-pack] scanner=spec_file_linker file=<rel-path> signature=<openapi3|swagger2|info-paths|none>`
      - Match found: `[diag-pack] scanner=spec_file_linker match=ok interface=<short-id> path=<rel-path> heuristic=<title|base_path|tag>`
      - Ambiguity skipped: `[diag-pack] scanner=spec_file_linker match=ambiguous candidates=[<id>,<id>,...] path=<rel-path>`
      - Orphan skipped: `[diag-pack] scanner=spec_file_linker match=orphan path=<rel-path>`
      - Pre-existing-link skipped: `[diag-pack] scanner=spec_file_linker spec_link_skipped pre_existing=<existing> path=<discovered>`
    - Reference the spec path: `agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md`
  - [x] 8.2 Header at the top of `discovery-service/src/services/findings/packFindingScanners/specFileLinker/fileWalker.ts`
    - Describe the three walked scopes in order: `src/main/resources/**/*.{yaml,yml,json}`, root of `src/main/resources/`, project root (top-level only)
    - State the service-root scoping rule (P-17) — files outside the run's target service root are filtered out
    - State that the walker is pure (no I/O of its own; consumes pipeline-loaded source strings)
    - Reference the spec path
  - [x] 8.3 Header at the top of `discovery-service/src/services/findings/packFindingScanners/specFileLinker/signatureDetector.ts`
    - Describe the three qualifying signatures: top-level `openapi:` (3.x), top-level `swagger: '2.0'`, or `info.title`+`info.version`+`paths` shape
    - State that YAML is parsed via `js-yaml` (Group 1 dependency) and JSON is parsed via `JSON.parse`
    - State that the detector is pure (side-effect-free, no I/O)
    - Reference the spec path
  - [x] 8.4 Header at the top of `discovery-service/src/services/findings/packFindingScanners/specFileLinker/matcher.ts`
    - State the match priority order (P-2): `info.title` exact match → `paths` base-prefix match → `tags[].name` match; first match wins
    - State the input contract: `{ parsed: object; candidates: InterfaceCandidate[] }`
    - State the output contract: `{ matched: InterfaceCandidate[]; heuristic: 'title' | 'base_path' | 'tag' | null }`
    - State that the matcher is pure
    - Reference the spec path
  - [x] 8.5 No standalone `.md` files
    - All documentation lives inside the source files only — do NOT create a separate README.md or design doc

**Acceptance Criteria:**
- All four inline headers are present at the top of their respective modules
- Each header covers the bullets enumerated above (inputs, output schema, matching priority order, service-root scoping, evidence-gap emission, log line shapes)
- All headers reference the spec path
- No standalone documentation file was created

---

## Execution Order

Recommended implementation sequence:

1. **Foundation parallel block** — Groups 1 (YAML parser + sentinels) and 2 (test fixtures). Both independent; parallelisable across engineers.
2. **Workstream A core** — Group 3 (`specFileLinker` scanner sub-module). Depends on Groups 1 and 2.
3. **Workstream A integration** — Group 4 (pipeline wiring). Depends on Group 3.
4. **Workstream B** — Group 5 (SOAP `spec_link` promotion in Phase 1's emitter). Depends on Group 1 (sentinels). Independent of Groups 3-4; can start in parallel with Group 3 if engineer count allows.
5. **Workstream C** — Group 6 (AMVS `parseOasFromFile` branch). Independent of Workstreams A and B; can start in parallel with Group 3 once Phase 2's `discoveryServiceClient` is confirmed in place.
6. **End-to-end fixture test** — Group 7. Depends on Groups 1-6 (covers Workstream A → C path; Workstream B has its own ambiguous/orphan tests in Group 5).
7. **Documentation** — Group 8 (inline TSDoc/JSDoc headers). Depends on Groups 1-7.

**Dependency map:**

```
Group 1 (YAML parser + sentinels) ----+
                                       +--> Group 3 (specFileLinker scanner) --> Group 4 (pipeline wiring) --+
Group 2 (test fixtures) --------------+                                                                       \
                                       \                                                                       +--> Group 7 (E2E fixture) --> Group 8 (docs)
                                        +--> Group 5 (SOAP spec_link promotion) -------------------------------/
                                                                                                              /
                                                Group 6 (AMVS parseOasFromFile branch) ----------------------+
```

Groups 1 and 2 are parallelisable on day one. Groups 3, 5, and 6 can all start as soon as Group 1 is done (Group 3 additionally needs Group 2). Group 7 is the gating end-to-end check. Group 8 is the documentation deliverable folded in at the end.
