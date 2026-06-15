# Clarifying Answers: WADL Deterministic Parser

All 10 clarifying questions confirmed at the recommended default. Recorded verbatim below for spec-writer use.

---

## Q1. Test fixture source

**Question:** I assume we anonymise the user's existing Jersey 1.16 WADL sample (rename app-specific identifiers, strip hostnames) and use it as the primary integration fixture, supplemented by 2-3 small synthesised WADL snippets for edge cases (missing grammar, unsupported namespace, multi-resource nesting). Is that correct, or should we go fully synthesised to avoid any risk of leaking real schema names?

**Confirmed answer:** Anonymise the user's existing Jersey 1.16 WADL sample (rename app-specific identifiers, strip hostnames) and use it as the primary integration fixture, supplemented by 2-3 small synthesised WADL snippets for edge cases (missing grammar, unsupported namespace, multi-resource nesting).

---

## Q2. XSD grammar parse-failure UX

**Question:** I assume when a sibling .xsd is found but fails to parse, we emit the existing `wadl_missing_grammar` gap kind (treating "unusable grammar" as the same outcome as "no grammar"), rather than introducing a new `wadl_grammar_parse_failed` kind. Agree, or would you prefer the more granular kind so failure-mode telemetry can be separated later?

**Confirmed answer:** When a sibling .xsd is found but fails to parse, emit the existing `wadl_missing_grammar` gap kind. Treat "unusable grammar" as the same outcome as "no grammar". Do not introduce a new `wadl_grammar_parse_failed` kind.

---

## Q3. WADL `<doc>` content carry-through to interface description

**Question:** I assume the top-level `<application>/<doc>` text (if present) is concatenated and stored as the `interface_definition` Finding's `description` field, literal pass-through with no LLM summarisation. Agree, or should we drop `<doc>` entirely at parse time and let the LLM step pick it up later?

**Confirmed answer:** Top-level `<application>/<doc>` text (if present) is concatenated and stored as the `interface_definition` Finding's `description` field. Literal pass-through with no LLM summarisation.

---

## Q4. Per-resource `<doc>` carry-through to endpoint description

**Question:** I assume any `<doc>` inside `<resource>` or `<method>` is concatenated and attached to the resulting `endpoint` Finding's `description` field (same literal pass-through rule as Q3). Agree, or should per-operation `<doc>` be ignored to keep endpoint rows lean?

**Confirmed answer:** Any `<doc>` inside `<resource>` or `<method>` is concatenated and attached to the resulting `endpoint` Finding's `description` field. Same literal pass-through rule as Q3.

---

## Q5. Operation deduplication across multiple WADL files

**Question:** I assume if two WADL files in the same scan emit the same composite identifier (`POST /foo/{id}`), each emits its own `endpoint` Finding scoped to its source file (no dedup at parser level — downstream consumers handle cross-file reconciliation). Agree, or should the parser detect intra-run collisions and emit a `wadl_duplicate_operation` gap?

**Confirmed answer:** If two WADL files in the same scan emit the same composite identifier (`POST /foo/{id}`), each emits its own `endpoint` Finding scoped to its source file. No dedup at parser level. Downstream consumers handle cross-file reconciliation.

---

## Q6. Multi-`<resources>` (multiple base URLs) emission

**Question:** I assume when a WADL has multiple `<resources base="...">` blocks (multiple base URLs in one file), we emit one `interface_definition` per WADL file and tag each `endpoint` Finding with its specific `baseUrl`, rather than splitting into multiple `interface_definition` rows per base URL. Agree, or should each `<resources base>` become its own `interface_definition`?

**Confirmed answer:** When a WADL has multiple `<resources base="...">` blocks (multiple base URLs in one file), emit one `interface_definition` per WADL file and tag each `endpoint` Finding with its specific `baseUrl`. Do not split into multiple `interface_definition` rows per base URL.

---

## Q7. Evidence row `payload_json` shape

**Question:** I assume the `endpoint` evidence row `payload_json` mirrors the WSDL pack's shape as closely as possible: `{ method, path, baseUrl, params: [...], request: {...}, response: {...}, methodId? }`, with WADL-specific fields (params styles, representations) nested under predictable keys. Agree, or do you want a documented schema reviewed before implementation?

**Confirmed answer:** The `endpoint` evidence row `payload_json` mirrors the WSDL pack's shape as closely as possible: `{ method, path, baseUrl, params: [...], request: {...}, response: {...}, methodId? }`, with WADL-specific fields (params styles, representations) nested under predictable keys.

---

## Q8. Parameter type fallback when `<param type>` is missing or unrecognised

**Question:** I assume missing/blank `type` attributes are stored as the literal string `"unknown"` (normalised), and any unrecognised XSD-prefixed value is stored verbatim (raw string) so downstream consumers can decide how to interpret. Agree, or should both cases be normalised to `"unknown"` for consistency?

**Confirmed answer:** Missing/blank `type` attributes are stored as the literal string `"unknown"` (normalised). Any unrecognised XSD-prefixed value is stored verbatim (raw string) so downstream consumers can decide how to interpret.

---

## Q9. Finding emission ordering

**Question:** I assume the parser emits the `interface_definition` Finding first, then all `endpoint` Findings in document order (top-to-bottom resource tree walk), then any evidence-gap findings last. Agree, or is there a downstream consumer that requires a different ordering (e.g. gaps interleaved with their owning endpoint)?

**Confirmed answer:** The parser emits the `interface_definition` Finding first, then all `endpoint` Findings in document order (top-to-bottom resource tree walk), then any evidence-gap findings last.

---

## Q10. Test coverage scope

**Question:** I assume the pack ships with 5-8 unit tests on `wadlParser.ts` (namespace gating, param styles, nested resources, grammar resolution hit/miss, malformed XML, doc pass-through) plus 2-3 integration tests at the scanner level (full WADL file in, Findings/Evidence out, end-to-end with sibling XSD). Agree, or do you want a different split (more integration, more unit)?

**Confirmed answer:** The pack ships with 5-8 unit tests on `wadlParser.ts` (namespace gating, param styles, nested resources, grammar resolution hit/miss, malformed XML, doc pass-through) plus 2-3 integration tests at the scanner level (full WADL file in, Findings/Evidence out, end-to-end with sibling XSD).
