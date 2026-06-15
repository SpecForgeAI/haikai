# Spec Requirements: Library Discovery Integration

## Initial Description

Spec 3 of 3 in the Library arc. Spec 1 (`agent-os/specs/2026-05-05-library-backend-foundation/`) landed the backend `LibraryEntity` + `CodeUnitDependencyEntity` + the `application_points.target_type` CHECK relax (changesets 122-124). Spec 2 (`agent-os/specs/2026-05-06-library-frontend-types-and-tables/`) added the frontend `Library`/`CodeUnitDependency` TS interfaces, `gridConfigs.libraries` + `gridConfigs.code_unit_dependencies`, the `ApplicationPointPickerCell` 6th-group / `applicationPointDerivation` 4th-arm extension, the `TechHintsCell` typing relaxation, and the carry-forward `relationshipDefinitions.test.ts` fix.

This spec integrates the Library concept with the discovery service so internal sibling-subfolder libraries are auto-discovered, scanned (transitively, capped), and recorded with their dependency edges. It adds the deterministic resolver layer, the repo-wide lookup table, the BFS transitive walker, the preflight modal, the right-click menu items, the hierarchical run-progress UX, and the 3 new architecture-model-service REST endpoints required to write Library / CodeUnitDependency rows directly during the walk and to read a single Library row by id for the LLM tech-hints flow on a Library-rooted scan.

The full raw idea is preserved at `agent-os/specs/2026-05-06-library-discovery-integration/planning/00-raw-idea.md`. Codebase grounding is preserved at `planning/codebase-grounding.md`.

## Requirements Discussion

### First Round Questions

**Q1: Library / CodeUnitDependency write authority — candidate flow vs net-new per-entity REST vs whole-model PUT?**
**Answer:** Option (b) — net-new per-entity REST endpoints in architecture-model-service. New `POST /api/model/projects/:p/architectures/:a/libraries` (find-or-create on `(model_file_id, name, ecosystem)`) and `POST /api/model/projects/:p/architectures/:a/code-unit-dependencies` (find-or-create on `(source_AP_id, target_AP_id, declared_name, declared_version)`). discovery-service calls these directly during the walk. Spec 1 deliberately scoped them out; this spec adds them as the discovery-service write path. Bypasses the candidate-review safety net deliberately — internal libraries are deterministic, name+ecosystem keyed, with no useful "review" step.

**Q2: Preflight endpoint design — separate endpoint vs `?preflight=true` query parameter on existing scan endpoint?**
**Answer:** Separate endpoints. `POST /api/v1/discovery/projects/:p/architectures/:a/services/:serviceId/preflight-library-scan` and equivalent `/libraries/:libraryId/preflight-library-scan`. Plan-only response. Never creates a `discovery_runs` row. Cleaner separation of concerns; preflight has no side-effects, no run lifecycle.

**Q3: Preflight latency vs clone cost — what to do about the 60s+ clone time on large remote repos?**
**Answer:** Option (i) — always clone, modal shows "Computing scan plan..." spinner during the clone. Cache the clone by `(projectId, repo URL, branch)`; the actual run reuses the cached directory if the clone is <N minutes old. No "fall back to scan-start computation" V1.

**Q4: "Include external libraries" toggle — per-modal-session, per-project preference (DB), or per-user (DB)?**
**Answer:** Per-modal-session V1, default ON. No DB persistence. Reset to ON every time the modal opens. V1.1 may persist if user feedback warrants.

**Q5: Library-rooted preflight — does discovery-service need a Library REST GET, or can it work whole-model?**
**Answer:** Option (a) — add `GET /api/model/projects/:p/architectures/:a/libraries/:libraryId` and `getLibrary()` in `discovery-service/src/services/archModelClient.ts`. Library-rooted runs are in scope; the LLM tech-hints flow for Library also requires this path because it needs to load `repo_location` / `core_tech` for the prompt snapshot.

**Q6: Hierarchical progress `steps_payload` shape — new sub-key vs nested under existing step?**
**Answer:** Confirmed. Extend the existing `service-scoped-llm-analysis` step entry with a sibling key `library-scans: [{libraryId, libraryName, depth, status: 'pending'|'running'|'completed'|'skipped-cycle'|'skipped-depth-cap', filesAnalyzed, candidateCount, error?}]`. Frontend renders these as indented sub-rows in the existing `phaseList` `<ul>` (line 643 of `DiscoveryRunDetailView.tsx`). No new transport, no SSE, no websockets — payload-shape extension only.

**Q7: Maven aggregator + npm workspaces — walk all manifests or only root?**
**Answer:** Confirmed. V1 walker walks ALL `pom.xml` and `package.json` files in the cloned repo; each contributes its own `(groupId, artifactId)` (Maven) or `name` (npm) to the per-ecosystem repo-wide lookup table. Multi-module Maven aggregators and npm workspaces work automatically — no aggregator-specific or workspace-specific code paths. Walker exclusions: `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`, plus the project-level `excludePaths` from existing run config.

