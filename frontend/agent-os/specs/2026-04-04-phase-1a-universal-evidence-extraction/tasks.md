# Task Breakdown: Phase 1a Universal Evidence Extraction

## Overview
Total Tasks: 32 (across 5 task groups)

This increment adds real Phase 1a extraction logic to the discovery pipeline. Two services are modified: the **architecture-model-service** (Java/Spring Boot) gains a new `discovery_evidence` table and full JPA stack, while the **discovery-service** (Express/TypeScript) gains repo cloning, three sub-extractors, a Phase 1a analyzer pack, run manager integration, and archModelClient extensions. No gateway, frontend, or MCP changes.

## Task List

### Database Layer (architecture-model-service)

#### Task Group 1: Discovery Evidence Table and Liquibase Migration
**Dependencies:** None

- [x] 1.0 Complete the Liquibase migration for the discovery_evidence table
  - [x] 1.1 Write 3 focused tests for the migration and entity persistence
    - Test 1: DiscoveryEvidenceEntity can be persisted and retrieved with all fields (id, runId, repoUrl, filePath, type, data JSONB, extractedAt)
    - Test 2: JSONB `data` column round-trips a Map<String, Object> correctly (verify type-specific payload survives persist/load)
    - Test 3: Cascade delete removes evidence atoms when the parent discovery_run is deleted
  - [x] 1.2 Create `066-discovery-evidence.sql` migration file
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/066-discovery-evidence.sql`
    - Columns: `id` (UUID PK), `run_id` (UUID FK to `discovery_run.id`, ON DELETE CASCADE, NOT NULL), `repo_url` (TEXT NOT NULL), `file_path` (TEXT NOT NULL), `type` (TEXT NOT NULL), `data` (JSONB NOT NULL), `extracted_at` (TIMESTAMPTZ NOT NULL)
    - Index on `run_id`; composite index on `(run_id, type)`
    - Follow exact pattern from `065-discovery-run.sql` (comments, IF NOT EXISTS guards)
  - [x] 1.3 Register the migration in `db.changelog-master.yaml`
    - Add new changeset entry `066-discovery-evidence` after the `065-discovery-run` entry
    - Use `preConditions` with `tableExists` check on `discovery_evidence` (negative guard)
    - Follow the exact YAML pattern of existing entries
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify migration applies cleanly on a fresh database

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Migration creates the `discovery_evidence` table with correct columns, types, and constraints
- FK cascade delete from `discovery_run` to `discovery_evidence` works
- Indexes on `run_id` and `(run_id, type)` are created
- JSONB column stores and retrieves `Map<String, Object>` correctly

---

### JPA Stack (architecture-model-service)

#### Task Group 2: Evidence Entity, DTO, Repository, Service, and Controller
**Dependencies:** Task Group 1

- [x] 2.0 Complete the full JPA stack for discovery evidence
  - [x] 2.1 Write 6 focused tests for the JPA stack and REST endpoints
    - Test 1: POST bulk insert endpoint accepts an array of evidence atom DTOs and persists them
    - Test 2: GET by run ID returns all evidence atoms for that run
    - Test 3: GET by run ID with `?type=symbol` filter returns only symbol-type atoms
    - Test 4: GET count endpoint returns the correct atom count for a run
    - Test 5: POST with empty array returns 200 with empty result (no error)
    - Test 6: GET for a non-existent run ID returns empty list (not 404)
  - [x] 2.2 Create `DiscoveryEvidenceEntity.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/`
    - Fields: `id` (UUID), `runId` (UUID), `repoUrl` (String), `filePath` (String), `type` (String), `data` (Map<String, Object> with `@Type(JsonType.class)`), `extractedAt` (Instant)
    - Annotations: `@Entity`, `@Table`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Follow `DiscoveryRunEntity.java` pattern exactly (including `@PrePersist` for timestamp defaults)
  - [x] 2.3 Create `DiscoveryEvidenceDto.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/`
    - Java record with `@JsonProperty` snake_case mappings for all fields
    - Follow `DiscoveryRunDto.java` pattern exactly
  - [x] 2.4 Create `DiscoveryEvidenceRepository.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/`
    - Extends `JpaRepository<DiscoveryEvidenceEntity, UUID>`
    - Methods: `findByRunId(UUID runId)`, `findByRunIdAndType(UUID runId, String type)`, `countByRunId(UUID runId)`
    - Follow `DiscoveryRunRepository.java` pattern
  - [x] 2.5 Create `DiscoveryEvidenceService.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/`
    - Methods: `bulkCreate(UUID runId, List<DiscoveryEvidenceDto> atoms)`, `getByRunId(UUID runId, String type)` (type is optional filter), `countByRunId(UUID runId)`
    - `bulkCreate` maps DTOs to entities using `saveAll()` for batch insert
    - `@Transactional` on write methods, `@Transactional(readOnly = true)` on reads
    - `@ConditionalOnProperty` matching existing discovery services
    - Follow `DiscoveryRunService.java` pattern
  - [x] 2.6 Create `DiscoveryEvidenceController.java`
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/`
    - Base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/evidence`
    - POST `/` -- bulk insert (accepts `List<DiscoveryEvidenceDto>` body)
    - GET `/` -- list evidence by run ID with optional `?type=` query param
    - GET `/count` -- return atom count by run ID
    - Error handling: 400 for invalid input, standard Spring exception mapping
    - `@ConditionalOnProperty` and `@RequestMapping` matching `DiscoveryRunController.java` pattern
  - [x] 2.7 Ensure JPA stack tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all CRUD operations and query filters work correctly

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Bulk POST persists an array of evidence atoms in a single request
- GET with optional `?type=` filter returns correct subsets
- GET count returns accurate totals
- All annotations and patterns match existing `DiscoveryRun*` stack conventions

---

### Discovery Service - Extraction Logic (discovery-service)

#### Task Group 3: Evidence Types, Repo Access, and Three Sub-Extractors
**Dependencies:** None (can be developed in parallel with Task Groups 1 and 2)

- [x] 3.0 Complete the extraction logic layer
  - [x] 3.1 Write 8 focused tests for extraction logic
    - Test 1: `generateEvidenceId()` produces deterministic IDs (same inputs produce same hash)
    - Test 2: File structure extractor produces one atom per file with correct `{ relativePath, extension, sizeBytes, lineCount }` shape
    - Test 3: File structure extractor skips binary files (detected via extension list or null-byte check)
    - Test 4: File structure extractor skips files exceeding `MAX_FILE_SIZE_BYTES` (1 MB)
    - Test 5: File structure extractor skips default excluded directories (`node_modules`, `.git`, `vendor`, `build`, `dist`, `target`, etc.)
    - Test 6: String pattern extractor matches import/require statements and produces correct atom shape
    - Test 7: String pattern extractor matches framework markers (`@SpringBootApplication`, `express()`, etc.)
    - Test 8: `shouldIncludeFile()` correctly applies `includePaths` and `excludePaths` from Phase 0 config
  - [x] 3.2 Create evidence atom types and constants
    - New file: `discovery-service/src/types/evidenceAtom.ts`
    - Define `EvidenceAtom` interface: `{ id, runId, repoUrl, filePath, type, data, extractedAt }`
    - Define `EvidenceAtomType` union: `'file_structure' | 'symbol' | 'string_pattern'`
    - Define type-specific data interfaces: `FileStructureData`, `SymbolData`, `StringPatternData`
    - Export from `types/index.ts` barrel
  - [x] 3.3 Create evidence ID generation utility
    - New file: `discovery-service/src/utils/evidenceId.ts`
    - `generateEvidenceId(runId, repoUrl, filePath, type, distinguishingKey): string` -- deterministic hash (SHA-256 or similar) of concatenated inputs
    - Uses Node.js built-in `crypto.createHash('sha256')` for idempotent ID generation
  - [x] 3.4 Create extraction constants
    - New file: `discovery-service/src/constants/extractionDefaults.ts`
    - `MAX_FILE_SIZE_BYTES = 1_048_576` (1 MB)
    - `DEFAULT_EXCLUDED_DIRS`: `['node_modules', '.git', 'vendor', 'build', 'dist', 'target', '.gradle', '.mvn', '__pycache__', '.venv', 'venv']`
    - `BINARY_FILE_EXTENSIONS`: common binary extensions (`.png`, `.jpg`, `.gif`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.pdf`, `.zip`, `.tar`, `.gz`, `.jar`, `.exe`, `.dll`, `.so`, `.dylib`, `.class`, `.o`, `.pyc`)
    - `DEFAULT_STRING_PATTERNS`: array of `{ patternName: string, regex: RegExp, fileExtensions?: string[] }` covering imports, framework markers, config indicators, URL/endpoint patterns, database connection patterns
  - [x] 3.5 Create the RepoAccessProvider abstraction and git clone implementation
    - New file: `discovery-service/src/services/repoAccess.ts`
    - `RepoAccessProvider` interface: `{ cloneRepo(repoUrl, branch, targetDir): Promise<string>; cleanup(targetDir): Promise<void> }`
    - `GitCloneRepoAccess` implementation: uses `child_process.execFile('git', ['clone', '--depth', '1', '-b', branch, repoUrl, targetDir])` to avoid shell injection
    - Temp directory: `os.tmpdir()/discovery-{runId}/{repoSlug}/`
    - Cleanup in `finally` block
  - [x] 3.6 Create the file structure sub-extractor
    - New file: `discovery-service/src/services/extractors/fileStructureExtractor.ts`
    - Walk cloned repo tree using `fs.readdir` with `{ withFileTypes: true, recursive: true }` or a manual recursive walk
    - Produce one `file_structure` atom per file with `{ relativePath, extension, sizeBytes, lineCount }`
    - Skip binary files (extension check + null-byte check in first 8KB)
    - Skip files exceeding `MAX_FILE_SIZE_BYTES`
    - Apply default directory exclusions plus Phase 0 `excludePaths`
    - Apply Phase 0 `includePaths` if provided
    - Count lines via streaming or buffer read
  - [x] 3.7 Create the symbol sub-extractor (ctags)
    - New file: `discovery-service/src/services/extractors/symbolExtractor.ts`
    - Shell out to `universal-ctags --output-format=json --recurse <repoDir>` using `child_process.execFile` with 60-second timeout
    - Apply `--exclude` flags for default non-source directories (same list as file structure exclusions)
    - Parse JSON output line-by-line, produce one `symbol` atom per entry with `{ name, kind, line, scope, language }`
    - If ctags binary is not found (ENOENT), log warning and return empty array (graceful partial success)
    - Wrap in try/catch so ctags failure does not block other extractors
  - [x] 3.8 Create the string/pattern sub-extractor
    - New file: `discovery-service/src/services/extractors/stringPatternExtractor.ts`
    - Iterate over source files (same file set as file structure extractor, sharing the include/exclude logic)
    - For each file, read contents and match against `DEFAULT_STRING_PATTERNS`
    - Produce one `string_pattern` atom per match with `{ patternName, matchedText, line, contextSnippet }`
    - Skip files that cannot be read (permissions, encoding) with a warning
    - `contextSnippet` is the matched line trimmed, or a few characters around the match
  - [x] 3.9 Ensure extraction logic tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify all three sub-extractors produce correctly shaped atoms
    - Verify include/exclude path filtering works

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Evidence atom types are well-defined and exported
- Deterministic ID generation is verified
- File structure extractor correctly walks, filters, and produces atoms
- Symbol extractor gracefully handles missing ctags binary
- String pattern extractor matches the default pattern set
- Include/exclude path filtering works for all extractors

