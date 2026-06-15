The discovery-service has a deterministic WSDL parser at `discovery-service/src/services/findings/packFindingScanners/springClassicSoap/wsdlParser.ts` that walks SOAP `<wsdl:portType>` / `<operation>` / `<xsd:element>` and emits structured `interface_definition` + `endpoint` Findings/Evidence rows. There is no equivalent for WADL.

The earlier "discovery-service library + WADL fixes" round added `.wadl` to `SOURCE_EXTENSIONS` so WADL files reach the scan plan and the LLM analysis step. The LLM correctly extracts endpoints from WADL when it sees the bytes. But Tier-A/B atom-driven analysis is missing — WADL operations don't produce structured Findings/Evidence the way WSDL operations do, so cross-referencing them against discovery findings, mappings, or API baselines is weaker, and every regenerate burns LLM tokens re-deriving them.

This feature builds a deterministic WADL parser pack mirroring the WSDL pack's structure. The WADL bytes go through fast-xml-parser, the parser walks resources/methods/params/representations/grammars, and emits the same `interface_definition` + `endpoint` finding kinds the WSDL pack emits.

Working assumptions (already agreed with user, treat as decided):

1. Pack location: new sibling `discovery-service/src/services/findings/packFindingScanners/restWadl/`. Framework-agnostic name.
2. WADL version: W3C namespace `http://wadl.dev.java.net/2009/02` (Jersey 1.x/2.x). Other namespaces emit `wadl_unsupported_namespace`.
3. XSD/grammar resolution: yes, via caller-supplied file map (mirror WSDL parser's `opts.relatedFiles` pattern). Absolute URLs skipped.
4. Operation identifier: composite `method + ' ' + path` (e.g. `POST /hierarchynodes/{grdOrgId}`). `<method id="...">` retained as secondary identifier.
5. Parameter extraction: all four `<param>` styles (template / query / header / matrix) with `{ name, style, type, required }`.
6. Representation extraction: per `<request>` / `<response>`, `{ mediaType, schemaElementRef }`. Link to resolved grammar element when possible.
7. Multi-resource: flatten nested `<resource>` via path concatenation against outer `<resources base>`.
8. Finding shape: reuse existing kinds — `interface_definition` per WADL file; `endpoint` per `<method>`.
9. Evidence-gap kinds: `wadl_parse_failed`, `wadl_missing_grammar`, `wadl_missing_schema_element`, `wadl_unsupported_namespace` via sibling `wadlEvidenceGaps.ts`.
10. Pack activation: always active. Soft-skip files without WADL namespace. No core_tech gating.

Out of scope:
- WADL 1.0 pre-W3C drafts
- `<application>` extension metadata (Jersey-specific extras)
- `<doc>` LLM summarisation (literal pass-through only)
- `<fault>` blocks (v2)
- Live OAS<->WADL translation
- Auto-generation of WADL from code
- Cross-network XSD resolution
- Schema validation conformance

Services touched:
- discovery-service: new `restWadl/` pack module (`wadlParser.ts`, `wadlEndpointEmitter.ts`, `wadlEvidenceGaps.ts`, `index.ts`); orchestration wiring next to `springClassicSoap`; fast-xml-parser already a dep.
- AMS / gateway / frontend: no changes. Findings flow through existing emission channel.

Inputs: WADL file bytes; sibling .xsd files via file map; run context.
Outputs: `interface_definition` Finding per WADL file; `endpoint` Finding per `<method>` (composite path + params + representations + optional schema element); evidence rows; evidence-gap findings.

## Visual Assets

No visual assets provided. Visuals folder check returned no files. This feature is a backend parser module with no UI surface, so no visuals are required.

## Confirmed product decisions (from clarifying answers)

The 10 clarifying questions in `clarifying-questions.md` were all confirmed at the recommended default. Full verbatim text lives in `clarifying-answers.md`. Decisions summarised here for the spec-writer:

1. **Test fixtures.** Anonymise the user's existing Jersey 1.16 WADL sample (rename app-specific identifiers, strip hostnames) as the primary integration fixture. Supplement with 2-3 small synthesised WADL snippets covering: missing grammar, unsupported namespace, multi-resource nesting.

2. **XSD parse failure.** A sibling .xsd that exists but fails to parse emits the existing `wadl_missing_grammar` gap kind. Treat "unusable grammar" identically to "no grammar". No new `wadl_grammar_parse_failed` kind.

3. **Application-level `<doc>`.** Concatenate `<application>/<doc>` text and store it on the `interface_definition` Finding's `description` field. Literal pass-through, no LLM summarisation.

4. **Resource and method `<doc>`.** Concatenate any `<doc>` inside `<resource>` or `<method>` and attach to the owning `endpoint` Finding's `description` field. Same literal pass-through rule as #3.

5. **Duplicate operations across files.** No parser-level deduplication. If two WADL files in the same scan produce the same composite identifier (e.g. `POST /foo/{id}`), each emits its own `endpoint` Finding scoped to its source file. Cross-file reconciliation is a downstream concern.

6. **Multiple `<resources base="...">` blocks.** Emit one `interface_definition` per WADL file. Each `endpoint` Finding carries its specific `baseUrl`. Do not split into multiple `interface_definition` rows per base URL.

7. **`endpoint` evidence `payload_json` shape.** Mirror the WSDL pack as closely as possible: `{ method, path, baseUrl, params: [...], request: {...}, response: {...}, methodId? }`. Nest WADL-specific fields (param styles, representations) under predictable keys inside that envelope.

8. **Parameter type fallback.** Missing or blank `<param type>` attributes are normalised to the literal string `"unknown"`. Unrecognised XSD-prefixed values are stored verbatim (raw string) so downstream consumers decide how to interpret.

9. **Finding emission ordering.** Per WADL file: `interface_definition` first, then all `endpoint` Findings in document order (top-to-bottom resource tree walk), then any evidence-gap findings last.

10. **Test coverage split.** 5-8 unit tests on `wadlParser.ts` covering namespace gating, param styles, nested resources, grammar resolution hit/miss, malformed XML, and doc pass-through. Plus 2-3 integration tests at the scanner level covering a full WADL file in, Findings/Evidence out, and end-to-end behaviour with a sibling XSD.