**Q8: Maven properties / version ranges / npm scoped packages — normalise or store verbatim?**
**Answer:** Confirmed verbatim, no normalisation V1.
- Maven `${propname}` placeholders in `<version>` go into `declared_version` as the literal string `${propname}` (not resolved).
- Version ranges `[1.0,2.0)` go into `declared_version_range`, with `declared_version` left null.
- npm scoped packages `@scope/name` use the full scoped string as the lookup key — no stripping of `@scope/`.

### Inferred Decisions (all 17 accepted as-is)

These were inferred from the codebase grounding and accepted by the user without override:

1. **`DependencyResolverRegistry` mirrors `extensionPackRegistry.ts` pattern.** Module-load side-effect registration via a sibling `register.ts`, lookup by ecosystem string, no runtime mutation of the active set after startup. Surface: `registerDependencyResolver(resolver)`, `getDependencyResolver(ecosystem)`, `getRegisteredEcosystems()`, `clearRegistry()`.
2. **Per-resolver folder layout** mirrors language packs / framework packs: `discovery-service/src/services/dependencyResolvers/<ecosystem>/`. V1 has `maven/` (with `MavenDependencyResolver.ts`) and `npm/` (with `NpmDependencyResolver.ts`).
3. **Resolver interface shape** (locked contract): `DependencyResolver { getEcosystem(): 'MAVEN' | 'NPM' | string; findManifests(repoRoot: string): Promise<string[]>; resolve(repoRoot: string, manifestPath: string): Promise<DeclaredDependency[]> }`. `findManifests` is the per-resolver recursive walker (with the V1 exclusions baked in); `resolve` parses one manifest and returns its declared deps.
4. **`DeclaredDependency` shape** (locked contract): `{ name: string; version?: string; versionRange?: string; scope: string; manifestPath: string; manifestLine?: number }`. Maven `name` = `groupId:artifactId`; npm `name` = scoped or unscoped package string. `scope` is the resolver's per-ecosystem string (`compile`, `runtime`, `test`, `provided`, `optional` for Maven; `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` for npm).
5. **Repo-wide lookup table** is per-ecosystem and per-run. Built from a single recursive walk of the cloned repo at the start of the preflight (and reused for the actual run if the cached clone is still valid). Maven: `Map<groupId:artifactId, manifestRelativePath>`. npm: `Map<name, manifestRelativePath>` (workspace `package.json` files included). `manifestRelativePath` is relative to repo root; the parent directory of the manifest is the candidate Library `repo_subfolder`.
6. **Walker BFS shape** (locked contract): seed visited-set with the root Service / Library by id; queue starts with `{libraryRefId: <root>, manifestPath: <root manifest>, depth: 0}`. Each iteration: parse the manifest via the matching resolver; for each declared dep classify against the per-ecosystem repo-wide lookup table — internal-scannable, internal-unresolvable, or external; for internal-scannable + matching scope filter (Maven `compile`/`runtime` walked; npm `dependencies` walked; others recorded as edges only) + not-already-visited + depth+1 ≤ 5: find-or-create the Library row, enqueue. For internal-scannable but cycle / depth cap: record edge with `status='skipped-cycle'` or `status='skipped-depth-cap'`. For external: record Library + edge one-deep ONLY if "Include external libraries" toggle is ON. For internal-unresolvable: record as external Library with a warning. Visited-set keyed by `Library.id` after find-or-create. Depth cap = 5.
7. **Find-or-create Library**: discovery-service calls `POST /api/model/projects/:p/architectures/:a/libraries` with body `{name, ecosystem, repo_location?, repo_subfolder?, source_origin: 'DISCOVERED', last_verified_at: now()}`. Architecture-model-service `LibraryService.findOrCreate(...)` queries by `(model_file_id, name, ecosystem)`; returns existing row id if found, inserts new row + returns id if not.
8. **Find-or-create CodeUnitDependency**: discovery-service calls `POST /api/model/projects/:p/architectures/:a/code-unit-dependencies` with body `{source_application_point_id, target_application_point_id, declared_name, declared_version?, declared_version_range?, scope, manifest_path, manifest_line?, evidence_source: 'DISCOVERY_RESOLVER', confidence: 1.0}`. Architecture-model-service `CodeUnitDependencyService.findOrCreate(...)` queries by `(source_AP_id, target_AP_id, declared_name, declared_version)` (declared_version may be null); returns existing row id if found, inserts new row + returns id if not.
9. **ApplicationPoint derivation for the find-or-create call** is server-side in architecture-model-service — when `LibraryService.findOrCreate` inserts a new Library row, the same transaction also inserts a derived ApplicationPoint with `target_type='LIBRARY'`, `target_ref_id=<new library id>`, `kind='LIBRARY'`. Mirrors the existing Service-side derivation done by `ArchitectureCloneService` post-Spec-2. discovery-service receives both ids in the response so it can wire the dependency-edge endpoints correctly.
10. **`getLibrary()` in `archModelClient.ts`** mirrors existing `getService(...)`. Calls the new `GET /api/model/projects/:p/architectures/:a/libraries/:libraryId`. Used by Library-rooted preflight to read the root Library's `repo_location` / `repo_subfolder` and by the per-Library scan to feed the LLM tech-hints prompt.
11. **Preflight endpoint behaviour**: clones repo (or uses cached clone if `<N>` mins old, where `N` is a config constant default 10), builds the lookup table, runs the BFS walker against the root, returns the plan as JSON. Never creates a `discovery_runs` row. Returns `200 OK` with the plan body. Errors return `400`/`500` with structured error message. No write side-effects.
12. **Preflight response shape** (locked contract): `{ root: {id, name, repoLocation, repoSubfolder, ecosystem}, internalLibrariesToScan: [{libraryId, name, repoSubfolder, depth, status: 'new'|'re-scan'|'skipped-cycle'|'skipped-depth-cap'}], externalLibrariesToRecord: [{name, declaredCoordinates, scope}], warnings: [{type: 'cycle'|'depth-cap'|'unresolvable-internal', message: string, libraryName?: string}] }`. Ordered by BFS depth ascending; ties broken by `name` ascending.
13. **Library-scan endpoint**: new `POST /api/v1/discovery/projects/:p/architectures/:a/services/:serviceId/start-library-scan` and equivalent `/libraries/:libraryId/start-library-scan`. Body: `{includeExternal: boolean}`. Creates a `discovery_runs` row, fires `startLibraryScopedRun(...)` async, returns the runId immediately (mirrors existing service-scan POST behaviour). The `/start-discovery-run` endpoint without "library" in the name remains unchanged — that's the "(No Libraries)" path.
14. **`startLibraryScopedRun` orchestrator** is a new function in `runManager.ts` paralleling `startServiceScopedRun`. Builds the lookup table, walks BFS, and for each library to scan: invokes the existing `executeLlmFileAnalysis(...)` step against the library's repo subfolder; emits hierarchical `steps_payload` events with the library's `libraryId` / `depth` / `status`; wires resulting candidates' `service_id` to a synthetic-or-derived per-library scope (TBD: spec-writer determines whether `service_id` stays on candidates as the root-service id, or extends to a `library_id` field on candidates — out-of-spec for requirements; flagged for spec-writer).
15. **Right-click menu extension** in `frontend/src/components/Grid/GridRowContextMenu.tsx`: extend the existing `entityType === 'services'` branch with a second item `Start Discovery Run (No Libraries)`; add a new `entityType === 'libraries'` branch with the same 2 items. Wire 2 new handler props on the component: `onStartLibraryScan(entity)` and `onStartScanNoLibraries(entity)`. Keep the existing `onStartDiscoveryRun(entity)` prop renamed/aliased to `onStartLibraryScan` (the default flow now goes through preflight). Grid.tsx updates the props it passes to `GridRowContextMenu`.
16. **`PreflightModal` component** at `frontend/src/components/Grid/PreflightModal.tsx` (+ `PreflightModal.module.css`) mirrors `StartDiscoveryRunConfirmModal.tsx` styling and structure: overlay div, click-outside + Escape close, header/content/footer, `data-testid` on every interactive element. Content: root summary panel, internal-libs-to-scan list (ordered by depth, status badge), external-libs-to-record list (collapsed-by-default if >10), warnings panel, "Include external libraries" toggle (default ON, modal-session-only state), `Run` / `Cancel` buttons. While preflight is computing: full-modal-area "Computing scan plan..." spinner.
17. **`gatewayClient.ts` extensions**: 4 new helper functions — `previewLibraryScanForService(projectId, archId, serviceId)`, `previewLibraryScanForLibrary(projectId, archId, libraryId)`, `startLibraryScanForService(projectId, archId, serviceId, includeExternal)`, `startLibraryScanForLibrary(projectId, archId, libraryId, includeExternal)`. Each builds the gateway URL `${GATEWAY_BASE}/api/v1/discovery/projects/:p/architectures/:a/...` and POSTs the JSON body. Errors thrown on non-2xx as in the existing `startDiscoveryRun` helper.

