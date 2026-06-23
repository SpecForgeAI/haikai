# Task Breakdown: Spring Classic code-evidence format extraction (Java types + global date-format)

> Sources: `spec.md` (authoritative) + `planning/requirements.md`. No visual assets (`planning/visuals/` empty).

---

## ⚠️ IMPLEMENTER GUARDRAILS — READ BEFORE EDITING (load-bearing)

Implementer subagents have **Write but NO Edit**. Whole-file `Write`s against large
existing files have **CLOBBERED** files in this repo. Obey ALL of the following:

1. **EXISTING files = ANCHORED in-place splices ONLY.** Never re-`Write` a whole
   existing file. Use anchored Bash/Node string splices against UNIQUE anchors.
   This applies especially to:
   - `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts`
   - `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`
   - `discovery-service/src/services/findings/emissionSources.ts`
   - `api-migration-validation-service/src/services/requestContractEnrichment.ts`
   - `api-migration-validation-service/src/services/dataTypeClassifier.ts`
2. **NEW files MAY use `Write`** (the new global-date-format scanner module; all new
   test files).
3. **NEVER** `git checkout` / `git stash` / `git reset` (no destructive git).
4. **After every edit to an existing file:** grep it for the mojibake marker `â€"`
   (expect ZERO hits), then re-Read the spliced region to confirm byte-intactness
   and balanced braces. Preserve each file's existing line endings.
5. **ABSOLUTE PATHS for every test/build command** (the Bash cwd may persist between
   calls; do not rely on it):
   `cd C:/Workspaces/SSD/haikai/<dir> && npx jest <file>`

---

## Overview
Total Task Groups: 6
Total Tasks: ~46 sub-tasks

**Sequencing (producer → consumer → tests):**
1. discovery — Java type capture + type-only `param_formats` + type→category mapping
2. discovery — global date-format detector + top-level `inferred_date_format`
3. discovery — `request_format_unresolved` Finding for custom (de)serializers
4. amvs — `requestContractEnrichment` `javaType` passthrough + regression guard
5. amvs — `dataTypeClassifier` type wiring + global-format application
6. Test review & gap analysis (feature-only)

**NON-GOALS (honor throughout):** Spring-Classic request-side ONLY; deterministic (no
LLM); detect-or-flag (never guess) for custom serializers; additive loose JSONB (no DB/
schema change, no migration); response-side scanner + `@Pattern→format` are FAST-FOLLOW
(not built here); do NOT modify the data-type-defaults UI/classifier feature beyond the
`evidenceFromCode` + global-format wiring; do NOT touch the mcp-server passthrough or AMS
`EndpointEntity` (they carry the new blob keys verbatim).

**Wire convention:** AMS speaks `snake_case`. New keys are `java_type` (per
`param_formats` entry) + top-level `inferred_date_format`. The amvs reader stays
snake/camel-tolerant (`readString` over both keys).

---

## Task List

### Discovery — Signal #1 (Java types)

#### Task Group 1: Type-only `param_formats` entries + Java-type→category mapping
**Dependencies:** None
**Primary file (EXISTING — anchored splices only):**
`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts`

