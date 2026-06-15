# Task Breakdown: Library Discovery Integration

## Overview
Total Tasks: 9 task groups covering 3 net-new architecture-model-service REST endpoints, a `DependencyResolverRegistry` + Maven/npm resolvers in discovery-service, a repo-wide lookup-table builder, a BFS transitive walker (cap 5 / cycle-detected / scope-filtered), 2 preflight endpoints, library-scan run orchestration, hierarchical `steps_payload` progress, a `library_id` column added via a NEW Liquibase changeset to discovery-service's `discovery_candidate` table, gateway proxy routes, a frontend `PreflightModal`, `GridRowContextMenu` extension to Service + Library rows, hierarchical run-progress sub-rows, 4 new `gatewayClient` helpers, and a final TS / Java / npm verification sweep.

This is **Spec 3 of 3** in the Library arc and the largest cross-service surface in the arc — Java + Node.js + React + a minor gateway-only addition. Spec 1 (`agent-os/specs/2026-05-05-library-backend-foundation/`) landed the entities, DTOs, repos, and the `application_points.target_type` CHECK relax (changesets 122-124). Spec 2 (`agent-os/specs/2026-05-06-library-frontend-types-and-tables/`) landed the frontend types, grid configs, picker / derivation extension, `tech_hints_cell` typing relaxation, and `applicationPointDerivation` 4th arm. This spec adds the 3 new architecture-model-service REST endpoints, the discovery-service resolver / walker / preflight / library-scan pipeline, and the frontend modal + hierarchical progress + right-click menu items.

This spec touches these files:

- **architecture-model-service (Java) — modified or created (~10 files):**
  - `LibraryController.java` (created or extension to `ModelController.java`)
  - `CodeUnitDependencyController.java` (created or extension to `ModelController.java`)
  - `LibraryService.java` (modified — `findOrCreate`, `findById`)
  - `CodeUnitDependencyService.java` (modified — `findOrCreate`)
  - `LibraryRepository.java` (modified — 1 new finder)
  - `CodeUnitDependencyRepository.java` (modified — 1 new finder)
  - 2-3 new integration test classes
- **discovery-service (TypeScript) — created or modified (~16 files):**
  - `services/dependencyResolverRegistry.ts` (created)
  - `services/dependencyResolvers/types.ts` (created)
  - `services/dependencyResolvers/register.ts` (created)
  - `services/dependencyResolvers/maven/MavenDependencyResolver.ts` (created)
  - `services/dependencyResolvers/npm/NpmDependencyResolver.ts` (created)
  - `services/repoLookupTableBuilder.ts` (created)
  - `services/transitiveDependencyWalker.ts` (created)
  - `services/archModelClient.ts` (modified — 3 new functions)
  - `routes/preflightLibraryScan.ts` (created)
  - `routes/runs.ts` (modified — extend POST handler with library-scan support)
  - `routes/index.ts` (modified — register new routes)
  - `services/runManager.ts` (modified — `startLibraryScopedRun`, hierarchical `steps_payload`)
  - `db/migrations/<new>-discovery-candidate-library-id.sql` (created — Liquibase changeset)
  - per-resolver unit tests + walker unit tests + endpoint integration tests
- **gateway (TypeScript) — modified (~1 file):**
  - `gateway/src/routes/discovery.ts` (modified — 4 new proxy routes; 1 new test)
