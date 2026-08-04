# Specification: WADL Deterministic Parser

## Goal
Add a deterministic WADL parser pack to discovery-service that mirrors the existing WSDL pack, emitting structured `interface_definition` and `endpoint` Findings (plus evidence-gap findings) per WADL file so REST APIs described in Jersey-style WADL produce the same cross-reference quality as SOAP services, without burning LLM tokens on every regenerate.

## User Stories
- As a discovery operator running a scan against a Jersey codebase, I want WADL files to produce structured endpoint Findings deterministically so the resulting cross-references and API baselines do not rely on LLM re-derivation each run.
- As an architect reviewing discovery output, I want every WADL operation to surface with its full path, parameters, representations, and (where resolvable) schema element so I can reconcile findings against mappings and OpenAPI specs.

## Specific Requirements

**New pack module `restWadl/`**
- Create `discovery-service/src/services/findings/packFindingScanners/restWadl/` as a sibling of `springClassicSoap/`.
- Mirror the WSDL pack's file layout 1:1: `wadlParser.ts`, `wadlEndpointEmitter.ts`, `wadlEvidenceGaps.ts`, `index.ts`.
- Framework-agnostic naming - the pack is named after the file format, not Jersey.
- Pack is always active; no `core_tech` gating. Files without the WADL namespace are soft-skipped.

**Pure WADL parser (`wadlParser.ts`)**
- Public function `parseWadl(source: string, opts: ParseWadlOptions): WadlParseResult` built on `fast-xml-parser`.
- No `fs`, no `http`, no `process` usage - caller supplies bytes plus optional `opts.relatedFiles: Map<string, string>` for sibling XSD resolution.
- Walker scope: `<resources>` -> `<resource>` (recurse) -> `<method>` -> `<request>`/`<response>` -> `<param>` + `<representation>`.
- Namespace gating: rejects non-WADL XML by checking root `<application>` element namespace; anything other than `http://wadl.dev.java.net/2009/02` returns `parseError: 'unsupported_wadl_namespace'` (no throw).
- Soft-fail on malformed XML: catches `fast-xml-parser` errors and returns `parseError` populated with empty operations list.
- Multi-`<resources base="...">` support: each top-level block contributes its own `baseUrl` to operations emitted underneath; nested `<resource path>` segments are flattened via path concatenation.

**Parser output shape (`WadlParseResult`)**
- `interfaces: WadlInterface[]` - one entry per WADL file's `<application>` element with `applicationTitle`, `version`, concatenated `doc`, and declared `grammarPaths`.
- `operations: WadlOperation[]` - flattened list of every `<method>` carrying `compositeId` (`${method} ${path}`), `methodId`, `httpMethod`, `path`, `baseUrl`, `params`, `request`/`response` representations, concatenated `doc` (method + parent resource), and best-effort `sourceLine`.
- `parseError?: string` - set on XML failure or unsupported namespace; never thrown.
- `missingGrammars: string[]` - `<grammars><include href>` entries unresolved in `relatedFiles` OR resolved but failed to parse (treated identically per Q2).
- `missingSchemaElements: { ref: string; sourceOperationId: string }[]` - `<representation element="X"/>` refs that did not resolve in any loaded grammar.

**Parameter and representation extraction**
- `WadlParam` shape: `{ name: string; style: 'template'|'query'|'header'|'matrix'; type: string; required: boolean }`. All four `<param>` styles parsed.
- Type fallback: missing/blank `type` -> literal `"unknown"`; unrecognised XSD-prefixed types stored verbatim (Q8).
- `WadlRepresentation` shape: `{ mediaType: string | null; schemaElementRef: string | null; resolvedSchemaElementName: string | null }`.
- When `schemaElementRef` appears in a resolved grammar file's `<xs:element name="X">`, populate `resolvedSchemaElementName`; otherwise leave null and add to `missingSchemaElements`.

**Endpoint emitter (`wadlEndpointEmitter.ts`)**
- Input: `WadlParseResult` plus run/file/project context; output: `FindingEmitInput[]` ready for `FindingEmitter.emitFindings(...)`.
- One `interface_definition` Finding per WADL file using `applicationTitle` + concatenated `<application>/<doc>` as description (Q3, Q6).
- One `endpoint` Finding per `WadlOperation` with description from operation-level `doc` (Q4), identifier from `compositeId`, and `methodId` as secondary identifier.
- `payload_json` shape mirrors WSDL pack: `{ method, path, baseUrl, params: [...], request: { representations: [...] }, response: { representations: [...] }, methodId? }` (Q7).
- Evidence rows per Finding link back to the source WADL file path.
- Emission ordering per file: `interface_definition` first, then `endpoint` Findings in document order (top-to-bottom resource tree walk), then evidence-gap findings last (Q9).
- No cross-file deduplication: duplicate `compositeId` across two WADL files emits two separate `endpoint` Findings, each scoped to its source (Q5).

