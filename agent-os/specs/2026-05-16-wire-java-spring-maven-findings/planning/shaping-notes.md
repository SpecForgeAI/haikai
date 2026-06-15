# Shaping notes — Wire Java + Spring Classic + Maven packs into Discovery Findings

Date: 2026-05-16
Status: **Shaping complete.** All 8 open product decisions resolved by user (verbatim confirmation of recommended defaults on 2026-05-16). Ready for `/write-spec`.

---

## Final Summary

### Scope
- **~16 new finding types** added across three pack-finding scanners (Java, Spring Classic, Maven).
- Three new categories effectively in use: `migration_risk`, `security`, `dependency`, `testability`. `business_logic` category dropped along with the deferred LLM-enrichment finding types.
- **Zero AMS schema changes**: `discovery_findings` columns are TEXT with no DB CHECK constraints and no Java whitelist. New `finding_type` strings and categories require no Liquibase changeset.

### Key decisions (resolved — see D1-D8 below)
- Two would-be finding types collapsed into the existing `evidence_gap` type via a `gapType` discriminator in `detail_json` (D1).
- The Spring-specific `endpoint_code_runtime_mismatch` is dropped in favour of extending the predecessor Source-D runtime-evidence emission to also handle the no-usage case (D2).
- The two weakest-signal finding types (`complex_business_logic_candidate`, `state_change_outside_service_boundary`) are deferred to a future LLM-enrichment / method-body-analysis spec (D3).
- Risky-dependency ruleset is a hand-curated TypeScript array, version-controlled and code-reviewed (D4).
- Severity cutoffs are deterministic and hard-coded per scanner (D5).
- A new shared snippet-redaction utility is built fresh (no existing redactor in the codebase) (D6).
- v1 caps are hard-coded constants in scanner code; no `config_snapshot` extension (D7).
- Three-commit delivery sequence (D8).

### Services touched
- **`discovery-service`** (primary): new `findings/packFindingScanners/` folder, new `utils/snippetRedaction.ts`, Maven resolver extended to parse pom metadata (`<properties>`, `<build><plugins>`, `<parent>` version).
- **`frontend`** (minor): new label map at `frontend/src/components/Discovery/findingTypeLabels.ts` + three tests; drop-in usage in `FindingsTab.tsx`.
- **`architecture-model-service`**: untouched (no schema or Java code changes).
- **`gateway`**: untouched.

### Three-commit sequencing (D8)
1. **Commit 1 — Shared scaffolding + Java scanner.** Adds `findings/packFindingScanners/`, `snippetRedaction.ts`, `javaFindingScanner.ts`, wired into `discoveryV3Pipeline.ts` after Stage 2. Java finding tests.
2. **Commit 2 — Spring Classic scanner + runtime-mismatch extension.** Adds `springClassicFindingScanner.ts`; extends the existing runtime-evidence emission (`runDiscoveryRuntimeEvidence.ts`) to also emit findings for the `noUsage` case. Spring Classic finding tests + new no-usage emission tests.
3. **Commit 3 — Maven metadata parser + Maven scanner + frontend labels.** Extends `MavenDependencyResolver` (or sibling `mavenPomMetadataParser.ts`) to parse `<properties>`, `<build><plugins>`, `<parent>` version. Adds `mavenFindingScanner.ts` wired into `runManager.ts` after `buildRepoLookupTable`. Adds `riskyDependencyRules.ts`. Adds frontend `findingTypeLabels.ts` + 3 tests.

