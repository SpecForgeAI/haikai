# Specification: Phase 1a Universal Evidence Extraction

## Goal
Replace the step 1a stub in the discovery-service run manager with real extraction logic that clones repositories from Phase 0 config, performs three language-agnostic extraction passes (file structure, ctags symbols, string/pattern matching), produces evidence atoms, and persists them to a new `discovery_evidence` table in the architecture-model-service.

## User Stories
- As a discovery run operator, I want the 1a step to automatically extract language-agnostic evidence from configured repositories so that downstream phases have raw evidence atoms to analyze.
- As a system architect, I want evidence atoms to be individually persisted and queryable by run and type so that I can inspect and build upon the extraction results.

## Specific Requirements

**Repository Cloning and Access**
- Clone repos to `os.tmpdir()/discovery-{runId}/{repoSlug}/` using `git clone --depth 1` via `child_process.execFile` (not `exec`, to avoid shell injection)
- Read repo URL and branch from the Phase 0 config snapshot stored on the discovery run's `config_snapshot` field (fetched via `archModelClient.getDiscoveryRun`)
- Apply `includePaths` and `excludePaths` from config to narrow the file tree before extraction begins
- Clean up the temp directory after extraction completes (in a `finally` block covering both success and failure)
- Structure repo access as a small abstraction (e.g., `RepoAccessProvider` function/interface) so alternative modes (pre-cloned local path, sparse checkout) can be added later without changing extraction logic

**Evidence Atom Schema**
- Core shape: `{ id, runId, repoUrl, filePath, type, data, extractedAt }` where `type` is one of `file_structure`, `symbol`, `string_pattern`
- `id` is a deterministic hash of `runId + repoUrl + filePath + type + distinguishing key` for idempotency
- `data` is a type-specific JSONB payload: file_structure has `{ relativePath, extension, sizeBytes, lineCount }`; symbol has `{ name, kind, line, scope, language }`; string_pattern has `{ patternName, matchedText, line, contextSnippet }`

**Discovery Evidence Table (Liquibase Migration)**
- New file `066-discovery-evidence.sql` added as the next sequential changeset in `db.changelog-master.yaml`
- Columns: `id` (UUID PK), `run_id` (UUID FK to `discovery_run.id`, ON DELETE CASCADE, NOT NULL), `repo_url` (TEXT NOT NULL), `file_path` (TEXT NOT NULL), `type` (TEXT NOT NULL), `data` (JSONB NOT NULL), `extracted_at` (TIMESTAMPTZ NOT NULL)
- Index on `run_id`; composite index on `(run_id, type)` for filtered queries

**Evidence JPA Stack (architecture-model-service)**
- Full stack: `DiscoveryEvidenceEntity`, `DiscoveryEvidenceDto`, `DiscoveryEvidenceRepository`, `DiscoveryEvidenceService`, `DiscoveryEvidenceController`, following the exact patterns from the `DiscoveryRun*` stack
- The JSONB `data` column uses `@Type(JsonType.class)` with `Map<String, Object>` consistent with `DiscoveryConfigEntity` and `DiscoveryRunEntity`
- Bulk insert endpoint: POST accepting an array of evidence atom DTOs at `/api/model/projects/{projectId}/discovery/runs/{runId}/evidence` (batch creation)
- Query endpoint: GET evidence atoms by run ID with optional `?type=` filter at the same base path
- Count endpoint: GET atom count by run ID at `/api/model/projects/{projectId}/discovery/runs/{runId}/evidence/count`

**File Structure Extraction (Sub-Extractor 1)**
- Walk the cloned repo file tree, producing one `file_structure` atom per file with `{ relativePath, extension, sizeBytes, lineCount }`
- Skip binary files (detect via file extension list or null-byte check in first 8KB)
- Skip files exceeding `MAX_FILE_SIZE_BYTES` (default 1 MB, defined as a named constant)
- Default directory exclusions: `node_modules`, `.git`, `vendor`, `build`, `dist`, `target`, `.gradle`, `.mvn`, `__pycache__`, `.venv`, `venv` -- applied in addition to Phase 0 `excludePaths`

**Symbol Extraction via ctags (Sub-Extractor 2)**
- Shell out to `universal-ctags --output-format=json --recurse` on the cloned repo directory using `child_process.execFile` with a 60-second timeout
- Apply `--exclude` flags for default non-source directories (same list as file structure exclusions)
- Parse JSON output line-by-line, producing one `symbol` atom per entry with `{ name, kind, line, scope, language }`
- If ctags binary is not found, log a warning and skip symbol extraction entirely -- the step succeeds with partial results (file_structure and string_pattern atoms only)

**String/Pattern Extraction (Sub-Extractor 3)**
- Scan source files using a built-in default regex pattern set defined as a named constant array of `{ patternName: string, regex: RegExp, fileExtensions?: string[] }`
- Default patterns cover: import/require statements, framework markers (`@SpringBootApplication`, `@Controller`, `@Service`, `express()`, `createApp`, `Flask`, `Django`), configuration file indicators, URL/endpoint patterns (HTTP verbs, route definitions), database connection patterns
- Produce one `string_pattern` atom per match with `{ patternName, matchedText, line, contextSnippet }`

