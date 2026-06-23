# Spec Requirements: Spring Classic code-evidence format extraction (Java types + global date-format)

## Initial Description

Spring Classic code-evidence format extraction — Java types + global date-format (feeds the data-type-defaults classifier).

**PROBLEM:** The API Baseline wizard Step 5 "Data-type formats" → "Code Format(s)" column is bare for Spring Classic codebases because `request_contract.param_formats` is populated ONLY from `@JsonFormat`/`@DateTimeFormat` annotations, which classic Spring code rarely uses. Two rich signals go unexploited:

1. The Java field/param TYPE is already captured by the tree-sitter Java AST and even rides on `request_contract.params[].type`, but it is DROPPED when building `param_formats`, and the amvs classifier's code-evidence path hard-sets `oasType: null` — so the type never reaches data-type classification from the code scan (even though the classifier already buckets integer/decimal/boolean from a type).
2. The real wire date format (e.g. `dd-MMM-yyyy`) in classic apps lives in converters / `ObjectMapper.setDateFormat` / `@InitBinder` + `CustomDateEditor` / `new SimpleDateFormat("…")` / `DateTimeFormatter.ofPattern("…")` / `spring.jackson.date-format` — NONE of which is scanned today (the only `SimpleDateFormat` touch is a CVE/migration import flag).

**GOAL:** Extract data-type formats from where Spring Classic actually puts them — the Java types and the ONE global converter-level date format — and feed them into `request_contract.param_formats` → the amvs classifier's code-evidence column + Col-4 seed. Deterministic, no LLM, no DB/schema change (additive loose JSONB).

## Requirements Discussion

### Fixed Decisions (from raw-idea.md — NOT relitigated)

These five decisions were settled in the prior review/discussion and are carried forward as constraints, not questions:

1. **CORE scope = signal #1 + signal #2.** `@Pattern(regexp=)` → format promotion (#3) is a FAST-FOLLOW. Response-side serialization formats: decided in shaping (default: defer to keep v1 request-side).
2. **#1 Java TYPE → data-type category:** carry the param/field Java type onto `param_formats` (EMIT an entry even when NO format annotation exists), map Java type → category, and WIRE it into the classifier's code-evidence path so `classifyField` fires for numeric_id/decimal/boolean from CODE, plus the LocalDate→date etc. date mappings. The type is already in the AST/IR; this is mostly wiring a discarded value through.
3. **#2 ONE project-wide inferred wire date-format:** a new scanner pass that finds the global date pattern from `@Configuration` `ObjectMapper.setDateFormat("…")` / `Jackson2ObjectMapperBuilder`; `@InitBinder` + `CustomDateEditor` / `registerCustomEditor(Date.class, new SimpleDateFormat("…"))`; bare `new SimpleDateFormat("…")` / `DateTimeFormatter.ofPattern("…")` literals in util/converter classes; `spring.jackson.date-format` in application.properties/yml. Use it as the FORMAT for type-only date/datetime fields + the Col-4 seed (code wins position 1). The custom `@JsonSerialize/@JsonDeserialize(using=Class)` case (format hidden in a separate class) is the hard case → DETECT-OR-FLAG (emit a "format unresolved" discovery Finding rather than guess).
4. **FEASIBILITY (verified):** tree-sitter Java AST yields the types trivially; `@Configuration setDateFormat` + properties are AST/structured-reachable; method-body cases (`@InitBinder`/`new SimpleDateFormat`/`ofPattern`) use `rawContent` regex — an ESTABLISHED idiom in the pack (`responseContractScanner.parseSecurityJavaConfig`, `readStatusCodes`). No LLM. No DB/schema change.
5. **FLOW/PERSISTENCE (additive, no schema change):** scanner (`requestContractScanner.ts` `param_formats` + a new global-date-format pass) → `candidate.data.request_contract` → mcp-server `candidateSaveBackService.convertCandidateToEntity` case 'endpoints' (passes `data.request_contract` verbatim onto `entity.request_contract`) → AMS `EndpointEntity.request_contract` (jsonb) → amvs `requestContractEnrichment.readRequestContractFacts` → `dataTypeClassifier` code-evidence path.

### First Round Questions

The open questions from raw-idea.md were posed with recommended defaults. The user answered **"defaults are fine"** — accepting ALL eight resolutions verbatim.

**Q1: The exact Java-type → category mapping table (primitives, boxed wrappers, `List<>`/arrays, qualified names, unknown handling).**
**Answer (default accepted):** Use the mapping table as proposed:
- `LocalDate` → **date**
- `LocalDateTime` / `Instant` / `OffsetDateTime` / `ZonedDateTime` / `Date` / `Timestamp` / `Calendar` → **datetime**
- `LocalTime` → **time**
- `BigDecimal` / `double` / `Double` / `float` / `Float` → **decimal**
- `long` / `Long` / `int` / `Integer` / `short` / `Short` / `BigInteger` → **numeric_id**
- `boolean` / `Boolean` → **boolean**
- `UUID` → **uuid**
- Java enum → **enum**
- everything else (incl. `String` and unknowns) → **SKIP / emit nothing**
- `List<X>` / `X[]` → unwrap ONE level and classify `X`.
- Matching is by **simple name after stripping generics/package**; fully-qualified `java.time.*` is tolerated.

