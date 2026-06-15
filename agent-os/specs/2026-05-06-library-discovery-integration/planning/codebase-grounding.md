# Codebase grounding — Library Discovery Integration (Spec 3 of 3)

Pass A grounding produced 2026-05-04 before the Pass B clarifying questions. Captures the
file-paths and shapes the new spec must integrate with, and flags genuine carry-forward issues.

---

## 1. Prior Library specs (locked contract)

- **Spec 1** `agent-os/specs/2026-05-05-library-backend-foundation/spec.md`
  - `libraries` table (changeset 122), `code_unit_dependencies` table (changeset 123),
    `application_points.target_type` CHECK relax (changeset 124).
  - JPA entities `LibraryEntity`, `CodeUnitDependencyEntity`; DTOs `LibraryDto`,
    `CodeUnitDependencyDto`; repositories `LibraryRepository`, `CodeUnitDependencyRepository`
    with only `findByModelFileId` / `deleteByModelFileId`.
  - **No per-entity REST controller for Library or CodeUnitDependency**. The save path is
    the whole-model `PUT /api/model` via `ModelController.saveModel(...)`. Confirmed in
    `architecture-model-service/src/main/java/.../controller/ModelController.java:131`.
  - Spec-1 explicitly declines any DB UNIQUE on `(libraries.name, ecosystem)` — identity
    deduplication is "resolver-layer in Spec 3".

- **Spec 2** `agent-os/specs/2026-05-06-library-frontend-types-and-tables/spec.md`
  - Frontend `Library` interface, `CodeUnitDependency` relationship, `gridConfigs.libraries`,
    `gridConfigs.code_unit_dependencies`, picker/derivation/formatter wiring,
    `TechHintsCell` typing relaxation.
  - `applicationPointDerivation.ts` extended with `'LIBRARY'` branch.
  - **No right-click menu wiring for Library rows in Spec 2** — Spec 2 is pure
    types + tables + cell extensions. Right-click items must be added in Spec 3.

---

## 2. discovery-service deep-dive

### 2.1 Pack registry pattern (model for `DependencyResolverRegistry`)

- File: `discovery-service/src/services/extensionPackRegistry.ts` (262 lines).
- Sibling registration file: `discovery-service/src/services/extensionPacks/register.ts`
  — module-load side-effect import that calls `registerLanguagePack(pack)` /
  `registerFrameworkPack(pack)` for each pack.
- Per-pack folders: `discovery-service/src/services/extensionPacks/languagePacks/<id>/`,
  `discovery-service/src/services/extensionPacks/frameworkPacks/<id>/`.
- Registry surface: `registerLanguagePack`, `registerFrameworkPack`, `findLanguagePack`,
  `findFrameworkPacks`, `getLanguagePackById`, `getFrameworkPackById`, `clearRegistry`,
  `getRegisteredPackCount`, `getRegisteredPacks`, `matchesPredicate`, `computeTier`.
- The new `DependencyResolverRegistry` should mirror this structure — module-load
  registration, lookup-by-ecosystem, no runtime mutation of the active set after startup.

### 2.2 Existing single-service scan flow (entry → orchestrator → manifest snapshot)

- Routes barrel: `discovery-service/src/routes/index.ts`. Run lifecycle endpoints mounted at
  `/discovery/projects/:projectId/architectures/:architectureId/runs`.
- POST handler: `discovery-service/src/routes/runs.ts:158` —
  `runsRouter.post('/', async (req, res) => ...)`. Body: `{ serviceId?, confirmLlmSolo? }`.
  Tier C gate fires here BEFORE any archmodel call (`LLM_SOLO_CONFIRMATION_REQUIRED`).
  Successful POST returns immediately and `startRun(...)` is fired async.
- Top-level orchestrator: `runManager.ts:1052` `export async function startRun(...)`.
  When `serviceId` is set it delegates to `startServiceScopedRun(...)` (line 1499).
