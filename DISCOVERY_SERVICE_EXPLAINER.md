# Discovery Service Explainer

Audience: engineers who'll maintain, extend, or debug the discovery pipeline. Start with the summary, drill into the sections below for specifics.

## Summary

The **Discovery Service** turns a Git repo into a set of *architectural candidates* — classes, endpoints, entities, business-logic methods, UI components — that later get reviewed, approved, and persisted as the service's architecture model. There are two collaborating processes:

- **`discovery-service`** (Node/Express, TypeScript, port 8091) — orchestrates runs, walks source, invokes the V3 pipeline (packs first, LLM gap-fill second), writes results back.
- **`architecture-model-service`** (Java/Spring Boot, port 8080) — owns the Postgres model: projects, services, discovery configs, runs, candidates, and their review state.

One discovery run goes through these conceptual stages:

1. **Plan** — resolve the repo, clone it, enumerate source files (`scanPlanBuilder`).
2. **V3 pipeline** (see §3) — four sub-stages:
   - **Stage 1: LanguagePack extract** — deterministic per-language IR extraction.
   - **Stage 2: FrameworkPack adapt** — deterministic, framework-specific candidate emission on top of IR.
   - **Stage 3: LLM gap-fill** — composer-driven layered-prompt gap-fill over what packs produced (see §3.4).
   - **Stage 4: Merge + persist** — union candidates, compute the tier, persist the run record with its tier, and POST candidates/evidence/relationships back to `architecture-model-service`.

Packs are the deterministic backbone — they run first, fail fast on regressions, and produce a stable, tagged set of candidates. The LLM is the semantic gap-filler that layers on top. A typical run produces thousands of candidates where deterministic adapters sharpen known-shape artifacts and the LLM fills in broad semantic themes that packs can't reach.

---

## 1. The discovery config (framing)

Every project has a **discovery config** attached by the architecture-model-service. It declares:

- `repos` — list of `{ url, branch, excludePaths }` the run will clone
- `includePaths`, `excludePaths` — path filters applied to the scan plan
- `techHints` — map of `{ path, language, technology, version }` that steers pack activation and tier computation
- `repoApplicationMappings` — assign repo subtrees to application anchors
- `summary`, `notes` — human-readable framing context the LLM sees (once surfaced into the gap-fill prompt)

The config is versioned with `status: COMPLETE` once framing is finalized. Every run takes a snapshot of the config at creation time (`config_snapshot`) so behaviour is reproducible.

## 2. Service-scoped runs

When a run is scoped to one service (`serviceId` present on `POST /discovery/runs`), the pipeline does **not** use the project-level `techHints` from the config. Instead, `runManager.ts` synthesizes techHints from the service entity's `core_tech` free-text field, via `parseCoretech()`.

Example — `core_tech = "Java 21, Spring Boot 3.4.13, Spring Data JPA, Liquibase"` becomes:

```json
{
  "0": { "language": "Java", "version": "21" },
  "1": { "technology": "Spring Boot", "version": "3.4.13" },
  "2": { "technology": "Spring Data JPA" },
  "3": { "technology": "Liquibase" }
}
```

Each comma-separated entry becomes one techHint. `KNOWN_LANGUAGES` lookup decides whether the entry is a `language` or a `technology`. A trailing numeric token becomes `version`. **Each hint carries either `language` or `technology`, never both.** That matters for predicate matching (see §3.2).

A run then scopes the scan to the service's `repo_subfolder` (e.g. `model-logic-service` inside a monorepo) and inherits `excludePaths` from the project-level config so test code etc. stay excluded.

## 3. The V3 pipeline

V3 is the **only runtime pipeline**. It inverts the historical V2 order (LLM first, packs second) by running deterministic packs FIRST and layering LLM gap-fill SECOND on top of the structural facts packs produced. There is no `DISCOVERY_PIPELINE_VERSION` feature flag — every run goes through V3.

The V3 entry point is `runDiscoveryV3(context)` in `discovery-service/src/services/discoveryV3Pipeline.ts`. It is invoked unconditionally from `llmFileAnalysisStep.ts`.

### 3.1 Pack split — `LanguagePack` + `FrameworkPack`

V2 bundled `(file filter + language extractor + framework adapter)` into a single monolithic `ExtensionPack`. V3 splits that monolith into two typed tiers:

- **`LanguagePack`** — matches on language only. Shape:
  ```ts
  {
    id: string,
    when: { language: string },
    extract(sourceFiles, techHints): Map<filePath, SourceFileIR>
  }
  ```
  Responsibility: walk applicable source files, parse them with tree-sitter, produce the **Universal IR** (`SourceFileIR` / `ClassIR` / `FunctionIR` / `FieldIR` / `AnnotationIR` — same shape used by V2, reused unchanged).

- **`FrameworkPack`** — matches on language + technology. Shape:
  ```ts
  {
    id: string,
    when: { language: string, technology: string },
    adapt(irFiles, runId, techHints): DiscoveryCandidate[]
  }
  ```
  Responsibility: consume the IR map, emit framework-specific `DiscoveryCandidate`s tagged with `_addedBy: '<framework>-adapter'`.

The split means a single `LanguagePack` can feed many `FrameworkPack`s (one tree-sitter parse, N adapters) and the pipeline can still produce IR even when no framework adapter matches.

### 3.2 Predicate semantics (per-field AND across hints)

Registry lookups (`findLanguagePack(techHints)` and `findFrameworkPacks(techHints)`) reuse the existing per-field AND `matchesPredicate` from V2. A predicate with both `language` and `technology` matches iff:

- *Some* hint has the required `language`, AND
- *Some* hint has the required `technology`.

They don't have to be on the same hint. That fits the shape `parseCoretech` produces (one-field-per-hint) — a classic-Spring stack (`"Java, Spring"`) hits spring-classic's `{Java, Spring}` predicate but not spring-boot's `{Java, Spring Boot}`.

### 3.3 Tier model (A / B / C)

`computeTier(techHints): 'A' | 'B' | 'C'` derives the run's tier from what the registry can resolve:

- **Tier A** — a `LanguagePack` matches **AND** at least one `FrameworkPack` matches. Full deterministic coverage: both IR extraction and framework-specific adapters run. Gap-fill composes `base + language + frameworks/<frameworkPackId>.md` with pack-output + IR injection and tags LLM candidates `_addedBy: 'llm-gap-fill'`.
- **Tier B** — a `LanguagePack` matches but **no** `FrameworkPack` matches. IR is produced but no adapter claims it. Pack output is empty; gap-fill composes `base + language + frameworks/_no-framework-with-ir.md` with IR injection and tags candidates `_addedBy: 'llm-ir-guided'`.
- **Tier C** — **neither** matches. No deterministic output at all; gap-fill composes `base + generic-language.md (or specific language layer if recognized) + frameworks/_no-ir.md` from raw source only and tags candidates `_addedBy: 'llm-solo'`. Files where `parseCoretech` returns nothing usable are routed through Tier C as well (NOT skipped).

Per-file tier currently equals the run-level tier (simpler initial implementation; per-file refinement is future work).

The tier is computed every run and persisted — see §3.5. Per-tag confidence defaults (adapter / gap-fill / ir-guided / solo) are documented in §3.11.

**Tier <-> mode mapping.** The single-char `mode` value persisted on `discovery_run` (see §3.5) maps 1:1 to a human-readable mode string surfaced on the API:

| Tier | `discovery_run.mode` | API `mode` string |
|---|---|---|
| A | `'A'` | `'pack-supervised'` |
| B | `'B'` | `'language-only'` |
| C | `'C'` | `'llm-solo'` |

**API surface — tier, warnings, and the Tier C gate.** Tier is computed at the discovery-service route (`POST /discovery/runs`) BEFORE the run is persisted, so a rejected Tier C call never creates an orphaned row. `runDiscoveryV3` now accepts `tier: 'A' | 'B' | 'C'` as an input and no longer re-computes it internally.

Request/response shape changes on `POST /discovery/runs` (all fields additive):