---

### Discovery Service - Integration Layer (discovery-service)

#### Task Group 4: Analyzer Pack, ArchModelClient Extension, Run Manager Integration, Dockerfile
**Dependencies:** Task Groups 2 and 3

- [x] 4.0 Complete the integration layer connecting extraction to persistence
  - [x] 4.1 Write 6 focused tests for the integration layer
    - Test 1: `phase1aAnalyzerPack.analyze()` returns an `AnalyzerResult` with evidence atoms in the result (via `findings` or `evidenceAtoms` field)
    - Test 2: `phase1aAnalyzerPack` is registered in the analyzer registry after `initializeAnalyzerRegistry()` (verify registry contains it)
    - Test 3: `archModelClient.bulkSaveEvidence()` sends a POST request to the correct endpoint with evidence atoms as the request body
    - Test 4: `archModelClient.getEvidenceByRun()` calls GET with optional `?type=` query param
    - Test 5: `archModelClient.getEvidenceCount()` calls GET on the `/count` endpoint and returns the numeric count
    - Test 6: Run manager `executeStep('1a', ...)` calls the 1a analyzer pack and persists atoms via `archModelClient.bulkSaveEvidence()`, then updates step status to "completed" with summary metadata
  - [x] 4.2 Create the Phase 1a analyzer pack
    - New file: `discovery-service/src/services/phase1aAnalyzerPack.ts`
    - Implements `AnalyzerPack` interface with `id: 'phase-1a-universal-extraction'`
    - `supportedPhases: ['phase1']`
    - `analyze(input: AnalyzerInput)` method:
      - Reads Phase 0 config from `input.context` (repos, includePaths, excludePaths)
      - For each repo in config: clone via `RepoAccessProvider`, run all three sub-extractors, collect atoms, cleanup
      - Returns `AnalyzerResult` with atoms mapped to `findings` field (or optional `evidenceAtoms` extension on the result)
      - Metadata includes atom counts by type: `{ file_structure: N, symbol: N, string_pattern: N }`
    - Error handling: if clone fails for a repo, log error, mark repo as failed in metadata, continue with other repos
    - Follow structural pattern from `stubAnalyzerPack.ts`
  - [x] 4.3 Extend `AnalyzerResult` type (if needed) for evidence atoms
    - Evaluate whether to use existing `findings: AnalyzerFinding[]` field with a mapping convention (e.g., `category` = atom type, `detail` = JSON-serialized atom data), or add an optional `evidenceAtoms?: EvidenceAtom[]` field to `AnalyzerResult`
    - If extending `AnalyzerResult`, update `discovery-service/src/types/analyzerPack.ts` and barrel export
    - Ensure backward compatibility -- existing stub analyzer and tests still work
  - [x] 4.4 Register the 1a analyzer pack in the analyzer registry
    - Update `discovery-service/src/services/analyzerRegistry.ts`
    - Import `phase1aAnalyzerPack` and call `analyzerRegistry.set(phase1aAnalyzerPack.id, phase1aAnalyzerPack)` inside `initializeAnalyzerRegistry()`
    - Existing stub pack remains registered (it is used for other phases)
  - [x] 4.5 Extend `archModelClient.ts` with evidence persistence methods
    - Add `bulkSaveEvidence(projectId: string, runId: string, atoms: EvidenceAtom[]): Promise<void>` -- POST to `/api/model/projects/{projectId}/discovery/runs/{runId}/evidence`
    - Add `getEvidenceByRun(projectId: string, runId: string, type?: string): Promise<EvidenceAtom[]>` -- GET with optional `?type=` query param
    - Add `getEvidenceCount(projectId: string, runId: string): Promise<number>` -- GET to `.../evidence/count`
    - Follow existing method patterns (URL encoding, error handling, axios instance)
  - [x] 4.6 Update the run manager to execute real 1a logic
    - Modify `discovery-service/src/services/runManager.ts`
    - Replace the `executeStep()` stub with real logic for step `1a`:
      - Fetch the discovery run to get `config_snapshot` via `archModelClient.getDiscoveryRun(projectId, runId)`
      - Build `AnalyzerInput` with `phase: 'phase1'`, `step: '1a'`, `context` containing the config snapshot
      - Look up the 1a analyzer pack from the registry and call `analyze(input)`
      - Persist returned evidence atoms via `archModelClient.bulkSaveEvidence()`, batching in chunks of 500-1000 atoms per HTTP call
      - Update `stepsPayload` with `{ status: 'completed', atomCounts: { file_structure: N, symbol: N, string_pattern: N } }`
    - Steps `1b`, `1c`, `1d` remain stubs (continue calling the existing stub logic)
    - If bulk persistence fails, throw error so the run manager's existing fail-fast catch block sets the run to FAILED
  - [x] 4.7 Update `discovery-service/Dockerfile.dev` to install universal-ctags
    - Add `RUN apk add --no-cache universal-ctags` after the `FROM node:20-alpine` line (before or after npm ci)
    - Base image is `node:20-alpine`, so use `apk` package manager
  - [x] 4.8 Ensure integration layer tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify the analyzer pack produces correct output
    - Verify archModelClient methods call correct endpoints
    - Verify run manager orchestrates 1a correctly

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- Phase 1a analyzer pack is registered and callable through the analyzer registry
- `archModelClient` has working `bulkSaveEvidence`, `getEvidenceByRun`, and `getEvidenceCount` methods
- Run manager invokes real 1a logic and falls back to stubs for 1b-1d
- Evidence atoms are persisted via bulk HTTP calls in chunks of 500-1000
- Step status is updated with atom count summary metadata
- Dockerfile.dev includes ctags installation

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3 tests from Task Group 1 (migration and entity persistence)
    - Review the 6 tests from Task Group 2 (JPA stack and REST endpoints)
    - Review the 8 tests from Task Group 3 (extraction logic)
    - Review the 6 tests from Task Group 4 (integration layer)
    - Total existing tests: 23 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to Phase 1a evidence extraction
    - Prioritize: error handling paths, batching logic, multi-repo orchestration, partial success scenarios
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Candidate gap areas (select up to 10 based on analysis):
      - Error path: git clone failure for one repo does not block other repos (partial success)
      - Error path: ctags unavailable results in partial results (file_structure + string_pattern only, no symbol atoms)
      - Error path: bulk persistence failure causes step to fail (FAILED status)
      - Batching: large atom set (>1000 atoms) is sent in multiple HTTP calls of 500-1000 each
      - Multi-repo: analyzer pack processes multiple repos from config and aggregates all atoms
      - Include/exclude: Phase 0 config `includePaths` restricts extraction to specific subtrees
      - Cleanup: temp directory is cleaned up even on extraction failure
      - Idempotent IDs: re-generating atoms for the same inputs produces the same atom IDs
      - Run manager end-to-end: step 1a completion updates stepsPayload with atom count summary
      - archModelClient: `getEvidenceByRun` with type filter passes `?type=` query param correctly
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 23-33 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-33 tests total)
- Critical error handling paths are covered (clone failure, ctags unavailable, persistence failure)
- Multi-repo and batching workflows are verified
- No more than 10 additional tests added
- Testing focused exclusively on Phase 1a evidence extraction feature

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Database Migration (architecture-model-service)
     |
     v