### Existing Code to Reference

The codebase grounding identified the following reference points; all are read-only references for the spec-writer (this requirements pass does not direct any source edits):

- **discovery-service**:
  - `discovery-service/src/services/extensionPackRegistry.ts` (262 lines) — registry pattern model for `DependencyResolverRegistry`.
  - `discovery-service/src/services/extensionPacks/register.ts` — module-load side-effect registration pattern.
  - `discovery-service/src/services/runManager.ts:1052` (`startRun`), `:1499` (`startServiceScopedRun`), `:264` (`buildMergedStepsPayload`), `:983` (`bulkSaveCandidates`) — orchestrator + steps_payload merge pattern.
  - `discovery-service/src/services/repoAccess.ts` — `gitCloneRepoAccess` clone pattern; reusable cached clone for preflight + run.
  - `discovery-service/src/services/techHintsResolver.ts:139-210` (`buildSnapshot`) — repo-root-only walker; the Spec 3 walker is net-new and recursive, with the V1 exclusions list.
  - `discovery-service/src/utils/runLogger.ts:62` (`logRunEvent`) — structured event emission for debug log.
  - `discovery-service/src/services/archModelClient.ts` — `fetchService(...)` pattern; `getLibrary(...)` is parallel.
  - `discovery-service/src/routes/runs.ts:158` — POST handler pattern; new preflight + library-scan routes parallel.
  - `discovery-service/src/routes/index.ts` — routes barrel; new endpoints registered here.
  - `discovery-service/src/types/candidate.ts:58` — `CandidateType` union; NOT extended in V1 (Q1 chose direct-write, not candidate flow).