- **Request body** gains optional `confirmLlmSolo: boolean` (default `false`).
- **Response body** gains `tier: 'A'|'B'|'C'`, `mode: 'pack-supervised'|'language-only'|'llm-solo'`, and `warnings: string[]`.

**Warning copy** (exact strings, centralized in `discovery-service/src/utils/tierCopy.ts`):

- Tier A: `[]` — no warnings.
- Tier B: `["Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill."]`
- Tier C: `["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]`

**Tier C gate.** If `computeTier(techHints) === 'C'` AND `body.confirmLlmSolo !== true`, the route returns **409 Conflict** with:

```json
{
  "error": {
    "code": "LLM_SOLO_CONFIRMATION_REQUIRED",
    "tier": "C",
    "mode": "llm-solo",
    "warnings": ["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]
  }
}
```

No call to `archModelClient.createDiscoveryRun` is made — no row is persisted. The same gate applies to both project-scoped and service-scoped runs.

**Example interaction — Tier C gate flow:**

```http
# First attempt — unknown stack, no opt-in
POST /discovery/runs
Content-Type: application/json

{ "projectId": "proj-abc", "serviceId": "svc-xyz" }
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": {
    "code": "LLM_SOLO_CONFIRMATION_REQUIRED",
    "tier": "C",
    "mode": "llm-solo",
    "warnings": ["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]
  }
}
```

```http
# Retry with explicit opt-in
POST /discovery/runs
Content-Type: application/json

{ "projectId": "proj-abc", "serviceId": "svc-xyz", "confirmLlmSolo": true }
```

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "runId": "run-123",
  "status": "PENDING",
  "tier": "C",
  "mode": "llm-solo",
  "warnings": ["Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed."]
}
```

The persisted run carries `mode = 'C'`, `confirmed_llm_solo = TRUE`, and the JSON-encoded Tier C warnings array on `discovery_run` (see §3.5 / §3.9).

**Preflight.** Callers can preflight tier + warnings before submitting by calling `GET /discovery/packs/applicable` — it returns `tier` and `warnings` using the same mapping as the gate, so UIs and CLIs can show the Tier C warning and ask for confirmation before firing `POST /discovery/runs`.

**Other endpoints surfacing tier/mode/warnings (all additive, backward-compatible):**

- `GET /discovery/runs/{runId}` (architecture-model-service) — returns `mode`, `tier` (derived from `mode`), `warnings`, `confirmedLlmSolo`.
- `GET /discovery/runs` (list) — returns `mode` + `tier` per entry (`warnings` omitted from list; available on detail).
- `GET /discovery/packs/applicable` (discovery-service) — returns `tier` + `warnings` alongside the resolved packs.

### 3.4 Stage-by-stage

**Stage 1 — LanguagePack extract.** `findLanguagePack(techHints)` resolves the first matching language pack (or null). If present, its `extract(sourceFiles, techHints)` walks applicable files, parses them with tree-sitter, and returns a `Map<filePath, SourceFileIR>`. If no language pack matches (Tier C), Stage 1 produces an empty map and Stage 2 has nothing to feed.

**Stage 2 — FrameworkPack adapt.** `findFrameworkPacks(techHints)` resolves every matching framework pack (may be zero, one, or many). Each pack's `adapt(irFiles, runId, techHints)` consumes the Stage-1 IR map and emits `DiscoveryCandidate`s tagged `_addedBy: '<framework>-adapter'` (e.g. `'spring-classic-adapter'`). On Tier B/C, this stage emits zero framework candidates.

**Stage 3 — LLM gap-fill.** Stage 3 invokes `runLlmGapFill` in `discovery-service/src/services/llmGapFillStep.ts`. It takes pack output (Stage 2 candidates), the IR map (Stage 1), the scanned source files, and the run tier, then produces surviving LLM-authored candidates alongside pack candidates. Shape:

- **Composer-driven layered prompts.** For each file, `composePrompt({ tier, language, frameworkPackId, packOutput, ir, sourceFile })` (in `discovery-service/src/services/prompts/composer.ts`) assembles the prompt from plain-markdown layers stored under `discovery-service/src/services/prompts/`:
  - `base.md` (~300 tokens) — role, JSON output schema, confidence scale, hard anti-restate rule.
  - `generic-language.md` — Tier C language-agnostic fallback.
  - `languages/java.md`, `languages/typescript.md` — language idioms and extraction nuances.
  - `frameworks/spring-classic.md` — enumerates what the adapter catches vs. misses (XML bean config, HBM XML, AOP cross-cuts, inter-service RestTemplate/FeignClient/JMS calls).
  - `frameworks/_no-framework-with-ir.md` — Tier B instruction variant.
  - `frameworks/_no-ir.md` — Tier C instruction variant.
  Injection of pack output (fenced JSON array of `{type, name, filePath, hint?}`) and IR (compact per-file JSON summary — classes + methods + imports only, no full AST) is handled by a single renderer in `services/prompts/injection.ts`; empty pack-output / missing IR render as `[]` / `{}` and are never omitted.
- **Skip heuristic.** The LLM call is skipped for a file only if the pack produced >= `GAP_FILL_SKIP_THRESHOLD` (default 3) candidates AND **zero** gap signals trip. Signals (any one forces the call):
  - `unparsed_xml` — unparsed XML/YAML/properties blocks present in the file.
  - `low_capture` — >200 lines with <3 pack candidates (low capture ratio).
  - `business_comments` — top-40-line scan finds business-term comments/Javadoc.
  - `external_imports` — imports outside the framework pack's remit (RestTemplate, WebClient, FeignClient, JMS, Kafka, Rabbit for spring-classic).
  Skip decisions log per file with the active signal set.
- **Concurrency.** Per-file LLM calls run in parallel with a configurable limit (`GAP_FILL_CONCURRENCY`, default 5). Gap-fill is per-file (no cross-file analysis), so parallelism is safe.
- **Failure handling.** Per-file failure (network error, non-JSON response, schema-invalid JSON) pushes `{ filePath, error }` onto `steps_payload.v3.gapFill.failures[]`, emits zero candidates for that file, and allows the run to continue. If the failure rate exceeds `GAP_FILL_MAX_FAILURE_RATE` (default 0.2), the stage is marked failed.
- **Dedup.** Surviving LLM candidates are deduped against pack candidates via `services/prompts/dedup.ts`. Key = `(type exact, normalizeName(name), forward-slash-normalized relative filePath)`. `normalizeName` trims, lowercases, and collapses internal whitespace/underscores/hyphens to a single space (so `PatientController`, `patient_controller`, and `Patient Controller` collide). Each dropped duplicate emits a log line; dropped count is surfaced on the stage payload.
- **Post-parse injection.** Candidates emitted by the LLM must carry `type`, `name`, `filePath`, `confidence`; the stage injects `_addedBy` (tier-appropriate: `llm-gap-fill` for Tier A, `llm-ir-guided` for Tier B, `llm-solo` for Tier C), `sourceClusterIds: []`, and `discoveryRunId`. Optional LLM fields (e.g. `description`) pass through as emitted.
- **Persistence of `promptVersion`.** The composer returns four 8-char SHA-256 hashes — `{ base, language, framework, composed }` (`composed` is hashed over the full assembled template excluding per-file data) — persisted on every run under `steps_payload.v3.gapFill.promptVersion` for reproducibility and diffing across prompt iterations.

**Stage 4 — Merge + persist.** Pack candidates from Stages 1-2 are preserved as-is and surviving LLM candidates (post-dedup) are appended. The tier is computed via `computeTier(techHints)`, and the run record is persisted with its tier in `discovery_run.mode`. Evidence atoms, relationships, candidates, clusters, and decision tasks are POSTed to `architecture-model-service` through the existing candidate-save paths.

### 3.5 Tier observability — `discovery_run.mode` + `confirmed_llm_solo` + `warnings`

The computed tier is persisted on every V3 run in a nullable column **`discovery_run.mode`** (`VARCHAR(1) NULL`, added by Liquibase changeset `083-discovery-run-mode.sql`). The column is nullable so historical V2 rows (all pre-Spec-1 runs) stay valid with `mode = NULL`. For runs produced by V3, `mode` is one of `'A'`, `'B'`, `'C'`.

Two additional columns were added by the V3 Tier UX spec to audit the Tier C opt-in and retain the warnings surfaced at creation time:

- **`discovery_run.confirmed_llm_solo`** — `BOOLEAN NOT NULL DEFAULT FALSE`, added by Liquibase changeset `084-discovery-run-confirmed-llm-solo.sql`. Set to `TRUE` only when a Tier C run proceeded via explicit `confirmLlmSolo: true` opt-in on `POST /discovery/runs`. Tier A/B runs retain the `FALSE` default. Existing rows keep `FALSE` (no backfill).
- **`discovery_run.warnings`** — `TEXT NULL`, added by Liquibase changeset `085-discovery-run-warnings.sql`. Stores a JSON-encoded `string[]` — empty `[]` for Tier A, one-element array for Tier B/C using the exact copy from §3.3. `TEXT` (not `JSONB`) to match the project's existing Liquibase portability pattern. Existing rows keep `NULL` (no backfill).

The value flows (unchanged from the `mode`-only case, just more fields on the wire):

```
computeTier(techHints)                                              // discovery-service route
  -> archModelClient.createDiscoveryRun({ mode, warnings,            // HTTP POST
                                          confirmedLlmSolo })
  -> DiscoveryRunDto.{ mode, warnings, confirmedLlmSolo, tier }      // architecture-model-service DTO
  -> DiscoveryRunService.createRun(..., mode, warnings,              // service
                                    confirmedLlmSolo)
  -> EntityMapper                                                    // DTO <-> entity
  -> DiscoveryRunEntity.{ mode, warnings, confirmedLlmSolo }         // JPA
  -> discovery_run.{ mode, warnings, confirmed_llm_solo }            // Postgres
