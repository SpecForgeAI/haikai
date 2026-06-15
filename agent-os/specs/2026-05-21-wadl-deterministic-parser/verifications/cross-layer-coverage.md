# Cross-Layer Test Coverage Verification

**Spec:** 2026-05-21 WADL Deterministic Parser
**Date:** 2026-05-20
**Task Groups verified:** 1-7 (groups 1-5 previously verified by their own unit tests; this report
adds the Group 6 end-to-end pass and the Group 7 cross-layer gap-fill).

## Test Inventory

| Test File | Tests | Group |
| --- | --- | --- |
| `discovery-service/src/services/findings/packFindingScanners/restWadl/__tests__/wadlParser.test.ts` | 8 | 2 |
| `discovery-service/src/services/findings/packFindingScanners/restWadl/__tests__/wadlEndpointEmitter.test.ts` | 10 | 3 |
| `discovery-service/src/services/findings/packFindingScanners/restWadl/__tests__/wadlEvidenceGaps.test.ts` | 6 | 4 |
| `discovery-service/src/services/findings/packFindingScanners/restWadl/__tests__/restWadlIndex.test.ts` | 3 | 5 |
| `discovery-service/src/__tests__/restWadlEndToEnd.test.ts` (Group 6 block) | 3 | 6 |
| `discovery-service/src/__tests__/restWadlEndToEnd.test.ts` (Group 7 block) | 10 | 7 |
| **Total feature-specific tests** | **40** | |

Last run: 40 passing, 0 failing, 0 skipped (`npx jest src/services/findings/packFindingScanners/restWadl/ src/__tests__/restWadlEndToEnd.test.ts --no-coverage`).

SOAP pack regression smoke (per task 7.4): 43 tests passing under
`npx jest --testPathPattern springClassicSoap` (matches the pre-WADL baseline).

## Spec Acceptance Criteria -> Test Mapping

### Pack module + file layout

- **Spec:** "Mirror the WSDL pack's file layout 1:1: `wadlParser.ts`,
  `wadlEndpointEmitter.ts`, `wadlEvidenceGaps.ts`, `index.ts`."
  - Anchored by `restWadl/__tests__/wadlParser.test.ts` (file exists),
    `wadlEndpointEmitter.test.ts`, `wadlEvidenceGaps.test.ts`,
    `restWadlIndex.test.ts` (one test file per module mirrors WSDL pack).
- **Spec:** "Pack is always active; no `core_tech` gating."
  - Verified by `restWadlIndex.test.ts` empty-IR test (the orchestrator runs and
    returns `{ findings: [] }` cleanly without any gating predicate) and by
    Group 6 / G7-10 (running through the scanner-level wrapper with no `.wadl`
    files still invokes the pack).

### Pure WADL parser (`wadlParser.ts`)

- **Spec:** "Public function `parseWadl(source, opts)`; no `fs`, no `http`, no
  `process`."
  - Implicitly anchored by every parser unit test (each one imports and calls
    `parseWadl` directly with in-memory strings). The unit-test file does not
    mock any I/O, proving the parser does not perform any.
- **Spec:** "Namespace gating: rejects non-WADL XML; returns
  `parseError: 'unsupported_wadl_namespace'` (no throw)."
  - `wadlParser.test.ts`: `unsupportedNamespaceReturnsParseError`.
- **Spec:** "Soft-fail on malformed XML: catches `fast-xml-parser` errors and
  returns `parseError` populated."
  - `wadlParser.test.ts`: `malformedXmlSoftFails`.
- **Spec:** "Multi-`<resources base="...">` support: each top-level block
  contributes its own `baseUrl` to operations."
  - `restWadlEndToEnd.test.ts`: G7-5 (`multi-<resources base> blocks emit
    endpoints with per-op baseUrl`).