- **frontend (TypeScript) — modified or created (~7 files):**
  - `frontend/src/components/Grid/PreflightModal.tsx` (created)
  - `frontend/src/components/Grid/PreflightModal.module.css` (created)
  - `frontend/src/components/Grid/GridRowContextMenu.tsx` (modified)
  - `frontend/src/components/Grid/Grid.tsx` (modified — handler-prop wiring)
  - `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (modified — hierarchical sub-rows)
  - `frontend/src/services/gatewayClient.ts` (modified — 4 new helpers)
  - 1-2 new Vitest tests

**Locked contract reminders embedded throughout:** snake_case JSON; library identity at find-or-create endpoint (no DB UNIQUE); edge identity composite with null-tolerance for `declared_version`; BFS depth cap 5; cycle detection via visited-set keyed by `Library.id`; scope filter (Maven `compile`/`runtime` walked, npm `dependencies` walked, all others edge-only); external libs recorded one-deep ONLY when toggle ON; per-modal-session toggle (no DB); source provenance on created Library rows (`source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at=now()`, `generation_status='completed'`); `last_verified_at` updated on every find-or-create call; reuse Spec 2's `applicationPointDerivation` for derived APs; new Liquibase changeset adds `library_id` column to `discovery_candidate` table; never edit applied changesets.

## Pre-Existing Failing Tests — Implementer Convention

Per project memory, the following Jest/Vitest suites have pre-existing failures unrelated to this spec:
- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: availableFrom)
- `chatV2-panel-integration.test.ts` (3 fails: availableFrom)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: availableFrom)
- ~117 pre-existing broken backend Java test files in architecture-model-service (Spec 1 / earlier carry-forward — use the **broken-tests staging workaround**: temporarily move broken-class files out of the test source tree to run targeted tests, then move them back; never modify or "fix" them).

This spec must **NOT** modify or attempt to fix any of these. Verification in Group 9 is: targeted tests for new features pass, `mvn -pl architecture-model-service compile` is clean, `npx tsc --noEmit` (frontend) is clean, `npm run build` (discovery-service + gateway) is clean, and the existing failing-test inventory has not grown.

---

## Task List

### architecture-model-service Layer

#### Task Group 1: 3 net-new REST endpoints (`POST /libraries`, `POST /code-unit-dependencies`, `GET /libraries/:id`) + repository finders + service-layer find-or-create
**Dependencies:** None (Spec 1 schema is in place; Spec 2 frontend wiring is independent)

- [x] 1.0 Add the 3 new REST endpoints, the 2 new repository finder methods, the 3 new service-layer methods, and 1-2 controller integration tests. All additive — Spec 1's whole-model PUT and entity tables are untouched.
  - [x] 1.1 Write 2-4 focused integration tests for the new endpoints
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/LibraryControllerIntegrationTest.java`
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/CodeUnitDependencyControllerIntegrationTest.java`
    - Use the existing Spring Boot integration-test slice / `MockMvc` pattern from existing controller tests in the same package.
    - Limit to 2-4 highly focused tests:
      1. `POST /libraries` find branch: pre-seed a `LibraryEntity` with `(model_file_id, name, ecosystem)`; POST a body with the same triple; assert response `created=false`, returned `id` matches existing row, no duplicate row in DB.
      2. `POST /libraries` create branch + derived AP creation: POST with a new `(name, ecosystem)`; assert response `created=true`, new `Library` row inserted, AND a corresponding `ApplicationPoint` row inserted in the SAME transaction with `target_type='LIBRARY'`, `target_ref_id=<new library id>`, `kind='LIBRARY'`. `derived_application_point_id` is non-null in response.
      3. `POST /code-unit-dependencies` null-tolerant version match: pre-seed a row with `declared_version=NULL`; POST a body with the same `(source_AP_id, target_AP_id, declared_name)` and `declared_version=null`; assert response `created=false`, returned `id` matches existing row.
      4. `GET /libraries/:id` 404 path: GET with a non-existent UUID; assert HTTP 404.
    - Use the broken-tests staging workaround if other ModelService* tests in the same package compile-break the run.
  - [x] 1.2 Add `findByModelFileIdAndNameAndEcosystem` to `LibraryRepository`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java`
    - Add: `Optional<LibraryEntity> findByModelFileIdAndNameAndEcosystem(String modelFileId, String name, String ecosystem);`
    - Spring Data JPA derives the query — no `@Query` annotation needed.
    - **Reference:** existing `findByModelFileId` in same file.
  - [x] 1.3 Add composite finder to `CodeUnitDependencyRepository`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java`
    - Add: `Optional<CodeUnitDependencyEntity> findBySourceApplicationPointIdAndTargetApplicationPointIdAndDeclaredNameAndDeclaredVersion(String sourceApplicationPointId, String targetApplicationPointId, String declaredName, String declaredVersion);`
    - **Null tolerance for `declared_version`:** Spring Data's derived-query null-handling is documented to translate a null parameter into `IS NULL` predicate — confirm at runtime via test 1.1.3. If the derived translation is `=` rather than `IS NULL`, fall back to a manual `@Query` with `(:declaredVersion IS NULL AND e.declaredVersion IS NULL) OR e.declaredVersion = :declaredVersion`.
    - **Reference:** existing `findByModelFileId` in same file.
  - [x] 1.4 Add `findOrCreate` and `findById` to `LibraryService`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/LibraryService.java` (modify existing class; add the methods if file does not yet exist, create it following the package convention).
    - `findOrCreate(projectId, architectureId, dto) -> LibraryFindOrCreateResult`:
      - Resolve `modelFileId` from `(projectId, architectureId)` via existing model-file resolution logic (mirror `ArchitectureCloneService` Service-side pattern).
      - Call `libraryRepository.findByModelFileIdAndNameAndEcosystem(modelFileId, dto.name, dto.ecosystem)`.
      - If found: update `last_verified_at = now()` (per locked contract — discovery-touch tracking); return `{id, derivedApplicationPointId: existingDerivedApId, created: false, library: dto-mapped}`.
      - If not found: insert new `LibraryEntity`; in the SAME transaction, insert a derived `ApplicationPointEntity` with `target_type='LIBRARY'`, `target_ref_id=<new library id>`, `kind='LIBRARY'` (mirror `ArchitectureCloneService` Service-side derived-AP creation). Return `{id: newLibId, derivedApplicationPointId: newApId, created: true, library: dto-mapped}`.
    - `findById(projectId, architectureId, libraryId) -> Optional<LibraryDto>`: scoped lookup; return empty Optional on miss (controller maps to 404).
    - **Reference for transactional pattern:** `ArchitectureCloneService` (Service-side derived-AP creation in same transaction).
    - **Critical:** `@Transactional` on `findOrCreate` so the Library + AP insert are atomic.
  - [x] 1.5 Add `findOrCreate` to `CodeUnitDependencyService`
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/CodeUnitDependencyService.java` (modify or create).
    - `findOrCreate(projectId, architectureId, dto) -> CodeUnitDependencyFindOrCreateResult`:
      - Resolve `modelFileId` from `(projectId, architectureId)`.
      - Call `codeUnitDependencyRepository.findBySourceApplicationPointIdAndTargetApplicationPointIdAndDeclaredNameAndDeclaredVersion(...)` with the 4 composite keys (note: `declaredVersion` may be null).
      - If found: return `{id, created: false, codeUnitDependency: dto-mapped}`.
      - If not found: insert new `CodeUnitDependencyEntity`; return `{id: newId, created: true, codeUnitDependency: dto-mapped}`.
    - `@Transactional`.
  - [x] 1.6 Create `LibraryController` with the 2 new endpoints
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/LibraryController.java` (or extend `ModelController.java` — implementer's call; new file is cleaner given Spec 1 deliberately scoped this out).
    - `POST /api/model/projects/{projectId}/architectures/{architectureId}/libraries` — body `LibraryFindOrCreateRequest` (snake_case JSON via `@JsonProperty`); response `LibraryFindOrCreateResponse` (`{id, derived_application_point_id, created, library}`).
    - `GET /api/model/projects/{projectId}/architectures/{architectureId}/libraries/{libraryId}` — response `LibraryDto` or 404.
    - **snake_case JSON contract:** all DTO fields use `@JsonProperty("snake_case")` — match the existing Spec 1 `LibraryDto` field-naming convention exactly.
    - **Reference:** any existing `Controller.java` in the same package; `ModelController.java:131` for path-variable extraction pattern.
  - [x] 1.7 Create `CodeUnitDependencyController` with the 1 new endpoint
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/CodeUnitDependencyController.java` (or extend `ModelController.java`).
    - `POST /api/model/projects/{projectId}/architectures/{architectureId}/code-unit-dependencies` — body `CodeUnitDependencyFindOrCreateRequest`; response `CodeUnitDependencyFindOrCreateResponse` (`{id, created, code_unit_dependency}`).
    - snake_case JSON throughout.
  - [x] 1.8 Reuse existing bidirectional `EntityMapper` paths
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
    - Spec 1 already added `toEntity(LibraryDto, modelFileId)`, `toDto(LibraryEntity)`, `toEntity(CodeUnitDependencyDto, modelFileId)`, `toDto(CodeUnitDependencyEntity)` — reuse without modification.
    - Verify these mappings exist; if any are missing, add them following the existing pattern (NO new mapping should be needed if Spec 1 was complete — confirm during implementation).
  - [x] 1.9 Verify Java compiles + run targeted tests
    - From repo root: `mvn -pl architecture-model-service compile`.
    - Run only the 2-4 tests written in 1.1: `mvn -pl architecture-model-service test -Dtest=LibraryControllerIntegrationTest,CodeUnitDependencyControllerIntegrationTest`.
    - **Use the broken-tests staging workaround** if the ~117 pre-existing broken Java test files compile-break the test phase: temporarily `git mv` the broken files to a `staging/` folder OUTSIDE `src/test/`, run the targeted tests, then `git mv` them back. Do NOT modify the broken-test contents.
    - Expected: zero new failures; the 2-4 new tests pass.
    - Do NOT run the entire architecture-model-service test suite at this stage.

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass.
- `LibraryRepository.findByModelFileIdAndNameAndEcosystem` and `CodeUnitDependencyRepository.findBy...DeclaredNameAndDeclaredVersion` (with null-tolerance) are exposed.
- `LibraryService.findOrCreate` inserts the Library + derived `ApplicationPoint` (`target_type='LIBRARY'`) in the SAME transaction; updates `last_verified_at` on every call.
- `CodeUnitDependencyService.findOrCreate` is null-tolerant on `declared_version`.
- 3 new endpoints: `POST /libraries`, `POST /code-unit-dependencies`, `GET /libraries/:id` are reachable; snake_case JSON contract honoured throughout.
- No edits to applied Liquibase changesets (≤124).
- Net new test failures = 0 (broken-tests staging workaround used).

---

### discovery-service Resolver Layer

#### Task Group 2: `DependencyResolverRegistry` + Maven/npm resolvers + shared types
**Dependencies:** None (resolvers are standalone; do not call any external service)

- [x] 2.0 Build the deterministic dependency resolver layer mirroring the `extensionPackRegistry.ts` pattern: a registry, 2 resolvers (Maven + npm), shared types, and per-resolver fixture-based unit tests.
  - [x] 2.1 Write 4-8 focused fixture-based unit tests for the resolvers
    - **File:** `discovery-service/src/__tests__/dependencyResolvers/MavenDependencyResolver.test.ts`
    - **File:** `discovery-service/src/__tests__/dependencyResolvers/NpmDependencyResolver.test.ts`
    - Fixture root: `discovery-service/src/__tests__/fixtures/dependencyResolvers/` (tracked in git, no real binaries — small text manifests only).
    - Limit to 4-8 highly focused tests:
      1. **Maven single-module:** fixture with a single `pom.xml`; assert `findManifests` returns 1 path; assert `resolve` emits N `DeclaredDependency` entries with correct `name = "groupId:artifactId"`, `version` verbatim, `scope` populated (default `compile` when omitted).
      2. **Maven multi-module aggregator:** fixture with `pom.xml` + 2 child-module `pom.xml`s; assert `findManifests` returns 3 paths; assert `extractCoordinates` returns one `(ecosystem, name, subfolder)` triple per pom.
      3. **Maven property placeholder:** fixture with `<version>${jackson.version}</version>`; assert `version` field stores the literal string `${jackson.version}` verbatim — NO property resolution.
      4. **Maven version range:** fixture with `<version>[1.0,2.0)</version>`; assert `versionRange` stores `[1.0,2.0)` verbatim AND `version` is null/undefined.
      5. **npm root-only:** fixture with one `package.json`; assert one entry per declared package across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`; assert `name` is full string including `@scope/` for scoped packages.
      6. **npm workspaces:** fixture with root `package.json` + 2 workspace `package.json`s; assert `findManifests` returns 3 paths.
      7. **Walker exclusions:** fixture with `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/` containing fake manifests; assert NONE are returned by `findManifests`.
      8. **Maven scope mapping:** fixture with `<scope>test</scope>`, `<scope>provided</scope>`, `<optional>true</optional>` blocks; assert `scope` is correctly populated for each.
  - [x] 2.2 Create shared types module
    - **File:** `discovery-service/src/services/dependencyResolvers/types.ts` (created)
    - Export `DeclaredDependency` interface (locked contract):
      ```ts
      export interface DeclaredDependency {
        name: string;              // Maven: "groupId:artifactId"; npm: "name" or "@scope/name"
        version?: string;          // verbatim; may include ${propname} for Maven
        versionRange?: string;     // verbatim Maven range "[1.0,2.0)"; null for npm V1
        scope: string;             // Maven: compile|runtime|test|provided|optional; npm: dependencies|devDependencies|peerDependencies|optionalDependencies
        manifestPath: string;      // relative to repo root
        manifestLine?: number;     // 1-based; resolver-best-effort
      }
      ```
    - Export `DependencyResolver` interface (locked contract):
      ```ts
      export interface DependencyResolver {
        getEcosystem(): 'MAVEN' | 'NPM' | string;
        findManifests(repoRoot: string): Promise<string[]>;
        resolve(repoRoot: string, manifestPath: string): Promise<DeclaredDependency[]>;
        extractCoordinates(repoRoot: string, manifestPath: string): Promise<{ ecosystem: string; name: string; subfolder: string } | null>;
      }
      ```
    - **Reference:** existing pack-type files under `services/extensionPacks/` for shape inspiration.
  - [x] 2.3 Create `DependencyResolverRegistry`
    - **File:** `discovery-service/src/services/dependencyResolverRegistry.ts` (created)
    - **Template:** `discovery-service/src/services/extensionPackRegistry.ts` (262 lines) — mirror structure 1:1.
    - Surface: `registerDependencyResolver(resolver: DependencyResolver): void`, `getDependencyResolver(ecosystem: string): DependencyResolver | undefined`, `getRegisteredEcosystems(): string[]`, `clearRegistry(): void`.
    - Module-load registration via sibling `register.ts`; no runtime mutation after startup.
    - **No exports of mutable internals** — registry state is module-private.
  - [x] 2.4 Create the sibling `register.ts` (module-load side-effect import)
    - **File:** `discovery-service/src/services/dependencyResolvers/register.ts` (created)
    - **Template:** `discovery-service/src/services/extensionPacks/register.ts`.
    - Imports both `MavenDependencyResolver` and `NpmDependencyResolver`, instantiates, calls `registerDependencyResolver(...)` for each.
    - Exported only to be side-effect-imported once at app startup (e.g. from `index.ts` or wherever `extensionPacks/register.ts` is imported today).
  - [x] 2.5 Create `MavenDependencyResolver`
    - **File:** `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` (created)
    - `getEcosystem(): 'MAVEN'`.
    - `findManifests(repoRoot)`: recursive walker that finds every `pom.xml`. Exclusions baked in: `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`.
    - `resolve(repoRoot, manifestPath)`: parse the pom XML (use a small XML library already in `package.json` if available, otherwise `xml2js` — confirm at implementation; lock the choice in the package). Extract every `<dependency>` block. For each:
      - `name = <groupId>:<artifactId>`.
      - `version` — if literal, store verbatim including `${propname}` placeholders (NO resolution).
      - `versionRange` — if `[a,b)` syntax, store verbatim AND leave `version` null/undefined.
      - `scope` — read from `<scope>`; default to `'compile'` when omitted; `<optional>true</optional>` maps to `scope='optional'`.
      - `manifestPath` — repo-root-relative.
      - `manifestLine` — best-effort 1-based; OK to omit if XML library does not surface it.
    - `extractCoordinates(repoRoot, manifestPath)`: returns `{ecosystem: 'MAVEN', name: <groupId:artifactId>, subfolder: <parent-dir-of-manifest>}` for the lookup-table builder. Returns `null` if pom has no groupId/artifactId.
  - [x] 2.6 Create `NpmDependencyResolver`
    - **File:** `discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts` (created)
    - `getEcosystem(): 'NPM'`.
    - `findManifests(repoRoot)`: recursive walker for every `package.json`, INCLUDING workspace package.jsons (npm workspaces work automatically — no aggregator-specific code). Exclusions baked in (`node_modules/` is critical — the walker must not descend into it).
    - `resolve(repoRoot, manifestPath)`: parse JSON; emit one `DeclaredDependency` per package across `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`. `name` = full string including `@scope/` (no stripping). `version` stored verbatim; ranges go into `versionRange` (V1 keeps `version` set verbatim — no separation of pinned vs range for npm). `scope` is the source-key (`'dependencies'`, `'devDependencies'`, etc.).
    - `extractCoordinates(repoRoot, manifestPath)`: returns `{ecosystem: 'NPM', name: <package.json.name>, subfolder: <parent-dir-of-manifest>}`.
  - [x] 2.7 Verify TS compiles + run targeted resolver tests
    - From `discovery-service/`: `npx tsc --noEmit`.
    - From `discovery-service/`: `npm test -- src/__tests__/dependencyResolvers/`.
    - Expected: zero new TS errors; all 4-8 resolver tests pass.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 4-8 tests written in 2.1 pass.
- `DependencyResolverRegistry` mirrors `extensionPackRegistry.ts` shape (module-load registration, no runtime mutation, `clearRegistry` for tests).
- `MavenDependencyResolver` walks all `pom.xml` files (multi-module aggregator works automatically), stores `${propname}` and `[1.0,2.0)` verbatim, defaults scope to `compile`.
- `NpmDependencyResolver` walks all `package.json` files (workspaces work automatically), stores full `@scope/name` strings, emits one `DeclaredDependency` per declared package across all 4 source-keys.
- Walker exclusions (`node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`) are correctly skipped.
- `npx tsc --noEmit` is clean.

---

### discovery-service Walker Layer

#### Task Group 3: Repo-wide lookup-table builder + BFS transitive walker
**Dependencies:** Task Group 2

- [x] 3.0 Build the lookup-table builder and the BFS walker that produces `ScanPlan`. Both are pure — no archModelClient or run-orchestration coupling at this layer (the walker calls into a pluggable client interface in Group 4).
  - [x] 3.1 Write 6-8 focused unit tests for the walker
    - **File:** `discovery-service/src/__tests__/services/transitiveDependencyWalker.test.ts`
    - **File:** `discovery-service/src/__tests__/services/repoLookupTableBuilder.test.ts`
    - Use mocked `archModelClient.findOrCreateLibrary` / `findOrCreateCodeUnitDependency` (Group 4 will land the real ones; here we only test walker mechanics).
    - Limit to 6-8 tests:
      1. **Lookup table — single-module Maven:** fixture builds a 1-entry Maven map; assert `lookupTable.maven.size === 1`.
      2. **Lookup table — multi-module aggregator + npm workspaces:** assert N entries per ecosystem.
      3. **Lookup table — exclusions:** `node_modules/`, `target/`, etc. are not in the table.
      4. **Walker — cycle detection:** root → A → B → A. Assert: edge A→B recorded as `'new'`; edge B→A recorded with `status='skipped-cycle'`; A is NOT enqueued the second time. Library + AP rows are find-or-created (materialized) for the cycle target.
      5. **Walker — depth cap 5:** chain of 7 internal libs at depths 0..6. Assert: depths 0..5 walked; the depth-5 library's outgoing internal edge is recorded with `status='skipped-depth-cap'`; depth-6 library NOT enqueued.
      6. **Walker — scope filter:** Maven `test`/`provided`/`optional` scopes recorded as edges only (NOT enqueued); npm `devDependencies`/`peerDependencies`/`optionalDependencies` edges recorded only.
      7. **Walker — internal vs external:** dep IS in lookup table → internal scannable (find-or-create + edge + enqueue); dep NOT in lookup table + `includeExternal=true` → external (find-or-create one-deep, NO enqueue); dep NOT in lookup table + `includeExternal=false` → SKIP entirely (no Library row, no edge).
      8. **Walker — internal-unresolvable warning:** dep that looks like internal-but-not-in-lookup → emit `'unresolvable-internal'` warning AND treat as external.
  - [x] 3.2 Create `repoLookupTableBuilder.ts`
    - **File:** `discovery-service/src/services/repoLookupTableBuilder.ts` (created)
    - Export `buildRepoLookupTable(repoRoot: string): Promise<{maven: Map<string, string>, npm: Map<string, string>}>`.
    - For each registered resolver (`getRegisteredEcosystems()`): call `findManifests(repoRoot)`, then `extractCoordinates(repoRoot, manifestPath)` for each manifest, building per-ecosystem `Map<key, manifestRelativePath>` (key = full `groupId:artifactId` for Maven, `name` for npm; value = parent-dir-of-manifest as `repo_subfolder`).
    - **Critical:** built once per discovery run (preflight or actual). Resolver `findManifests` already bakes the exclusions in.
  - [x] 3.3 Create `transitiveDependencyWalker.ts`
    - **File:** `discovery-service/src/services/transitiveDependencyWalker.ts` (created)
    - Export `planLibraryScan(rootEntity, model, lookupTable, includeExternal, archClient): Promise<ScanPlan>`.
    - **`ScanPlan` shape (locked contract, snake_case JSON when serialized):**
      ```ts
      type ScanPlan = {
        root: { kind: 'service' | 'library'; id: string; name: string; repo_location: string; repo_subfolder: string; ecosystem: string };
        internalLibrariesToScan: Array<{ library_id: string | null; name: string; repo_subfolder: string; depth: number; status: 'new' | 're-scan' | 'skipped-cycle' | 'skipped-depth-cap' }>;
        externalLibrariesToRecord: Array<{ library_id: string | null; name: string; declared_coordinates: string; scope: string }>;
        warnings: Array<{ type: 'cycle' | 'depth-cap' | 'unresolvable-internal'; message: string; library_name?: string }>;
      };
      ```
    - **BFS algorithm:**
      - Visited-set keyed by `Library.id` (root seeded by its own id — Service or Library).
      - Queue starts with `{libraryRefId: <root>, manifestPath: <root manifest>, depth: 0}`.
      - Pop iteration: parse manifest via matching resolver; for each `DeclaredDependency` classify:
        - **Internal scannable** (in lookup table): call `archClient.findOrCreateLibrary(...)` (preflight calls a `findOnly` variant); record edge via `archClient.findOrCreateCodeUnitDependency(...)`. If scope is in walked-set (Maven `compile`/`runtime` OR npm `dependencies`) AND not visited AND `depth+1 ≤ 5`: enqueue with `status='new'` or `'re-scan'`. If cycle (already visited): record edge with `status='skipped-cycle'`; do NOT re-walk (Library + AP still find-or-created — already exist). If depth cap: record edge with `status='skipped-depth-cap'`; do NOT walk.
        - **External** (NOT in lookup table): if `includeExternal === true`, find-or-create Library (one-deep, no `repo_subfolder`) + edge; do NOT enqueue. If `includeExternal === false`: skip entirely (no Library row, no edge).
        - **Internal-unresolvable** (looks like internal but not in lookup): emit `'unresolvable-internal'` warning AND treat as external (find-or-create one-deep if `includeExternal === true`).
      - **Scope filter:** Maven `compile`/`runtime` walked transitively; npm `dependencies` walked transitively. All other scopes (`test`/`provided`/`optional`/`devDependencies`/`peerDependencies`/`optionalDependencies`) recorded as edges (with `scope` populated) but NEVER enqueued.
      - **Source provenance** on created Library rows: `source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at=now()`, `generation_status='completed'`. Updated on every find-or-create call (whether find or create branch hits).
    - **Ordering:** result lists ordered by BFS depth ascending; ties broken by `name` ascending.
    - **Preflight vs run mode:** walker takes a flag (or 2 specialized clients). Preflight is read-only — `archClient.findOnlyLibrary(...)` performs ONLY the find half; for "new" Libraries that do not yet exist, returns `library_id: null` and the run resolves on insert.
  - [x] 3.4 Verify TS compiles + run targeted walker tests
    - From `discovery-service/`: `npx tsc --noEmit`.
    - From `discovery-service/`: `npm test -- src/__tests__/services/transitiveDependencyWalker.test.ts src/__tests__/services/repoLookupTableBuilder.test.ts`.
    - Expected: zero TS errors; the 6-8 walker tests pass.

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass.
- `buildRepoLookupTable` returns per-ecosystem `Map<key, manifestRelativePath>` covering all manifests from registered resolvers (workspaces / aggregators handled naturally).
- `planLibraryScan` returns a `ScanPlan` with `internalLibrariesToScan`, `externalLibrariesToRecord`, `warnings`, ordered by `(depth ASC, name ASC)`.
- BFS depth cap is exactly 5; cycle detection via visited-set keyed by `Library.id`; both produce `status='skipped-*'` edges with materialized targets.
- Scope filter: only Maven `compile`/`runtime` and npm `dependencies` are walked transitively; everything else is edge-only.
- External libs are recorded one-deep only when `includeExternal === true`; entirely skipped otherwise.
- Internal-unresolvable emits `'unresolvable-internal'` warning AND is treated as external.

---

### discovery-service archModelClient Extensions

#### Task Group 4: `getLibrary`, `findOrCreateLibrary`, `findOrCreateCodeUnitDependency` HTTP client functions
**Dependencies:** Task Group 1 (architecture-model-service must serve the new endpoints)

- [x] 4.0 Add the 3 new client-side HTTP wrappers in discovery-service that talk to the architecture-model-service endpoints created in Group 1. snake_case JSON body shapes mirror the controller request bodies exactly.
  - [x] 4.1 Write 2-4 focused unit tests for the new client functions
    - **File:** `discovery-service/src/__tests__/services/archModelClient.test.ts` (extend existing or create)
    - Use mocked `fetch` (existing pattern in same test file or via `jest.mock`).
    - Limit to 2-4 tests:
      1. `getLibrary(...)` builds correct `GET` URL and parses snake_case response into the expected shape.
      2. `findOrCreateLibrary(...)` POSTs snake_case body, parses `{id, derived_application_point_id, created, library}` response.
      3. `findOrCreateCodeUnitDependency(...)` POSTs snake_case body with null `declared_version`; parses `{id, created, code_unit_dependency}`.
      4. Non-2xx response throws (mirrors existing `fetchService` error pattern).
  - [x] 4.2 Add `getLibrary` to `archModelClient.ts`
    - **File:** `discovery-service/src/services/archModelClient.ts` (modified)
    - `export async function getLibrary(projectId, architectureId, libraryId): Promise<LibraryDto>` — calls `GET /api/model/projects/:p/architectures/:a/libraries/:libraryId`.
    - **Reference:** existing `fetchService(...)` shape in same file. Mirror error-handling and URL-building.
  - [x] 4.3 Add `findOrCreateLibrary` to `archModelClient.ts`
    - **File:** `discovery-service/src/services/archModelClient.ts` (modified)
    - `export async function findOrCreateLibrary(projectId, architectureId, payload: LibraryFindOrCreateRequest): Promise<{id: string; derived_application_point_id: string; created: boolean; library: LibraryDto}>`.
    - POSTs to `/api/model/projects/:p/architectures/:a/libraries`. Body fields snake_case. Sets `source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at=<ISO timestamp>`, `generation_status='completed'` on create-call payloads (locked source provenance contract).
  - [x] 4.4 Add `findOrCreateCodeUnitDependency` to `archModelClient.ts`
    - **File:** `discovery-service/src/services/archModelClient.ts` (modified)
    - `export async function findOrCreateCodeUnitDependency(projectId, architectureId, payload): Promise<{id: string; created: boolean; code_unit_dependency: CodeUnitDependencyDto}>`.
    - POSTs to `/api/model/projects/:p/architectures/:a/code-unit-dependencies`. Body fields snake_case (`source_application_point_id`, `target_application_point_id`, `declared_name`, `declared_version`, etc.). Sets `evidence_source='DISCOVERY_RESOLVER'`, `confidence=1.0` on create-call payloads.
  - [x] 4.5 Verify TS compiles + run targeted client tests
    - From `discovery-service/`: `npx tsc --noEmit`.
    - From `discovery-service/`: `npm test -- src/__tests__/services/archModelClient.test.ts`.
    - Expected: zero new TS errors; the 2-4 client tests pass.

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass.
- `getLibrary`, `findOrCreateLibrary`, `findOrCreateCodeUnitDependency` are exported from `archModelClient.ts` with snake_case body / response handling.
- Source provenance fields are set on `findOrCreateLibrary` create-call payloads exactly per locked contract.
- `evidence_source='DISCOVERY_RESOLVER'`, `confidence=1.0` are set on `findOrCreateCodeUnitDependency` create-call payloads.

---

### discovery-service Endpoints + Scan Integration

#### Task Group 5: 2 preflight endpoints + library-scan run extension + Liquibase changeset for `library_id` column
**Dependencies:** Task Groups 2, 3, 4

- [x] 5.0 Add the 2 preflight endpoints (Service-rooted + Library-rooted), extend the existing `POST .../runs` handler with library-scan support, build the new `startLibraryScopedRun` orchestrator, emit hierarchical `steps_payload` events, and add a NEW Liquibase changeset for `library_id` column on `discovery_candidate`.
  - [x] 5.1 Write 2-4 focused integration tests for the new endpoints + orchestrator
    - **File:** `discovery-service/src/__tests__/routes/preflightLibraryScan.test.ts`
    - **File:** `discovery-service/src/__tests__/services/startLibraryScopedRun.test.ts`
    - Limit to 2-4 tests:
      1. **Preflight (Service-rooted) returns ScanPlan against fixture multi-module repo** — mock `gitCloneRepoAccess` to point at a checked-in fixture under `discovery-service/src/__tests__/fixtures/repos/multi-module-maven/`; mock `archModelClient.findOnlyLibrary` to return existing-id for one of the internal libs; assert response body matches `ScanPlan` shape with depth-ordered entries and the existing internal lib has `library_id` populated (others null).
      2. **Preflight (Library-rooted)** — mocks `archModelClient.getLibrary` to return root Library row; assert response shape mirrors Service-rooted variant with `root.kind='library'`.
      3. **Library-scan run** — full happy-path: POST `runs` with `{runMode: 'library-scoped', includeExternal: true, serviceId: <id>}`; assert run row created, `steps_payload` is updated with hierarchical `library-scans` sub-array as each library completes (assert via mocked `bulkSaveCandidates` + steps_payload merge call counts).
      4. **Liquibase changeset applies** — verify `library_id` column on `discovery_candidate` table exists post-migration (use the discovery-service test DB setup).
  - [x] 5.2 Create new Liquibase changeset adding `library_id` column to `discovery_candidate`
    - **File:** `discovery-service/<liquibase-folder>/<next-numeric>-discovery-candidate-library-id.sql` (path matches existing discovery-service Liquibase convention; confirm location during implementation — likely under `discovery-service/db/changelog/` or wherever Spec 1 / earlier discovery-service migrations live).
    - Contents: `ALTER TABLE discovery_candidate ADD COLUMN library_id TEXT NULL;`. No FK constraint (matches existing `service_id` shape on the same table).
    - **Critical:** this is a NEW changeset — never edit applied changesets. Append to the master changelog at the end.
    - **Per-row contract:** candidate writers populate exactly one of `service_id` / `library_id` (not both). Service-rooted runs continue to populate `service_id`; Library-rooted runs (or library-scoped sub-scans inside a Service-rooted run) populate `library_id`.
  - [x] 5.3 Create `routes/preflightLibraryScan.ts`
    - **File:** `discovery-service/src/routes/preflightLibraryScan.ts` (created)
    - 2 handlers:
      - `POST /api/v1/discovery/projects/:p/architectures/:a/services/:serviceId/preflight-library-scan` — Service-rooted preflight. Loads service via existing `archModelClient.fetchService(...)`; clones repo (or uses cached clone — see 5.4); builds lookup table; runs `planLibraryScan(serviceEntity, model, lookupTable, includeExternal=true, archClient.findOnly)`; returns `ScanPlan` JSON.
      - `POST /api/v1/discovery/projects/:p/architectures/:a/libraries/:libraryId/preflight-library-scan` — Library-rooted preflight. Loads library via new `archModelClient.getLibrary(...)`; same downstream as Service-rooted.
    - **No `discovery_runs` row** — preflight is read-only, side-effect-free.
    - **No-LLM** — deterministic resolvers only.
    - Response is `200 OK` with `ScanPlan` body; `400`/`500` with structured error message on failure.
  - [x] 5.4 Add cached-clone helper for preflight + library-scan reuse
    - Wrap existing `gitCloneRepoAccess` (in `repoAccess.ts`) with a `(projectId, repoUrl, branch)` cache key + 10-minute TTL at `os.tmpdir()/discovery-preflight-<projectId>-<repoUrlSlug>-<branch>/`. New helper exported from `repoAccess.ts` (or a new `preflightCachedClone.ts` — implementer's call; keep close to `repoAccess.ts`).
    - Subsequent same-tuple preflight requests reuse the cached clone.
    - The actual run reuses the cached preflight clone if still warm; otherwise re-clones to the run's `discovery-<runId>/` dir.
  - [x] 5.5 Extend existing `POST .../runs` handler with library-scan support
    - **File:** `discovery-service/src/routes/runs.ts` (modified)
    - Body now accepts `{serviceId?, libraryId?, runMode?: 'service-scoped' | 'library-scoped', includeExternal?: boolean, confirmLlmSolo?}`.
    - Routing: if `runMode === 'library-scoped'` → call new `startLibraryScopedRun(...)` orchestrator (Group 5.6). Otherwise existing `startServiceScopedRun` path (no regression).
    - Returns runId immediately (mirrors existing async-fire pattern).
  - [x] 5.6 Create `startLibraryScopedRun` orchestrator in `runManager.ts`
    - **File:** `discovery-service/src/services/runManager.ts` (modified — add new function)
    - **Template:** existing `startServiceScopedRun(...)` (lines 1499-1951).
    - Steps:
      1. Resolve root entity (Service via `fetchService` OR Library via new `getLibrary`).
      2. Reuse cached preflight clone if warm; otherwise clone to `discovery-<runId>/`.
      3. Build the lookup table via `repoLookupTableBuilder`.
      4. Run `planLibraryScan(rootEntity, model, lookupTable, includeExternal, archClient)` — this performs all find-or-create writes for Library + edges in the actual run path.
      5. For each library in `internalLibrariesToScan` with `status='new'` or `'re-scan'`:
         - Emit `library-scans` sub-row with `status='pending'` via `buildMergedStepsPayload`.
         - Emit transition to `status='running'` before invoking `executeLlmFileAnalysis(...)`.
         - Call existing `executeLlmFileAnalysis(...)` against the library's `repo_subfolder`.
         - Populate resulting candidates' `library_id` field (NEW — see Group 5.2 schema column).
         - Append candidates via `bulkSaveCandidates(...)`.
         - Emit transition to `status='completed'` with `files_analyzed` and `candidate_count`.
      6. For libraries with `status='skipped-cycle'` / `'skipped-depth-cap'`: emit a single sub-row with the corresponding status (no LLM analysis fires).
    - **Source provenance** propagated through every find-or-create call (per Group 4.3).
    - **Hierarchical `steps_payload`** — extends the existing `service-scoped-llm-analysis` step entry with sibling key `library-scans: [{library_id, library_name, depth, status: 'pending'|'running'|'completed'|'skipped-cycle'|'skipped-depth-cap', files_analyzed, candidate_count, error?}]`. Re-merge via existing `buildMergedStepsPayload(...)` at line 264 for each sub-row update — same read-merge-write pattern; preserves V3 sub-tree.
    - **Pending counter** — top-level step entry tracks `pending: <int>` decrementing as each library completes.
  - [x] 5.7 Register new routes in `routes/index.ts`
    - **File:** `discovery-service/src/routes/index.ts` (modified)
    - Import and mount `preflightLibraryScan` router under `/api/v1/discovery`.
    - Existing `runs` router is unchanged at the route-mounting level (the body-shape extension lives inside the POST handler).
    - Ensure `dependencyResolvers/register.ts` is side-effect-imported once at app startup (likely from a top-level `index.ts` or `app.ts` — confirm pattern from existing `extensionPacks/register.ts` import site).
  - [x] 5.8 Verify TS compiles + run targeted endpoint + orchestrator tests + Liquibase migration test
    - From `discovery-service/`: `npx tsc --noEmit`.
    - From `discovery-service/`: `npm test -- src/__tests__/routes/preflightLibraryScan.test.ts src/__tests__/services/startLibraryScopedRun.test.ts`.
    - Expected: zero new TS errors; 2-4 endpoint + orchestrator tests pass.

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass.
- 2 new preflight endpoints reachable; both return `ScanPlan` JSON without writing any rows; both clone (or reuse cached clone) and build the lookup table.
- `POST .../runs` extended with `runMode='library-scoped'` + `includeExternal` body fields; routes to `startLibraryScopedRun` orchestrator.
- `startLibraryScopedRun` runs BFS plan, invokes `executeLlmFileAnalysis` per library, populates candidate `library_id`, emits hierarchical `steps_payload` events with pending → running → completed (or skipped-*) transitions per library.
- New Liquibase changeset adds `library_id` column to `discovery_candidate` table; never edits applied changesets.
- Cached clone reuse is keyed by `(projectId, repoUrl, branch)` with 10-minute TTL.
- Source provenance fields written on every find-or-create call.

---

### Gateway Layer

#### Task Group 6: 4 new proxy routes for preflight + library-scan
**Dependencies:** Task Group 5 (discovery-service endpoints reachable)

- [x] 6.0 Add the 4 new gateway proxy routes mirroring the existing `startDiscoveryRun` route shape. Pure pass-through — no business logic, no header rewriting beyond the existing pattern.
  - [x] 6.1 Write 1-2 focused tests for the 4 new gateway routes
    - **File:** `gateway/src/__tests__/routes/discovery-library-scan.test.ts`
    - Use existing `supertest` + mocked discovery-service endpoint pattern from neighbouring tests.
    - Limit to 1-2 tests:
      1. POST to all 4 new gateway routes (Service preflight, Library preflight, Service start-library-scan, Library start-library-scan); assert each forwards to the correct discovery-service URL with body intact and returns the discovery-service response.
      2. Non-2xx propagation — discovery-service returns 400; gateway forwards 400 to caller.
  - [x] 6.2 Add 4 new proxy route blocks
    - **File:** `gateway/src/routes/discovery.ts` (modified)
    - Routes (under existing `/api/v1/discovery` prefix):
      - `POST /projects/:projectId/architectures/:architectureId/services/:serviceId/preflight-library-scan` — proxy passthrough.
      - `POST /projects/:projectId/architectures/:architectureId/libraries/:libraryId/preflight-library-scan` — proxy passthrough.
      - `POST /projects/:projectId/architectures/:architectureId/services/:serviceId/start-library-scan` — body `{includeExternal: boolean}`; forwards to discovery-service `POST .../runs` with `{runMode: 'library-scoped', serviceId, includeExternal}`.
      - `POST /projects/:projectId/architectures/:architectureId/libraries/:libraryId/start-library-scan` — body `{includeExternal: boolean}`; forwards to discovery-service `POST .../runs` with `{runMode: 'library-scoped', libraryId, includeExternal}`.
    - **Reference:** existing `startDiscoveryRun` route in same file. Mirror axios/fetch URL-building, header forwarding, error-handling.
    - **No `server.ts` change** — existing `/api/v1/discovery` mount works.
  - [x] 6.3 Verify TS compiles + run targeted gateway test
    - From `gateway/`: `npx tsc --noEmit`.
    - From `gateway/`: `npm test -- src/__tests__/routes/discovery-library-scan.test.ts`.
    - Expected: zero new TS errors; 1-2 gateway tests pass.

**Acceptance Criteria:**
- The 1-2 tests written in 6.1 pass.
- 4 new gateway routes reachable; bodies forwarded intact; non-2xx propagated.
- No `server.ts` mount-point change.

---

### Frontend Modal + Right-Click Menu

#### Task Group 7: `PreflightModal` component + `GridRowContextMenu` extension + `gatewayClient` helpers
**Dependencies:** Task Group 6 (gateway routes reachable for the modal to call)

- [x] 7.0 Build the `PreflightModal` mirroring `StartDiscoveryRunConfirmModal` styling, extend `GridRowContextMenu` with 2 new menu items on Service + Library rows, add 4 new `gatewayClient` helpers, and wire `Grid.tsx` handler props through.
  - [x] 7.1 Write 4-6 focused Vitest tests for the modal + menu extension
    - **File:** `frontend/src/components/Grid/__tests__/PreflightModal.test.tsx` (created)
    - **File:** `frontend/src/components/Grid/__tests__/GridRowContextMenu.libraryBranch.test.tsx` (created)
    - Limit to 4-6 tests:
      1. **PreflightModal — renders all sections** with a populated `ScanPlan` fixture: root summary, internal libs list (depth + status badge), external libs list, warnings panel, toggle, Run/Cancel buttons.
      2. **PreflightModal — computing-state spinner** displayed when preflight is in flight (`isLoading={true}`).
      3. **PreflightModal — toggle re-runs preflight**: clicking "Include external libraries" off triggers an additional preflight call (mocked).
      4. **PreflightModal — Run / Cancel** — Run handler called on click; Cancel + click-outside + Escape all close the modal.
      5. **GridRowContextMenu — Service row** renders 2 items: `"Start Discovery Run"` AND `"Start Discovery Run (No Libraries)"`.
      6. **GridRowContextMenu — Library row (NEW BRANCH)** renders the same 2 items.
  - [x] 7.2 Create `PreflightModal.tsx` + `PreflightModal.module.css`
    - **File:** `frontend/src/components/Grid/PreflightModal.tsx` (created)
    - **File:** `frontend/src/components/Grid/PreflightModal.module.css` (created)
    - **Template:** `frontend/src/components/Grid/StartDiscoveryRunConfirmModal.tsx` (162 lines) + `.module.css` — mirror structure 1:1: overlay div, click-outside + Escape close, header / content / footer, `data-testid` on every interactive element, CSS module co-location.
    - **Sections:**
      - Header: `"Library Scan Preflight"` + root entity name.
      - Computing state: full-modal-area spinner + text `"Computing scan plan..."` while preflight call is in flight.
      - Root summary panel: name, kind (service/library), `repo_location`, `repo_subfolder`, ecosystem.
      - Internal libraries to scan: BFS-ordered list, depth label, status badge (`new` / `re-scan` / `skipped-cycle` / `skipped-depth-cap`).
      - External libraries to record: collapsed-by-default if >10 items.
      - Warnings panel: list with type icon (`cycle` / `depth-cap` / `unresolvable-internal`).
      - Footer: `"Run"` button (calls passed `onConfirm(includeExternal)`) + `"Cancel"` button.
    - **Toggle:** `"Include external libraries"` checkbox, default ON, modal-session-only state (no DB persistence). When toggled, re-runs preflight (full re-fetch) — modal re-shows spinner.
    - **No per-library opt-out V1** — single Run / Cancel.
    - Props: `isOpen`, `onClose`, `onConfirm(includeExternal: boolean)`, `rootEntity`, `previewFn` (the appropriate `gatewayClient` helper from Group 7.4).
  - [x] 7.3 Extend `GridRowContextMenu.tsx`
    - **File:** `frontend/src/components/Grid/GridRowContextMenu.tsx` (modified)
    - Extend the existing `entityType === 'services'` branch with a second menu item `"Start Discovery Run (No Libraries)"`.
    - Add a NEW `entityType === 'libraries'` branch with the same 2 menu items: `"Start Discovery Run"` AND `"Start Discovery Run (No Libraries)"`.
    - 2 new handler props: `onStartLibraryScan(entity)` and `onStartScanNoLibraries(entity)`. The existing `onStartDiscoveryRun(entity)` may be aliased / renamed to `onStartLibraryScan` (implementer's call) — the default flow now goes through preflight.
    - **`data-testid`** on every new interactive element.
  - [x] 7.4 Add 4 new `gatewayClient.ts` helpers
    - **File:** `frontend/src/services/gatewayClient.ts` (modified)
    - `previewLibraryScanForService(projectId, archId, serviceId): Promise<ScanPlan>` — POST to `${GATEWAY_BASE}/api/v1/discovery/projects/:p/architectures/:a/services/:s/preflight-library-scan`. snake_case response shape.
    - `previewLibraryScanForLibrary(projectId, archId, libraryId): Promise<ScanPlan>` — POST to `.../libraries/:l/preflight-library-scan`.
    - `startLibraryScanForService(projectId, archId, serviceId, includeExternal): Promise<{runId: string}>` — POST to `.../services/:s/start-library-scan` with body `{includeExternal}`.
    - `startLibraryScanForLibrary(projectId, archId, libraryId, includeExternal): Promise<{runId: string}>` — POST to `.../libraries/:l/start-library-scan` with body `{includeExternal}`.
    - **camelCase ↔ snake_case mapping at boundary** — frontend uses camelCase internally; map at the helper boundary.
    - **Reference:** existing `startDiscoveryRun` helper in same file. Mirror error-handling and URL-building.
  - [x] 7.5 Wire `Grid.tsx` handler props
    - **File:** `frontend/src/components/Grid/Grid.tsx` (modified)
    - Update the `<GridRowContextMenu>` render block (lines 986-996 region) to pass 2 new handler props: `onStartLibraryScan={(entity) => openPreflightModal(entity)}` and `onStartScanNoLibraries={(entity) => existingNoPreflightStart(entity)}`.
    - Add internal state for `preflightModalOpen` + `preflightRoot` + the `onConfirm` callback that calls the appropriate `gatewayClient` helper.
    - **`handleStartDiscoveryRunFromMenu` (line 586 region)** — keep the existing flow as the "(No Libraries)" path; the new "Start Discovery Run" default flow opens the new modal first.
    - Both `entityType === 'services'` and `entityType === 'libraries'` cases supported.
  - [x] 7.6 Verify TS compiles + run targeted Vitest tests
    - From `frontend/`: `npx tsc --noEmit`.
    - From `frontend/`: `npx vitest run src/components/Grid/__tests__/PreflightModal.test.tsx src/components/Grid/__tests__/GridRowContextMenu.libraryBranch.test.tsx`.
    - Expected: zero new TS errors; the 4-6 new tests pass.

**Acceptance Criteria:**
- The 4-6 tests written in 7.1 pass.
- `PreflightModal.tsx` mirrors `StartDiscoveryRunConfirmModal` shell (overlay, click-outside, Escape close, CSS module, `data-testid` on every interactive element).
- All sections render: root summary, internal libs (depth + status badge), external libs (collapsed-by-default if >10), warnings, toggle (default ON, modal-session-only), Run / Cancel.
- Computing-state spinner shown while preflight is in flight; toggle re-runs preflight.
- `GridRowContextMenu` Service row has 2 items; Library row branch is new and has 2 items.
- 4 new `gatewayClient` helpers POST to the correct gateway URLs with snake_case ↔ camelCase boundary mapping.
- `Grid.tsx` passes 2 new handler props through to `GridRowContextMenu`.

---

### Frontend Hierarchical Progress UI

#### Task Group 8: `DiscoveryRunDetailView` hierarchical sub-row rendering
**Dependencies:** Task Group 5 (discovery-service emits `library-scans` sub-array — without this, nothing to render)

- [x] 8.0 Extend `DiscoveryRunDetailView` `phaseList` rendering to walk the `library-scans` sub-array of the `service-scoped-llm-analysis` step entry, render indented sub-rows, decrement pending counter, reuse existing per-step status badge styling.
  - [x] 8.1 Write 1-3 focused Vitest tests for hierarchical sub-row rendering
    - **File:** `frontend/src/components/DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx` (created)
    - Use a fixture `steps_payload` with the new `library-scans` sub-array under `service-scoped-llm-analysis`.
    - Limit to 1-3 tests:
      1. **Renders library-scan sub-rows** indented under the parent step; each row shows library name, depth, status badge.
      2. **Pending counter** at the top of the step entry decrements as each library transitions from `pending` → `completed`.
      3. **Skip badges** — `skipped-cycle` and `skipped-depth-cap` rendered with the correct status badge text.
  - [x] 8.2 Extend `DiscoveryRunDetailView.tsx` `phaseList` rendering
    - **File:** `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (modified — line 643 region)
    - Inside the existing `<ul styles.phaseList>` mapping, when the current `[key, value]` pair is `service-scoped-llm-analysis` AND `value['library-scans']` is a non-empty array, render an indented sub-list under the parent row.
    - Each sub-row renders: library name, depth label, status badge (`pending` / `running` / `completed` / `skipped-cycle` / `skipped-depth-cap`).
    - **Reuse** existing per-step status badge styling — do NOT introduce new CSS classes.
    - Pending counter at top of parent step entry: decrements as each library transitions from `pending` → `completed` (read from the array; count entries with `status === 'pending' || status === 'running'`).
    - **Polling-based** — no transport changes; existing `useDiscoveryRuns` re-fetch on Refresh picks up the new sub-key automatically.
  - [x] 8.3 Verify TS compiles + run targeted Vitest test
    - From `frontend/`: `npx tsc --noEmit`.
    - From `frontend/`: `npx vitest run src/components/DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx`.
    - Expected: zero new TS errors; the 1-3 new tests pass.

**Acceptance Criteria:**
- The 1-3 tests written in 8.1 pass.
- Library-scan sub-rows render indented under the `service-scoped-llm-analysis` step row, with status badge per row.
- Pending counter at top decrements as each library completes.
- Existing per-step status badge styling reused — no new CSS classes.
- No transport changes; polling-based read-merge-render works.

---

### Verification Layer

#### Task Group 9: Final TS / Java / npm + targeted-tests verification sweep
**Dependencies:** Task Groups 1-8

- [x] 9.0 Run the verification sweep across all 3 services. Confirm zero new TS errors, zero new Java compile errors, zero new test failures beyond the pre-existing inventory. Use the broken-tests staging workaround for architecture-model-service targeted tests.
  - [x] 9.1 Review tests written by Groups 1-8
    - Review the 2-4 backend integration tests (Group 1.1).
    - Review the 4-8 resolver tests (Group 2.1).
    - Review the 6-8 walker + lookup tests (Group 3.1).
    - Review the 2-4 archModelClient tests (Group 4.1).
    - Review the 2-4 endpoint + orchestrator tests (Group 5.1).
    - Review the 1-2 gateway tests (Group 6.1).
    - Review the 4-6 modal + menu tests (Group 7.1).
    - Review the 1-3 detail-view tests (Group 8.1).
    - Total existing tests: approximately 23-39 tests.
  - [x] 9.2 Analyse test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage.
    - Focus ONLY on this spec's surface; do NOT assess the entire application.
    - Priority gap candidates:
      - Full preflight → run pipeline against a real fixture multi-module Maven repo (currently covered piecemeal).
      - Round-trip: preflight returns ScanPlan → user confirms with toggle ON → run executes → candidates land with `library_id` set correctly per library.
      - End-to-end source-provenance assertion: created Library rows have `source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at` populated.
  - [⚠] 9.3 Write up to 6 additional strategic integration tests maximum (NOT added — see verification report)
    - **End-to-end fixture-repo scan (1 test)**: against `discovery-service/src/__tests__/fixtures/repos/multi-module-maven/` — full preflight → confirm → run pipeline; assert ScanPlan shape, candidate `library_id` population, `library-scans` sub-array completion.
    - **Source provenance assertion (1 test)**: confirm `findOrCreateLibrary` payloads carry `source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at` set.
    - **Edge identity composite + null-tolerant version (1 test)**: backend integration — pre-seed an edge with `declared_version=NULL`; subsequent find-or-create with same composite + `declared_version=null` returns existing id.
    - **External-libs-toggle-OFF (1 test)**: walker run with `includeExternal=false` produces NO external Library rows AND NO external edges.
    - **Spec 2 `applicationPointDerivation` reuse (1 test)**: confirm that the derived AP for a new Library uses `target_type='LIBRARY'` AND that Spec 2's frontend `applicationPointDerivation` 4th-arm continues to work without regression.
    - **Existing Service-scoped run regression (1 test)**: a service-scoped run WITHOUT library-scope continues to work end-to-end (no candidate `library_id` set, no `library-scans` sub-array, identical behaviour to pre-spec).
    - Place tests under: `discovery-service/src/__tests__/integration/libraryDiscovery.integration.test.ts`.
  - [x] 9.4 Run feature-specific tests only (do NOT run full suite of any service)
    - **architecture-model-service:** use broken-tests staging workaround. Run `mvn -pl architecture-model-service test -Dtest=LibraryControllerIntegrationTest,CodeUnitDependencyControllerIntegrationTest`. Restore staged broken-tests after.
    - **discovery-service:** `npm test -- src/__tests__/dependencyResolvers/ src/__tests__/services/ src/__tests__/routes/preflightLibraryScan.test.ts src/__tests__/integration/libraryDiscovery.integration.test.ts`.
    - **gateway:** `npm test -- src/__tests__/routes/discovery-library-scan.test.ts`.
    - **frontend:** `npx vitest run src/components/Grid/__tests__/PreflightModal.test.tsx src/components/Grid/__tests__/GridRowContextMenu.libraryBranch.test.tsx src/components/DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx`.
    - Expected total: approximately 29-45 tests.
  - [x] 9.5 Run `npx tsc --noEmit` + `mvn compile` + `npm run build` across all services
    - **frontend:** `npx tsc --noEmit` — zero new errors. Pre-existing inventory unchanged.
    - **discovery-service:** `npx tsc --noEmit` — zero new errors.
    - **gateway:** `npx tsc --noEmit` — zero new errors.
    - **architecture-model-service:** `mvn -pl architecture-model-service compile` — zero new errors.
    - **discovery-service Liquibase migration:** apply against test DB; verify `discovery_candidate.library_id` column exists post-migration.
  - [x] 9.6 Confirm pre-existing failure inventory unchanged
    - **Frontend Vitest sweep** (NOT mandatory if 9.4 already covered the new tests; run only if a regression check is needed):
      - Pre-existing failures expected: `bootstrap-summary-fetching.test.ts` (1), `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts` (2), `chatV2-panel-integration.test.ts` (3), `chatV2-panel-context-and-filtering.test.ts` (1).
      - **No new failures** introduced; **no previously-passing tests** now failing.
    - **architecture-model-service:** the ~117 pre-existing broken Java test files remain unchanged (broken-tests staging workaround used during 9.4; files restored).
    - **DO NOT** modify or attempt to fix any pre-existing failing test.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 29-45 tests total: 23-39 from Groups 1-8 + up to 6 from 9.3).
- Critical user workflows for this feature are covered: preflight → confirm → run pipeline; source provenance on created Libraries; null-tolerant version match; toggle-OFF external skip; Spec 2 derivation reuse; Service-scoped run regression-safe.
- No more than 6 additional integration tests added when filling gaps.
- Testing focused exclusively on this spec's feature requirements.
- `npx tsc --noEmit` clean across `frontend/`, `discovery-service/`, `gateway/`.
- `mvn -pl architecture-model-service compile` clean.
- Discovery-service Liquibase migration applies cleanly; `library_id` column exists on `discovery_candidate`.
- Pre-existing failure inventory unchanged across all services.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: architecture-model-service backend endpoints** — 3 new REST endpoints + 2 repo finders + 3 service-layer methods. Spec 1 schema unchanged. Independent of any other group; blocks Group 4.
2. **Task Group 2: discovery-service registry + Maven/npm resolvers** — pure standalone code; can run in parallel with Group 1.
3. **Task Group 3: discovery-service walker + lookup-table builder** — depends on Group 2.
4. **Task Group 4: discovery-service archModelClient extensions** — depends on Group 1 (endpoints reachable).
5. **Task Group 5: discovery-service endpoints + scan integration + Liquibase changeset** — depends on Groups 2, 3, 4.
6. **Task Group 6: gateway proxy routes** — depends on Group 5 (discovery-service endpoints reachable).
7. **Task Group 7: frontend modal + right-click menu + gatewayClient** — depends on Group 6.
8. **Task Group 8: frontend hierarchical progress** — depends on Group 5 (discovery-service must emit `library-scans` sub-array — without this, nothing to render).
9. **Task Group 9: Verification sweep** — depends on Groups 1-8.

Groups 1 and 2 are independent and can run in parallel. Group 3 depends on Group 2. Group 4 depends on Group 1. Group 5 depends on Groups 2, 3, 4. Groups 6 → 7 → 8 are sequential. Group 9 must run last.

---

## File Summary

### architecture-model-service (Java) — Files to Create / Modify
- **Create:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/LibraryController.java`
- **Create:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/CodeUnitDependencyController.java`
- **Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/LibraryService.java` (add `findOrCreate`, `findById`)
- **Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/CodeUnitDependencyService.java` (add `findOrCreate`)
- **Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java` (add `findByModelFileIdAndNameAndEcosystem`)
- **Modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java` (add composite finder)
- **Create:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/LibraryControllerIntegrationTest.java`
- **Create:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/CodeUnitDependencyControllerIntegrationTest.java`

### discovery-service (TypeScript) — Files to Create / Modify
- **Create:** `discovery-service/src/services/dependencyResolverRegistry.ts`
- **Create:** `discovery-service/src/services/dependencyResolvers/types.ts`
- **Create:** `discovery-service/src/services/dependencyResolvers/register.ts`
- **Create:** `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts`
- **Create:** `discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts`
- **Create:** `discovery-service/src/services/repoLookupTableBuilder.ts`
- **Create:** `discovery-service/src/services/transitiveDependencyWalker.ts`
- **Modify:** `discovery-service/src/services/archModelClient.ts` (add `getLibrary`, `findOrCreateLibrary`, `findOrCreateCodeUnitDependency`)
- **Create:** `discovery-service/src/routes/preflightLibraryScan.ts`
- **Modify:** `discovery-service/src/routes/runs.ts` (extend POST handler with library-scan support)
- **Modify:** `discovery-service/src/routes/index.ts` (register new routes + ensure resolver register.ts is side-effect imported)
- **Modify:** `discovery-service/src/services/runManager.ts` (add `startLibraryScopedRun`; extend `steps_payload` with `library-scans` sub-array)
- **Modify:** `discovery-service/src/services/repoAccess.ts` (or new sibling file) — add `(projectId, repoUrl, branch)`-keyed cached clone with 10-minute TTL
- **Create:** `discovery-service/<liquibase-folder>/<next-numeric>-discovery-candidate-library-id.sql` (NEW Liquibase changeset adding `library_id` TEXT NULL column on `discovery_candidate`)
- **Modify:** discovery-service master changelog (append new changeset entry)
- **Create:** `discovery-service/src/__tests__/dependencyResolvers/MavenDependencyResolver.test.ts`
- **Create:** `discovery-service/src/__tests__/dependencyResolvers/NpmDependencyResolver.test.ts`
- **Create:** `discovery-service/src/__tests__/services/transitiveDependencyWalker.test.ts`
- **Create:** `discovery-service/src/__tests__/services/repoLookupTableBuilder.test.ts`
- **Create:** `discovery-service/src/__tests__/services/archModelClient.test.ts` (or extend existing)
- **Create:** `discovery-service/src/__tests__/routes/preflightLibraryScan.test.ts`
- **Create:** `discovery-service/src/__tests__/services/startLibraryScopedRun.test.ts`
- **Create:** `discovery-service/src/__tests__/integration/libraryDiscovery.integration.test.ts`
- **Create:** fixture trees under `discovery-service/src/__tests__/fixtures/dependencyResolvers/` and `discovery-service/src/__tests__/fixtures/repos/multi-module-maven/`

### gateway (TypeScript) — Files to Modify
- **Modify:** `gateway/src/routes/discovery.ts` (add 4 new proxy routes)
- **Create:** `gateway/src/__tests__/routes/discovery-library-scan.test.ts`

### frontend (TypeScript) — Files to Create / Modify
- **Create:** `frontend/src/components/Grid/PreflightModal.tsx`
- **Create:** `frontend/src/components/Grid/PreflightModal.module.css`
- **Modify:** `frontend/src/components/Grid/GridRowContextMenu.tsx` (extend Service branch + add Library branch)
- **Modify:** `frontend/src/components/Grid/Grid.tsx` (handler-prop wiring lines 586 / 957 / 986-996)
- **Modify:** `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` (line 643 — hierarchical sub-row rendering)
- **Modify:** `frontend/src/services/gatewayClient.ts` (add 4 helpers — `previewLibraryScanForService`, `previewLibraryScanForLibrary`, `startLibraryScanForService`, `startLibraryScanForLibrary`)
- **Create:** `frontend/src/components/Grid/__tests__/PreflightModal.test.tsx`
- **Create:** `frontend/src/components/Grid/__tests__/GridRowContextMenu.libraryBranch.test.tsx`
- **Create:** `frontend/src/components/DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx`

### Files NOT to Touch
- Spec 1 Liquibase changesets (≤ 124 in architecture-model-service) — never edit applied changesets.
- Spec 1 entity / DTO / repository files for `Library` and `CodeUnitDependency` (already in place).
- Spec 2 frontend types, grid configs, picker / derivation extension — already in place.
- Existing `extensionPackRegistry.ts` / `extensionPacks/` files — pure reference; do not edit.
- Existing `startServiceScopedRun` orchestrator — do not refactor; `startLibraryScopedRun` is a sibling that parallels it.
- Existing `bulkSaveCandidates`, `buildMergedStepsPayload` — reused as-is.
- Existing `StartDiscoveryRunConfirmModal.tsx` — pure reference template; do not modify.
- Pre-existing broken backend test files (~117) — broken-tests staging workaround during verification only; never edit content.
- Pre-existing failing frontend tests (per project memory) — never edit.

---

## Reference Patterns

### Existing Code to Follow

- **`extensionPackRegistry.ts` + `extensionPacks/register.ts`** (`discovery-service/src/services/`, 262 lines)
  - Authoritative blueprint for `DependencyResolverRegistry` and the sibling `dependencyResolvers/register.ts` module-load side-effect import. Surface: `register*`, `find*` / `get*`, `clearRegistry`. No runtime mutation.

- **`startServiceScopedRun` (lines 1499-1951) + `buildMergedStepsPayload` (line 264) + `bulkSaveCandidates` (line 983)** in `discovery-service/src/services/runManager.ts`
  - `startServiceScopedRun` is the closest blueprint for `startLibraryScopedRun`: clone → build context → tech-hints prompt → `executeLlmFileAnalysis` → candidates → save.
  - `buildMergedStepsPayload` is the read-merge-write pattern reused for hierarchical `library-scans` sub-row updates without clobbering V3 sub-tree.

- **`gitCloneRepoAccess`** in `discovery-service/src/services/repoAccess.ts`
  - Reusable clone primitive. Wrap with `(projectId, repoUrl, branch)` cache key + 10-minute TTL for preflight; the actual run reuses the cached dir if still warm.

- **`techHintsResolver.ts:139-210` (`buildSnapshot`)** in `discovery-service/src/services/`
  - Repo-root-only walker reference. Spec 3's walker is recursive (with V1 exclusions baked into resolver `findManifests`).

- **`fetchService(...)`** in `discovery-service/src/services/archModelClient.ts`
  - Pattern source for `getLibrary(...)`. Mirror error-handling + URL-building.

- **`StartDiscoveryRunConfirmModal.tsx` (162 lines) + `.module.css`** in `frontend/src/components/Grid/`
  - Pattern source for `PreflightModal`: overlay div, click-outside + Escape close, header / content / footer, CSS module, `data-testid` on every interactive element.

- **`GridRowContextMenu.tsx`** in `frontend/src/components/Grid/`
  - Already entity-type-keyed (`services` + `interfaces`); the Library-row branch is net-new and the Service-row branch gets a second item.

- **`DiscoveryRunDetailView.tsx:421` (`phaseEntries`) + `:643` (`<ul styles.phaseList>`)** in `frontend/src/components/DashboardView/`
  - Existing flat-list rendering; hierarchical sub-rows are a small render-extension on the existing structure.

- **`Grid.tsx:586` (`handleStartDiscoveryRunFromMenu`), `:957` (`onContextMenu`), `:986-996` (`<GridRowContextMenu>`)** in `frontend/src/components/Grid/`
  - Wiring points for new handler props.

- **`gatewayClient.ts:177` (`startDiscoveryRun`)** in `frontend/src/services/`
  - Pattern source for the 4 new helpers.

- **`ArchitectureCloneService` Service-side derived-AP creation** in `architecture-model-service/src/main/java/com/example/architecturemodel/service/`
  - Pattern source for `LibraryService.findOrCreate(...)` derived-AP creation in the same transaction: when a new Library row is inserted, also insert the derived `ApplicationPointEntity` with `target_type='LIBRARY'`, `target_ref_id=<new id>`, `kind='LIBRARY'`. Return both ids in the response.

- **Spec 2's `applicationPointDerivation.ts` (4th arm — `'LIBRARY'`)** in `frontend/src/utils/`
  - Reused for the derived AP on Library rows. No edits in this spec; reuse only.

### Key Decisions to Honour

- **snake_case JSON throughout** — Java Jackson `@JsonProperty("snake_case")`; TypeScript camelCase ↔ snake_case mapping at boundaries.
- **Library identity at resolver / find-or-create endpoint layer** — no DB UNIQUE on `(libraries.name, ecosystem)`. Spec 1 deliberately scoped this out.
- **Edge identity composite + null-tolerance for `declared_version`** — `(source_AP_id, target_AP_id, declared_name, declared_version)` with Spring Data null-tolerant matching.
- **BFS depth cap = 5** — exact integer; cycle detection via visited-set keyed by `Library.id`.
- **Scope filter** — Maven `compile`/`runtime` walked transitively; npm `dependencies` walked transitively. All other scopes (`test`/`provided`/`optional`/`devDependencies`/`peerDependencies`/`optionalDependencies`) recorded as edges with `scope` populated but NEVER enqueued.
- **External libraries recorded ONE-deep ONLY when toggle ON** — `includeExternal === true` find-or-creates external Library + edge; `includeExternal === false` skips entirely (no Library row, no edge).
- **Per-modal-session toggle (no DB)** — `"Include external libraries"` defaults ON every time the modal opens; no persistence.
- **No mid-run abort, no per-library opt-out V1.**
- **Source provenance on created Library rows** — `source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at=now()`, `generation_status='completed'`. `last_verified_at` updated on every find-or-create call.
- **Reuse Spec 2's `applicationPointDerivation` 4th arm** for derived APs in the frontend rendering pipeline.
- **NEW Liquibase changeset** in discovery-service adds `library_id` column to `discovery_candidate` table. Never edit applied changesets.
- **Maven properties / version ranges / npm scoped packages stored verbatim** — no normalisation V1.
- **Preflight is read-only** — never creates a `discovery_runs` row; `find` half of find-or-create only.
- **Hierarchical progress is payload-shape only** — no SSE, no websockets; existing poll-based detail view picks up the new sub-key.
- **architecture-model-service whole-model PUT remains untouched** — the 3 new endpoints exist solely to support discovery-service's direct-write flow.
- **Walker exclusions** baked into each resolver's `findManifests`: `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`, plus project-level `excludePaths` from existing run config.
- **Broken-tests staging workaround** for architecture-model-service targeted-test verification: temporarily move broken files OUT of `src/test/` before running, restore after. Never modify broken-test contents.