- Service-scoped pipeline (`startServiceScopedRun`, lines 1499-1951):
  fetch service → validate `repo_location` → clone or use local → build service context →
  build `techHints` from resolved columns → fetch existing atoms/relationships from prior runs →
  call `executeLlmFileAnalysis(...)` (single LLM step `service-scoped-llm-analysis`) →
  populate `service_id` on all candidates → sort parents-first → `bulkSaveCandidates`.
- **No manifest-parsing step in the existing scan flow.** `techHintsResolver.ts` peeks at
  manifest *content* for the LLM prompt (`buildSnapshot`, lines 139-210) but only as
  free-text snapshot input — it does not parse `<dependency>` / `dependencies` structurally.
  The new resolvers are net-new code with no existing dependency-parser to reuse.
- Repo access: `discovery-service/src/services/repoAccess.ts` — `gitCloneRepoAccess` clones
  via `git clone --depth 1` to `os.tmpdir()/discovery-<runId>/<slug>`. The same
  `repoDir` path can be reused by a new repo-wide manifest walker.

### 2.3 Run progress mechanism

- Progress is encoded in the `discovery_runs.steps_payload` JSONB column on the run row,
  written by the run manager via `archModelClient.updateDiscoveryRun(...)`.
- Read-merge-write helper: `runManager.ts:264` `buildMergedStepsPayload(...)` — re-fetches
  the persisted `steps_payload` immediately before each write to avoid clobbering the
  V3 sub-tree (`v3.gapFill`) that other code paths write.
- Frontend reads the same row by polling `GET .../runs/:runId` and rendering keys of
  `steps_payload` as a flat list:
  `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx:421`
  (`phaseEntries`) and `:643` (`<ul styles.phaseList>`).
- **There is NO websocket / SSE — progress is poll-based.** The existing detail view
  re-fetches via the existing list-runs hook on `Refresh`. To add hierarchical sub-rows,
  the frontend reads structured sub-keys we add inside `steps_payload`, no transport change.
- Structured log emission: `discovery-service/src/utils/runLogger.ts:62` `logRunEvent(...)`.
  Single console.log line of JSON; events are `step_start | step_complete | step_failed |
  run_complete | run_failed | run_resume`. Event log is used for debugging only — the
  frontend does NOT read it.

### 2.4 Where Library/CodeUnitDependency writes can land — three architectural options

discovery-service today writes ONE thing: `DiscoveryCandidate` rows via
`archModelClient.bulkSaveCandidates(...)` (line 983). Candidates land in a separate
`discovery_candidate` table — they are **never** committed to entity tables until the
user clicks "Save All Approved", which proxies to mcp-server's `save_approved_candidates`
tool (gateway `discovery.ts:1435` → mcp-server `saveApprovedCandidatesRoute.ts:12`).

Three options for Library/CodeUnitDependency writes:

