# Specification: Spring Classic code-evidence format extraction (Java types + global date-format)

## Goal
Make the discovery Spring Classic pack extract data-type formats from where classic Java code actually keeps them -- the Java field/param TYPES and the ONE global converter-level date format -- and feed them through `request_contract.param_formats` (plus a new top-level `inferred_date_format`) into the amvs data-type-defaults classifier's code-evidence column and Col-4 seed. Deterministic (no LLM), additive (no DB/schema change).

## User Stories
- As a migration analyst running the API Baseline wizard against a classic Spring codebase, I want Step 5 "Data-type formats" -> "Code Format(s)" to populate from Java types and the project's global date converter (not just `@JsonFormat`/`@DateTimeFormat`), so that an un-annotated `LocalDate businessDate` surfaces its real `dd-MMM-yyyy` wire format instead of a blank cell.
- As that analyst, I want a `BigDecimal amount`, a `Long id`, a `UUID`, and a Java enum -- none of them annotated -- to classify into decimal / numeric_id / uuid / enum from the CODE scan, so that the seeded defaults reflect the actual source types.
- As a platform engineer, I want these richer code-evidence entries to NEVER override a real OAS `format: date` with a bare type token, so that the existing annotation->OAS-override behaviour does not regress.

## Specific Requirements

**SIGNAL #1 -- emit type-only `param_formats` entries (discovery `requestContractScanner.ts`)**
- Add a dedicated `javaType` field to `ParamFormatEntry` (currently `{ name, location, format, pattern, source }`, ~170-177).
- In `readParamFormats` (~479-515) emit a `param_formats` entry for a param/DTO field EVEN WHEN `readFormatAnnotation` returns null, carrying the Java type from the IR (`ParameterIR.type` / `FieldIR.type`, already available via `RequestParamEntry.type` ~157-162).
- The annotation path (`readFormatAnnotation` ~419-452) is UNCHANGED; annotation entries keep populating `format`/`pattern`/`source`. The new path adds type-only entries (no `format`/`pattern`).
- A type-only entry carries `source: 'java-type'` and the resolved `javaType`; it leaves `format`/`pattern` null. NEVER stuff the type into `format`/`pattern`.

**SIGNAL #1 -- Java type -> data-type category mapping (deterministic)**
- `LocalDate` -> date; `LocalDateTime`/`Instant`/`OffsetDateTime`/`ZonedDateTime`/`Date`/`Timestamp`/`Calendar` -> datetime; `LocalTime` -> time.
- `BigDecimal`/`double`/`Double`/`float`/`Float` -> decimal; `long`/`Long`/`int`/`Integer`/`short`/`Short`/`BigInteger` -> numeric_id; `boolean`/`Boolean` -> boolean; `UUID` -> uuid; Java enum -> enum.
- Everything else (incl. `String`, `Object`, unknowns) -> SKIP (emit nothing).
- `List<X>` / `X[]` -> unwrap ONE level, classify `X`. Match by simple name after stripping generics + package; tolerate fully-qualified `java.time.*`.
- Enum detection uses the resolved DTO/param type against the class index (a type whose declaration is a Java enum) -- a non-enum unknown stays a SKIP.

**SIGNAL #1 -- wire the type into the amvs classifier code-evidence path**
- Add `javaType` to amvs `requestContractEnrichment.ParamFormat` (~75-81) and carry it through `readRequestContractFacts` (~104-163).
- In `dataTypeClassifier.evidenceFromCode` (~341-354) supply the resolved type (instead of the hard-coded `oasType: null` at line 349) so `classifyField` (~263-330) fires its existing type buckets: `boolean`->boolean, `integer`->numeric_id, `number`->decimal (lines 299-303), PLUS the date/datetime/time/uuid/enum mappings from the table.
- Project `javaType` to the OAS-token vocabulary the classifier expects (`integer` for numeric_id types, `number` for decimal types, `boolean` for boolean) for the non-temporal buckets; the temporal/uuid/enum categories resolve via the date/time/uuid/enum signals so a bare numeric/string token never mis-buckets a date.