- [x] 1.0 Emit type-only `param_formats` entries carrying the Java type
  - [x] 1.1 Write 2-8 focused tests FIRST (new test file)
    - Un-annotated `LocalDate businessDate` → entry with `javaType` (no `format`/`pattern`), `source: 'java-type'`.
    - Un-annotated `BigDecimal` / `Long` / `UUID` / Java enum → entry carrying the resolved `javaType`.
    - `List<LocalDate>` and `LocalDate[]` → unwrap ONE level (entry carries the unwrapped type).
    - A `String` field AND an unrecognised/unknown type → NO entry emitted (skip).
    - An annotated field (`@JsonFormat`/`@DateTimeFormat`) → UNCHANGED behaviour (still carries `format`/`pattern`/`source`, NOT `source: 'java-type'`).
    - Limit to 2-8 highly focused tests; skip exhaustive per-type enumeration.
  - [x] 1.2 Extend `ParamFormatEntry` with a dedicated `javaType` field
    - Anchor: the interface at `~170-177` (`{ name, location, format, pattern, source }`).
    - Add `javaType: string | null;` (NEVER reuse `format`/`pattern` to carry the type).
    - Keep the snake wire name `java_type` in mind for the emitted blob (the entry object key that ends up on `request_contract.param_formats[]`).
  - [x] 1.3 Implement the Java-type → category mapping helper (deterministic, pure)
    - Table (per spec): `LocalDate`→date; `LocalDateTime`/`Instant`/`OffsetDateTime`/`ZonedDateTime`/`Date`/`Timestamp`/`Calendar`→datetime; `LocalTime`→time; `BigDecimal`/`double`/`Double`/`float`/`Float`→decimal; `long`/`Long`/`int`/`Integer`/`short`/`Short`/`BigInteger`→numeric_id; `boolean`/`Boolean`→boolean; `UUID`→uuid; Java enum→enum.
    - Everything else (incl. `String`, `Object`, unknowns) → SKIP (return null / emit nothing).
    - `List<X>` / `X[]` → unwrap ONE level, classify `X`. Match by SIMPLE name after stripping generics + package; tolerate fully-qualified `java.time.*`. Reuse existing `stripGenerics`/`simpleName` helpers in this file.
    - Enum detection: resolve the type against the class index (a declaration that is a Java enum). A non-enum unknown stays a SKIP.
  - [x] 1.4 Emit type-only entries in `readParamFormats`
    - Anchor: `readParamFormats` at `~479-515`.
    - Param path: when `readFormatAnnotation(p.annotations)` returns null AND the param Java type (`p.type` / `ParameterIR.type`) maps to a category (1.3), push an entry `{ name, location, format: null, pattern: null, source: 'java-type', javaType: <resolved-type> }`.
    - `@RequestBody` DTO-field path: same logic per `FieldIR` (when `readFormatAnnotation(f.annotations)` is null AND `f.type` maps), push a `location: 'body'` type-only entry.
    - The annotation path (`readFormatAnnotation` `~419-452`) is UNCHANGED; annotation entries must also keep a `javaType` value consistent with the new field shape (set it from the resolved type so the shape is uniform; the annotation `format`/`pattern`/`source` still win downstream).
    - Reuse `RequestParamEntry.type` (`~157-162`) / resolved DTO field types — do NOT re-extract from the AST.
  - [x] 1.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/discovery-service && npx jest <the file from 1.1>`
    - Do NOT run the full discovery suite.
    - Post-edit: grep `requestContractScanner.ts` for `â€"` (expect zero) + re-Read the spliced regions (interface, mapping helper, `readParamFormats`) for balanced braces.

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass.
- `ParamFormatEntry` carries `javaType`; type-only entries NEVER populate `format`/`pattern`.
- Un-annotated temporal/decimal/numeric/uuid/enum types emit entries; `String`/unknown emit nothing.
- `List<X>`/`X[]` unwrap one level.
- The annotation path is unchanged (annotation entries keep their `format`/`pattern`/`source`).

---

### Discovery — Signal #2 (global date-format)

#### Task Group 2: Global date-format detector + top-level `inferred_date_format`
**Dependencies:** Task Group 1 (shares the `request_contract` attach site)
**Files:** NEW scanner module (`Write` OK) + EXISTING `springClassic/index.ts` (anchored splice only)