- **Spec:** "Walker scope: `<resources>` -> `<resource>` (recurse) ->
  `<method>` -> `<request>`/`<response>` -> `<param>` + `<representation>`."
  - `wadlParser.test.ts`: `nestedResourceFlattening`,
    `parsesAnonymisedJerseyFixture` (full nested walk).
- **Spec:** "Each `<method>` carries `compositeId = ${method} ${path}`."
  - `wadlParser.test.ts`: `parsesAnonymisedJerseyFixture` asserts the four
    expected compositeIds; Group 6 fixture 1 re-asserts at the e2e boundary.

### Parameter and representation extraction

- **Spec:** "All four `<param>` styles parsed: template, query, header,
  matrix."
  - `wadlParser.test.ts`: `allFourParamStylesParsed`.
- **Spec:** "Type fallback: missing/blank `type` -> literal `'unknown'`;
  unrecognised XSD-prefixed types stored verbatim."
  - `wadlParser.test.ts`: `docCarryThrough` (asserts `missingType -> unknown`,
    `blankType -> unknown`, `customType -> 'customNs:Foo'` verbatim).
- **Spec:** "WadlParam shape: `{ name, style, type, required }`."
  - `wadlEndpointEmitter.test.ts`: payload-shape test re-asserts shape on
    detailJson; Group 7 G7-2 covers `required` parsing edge cases
    (`true / false / absent`).
- **Spec (parser default behaviour):** missing `style` attribute.
  - Group 7 G7-1: `<param>` with no style defaults to `'query'` (v1 contract).
- **Spec:** "`schemaElementRef` -- `element=` attribute value with any XML
  namespace prefix stripped."
  - `wadlParser.test.ts`: `parsesAnonymisedJerseyFixture` (asserts
    `schemaElementRef === 'filteredHierarchyRequestInfo'` after the `ns2:`
    prefix is stripped).
- **Spec:** `<representation>` without `element` attribute.
  - Group 7 G7-8: rep with no `element` -> `schemaElementRef = null`,
    `resolvedSchemaElementName = null`, no missing-element gap.

### Sibling XSD grammar resolution

- **Spec:** "For each declared grammar path, look up in `relatedFiles`; on
  hit, parse via `fast-xml-parser` and index top-level `<xs:element name>`."
  - `wadlParser.test.ts`: `parsesAnonymisedJerseyFixture` (sibling XSD wired
    via `opts.relatedFiles`; representations resolved); Group 6 fixture 1
    re-asserts at the orchestrator boundary.
- **Spec:** "If the file is absent OR present-but-unparseable, add the
  original href to `missingGrammars`."
  - `wadlParser.test.ts`: `grammarMissEmitsMissingGrammar` (absent case);
    Group 6 fixture 3 covers the orchestrator-level absent case.
- **Spec:** "Absolute URLs (`http://...`) silently skipped."
  - Anchored by `wadlParser.ts`'s `isAbsoluteUrl` guard; the parser's
    behaviour is exercised end-to-end by every test that loads a fixture (no
    test asserts an absolute-URL include lands on `missingGrammars`). Marked
    as a SMALL residual gap below (not critical: production WADL almost never
    declares absolute-URL includes; the guard's regex is one line and unit-
    testable by future spec amendment if needed).
- **Spec:** "Resolved-but-unparseable XSD treated identically to absent (no
  separate `wadl_grammar_parse_failed` kind)."
  - Indirectly anchored: the parser's `indexGrammarElements` helper returns
    `null` on throw, routing to the same `missingGrammars` bucket. The
    behaviour is unit-testable via a malformed-XSD fixture (residual gap;
    same risk profile as the absolute-URL case).

### Endpoint emitter (`wadlEndpointEmitter.ts`)

- **Spec:** "One `interface_definition` finding per WADL file using
  `applicationTitle` + concatenated `<application>/<doc>` as description."
  - `wadlEndpointEmitter.test.ts`: `happyPathInterfacePlusEndpoints`,
    `descriptionCarryThrough` (interface doc -> summary), `payloadShape`.