**SIGNAL #2 -- new global date-format scanner pass (precedence ladder)**
- A NEW pass in the springClassic pack resolves ONE project-wide date pattern via this PRECEDENCE LADDER (pick ONE; tag `source` + `confidence`): (1) `spring.jackson.date-format` (application.properties/yml) > (2) `ObjectMapper.setDateFormat("...")` / `Jackson2ObjectMapperBuilder` in `@Configuration` > (3) `@InitBinder` + `CustomDateEditor` / `registerCustomEditor(Date.class, new SimpleDateFormat("..."))` > (4) bare `new SimpleDateFormat("...")` / `DateTimeFormatter.ofPattern("...")` literal.
- Same-rank disagreement -> take the FIRST deterministically (stable file order) at LOWER confidence.
- AST/structured reads for `@Configuration` + properties; `rawContent` regex for the method-body cases (`@InitBinder` / `new SimpleDateFormat` / `ofPattern`) -- reuse the established idiom in `responseContractScanner.parseSecurityJavaConfig` (~494-514). Properties reachable via `fileFilter.filterConfigFiles`/`isConfigFile` (~81-114).
- This is project-wide (a single resolved value), distinct from the existing per-import `old_date_time_api` CVE flag in `javaFindingScanner.ts` (~92-94) which stays untouched.

**SIGNAL #2 -- attach as a single top-level `inferred_date_format` and apply at classify time**
- Attach `inferred_date_format: { format, source, confidence }` ONCE at the top level of each endpoint `request_contract` (NOT stamped onto per-field `param_formats`). Attach near the existing `attachRequestContractsToCandidates` site (`springClassic/index.ts` ~2542-2552).
- amvs reads it off the contract and applies it ONLY to type-only date/datetime entries at classify time: Col-2 shows the global format when present (else just the type token, display-only); the Col-4 SEED uses ONLY the concrete global format -- a bare type NEVER seeds (mirrors the seed/display split: `seedFromCode` is set only off a concrete `codeFormatLabel`, lines 550-552).
- Non-date categories (numeric_id/decimal/boolean/uuid/enum) resolve purely from the type and are unaffected by `inferred_date_format`.

**REGRESSION GUARD -- type-only entries must not corrupt the OAS-override path (both parts)**
- Both the classifier seed path (`classifyDataTypes` -> `evidenceFromCode`) and the `enrichInventoryWithRequestContracts` OAS-override path call the SAME `readRequestContractFacts` and read the SAME `param_formats` array -- this is the shared chokepoint.
- (a) The dedicated `javaType` field lets type-only entries pass the `readRequestContractFacts` line-154 drop (`if (!format && !pattern) continue;`) ONLY by virtue of carrying `javaType` -- NEVER by populating `format`/`pattern`.
- (b) Make the OAS-override path (`applyParamFormatOverrides` / `applyBodyFieldFormat` / `applyFormatToSchema` ~272-287) a NO-OP unless a concrete `format`/`pattern` is present, so a `javaType`-only entry NEVER clobbers a real OAS `format: date`/`pattern` with a type token (today line 154 shields this; once type-only entries flow it is the regression vector).

**Detect-or-flag custom (de)serializers**
- A field with `@JsonSerialize` / `@JsonDeserialize(using=SomeSerializer.class)` (format hidden in a separate class) -> emit a discovery Finding `gapType: 'request-format-unresolved'`, severity `info`, carrying field name + endpoint + referenced serializer class. Do NOT guess the format.
- Register `'request-format-unresolved'` in the `EvidenceGapType` vocabulary (the single-source-of-truth union in `findings/emissionSources.ts` ~516-538) and emit via the established `evidence_gap` Finding idiom.

**Provenance / confidence ordering**
- Annotation-derived entries (`@JsonFormat`/`@DateTimeFormat`) keep the HIGHEST confidence and their existing `source`.
- Type-only entries carry `source: 'java-type'` at LOWER confidence.
- The global date-format is tagged with its ladder `source` + `confidence`.
- This preserves "annotation format beats type" in `classifyField` (the `codeFormat` signal-1 branch resolves before the bare-type branch).

**Wire-format + persistence conventions (no change needed downstream)**
- AMS speaks `snake_case` at the wire; new keys follow it: `java_type` on each `param_formats` entry, top-level `inferred_date_format`. The amvs reader stays snake/camel-tolerant (`readString` over both keys).
- Persistence is the existing verbatim passthrough: mcp-server `candidateSaveBackService` `convertCandidateToEntity` case 'endpoints' passes `data.request_contract` straight onto `entity.request_contract` (~1232-1236) -> AMS `EndpointEntity.request_contract` jsonb (~142-144). NO change there.

## Visual Design
No visual assets provided. (Mandatory check of `planning/visuals/` returned no image/pdf files.)

## Existing Code to Leverage

**discovery `requestContractScanner.ts` -- `ParamFormatEntry` / `readParamFormats` / `readFormatAnnotation`**
- `ParamFormatEntry` (~170-177) is the entry shape to extend with `javaType`; `readParamFormats` (~479-515) is where type-only entries are emitted; `readFormatAnnotation` (~419-452) stays untouched as the high-confidence annotation path.
- `RequestParamEntry.type` (~157-162) and the resolved `@RequestBody` DTO fields already carry the Java type -- reuse, don't re-extract.