**Q2: How #1 and #2 COMPOSE (Col-2 display vs Col-4 seed; type token must not seed a bogus format).**
**Answer (default accepted):** Compose #1 + #2 as follows:
- **Col-2** shows the global inferred date-format when #2 resolved one, else just the **type token** (display-only, no concrete format).
- **Col-4** seeds ONLY from the concrete global date-format, **never** from a bare type.
- Non-date categories resolve purely from type.

**Q3: #2 precedence when multiple date-format sources disagree.**
**Answer (default accepted):** Precedence ladder, pick ONE (do NOT surface-all):
1. `spring.jackson.date-format` (property)
2. `ObjectMapper.setDateFormat` / `Jackson2ObjectMapperBuilder` (`@Configuration`)
3. `@InitBinder` + `CustomDateEditor`
4. bare `SimpleDateFormat("…")` / `DateTimeFormatter.ofPattern("…")` literal

Carry **source + confidence**. Same-rank disagreement → take the **first deterministically** (stable file order) and apply **lower confidence**.

**Q4: WHERE the global date-format attaches on `request_contract`.**
**Answer (default accepted):** A single top-level **`inferred_date_format: { format, source, confidence }`** per endpoint contract (NOT on per-field `param_formats`). amvs applies it to **type-only** date/datetime entries at classify time.

**Q5: RESPONSE side (`responseContractScanner` serialization) in this spec or deferred.**
**Answer (default accepted):** **DEFERRED** to a fast-follow. v1 is request-side only.

**Q6: The "format unresolved" custom-(de)serializer Finding — which finding type/gapType + severity.**
**Answer (default accepted):** Custom `@JsonSerialize` / `@JsonDeserialize(using=Class)` "format unresolved" → discovery **Finding** with `gapType: 'request-format-unresolved'`, severity **`info`**, carrying field name + endpoint + referenced serializer class.

**Q7: Must NOT regress the EXISTING annotation→OAS-override consumer when type-only `param_formats` entries appear.**
**Answer (default accepted):** Regression guard, BOTH parts:
- **(a)** Carry the Java type on a **DEDICATED `javaType` field**. Type-only entries pass the `readRequestContractFacts` line-154 drop ONLY because they have `javaType` (NEVER by putting the type into `format`/`pattern`).
- **(b)** Make `applyFormatToSchema` / the `enrichInventoryWithRequestContracts` OAS-override path a **NO-OP unless a concrete `format`/`pattern` is present** (a `javaType`-only entry must NOT override an OAS `format: date` with a type token).

**Q8: Confidence/provenance tagging for the new type/global-format evidence vs the annotation evidence.**
**Answer (default accepted):** Provenance tagging:
- annotation-derived entries (`@JsonFormat` / `@DateTimeFormat`) keep **highest confidence**;
- type-only entries `source: 'java-type'` (lower confidence);
- the global date-format tagged with its **Q3 source**.

This preserves "annotation format beats type" in `classifyField`.

### Existing Code to Reference

**Similar Features Identified (verified grounded reuse targets):**

discovery-service springClassic — `requestContractScanner.ts`:
- `ParamFormatEntry` (~170-177: `{name, location, format, pattern, source}`) — **ADD a `javaType`**.
- `readParamFormats` (~479-515) — **emit type-only entries when no annotation**.
- `readFormatAnnotation` (~419-452) — annotation path unchanged.
- `RequestParamEntry` / `params[].type` already carries the type (~157-162).

discovery-service IR / extraction (the type is already present):
- `ParameterIR.type` / `FieldIR.type` — `languageIR.ts` (~34-48).
- `extractTypeText` — `astUtils.ts` (~204-206).
- `toParameterIR` / `toFieldIR` — `extract.ts` (~53-69).

discovery-service rawContent-regex idiom (established pattern for method-body scans):
- `responseContractScanner.ts` `parseSecurityJavaConfig` (~494-514).

discovery-service config-file reachability + existing reference flag:
- `fileFilter.ts` `filterConfigFiles` / `isConfigFile` (~81-114) — application.properties/yml reachable.
- existing `SimpleDateFormat` import flag (reference only): `findings/packFindingScanners/javaFindingScanner.ts` (~92-94).
- Java AST: `languageExtractors/java/javaParser.ts`.
- Adapter attach point: `springClassic/index.ts` (~2542-2552 `attachRequestContractsToCandidates`; `extractRequestParams` ~656-675).

