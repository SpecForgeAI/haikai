# Spec Requirements: Phase 1a Universal Evidence Extraction

## Initial Description
Increment 6 of 16 for the legacy/current-state discovery capability. Implements the first real Phase 1 behavior: universal evidence extraction that reads code repositories from Phase 0 config, extracts language-agnostic evidence (file structure, symbols via ctags, string/pattern data), produces evidence atoms, and stores them associated with discovery runs.

## Requirements Discussion

### First Round Questions

**Q1:** I assume repositories are accessed by cloning them to a temporary directory using `git clone` (with the URL, branch, and includePaths/excludePaths from Phase 0 config). The discovery-service would shell out to `git` on the host, clone to a temp folder (e.g., `os.tmpdir()/discovery-{runId}/{repoName}/`), perform extraction, and clean up after the step completes. Is that correct, or should repos be assumed to be already cloned at a known local path (e.g., the project folder from `fetchProjectFolder`), or should there be an alternative approach like a shallow clone (`--depth 1`)?
**Answer:** Use the simplest approach that supports real execution now, but shape it so other repo-access modes can be added later; do not over-design this increment.

**Q2:** For evidence atoms, I'm thinking of a schema like: `{ id: string (deterministic hash of filePath + type + key), runId: string, repoUrl: string, filePath: string, type: 'file_structure' | 'symbol' | 'string_pattern', data: { ... type-specific payload ... }, extractedAt: string (ISO timestamp) }`. For file_structure atoms, the data might include `{ relativePath, extension, sizeBytes, lineCount }`. For symbol atoms: `{ name, kind (function/class/method/variable), line, scope }`. For string_pattern atoms: `{ pattern, matchedText, line, context }`. Is this roughly the right shape, or do you have a different evidence atom schema in mind?
**Answer:** Yes -- that general shape is right, as long as atoms are explicitly traceable to run/repo/file/source and remain aligned with the agreed 1a evidence model.

**Q3:** For storing evidence atoms, I see a few options: (A) a new `discovery_evidence` table in architecture-model-service with individual rows per atom (following the JPA pattern), (B) bulk JSONB storage within the run's `steps_payload` (everything in one large JSONB blob on the existing `discovery_run` row), or (C) local JSON files written by the discovery-service. Which approach do you prefer?
**Answer:** Use a proper persisted service-side storage shape, not local files and not an oversized blob inside run state.

**Q4:** For ctags integration, I assume the discovery-service shells out to the `universal-ctags` binary (expecting it to be installed on the host / in the Docker container). The approach would be: run `ctags --output-format=json -R <repo-path>` and parse the JSON output to produce symbol evidence atoms. If ctags is not available (binary not found), the step should log a warning and skip the ctags sub-extraction gracefully (partial success), rather than failing the entire step. Is that the right approach, or should ctags unavailability be a hard failure?
**Answer:** Yes -- broad ctags integration is the right baseline; if ctags is unavailable, treat it as partial success/warning rather than hard failure.

**Q5:** For string/pattern extraction, I'm thinking regex-based scanning for patterns like: import/require statements (dependency signals), configuration file references (Spring annotations, Docker/K8s manifests, package.json dependencies), URL patterns (API endpoints, service URLs), connection strings, and common framework markers (e.g., `@SpringBootApplication`, `@Controller`, `express()`, `createApp`). Should the set of patterns be hardcoded for this increment (a reasonable default set), or should it be configurable via Phase 0 config's `techHints`? And should the patterns be applied to all files or only to files matching certain extensions?
**Answer:** Use a small built-in default pattern set in this increment; keep it broad and simple rather than techHint-driven.

**Q6:** For file size and count limits, I assume we need sensible defaults to avoid processing enormous repos: skip binary files, skip files over a certain size threshold (e.g., 1 MB), and perhaps cap the total number of files processed per repo (e.g., 50,000). For ctags, the `--exclude` flag can skip `node_modules`, `.git`, `vendor`, `build`, etc. Should these limits be hardcoded reasonable defaults, or configurable, or derived from the Phase 0 config's `excludePaths`?
**Answer:** Yes -- apply sensible defaults for exclusions/limits now, while allowing Phase 0 exclusions to further narrow scope where provided.

**Q7:** The run manager currently calls a simple `executeStep(step, projectId)` stub. I assume this increment replaces that stub with a call through the analyzer registry / analyzer pack interface. The 1a analyzer pack's `analyze()` method would receive the Phase 0 config snapshot (repos, includes, excludes, techHints) via the `AnalyzerInput.context` field, and return evidence atoms in the `AnalyzerResult.findings` array (or a new field). What should the exact function signature look like -- should it use the existing `AnalyzerPack.analyze(input: AnalyzerInput): Promise<AnalyzerResult>` interface, or does 1a need a different contract since it produces evidence atoms rather than "findings"?
**Answer:** Keep it aligned with the existing analyzer-pack model, but have the output integrate cleanly into evidence atoms.

