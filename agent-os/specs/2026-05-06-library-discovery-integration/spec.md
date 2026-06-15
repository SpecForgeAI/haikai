# Specification: Library Discovery Integration

## Goal
Make `discovery-service` Library-aware: deterministically parse Maven/npm manifests, classify dependencies as internal vs external, walk transitively (BFS, depth cap 5, cycle-detected), and write `Library` + `code_unit_dependencies` rows directly via 3 net-new architecture-model-service endpoints. Frontend gets a preflight modal, two new right-click menu items per row, and hierarchical run-progress sub-rows. Spec 3 of 3 in the Library arc.

## User Stories
- As an architect, I want to right-click a Service or Library row and start a discovery run that auto-discovers internal sibling-subfolder libraries and their transitive dependencies so I do not have to wire them manually.
- As an architect, I want a preflight modal that shows the full BFS scan plan (root, internal libs with depth/status, external libs, warnings) before any LLM tokens are spent so I can confirm scope and toggle external-library inclusion.
- As an architect, I want hierarchical progress reporting in the existing run panel so I can see each library being scanned, its depth, and its per-library status without leaving the page.

## Specific Requirements

**3 new architecture-model-service REST endpoints (additive — Spec 1 schema unchanged)**
- `POST /api/model/projects/:projectId/architectures/:architectureId/libraries` — find-or-create on `(model_file_id, name, ecosystem)`. Body: `{name, ecosystem, repo_location?, repo_subfolder?, source_origin?, source_system?, source_reference?, last_verified_at?, generation_status?, ...}`. Response: `{id, derived_application_point_id, created: boolean, library: LibraryDto}`. When `created=true`, same transaction inserts the derived `ApplicationPoint` with `target_type='LIBRARY'`, `target_ref_id=<new id>`, `kind='LIBRARY'` (mirrors `ArchitectureCloneService` Service-side pattern).
- `POST /api/model/projects/:projectId/architectures/:architectureId/code-unit-dependencies` — find-or-create on `(source_application_point_id, target_application_point_id, declared_name, declared_version)` with null-tolerance for `declared_version`. Body: `{source_application_point_id, target_application_point_id, declared_name, declared_version?, declared_version_range?, scope, manifest_path, manifest_line?, evidence_source?, confidence?}`. Response: `{id, created: boolean, code_unit_dependency: CodeUnitDependencyDto}`.
- `GET /api/model/projects/:projectId/architectures/:architectureId/libraries/:libraryId` — single `LibraryDto` by id, scoped by projectId/architectureId. 404 on miss.