mcp-server passthrough:
- `candidateSaveBackService.ts` `convertCandidateToEntity` case 'endpoints' (~1164; `request_contract` passthrough ~1232-1236).

AMS persistence:
- `EndpointEntity.request_contract` (~142-144, jsonb).

amvs consumers:
- `requestContractEnrichment.ts` `readRequestContractFacts` (~104-163); `ParamFormat` interface (~75-81) — **ADD `javaType`**; the drop-when-no-format-and-no-pattern at **line 154** must ALLOW type-only entries through.
- `dataTypeClassifier.ts` `evidenceFromCode` (~341-354 — currently `oasType: null`; set from `javaType`) + `classifyField` (~263-330) + `seedColumnFour` (code wins).

## Visual Assets

No visual assets provided. (Mandatory `ls` check of `planning/visuals/` returned no image/pdf files.)

## Requirements Summary

### Functional Requirements

- **Emit type-only `param_formats` entries.** In the discovery Spring Classic scanner, emit a `param_formats` entry for a DTO/param even when NO format annotation exists, carrying the Java field/param type on a dedicated `javaType` field (added to `ParamFormatEntry`). The annotation path (`readFormatAnnotation`) is unchanged.
- **Map Java type → data-type category** per the Q1 table (date/datetime/time/decimal/numeric_id/boolean/uuid/enum; `String` + unknowns SKIP; `List<X>`/`X[]` unwrap one level; simple-name match, qualified `java.time.*` tolerated).
- **Wire the type into the classifier code-evidence path.** `dataTypeClassifier.evidenceFromCode` must supply the type (set `oasType` from `javaType`) instead of hard `oasType: null`, so `classifyField` fires the existing boolean/integer/number → boolean/numeric_id/decimal buckets from CODE, plus the date-type mappings.
- **New global date-format scanner pass** (single project-wide value) sourcing from: `spring.jackson.date-format` (property); `@Configuration` `ObjectMapper.setDateFormat` / `Jackson2ObjectMapperBuilder`; `@InitBinder` + `CustomDateEditor` / `registerCustomEditor(Date.class, new SimpleDateFormat("…"))`; bare `new SimpleDateFormat("…")` / `DateTimeFormatter.ofPattern("…")` literals — resolved via the Q3 precedence ladder, carrying `source` + `confidence`.
- **Attach as a single top-level `inferred_date_format: { format, source, confidence }`** per endpoint `request_contract` (Q4). amvs applies it at classify time to type-only date/datetime entries — feeding Col-2 display and the Col-4 seed (Q2 composition; code wins position 1).
- **Detect-or-flag custom (de)serializers.** A `@JsonSerialize` / `@JsonDeserialize(using=Class)` whose format lives in a separate class → emit a discovery Finding `gapType: 'request-format-unresolved'`, severity `info`, with field name + endpoint + referenced serializer class (Q6). Do NOT guess the format.
- **Provenance/confidence ordering** (Q8): annotation > type; type-only `source: 'java-type'`; global date-format tagged with its Q3 source — preserving "annotation format beats type" in `classifyField`.

### Reusability Opportunities

- `ParamFormatEntry` shape extension (`javaType`) reuses the existing `param_formats` plumbing end-to-end (scanner → mcp passthrough → AMS jsonb → amvs) with no schema change.
- The method-body `rawContent`-regex idiom is already proven in `responseContractScanner.parseSecurityJavaConfig` / `readStatusCodes` — the global date-format pass follows it for `@InitBinder` / `new SimpleDateFormat` / `ofPattern`.
- The IR already carries `ParameterIR.type` / `FieldIR.type` (via `extractTypeText`, `toParameterIR`/`toFieldIR`) — the type is a discarded value being threaded through, not a new extraction.
- Config-file reachability (`fileFilter.filterConfigFiles`/`isConfigFile`) already exposes application.properties/yml for the `spring.jackson.date-format` read.
- The classifier already buckets boolean/integer/number from a type in `classifyField` (lines 299-303) — only `evidenceFromCode`'s `oasType: null` blocks it today.

### Scope Boundaries

**In Scope:**
- Spring Classic request-side ONLY.
- Signal #1 (Java type → category, emit type-only entries, wire into classifier).
- Signal #2 (single project-wide inferred wire date-format via the Q3 ladder; top-level `inferred_date_format`; applied to type-only date/datetime fields + Col-4 seed).
- The `request-format-unresolved` detect-or-flag Finding for custom (de)serializers.
- Provenance/confidence tagging; both-part regression guard (Q7).

