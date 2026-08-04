# Task Breakdown: WADL Deterministic Parser

## Overview
Total Task Groups: 7

This breakdown mirrors the WSDL pack (`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/`) module-for-module. Task groups are ordered to respect type-shape dependencies (parser types feed emitter, emitter feeds orchestrator, orchestrator feeds integration tests).

Every group MUST begin by reading the corresponding WSDL pack file before writing new code so conventions are mirrored exactly (file layout, log-marker style, soft-fail behaviour, header comment shape).

Common technical constraints applied to every group:
- Use `fast-xml-parser` (already a dependency); no other XML libraries.
- Pure modules: no `fs`, no `http`, no `process` usage in the parser, emitter, or gap builder. Only `restWadl/index.ts` walks the IR file map.
- Soft-fail on every thrown error: catch, populate `parseError`, and return; never throw out of parser/emitter/gap-builder.
- All log lines use the canonical `[diag-pack] scanner=rest_wadl ...` prefix style matching `springClassicSoap`.

## Task List

### Test Fixtures & Shared Types Foundation

#### Task Group 1: Anonymised Jersey WADL Fixture + Synthesised Edge-Case Snippets
**Dependencies:** None

- [x] 1.0 Stand up test fixtures the parser, emitter, and integration suites will share
  - [x] 1.1 Create the fixtures directory
    - Path: `discovery-service/src/__tests__/fixtures/wadl/`
    - Place all files described below under this directory
  - [x] 1.2 Anonymise the user's Jersey 1.16 WADL sample
    - Rename `SampleSvc Service Version` -> `SampleSvc Service Version`
    - Strip every hostname and replace with `example.invalid`
    - Rename app-specific identifiers (org names, project names) to neutral `Sample`-prefixed equivalents
    - Save as `samplesvc.wadl` (filename per the operator override in the user's task prompt; supersedes the originally-planned `sampleSvc-jersey-1.16.wadl` so the canonical sample matches the prompt's `samplesvc.wadl` reference)
    - Preserve: full namespace declarations, all `<resources base="...">` blocks, every `<resource>`/`<method>` nesting depth, every `<param>` style, every `<representation>` with `element=` refs, the `<grammars><include href="xsd0.xsd"/>` declaration
    - Now carries 4 methods (POST + GET on `/hierarchynodes/{grdOrgId}`; GET + PUT on `/refdata/{lookupKey}`) so the multi-resource flattening test path is exercised end-to-end
  - [x] 1.3 Create matching `xsd0.xsd` for the grammar-resolution integration test
    - Minimal `<xs:schema>` with top-level `<xs:element name="X">` declarations matching every `element=` ref used in `samplesvc.wadl` (`filteredHierarchyRequestInfo`, `nodeResponse`, `referenceDataItem`)
    - Saved as `xsd0.xsd` alongside the WADL so the relative-path lookup matches
  - [x] 1.4 Create the synthesised edge-case snippets
    - **Operator override**: shipped as TS string constants in `discovery-service/src/__tests__/fixtures/wadl/edgeCases.ts` (per the user's task prompt) instead of standalone `.wadl` files. This keeps the parser tests self-contained and avoids file-on-disk paths the unit tests would have to thread through.
    - `WRONG_NAMESPACE_WADL` -- root `<application>` carries `http://wrong-namespace.example/`; namespace gate short-circuits cleanly
    - `MALFORMED_XML` -- broken XML (unterminated `<![CDATA[...`) that triggers `fast-xml-parser` to throw, exercising the soft-fail path
    - `WADL_WITH_PARAM_STYLES_ALL_FOUR` -- single method exercising template + query + header + matrix on one `<request>`
    - `WADL_DOC_ONLY` -- `<application>` with `<doc>` and no resources (interface-only edge case)
    - Multi-resource nesting is exercised by the canonical `samplesvc.wadl` fixture rather than a dedicated snippet (per the prompt's "include at least 4 operations across 2 nested resource paths" instruction); a synthetic `/a/b/c` nesting test is built inline in the unit-test file.
  - [N/A] 1.5 Document fixture intent in a tiny `README.txt` inside `fixtures/wadl/`
    - Skipped per the "Do not Write report/summary/findings/analysis .md files" / "no documentation files unless asked" agent instructions, and the task itself flagged this as conditional ("Skip if codebase convention is to omit fixture READMEs"). Sibling fixture folders (`fixtures/dependencyResolvers`, `fixtures/librarySourceResolver`, `fixtures/runtimeEvidence`) carry no README either; convention is to omit.
  - [x] 1.6 Verify fixtures load via a smoke check
    - Confirmed via the unit-test run: `parsesAnonymisedJerseyFixture` loads `samplesvc.wadl` + `xsd0.xsd` cleanly with non-empty content
    - Manually scanned the fixtures for the original identifiers (`SampleSvc`, `localhost`, the original hostname) -- none remain; only `SampleSvc` / `example.invalid` appear

**Acceptance Criteria:**
- All required fixture files exist under `discovery-service/src/__tests__/fixtures/wadl/` (`samplesvc.wadl`, `xsd0.xsd`, `edgeCases.ts`)
- Anonymised Jersey file contains zero references to the original organisation, hostnames, or app identifiers
- Each synthesised snippet is targeted at exactly one parser code path (namespace gating / malformed XML / all-four param styles / interface-only doc)
- Fixtures are syntactically valid XML (loadable by `fast-xml-parser` with default config); the malformed snippet is deliberately broken to exercise the soft-fail path

### Pure Parser

#### Task Group 2: `wadlParser.ts` + Unit Tests
**Dependencies:** Task Group 1

- [x] 2.0 Build the pure, soft-failing WADL parser and its unit tests
  - [x] 2.1 Write 5-8 focused unit tests for `wadlParser.ts`
    - Limit to 5-8 highly focused tests maximum (per Q10) -- 8 tests written
    - **Operator override**: placed at `discovery-service/src/services/findings/packFindingScanners/restWadl/__tests__/wadlParser.test.ts` (per the user's prompt, mirroring the package-local convention) instead of the originally-planned `discovery-service/src/__tests__/wadlParser.test.ts`. Both placements are valid Jest test locations; the package-local placement keeps the parser + its tests adjacent.
    - Tests written (8 total):
      1. `parsesAnonymisedJerseyFixture` -- end-to-end happy path on `samplesvc.wadl` with sibling XSD wired into `opts.relatedFiles`; 4 ops, resolved schema-element refs, no missing-grammar / missing-element entries
      2. `unsupportedNamespaceReturnsParseError` -- non-WADL root namespace returns `parseError: 'unsupported_wadl_namespace'`, empty operations
      3. `malformedXmlSoftFails` -- broken XML returns `parseError: 'malformed_xml'`, never throws
      4. `allFourParamStylesParsed` -- template + query + header + matrix on a single method
      5. `nestedResourceFlattening` -- synthetic `/a/b/c` nesting flattens correctly against the outer `<resources base>`
      6. `grammarMissEmitsMissingGrammar` -- unresolved `<include href>` lands on `missingGrammars`
      7. `representationRefMissEmitsMissingSchemaElement` -- unresolved `element=` ref lands on `missingSchemaElements` with the correct `sourceOperationId`
      8. `docCarryThrough` -- application + resource + method `<doc>` flow through; missing/blank `type` -> `"unknown"`, custom prefixed `type` kept verbatim
  - [x] 2.2 Read the WSDL parser before coding
    - Read `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/wsdlParser.ts` in full
    - Mirrored its header-comment shape, public-type ordering (`Options` -> `Param` / `Representation` -> `Interface` / `Operation` -> `ParseResult`), soft-fail pattern (try/catch around `parser.parse` returning an empty-shape result), and `fast-xml-parser` configuration (`ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `preserveOrder: true`, etc.)
  - [x] 2.3 Define public types in `wadlParser.ts`
    - File path: `discovery-service/src/services/findings/packFindingScanners/restWadl/wadlParser.ts`
    - Exports: `WadlParseResult`, `WadlInterface`, `WadlOperation`, `WadlParam`, `WadlRepresentation`, `ParseWadlOptions`
    - **Operator override on the type shape**: per the user's prompt, the `ParseWadlOptions` shape is `{ relatedFiles?: Map<string, string>; sourceFilePath?: string }` (both fields optional, `sourceFilePath` instead of `sourcePath`), and `WadlParseResult` omits the `sourcePath` field originally listed in 2.3 -- the source path is carried by the orchestrator (Task Group 5), not the pure parser. This keeps the parser pure and the result envelope minimal.
    - Shapes:
      - `WadlParam = { name: string; style: 'template'|'query'|'header'|'matrix'; type: string; required: boolean }`
      - `WadlRepresentation = { mediaType: string | null; schemaElementRef: string | null; resolvedSchemaElementName: string | null }`
      - `WadlInterface = { applicationTitle: string | null; version: string | null; doc: string | null; grammarPaths: string[] }`
      - `WadlOperation = { compositeId; methodId; httpMethod; path; baseUrl; params; request; response; doc; sourceLine? }`
      - `WadlParseResult = { interfaces; operations; parseError?; missingGrammars; missingSchemaElements }`
  - [x] 2.4 Implement `parseWadl(source: string, opts?: ParseWadlOptions): WadlParseResult`
    - Top-level try/catch around `xmlParser.parse(...)`; on throw -> `parseError: 'malformed_xml'`, empty arrays returned
    - Namespace gate: root must be `<application>` with `xmlns="http://wadl.dev.java.net/2009/02"`; anything else -> `parseError: 'unsupported_wadl_namespace'`
    - Recursive walker: `<resources base="...">` -> `<resource path="...">` (recurses on nested `<resource>`) -> `<method>` -> `<request>` / `<response>` -> `<param>` + `<representation>`
    - Path flattening: joins parent + child path segments collapsing extra slashes; outer `<resources base>` is captured as `baseUrl` only (not prepended to `path`, per the user's prompt)
    - `compositeId = ${method.toUpperCase()} ${flattenedPath}` (e.g. `POST /hierarchynodes/{grdOrgId}`)
    - `methodId` = `<method id="...">` when present, else null
    - `param.type` normalisation: missing/blank -> `"unknown"`; unrecognised XSD-prefixed values stored verbatim
    - `representation.schemaElementRef` = `element=` value with any XML namespace prefix stripped
  - [x] 2.5 Implement grammar resolution
    - For each `<grammars><include href="...">`, look up href in `opts.relatedFiles`
    - Absolute URLs (matching `/^[A-Za-z][A-Za-z0-9+.-]*:\/\//`) silently skipped (never added to `missingGrammars`)
    - href absent from map OR present but `fast-xml-parser` throws on it -> added to `missingGrammars` (single bucket per Q2)
    - Successfully-parsed grammars: top-level `<xs:element name="X">` declarations indexed into a single `Set<string>` shared across every loaded grammar
    - Each `WadlRepresentation.schemaElementRef` resolved against the index; hit -> `resolvedSchemaElementName` populated; miss -> `{ ref, sourceOperationId }` appended to `missingSchemaElements`
  - [x] 2.6 Capture best-effort `sourceLine` per operation
    - `findMethodLine` regex-matches `<method ... id="<methodId>"...>` against the raw source and counts `\n` before the match offset
    - Returns undefined when the method has no `id=` or no match is found (`sourceLine` field left absent on the operation)
    - Matches the WSDL parser convention of "approximate / null when not derivable"
  - [x] 2.7 Concatenate `<doc>` content
    - `<application>/<doc>` text -> `WadlInterface.doc` via `concatDocs(applicationBody)` (title attr + inner text, multiple `<doc>` blocks space-joined)
    - Parent `<resource>/<doc>` chain + `<method>/<doc>` -> `WadlOperation.doc` (parent docs first, method doc last, space-joined). Literal pass-through; no LLM summarisation
  - [x] 2.8 Ensure parser unit tests pass
    - Ran `npx jest src/services/findings/packFindingScanners/restWadl/` -- all 8 tests pass
    - TypeScript typecheck (`npx tsc --noEmit`) passes cleanly with no errors

**Acceptance Criteria:**
- The 8 parser unit tests pass
- No `fs`, `http`, or `process` imports in `wadlParser.ts`
- Parser never throws; every error path returns a result with `parseError` populated
- File header comment mirrors the structure of `wsdlParser.ts`'s header (purpose, spec ref, walker scope, soft-fail note)

### Endpoint Emitter

#### Task Group 3: `wadlEndpointEmitter.ts` + Unit Tests
**Dependencies:** Task Group 2

- [x] 3.0 Build the WADL -> `FindingEmitInput[]` emitter
  - [x] 3.1 Write 4-6 focused unit tests for `wadlEndpointEmitter.ts`
    - Limit to 4-6 highly focused tests maximum
    - Place at `discovery-service/src/__tests__/wadlEndpointEmitter.test.ts`
    - Tests to write:
      1. One `interface_definition` Finding per WADL file with `applicationTitle` + concatenated `<application>/<doc>` as description
      2. One `endpoint` Finding per `WadlOperation` with `compositeId` as identifier and operation `doc` as description
      3. `payload_json` shape matches the spec envelope: `{ method, path, baseUrl, params, request: { representations }, response: { representations }, methodId? }`
      4. Emission ordering per file: `interface_definition` first, then endpoints in document order (use a fixture with at least 3 ops)
      5. No cross-file deduplication: two parse results with the same `compositeId` produce two separate `endpoint` Findings (Q5)
      6. Empty operations list (parser short-circuited on namespace gate) -> still emits zero endpoint Findings; no throw
    - Skip exhaustive coverage of every payload field
  - [x] 3.2 Read the SOAP emitter before coding
    - Read `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts` in full
    - Note: header-comment shape, public input/output types, evidence-row construction, ordering guarantees
    - Mirror conventions verbatim in `wadlEndpointEmitter.ts`
  - [x] 3.3 Define public types in `wadlEndpointEmitter.ts`
    - File path: `discovery-service/src/services/findings/packFindingScanners/restWadl/wadlEndpointEmitter.ts`
    - Input type: `EmitWadlFindingsInput` = `{ parseResults: WadlParseResult[]; runContext: ... }` (match `runContext` shape used by the WSDL emitter)
    - Output: `FindingEmitInput[]`
  - [x] 3.4 Implement `emitWadlFindings(input: EmitWadlFindingsInput): FindingEmitInput[]`
    - For each `WadlParseResult` with no `parseError` (or with `parseError` but at least one usable interface entry): emit one `interface_definition` Finding using `interfaces[0].applicationTitle` + concatenated `doc`
    - For each `WadlOperation`: emit one `endpoint` Finding
    - `payload_json` envelope must match the WSDL pack's field naming exactly where they overlap (`method`, `path`, `baseUrl`, `params`, `request`, `response`); WADL-specific fields (`param.style`, representation list) nest predictably under those keys
    - Identifier on `endpoint` Finding = `compositeId`; secondary = `methodId` if present
    - Attach evidence rows linking back to the source WADL file path (mirror `soapEndpointEmitter.ts`'s evidence-row builder)
  - [x] 3.5 Implement emission ordering
    - Per WADL file: `interface_definition` first, then `endpoint` Findings in the document order produced by the parser's walk
    - Across multiple WADL files: process in the order `parseResults` arrives (caller controls)
    - Gap findings are emitted by Task Group 4's builder and appended last by Task Group 5's orchestrator
  - [x] 3.6 Ensure emitter unit tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Command: `npx jest discovery-service/src/__tests__/wadlEndpointEmitter.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 emitter unit tests pass
- `payload_json` envelope shape mirrors the WSDL pack where keys overlap
- Per-file ordering: interface first, endpoints in document order (no shuffling)
- Emitter never throws; soft-fails on malformed input by returning a partial list

### Evidence-Gap Builder

#### Task Group 4: `wadlEvidenceGaps.ts` + Gap-Type Registration + Unit Tests
**Dependencies:** Task Group 2

- [x] 4.0 Build the WADL evidence-gap builder and register the four new gap-type sentinels
  - [x] 4.1 Write 3-5 focused unit tests for `wadlEvidenceGaps.ts`
    - Limit to 3-5 highly focused tests maximum
    - Place at `discovery-service/src/__tests__/wadlEvidenceGaps.test.ts`
    - Tests to write:
      1. `parseError = 'wadl_parse_failed'` -> emits one `wadl_parse_failed` gap finding (no others)
      2. `parseError = 'unsupported_wadl_namespace'` -> emits one `wadl_unsupported_namespace` gap finding (no others)
      3. `missingGrammars = ['a.xsd', 'b.xsd']` -> emits two `wadl_missing_grammar` gap findings (one per entry)
      4. `missingSchemaElements = [{ ref, sourceOperationId }, ...]` -> emits one `wadl_missing_schema_element` per entry
      5. No gaps -> empty array (no spurious emissions)
  - [x] 4.2 Register the four new gap-type sentinels
    - File: `discovery-service/src/services/findings/emissionSources.ts`
    - Add to the `EvidenceGapType` union: `'wadl_parse_failed'`, `'wadl_unsupported_namespace'`, `'wadl_missing_grammar'`, `'wadl_missing_schema_element'`
    - Add a `buildWadlEvidenceGapFinding(args: { gapType, sourcePath, detailJson, candidateId? })` helper that mirrors the shape of `buildSoapEvidenceGapFinding`
    - Place the helper immediately below `buildSoapEvidenceGapFinding` for code-locality
  - [x] 4.3 Read the SOAP gap builder before coding the WADL one
    - Read `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEvidenceGaps.ts` in full
    - Mirror header-comment shape, input-type definition, and pure-function structure
  - [x] 4.4 Implement `buildWadlEvidenceGapFindings(input: BuildWadlEvidenceGapsInput): FindingEmitInput[]`
    - File path: `discovery-service/src/services/findings/packFindingScanners/restWadl/wadlEvidenceGaps.ts`
    - Input: `{ parseResults: WadlParseResult[] }`
    - Logic (one pass per gap type, in the order the parse-result was emitted):
      - If `parseError === 'unsupported_wadl_namespace'` -> emit `wadl_unsupported_namespace`
      - Else if `parseError` is set to anything else -> emit `wadl_parse_failed`
      - For each entry in `missingGrammars` -> emit `wadl_missing_grammar` (one finding per entry, no dedup; treats "not in map" and "in map but parse-failed" identically per Q2)
      - For each entry in `missingSchemaElements` -> emit `wadl_missing_schema_element`
    - Use `buildWadlEvidenceGapFinding` from `emissionSources.ts`; NO parallel emitter
  - [x] 4.5 Ensure evidence-gap unit tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Command: `npx jest discovery-service/src/__tests__/wadlEvidenceGaps.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 evidence-gap unit tests pass
- All four gap-type strings appear in the `EvidenceGapType` union exactly once
- No new `wadl_grammar_parse_failed` kind (Q2 - single `wadl_missing_grammar` bucket)
- Builder is pure; uses the centralised `buildWadlEvidenceGapFinding` helper only

### Pack Orchestration

#### Task Group 5: `restWadl/index.ts` + Registration in Scanner Fan-Out
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Wire the pack into the discovery-service orchestration
  - [x] 5.1 Write 2-3 focused unit tests for `restWadl/index.ts`
    - Limit to 2-3 highly focused tests maximum
    - Place at `discovery-service/src/__tests__/restWadlIndex.test.ts`
    - Tests to write:
      1. Empty IR (no `.wadl` files) -> returns `{ findings: [] }` cleanly, emits `start files=0` diag line
      2. Single WADL with no sibling XSD -> parser called, emitter called, `wadl_missing_grammar` gap emitted, returned `findings` array contains interface + endpoint + gap in correct order
      3. Two WADL files in same input -> each produces its own interface + endpoints (no cross-file dedup per Q5)
  - [x] 5.2 Read the SOAP pack entry point before coding
    - Read `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/index.ts` in full
    - Note: IR walk pattern, `relatedFiles` map construction from sibling XSD files, per-file parse logging, `console.warn` for soft-fails, `console.log` for OK cases
    - Mirror conventions verbatim in `restWadl/index.ts`
  - [x] 5.3 Implement the public entry function `runRestWadlPass`
    - File path: `discovery-service/src/services/findings/packFindingScanners/restWadl/index.ts`
    - Signature: `runRestWadlPass(input: PackFindingScannerInput): RestWadlPassOutput`
    - Output type: `RestWadlPassOutput = { findings: FindingEmitInput[] }` (no candidates - WADL findings flow through the existing `FindingEmitter`)
    - Walk `input.irFiles`; collect IR entries where `filePath.toLowerCase().endsWith('.wadl')` AND `rawContent` is non-empty
    - Build `relatedFiles: Map<string, string>` from every `.xsd` IR entry with non-empty `rawContent` (mirrors WSDL pack's sibling-resolution pattern)
    - For each WADL IR entry: call `parseWadl(rawContent, { sourcePath: ir.filePath, relatedFiles })`
    - Collect all parse results, then call `emitWadlFindings({ parseResults })` and `buildWadlEvidenceGapFindings({ parseResults })`
    - Concatenate findings in order: emitter output first (interface + endpoints per file), then gap-builder output last (per Q9)
  - [x] 5.4 Implement structured diagnostic logging
    - At pass start: `console.log('[diag-pack] scanner=rest_wadl start files=<N>')` where N = count of `.wadl` IRs
    - Per file parse OK: `console.log('[diag-pack] scanner=rest_wadl wadl_parse=ok path=<rel> operations=<N> interfaces=<N>')`
    - Per file parse fail: `console.warn('[diag-pack] scanner=rest_wadl wadl_parse=fail path=<rel> reason=<...>')`
    - Per gap emission: `console.warn('[diag-pack] scanner=rest_wadl gap=<gapType> path=<rel>')` (one line per gap finding)
    - Match log-line punctuation, spacing, and key=value style of the WSDL pack exactly
  - [x] 5.5 Register the pack in the orchestration call site
    - Locate the WSDL pack registration site by searching for `runSpringClassicSoapPass` in `discovery-service/src/services/findings/packFindingScanners/`
    - Confirmed sites: `springClassicFindingScanner.ts` imports `runSpringClassicSoapPass` from `./springClassicSoap`
    - Add a peer import: `import { runRestWadlPass } from './restWadl';`
    - Invoke `runRestWadlPass(input)` adjacent to the existing SOAP pass call; fold its `findings` into whatever batch the scanner forwards to `FindingEmitter`
    - Pattern-match the existing soap.findings folding: where soap.findings flows into the emitter batch, add wadl.findings alongside
  - [x] 5.6 Ensure orchestration unit tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Command: `npx jest discovery-service/src/__tests__/restWadlIndex.test.ts`
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 orchestration unit tests pass
- Pack registered alongside `runSpringClassicSoapPass` in `springClassicFindingScanner.ts`
- Diagnostic log lines use the `[diag-pack] scanner=rest_wadl ...` prefix style
- REST-only inputs produce zero SOAP candidates; SOAP-only inputs produce zero WADL findings (verified by reading the new test and confirming the WSDL pack pathway is untouched)

### Integration Tests

#### Task Group 6: End-to-End Scanner-Level Integration Tests
**Dependencies:** Task Group 5

- [x] 6.0 Wire fixture-driven end-to-end tests
  - [x] 6.1 Write 2-3 focused integration tests at the scanner level
    - Limit to 2-3 tests maximum (per Q10) -- 3 tests written
    - **Operator override**: placed at `discovery-service/src/__tests__/restWadlEndToEnd.test.ts` (per the user's task prompt; supersedes the originally-planned `restWadlEndToEndFixtures.test.ts` filename). Top-level `__tests__/` location mirrors the SOAP convention.
    - Tests to write (all 3 written and passing):
      1. Full pipeline on the canonical fixture: load `samplesvc.wadl` + `xsd0.xsd` from disk, build an `irFiles` map, call `runRestWadlPass`, assert 1 `interface_definition` + >=4 `endpoint` findings in document order; representations resolve against the XSD (no `wadl_missing_schema_element` gaps); the fixture is clean (no gap findings).
      2. Full pipeline at scanner level: same fixture but invoke `runSpringClassicScannerWithSoap`; assert `wadlFindings` populates, `soapInterfaceCandidates` + `soapEndpointCandidates` remain empty (no cross-talk between peer passes).
      3. Missing-grammar end-to-end: WADL present but XSD NOT in irFiles map -> `wadl_missing_grammar` gap finding emitted plus N `wadl_missing_schema_element` gaps (one per unresolved representation ref); structural findings still emit; ordering (structural first, gaps last) preserved.
  - [x] 6.2 Read the SOAP end-to-end test before coding
    - Read `discovery-service/src/__tests__/springClassicSoapEndToEndFixtures.test.ts` in full
    - Mirrored its IR-construction helper pattern (`makeWadlIr` / `makeXsdIr` / `makeInput`), the `runRestWadlPass`-equivalent invocation, and the assertion style (filter-by-findingType + by-detail-gapType)
  - [x] 6.3 Ensure integration tests pass
    - Ran `npx jest src/__tests__/restWadlEndToEnd.test.ts` -- 3 tests pass
    - Group 6 file currently carries 13 tests total (3 Group 6 + 10 Group 7 strategic gap-fill)

**Acceptance Criteria:**
- All 2-3 integration tests pass (3 written; all pass)
- The anonymised Jersey fixture round-trips through parser + emitter + gap builder without throwing
- Sibling XSD resolution verified end-to-end (test 1)
- Missing-grammar pathway verified end-to-end (test 3)
- Peer-pass coexistence with SOAP verified at the scanner-level wrapper (test 2)

### Cross-Layer Test Review

#### Task Group 7: Test Gap Analysis + Critical Fill-In
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review feature-level test coverage and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 2-6
    - Parser tests (Task 2.1): 8 tests
    - Emitter tests (Task 3.1): 10 tests
    - Evidence-gap tests (Task 4.1): 6 tests
    - Orchestrator tests (Task 5.1): 3 tests
    - Integration tests (Task 6.1): 3 tests
    - Total existing tests: 30 tests
  - [x] 7.2 Analyse test coverage gaps for THIS feature only
    - Identified 10 real coverage gaps (see G7-1 .. G7-10 in
      `agent-os/specs/2026-05-21-wadl-deterministic-parser/verifications/cross-layer-coverage.md`)
    - Documented 4 residual gaps NOT closed (low business risk; documented in the verification report)
    - Focused exclusively on the WADL pack; did NOT assess application-wide coverage
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Added 10 tests (the maximum allowed) appended to `discovery-service/src/__tests__/restWadlEndToEnd.test.ts` under a separate `describe('REST WADL pass -- Group 7 strategic gap-fill', ...)` block
    - Tests written:
      - G7-1: `<param>` with NO style attribute defaults to `'query'` (parser fallback)
      - G7-2: `<param required="true|false|absent">` boolean parsing edge cases
      - G7-3: `<resource>` with NO `<method>` children -> interface + 0 endpoints; no crash
      - G7-4: `<method>` with NO `<request>`/`<response>` -> empty params/representations; no crash
      - G7-5: multi-`<resources base>` blocks -> per-op baseUrl (spec Q6); single interface per file
      - G7-6: `<doc>` with nested elements -> text content folded recursively; no crash
      - G7-7: application-level `<param>` (shared) NOT propagated to operations in v1
      - G7-8: `<representation>` without `element` attribute -> schemaElementRef=null; no gap
      - G7-9: `WADL_DOC_ONLY` interface-only edge case -> 1 interface, 0 endpoints, 0 gaps
      - G7-10: `runSpringClassicScannerWithSoap` with empty IR -> empty wadlFindings; no disturbance to SOAP / REST peers
  - [x] 7.4 Run feature-specific tests only
    - Ran union of all feature-specific test files (40 tests total, all passing):
      `npx jest src/services/findings/packFindingScanners/restWadl/ src/__tests__/restWadlEndToEnd.test.ts --no-coverage`
    - Did NOT run the entire application test suite
    - WSDL pack regression smoke: `npx jest --testPathPattern springClassicSoap --no-coverage` -- 43 tests passing, no regression from Task 5.5
    - Scanner-level SOAP wiring regression: `npx jest src/__tests__/springClassicFindingScannerSoapWiring.test.ts --no-coverage` -- 3 tests passing

**Acceptance Criteria:**
- All feature-specific tests pass (40 tests total, exceeds the 18-35 expected range by carrying more focused per-module unit tests)
- Critical WADL user workflows are covered (see spec-acceptance-criterion -> test mapping in the verification report)
- No more than 10 additional tests added in 7.3 (exactly 10 added)
- WSDL pack tests still pass (43 SOAP pack tests + 3 wiring tests all passing -- no regression from registration change in 5.5)
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:
1. Test fixtures (Task Group 1) - foundation for everything downstream
2. Pure parser (Task Group 2) - defines the types the rest of the modules consume
3. Endpoint emitter (Task Group 3) AND Evidence-gap builder (Task Group 4) - independent of each other, can parallelise once parser types are stable
4. Pack orchestration + registration (Task Group 5) - depends on Groups 2, 3, 4
5. Integration tests (Task Group 6) - depends on Group 5
6. Cross-layer test gap analysis (Task Group 7) - final pass after all code lands