```

The `tier` field on the DTO is **derived** from the existing single-char `mode` column (A/B/C) and surfaced on GET endpoints for callers that prefer the tier letter over the column's internal representation.

Operators looking at a completed run can SQL the `discovery_run` table directly, or drive it through `/discovery/runs/{runId}/diagnostics`. Combined with the `steps_payload.v3.gapFill` payload (see §3.9), the two surfaces together let you distinguish which tier a run landed in, whether Tier C was explicitly opted into, and what the gap-fill stage produced. Per-tag confidence defaults on new candidates are covered in §3.11.

### 3.6 Current V3 pack coverage

Only **spring-classic** has been migrated to V3. Its two halves live at:

**9 `LanguagePack`s registered** (`when: {language}` only):

| Pack | Language match |
|---|---|
| `javaLangPack` | Java |
| `typescriptLangPack` | TypeScript |
| `pythonLangPack` | Python |
| `rubyLangPack` | Ruby |
| `phpLangPack` | PHP |
| `goLangPack` | Go |
| `csharpLangPack` | C# |
| `javascriptLangPack` | JavaScript (distinct from TypeScript — different extractors) |
| `cppLangPack` | C++ |

**18 `FrameworkPack`s registered** (`when: {language, technology}`; candidates tagged `_addedBy: '<framework>-adapter'`):

| Language | Framework Pack | Predicate technology |
|---|---|---|
| Java | `springClassicFrameworkPack` | Spring |
| Java | `springBootFrameworkPack` | Spring Boot |
| TypeScript | `reactTypescriptFrameworkPack` | React |
| TypeScript | `nestjsFrameworkPack` | NestJS |
| TypeScript | `angularFrameworkPack` | Angular |
| Python | `djangoFrameworkPack` | Django |
| Python | `flaskFrameworkPack` | Flask |
| Ruby | `railsFrameworkPack` | Rails |
| PHP | `wordpressFrameworkPack` | WordPress |
| PHP | `symfonyFrameworkPack` | Symfony |
| PHP | `magentoFrameworkPack` | Magento |
| Go | `kratosFrameworkPack` | Kratos |
| C# | `aspNetCoreFrameworkPack` | ASP.NET Core |
| C# | `aspNetFrameworkFrameworkPack` | ASP.NET |
| JavaScript | `reactJavascriptFrameworkPack` | React |
| JavaScript | `jqueryFrameworkPack` | jQuery |
| C++ | `wxwidgetsFrameworkPack` | wxWidgets |
| C++ | `oatppFrameworkPack` | Oatpp |

Services whose tech stack no `FrameworkPack` claims fall into Tier B or C (see §3.3) and produce zero (or IR-only) deterministic candidates — Stage 3 gap-fill compensates through the Tier B / C prompt variants.

### 3.7 V2 runtime removal (complete)

V2 is gone from the codebase, not just from the runtime path. The V3 Pack Migration Batch spec (Spec 4) removed:

- `extensionPackRegistry.runPacks()` and `getApplicablePacks()` — deleted
- `packs[]` array and `registerPack()` function — deleted
- The legacy `ExtensionPack` type — deleted from `types/extensionPack.ts`
- All 17 `<framework>PackV2/` directories — deleted
- Legacy v1 `services/extensionPacks/javaSpringBoot/` and `services/extensionPacks/reactTypescript/` — deleted (shared utilities moved into their V3 language packs)

`register.ts` contains only `registerLanguagePack(...)` + `registerFrameworkPack(...)` calls. There is **no V2 runtime or V2 source code left to re-enable**. Pre-V3 discovery runs in the database still have `mode = NULL` and no `v3.gapFill` payload (the historical narrative in §4 describes what those runs did).

**Known adapter quality follow-ups** (all structural migrations are complete and gate-passing; these are pre-existing detection gaps surfaced by V3 fixtures, tracked in `discovery-service/evaluation/FIXTURES-TODO.md`):

- `react-typescript` — no TypeScript-React reference repo cloned yet; zero candidates on the JS-only realworld app (structural migration complete).
- `asp-net-core` — 36 candidates on eShopOnWeb (exact V2 parity). Adapter misses Ardalis API Endpoints and EF Core Fluent API; these are the bulk of eShopOnWeb's structure.
- `react-javascript` — 9 candidates on react-redux-realworld (exact V2 parity). Adapter walks `function_declaration` only and misses arrow-function components.
- `jquery` — 0 candidates on jquery-ui (exact V2 parity). Adapter doesn't recurse into IIFE-wrapped widget definitions (the canonical jquery-ui pattern).
- Tree-sitter single-file parse failures for very-large PHP / Ruby / C++ sources; full-repo walks work fine. Fixtures select medium-sized representative files.

### 3.8 Gateway endpoint + env knobs

**Gateway endpoint — `POST /api/v1/discovery/v3/gap-fill`.** The discovery-service composes the prompt locally and POSTs the fully-assembled string to this stateless relay route. The route forwards to the existing LLM client using the same invocation pattern as `discoveryFileAnalysisRoute.ts`, returns the LLM response body unmodified, and does **not** load any prompt file from `gateway/src/config/prompts/`. Gateway carries no V3 prompt state.

**V2 reference artifacts retained, not used by V3:**
- `POST /api/v1/discovery/analyze-files` — the V2 route remains untouched and available for reference and any residual callers.
- `gateway/src/config/prompts/discovery.file-analysis.prompt.md` — the V2 prompt file remains in-tree, also untouched, and is explicitly **not** consumed by the new `/discovery/v3/gap-fill` route.

**Environment-variable knobs** (all overridable via process env):

| Variable | Default | Purpose |
|---|---|---|
| `GAP_FILL_CONCURRENCY` | `5` | Max parallel per-file LLM calls in the gap-fill stage. |
| `GAP_FILL_SKIP_THRESHOLD` | `3` | Minimum pack-candidate count (N) to consider skipping the LLM call. Skip applies only if pack produced >= N **and** zero signals trip. |
| `GAP_FILL_SKIP_SIGNALS` | (all four) | Comma-separated signal id list override. Valid ids: `unparsed_xml`, `low_capture`, `business_comments`, `external_imports`. Any listed signal tripping forces the LLM call regardless of pack-candidate count. |
| `GAP_FILL_MAX_FAILURE_RATE` | `0.2` | Per-stage failure-rate threshold. If the proportion of per-file LLM failures exceeds this, the gap-fill stage is marked failed. |
| `DISCOVERY_FILE_LINE_LIMIT` | (unchanged from prior behaviour) | Source-file line cap fed into the prompt. Layered prompts reduce the effective file-line budget; the cap itself is unchanged. |
| `CONFIDENCE_ADAPTER` | `0.9` | Default midpoint confidence for candidates tagged `_addedBy: '<framework>-adapter'` when the adapter does not emit its own `confidence`. See §3.11. |
| `CONFIDENCE_LLM_GAP_FILL` | `0.75` | Default midpoint confidence for Tier A LLM candidates (`_addedBy: 'llm-gap-fill'`). See §3.11. |
| `CONFIDENCE_LLM_IR_GUIDED` | `0.6` | Default midpoint confidence for Tier B LLM candidates (`_addedBy: 'llm-ir-guided'`). See §3.11. |
| `CONFIDENCE_LLM_SOLO` | `0.4` | Default midpoint confidence for Tier C LLM candidates (`_addedBy: 'llm-solo'`). See §3.11. |

### 3.9 `steps_payload.v3.gapFill` shape

The payload shape itself is unchanged by the V3 Tier UX spec — tier-related fields live on the `discovery_run` row (`mode` from Spec 1, plus `confirmed_llm_solo` and `warnings` added by Liquibase 084 and 085 — see §3.5), not inside `steps_payload`. `discovery_run` therefore now carries four V3-specific columns in total: `mode` (A/B/C), `confirmed_llm_solo` (Tier C opt-in audit flag), `warnings` (JSON-encoded `string[]` surfaced at creation), plus `steps_payload.v3.gapFill` for Stage 3 diagnostics.

Every V3 run writes a `gapFill` block under `steps_payload.v3`:

```jsonc
{
  "v3": {
    "gapFill": {
      "stageStatus": "completed",          // 'completed' | 'failed'
      "filesProcessed": 835,                // count of files the stage considered (including skipped)
      "dedupDroppedCount": 12,              // LLM candidates dropped due to collision with pack candidates
      "failures": [                         // per-file failure records; empty array when none
        { "filePath": "api/src/main/java/.../OpaqueService.java", "error": "Unexpected token < in JSON at position 0" }
      ],
      "promptVersion": {                    // 8-char truncated SHA-256 hashes
        "base": "a1b2c3d4",
        "language": "e5f6a7b8",
        "framework": "c9d0e1f2",
        "composed": "3a4b5c6d"               // hash of full assembled template excluding per-file data
      }
    }
  }
}
```

Field semantics:
- `stageStatus` — `'completed'` when failures stayed under `GAP_FILL_MAX_FAILURE_RATE`, otherwise `'failed'`. The overall run is not aborted on `'failed'`; it completes with pack candidates only and the stage payload records the condition for operator follow-up.
- `filesProcessed` — number of files the gap-fill stage considered (skipped files still count; they just didn't trigger an LLM call).
- `dedupDroppedCount` — count of LLM candidates dropped by the dedup step; for OpenMRS runs this should stay under 2% of emitted items (logged rate used as a health signal).
- `failures[]` — entries are shape `{ filePath, error }`, one per per-file failure. Zero candidates are emitted for each listed file.
- `promptVersion` — four 8-char SHA-256 hashes computed from the assembled markdown layers (`base`, `language`, `framework`) and the full composed template excluding per-file data (`composed`). `language` and `framework` reflect whichever layer was selected for the run's tier (e.g. `language = generic-language.md` hash for Tier C runs; `framework = _no-ir.md` hash for Tier C, `_no-framework-with-ir.md` hash for Tier B, or `spring-classic.md` hash for Tier A).

### 3.10 Example flow — classic-Spring (OpenMRS)

1. `POST /discovery/runs` with `{ projectId, serviceId }` (service has `core_tech = "Java, Spring"`).
2. `runManager` synthesizes techHints: `{0: {language:'Java'}, 1: {technology:'Spring'}}`.
3. `runDiscoveryV3` is invoked.
4. Stage 1: `findLanguagePack` returns `javaLangPack`; `extract` parses ~835 `.java` files into IR.
5. Stage 2: `findFrameworkPacks` returns `[springClassicFrameworkPack]` (spring-boot's `{Java, Spring Boot}` predicate rejects). `adapt` walks the IR and emits ~1037 candidates tagged `_addedBy: 'spring-classic-adapter'`.
6. Stage 3: `runLlmGapFill` composes Tier A prompts (`base + java + spring-classic` + pack-output JSON + IR JSON + source file), parallelizes per-file calls at `GAP_FILL_CONCURRENCY`, skips files where the pack produced >=3 candidates and no signal tripped, dedups against pack candidates, and persists `steps_payload.v3.gapFill` with the stage status, `filesProcessed`, `dedupDroppedCount`, `failures[]`, and the four-hash `promptVersion`.
7. Stage 4: merge pack + surviving LLM candidates, compute `tier = 'A'` (language pack matched + framework pack matched), persist `discovery_run.mode = 'A'`, POST candidates/evidence/relationships to `architecture-model-service`.

### 3.11 Confidence scores

Every new candidate carries a numeric `confidence` in `[0.0, 1.0]` derived from its `_addedBy` tag. Defaults and ranges are centralized in **`discovery-service/src/services/confidence.ts`** (single source of truth) and applied at candidate emission only — existing candidate rows are never backfilled. Rows with `confidence = NULL` are treated by the review UI as "unmarked" and are always visible regardless of any confidence-threshold filter (unmarked is not the same as "below").

**Per-tag midpoints + ranges:**

| `_addedBy` tag | Midpoint | Valid range | Tier produced by |
|---|---|---|---|
| `<framework>-adapter` (any) | 0.9 | [0.85, 0.95] | A (pack output) |
| `llm-gap-fill` | 0.75 | [0.7, 0.8] | A (LLM on top of adapter output) |
| `llm-ir-guided` | 0.6 | [0.5, 0.7] | B (LLM over IR only) |
| `llm-solo` | 0.4 | [0.3, 0.5] | C (LLM over raw source only) |

**Application rules** (implemented by `assignConfidence(candidate, addedBy, llmEmittedConfidence?)`):

- **Adapter-emitted values preserved.** If a `<framework>-adapter` candidate already carries an explicit `confidence`, it is kept verbatim — never overwritten, even if outside the [0.85, 0.95] range. Most adapters emit 0.85–0.95 already; those pass through unchanged.
- **LLM-emitted explicit values clamped.** When the LLM returns its own `confidence` in a response, the value is clamped into the tag's range: values inside the range are kept; values outside the range fall back to the tag midpoint.
- **Missing values filled with the midpoint.** Any candidate arriving without a `confidence` gets the tag midpoint assigned at emission.
- **Dedup collision — adapter wins.** On a `<framework>-adapter` + `llm-gap-fill` collision, the adapter candidate survives with its `confidence` (typically 0.9) and `_addedBy: '<framework>-adapter'`; the LLM candidate is dropped. The underlying dedup algorithm (`services/prompts/dedup.ts`) is unchanged by this spec.

**Env overrides.** The four midpoints are read at module init from env vars, defaulting to the values in the table above: `CONFIDENCE_ADAPTER`, `CONFIDENCE_LLM_GAP_FILL`, `CONFIDENCE_LLM_IR_GUIDED`, `CONFIDENCE_LLM_SOLO` (see §3.8). Invalid env values fall back to the spec defaults.

**UI integration.** The review UI exposes a confidence slider on the candidate table (range 0.0–1.0, step 0.05, default threshold 0.7). Candidates with `confidence < threshold` are hidden; NULL-confidence candidates are always visible regardless of threshold. A per-candidate tier badge uses the same tag -> color mapping: adapter -> success/green, gap-fill -> warning/yellow, ir-guided -> caution/orange, solo -> danger/red.

## 4. Historical V2 narrative (for readers of old runs)

This section exists so engineers investigating pre-V3 runs have context. **It does not describe the current runtime, and the V2 source code no longer exists in-tree.**

V2 ran the LLM first and extension packs second:

- The LLM file-analysis step processed every file and emitted candidates **with no `_addedBy` tag** (absence of tag == LLM-authored).
- `extensionPackRegistry.runPacks()` then evaluated registered `ExtensionPack`s against techHints. Each pack was monolithic: predicate + file filter + language extractor + framework adapter bundled as a single `.enrich(ctx)` method.
- Candidates with `_addedBy: '<framework>-adapter'` from packs were unioned with the tag-less LLM candidates.

That order had three problems V3 fixed:
1. **LLM cost** — running the LLM first burned tokens even on files where deterministic packs could have covered everything.
2. **Fail-slow pack regressions** — because LLM ran first, a pack regression didn't fail the run early; it just shifted what was tagged `_addedBy`.
3. **Monolithic pack shape** — V2 couldn't gracefully degrade when a language extractor existed but no framework adapter matched, because the two were fused.

Pre-V3 discovery runs in the database will have `discovery_run.mode = NULL` (V3 runs populate it), no `v3.gapFill` payload in `steps_payload`, and candidate provenance split between LLM (no `_addedBy`) and V2 packs (`_addedBy: '<framework>-adapter'`). The V2 code paths that produced those runs are fully deleted — `runPacks`, `getApplicablePacks`, `registerPack`, the `ExtensionPack` type, and all 17 `<framework>PackV2/` directories no longer exist. Debugging a pre-V3 run requires looking at the persisted candidates and run payload only; there is no longer any source code that can reproduce V2 behaviour.

## 5. Persist

After Stage 4, candidates flow to `architecture-model-service`:

- Evidence atoms -> `/discovery/runs/{runId}/evidence`
- Relationships -> `/discovery/runs/{runId}/relationships`
- Candidates -> `/discovery/runs/{runId}/candidates` (paginated)
- Clusters -> `/discovery/runs/{runId}/clusters`
- Decision tasks -> `/discovery/runs/{runId}/decision-tasks`

Each candidate enters `review_status: pending_review`. The user later reviews and either approves (promotes to the model) or rejects. Approved candidates are persisted via a DELETE-ALL -> re-INSERT pattern on the service's architectural entities; FKs are `DEFERRABLE INITIALLY DEFERRED` so the transaction completes atomically.

## 6. End-to-end example

`svc-mo4mclfb-213cv` is OpenMRS core — `core_tech = "Java, Spring"`, `repo_location = https://github.com/openmrs/openmrs-core.git`.