- **architecture-model-service**:
  - `architecture-model-service/src/main/java/.../controller/ModelController.java:131` (`saveModel`) — existing whole-model PUT controller; the 3 new endpoints are net-new sibling controllers/services.
  - `architecture-model-service/src/main/java/.../repository/entity/LibraryRepository.java` (verified) — currently has only `findByModelFileId` and `deleteByModelFileId`. **No `(name, ecosystem)` finder method exists yet — this is a small backend addition for this spec.**
  - `architecture-model-service/src/main/java/.../repository/relationship/CodeUnitDependencyRepository.java` (verified) — currently has only `findByModelFileId` and `deleteByModelFileId`. **No `(source_AP_id, target_AP_id, declared_name, declared_version)` finder method exists yet — this is a small backend addition for this spec.**
  - `architecture-model-service/src/main/java/.../service/ArchitectureCloneService.java` — Service-side derived-AP creation pattern; new `LibraryService.findOrCreate(...)` derives the AP in the same transaction following this pattern.
  - Spec 1 `LibraryEntity` / `CodeUnitDependencyEntity` / `LibraryDto` / `CodeUnitDependencyDto` — DTO + entity shapes already locked.

- **gateway**:
  - `gateway/src/routes/discovery.ts` — existing 18-route discovery router; 4 new routes added (2 preflight + 2 library-scan, one each for Service/Library root).
  - `gateway/src/server.ts` — discovery router mount point at `/api/v1/discovery`.

- **frontend**:
  - `frontend/src/components/Grid/StartDiscoveryRunConfirmModal.tsx` (162 lines) + `.module.css` — pattern for `PreflightModal`.
  - `frontend/src/components/Grid/GridRowContextMenu.tsx` — entity-type-keyed right-click menu; extension targets documented in codebase grounding §4.1.
  - `frontend/src/components/Grid/Grid.tsx:586` (`handleStartDiscoveryRunFromMenu`), `:957` (`onContextMenu`), `:986-996` (`<GridRowContextMenu>`) — wiring points for new handler props.
  - `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx:421` (`phaseEntries`), `:643` (`<ul styles.phaseList>`) — flat-list rendering; extension targets for hierarchical sub-rows.
  - `frontend/src/services/gatewayClient.ts:177` — gateway URL builder pattern; existing `startDiscoveryRun` helper as the model for 4 new helpers.

### Follow-up Questions

No follow-up questions were required. The user provided concrete answers on all 8 open questions and accepted all 17 inferred decisions. The post-answer verification of `LibraryRepository` / `CodeUnitDependencyRepository` confirmed the `(name, ecosystem)` and `(source_AP_id, target_AP_id, declared_name, declared_version)` finder methods are NOT yet present — they are a small backend addition for this spec.

## Visual Assets

### Files Provided

Bash check on `agent-os/specs/2026-05-06-library-discovery-integration/planning/visuals/` returned no image/PDF files.

No visual assets provided.

### Visual Insights

N/A — backend resolver + walker + 3 new REST endpoints + new modal + extended right-click menu + extended progress-payload rendering. Reference UX is the existing `StartDiscoveryRunConfirmModal` for the modal shell pattern, the existing `DiscoveryRunDetailView` `phaseList` flat list for the hierarchical-sub-rows extension target, and the existing `GridRowContextMenu` for the right-click menu extension target.

## Requirements Summary

### 3-Service Change Surface

#### A. architecture-model-service (new endpoints — additive; Spec 1 unchanged)

3 net-new REST endpoints + supporting service-layer find-or-create logic + 2 new repository finder methods:

1. **`POST /api/model/projects/:projectId/architectures/:architectureId/libraries`** — find-or-create on `(model_file_id, name, ecosystem)`. Body: `{name, ecosystem, repo_location?, repo_subfolder?, source_origin?, last_verified_at?, ...}`. Response: `{id, derivedApplicationPointId, created: boolean, library: LibraryDto}`. When `created=true`, the same transaction inserts the derived ApplicationPoint with `target_type='LIBRARY'`.
2. **`POST /api/model/projects/:projectId/architectures/:architectureId/code-unit-dependencies`** — find-or-create on `(source_application_point_id, target_application_point_id, declared_name, declared_version)`. Body: `{source_application_point_id, target_application_point_id, declared_name, declared_version?, declared_version_range?, scope, manifest_path, manifest_line?, evidence_source?, confidence?}`. Response: `{id, created: boolean, codeUnitDependency: CodeUnitDependencyDto}`.
3. **`GET /api/model/projects/:projectId/architectures/:architectureId/libraries/:libraryId`** — single Library row by id. Response: `LibraryDto` or 404.