- **Spec:** "One `endpoint` finding per `WadlOperation` with `compositeId` as
  identifier and operation `doc` as description."
  - `wadlEndpointEmitter.test.ts`: same suite covers payload shape +
    description.
- **Spec:** "`payload_json` shape mirrors WSDL pack: `{ method, path, baseUrl,
  params, request, response, methodId? }`."
  - `wadlEndpointEmitter.test.ts`: `payloadShape` test.
- **Spec:** "Emission ordering per file: `interface_definition` first, then
  `endpoint` findings in document order, then evidence-gap findings last."
  - `wadlEndpointEmitter.test.ts`: `happyPathInterfacePlusEndpoints` covers
    interface-first ordering; Group 6 fixture 1 covers the
    interface->endpoints->no-gap order at the orchestrator boundary;
    Group 6 fixture 3 covers the interface->endpoints->gaps order.
- **Spec:** "No cross-file deduplication: two WADL files with the same
  `compositeId` emit two separate findings."
  - `restWadlIndex.test.ts`: `two WADL files in same input` test.
- **Spec:** "Empty operations list -> still emits zero endpoint findings; no
  throw."
  - `wadlEndpointEmitter.test.ts`: `empty operations list` test.
  - Group 7 G7-3 covers the related case (resource with no methods) at the
    orchestrator boundary.
- **Spec:** "Emitter never throws; soft-fails on malformed input."
  - `wadlEndpointEmitter.test.ts`: `parseError handling` tests confirm the
    emitter returns `[]` when `parseError` is set; the gap emitter owns the
    failure case.

### Evidence-gap findings (`wadlEvidenceGaps.ts`)

- **Spec:** "Four sentinels: `wadl_parse_failed`,
  `wadl_unsupported_namespace`, `wadl_missing_grammar`,
  `wadl_missing_schema_element`."
  - `wadlEvidenceGaps.test.ts`: one test per sentinel
    (`parseError=malformed_xml` -> `wadl_parse_failed`,
    `parseError=unsupported_wadl_namespace` -> `wadl_unsupported_namespace`,
    `missingGrammars` -> `wadl_missing_grammar`, `missingSchemaElements` ->
    `wadl_missing_schema_element`).
- **Spec:** "Use the existing centralised gap-finding builder pattern; mirror
  `soapEvidenceGaps.ts`; register the four sentinels in the central
  `EvidenceGapType` union."
  - `wadlEvidenceGaps.test.ts`: `emissionSources.ts gap-kind registration`
    test (regex-matches all four sentinels in the union + verifies
    `buildWadlEvidenceGapFinding` is exported).
- **Spec:** "Empty parse result -> empty array (no spurious emissions)."
  - `wadlEvidenceGaps.test.ts`: `empty parse result` test.

### Pack orchestration (`restWadl/index.ts`)

- **Spec:** "Empty IR (no `.wadl` files) yields `{ findings: [] }` cleanly."
  - `restWadlIndex.test.ts`: empty-IR test; also Group 7 G7-10 at the
    scanner-level wrapper boundary.
- **Spec:** "Single WADL with no sibling XSD -> `wadl_missing_grammar` gap;
  structural + gap findings concatenated in spec-Q9 order."
  - `restWadlIndex.test.ts` doesn't cover this case directly; Group 6
    fixture 3 covers it at the e2e boundary.
- **Spec:** "Two WADL files in same input -> each produces its own findings."
  - `restWadlIndex.test.ts`: two-WADL test.
- **Spec:** "Pack registered alongside `runSpringClassicSoapPass` in
  `springClassicFindingScanner.ts`; SOAP-only and REST-only inputs produce
  zero WADL findings; WADL-only inputs produce zero SOAP candidates."
  - Group 6 fixture 2: scanner-level coexistence verified.
  - Group 7 G7-10: empty IR at the scanner-level wrapper boundary.
  - Pre-existing `springClassicFindingScannerSoapWiring.test.ts` covers the
    inverse (SOAP/REST inputs producing zero WADL findings is implicit; the
    `wadlFindings` field returns `[]` in every test that doesn't supply a
    `.wadl` IR).
- **Spec:** "Sibling-resolution map built from every `.xsd` IR entry under
  multiple key variants (full path / basename / wadl-relative)."
  - `restWadlIndex.test.ts`: single-WADL-with-sibling-XSD test (proves
    basename-keyed lookup hits when WADL declares
    `<include href="xsd0.xsd"/>`).

### Cross-cutting coverage gaps closed in Group 7

| Gap | Test |
| --- | --- |
| Missing `style` attribute on `<param>` defaults to `'query'` | G7-1 |
| `required="true"` vs `"false"` vs absent parsing | G7-2 |
| `<resource>` with no `<method>` children (no crash) | G7-3 |
| `<method>` with no `<request>`/`<response>` (empty arrays) | G7-4 |
| Multi-`<resources base>` blocks (per-op baseUrl) | G7-5 |
| `<doc>` with nested elements (mixed content fold) | G7-6 |
| Application-level `<param>` ignored in v1 | G7-7 |
| `<representation>` without `element` attribute | G7-8 |
| WADL_DOC_ONLY interface-only edge case (uses pre-existing fixture) | G7-9 |
| Scanner-level pack registration with empty IR | G7-10 |

## Residual Gaps (NOT closed)

These were considered during the Group 7 review but intentionally left
uncovered. Each is documented with a rationale so future maintainers can
re-assess.

1. **Absolute-URL `<include href="http://...">` silently skipped.** The
   parser's `isAbsoluteUrl` regex is one line. Production WADL rarely
   declares absolute-URL grammar includes (the spec lists this as out-of-
   scope: "Cross-network XSD fetching - relative file-map lookups only;
   absolute URLs silently skipped"). Low business risk. A unit test can be
   added in a follow-up if the predicate ever needs to broaden.

2. **Resolved-but-unparseable XSD treated identically to absent.** The
   parser's `indexGrammarElements` helper returns `null` on
   `fast-xml-parser` throw, routing to `missingGrammars` -- but no test
   loads a deliberately malformed XSD via `opts.relatedFiles`. Same risk
   profile as item 1: the behaviour is contractually documented in spec Q2
   and the implementation is a single `try/catch` returning `null`.

3. **Multi-WADL ordering across files (cross-file determinism).** The
   orchestrator processes WADL IR entries in `irFiles.values()` iteration
   order; the two-WADL test covers the count + per-file shape, but does not
   assert a stable file-processing order across runs. Iteration order of
   `Map` is insertion order in modern JS engines, so the contract is
   implicitly stable; no test pins this. Acceptable for v1.

4. **No `wadl_parse_failed` end-to-end test driven through the orchestrator
   wrapper.** The unit-level `wadlEvidenceGaps.test.ts` covers the gap
   builder; Group 6 fixture 3 covers `wadl_missing_grammar` end-to-end. An
   end-to-end test for the `wadl_parse_failed` + `wadl_unsupported_namespace`
   paths through `runRestWadlPass` could be added but the gap-builder unit
   test already proves the bridge, and the orchestrator's parse-error path
   is a single switch in `index.ts`. Low residual risk.

## Verification Commands

```bash
# All feature-specific tests (40 tests, expected to pass):
cd discovery-service
npx jest src/services/findings/packFindingScanners/restWadl/ src/__tests__/restWadlEndToEnd.test.ts --no-coverage

# SOAP pack regression smoke (43 tests, expected to pass):
npx jest --testPathPattern springClassicSoap --no-coverage

# Scanner-level SOAP wiring regression (3 tests, expected to pass):
npx jest src/__tests__/springClassicFindingScannerSoapWiring.test.ts --no-coverage
```