1. `POST /discovery/runs` with `{ projectId, serviceId: 'svc-mo4mclfb-213cv' }` on port 8091.
2. `archModelClient.createDiscoveryRun` creates the run in the model DB (status `PENDING`), `startRun()` fires asynchronously.
3. RunManager resolves the repo, shallow-clones it, synthesizes techHints from `core_tech`: `{0: {language:'Java'}, 1: {technology:'Spring'}}`.
4. Scan plan: ~835 `.java` files under `api/src/main/java` + `web/src/main/java` (excludes tests, generated, resources, tools, liquibase).
5. `runDiscoveryV3` is invoked. Stage 1 (`javaLangPack`) parses the `.java` set into IR. Stage 2 (`springClassicFrameworkPack`) walks each `ClassIR`:
   - `@Controller` / `@RestController` -> `interface` + `endpoint` candidates
   - `@Entity` -> `physical_entity` + `physical_attribute` + `entity_relationship` candidates (JPA column / ORM relationship annotations)
   - `@Service` / name-matches-`/Service$/` -> `business_logic` candidates (excluding getters/setters/CRUD boilerplate)
   - DTO referenced by endpoint return / @RequestBody -> `logical_entity` + `logical_data_attribute`
6. Stage 2 produces ~1037 candidates tagged `_addedBy: 'spring-classic-adapter'`.
7. Stage 3 composes Tier A prompts per file (`base + languages/java + frameworks/spring-classic` + pack-output JSON + IR JSON + source), relays each through `POST /api/v1/discovery/v3/gap-fill`, dedups surviving candidates against pack output, and records failures / dedup count / `promptVersion` on `steps_payload.v3.gapFill`. Surviving candidates are tagged `_addedBy: 'llm-gap-fill'`.
8. Stage 4: tier resolves to `'A'` (language + framework both matched). All candidates persisted to the model DB. Run transitions to `COMPLETED` with `discovery_run.mode = 'A'`. `filesAnalyzed: 835`.