Supporting changes:
- New `LibraryService.findOrCreate(...)` and `LibraryService.findById(...)` methods.
- New `CodeUnitDependencyService.findOrCreate(...)` method.
- `LibraryRepository`: add `Optional<LibraryEntity> findByModelFileIdAndNameAndEcosystem(String modelFileId, String name, String ecosystem)`.
- `CodeUnitDependencyRepository`: add `Optional<CodeUnitDependencyEntity> findBySourceApplicationPointIdAndTargetApplicationPointIdAndDeclaredNameAndDeclaredVersion(String sourceApId, String targetApId, String declaredName, String declaredVersion)` (with null-tolerance for `declaredVersion`).
- New 3 controller-method bodies in a new `LibraryController` and `CodeUnitDependencyController` (or extend `ModelController`; spec-writer's call).
- Integration tests for each new endpoint.

#### B. discovery-service (resolver + walker + 2 new endpoints + 1 archModelClient method)

- **`DependencyResolverRegistry` (NEW)** at `discovery-service/src/services/dependencyResolverRegistry.ts` — module-load registration mirror of `extensionPackRegistry.ts`.
- **`MavenDependencyResolver` (NEW)** at `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` — `findManifests(repoRoot)` recursively walks all `pom.xml` files (with V1 exclusions); `resolve(repoRoot, manifestPath)` parses one pom XML and returns `DeclaredDependency[]`. Stores `${propname}` placeholders verbatim in `version`; stores `[1.0,2.0)` ranges in `versionRange`.
- **`NpmDependencyResolver` (NEW)** at `discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts` — `findManifests(repoRoot)` recursively walks all `package.json` files (with V1 exclusions including `node_modules/`); `resolve(repoRoot, manifestPath)` parses one package.json and returns `DeclaredDependency[]`. Scoped packages (`@scope/name`) use the full scoped string as `name`.
- **Repo-wide lookup table builder (NEW)** at `discovery-service/src/services/repoLookupTableBuilder.ts` — builds per-ecosystem `Map<key, manifestRelativePath>` once per preflight/run.
- **BFS transitive walker (NEW)** at `discovery-service/src/services/transitiveDependencyWalker.ts` — visited-set, depth cap 5, cycle detection, scope filtering (Maven `compile`/`runtime` walked; npm `dependencies` walked; others edge-only).
- **Preflight endpoints (NEW)**:
  - `POST /preflight-library-scan` (Service root) at `discovery-service/src/routes/preflightLibraryScan.ts`.
  - `POST /preflight-library-scan` (Library root) at the same router.
- **Library-scan endpoints (NEW)**:
  - `POST /start-library-scan` (Service root).
  - `POST /start-library-scan` (Library root).
- **`startLibraryScopedRun` (NEW)** in `runManager.ts` paralleling `startServiceScopedRun`. Iterates the BFS plan; per-library invokes existing `executeLlmFileAnalysis(...)`; emits hierarchical `steps_payload` events.
- **Hierarchical `steps_payload` events** — extend the existing `service-scoped-llm-analysis` step entry with sibling key `library-scans: [{libraryId, libraryName, depth, status, filesAnalyzed, candidateCount, error?}]`. Re-merge via `buildMergedStepsPayload(...)` for each sub-row update.
- **`getLibrary()` (NEW)** in `discovery-service/src/services/archModelClient.ts` — calls `GET /api/model/projects/:p/architectures/:a/libraries/:libraryId`.
- **Direct-write client calls** — discovery-service calls the 2 new `POST` endpoints in architecture-model-service from inside the walker (find-or-create Library) and after each declared-dep classification (find-or-create CodeUnitDependency). No candidate-flow path for Library/CodeUnitDependency.
- **Cached clone reuse** — preflight clones to `os.tmpdir()/discovery-preflight-<projectId>-<repoUrlSlug>-<branch>/`; cache TTL constant default 10 minutes; same-tuple subsequent preflight reuses; `start-library-scan` reuses the same cached clone if still warm, otherwise re-clones into the run's `discovery-<runId>/` dir.

#### C. frontend (modal + menu + progress-row extension + 4 new client helpers)

- **`PreflightModal` component (NEW)** at `frontend/src/components/Grid/PreflightModal.tsx` + `PreflightModal.module.css` — mirrors `StartDiscoveryRunConfirmModal` styling; renders root + internal-libs + external-libs + warnings + toggle (default ON, session-only).
- **`GridRowContextMenu` extended** — 2 new menu items each on Service rows + Library rows: `Start Discovery Run` (default → preflight) and `Start Discovery Run (No Libraries)` (skip preflight). Library-row branch is net-new.
- **`DiscoveryRunDetailView` extended** — `phaseList` rendering reads the new `library-scans` sub-key under `service-scoped-llm-analysis` and renders indented sub-rows hierarchically; per-row status badge mirrors the existing per-step status pattern. Pending counter at top decrements as each library completes.
- **`gatewayClient.ts` extended** — 4 new helpers: `previewLibraryScanForService`, `previewLibraryScanForLibrary`, `startLibraryScanForService`, `startLibraryScanForLibrary`.
- **Grid.tsx wiring** — pass 2 new handler props (`onStartLibraryScan`, `onStartScanNoLibraries`) to `GridRowContextMenu`. Open `PreflightModal` from the default handler; on confirm, fire the gateway-client helper.
- **Tests** — Vitest unit test for `PreflightModal` rendering / toggle behaviour; Vitest test for `GridRowContextMenu` Library-row branch; assertion test for `DiscoveryRunDetailView` rendering library-scan sub-rows.

#### D. gateway (route additions only)

- **2 new route blocks** in `gateway/src/routes/discovery.ts`:
  - `POST /projects/:p/architectures/:a/services/:serviceId/preflight-library-scan` and `/libraries/:libraryId/preflight-library-scan` (forward to discovery-service).
  - `POST /projects/:p/architectures/:a/services/:serviceId/start-library-scan` and `/libraries/:libraryId/start-library-scan` (forward to discovery-service).
- Mount under existing `/api/v1/discovery` prefix.
- No body-size limit changes needed (preflight response well within Express default).

### Resolver Shape (Locked Contract)

```ts
// discovery-service/src/services/dependencyResolvers/types.ts (NEW)

export interface DeclaredDependency {
  name: string;              // Maven: "groupId:artifactId"; npm: "name" or "@scope/name"
  version?: string;          // verbatim; may include ${propname} for Maven
  versionRange?: string;     // verbatim Maven range "[1.0,2.0)"; null for npm V1
  scope: string;             // Maven: compile|runtime|test|provided|optional; npm: dependencies|devDependencies|peerDependencies|optionalDependencies
  manifestPath: string;      // relative to repo root
  manifestLine?: number;     // 1-based; resolver-best-effort
}

export interface DependencyResolver {
  getEcosystem(): 'MAVEN' | 'NPM' | string;
  findManifests(repoRoot: string): Promise<string[]>;
  resolve(repoRoot: string, manifestPath: string): Promise<DeclaredDependency[]>;
}
```

### Walker Shape (Locked Contract)

BFS from the root Service/Library. Visited-set keyed by `Library.id` (or root Service id) after find-or-create. Depth cap 5. Cycle detection via visited-set. Scope filtering — Maven `compile`/`runtime` walked transitively; npm `dependencies` walked transitively; all others recorded as edges only (never enqueued).

Per-iteration:
1. Pop `{libraryRefId, manifestPath, depth}` from queue.
2. For the matching ecosystem, call `resolver.resolve(repoRoot, manifestPath)`.
3. For each `DeclaredDependency`:
   - Classify against per-ecosystem repo-wide lookup table:
     - **Internal scannable**: name found in lookup table → find-or-create Library (with `repo_location`/`repo_subfolder` set), find-or-create edge, mark `status='new'` or `status='re-scan'`. If scope is in walked-set AND not visited AND depth+1 ≤ 5: enqueue. If cycle: record edge, status `'skipped-cycle'`. If depth cap: record edge, status `'skipped-depth-cap'`.
     - **External**: name NOT found in lookup table → if "Include external libraries" toggle ON, find-or-create Library (one-deep, no `repo_subfolder`) + find-or-create edge. If toggle OFF: skip (no Library row, no edge).
     - **Internal unresolvable**: per warning-emission rule — emit a `'unresolvable-internal'` warning AND record as external (if toggle ON).
4. Repeat until queue empty.

### Preflight Response Shape (Locked Contract)

```ts
{
  root: {
    id: string;
    name: string;
    repoLocation: string;
    repoSubfolder: string;
    ecosystem: string;
    type: 'service' | 'library';
  },
  internalLibrariesToScan: [
    {
      libraryId: string;            // resolved find-or-create id (preflight performs find only — no insert)
      name: string;
      repoSubfolder: string;
      depth: number;
      status: 'new' | 're-scan' | 'skipped-cycle' | 'skipped-depth-cap';
    }
  ],
  externalLibrariesToRecord: [
    {
      name: string;
      declaredCoordinates: string;   // e.g. "com.fasterxml.jackson.core:jackson-databind@2.15.3"
      scope: string;
    }
  ],
  warnings: [
    {
      type: 'cycle' | 'depth-cap' | 'unresolvable-internal';
      message: string;
      libraryName?: string;
    }
  ],
}
```

Ordered by BFS depth ascending; ties broken by `name` ascending.

**Important**: preflight is read-only — it does NOT write Library or CodeUnitDependency rows. It performs lookups only (the `find` half of find-or-create). The resolved `libraryId` for an existing internal Library is real; for a "new" Library that does not exist yet, `libraryId` is the synthetic id the actual run will create with (the spec-writer can decide whether to use a deterministic `(name, ecosystem)` hash or to leave `libraryId: null` and resolve on the actual run).

### File Touch Summary (estimated)

| Service | Count | Files |
|---|---|---|
| **architecture-model-service** | ~6 | New `LibraryController.java`, new `CodeUnitDependencyController.java` (or extensions to `ModelController.java`); new `LibraryService.java` methods (`findOrCreate`, `findById`); new `CodeUnitDependencyService.java` methods (`findOrCreate`); `LibraryRepository.java` (1 new finder method); `CodeUnitDependencyRepository.java` (1 new finder method); 2-3 new integration tests. |
| **discovery-service** | ~5 (excluding 2 resolvers + types) | New `dependencyResolverRegistry.ts`; new `dependencyResolvers/maven/MavenDependencyResolver.ts`; new `dependencyResolvers/npm/NpmDependencyResolver.ts`; new `dependencyResolvers/types.ts`; new `dependencyResolvers/register.ts`; new `repoLookupTableBuilder.ts`; new `transitiveDependencyWalker.ts`; new `routes/preflightLibraryScan.ts`; new `routes/startLibraryScan.ts`; `routes/index.ts` (registration); `runManager.ts` (`startLibraryScopedRun` + steps_payload extension); `archModelClient.ts` (`getLibrary`, `findOrCreateLibrary`, `findOrCreateCodeUnitDependency`); fixture-based unit tests for resolvers + walker + lookup table; 1-2 integration tests. |
| **frontend** | ~7 | New `PreflightModal.tsx` + `.module.css`; `GridRowContextMenu.tsx` (Library branch + 2 new items); `Grid.tsx` (handler wiring); `DiscoveryRunDetailView.tsx` (hierarchical sub-row rendering); `gatewayClient.ts` (4 new helpers); 1-2 new Vitest tests. |
| **gateway** | ~2 | `routes/discovery.ts` (4 new routes); `server.ts` (no change — existing mount works). 1 new gateway test for the new routes. |

### Acceptance Criteria

(Combined raw-idea list + answered-questions decisions; preserved verbatim where possible.)

- "Start Discovery Run" right-click menu item exists on Service rows AND Library rows; both produce a preflight modal.
- "Start Discovery Run (No Libraries)" right-click menu item exists on the same rows; bypasses preflight, scans only the root.
- Preflight modal shows root + internal libs (with depth, status) + external libs (toggle-controlled) + warnings.
- Preflight modal shows "Computing scan plan..." spinner while clone + lookup-table build is in progress.
- "Include external libraries" toggle defaults ON inside the modal; modal-session-only state (no DB).
- Run button executes the deterministic plan: internal libs scanned transitively (BFS, cap 5, cycle-detected), external libs recorded one-deep (no drilling) only if toggle was ON.
- Library rows are find-or-create on `(model_file_id, name, ecosystem)` via the new `POST /libraries` endpoint; transient duplicates resolved at the architecture-model-service layer.
- `code_unit_dependencies` edges find-or-create on `(source AP, target AP, declared_name, declared_version)` via the new `POST /code-unit-dependencies` endpoint.
- New `LibraryService.findOrCreate` derives the `target_type='LIBRARY'` ApplicationPoint in the same transaction as the new Library row.
- **`GET /api/model/projects/:p/architectures/:a/libraries/:libraryId` endpoint exposed; `archModelClient.getLibrary()` calls it.**
- Maven and npm resolvers cover their respective manifests; tests cover fixture pom.xml and package.json files. Maven aggregator multi-module repos and npm workspace repos are walked correctly via the per-resolver `findManifests` recursion.
- Maven `${propname}` placeholders stored verbatim in `declared_version`; ranges `[1.0,2.0)` stored verbatim in `declared_version_range`; npm scoped packages stored as full `@scope/name`.
- Existing single-service scan behaviour (no libraries) remains as the `(No Libraries)` path; no regression.
- Library-rooted runs work (right-click on Library row → preflight against that library's manifest if internal scannable); uses the new `getLibrary()` to fetch the root row.
- LLM tech-hints flow runs for Library rows the same as Service rows. Per-Library scan invokes `executeLlmFileAnalysis(...)` with the library's `repo_subfolder`.
- Hierarchical progress UI in the existing run panel: root + indented library sub-rows + pending counter; status badge for `pending`/`running`/`completed`/`skipped-cycle`/`skipped-depth-cap`. Polling-based — no transport changes.
- Re-runs re-scan all internal libs (V1).
- No mid-run abort.
- Preflight clone is cached by `(projectId, repo URL, branch)` for default 10 minutes; the actual run reuses the cached directory if still warm.
- Phase 2 ecosystems (Gradle, .NET, Go, Python) are out of scope.
- Walker exclusions: `node_modules/`, `target/`, `build/`, `dist/`, `out/`, `.git/`, `.gradle/`, plus project-level `excludePaths`.

### Out of Scope (raw-idea exclusions preserved)

- Phase 2 ecosystems: Gradle, .NET, Go, Python.
- Per-library opt-out in the preflight modal (UI complexity; V1.1 if needed).
- Mid-run abort.
- Commit_sha-based skip-unchanged optimization for re-runs.
- Live cloud / repository inventory.
- Test/dev/optional scope transitive walk (recorded as edges but NOT followed).
- Library-rooted runs that pre-resolve the entire repo dependency graph and offer a "scan everything reachable" option.
- LLM-assisted dep classification (deterministic only V1).
- Maven property resolution (verbatim `${propname}` storage only V1).
- Maven version-range resolution (verbatim range string storage only V1).
- npm scoped-package normalization (full `@scope/name` storage only V1).
- Persisted "Include external libraries" toggle preference (modal-session-only V1).
- Candidate-flow review path for Library / CodeUnitDependency (Q1: direct-write only V1).
- New cellType creation (existing cellTypes from Spec 2 are sufficient).
- DB UNIQUE constraint on `(libraries.name, ecosystem)` — Spec 1 deliberately scoped this out; resolver-layer dedup is sufficient because the new endpoint enforces find-before-create.

### Reusability Opportunities

- **`extensionPackRegistry.ts`** — registry pattern for `DependencyResolverRegistry`.
- **`gitCloneRepoAccess`** — clone caching reusable for both preflight and actual run.
- **`StartDiscoveryRunConfirmModal.tsx`** — modal shell pattern for `PreflightModal`.
- **`GridRowContextMenu` entity-type-keyed branching** — already supports the pattern; just adds a `'libraries'` branch.
- **`DiscoveryRunDetailView` `phaseList`** — flat-list rendering; hierarchical sub-rows are a small render-extension on the existing structure.
- **`buildMergedStepsPayload(...)`** — read-merge-write pattern reusable for hierarchical sub-row updates.
- **`startServiceScopedRun`** — closest blueprint for `startLibraryScopedRun`.
- **`ArchitectureCloneService` Service-side derived-AP creation** — pattern for `LibraryService.findOrCreate` derived-AP creation.
- **Existing `tech_hints_cell` flow** (post-Spec-2) — works for Library rows once `getLibrary()` is added; the LLM resolver path itself is row-id-keyed and entity-agnostic.

### Technical Considerations

- **Locked field contract** — `DeclaredDependency` shape is the single source of truth for resolver output. New resolvers in Phase 2 (Gradle / .NET / Go / Python) will conform to the same shape.
- **No DB schema changes in this spec** — Spec 1's tables already cover everything. The 3 new endpoints + 2 new repository methods + 2-3 new service methods are pure additions on top of Spec 1's schema.
- **`LibraryRepository` and `CodeUnitDependencyRepository` finder methods are new in this spec** — Spec 1 deliberately did not add them (the find-or-create pattern was identified as Spec 3 territory). The 2 new finder methods are small mechanical additions.
- **Preflight is side-effect-free** — no `discovery_runs` row, no Library inserts. Synthetic `libraryId` for "new" libraries can be either deterministic-hash or null (spec-writer's call).
- **Hierarchical progress is payload-shape only** — no SSE, no websockets, no new transport. The existing poll-based `DiscoveryRunDetailView` extension is mechanical.
- **Scope filtering enforcement** — Maven `compile`/`runtime` walked; npm `dependencies` walked. All others recorded as edges only. Test/dev/optional/provided edges are visible in the model but never trigger transitive scans.
- **Cycle detection edge case** — when a library at depth N declares a dependency on a library at depth M < N that has already been visited, the edge is recorded with `status='skipped-cycle'`. The Library and AP rows are find-or-created (already exist from the earlier visit); only the new edge is added.
- **Depth-cap edge case** — when a library at depth 5 declares internal-scannable dependencies, edges are recorded with `status='skipped-depth-cap'`. Library + AP rows are find-or-created (the dependency target is materialized; only the recursive walk is cut off).
- **`evidence_source` on edges** — discovery-resolver-emitted edges set `evidence_source: 'DISCOVERY_RESOLVER'`. Manual-entry edges (from the grid UI in Spec 2) set whatever the user picks (typically `'MANUAL'` or empty). The find-or-create endpoint accepts either.
- **`source_origin` on Library** — discovery-resolver-emitted Libraries set `source_origin: 'DISCOVERED'`. Manual-entry Libraries (from the grid UI) set `'MANUAL'` or whatever the user picks. The find-or-create endpoint accepts either; on subsequent re-discovery of a manually-created Library, `source_origin` is NOT overwritten (the find half hits and the resolver does NOT update fields V1).
- **`last_verified_at` on Library** — set to `now()` on every find-or-create call (whether find or create branch hits) so the discovery-touch timestamp tracks freshness.
- **Architecture-model-service write authority** — the 3 new endpoints are net-new entity REST surface that did not exist before. Spec 1 deliberately scoped them out. Adding them in this spec is the right place because they exist solely to support discovery-service's direct-write flow; the whole-model PUT remains untouched as the canonical bulk-save path.
- **Per-resolver test fixtures** — fixture repos under `discovery-service/src/__tests__/fixtures/dependencyResolvers/` (or similar): a multi-module Maven repo, a npm workspace repo, edge-case fixtures (property placeholders, version ranges, scoped packages, dev/peer dependencies).

## Verification Pass — `LibraryRepository` finder methods

Live read of `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/LibraryRepository.java` and `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/CodeUnitDependencyRepository.java`:

| Repository | `findByModelFileId` | `deleteByModelFileId` | Find-or-create finder | Status |
|---|---|---|---|---|
| `LibraryRepository` | yes | yes | NO `findByModelFileIdAndNameAndEcosystem` | **Must be added in this spec** |
| `CodeUnitDependencyRepository` | yes | yes | NO `findBySourceApplicationPointIdAndTargetApplicationPointIdAndDeclaredNameAndDeclaredVersion` | **Must be added in this spec** |

Both finder methods are small mechanical additions and are listed as a tracked change under §A (architecture-model-service) above. Spec 1 deliberately left identity-deduplication for Spec 3 (per spec-1's "no DB UNIQUE on `(libraries.name, ecosystem)` — identity deduplication is resolver-layer in Spec 3"). The find-or-create endpoint enforces uniqueness at the application layer via these new finder methods + transactional insert.