### Explicitly out of scope
- **Transitive dependency tree walking** — Maven resolver does not walk transitives today; conflicts are flagged only where the same pom declares multiple versions or `dependencyManagement` overrides.
- **Deep web.xml structured parsing** — filename + presence detection only (`web.xml` exists → flag); no servlet-mapping extraction.
- **`struts-config.xml`, `tiles-defs.xml`** — excluded (matches Spring Classic adapter's documented exclusions).
- **Method-body business-logic detection** — no cyclomatic complexity, no body-shape analysis. Deferred with the two dropped finding types.
- **Three dropped/deferred finding types** —
  - `java_evidence_gap` (folded into `evidence_gap` via gapType).
  - `missing_contract_detail` (folded into `evidence_gap` via gapType).
  - `endpoint_code_runtime_mismatch` (handled by extending Source D runtime-evidence emission, not a new type).
  - **Deferred (future LLM-enrichment / body-analysis spec):** `complex_business_logic_candidate`, `state_change_outside_service_boundary`.
- **Pack-level config snapshot extension** (`findings_per_pack`) — caps live as code constants instead.
- **LLM enrichment** — explicit per raw idea.
- **No edits to applied Liquibase changesets** (`135-discovery-findings.sql`); expanded vocabulary lives in this spec only.

### Visuals
**No visuals required** — backend-only work with a minor frontend label-map addition (no UI redesign, no new components, no layout changes).

---

## Resolved Decisions (D1-D8)

### D1 — Consolidate two would-be finding types into existing `evidence_gap`
**Resolution:** Collapse `java_evidence_gap` and `missing_contract_detail` into the predecessor `evidence_gap` finding type using a `gapType` discriminator inside `detail_json`.
- Java-side gap types: `java_unresolved_return_type`, `java_unresolved_import`, `java_class_no_methods` (extend as needed in scanner).
- Spring-side gap types: existing `endpoint_missing_response_schema` plus new `endpoint_missing_request_schema`, `endpoint_partial_path_variables`.
- **Net effect:** drops 2 of the 21 originally proposed finding types.

### D2 — Drop `endpoint_code_runtime_mismatch`; extend Source D instead
**Resolution:** Do not introduce `endpoint_code_runtime_mismatch` as a Spring-specific finding type. Instead, extend the existing runtime-evidence emission in `runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (Source D) so that the no-usage case (code endpoint present, no runtime hits) also emits a finding. Keeps runtime-vs-code mismatch detection in one place.
- **Net effect:** drops 1 more finding type. Commit 2 contains the Source D extension.

### D3 — Defer two weak-signal finding types to a future LLM-enrichment spec
**Resolution:** Defer `complex_business_logic_candidate` and `state_change_outside_service_boundary` to a future LLM-enrichment / method-body-analysis spec. Without method bodies or cyclomatic complexity, both finding types are too noisy to ship cheaply in v1. Source slot `source='llm_enrichment'` was already reserved by the predecessor (D7) for exactly this kind of work.
- **Net effect:** drops 2 more finding types. **Final total: ~16 new finding types.**

### D4 — Risky-dependency ruleset shape
**Resolution:** Ship the risky-dependency ruleset as a hand-curated TypeScript array at:
`discovery-service/src/services/findings/packFindingScanners/riskyDependencyRules.ts`

Shape: `{ groupId, artifactId, versionPredicate, reason, severity }[]`.

Version-controlled, code-reviewed, no JSON config file in v1. Seed list ~20-30 entries (e.g. `commons-logging` 1.0.x, `log4j` 1.x, `jackson-databind` <2.13, `javax.servlet:*`, etc.). The same file holds the Maven-plugin hard-coded version rules used by `maven_build_plugin_risk` (D5).

### D5 — Severity cutoffs (deterministic, hard-coded)
**Resolution:**
- **Java version (`java_version_detected`):**
  - `>= 17`: info
  - `11-16`: medium
  - `8`: medium
  - `< 8`: high
- **Spring Framework (`spring_version_detected`):**
  - `6.x`: info
  - `5.x`: medium
  - `4.x` or older: high
- **Maven plugins (`maven_build_plugin_risk`):** per-plugin hard-coded rules in `riskyDependencyRules.ts` (same file as D4). E.g. `maven-compiler-plugin < 3.8.0` = medium, `< 3.0` = high.
- **Risky dependency:** per-rule `severity` field in the rules file.

### D6 — Shared snippet-redaction utility
**Resolution:** Build a new utility at `discovery-service/src/utils/snippetRedaction.ts` (no existing redactor in the codebase). Rules:
- Truncate to **200 chars**.
- Replace quoted string literals (`"..."`, `'...'`) with `?`.
- Mask values for `password=`, `pwd=`, `secret=`, `token=`, `api_key=` (query-string and property-file forms).
- Drop HTTP `Authorization: Basic ...` headers.

Used by both the Java and Spring Classic finding scanners when including `code_snippet` in `detail_json`.

### D7 — v1 caps as hard-coded constants
**Resolution:** Do NOT extend `config_snapshot`. Caps live as constants in the scanner code:
- `MAX_FINDINGS_PER_TYPE_PER_RUN = 50`
- `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true`

Pack-level config snapshot extension is overkill for v1. Caps can be promoted to `config_snapshot` in a future iteration if operators need tunability.

### D8 — Three-commit delivery
**Resolution:** Split delivery into three commits (recapped in Final Summary above):
1. Shared scaffolding + Java scanner + `snippetRedaction.ts` + Java tests.
2. Spring Classic scanner + runtime-mismatch (Source D) extension + Spring/runtime tests.
3. Maven metadata parser extension + Maven scanner + `riskyDependencyRules.ts` + frontend `findingTypeLabels.ts` + Maven/frontend tests.

Per `feedback_no_src_edits_during_run.md`: each commit's build/test must happen when no discovery run is active.

---

## Codebase reality check (preserved from initial investigation)

### Pack file locations (confirmed)
- **Java language pack:** `discovery-service/src/services/extensionPacks/languagePacks/javaLangPack/index.ts`
  - Delegates to `extensionPacks/languageExtractors/java/extract.ts` + `astUtils.ts` + `javaParser.ts` (tree-sitter).
  - Side-pass HBM-XML parser: `hbmXmlParser.ts` + `hbmXmlMerge.ts`.
  - Side-pass Spring beans XML parser: `springBeansXmlParser.ts`.
  - `extract()` produces `SourceFileIR` entries; each carries `rawContent` (full file text) so framework-level call-site detection is possible.
- **Spring Classic framework pack:** `discovery-service/src/services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index.ts`
  - Thin wrapper; delegates to `extensionPacks/frameworkAdapters/springClassic/index.ts` (1972 lines).
- **Maven dependency resolver:** `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts`
  - NOT a `LanguagePack` / `FrameworkPack`; lives in the parallel dependency-resolver tier.
  - Today extracts only `<dependency>` blocks (groupId, artifactId, version, scope) + project coordinates. **Does NOT parse `<build>`, `<plugins>`, `<properties>`, `<parent>` version, `<dependencyManagement>` contents.** Commit 3 extends this.

### Finding infrastructure (from predecessor spec, confirmed present)
- `discovery-service/src/services/findings/FindingEmitter.ts` (singleton, exports `findingEmitter` + `FindingEmitRunContext`).
- `discovery-service/src/services/findings/emissionSources.ts` (per-source builders A/B/C/D/E/F/H).
- `discovery-service/src/services/findings/evidenceGapScanner.ts` — pattern the three new scanners follow.
- 7 v1 emission sites already wired into `discoveryV3Pipeline.ts`, `runManager.ts`, `runtimeEvidence/runDiscoveryRuntimeEvidence.ts`.
- **AMS persistence:** `discovery_findings` table — `finding_type`, `category`, `severity`, `source`, `status` are TEXT with **no DB CHECK constraints and no Java whitelist**. Adding ~16 new `finding_type` strings + 4 new categories requires **zero AMS schema or Java code changes**. SQL comments in `135-discovery-findings.sql` are NOT edited (Liquibase immutability).

### Pack contract — structural choice
The `LanguagePack.extract()` and `FrameworkPack.adapt()` contracts in `packTypes.ts` return IR / candidates only — they do NOT receive a `FindingEmitter`, nor return findings.

**Chosen approach (hybrid analyzer stage):** New folder `discovery-service/src/services/findings/packFindingScanners/` containing `javaFindingScanner.ts`, `springClassicFindingScanner.ts`, `mavenFindingScanner.ts`. Each takes pack output (IR / candidates / parsed deps) plus a `FindingEmitRunContext` and emits via `findingEmitter`. Call sites:
- Java + Spring Classic scanners called from `discoveryV3Pipeline.ts` after Stage 2, before merge.
- Maven scanner called from `runManager.ts` after `buildRepoLookupTable`.

Aligns with the predecessor `evidenceGapScanner.ts` pattern; keeps existing pack contracts and architecture-candidate generation untouched.

### Existing redactor utility
**None exists** in `discovery-service/src/utils/`. Built fresh per D6.

### Frontend label map
**Does not yet exist.** `FindingsTab.tsx` filter dropdowns currently render raw `finding_type` strings. Added per Commit 3 at `frontend/src/components/Discovery/findingTypeLabels.ts` exporting `FINDING_TYPE_LABELS: Record<string, string>` + `getFindingTypeLabel(type)`. Drop-in usage in `FindingsTab.tsx` `distinctFindingTypes` rendering. Three frontend tests.

---

## Existing Code to Reference (for spec-writer)

The four file paths the prior shaping call cited as the primary references for the new scanners:

1. `discovery-service/src/services/findings/evidenceGapScanner.ts` — pattern for the three new pack-finding scanners (input shape, emission idioms, run-context threading).
2. `discovery-service/src/services/findings/emissionSources.ts` — per-source builders (A/B/C/D/E/F/H); Commit 2 extends the Source D builder for the no-usage case.
3. `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts` — host of the existing runtime-evidence emission; Commit 2 extends to emit on `noUsage`.
4. `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` — Maven resolver extended in Commit 3 to parse pom metadata (`<properties>`, `<build><plugins>`, `<parent>` version).

Additional anchor files (call sites being wired):
- `discovery-service/src/services/discoveryV3Pipeline.ts` (Java + Spring Classic scanner call sites)
- `discovery-service/src/services/runManager.ts` (Maven scanner call site, after `buildRepoLookupTable`)
- `frontend/src/components/Discovery/FindingsTab.tsx` (consumer of new `findingTypeLabels.ts`)

---

## Project-memory cross-checks (preserved)

- `feedback_liquibase_immutable_changesets.md`: confirmed — no AMS schema changes, no edits to `135-discovery-findings.sql`. Expanded `finding_type` / `category` vocabulary documented in this spec only.
- `feedback_no_src_edits_during_run.md`: each commit's build/test runs only when no discovery run is active. Noted in tasks.
- `project_discovery_techhints_shape.md`: Java/Spring Classic finding scanners run inside the V3 pipeline gated by the same techHints already used for pack selection; no change to techHints handling.
- `project_discovery_run_robustness.md`: no overlap.

---

## Open product decisions

**None.** All eight open questions resolved (D1-D8 above). Shaping complete.