Breakdown typical for this repo shape (pack output plus Tier A gap-fill):
- `business_logic`: ~390 (adapter) + gap-fill additions for non-annotated service classes the adapter misses
- `physical_attribute`: ~372 (adapter)
- `entity_relationship`: ~191 (adapter)
- `physical_entity`: adapter catches the `@Entity`-annotated; gap-fill surfaces POJO-shaped entities the adapter misses
- `interface`/`endpoint`: <=2 from adapter (OpenMRS core has essentially no `@Controller` — REST lives in a separate `openmrs-module-webservices.rest` repo); gap-fill surfaces any inter-service RestTemplate/FeignClient call sites

## 7. Diagnostic endpoints

- `GET /health` — liveness
- `GET /discovery/packs` — list registered packs (V3 registries: `languagePacks[]` + `frameworkPacks[]`)
- `GET /discovery/packs/applicable?coreTech=<string>` — given a core_tech free-text (e.g. `"Java, Spring"`), return parsed techHints, the language pack that would activate, and the framework packs that would activate. Use this to sanity-check service configuration before paying for an LLM run.
- `GET /discovery/runs/{runId}/diagnostics` — step-level timing, file counts, and payload for an existing run (including `steps_payload.v3.gapFill` and tier).

## 8. Local harness (no LLM)

`discovery-service/scripts/run-pack-local.ts` mirrors the V3 pack path without the LLM, useful for pack development and regression checks:

```bash
# Shallow-clone a repo, run LanguagePack.extract + FrameworkPack.adapt, dump candidate summary
npx tsx scripts/run-pack-local.ts C:/tmp/openmrs-core "Java, Spring"
```

It parses `core_tech` through `parseCoretech`, resolves the applicable packs via `findLanguagePack` / `findFrameworkPacks`, walks the source tree with the same extension/exclusion rules the scan-plan builder uses, calls `LanguagePack.extract` to produce the IR map, and then calls each `FrameworkPack.adapt` on that IR. Adapter output is deterministic and matches production within variance caused by file-walk rules. The harness emits candidate counts and per-candidate `(type, name, filePath, _addedBy)` detail sufficient for identity-equality spot-checks against baseline. The harness intentionally skips Stage 3 so it makes zero LLM calls.

`scripts/batch-validate-packs.sh` drives the V3 entry point across the OpenMRS checkout as the parity target for V2->V3 migration validation.

## 9. Where things live