**architecture-model-service supporting changes (~6 files)**
- New `LibraryController.java` and `CodeUnitDependencyController.java` (or extend `ModelController.java` — implementer's call) housing the 3 endpoints.
- New `LibraryService.findOrCreate(...)` and `LibraryService.findById(...)` plus `CodeUnitDependencyService.findOrCreate(...)` methods wired to repositories and `EntityMapper`.
- `LibraryRepository.findByModelFileIdAndNameAndEcosystem(modelFileId, name, ecosystem) -> Optional<LibraryEntity>`.
- `CodeUnitDependencyRepository.findBySourceApplicationPointIdAndTargetApplicationPointIdAndDeclaredNameAndDeclaredVersion(...) -> Optional<CodeUnitDependencyEntity>` with Spring Data JPA `Optional`-parameter null-tolerance for `declaredVersion`.
- Integration tests: 1 per endpoint covering find-and-create branches, derived-AP creation in same transaction (libraries POST), null-tolerant version match (code-unit-dependencies POST), 404 path (libraries GET).
- No Liquibase changesets; Spec 1's tables and the `application_points.target_type` CHECK already cover everything.

**`DependencyResolverRegistry` and resolver layer (discovery-service)**
- New `discovery-service/src/services/dependencyResolverRegistry.ts` mirroring `extensionPackRegistry.ts` shape: `registerDependencyResolver`, `getDependencyResolver(ecosystem)`, `getRegisteredEcosystems`, `clearRegistry`. Module-load registration only via sibling `dependencyResolvers/register.ts` (side-effect import); no runtime mutation after startup.
- Per-resolver folder layout: `discovery-service/src/services/dependencyResolvers/<ecosystem>/`. V1: `maven/MavenDependencyResolver.ts`, `npm/NpmDependencyResolver.ts`. Shared `dependencyResolvers/types.ts` for the `DeclaredDependency` and `DependencyResolver` interfaces.
- `DependencyResolver` interface (locked contract): `getEcosystem(): 'MAVEN' | 'NPM'`; `findManifests(repoRoot): Promise<string[]>` (recursive, with V1 exclusions); `resolve(repoRoot, manifestPath): Promise<DeclaredDependency[]>`; `extractCoordinates(repoRoot, manifestPath): {ecosystem, name, subfolder} | null` for the lookup-table builder.
- `DeclaredDependency` shape (locked contract): `{name: string, version?: string, versionRange?: string, scope: string, manifestPath: string, manifestLine?: number}`. Maven `name` = `groupId:artifactId`; npm `name` = full scoped/unscoped string. `manifestPath` is repo-root-relative.

**Maven and npm resolvers**
- `MavenDependencyResolver`: walks all `pom.xml` files; parses each via XML; emits one `DeclaredDependency` per `<dependency>` block. Maven `name` = `groupId:artifactId`. Scopes: `compile`/`runtime`/`test`/`provided`/`optional` (default `compile` when omitted). Version stored verbatim including `${propname}` literals (no property resolution V1). Range syntax `[1.0,2.0)` goes into `versionRange` with `version` left null.
- `NpmDependencyResolver`: walks all `package.json` files (including npm workspace package.jsons); emits one `DeclaredDependency` per declared package across `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`. npm `name` = full string including `@scope/` prefix (no stripping). Version stored verbatim; ranges go into `versionRange` (V1 keeps `version` set verbatim — no separation of pinned vs range for npm).
- Per-resolver fixture-based unit tests under `discovery-service/src/__tests__/fixtures/dependencyResolvers/`: single-module Maven, multi-module Maven aggregator, npm root-only, npm workspace, edge cases (property placeholders, ranges, scoped packages, dev/peer scopes).

**Repo-wide lookup-table builder**
- New `discovery-service/src/services/repoLookupTableBuilder.ts`. Given a cloned repo root, calls each registered resolver's `findManifests` then `extractCoordinates` to build a per-ecosystem `Map<key, manifestRelativePath>`: `lookupTable.maven: Map<"groupId:artifactId", subfolder>`; `lookupTable.npm: Map<"name", subfolder>` (workspace package.jsons included naturally).
- Built once per discovery run (preflight or actual). Per-resolver walker exclusions (baked into each resolver's `findManifests`): `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`, plus the project's `excludePaths` from existing run config.
- Unit tests: single-module Maven (1 entry), multi-module Maven aggregator (N entries), npm workspaces (N entries), exclusions correctly skipped.

**BFS transitive walker**
- New `discovery-service/src/services/transitiveDependencyWalker.ts` exporting `planLibraryScan(rootEntity, model, lookupTable, includeExternal): ScanPlan`. BFS from root (Service or Library); visited-set keyed by `Library.id` after find-or-create (root seeded by its own id); depth cap 5.
- Per-iteration: pop `{libraryRefId, manifestPath, depth}`; for each `DeclaredDependency`:
  - **Internal scannable** (in lookup table): call `archModelClient.findOrCreateLibrary(...)`, record edge via `archModelClient.findOrCreateCodeUnitDependency(...)`. If scope is in walked-set (Maven `compile`/`runtime` or npm `dependencies`) AND not visited AND `depth+1 ≤ 5`: enqueue with status `'new'` or `'re-scan'`. If cycle (already visited): record edge with status `'skipped-cycle'`; do NOT re-walk. If depth cap (`depth+1 > 5`): record edge with status `'skipped-depth-cap'`; do NOT walk. Edge IS recorded in both skip cases; target Library + AP are find-or-created (materialized).
  - **External** (NOT in lookup table): if `includeExternal === true`, find-or-create Library (one-deep, no `repo_subfolder`) + edge; do NOT enqueue. If `includeExternal === false`: skip entirely (no Library row, no edge).
  - **Internal-unresolvable** (looks like internal but not in lookup): emit a `'unresolvable-internal'` warning AND treat as external (find-or-create one-deep if `includeExternal === true`).
- Scope filtering: Maven `compile`/`runtime` walked transitively; npm `dependencies` walked transitively. All other scopes (`test`/`provided`/`optional`/`devDependencies`/`peerDependencies`/`optionalDependencies`) recorded as edges with `scope` populated but never enqueued.
- Source provenance on created Library rows: `source_origin = 'DISCOVERED'`, `source_system = 'discovery-service'`, `source_reference = <runId>`, `last_verified_at = now()`, `generation_status = 'completed'`. `last_verified_at` updated on every find-or-create call (whether find or create branch hits).
- Unit tests: cycle detection, depth cap (depth-5 boundary), scope filtering (test/dev edges recorded, not walked), internal vs external classification, internal-unresolvable warning emission, `includeExternal=false` external skip.

**`ScanPlan` shape (locked contract — returned by walker, used by both preflight and run)**
- `{ root: { kind: 'service' | 'library', id, name, repo_location, repo_subfolder, ecosystem }, internalLibrariesToScan: [{ library_id, name, repo_subfolder, depth, status: 'new' | 're-scan' | 'skipped-cycle' | 'skipped-depth-cap' }], externalLibrariesToRecord: [{ library_id, name, declared_coordinates, scope }], warnings: [{ type: 'cycle' | 'depth-cap' | 'unresolvable-internal', message, library_name? }] }`. Ordered by BFS depth ascending; ties broken by `name` ascending. snake_case JSON throughout.
- Preflight is read-only: it performs the find half of find-or-create and returns the resolved `library_id` for existing internal Libraries. For "new" Libraries that do not yet exist, preflight returns `library_id: null` and the actual run resolves on insert.

**2 new discovery-service endpoints + library-scan run extension**
- `POST /api/v1/discovery/projects/:p/architectures/:a/services/:serviceId/preflight-library-scan` — Service-rooted preflight. Returns `ScanPlan` JSON. No `discovery_runs` row.
- `POST /api/v1/discovery/projects/:p/architectures/:a/libraries/:libraryId/preflight-library-scan` — Library-rooted preflight. Same response shape. Uses `archModelClient.getLibrary(...)` to load root row.
- Both clone the repo if needed and cache by `(projectId, repoUrl, branch)` with default 10-minute TTL at `os.tmpdir()/discovery-preflight-<projectId>-<repoUrlSlug>-<branch>/`. Subsequent same-tuple requests reuse the cached clone.
- The actual scan extends the existing `POST .../runs` handler with library-scan support: body adds `{includeExternal: boolean}` and a sentinel (e.g. `runMode: 'library-scoped'`) routing to a new `startLibraryScopedRun(...)` orchestrator in `runManager.ts`. Reuses the cached preflight clone if still warm; otherwise re-clones to the run's `discovery-<runId>/` dir.
- New routes registered in `discovery-service/src/routes/index.ts`. Preflight handlers in new `routes/preflightLibraryScan.ts`; library-scan run handler co-located with existing `routes/runs.ts` POST handler.

**`startLibraryScopedRun` orchestrator (discovery-service `runManager.ts`)**
- Parallels existing `startServiceScopedRun` (line 1499). Builds the lookup table, walks BFS, and for each library to scan: invokes existing `executeLlmFileAnalysis(...)` step against the library's `repo_subfolder`; emits hierarchical `steps_payload` events.
- Source provenance and `last_verified_at` set per find-or-create call (see walker section).
- Resulting candidates carry the root entity's `service_id` (Service-rooted runs) OR a new `library_id` field (Library-rooted runs). **Resolution: add `library_id` column to the `discovery_candidate` table** (option `(a)` per pre-spec direction — explicit polymorphism, matches Spec 1 conventions, cleanest). New Liquibase changeset in discovery-service's DB (or schema migration if discovery-service uses a separate DB). Candidate writers populate exactly one of `service_id` / `library_id` per row.

**Hierarchical progress events (no new transport)**
- Extend the existing `service-scoped-llm-analysis` step entry in `steps_payload` (JSONB column on `discovery_runs`) with a sibling key `library-scans: [{ library_id, library_name, depth, status: 'pending' | 'running' | 'completed' | 'skipped-cycle' | 'skipped-depth-cap', files_analyzed, candidate_count, error? }]`.
- Re-merge via existing `buildMergedStepsPayload(...)` (line 264) for each sub-row update — same read-merge-write pattern; preserves the V3 sub-tree.
- No SSE, no websockets — the existing poll-based `DiscoveryRunDetailView` rendering picks up the new sub-key automatically.

**`archModelClient.ts` extensions (discovery-service)**
- New `getLibrary(projectId, architectureId, libraryId)` — calls the new `GET /libraries/:id` endpoint; mirrors existing `fetchService(...)` shape. Used by Library-rooted preflight to load `repo_location`/`repo_subfolder` and by the per-Library LLM tech-hints prompt.
- New `findOrCreateLibrary(projectId, architectureId, payload)` — calls `POST /libraries`; returns `{id, derived_application_point_id, created, library}`.
- New `findOrCreateCodeUnitDependency(projectId, architectureId, payload)` — calls `POST /code-unit-dependencies`; returns `{id, created, code_unit_dependency}`.

**Frontend `PreflightModal` component**
- New `frontend/src/components/Grid/PreflightModal.tsx` + `PreflightModal.module.css`. Mirrors `StartDiscoveryRunConfirmModal.tsx` styling and structure: overlay div, click-outside + Escape close, header/content/footer, `data-testid` on every interactive element.
- Sections: header ("Library Scan Preflight" + root entity name); computing-state spinner ("Computing scan plan...") while preflight call is in flight; root summary panel; internal libraries to scan (BFS-ordered, depth label, status badge); external libraries to record (collapsed-by-default if >10); warnings panel.
- Toggle: "Include external libraries" (default ON, modal-session-only state — no DB persistence). When toggled, re-runs preflight (full re-fetch).
- Footer: single "Run" / "Cancel" buttons. No per-library opt-out V1.
- Vitest tests: rendering with all sections populated, computing spinner, toggle re-runs preflight, Run/Cancel handlers.

**`GridRowContextMenu` extension**
- Extend `frontend/src/components/Grid/GridRowContextMenu.tsx` to add 2 menu items each on Service AND Library rows: `"Start Discovery Run"` (default → opens `PreflightModal`) and `"Start Discovery Run (No Libraries)"` (bypasses preflight, kicks off existing single-entity scan flow).
- Wiring: extend the existing `entityType === 'services'` branch with the second item; add a new `entityType === 'libraries'` branch with both items. 2 new handler props on the component: `onStartLibraryScan(entity)` and `onStartScanNoLibraries(entity)` (the existing `onStartDiscoveryRun(entity)` may be aliased/renamed; implementer's call). `Grid.tsx:986-996` updates the props it passes through.
- Vitest test: Library-row branch renders both items; Service-row branch renders both items.

**`DiscoveryRunDetailView` hierarchical sub-row rendering**
- Extend `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx:643` `phaseList` rendering to walk the `library-scans` sub-array of the `service-scoped-llm-analysis` step entry; render indented sub-rows with per-row status badges (`pending`/`running`/`completed`/`skipped-cycle`/`skipped-depth-cap`) reusing existing per-step status badge styling.
- Pending counter at top of step entry decrements as each library completes.
- Vitest assertion test: rendering library-scan sub-rows from a fixture `steps_payload`.

**`gatewayClient.ts` extensions (frontend)**
- 4 new helpers in `frontend/src/services/gatewayClient.ts`: `previewLibraryScanForService(projectId, archId, serviceId)`, `previewLibraryScanForLibrary(projectId, archId, libraryId)`, `startLibraryScanForService(projectId, archId, serviceId, includeExternal)`, `startLibraryScanForLibrary(projectId, archId, libraryId, includeExternal)`. Each builds `${GATEWAY_BASE}/api/v1/discovery/projects/:p/architectures/:a/...` and POSTs JSON; throws on non-2xx like existing `startDiscoveryRun`.

**Gateway route additions (~2 files)**
- 2 new route blocks in `gateway/src/routes/discovery.ts`: `POST .../preflight-library-scan` (Service + Library variants) and `POST .../start-library-scan` (Service + Library variants). Likely simple proxy passthrough mirroring the existing `startDiscoveryRun` route — confirm shape during implementation.
- Mount under existing `/api/v1/discovery` prefix; no `server.ts` change needed.
- 1 new gateway test exercising the 4 new routes.

**Locked contract honoured**
- snake_case JSON throughout. Library identity = `(model_file_id, name, ecosystem)` enforced at find-or-create endpoint (no DB UNIQUE per Spec 1's deliberate scoping). Edge identity = `(source_AP_id, target_AP_id, declared_name, declared_version)` with null-tolerance for `declared_version`. BFS depth cap 5; cycle detection via visited-set keyed by `Library.id`. Scope filter: Maven `compile`/`runtime` and npm `dependencies` walked transitively; all others edge-only. External libs recorded one-deep only when toggle ON. Per-modal-session toggle (no DB). No mid-run abort. No per-library opt-out in V1 modal. Spec 1 + Spec 2 wiring stays intact and additive.

## Visual Design
N/A — no visuals provided. Reference UX:
- `StartDiscoveryRunConfirmModal.tsx` (162 lines) is the precise pattern for `PreflightModal` shell, header/content/footer, click-outside + Escape close, `data-testid` placement, CSS module co-location.
- `DiscoveryRunDetailView.tsx:643` `phaseList <ul>` is the extension target for hierarchical sub-rows; existing per-step status badge styling is reused.
- `GridRowContextMenu.tsx` is already entity-type-keyed; the Library-row branch is net-new and the Service-row branch gets a second item.

## Existing Code to Leverage

**`extensionPackRegistry.ts` + `extensionPacks/register.ts` (262 lines)**
- Authoritative blueprint for `DependencyResolverRegistry` and the sibling `dependencyResolvers/register.ts` module-load side-effect import. Lookup-by-key, no runtime mutation, `clearRegistry` for tests.
- Per-pack folder layout (`extensionPacks/languagePacks/<id>/`) is the template for `dependencyResolvers/<ecosystem>/`.

**`runManager.ts` `startServiceScopedRun` (lines 1499-1951) + `buildMergedStepsPayload` (line 264) + `bulkSaveCandidates` (line 983)**
- `startServiceScopedRun` is the closest blueprint for `startLibraryScopedRun`: clone → build context → tech-hints prompt → `executeLlmFileAnalysis(...)` → candidates → save.
- `buildMergedStepsPayload` is the read-merge-write pattern reused for hierarchical `library-scans` sub-row updates without clobbering the V3 sub-tree.

**`gitCloneRepoAccess` in `repoAccess.ts`**
- Reusable clone primitive. Wrap with `(projectId, repoUrl, branch)` cache key and 10-minute TTL for the preflight; the actual run reuses the cached dir if still warm. Existing `git clone --depth 1` to `os.tmpdir()/discovery-<runId>/<slug>` pattern is the model.

**`StartDiscoveryRunConfirmModal.tsx` (162 lines) + `.module.css`**
- Pattern source for `PreflightModal`: overlay div, click-outside + Escape close, header/content/footer, CSS module, `data-testid` on every interactive element. Spec 3's modal mirrors structure verbatim with the preflight-specific sections (root summary, internal libs list, external libs list, warnings, toggle).

**`ArchitectureCloneService` Service-side derived-AP creation**
- Pattern source for `LibraryService.findOrCreate(...)` derived-AP creation in the same transaction: when a new Library row is inserted, also insert the derived `ApplicationPoint` with `target_type='LIBRARY'`, `target_ref_id=<new id>`, `kind='LIBRARY'`. Return both ids in the response.

## Out of Scope
- Phase 2 ecosystems (Gradle, .NET, Go, Python).
- Per-library opt-out in the preflight modal (V1.1 if user feedback warrants).
- Mid-run abort.
- `commit_sha`-based skip-unchanged optimization for re-runs (V1 re-scans all internal libs).
- Live cloud / repository inventory.
- Test/dev/optional/peer/provided/optionalDependencies scope transitive walk (recorded as edges only — never enqueued).
- LLM-assisted dep classification (deterministic resolvers only V1).
- Maven property resolution (verbatim `${propname}` storage only V1).
- Maven version-range resolution (verbatim `[1.0,2.0)` string in `declared_version_range` only V1).
- npm scoped-package normalization (full `@scope/name` storage only V1).
- Persisted "Include external libraries" toggle preference (modal-session-only V1).
- Candidate-flow review path for Library / CodeUnitDependency (direct-write only V1 — Spec 3 deliberately bypasses the candidate review safety net for deterministic library writes).
- DB UNIQUE constraint on `(libraries.name, ecosystem)` (resolver-layer / find-or-create endpoint dedup is sufficient per Spec 1 scoping).
- Library-rooted runs that pre-resolve the entire repo dependency graph and offer a "scan everything reachable" option.
- New cellTypes (Spec 2's existing cellTypes are sufficient).
- Editing any applied Liquibase changeset in architecture-model-service (Spec 1's 122-124 are immutable per memory rule). Discovery-service's own DB migration for `library_id` column on `discovery_candidate` is a NEW changeset.