Task Group 2: JPA Stack (architecture-model-service)        Task Group 3: Extraction Logic (discovery-service)
     |                                                              |
     +-------------------------------+------------------------------+
                                     |
                                     v
                    Task Group 4: Integration Layer (discovery-service)
                                     |
                                     v
                    Task Group 5: Test Review & Gap Analysis
```

**Parallel track:** Task Group 3 (extraction logic in discovery-service) has no dependency on the architecture-model-service work and can be developed in parallel with Task Groups 1 and 2.

**Sequential dependency:** Task Group 4 depends on both the JPA stack (Task Group 2, for the REST endpoints that `archModelClient` calls) and the extraction logic (Task Group 3, for the sub-extractors that the analyzer pack orchestrates).

**Final:** Task Group 5 runs last to review all tests and fill any remaining gaps.

## Key File Locations

### New files to create:
- `architecture-model-service/src/main/resources/db/changelog/sql/066-discovery-evidence.sql`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryEvidenceEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryEvidenceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/DiscoveryEvidenceRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryEvidenceService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryEvidenceController.java`
- `discovery-service/src/types/evidenceAtom.ts`
- `discovery-service/src/utils/evidenceId.ts`
- `discovery-service/src/constants/extractionDefaults.ts`
- `discovery-service/src/services/repoAccess.ts`
- `discovery-service/src/services/extractors/fileStructureExtractor.ts`
- `discovery-service/src/services/extractors/symbolExtractor.ts`
- `discovery-service/src/services/extractors/stringPatternExtractor.ts`
- `discovery-service/src/services/phase1aAnalyzerPack.ts`

### Existing files to modify:
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` (add changeset entry)
- `discovery-service/src/types/analyzerPack.ts` (extend `AnalyzerResult` if adding `evidenceAtoms` field)
- `discovery-service/src/types/index.ts` (export new types)
- `discovery-service/src/services/analyzerRegistry.ts` (register 1a analyzer pack)
- `discovery-service/src/services/archModelClient.ts` (add evidence persistence methods)
- `discovery-service/src/services/runManager.ts` (replace stub with real 1a logic)
- `discovery-service/Dockerfile.dev` (add ctags installation)