```
discovery-service/
  src/
    services/
      discoveryV3Pipeline.ts              # runDiscoveryV3 — the four-stage orchestrator
      llmGapFillStep.ts                   # runLlmGapFill — Stage 3 implementation (composer + skip + dedup + failure handling)
      extensionPackRegistry.ts            # languagePacks[] + frameworkPacks[], register*, find*, computeTier, matchesPredicate
      llmFileAnalysisStep.ts              # invokes runDiscoveryV3 unconditionally
      runManager.ts                       # startRun, service-scoped orchestration, tier propagation
      scanPlanBuilder.ts                  # filesystem walk + include/exclude
      repoAccess.ts                       # git clone via child_process
      archModelClient.ts                  # HTTP client for architecture-model-service (carries `mode`, `warnings`, `confirmedLlmSolo` on create/updateDiscoveryRun)
      gatewayClient.ts                    # analyzeFiles (V2 reference) + gapFill (V3, POSTs to /discovery/v3/gap-fill)
      confidence.ts                       # single source of truth for per-tag midpoints + ranges; env overrides (CONFIDENCE_*); assignConfidence helper
      prompts/
        composer.ts                       # composePrompt({tier, language, frameworkPackId, packOutput, ir, sourceFile})
        injection.ts                      # pack-output + IR JSON renderer (single renderer, no per-pack hooks)
        dedup.ts                          # normalizeName, dedupKey, dedup function
        base.md                           # role + JSON schema + anti-restate rule (~300 tokens)
        generic-language.md               # Tier C fallback language-agnostic guidance
        languages/{java,typescript,python,ruby,php,go,csharp,javascript,cpp}.md  # one per registered language pack
        frameworks/{spring-classic,java-spring-boot,react-typescript,nestjs,angular,django,flask,rails,wordpress,symfony,magento,kratos,asp-net-core,asp-net-framework,react-javascript,jquery,wxwidgets,oatpp}.md  # one per registered framework pack
        frameworks/_no-framework-with-ir.md  # Tier B instruction variant
        frameworks/_no-ir.md              # Tier C instruction variant
      extensionPacks/
        register.ts                       # side-effect imports — registers 9 LanguagePacks + 18 FrameworkPacks
        index.ts                          # barrel (LanguagePack, FrameworkPack, TechHints types + SourceFileIR re-export)
        packTypes.ts                      # V3 LanguagePack + FrameworkPack interfaces
        languageIR.ts                     # SourceFileIR/ClassIR/FunctionIR/FieldIR/AnnotationIR
        languageExtractors/<lang>/        # tree-sitter -> IR (reused by LanguagePacks); one dir per supported language
        frameworkAdapters/<framework>/    # IR -> DiscoveryCandidate[] (reused by FrameworkPacks); one dir per framework
        languagePacks/
          javaLangPack/                   # Java
          typescriptLangPack/             # TypeScript
          pythonLangPack/                 # Python (django + flask)
          rubyLangPack/                   # Ruby (rails)
          phpLangPack/                    # PHP (wordpress + symfony + magento)
          goLangPack/                     # Go (kratos)
          csharpLangPack/                 # C# (asp-net-core + asp-net-framework)
          javascriptLangPack/             # JavaScript — separate from typescript (react-javascript + jquery)
          cppLangPack/                    # C++ (wxwidgets + oatpp)
        frameworkPacks/
          springClassicFrameworkPack/
          springBootFrameworkPack/
          reactTypescriptFrameworkPack/
          nestjsFrameworkPack/
          angularFrameworkPack/
          djangoFrameworkPack/
          flaskFrameworkPack/
          railsFrameworkPack/
          wordpressFrameworkPack/
          symfonyFrameworkPack/
          magentoFrameworkPack/
          kratosFrameworkPack/
          aspNetCoreFrameworkPack/
          aspNetFrameworkFrameworkPack/
          reactJavascriptFrameworkPack/
          jqueryFrameworkPack/
          wxwidgetsFrameworkPack/
          oatppFrameworkPack/
        # <packName>PackV2/ directories + legacy javaSpringBoot/ + reactTypescript/ directories — DELETED by Spec 4 (V3 Pack Migration Batch).
        # Shared utilities (javaParser.ts, tsxParser.ts, fileFilter.ts, etc.) from those directories were moved into their corresponding V3 languagePack directory during removal.
    evaluation/
      types.ts                            # ExpectedCandidate / ShouldNotEmitEntry / FixtureCase / FixtureReport / FrameworkReport / AggregateReport
      fixtureLoader.ts                    # walks evaluation/fixtures/<framework>/<case>/ and validates expected.json
      runner.ts                           # runEvaluation(options) — orchestrates load -> invoke -> score -> aggregate -> compare
      metrics.ts                          # five per-metric calculators (pack recall, gap-fill precision/recall, duplication, hallucination)
      aggregation.ts                      # micro-average aggregation (sum numerators / sum denominators across fixtures)
      baseline.ts                         # baseline load + directional threshold gating (5% default)
      llmFixtureStrategy.ts               # replay / live / record strategy swapped in for gatewayClient.gapFill
      pipelineInvoker.ts                  # default pipeline wrapper (spring-classic V3 path for now)
    types/
      candidate.ts                        # DiscoveryCandidate — schema contract the LLM must emit + post-parse fields
      # types/extensionPack.ts (legacy ExtensionPack type) — DELETED by Spec 4 (V3 Pack Migration Batch)
    routes/
      runs.ts, packs.ts, phase0.ts, ...
    utils/
      coreTechParser.ts                   # "Java, Spring" -> { 0: {language}, 1: {technology} }
      tierCopy.ts                         # tier -> { mode, warnings[] } mapping (exact warning copy strings, shared by POST /discovery/runs gate and GET /discovery/packs/applicable)
  scripts/
    run-pack-local.ts                     # V3 local harness (LanguagePack.extract + FrameworkPack.adapt; no Stage 3)
    batch-validate-packs.sh               # run V3 harness across OpenMRS for parity check
    run-evaluation.ts                     # evaluation harness CLI (--framework, --all, --baseline, --update-baseline, --live, --record, --report-dir)
    annotate-fixture.ts                   # fixture scaffolding — invokes runDiscoveryV3 and pre-tags every produced candidate 'pack'
  evaluation/
    fixtures/<framework>/<case>/          # <case>.<ext> source + <case>.expected.json + README.md; in-tree ground truth
    baselines/<framework>.json            # micro-averaged metric baselines; updated via --update-baseline (human-reviewed diff)
    llm-fixtures/<framework>/             # <case>.llm-response.json — recorded gateway responses, captured via --live --record
    reports/                              # per-run JSON reports, gitignored
    thresholds.json                       # optional per-framework/per-metric overrides (default 5%)
    REGRESSION-ACCEPTANCE.md              # forced-regression procedure + captured exit-1/exit-0 output

gateway/
  src/
    routes/
      discoveryFileAnalysis.ts            # V2 reference — POST /api/v1/discovery/analyze-files (untouched)
      discoveryGapFill.ts                 # V3 — POST /api/v1/discovery/v3/gap-fill (stateless relay)
    config/
      prompts/
        discovery.file-analysis.prompt.md # V2 prompt file — retained in-tree, NOT consumed by the V3 route

architecture-model-service/
  src/main/java/.../
    controller/DiscoveryRunController.java         # POST /runs, PUT /runs/{id} (accepts `mode`, `warnings`, `confirmedLlmSolo`)
    controller/DiscoveryCandidateController.java   # candidate CRUD
    service/DiscoveryRunService.java               # run state machine + candidate persistence + mode/warnings/confirmedLlmSolo propagation
    mapper/EntityMapper.java                       # DiscoveryRunEntity <-> DiscoveryRunDto (carries `mode`, `warnings`, `confirmedLlmSolo`; derives `tier` from `mode`)
    model/entity/DiscoveryRunEntity.java           # includes nullable `mode`, nullable `warnings` (JSON TEXT), `confirmedLlmSolo` (boolean NOT NULL DEFAULT FALSE)
    model/dto/DiscoveryRunDto.java                 # includes `mode`, derived `tier`, `warnings` (List<String>), `confirmedLlmSolo`
    model/entity/ServiceEntity.java                # core_tech, repo_location, repo_subfolder
  src/main/resources/db/changelog/
    db.changelog-master.yaml                       # wires in 083 / 084 / 085
    sql/083-discovery-run-mode.sql                 # ALTER TABLE discovery_run ADD COLUMN mode VARCHAR(1) NULL
    sql/084-discovery-run-confirmed-llm-solo.sql   # ALTER TABLE discovery_run ADD COLUMN confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE
    sql/085-discovery-run-warnings.sql             # ALTER TABLE discovery_run ADD COLUMN warnings TEXT (nullable; JSON-encoded string[])

frontend/
  src/
    components/
      DashboardView/
        TierBadge.tsx                              # A/B/C tier badge (success/caution/danger tokens); used on runs-list tier column + candidate row badges
        LlmSoloConfirmDialog.tsx                   # 409 LLM_SOLO_CONFIRMATION_REQUIRED confirm dialog; on confirm retries POST /discovery/runs with confirmLlmSolo: true
        DiscoveryRunDetailView.tsx                 # renders warnings banner for tier B/C (verbatim `warnings[]`), tier column inline in runs list
        DiscoveryCandidateTable.tsx                # confidence slider filter (default 0.7, step 0.05, NULL always visible) + tier column + confidence column
```