**Q8:** Roughly how many evidence atoms do you expect per repo? For a medium-sized repo (say 500 source files, 100K lines), I'd estimate: ~500 file_structure atoms, ~2,000-5,000 symbol atoms (from ctags), and ~200-1,000 string_pattern atoms -- so roughly 3,000-7,000 atoms per repo. Does that order of magnitude seem right, or should the design anticipate significantly more (e.g., 100K+ atoms for monorepos)?
**Answer:** Design with larger repositories in mind rather than assuming only medium repos; do not optimize heavily yet, but do not box the design into small-scale assumptions.

**Q9:** Is there anything you explicitly want to exclude from this increment? For example: language-specific analyzers (Phase 1b), cross-reference analysis, evidence scoring/ranking, frontend display of evidence, or evidence deduplication across repos?
**Answer:** Yes -- exclude language-specific analyzers, cross-reference-heavy logic, advanced scoring, frontend display work, and cross-repo dedup in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Run manager step execution stub - Path: `discovery-service/src/services/runManager.ts` (the `executeStep()` function that this increment replaces with real 1a extraction logic)
- Feature: Analyzer pack interface and stub - Path: `discovery-service/src/types/analyzerPack.ts` (defines `AnalyzerPack`, `AnalyzerInput`, `AnalyzerResult`, `AnalyzerFinding`), `discovery-service/src/services/stubAnalyzerPack.ts` (stub implementation), `discovery-service/src/services/analyzerRegistry.ts` (registry pattern)
- Feature: Architecture model client - Path: `discovery-service/src/services/archModelClient.ts` (HTTP client with `createDiscoveryRun`, `updateDiscoveryRun`, `getDiscoveryRun`, `getDiscoveryConfig` methods -- template for adding evidence persistence methods)
- Feature: Discovery run routes - Path: `discovery-service/src/routes/runs.ts` (fire-and-forget run creation pattern with async `startRun` call)
- Feature: Phase 1 stub routes - Path: `discovery-service/src/routes/phase1.ts` (step validation pattern for 1a-1d)
- Feature: Discovery config response DTO - Path: `discovery-service/src/services/archModelClient.ts` (`DiscoveryConfigResponseDto` with `config_payload` field containing Phase 0 config -- this is the input data the 1a extractor consumes)
- Feature: DiscoveryRunEntity persistence stack in architecture-model-service - Path: follow the `DiscoveryRunEntity` / `DiscoveryRunService` / `DiscoveryRunController` / `DiscoveryRunRepository` pattern from Increment 5 for the new evidence table
- Feature: DiscoveryConfigEntity JSONB pattern - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryConfigEntity.java` (JSONB payload with project-scoped FK -- template for evidence entity)
- Feature: Liquibase migration pattern - Path: `architecture-model-service/src/main/resources/db/changelog/sql/065-discovery-run.sql` (latest migration -- next evidence table migration follows this numbering)

### Follow-up Questions

No follow-up questions needed. User responses were clear and comprehensive across all nine questions.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Repo Access and Cloning**
- The discovery-service clones repositories to a temporary directory for extraction, using the repo URL and branch from the Phase 0 config snapshot (stored in the discovery run's `config_snapshot`)
- Use `git clone` shelling out to the host's `git` binary; clone to a temp folder scoped to the run (e.g., `os.tmpdir()/discovery-{runId}/{repoSlug}/`)
- Apply `--depth 1` or shallow clone for efficiency as a sensible default
- Clean up the temp directory after extraction completes (success or failure)
- Shape the repo-access layer as an abstraction (e.g., a `RepoAccessProvider` interface or function) so that alternative modes (pre-cloned local path, bare clone, etc.) can be added in future increments without restructuring
- Respect `includePaths` and `excludePaths` from the Phase 0 config to narrow the file tree before extraction

**Evidence Atom Schema**
- Each evidence atom has a consistent core shape:
  - `id`: deterministic identifier (hash of runId + repoUrl + filePath + type + distinguishing key) ensuring idempotency
  - `runId`: UUID FK to the discovery run that produced this atom
  - `repoUrl`: the source repository URL
  - `filePath`: relative path within the repo
  - `type`: one of `file_structure`, `symbol`, `string_pattern`
  - `data`: type-specific payload (JSONB)
  - `extractedAt`: ISO timestamp of extraction
- File structure atom data: `{ relativePath, extension, sizeBytes, lineCount }`
- Symbol atom data: `{ name, kind (function/class/method/variable/interface/type/etc.), line, scope, language (as reported by ctags) }`
- String pattern atom data: `{ patternName, matchedText, line, contextSnippet }`

**Evidence Atom Persistence (architecture-model-service)**
- New `discovery_evidence` table in the architecture-model-service PostgreSQL database
- Individual rows per evidence atom (not a single large JSONB blob)
- Columns: UUID PK (`id`), `run_id` (UUID FK to `discovery_run.id`, ON DELETE CASCADE), `repo_url` (TEXT), `file_path` (TEXT), `type` (TEXT -- `file_structure`, `symbol`, `string_pattern`), `data` (JSONB -- type-specific payload), `extracted_at` (TIMESTAMP)
- Standard JPA stack: Entity, DTO, Repository, Service, Controller, Mapper, Liquibase migration
- Bulk insert support -- the REST API should accept batch creation of evidence atoms (e.g., POST accepting an array) to avoid N+1 HTTP calls for thousands of atoms
- Query endpoints: get evidence atoms by run ID (with optional type filter), count atoms by run ID
- The discovery-service calls the architecture-model-service REST API to persist atoms (following the existing `archModelClient` pattern)

**Three Sub-Extractors within Step 1a**
The 1a step performs three language-agnostic extraction passes on each cloned repo:

1. **File Structure Extraction**: Walk the file tree (respecting include/exclude paths and default exclusions), produce one atom per file capturing path, extension, size, and line count. Skip binary files and files above the size threshold.

2. **Symbol Extraction (ctags)**: Shell out to `universal-ctags` with `--output-format=json` and `--recurse` on the repo directory. Parse the JSON output and produce one atom per symbol (function, class, method, variable, interface, type, etc.). If ctags binary is not found on the host, log a warning and skip this sub-extraction gracefully -- the step still succeeds with partial results (file_structure and string_pattern atoms only). The `--exclude` flags should cover standard non-source directories (node_modules, .git, vendor, build, dist, etc.).

3. **String/Pattern Extraction**: Scan source files using a small built-in default set of regex patterns. The default pattern set should cover broad, language-agnostic signals:
   - Import/require statements (dependency signals)
   - Common framework markers (`@SpringBootApplication`, `@Controller`, `@Service`, `express()`, `createApp`, `Flask`, `Django`, etc.)
   - Configuration file indicators (Dockerfile, docker-compose, Kubernetes manifests, package.json, pom.xml, build.gradle, Makefile, etc.)
   - URL/endpoint patterns (HTTP verbs, route definitions)
   - Database connection patterns (connection strings, ORM config)
   - The pattern set is hardcoded in this increment (not driven by techHints); keep it simple and broad

**File Size and Count Limits**
- Sensible hardcoded defaults applied to all repos:
  - Skip binary files (detect via file extension or null-byte check)
  - Skip files over 1 MB (configurable constant, not hardcoded magic number)
  - Skip common non-source directories by default: `node_modules`, `.git`, `vendor`, `build`, `dist`, `target`, `.gradle`, `.mvn`, `__pycache__`, `.venv`, `venv`
  - No hard cap on total file count in this increment, but the design should not assume small repos
- Phase 0 config's `excludePaths` are applied as additional exclusions on top of the defaults
- Phase 0 config's `includePaths`, if provided, restrict extraction to only those subtrees

**Run Manager Integration**
- Replace the existing `executeStep()` stub in `runManager.ts` with real logic for step `1a`
- When the run manager reaches step 1a, it invokes the 1a extraction logic through the analyzer pack interface
- The 1a analyzer pack is registered in the analyzer registry at startup (alongside or replacing the stub-noop pack for the 1a step)
- The analyzer pack's `analyze()` method receives the Phase 0 config snapshot via `AnalyzerInput.context` (containing repos, includePaths, excludePaths, techHints, repoApplicationMappings, etc.)
- The analyzer pack returns an `AnalyzerResult` whose structure integrates cleanly with evidence atoms -- the `findings` field carries evidence atoms (or a clearly mapped output that the run manager can transform into evidence atoms for persistence)
- After execution, the run manager persists evidence atoms to the architecture-model-service via `archModelClient` (new bulk-save method), then updates the run's step status to "completed" with summary metadata (atom counts by type)
- Steps 1b, 1c, 1d remain stubs in this increment

**Error Handling**
- If git clone fails for a repo, log the error, mark that repo as failed in the step results, but continue processing other repos (if multiple repos in config)
- If ctags is unavailable, log a warning, skip symbol extraction, continue with file_structure and string_pattern extraction -- partial success
- If a file cannot be read (permissions, encoding), skip it with a warning, do not fail the step
- If bulk persistence of evidence atoms fails, the step fails (this is a hard failure since the purpose of the step is to produce persisted evidence)
- The run manager's existing fail-fast pattern applies: if step 1a itself fails fatally, the run status goes to FAILED and subsequent steps are skipped

### Reusability Opportunities
- `runManager.ts` `executeStep()` -- the stub being replaced; the run manager's step-sequencing loop and status-update pattern remain unchanged
- `AnalyzerPack` interface (`analyzerPack.ts`) -- the 1a analyzer pack implements this existing interface
- `analyzerRegistry.ts` -- the 1a analyzer pack registers here at startup
- `archModelClient.ts` -- extend with new methods for bulk evidence atom persistence and retrieval
- `DiscoveryRunEntity` / `DiscoveryConfigEntity` JPA stacks in architecture-model-service -- template for the new `DiscoveryEvidenceEntity` persistence stack
- Liquibase migration pattern from `065-discovery-run.sql` -- next migration for the evidence table follows this numbering
- `stubAnalyzerPack.ts` -- structural template for the real 1a analyzer pack implementation

### Scope Boundaries

**In Scope:**
- New `discovery_evidence` table with Liquibase migration in architecture-model-service
- Full JPA stack for evidence atoms: Entity, DTO, Repository, Service, Controller, Mapper
- Bulk-insert REST endpoint for evidence atoms (POST accepting an array)
- Query endpoint for evidence atoms by run ID (with optional type filter)
- Count endpoint for evidence atoms by run ID
- Repo cloning to temp directory via `git clone` shell-out
- File structure extraction (file tree walk producing file_structure atoms)
- Symbol extraction via universal-ctags shell-out (producing symbol atoms)
- String/pattern extraction via built-in regex set (producing string_pattern atoms)
- Graceful partial success when ctags is unavailable
- Sensible default exclusions and file size limits
- Phase 0 config includePaths/excludePaths integration
- New 1a analyzer pack implementing the AnalyzerPack interface
- Registration of 1a analyzer pack in the analyzer registry
- Replacement of `executeStep()` stub with real 1a logic in run manager
- New `archModelClient` methods for evidence atom bulk persistence
- Temp directory cleanup after extraction
- Unit tests for all new code (extraction logic, analyzer pack, archModelClient methods, JPA stack)

**Out of Scope:**
- Language-specific analyzers (Phase 1b increment)
- Cross-reference analysis or dependency graph construction
- Evidence scoring, ranking, or weighting
- Frontend UI for viewing or browsing evidence atoms
- Cross-repo evidence deduplication
- TechHint-driven pattern configuration (patterns are hardcoded defaults in this increment)
- Advanced ctags configuration or custom tag kinds
- Streaming/WebSocket progress updates during extraction
- Authentication/authorization on evidence endpoints
- Evidence atom versioning or history tracking
- Performance optimization (indexing, pagination, caching) beyond basic bulk insert
- Steps 1b, 1c, 1d implementation (remain stubs)

### Technical Considerations
- The Liquibase migration should be the next sequential changeset after `065-discovery-run.sql` (i.e., `066-discovery-evidence.sql`) in `db.changelog-master.yaml`
- The `discovery_evidence` table should have an index on `run_id` for efficient retrieval by run, and a composite index on `(run_id, type)` for filtered queries
- The `run_id` FK should cascade on delete so that deleting a run automatically removes its evidence atoms
- The JSONB `data` column should be typed as `Map<String, Object>` in the JPA entity with `@Type(JsonType.class)` from hypersistence-utils, consistent with existing JSONB patterns
- The bulk insert endpoint should accept arrays of reasonable size; for very large repos (tens of thousands of atoms), the discovery-service should batch the HTTP calls (e.g., 500-1000 atoms per request) rather than sending all atoms in a single request
- The repo-access layer should be structured as a simple abstraction (function or small interface) so that future increments can swap in alternative access modes (pre-cloned paths, sparse checkout, etc.) without changing extraction logic
- The ctags shell-out should use `child_process.execFile` (not `exec`) to avoid shell injection, with appropriate timeout (e.g., 60 seconds per repo)
- The string/pattern regex set should be defined as a named constant array of `{ patternName: string, regex: RegExp, fileExtensions?: string[] }` so it is easy to extend or replace in future increments
- The discovery-service's `Dockerfile.dev` should include `universal-ctags` installation (e.g., `apt-get install -y universal-ctags`) so ctags is available in the containerized environment
- Docker Compose already has the discovery-service depending on architecture-model-service (from Increment 5); no additional Docker Compose changes needed beyond the Dockerfile ctags installation
- Evidence atom IDs should be deterministic (hash-based) so that re-running extraction for the same run does not create duplicates -- though in practice, a new run creates a new runId, so atom IDs will naturally differ between runs
- The `AnalyzerResult` returned by the 1a analyzer pack should use the existing `findings: AnalyzerFinding[]` field to carry evidence atom data, with a clear mapping convention (e.g., `AnalyzerFinding.category` = atom type, `AnalyzerFinding.detail` = JSON-serialized atom data) or alternatively extend the `AnalyzerResult` type with an optional `evidenceAtoms` field that the run manager checks for step 1a