**Run Manager Integration**
- Replace the `executeStep()` stub in `runManager.ts` with real logic for step `1a` that invokes the 1a analyzer pack; steps `1b`, `1c`, `1d` remain stubs
- Create a new `phase1aAnalyzerPack` implementing the `AnalyzerPack` interface, registered in the analyzer registry at startup via `registerAnalyzerPack()`
- The pack's `analyze()` receives Phase 0 config via `AnalyzerInput.context`; returns `AnalyzerResult` with evidence atoms mapped through the `findings` field or an optional `evidenceAtoms` field on `AnalyzerResult`
- After execution, the run manager persists atoms via a new `archModelClient.bulkSaveEvidence(runId, projectId, atoms)` method, batching in chunks of 500-1000 per HTTP call
- Updates the step's `stepsPayload` entry to `"completed"` with summary metadata (atom counts by type)

**Error Handling**
- If `git clone` fails for a repo, log the error, mark that repo as failed in step results, continue processing other repos
- If ctags is unavailable, log warning, skip symbol extraction, continue -- partial success
- If a file cannot be read (permissions, encoding), skip it with a warning, do not fail the step
- If bulk persistence fails, the step fails (hard failure -- the purpose is persisted evidence)
- The run manager's existing fail-fast pattern applies: fatal step 1a failure sets run status to FAILED

**Dockerfile ctags Installation**
- Update `discovery-service/Dockerfile.dev` to install `universal-ctags` (e.g., `apk add --no-cache universal-ctags` since the base image is `node:20-alpine`)

## Existing Code to Leverage

**Run Manager step sequencing (`discovery-service/src/services/runManager.ts`)**
- Contains the `executeStep()` stub function (line 27-29) that this increment replaces with real 1a logic
- The `startRun()` loop, status-update pattern, and fail-fast error handling remain unchanged -- only the internal `executeStep` call for `1a` changes
- The `stepsPayload` tracking and `archModelClient.updateDiscoveryRun` calls provide the integration seam

**Analyzer Pack interface and registry (`discovery-service/src/types/analyzerPack.ts`, `discovery-service/src/services/analyzerRegistry.ts`, `discovery-service/src/services/stubAnalyzerPack.ts`)**
- `AnalyzerPack` interface defines `id`, `name`, `description`, `supportedPhases`, and `analyze(input: AnalyzerInput): Promise<AnalyzerResult>` -- the new 1a pack implements this directly
- `stubAnalyzerPack.ts` serves as the structural template for the real implementation
- `analyzerRegistry.ts` exposes `registerAnalyzerPack(pack)` and `getAnalyzerRegistry()` -- the 1a pack registers at startup in `initializeAnalyzerRegistry()`

**Architecture Model Client (`discovery-service/src/services/archModelClient.ts`)**
- `ArchModelClient` class with singleton pattern, axios instance, and URL-encoding conventions for path params
- Existing methods (`createDiscoveryRun`, `updateDiscoveryRun`, `getDiscoveryRun`, `getDiscoveryConfig`) provide the exact template for new `bulkSaveEvidence`, `getEvidenceByRun`, and `getEvidenceCount` methods
- `DiscoveryConfigResponseDto` contains `config_payload` which is the Phase 0 config data consumed by the extractor

**DiscoveryRun JPA stack (architecture-model-service)**
- `DiscoveryRunEntity` (JSONB with `@Type(JsonType.class)`, `@Builder`, `@PrePersist`/`@PreUpdate` lifecycle hooks), `DiscoveryRunDto` (record with `@JsonProperty` snake_case mapping), `DiscoveryRunRepository` (Spring Data JPA extending `JpaRepository<Entity, UUID>`), `DiscoveryRunService` (create/get/update with `@Transactional`), `DiscoveryRunController` (`@RestController` with `@ConditionalOnProperty` and `@RequestMapping`)
- This entire stack is the direct template for the new `DiscoveryEvidence*` stack -- same annotations, patterns, and conventions

**Liquibase migration pattern (`065-discovery-run.sql` and `db.changelog-master.yaml`)**
- `065-discovery-run.sql` shows the table creation pattern with UUID PK, FK with ON DELETE CASCADE, JSONB columns, TIMESTAMPTZ, indexes, and COMMENT statements
- `db.changelog-master.yaml` shows the changeset registration pattern with `preConditions` (tableExists check), `sqlFile` reference, and comment description -- the new `066-discovery-evidence` entry follows this exactly

## Out of Scope
- Language-specific analyzers (Phase 1b -- separate increment)
- Cross-reference analysis or dependency graph construction
- Evidence scoring, ranking, or weighting
- Frontend UI for viewing or browsing evidence atoms
- Cross-repo evidence deduplication
- TechHint-driven pattern configuration (patterns are hardcoded defaults only)
- Advanced ctags configuration or custom tag kinds
- Streaming/WebSocket progress updates during extraction
- Authentication/authorization on evidence endpoints
- Evidence atom versioning or history tracking
- Performance optimization (indexing beyond run_id, pagination, caching) beyond basic bulk insert
- Steps 1b, 1c, 1d implementation (remain stubs)