## 10. Operating notes

- Restart `discovery-service` after changes to packs, predicates, `register.ts`, or any file under `src/services/prompts/` — dev mode (`npm run dev` / `tsx watch`) auto-reloads; production (`npm run build && npm start`) requires a rebuild. Prompt-layer changes alter the `promptVersion` hashes written to `steps_payload.v3.gapFill.promptVersion`, which is the intended reproducibility signal.
- Stage 3 is a real gap-fill stage (composer-driven layered prompts, per-file tier routing, skip heuristic, bounded concurrency, failure handling, dedup, and four-hash `promptVersion` persistence). Runs will make per-file LLM calls subject to the skip heuristic; budget accordingly.
- A run can only proceed if the project's discovery config is `COMPLETE`. Service-scoped runs also need the service's `core_tech`, `repo_location` (must match a repo in the config for branch resolution), and optionally `repo_subfolder`.
- Candidates with `_addedBy: '<framework>-adapter'` are deterministic — useful for reproducibility checks and the identity-equality spot-check the local harness performs against OpenMRS. Candidates tagged `_addedBy: 'llm-gap-fill'`, `'llm-ir-guided'`, or `'llm-solo'` are LLM-authored and will vary run-to-run modulo temperature — use them for semantic-coverage monitoring rather than bit-exact reproducibility.
- Tier observability: `SELECT id, status, mode FROM discovery_run ORDER BY created_at DESC LIMIT 20;` answers "what tier did recent runs land in?". Combine with `steps_payload.v3.gapFill.stageStatus` to confirm Stage 3 completed vs. tripped the failure-rate threshold.
- Prompt-version observability: `steps_payload.v3.gapFill.promptVersion` stores `{ base, language, framework, composed }` 8-char hashes. Diff those across runs to attribute candidate-mix shifts to prompt changes vs. source-code changes.
- Pre-V3 runs have `mode = NULL` — that's expected and safe; the column is nullable precisely so historical rows don't need a backfill.

## 11. Evaluation harness

The V3 evaluation harness is a **local, ground-truth-driven regression safety net** for pack migrations (Spec 4) and LLM prompt iteration. Without it, every pack or prompt change requires subjective spot-checking — unsustainable across 18 packs. With it, a single command produces five objective metrics and a pass/fail verdict against a committed baseline. CI integration is **explicitly deferred** per spec Q11 — the harness is local-only for now.

It sits alongside the V3 pipeline, not inside it. The pipeline runs as normal; the harness wraps `runDiscoveryV3` with a fixture loader, a scoring module, and a baseline comparator.

### 11.1 Purpose + when to run

Run the harness whenever you:

- Modify a V3 `LanguagePack` or `FrameworkPack` (`src/services/extensionPacks/**`).
- Edit any layer under `src/services/prompts/` (composer, injection, or any `.md` layer — `promptVersion` hashes will shift).
- Migrate a V2 pack to V3 (Spec 4 gate).
- Tune `GAP_FILL_SKIP_THRESHOLD` / `GAP_FILL_SKIP_SIGNALS` / any other gap-fill knob.

Default mode is **fixture-replay**: the harness replays recorded LLM responses instead of hitting the network, so the feedback loop is fast (<60s for all frameworks), deterministic, and free.

### 11.2 Fixture storage convention

Every fixture lives at `discovery-service/evaluation/fixtures/<framework>/<case>/` and has three files:

- `<case>.<ext>` — the full source file, committed in-tree. The extension matches the upstream source (`.java`, `.py`, `.rb`, `.xml`, etc.) so filePath-driven detectors and LanguagePack file filters behave realistically.
- `<case>.expected.json` — ground-truth expectations. Shape:

  ```json
  {
    "expected": [
      { "type": "physical_entity",   "name": "Allergy",        "tag": "pack" },
      { "type": "physical_attribute", "name": "allergen",       "tag": "pack", "description": "JPA @ManyToOne to Allergen" },
      { "type": "business_logic",     "name": "AllergyService", "tag": "either", "notes": "Name-based — adapter catches; LLM would too" },
      { "type": "business_logic",     "name": "deduplicateReactions", "tag": "gap-fill", "notes": "No @Service; LLM must infer" }
    ],
    "shouldNotEmit": [
      { "type": "business_logic", "name": "toString" },
      { "type": "business_logic", "name": "hashCode" }
    ]
  }
  ```

  - Each `expected` entry requires `type`, `name`, `tag` (`'pack' | 'gap-fill' | 'either'`). Optional: `description`, `notes`.
  - `tag: 'pack'` — the deterministic pack MUST emit this.
  - `tag: 'gap-fill'` — the LLM MUST emit this (no adapter claim on it).
  - `tag: 'either'` — either producer is acceptable.
  - Each `shouldNotEmit` entry requires `{ type, name }` only and matches filePath-agnostic. Any candidate hitting a `shouldNotEmit` entry counts as a hallucination regardless of the main expected array.
  - `filePath` is **omitted** (redundant with the case's source filename) and `confidence` is omitted (producer output, not ground truth).

- `README.md` — records the upstream repo URL, commit SHA, license, and *why* this file was chosen (happy path, edge case, blind spot, negative example).

Matching imports `normalizeName` and the dedup-key logic directly from `discovery-service/src/services/prompts/dedup.ts` — the harness MUST NOT re-implement normalization, so candidate-to-expected matching stays in lockstep with production dedup.

### 11.3 Metrics, direction, and thresholds

Five metrics, each returned per-fixture as `{ numerator, denominator }` and aggregated per-framework via **micro-average** (sum numerators, sum denominators, then divide):

| Metric | Formula | Direction | Default threshold |
|---|---|---|---|
| Pack recall | `'pack'`-tagged expected emitted by pack / total `'pack'`-tagged expected | Fail on **decrease** >5% | 5% |
| Gap-fill precision | LLM candidates matching `'gap-fill'` or `'either'` expected / total LLM candidates | Fail on **decrease** >5% | 5% |
| Gap-fill recall | `'gap-fill'`-tagged expected emitted by LLM / total `'gap-fill'`-tagged expected | Fail on **decrease** >5% | 5% |
| Duplication rate | LLM candidates matching pack output on the dedup key / total LLM candidates | Fail on **increase** >5% | 5% |
| Hallucination rate | LLM candidates with no expected match OR matching `shouldNotEmit` / total LLM candidates | Fail on **increase** >5% | 5% |

Per-framework / per-metric overrides live at `discovery-service/evaluation/thresholds.json`. Any breach exits with code 1; otherwise exit 0.

### 11.4 CLI usage

Entry point: `discovery-service/scripts/run-evaluation.ts`.

| Flag | Purpose |
|---|---|
| `--framework <id>` | Run one framework's fixtures (e.g. `spring-classic`, `django`, `rails`). |
| `--all` | Run all registered frameworks. |
| `--baseline <path>` | Compare against a supplied baseline file. Defaults to `evaluation/baselines/<framework>.json`. |
| `--update-baseline` | Write the current run's metrics as the new baseline. Human reviews the diff before commit — no auto-commit. |
| `--live` | Call the real LLM via `gatewayClient.gapFill` instead of replaying recorded fixtures. Slower, non-deterministic, costs tokens. |
| `--record` | (Valid only with `--live`.) Capture LLM responses into `evaluation/llm-fixtures/<framework>/<case>.llm-response.json`. |
| `--report-dir <path>` | Override the default `evaluation/reports/` output location. |

Examples:

```bash
# Fast default: one framework, fixture-replay, compare against baseline
npx tsx scripts/run-evaluation.ts --framework spring-classic

# All three frameworks, same fixture-replay mode — expected <60s end-to-end
npx tsx scripts/run-evaluation.ts --all

# Prompt changed -> regenerate LLM fixtures AND re-record baseline in one PR
npx tsx scripts/run-evaluation.ts --framework spring-classic --live --record
npx tsx scripts/run-evaluation.ts --framework spring-classic --update-baseline

# Explicit baseline override (e.g. comparing against a tagged reference)
npx tsx scripts/run-evaluation.ts --framework spring-classic --baseline evaluation/baselines/spring-classic.reference.json
```

Output: a markdown summary table on stdout (per-framework + aggregate, with value / baseline / delta / pass-fail columns, plus per-fixture breakdown for debugging), and a full JSON report at `discovery-service/evaluation/reports/<framework>-<timestamp>.json` containing per-fixture raw counts, per-framework aggregates, baseline comparison, and threshold verdicts.

### 11.5 LLM replay vs. live vs. record

Three modes, all driven by flag combinations:

- **Replay (default)** — the harness swaps `gatewayClient.gapFill` with a fixture-backed stub at startup (same injection point the existing V3 test suites use — see `src/__tests__/v3PipelineAcceptance.test.ts`). It loads `evaluation/llm-fixtures/<framework>/<case>.llm-response.json` and returns it verbatim per gap-fill call. **Missing replay fixtures fail the run with an actionable "regenerate via `--live --record`" message**, never a silent skip.
- **Live (`--live`)** — passes through to the real `gatewayClient.gapFill`. Used for initial capture and for deliberate re-validation against the live LLM.
- **Record (`--live --record`)** — passes through to the real LLM AND captures each response to `evaluation/llm-fixtures/<framework>/<case>.llm-response.json`. Creates the framework directory if absent. `--record` without `--live` is rejected with a clear CLI error.

Baselines are always recorded against fixture-replay mode so they stay deterministic across re-runs. When a prompt change invalidates the recorded fixtures, the workflow is: `--live --record` to regenerate fixtures, eyeball the new LLM responses, then `--update-baseline` to roll the metric baseline, and commit fixtures + baseline + code change in one PR.

### 11.6 Baseline management

Baselines live at `discovery-service/evaluation/baselines/<framework>.json` in-tree. Each is a simple per-metric snapshot:

```json
{
  "framework": "spring-classic",
  "capturedAt": "2026-04-19T14:12:03.412Z",
  "metrics": {
    "packRecall":       { "value": 1.000, "numerator": 42, "denominator": 42 },
    "gapFillPrecision": { "value": null,  "numerator": 0,  "denominator": 0  },
    "gapFillRecall":    { "value": 0.000, "numerator": 0,  "denominator": 8  },
    "duplicationRate":  { "value": null,  "numerator": 0,  "denominator": 0  },
    "hallucinationRate":{ "value": null,  "numerator": 0,  "denominator": 0  }
  }
}
```

Null metrics are valid — they occur when a denominator is zero (e.g. no LLM candidates recorded yet, or no `'gap-fill'`-tagged expected items in the fixture set). Comparison treats null-to-null as "no delta".

Update flow:

1. Verify the metric shift is intentional (pack change, prompt change, new fixture coverage).
2. `npx tsx scripts/run-evaluation.ts --framework <id> --update-baseline` — writes the new file.
3. `git diff evaluation/baselines/<id>.json` — review delta by eye.
4. Commit the baseline change alongside the code / prompt / fixture change that caused it.

No auto-commit. Every baseline shift lands as a reviewable diff.

### 11.7 Annotation tool

`discovery-service/scripts/annotate-fixture.ts` scaffolds a fixture from a source file:

```bash
npx tsx scripts/annotate-fixture.ts <sourceFilePath> <frameworkId>
# e.g.
npx tsx scripts/annotate-fixture.ts C:/tmp/openmrs-harness/api/src/main/java/org/openmrs/Allergy.java spring-classic
```

It invokes `runDiscoveryV3` on the single file, creates `evaluation/fixtures/<framework>/<case>/`, copies the source in, and writes:

- `<case>.expected.json` — every produced candidate pre-tagged `'pack'`, with `shouldNotEmit: []` empty.
- `README.md` — stub with placeholders for upstream repo URL, commit SHA, license, and "why chosen" rationale.

The tool **does not** auto-detect `'gap-fill'` / `'either'` tags — that's deliberate (spec Q14). The human operator then:

1. Retags items the LLM should own (`'gap-fill'`) or either producer could own (`'either'`).
2. Adds any expected items the pack didn't emit (usually the `'gap-fill'` entries).
3. Populates `shouldNotEmit` with known blind spots or things the pack/LLM has been observed to mis-emit.
4. Fills in the README metadata.

### 11.8 Current fixture coverage

As of 2026-04-19:

- **spring-classic** — 10 real fixtures from OpenMRS (`C:/tmp/openmrs-harness`), covering happy paths (`allergy-reaction`, `visit`, `encounter-provider`), edge cases (`concept-attribute` `@AssociationOverride`, `allergen-type` enum), two HBM-XML blind spots (`global-property`, `patient-program-attribute`), and negative examples (`api-exception` + `person-attribute` `shouldNotEmit` entries on `toString`/`hashCode`).
- **django** — 5 placeholder fixtures from Saleor (`C:/tmp/pack-validation/repos/saleor`): `menu-models`, `channel-models`, `page-models`, `giftcard-models`, `account-signals`. `expected[]` is empty with descriptive READMEs; the django V3 pack is not yet migrated (Spec 4 work). Placeholders seed the directory; hand-authored expectations land when the pack migrates.
- **rails** — 5 placeholder fixtures from Discourse (`C:/tmp/pack-validation/repos/discourse`): `onceoff-log-model`, `plugin-store-row-model`, `about-controller`, `user-badges-model`, `admin-confirmation-email-job`. Same placeholder shape as django pending Spec 4 migration.

No LLM fixtures are recorded yet (`evaluation/llm-fixtures/` is empty). They are captured on-demand via `--live --record` by whoever is ready to invest live-LLM tokens. Baselines for all three frameworks exist:

- `spring-classic.json` — `packRecall = 1.0`, `gapFillRecall = 0.0`, all other metrics null (no LLM candidates recorded).
- `django.json` / `rails.json` — all-null (no V3 pack yet).

Performance measured at Group 6 close-out: `--all` replay-mode run ~2.6s, per-framework spring-classic replay-mode run ~2.5s — both well under the <60s / <10s targets.

### 11.9 Forced-regression acceptance

The harness was validated end-to-end by deliberately sabotaging the spring-classic adapter and confirming the run exits with code 1. The procedure, the captured pre-sabotage / sabotaged / restored outputs, and the re-run instructions are documented in `discovery-service/evaluation/REGRESSION-ACCEPTANCE.md`. The accepted-sabotage switches `processJpaEntity`'s `hasAnnotation(cls.annotations, 'Entity')` guard to a non-matching sentinel; 5 of the 10 spring-classic fixtures exercise `@Entity`, so pack recall drops from `1.000` to `0.188` and the run fails with the correct per-metric verdict. Restoring the one-line guard yields `packRecall = 1.000` and exit 0 again. Refer to that doc whenever you need to re-verify the harness still catches regressions after a structural change.

### 11.10 CI integration (deferred)

CI integration is **out of scope** for this spec per the explicit user decision (spec Q11). There is no GitHub Actions workflow, no `.github/` addition, and no pre-commit hook wired to `run-evaluation.ts`. Operators run the harness manually before landing pack or prompt changes, and baseline diffs are reviewed as ordinary commits. A future spec may wire this into CI; until then, treat the harness as a local-only gate.