**Evidence-gap findings (`wadlEvidenceGaps.ts`)**
- `wadl_parse_failed` - emitted when `parseError` is set (other than unsupported namespace).
- `wadl_unsupported_namespace` - emitted when root `<application>` namespace check fails.
- `wadl_missing_grammar` - one per entry in `missingGrammars` (covers both "file not in map" and "found but parse-failed" per Q2; no separate `wadl_grammar_parse_failed` kind).
- `wadl_missing_schema_element` - one per entry in `missingSchemaElements`.
- Use the existing centralised gap-finding builder pattern (mirror `soapEvidenceGaps.ts`); register the four new `gapType` sentinels in the central `EvidenceGapType` union.

**Pack orchestration wiring (`restWadl/index.ts`)**
- Export a public entry function matching the springClassicSoap pack's signature (e.g. `runRestWadlPass(input: PackFindingScannerInput): RestWadlPassOutput`).
- Walk `input.irFiles` for `.wadl`-suffixed entries with `rawContent`; build a `relatedFiles` map from sibling `.xsd` entries the same way the SOAP pack does.
- Log structured diagnostics matching the WSDL pack's `[diag-pack] scanner=rest_wadl ...` line style at pass start, per-file parse, and per-gap emission.
- Register the new pack alongside `springClassicSoap` in the orchestration call site (`springClassicFindingScanner.ts` or sibling registry - locate by searching for the WSDL pack's import) so the pack runs as part of the standard pack-finding scanner fan-out.

**Sibling XSD grammar resolution**
- Resolution model mirrors WSDL pack: caller-supplied `relatedFiles` map keyed by relative path; absolute URLs in `<grammars><include href>` silently skipped.
- For each declared grammar path, look up in `relatedFiles`; if found, parse via `fast-xml-parser` and index top-level `<xs:element name="X">` declarations.
- If the file is absent OR present-but-unparseable, add the original href to `missingGrammars` (one entry per failure mode, no distinction per Q2).

## Existing Code to Leverage

**`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/wsdlParser.ts`**
- Reference implementation of a pure, `fast-xml-parser`-based deterministic XML parser with soft-fail behaviour and caller-supplied `relatedFiles` map for relative schema resolution.
- WADL parser follows the same module shape (public types, `parseWadl` function signature, `parseError` short-circuit pattern, no `fs`/`http` usage).

**`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEndpointEmitter.ts`**
- Reference for mapping parser output to `FindingEmitInput[]` with `interface_definition` + `endpoint` finding kinds.
- WADL emitter mirrors `payload_json` envelope shape (`method`, `path`, `baseUrl`, `params`, `request`, `response`) and evidence-row attachment.

**`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/soapEvidenceGaps.ts`**
- Reference for translating parser failure modes into `evidence_gap` Findings via the centralised `buildSoapEvidenceGapFinding`-style helper.
- WADL gap builder follows the same pure-helper shape, plugging into the same `FindingEmitter.emitFindings` flow with no parallel pipeline.

**`discovery-service/src/services/findings/packFindingScanners/springClassicSoap/index.ts`**
- Reference for the pack entry point: IR file walk to extract WADL + XSD sources, `relatedFiles` map construction, parser invocation per file, emitter call, structured diagnostic logging.
- WADL pack `index.ts` mirrors this orchestration verbatim (with WADL-specific log prefix and file-extension predicate).

**`discovery-service/src/services/findings/emissionSources.ts`**
- Houses the centralised evidence-gap-finding builders. Add the four new WADL `gapType` sentinels and any builder helper here so the WADL pack emits through the shared channel (P-1 / P-12 contract - no parallel emitter).

## Out of Scope
- AMS / gateway / frontend changes - Findings flow through the existing emission channel; no schema or UI work.
- `SOURCE_EXTENSIONS` in `scanPlanBuilder.ts` - `.wadl` is already wired in an earlier change.
- Modifications to the WSDL pack itself - it remains the reference implementation, untouched.
- WADL 1.0 pre-W3C draft formats.
- `<application>` extension metadata (Jersey-specific extras beyond the standard W3C 2009/02 namespace).
- `<doc>` LLM summarisation - literal pass-through only.
- `<fault>` blocks - deferred to v2.
- Cross-network XSD fetching - relative file-map lookups only; absolute URLs silently skipped.
- Live OAS<->WADL translation, schema validation conformance, or auto-generation of WADL from code.
- Cross-file operation deduplication - duplicate composite IDs across files each emit their own Finding.

## Testing

**Unit tests on `wadlParser.ts` (5-8 tests, per Q10)**
- Namespace gating returns `parseError: 'unsupported_wadl_namespace'` for wrong namespace.
- All four `<param>` styles (template, query, header, matrix) parsed with correct `style` value.
- Nested `<resource>` elements flatten path correctly against outer `<resources base>`.
- Grammar resolution hit: sibling XSD in `relatedFiles` with matching `<xs:element name>` populates `resolvedSchemaElementName`.
- Grammar resolution miss: grammar href absent from map produces entry in `missingGrammars`; element ref produces entry in `missingSchemaElements`.
- Malformed XML soft-fails: returns `parseError`, no throw.
- `<doc>` content carry-through to both `WadlInterface.doc` and `WadlOperation.doc`.
- Parameter type fallback: missing/blank type -> `"unknown"`; custom prefixed type stored verbatim.

**Integration tests at the scanner level (2-3 tests, per Q10)**
- Full anonymised Jersey 1.16 WADL fixture in -> one `interface_definition` Finding + N `endpoint` Findings out in correct ordering.
- WADL + sibling `xsd0.xsd` in `relatedFiles` -> `resolvedSchemaElementName` populated end-to-end on representations.
- WADL with declared grammar href but no sibling XSD -> `wadl_missing_grammar` gap finding emitted.

**Test fixtures**
- Anonymise the user's existing Jersey 1.16 WADL sample: `SampleSvc Service Version` -> `SampleSvc Service Version`, all hostnames stripped (per Q1).
- Place under `discovery-service/src/__tests__/fixtures/wadl/` along with a minimal matching `xsd0.xsd` for the grammar-resolution integration test.
- Supplement with 2-3 small synthesised WADL snippets covering: missing grammar, unsupported namespace, multi-resource nesting.

## Success Criteria
- Running discovery against a repo containing a WADL file produces one `interface_definition` Finding for the file and one `endpoint` Finding per `<method>`, with `compositeId` = `${method} ${path}` and full param + representation payload.
- Subsequent regenerate runs do not re-derive WADL endpoints via the LLM step (deterministic Findings persist via existing emission channel).
- Sibling XSD references resolve when files are co-located in the scan; missing grammars and missing schema elements each surface as their dedicated `evidence_gap` finding kind.
- The new pack runs alongside `springClassicSoap` without interfering with the SOAP pass; REST-only WADL inputs produce zero SOAP candidates and SOAP-only inputs produce zero WADL findings.
- All 5-8 unit tests and 2-3 integration tests pass; the anonymised Jersey fixture round-trips through parser + emitter + evidence-gap builder without throwing.

## Traceability to Confirmed Decisions
- Q1 (Test fixtures) -> Testing section: anonymised Jersey 1.16 sample + synthesised edge-case snippets.
- Q2 (XSD parse failure -> existing gap kind) -> Evidence-gap findings: `wadl_missing_grammar` covers both absence and parse-failure; no new `wadl_grammar_parse_failed` kind.
- Q3 (`<application>/<doc>` -> interface description) -> Endpoint emitter: literal pass-through of concatenated `<application>/<doc>` text to `interface_definition.description`.
- Q4 (Resource/method `<doc>` -> endpoint description) -> Endpoint emitter: concatenated `<resource>`/`<method>` `<doc>` text attached to `endpoint.description`.
- Q5 (No cross-file dedup) -> Endpoint emitter: each WADL file emits its own Findings; downstream consumers reconcile collisions.
- Q6 (Multi-`<resources>` -> one interface per file) -> Parser output / emitter: one `interface_definition` per WADL file; per-operation `baseUrl` carries the specific base.
- Q7 (`payload_json` mirrors WSDL pack) -> Endpoint emitter: documented envelope shape.
- Q8 (Param type fallback) -> Parameter extraction: missing -> `"unknown"`; unrecognised -> verbatim.
- Q9 (Emission ordering) -> Endpoint emitter: interface first, endpoints in document order, gaps last.
- Q10 (Test coverage split) -> Testing section: 5-8 unit + 2-3 integration.