**discovery IR + Java extraction (`languageIR.ts`, `extract.ts`, `astUtils.ts`, `javaParser.ts`)**
- `ParameterIR.type` / `FieldIR.type` (`languageIR.ts` ~33-48) are populated by `toParameterIR`/`toFieldIR` (`extract.ts` ~53-69) via `extractTypeText` (`astUtils.ts` ~204-206) off the tree-sitter Java AST -- the type is a discarded value being threaded through.

**discovery `responseContractScanner.parseSecurityJavaConfig` (~494-514)**
- The proven `rawContent`-regex idiom (iterate files, gate on `.java` + a marker substring, regex the method body) -- the Signal #2 method-body cases (`@InitBinder` / `new SimpleDateFormat` / `ofPattern`) follow this pattern verbatim.

**discovery `findings/emissionSources.ts` `EvidenceGapType` + `evidence_gap` emitter**
- The closed `EvidenceGapType` union (~516-538) is the single source of truth (amvs imports it); add `'request-format-unresolved'` here and emit through the existing `evidence_gap` Finding builder rather than inventing a new shape. `javaFindingScanner.ts` (~92-94) shows the existing SimpleDateFormat reference flag for context (reference only -- not the new pass).

**amvs `dataTypeClassifier.ts` -- `evidenceFromCode` / `classifyField` / Col-4 seed**
- `classifyField` (lines 299-303) already buckets `boolean`/`integer`/`number` from a type token -- only `evidenceFromCode`'s `oasType: null` (line 349) blocks it today; set it from `javaType`. `classifyDataTypes` (~541-560) drives Col-2 (`codeFormatLabel`) and the Col-4 seed (`seedFromCode`, lines 550-552); `seedColumnFour` (~627-631) confirms code-wins-position-1 and that a null label seeds nothing -- so a bare type cannot inject a bogus seed.

## Out of Scope
- The data-type-defaults UI/classifier feature itself (already built; this spec only feeds it richer code evidence).
- Non-Spring-Classic framework packs / adapters (Spring Classic only for v1; others are future work).
- LLM-based format inference (deterministic only).
- Resolving the concrete format INSIDE arbitrary custom (de)serializer classes (detect-or-flag only).
- DB / schema changes (additive loose JSONB only -- no migration, no new columns).
- Response-side serialization formats (`responseContractScanner`) -- DEFERRED to a fast-follow.
- `@Pattern(regexp=)` -> format promotion -- FAST-FOLLOW, not built here.
- Any change to the mcp-server passthrough or AMS `EndpointEntity` (verbatim passthrough already carries the new keys).
- Surfacing ALL disagreeing date-format sources (the ladder picks exactly ONE).

## Load-Bearing Test Surfaces
- A `LocalDate businessDate` / `BigDecimal amount` / `Long id` / `UUID` / Java enum with NO annotation each yields a `javaType`-carrying `param_formats` entry that classifies from CODE into date / decimal / numeric_id / uuid / enum (asserts `evidenceFromCode` supplies the type instead of `oasType: null`).
- A project with a global date format -- exercised once per ladder source (`spring.jackson.date-format`, `@Configuration setDateFormat`/`Jackson2ObjectMapperBuilder`, `@InitBinder`+`CustomDateEditor`, bare `SimpleDateFormat`/`ofPattern`) -- yields exactly ONE `inferred_date_format` via the precedence + amvs applies it to type-only date fields so `dd-MMM-yyyy` surfaces (Col-2 display + Col-4 seed) for an un-annotated `LocalDate`.
- Same-rank disagreement picks the first by stable file order at lower confidence.
- REGRESSION GUARD (both parts): a `javaType`-only entry feeds the classifier (passes line-154) but does NOT override an OAS `format: date` (the `applyFormatToSchema` path stays a no-op without a concrete `format`/`pattern`) -- the seed/display split holds and a type token never becomes a wire format or a Col-4 seed.
- `List<LocalDate>` / `LocalDate[]` unwrap one level and classify as date (analogously for the other categories).
- A `String` field or an unrecognised type with no annotation produces NO `param_formats` entry.
- A field with `@JsonSerialize`/`@JsonDeserialize(using=SomeSerializer.class)` emits a `request-format-unresolved` Finding (severity `info`) with field + endpoint + serializer class, and guesses NO format.
- Provenance ordering: an annotation format and a type present for the same field -> the annotation format wins in `classifyField`; type-only entries carry `source: 'java-type'` at lower confidence; the global date-format carries its ladder source.