**Out of Scope:**
- The data-type-defaults UI/classifier feature itself (already built; this only feeds it richer code evidence).
- Other framework packs (non-Spring-Classic adapters) — Spring Classic only for v1; others noted as future.
- LLM-based format inference (deterministic only).
- Resolving formats hidden inside arbitrary custom (de)serializer classes (detect-or-flag only).
- DB / schema changes (additive JSONB only).
- `@Pattern` → format promotion (#3) — FAST-FOLLOW, unless the shaper finds it trivially foldable.
- Response-side serialization formats (`responseContractScanner`) — DEFERRED to a fast-follow (Q5).

### Technical Considerations

- **Deterministic, no LLM, no DB/schema change** (additive loose JSONB only).
- **Verified shared chokepoint — `readRequestContractFacts` line 154** (`api-migration-validation-service/src/services/requestContractEnrichment.ts:154`): `if (!format && !pattern) continue;` drops any `param_formats` entry lacking a concrete `format`/`pattern`. The `ParamFormat` interface (lines 75-81) has no `javaType`. The Q7(a) guard adds a dedicated `javaType` field and lets type-only entries pass this drop ONLY by virtue of `javaType` — NEVER by stuffing the type into `format`/`pattern`.
- **Verified clobber risk — `applyFormatToSchema`** (`requestContractEnrichment.ts:272-287`): unconditionally writes `schema.format`/`schema.pattern` whenever the entry carries a `format`/`pattern`. It is reached via `applyParamFormatOverrides` / `applyBodyFieldFormat` from `enrichInventoryWithRequestContracts`. Today line 154 shields it (only concrete-format entries arrive); once type-only entries flow, this is the regression vector. Q7(b) requires this OAS-override path stay a NO-OP unless a concrete `format`/`pattern` is present, so a `javaType`-only entry never overrides an OAS `format: date` with a type token.
- **Verified classifier gap — `evidenceFromCode`** (`dataTypeClassifier.ts:341-354`): hard-sets `oasType: null` (line 349), so the code-scan type never reaches `classifyField`. The fix sets `oasType` from `javaType`. NOTE: `evidenceFromCode` (classifier seed) and `applyFormatToSchema` (OAS override) consume the SAME `param_formats` array off `readRequestContractFacts` — the dedicated `javaType` field is what keeps the seed path and the OAS-override path separable (the seed/display split holds).
- AMS speaks `snake_case` at the wire (`request_contract` is the snake key; `readRequestContractFacts` tolerates both snake and camel). New keys (`java_type` / `inferred_date_format`) follow that convention; the reader stays snake/camel-tolerant.

### Load-Bearing Test Surfaces

1. **Type-only param yields a `javaType`-carrying entry and classifies from CODE.** A Spring Classic DTO/param with NO format annotation but a Java type (e.g. `LocalDate businessDate`, `BigDecimal amount`, `Long id`, `UUID`, a Java enum) now produces a `param_formats` entry carrying `javaType` and classifies into the right data-type category from CODE — the classifier's `evidenceFromCode` supplies the type instead of `oasType: null`. Expect: `LocalDate`→date, `BigDecimal`→decimal, `Long`→numeric_id, `UUID`→uuid, enum→enum.

2. **Global date-format resolves via the Q3 ladder and amvs applies it to type-only date fields.** A project with a global date format in a converter / `ObjectMapper.setDateFormat` / `@InitBinder` / bare `SimpleDateFormat` / `ofPattern` / `spring.jackson.date-format` yields a single `inferred_date_format` on the contract via the precedence ladder, and amvs applies it to type-only date fields (Col-2 display + Col-4 seed) — e.g. `dd-MMM-yyyy` surfaces for a `LocalDate` field that has no annotation.

3. **REGRESSION GUARD (both parts).** A `javaType`-only entry passes the classifier path BUT does NOT override an OAS `format: date` in `enrichInventoryWithRequestContracts` — the seed/display split holds; a type token never becomes a wire format or a Col-4 seed. (Asserts the line-154 pass-through AND the `applyFormatToSchema` no-op-without-concrete-format.)

4. **`List<X>` / array unwrap.** `List<LocalDate>` / `LocalDate[]` unwrap one level and classify as date (and analogously for the other categories).

5. **Unknown / String type → no entry.** A `String` field or an unrecognised type with no annotation produces NO `param_formats` entry (skip / emit nothing).

6. **Custom (de)serializer → `request-format-unresolved` Finding.** A field with `@JsonSerialize`/`@JsonDeserialize(using=SomeSerializer.class)` (format hidden in the class) emits a discovery Finding `gapType: 'request-format-unresolved'`, severity `info`, carrying field name + endpoint + referenced serializer class — and does NOT guess a format.

7. **Provenance / confidence ordering (annotation > type).** Annotation-derived entries (`@JsonFormat`/`@DateTimeFormat`) keep the highest confidence; type-only entries carry `source: 'java-type'` at lower confidence; the global date-format carries its Q3 source. When both an annotation format and a type are present for a field, the annotation format wins in `classifyField`.