- **(a) Candidate flow.** Add `'library'` and `'code_unit_dependency'` to `CandidateType`
  (`discovery-service/src/types/candidate.ts:58`); discovery emits library candidates;
  mcp-server's `save_approved_candidates` learns to materialize them as `LibraryDto` /
  `CodeUnitDependencyDto` rows during whole-model save. **Pro:** consistent with existing
  flow, user reviews before commit. **Con:** Internal libraries have no useful "review"
  step — they are deterministic, name+ecosystem keyed. Forces user to click through.
  Spec-3 acceptance criteria says "Library rows are find-or-create on `(model_file_id,
  name, ecosystem)`; transient duplicates resolved by resolver" — which sounds more like
  direct-write than candidate-review.

- **(b) Direct write via new architecture-model-service endpoints.** Add a per-Library
  POST/PUT controller (`POST /api/model/projects/:p/architectures/:a/libraries`) for
  find-or-create, and same for `code_unit_dependencies`. discovery-service calls these
  immediately during the scan walk. **Pro:** matches "find-or-create" language in raw idea.
  **Con:** Net-new entity REST surface in architecture-model-service (Spec 1 deliberately
  did not add one). Bypasses the candidate-review safety net.

- **(c) Whole-model PUT via existing endpoint.** discovery-service fetches the whole
  meta-model, mutates `entities.libraries` / `relationships.code_unit_dependencies`,
  PUTs back. **Con:** Massive payload; race conditions vs. concurrent UI edits;
  whole-file optimistic-concurrency model is ill-suited for incremental discovery.

The raw idea's "writes via the architecture-model-service API extended in Spec 1"
sentence is ambiguous because Spec 1 deliberately did NOT add per-entity endpoints.
**This is the single biggest open product/architecture call in the spec.**

### 2.5 Repo-walking and manifest discovery

- The existing `buildSnapshot(tmpPath)` (techHintsResolver.ts:139) walks ONLY the repo
  ROOT — `fs.readdir(tmpPath, { withFileTypes: true })`. It does not recurse into
  subdirectories. The Spec 3 "repo-wide lookup table" needs a recursive walker that
  finds every `pom.xml` and `package.json` across the cloned repo (subject to
  framework/test exclusion patterns). This is net-new code — must avoid `node_modules/`,
  `target/`, `build/`, etc.

### 2.6 Tech-hints flow on Library — confirmation

- The `core_tech_resolved` columns are entity-agnostic: `archModelClient.getService(...)`
  reads them off the service row. To read them off a Library row, a parallel
  `archModelClient.getLibrary(...)` is needed — but Spec 1 didn't add a Library
  REST GET either. Library rows can today only be read as part of the whole-model load.
- `routes/techHintsResolve.ts` is row-id-keyed and entity-agnostic; the LLM resolver
  itself doesn't care whether the row is a Service or Library. The bottleneck is the
  per-entity GET to load `repo_location` / `core_tech` for the prompt snapshot.

---

## 3. gateway deep-dive

### 3.1 All discovery requests are gateway-routed

- Gateway router `gateway/src/routes/discovery.ts` is mounted at `/api/v1/discovery`
  (server.ts). Every frontend `fetch` for discovery goes through this router (the
  frontend `gatewayClient.ts:177` builds `${GATEWAY_BASE}/api/v1/discovery/...`).
- 18 routes (post/get/etc.); architecture-scoped under
  `/projects/:projectId/architectures/:architectureId/...`. Forwarding URLs include
  the full architecture-scoped path through to discovery-service.
- **No preflight endpoint exists.** Net-new route addition to both gateway router and
  discovery-service routes barrel.

### 3.2 Body-size / proxy concerns

- The existing run-create POST has a tiny body (`{ serviceId, confirmLlmSolo }`).
  Preflight-response body could be larger (list of internal libs, externals, warnings)
  but well within Express's default body-parser limit.

---

## 4. Frontend deep-dive

### 4.1 Right-click menu — entity-type-keyed but currently `services` + `interfaces` only

- File: `frontend/src/components/Grid/GridRowContextMenu.tsx`. The menu is **already
  entity-type-keyed** via the `entityType: EntityType` prop. The component checks
  `entityType === 'interfaces'` (renders Add endpoints item) and
  `entityType === 'services'` (renders Start Discovery Run item). Adding Library
  support means: extend the type guard, add `entityType === 'libraries'` branch,
  and either reuse the same Start Discovery Run handler OR introduce two new
  handler props. The current menu has only **1 item per entity type**, so the
  raw idea's "2 items (with libraries / no libraries)" is a UX departure — both
  items go on Service AND Library rows.
- Wiring in Grid.tsx: `Grid.tsx:957` `onContextMenu={(e) => handleRowContextMenu(e, entity)}`,
  `Grid.tsx:986-996` `<GridRowContextMenu ...>`. The Grid passes `entityType` straight
  through. Only the props on `GridRowContextMenu` need extending and one more handler
  prop is needed for the new "(No Libraries)" item.
- `Grid.tsx:586` `handleStartDiscoveryRunFromMenu` — current callback expects a Service.
  The same callback for a Library row would dispatch a different downstream call (the
  preflight runs against the Library's manifest). Unifying the path is fine because
  both Service and Library rows have `repo_location` + `repo_subfolder` fields after
  Spec 2.

### 4.2 Tier-C confirm modal — pattern to mirror for PreflightModal

- File: `frontend/src/components/Grid/StartDiscoveryRunConfirmModal.tsx` (162 lines).
  Standard React modal pattern: portal? No — direct overlay div with click-outside +
  Escape close, header / content / footer. CSS module
  (`StartDiscoveryRunConfirmModal.module.css`). Co-locates `data-testid` on every
  interactive element. Embeds an `ArchitectureRunTargetPicker` and re-seeds it on
  open. **This is the precise pattern PreflightModal should mirror.**

### 4.3 Run progress UI

- File: `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`.
- Polling-based: `useDiscoveryRuns` hook re-fetches; `selectedRun.steps_payload` is
  rendered as a flat `<ul>` of `[key, value]` pairs (line 643).
- For hierarchical progress, the simplest extension is:
  - discovery-service writes structured sub-keys into `steps_payload` (e.g.
    `library-scan: { id, status, depth, name, status: 'running'|'completed' }[]`).
  - Frontend reads the structured sub-key and renders an indented child block under
    the root step row.
- **No new transport, no new endpoint** — just a richer payload shape and a tiny
  rendering extension. This matches the raw idea's "extend the existing run-progress
  panel".

### 4.4 Frontend gatewayClient — Library-side calls don't exist yet

- `frontend/src/services/gatewayClient.ts` only has `startDiscoveryRun`, no
  `previewLibraryScan` / `startLibraryScan`. New helper functions needed.

---

## 5. Pre-existing carry-forward (per project memory + spec-1/spec-2 outputs)

- **9 broken `ModelService*Test` files in architecture-model-service** carried forward
  from Spec 1 (Java backend). Spec 3 should not be expected to fix these.
- **`bootstrap-summary-fetching.test.ts` (1 fail), `conversation-memory-edge-cases.test.ts`,
  `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts` (2 fails),
  `chatV2-panel-integration.test.ts` (3 fails), `chatV2-panel-context-and-filtering.test.ts`
  (1 fail)** — pre-existing test failures listed in MEMORY.md. None Library-related.
- Memory rule: never edit applied Liquibase changesets (≤124 after Spec 1).

---

## 6. Confirmed feasibility / no surprises

- DependencyResolverRegistry pattern is cleanly mirrored from `extensionPackRegistry.ts`.
- Hierarchical progress fits via `steps_payload` JSONB extension — no transport change.
- Right-click menu component is already entity-type-keyed; extension is mechanical.
- PreflightModal mirrors the existing Tier-C confirm modal pattern almost verbatim.
- Repo-wide walker can reuse `gitCloneRepoAccess` clone output (same `repoDir`).

## 7. Confirmed conflicts with locked decisions in the raw idea

- **(C1)** Raw idea says "writes via the architecture-model-service API extended in
  Spec 1." Spec 1 deliberately did NOT extend the API with per-entity endpoints —
  there is no `POST /libraries` / `POST /code_unit_dependencies`. The actual write
  path must be one of (a) candidate flow, (b) net-new per-entity REST, or
  (c) whole-model PUT. **This is the single biggest open question.** See Pass B Q1.

- **(C2)** Raw idea says preflight "runs the deterministic preflight (no LLM,
  milliseconds)." Confirmed feasible — the resolvers are pure-function; the only
  IO is the recursive `fs.readdir` over the cloned repo. But **on a remote git
  repo the preflight needs the repo cloned first**, which is NOT milliseconds (60s+
  for large repos). Either the preflight requires a pre-existing clone (e.g. cache
  the clone from a prior preflight in the same browser session) or the preflight
  triggers a clone with a progress UX of its own. See Pass B Q3.

- **(C3)** Raw idea says "LLM tech-hints flow runs for Library rows the same as
  Service rows." Spec 1 did NOT add a Library REST GET; today there is no way for
  discovery-service to fetch a single Library row by ID. Adding a per-Library GET is
  required for the LLM-resolve path on a Library-rooted scan. See Pass B Q5.