- [x] 2.0 Resolve ONE project-wide date pattern and attach it per endpoint contract
  - [x] 2.1 Write 2-8 focused tests FIRST (new test file)
    - Each ladder source resolves a format in isolation: (1) `spring.jackson.date-format` (application.properties/yml); (2) `ObjectMapper.setDateFormat("...")` / `Jackson2ObjectMapperBuilder` in `@Configuration`; (3) `@InitBinder` + `CustomDateEditor` / `registerCustomEditor(Date.class, new SimpleDateFormat("..."))`; (4) bare `new SimpleDateFormat("...")` / `DateTimeFormatter.ofPattern("...")` literal.
    - Precedence: when a higher AND lower rank both present, the HIGHER rank wins; assert `source` reflects the winner.
    - Same-rank disagreement → first by STABLE file order, at LOWER confidence.
    - Headline value: a `dd-MMM-yyyy` pattern surfaces as `inferred_date_format.format`.
    - Limit to 2-8 focused tests.
  - [x] 2.2 Create the new global-date-format scanner module (NEW file → `Write`)
    - Single project-wide resolver returning `{ format, source, confidence } | null`.
    - Properties + `@Configuration` cases: AST/structured reads.
      - `spring.jackson.date-format` reachable via `fileFilter.filterConfigFiles` / `isConfigFile` (`~81-114`).
    - Method-body cases (`@InitBinder` / `new SimpleDateFormat` / `ofPattern`): `rawContent` regex — reuse the established idiom in `responseContractScanner.parseSecurityJavaConfig` (`~494-514`) (iterate files, gate on `.java` + a marker substring, regex the body). Do NOT import from that module if it risks a cycle — replicate the idiom.
    - Confidence: HIGHEST→LOWEST down the ladder; same-rank tiebreak lowers confidence.
  - [x] 2.3 Implement the precedence ladder + deterministic tiebreak
    - Ladder (pick exactly ONE): (1) `spring.jackson.date-format` > (2) `ObjectMapper.setDateFormat`/`Jackson2ObjectMapperBuilder` > (3) `@InitBinder`+`CustomDateEditor` > (4) bare `SimpleDateFormat`/`ofPattern`.
    - Same-rank disagreement → take the FIRST in stable file order; tag LOWER confidence.
    - Distinct from the per-import `old_date_time_api` CVE flag in `javaFindingScanner.ts` (`~92-94`) — leave that UNTOUCHED.
  - [x] 2.4 Attach a single top-level `inferred_date_format` per endpoint contract
    - Anchor: near `attachRequestContractsToCandidates` in `springClassic/index.ts` (`~2542-2552`).
    - Resolve the project-wide value ONCE per scan, then stamp `inferred_date_format: { format, source, confidence }` at the TOP LEVEL of each endpoint's `request_contract` (NOT onto per-field `param_formats`).
    - When the resolver returns null, attach NOTHING (no empty object).
  - [x] 2.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/discovery-service && npx jest <the file from 2.1>`
    - Do NOT run the full discovery suite.
    - Post-edit: grep the edited `index.ts` for `â€"` (expect zero) + re-Read the attach-site splice for balanced braces.

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass.
- Each ladder source resolves; precedence honoured; same-rank tiebreak deterministic at lower confidence.
- Exactly ONE top-level `inferred_date_format { format, source, confidence }` per endpoint contract; absent when nothing resolves.
- `javaFindingScanner.ts` CVE flag untouched.

---

### Discovery — detect-or-flag custom (de)serializers

#### Task Group 3: `request_format_unresolved` Finding
**Dependencies:** Task Group 1 (same scanner surface; entries vs. Findings)
**Primary file (EXISTING — anchored splice only):**
`discovery-service/src/services/findings/emissionSources.ts`

- [x] 3.0 Emit a Finding (never a guess) for custom `@JsonSerialize`/`@JsonDeserialize(using=Class)`
  - [x] 3.1 Write 2-8 focused tests FIRST (new test file)
    - A field with `@JsonSerialize(using=SomeSerializer.class)` → emits a Finding `gapType: 'request_format_unresolved'`, severity `info`, carrying field name + endpoint + referenced serializer class.
    - Same for `@JsonDeserialize(using=...)`.
    - Asserts NO format is guessed (no `param_formats` `format`/`pattern` invented from the serializer).
    - Limit to 2-8 focused tests.
  - [x] 3.2 Register the new gap type in the `EvidenceGapType` union
    - Anchor: the closed union at `emissionSources.ts` `~516-538`.
    - ⚠️ CASING RECONCILIATION: use the **snake_case** literal `'request_format_unresolved'` to match siblings (`oas_spec_orphan`, `scanner_failed`, etc.). The spec's `'request-format-unresolved'` kebab form is reconciled to snake_case here. This union is the single source of truth (amvs imports it) — DO NOT introduce the kebab literal anywhere.
  - [x] 3.3 Emit via the established `evidence_gap` Finding idiom
    - Reuse the existing `evidence_gap` Finding builder (do NOT invent a new Finding shape).
    - Detect `@JsonSerialize`/`@JsonDeserialize(using=<Class>)` on a param/DTO field during the Signal-#1 walk; carry `field`, `endpoint`, and the referenced serializer class in the Finding detail.
    - `javaFindingScanner.ts` (`~92-94`) is reference-only — NOT the emission site here.
  - [x] 3.4 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/discovery-service && npx jest <the file from 3.1>`
    - Do NOT run the full discovery suite.
    - Post-edit: grep `emissionSources.ts` (and any other edited file) for `â€"` (expect zero) + re-Read the union splice for balanced braces and a trailing `;`.

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass.
- `'request_format_unresolved'` (snake_case) is in the `EvidenceGapType` union; no kebab literal exists.
- A custom (de)serializer field emits an `info` Finding with field + endpoint + serializer class; NO format is guessed.

---

### amvs — passthrough + regression guard

#### Task Group 4: `requestContractEnrichment` `javaType` passthrough + OAS-override no-op guard
**Dependencies:** Task Groups 1-3 (consumes the new `java_type` key + the closed union)
**Primary file (EXISTING — anchored splices only):**
`api-migration-validation-service/src/services/requestContractEnrichment.ts`

- [x] 4.0 Let type-only entries through the chokepoint WITHOUT corrupting the OAS-override path
  - [x] 4.1 Write 2-8 focused tests FIRST (new test file)
    - REGRESSION GUARD (headline): a `javaType`-only entry PASSES the line-154 drop (reaches the classifier path) but the OAS-override path (`applyFormatToSchema` via `enrichInventoryWithRequestContracts`) is a NO-OP — it does NOT overwrite an existing OAS `format: date`/`pattern` with a type token.
    - A concrete-`format`/`pattern` entry STILL overrides the OAS schema as before (no regression).
    - A type-only entry (no `format`/`pattern`, no `javaType`) is STILL dropped at line 154 (nothing to carry).
    - Snake/camel tolerance: `java_type` AND `javaType` both read.
    - Limit to 2-8 focused tests.
  - [x] 4.2 Add `javaType` to the `ParamFormat` interface
    - Anchor: `ParamFormat` at `~75-81` (`{ name, location, format, pattern }`).
    - Add `javaType: string | null;`.
  - [x] 4.3 Carry `javaType` through `readRequestContractFacts` + relax the line-154 drop
    - Anchor: `readRequestContractFacts` `~104-163`; the drop at LINE 154 (`if (!format && !pattern) continue;`).
    - Read `javaType` via `readString(entry, 'java_type', 'javaType')` (snake/camel-tolerant).
    - CHANGE the drop so an entry survives when it has `format` OR `pattern` OR `javaType`; push `{ name, location, format, pattern, javaType }`. An entry with NONE of the three is still dropped.
  - [x] 4.4 Make the OAS-override path a NO-OP without a concrete `format`/`pattern`
    - Anchor: `applyFormatToSchema` `~272-287` (reached via `applyParamFormatOverrides` / `applyBodyFieldFormat` from `enrichInventoryWithRequestContracts`).
    - It already only writes when `fmt.pattern` / `fmt.format` are truthy — VERIFY a `javaType`-only entry (both null) cannot mutate `schema.format`/`schema.pattern` or stamp `x-amvs-source`. Add an explicit early guard if any path could write from a bare `javaType`. The dedicated `javaType` field (never stuffed into `format`/`pattern`) is what keeps the seed path and the OAS-override path separable.
  - [x] 4.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/api-migration-validation-service && npx jest <the file from 4.1>`
    - Do NOT run the full amvs suite.
    - Post-edit: grep `requestContractEnrichment.ts` for `â€"` (expect zero) + re-Read the `ParamFormat` interface, the line-154 region, and `applyFormatToSchema` for balanced braces.

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass.
- `ParamFormat` carries `javaType`; `readRequestContractFacts` reads both wire casings.
- A `javaType`-only entry passes line 154 but NEVER overrides an OAS `format`/`pattern` (no-op guard holds).
- Concrete-`format`/`pattern` entries still override as before (no regression); a no-field/no-type entry is still dropped.

---

### amvs — classifier wiring

#### Task Group 5: `dataTypeClassifier` type wiring + global-format application
**Dependencies:** Task Group 4 (consumes `ParamFormat.javaType` + the contract's `inferred_date_format`)
**Primary file (EXISTING — anchored splices only):**
`api-migration-validation-service/src/services/dataTypeClassifier.ts`

- [x] 5.0 Supply the Java type to the code-evidence path + apply the global date-format
  - [x] 5.1 Write 2-8 focused tests FIRST (new test file)
    - Un-annotated `LocalDate` field + project `inferred_date_format = 'dd-MMM-yyyy'` → classifies as `date`; Col-2 (code) shows `dd-MMM-yyyy`; Col-4 SEED = `dd-MMM-yyyy`.
    - A `numeric_id` (`Long`), a `decimal` (`BigDecimal`), a `boolean` → each classifies from CODE (no annotation, no OAS).
    - A type-only `UUID` → `uuid`; a Java enum type-only entry → `enum`.
    - A type-only date field with NO global format → Col-2 shows the TYPE TOKEN (display-only), Col-4 seeds the STANDARD guess (NOT the bare type token).
    - Limit to 2-8 focused tests.
  - [x] 5.2 Map `javaType` to the classifier's evidence vocabulary
    - Add a small projection from the resolved Java type to the `FieldEvidence` slots `classifyField` reads (`~263-330`):
      - Non-temporal buckets via signal-2 type tokens (`~299-303`): numeric_id types → `oasType: 'integer'`; decimal types → `oasType: 'number'`; boolean → `oasType: 'boolean'`.
      - Temporal/uuid/enum (signal-2 `oasFormat` branch `~284-294` + `hasEnum` `~265`): date → `oasFormat: 'date'`; datetime → `oasFormat: 'date-time'`; time → `oasFormat: 'time'`; uuid → `oasFormat: 'uuid'`; enum → `hasEnum: true`. (A bare numeric/string type token must NEVER mis-bucket a date — route temporals through `oasFormat`/`hasEnum`, not `oasType`.)
  - [x] 5.3 Wire the type into `evidenceFromCode` (replace `oasType: null`)
    - Anchor: `evidenceFromCode` `~341-354`; the hard `oasType: null` at LINE 349.
    - Project `p.javaType` (5.2) into `oasType` / `oasFormat` / `hasEnum` so `classifyField` fires its existing buckets from CODE.
    - Preserve the existing `codeFormat = p.pattern ?? p.format ?? null` line so an ANNOTATION format still wins (signal-1 resolves before the bare-type signal-2 branch — "annotation beats type").
  - [x] 5.4 Apply `inferred_date_format` to type-only date/datetime entries (display + seed split)
    - Read the contract's top-level `inferred_date_format` (snake/camel-tolerant) alongside `readRequestContractFacts` in the code-evidence loop of `classifyDataTypes` (`~541-560`).
    - For a TYPE-ONLY date/datetime entry (no concrete `format`/`pattern`):
      - Col-2 DISPLAY (`codeFormatLabel`, `~373-376`): show the global format when present, else the bare TYPE TOKEN (display-only).
      - Col-4 SEED (`seedFromCode`, `~550-552`): seed ONLY from the CONCRETE global format — a bare type token NEVER seeds (mirror the existing seed/display split; `seedFromCode` set only off a concrete label).
    - Non-date categories (numeric_id/decimal/boolean/uuid/enum) resolve purely from the type and are UNAFFECTED by `inferred_date_format`.
    - Do NOT change the data-type-defaults feature beyond this wiring (no UI/other-classifier changes).
  - [x] 5.5 Run ONLY this group's tests
    - `cd C:/Workspaces/SSD/haikai/api-migration-validation-service && npx jest <the file from 5.1>`
    - Do NOT run the full amvs suite.
    - Post-edit: grep `dataTypeClassifier.ts` for `â€"` (expect zero) + re-Read `evidenceFromCode`, the 5.2 projection, and the `classifyDataTypes` code-evidence loop for balanced braces.

**Acceptance Criteria:**
- The 2-8 tests from 5.1 pass.
- An un-annotated `LocalDate` + global `dd-MMM-yyyy` → `date`, Col-2 shows `dd-MMM-yyyy`, Col-4 seeds it.
- `numeric_id`/`decimal`/`boolean`/`uuid`/`enum` classify from CODE via the type.
- A type-only date with NO global format shows the type token (display) + seeds the standard guess (not the type).
- The annotation-beats-type ordering still holds.

---

### Testing

#### Task Group 6: Test review & gap analysis (feature-only)
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review group tests and fill the highest-value end-to-end gaps only
  - [x] 6.1 Review the focused tests from Groups 1-5
    - Group 1 (type-only entries + mapping), Group 2 (global date-format ladder), Group 3 (`request_format_unresolved` Finding), Group 4 (passthrough + regression guard), Group 5 (classifier wiring).
    - Total existing: ~10-40 focused tests.
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Focus on end-to-end seams between producer (discovery) and consumer (amvs); do NOT assess whole-app coverage.
    - Prioritise the headline and the regression guard end-to-end.
  - [x] 6.3 Write up to 10 additional strategic tests MAXIMUM (only if needed)
    - HEADLINE end-to-end: un-annotated Spring Classic `LocalDate businessDate` + a global `dd-MMM-yyyy` converter → `request_contract` (type-only entry + top-level `inferred_date_format`) → amvs `readRequestContractFacts` → `dataTypeClassifier` → Col-2 shows `dd-MMM-yyyy` (+ Col-4 seed).
    - REGRESSION GUARD end-to-end: the same type-only entry alongside a real OAS `format: date` → classifier seeds/displays correctly BUT `enrichInventoryWithRequestContracts` leaves the OAS schema untouched.
    - Provenance ordering end-to-end (if a gap): an annotation format + a type for the same field → annotation wins; type-only carries `source: 'java-type'` at lower confidence; the global date-format carries its ladder source.
    - Skip edge/perf/a11y tests unless business-critical.
  - [x] 6.4 Run feature-specific tests ONLY (absolute paths)
    - `cd C:/Workspaces/SSD/haikai/discovery-service && npx jest <Group 1/2/3 + any new discovery test from 6.3>`
    - `cd C:/Workspaces/SSD/haikai/api-migration-validation-service && npx jest <Group 4/5 + any new amvs test from 6.3>`
    - Do NOT run the entire test suite of either service.
    - Post-edit: grep any edited existing file for `â€"` (expect zero).

**Acceptance Criteria:**
- All feature-specific tests pass.
- The headline (un-annotated `LocalDate` + global `dd-MMM-yyyy` → Code column) and the regression guard are both covered end-to-end.
- No more than 10 additional tests added.
- Testing stays exclusively within this spec's feature surface.

**TG6 completion note (implementer):**
- Reviewed all five group tests (discovery: `requestContractScannerJavaType`, `globalDateFormatScanner`, `requestFormatUnresolvedFinding`; amvs: `requestContractEnrichment.javaTypePassthrough`, `dataTypeClassifier.javaTypeEvidence`). Each is green in isolation but stubs the process boundary on one side (producer tests stop at the emitted blob; consumer tests hand-build the blob with literals).
- GAP filled: the cross-process WIRE-CONTRACT seams the per-group tests cannot cover. Added ONE new file (5 tests, under the 10 cap) that runs the REAL producer output through the REAL consumer code: `discovery-service/src/__tests__/springClassicCodeFormatWireContract.crossProcess.test.ts`.
  - SEAM 1 (highest value, the just-fixed enum marker): the real producer emits a Java enum field `javaType` as exactly `Name<enum>` and the real amvs `readRequestContractFacts`/`classifyDataTypes` `<enum>` detector routes it to `enum` -- the producer-emitted marker string is asserted to BE the string the consumer matches (locks the parallel-build seam that previously broke).
  - SEAM 2 (headline): un-annotated `LocalDate` + a global `dd-MMM-yyyy` -> real `runSpringClassicAdapter` blob (`param_formats` `java_type` + top-level `inferred_date_format`) -> real `classifyDataTypes` -> Col-2 shows `dd-MMM-yyyy`, Col-4 seeds it.
  - SEAM 3 (regression guard, end-to-end): the real producer type-only entry seeds/displays in the classifier BUT is a no-op against a real OAS `format: date` via `enrichInventoryWithRequestContracts`.
- FOLLOW-UPS WIRED (2026-06-23): the two documented end-to-end wiring gaps below are now CLOSED (the producer logic already existed + was unit-tested; only the production invocation was missing).
  - [x] FU-1: rank-1 global-date-format rung now fires end-to-end. `application[-profile].{properties,yml,yaml}` config files are now ADMITTED to the discovery IR through the existing `filterConfigFiles` helper, wired in `languagePacks/javaLangPack/index.ts` (new admission branch, mirroring the WADL / web.xml admissions: `language: 'spring-config'` + verbatim `rawContent`, empty structural fields, test-file exclusion + no-clobber guard). `resolveGlobalDateFormat` reads them, so rank-1 `spring.jackson.date-format` now resolves in production (not just from a synthetic IR). Java scanners that iterate `file.classes` see nothing for a config file (it is NOT Java-parsed) -- verified by re-running the springClassic + Java-scanner + findings suites with no regression. New end-to-end proof: `src/__tests__/springConfigFileAdmission.test.ts` (4 tests, real `javaLangPack.extract` -> `springClassicFrameworkPack.adapt`).
  - [x] FU-2: the `request_format_unresolved` Finding now emits during a live scan. `detectCustomSerializerFields(files)` is now CALLED from a new cross-file pass `scanCustomSerializerFindings` inside `runSpringClassicFindingScanner` (`findings/packFindingScanners/springClassicFindingScanner.ts`), a peer of the response-contract / outbound-integration cross-file passes. Each hit emits one `buildRequestFormatUnresolvedFinding({ field, endpoint, serializerClass })` through the SAME FindingEmitInput -> caller-emit path (best-effort: capped + soft-failing, never blocks the scan). New scan-level proof: `src/__tests__/requestFormatUnresolvedScanWiring.test.ts` (5 tests, real scanner emits the info Finding with field+endpoint+serializer-class, guesses no format).

---

## Execution Order

1. Task Group 1 — discovery type-only `param_formats` + type→category mapping
2. Task Group 2 — discovery global date-format detector + `inferred_date_format`
3. Task Group 3 — discovery `request_format_unresolved` Finding
4. Task Group 4 — amvs `javaType` passthrough + OAS-override regression guard
5. Task Group 5 — amvs classifier type wiring + global-format application
6. Task Group 6 — test review & gap analysis (feature-only)

Groups 1-3 (discovery producer) are independent of 4-5 (amvs consumer) at the code
level but MUST land first because 4-5 consume the `java_type` key, the top-level
`inferred_date_format`, and the closed `EvidenceGapType` union that discovery owns.

## Files Touched (reference)

**EXISTING — anchored splices ONLY:**
- `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner.ts` (Group 1)
- `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts` (Group 2 attach site)
- `discovery-service/src/services/findings/emissionSources.ts` (Group 3 union)
- `api-migration-validation-service/src/services/requestContractEnrichment.ts` (Group 4)
- `api-migration-validation-service/src/services/dataTypeClassifier.ts` (Group 5)

**NEW — `Write` OK:**
- new global-date-format scanner module under `springClassic/` (Group 2)
- all new test files (Groups 1-6)

**NOT touched (verbatim passthrough — confirm UNCHANGED):**
- `mcp-server` `candidateSaveBackService.convertCandidateToEntity` case 'endpoints'
- AMS `EndpointEntity.request_contract` (jsonb)
- `javaFindingScanner.ts` `old_date_time_api` CVE flag
