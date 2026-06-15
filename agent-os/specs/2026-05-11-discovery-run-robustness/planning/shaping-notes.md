# Shaping Notes — Discovery Run Robustness

Bundled spec covering three discovery-run lifecycle robustness fixes surfaced during real-world internal testing of the just-shipped 7-spec discovery candidate evidence explainability roadmap.

---

## Section 1 — Configurable Log Path Prefix Tolerance

### 1.1 Hotfix code to remove (env-driven proxy stripping)

File: `discovery-service/src/services/runtimeEvidence/endpointPathNormalizer.ts`

- **Lines 22–32 (header)**: doc comment block on the proxy-routing prefix. Remove (or rewrite once the helpers are gone).
- **Lines 40–58**: `parseProxyPrefixes()` helper + `LOG_PROXY_PATH_PREFIXES` env read. **Delete.**
- **Line 60**: `const PROXY_PREFIXES = parseProxyPrefixes();` module-load constant. **Delete.**
- **Lines 62–86**: `stripProxyPrefix(pathOnly)` helper. **Delete.**
- **Lines 120–132 `normalizePath()`**: remove the `proxyStripped = stripProxyPrefix(pathOnly)` step (line 126) and the explanatory comment block at line 125. After removal, `normalizePath` reduces to: strip query → split → per-segment `isIdSegment` → join.

Tests to update:
- Any normalizer test asserting `LOG_PROXY_PATH_PREFIXES` behaviour (look for `process.env.LOG_PROXY_PATH_PREFIXES` references in `__tests__/endpointPathNormalizer.test.ts` if present, or an aggregator test that mocks the env).
- The example `normalizePath("/ui/job/123/succinct") => "/job/{id}/succinct"` in the JSDoc must be removed (now stays `/ui/job/{id}/succinct`).

### 1.2 Current matcher state (Tier-3 insertion point)

File: `discovery-service/src/services/runtimeEvidence/endpointRuntimeMatcher.ts`

- **Lines 9–37 (header doc)**: documents the current tier order (Tier 1 exact, Tier 2 equivalent_placeholder). Tier 3 needs a new bullet here + the `'low'` confidence + `'suffix_match'` reason.
- **Lines 65 `PLACEHOLDER_SEGMENT_REGEX`**: already exists — reuse for the literal-first-segment guardrail.
- **Lines 177–201 `buildMatchedEvidence()`**: hardcodes `matchConfidence: reason === 'exact_normalized_path' ? 'high' : 'medium'` and `matchReason: reason`. Need to extend reason union to `'exact_normalized_path' | 'equivalent_placeholders' | 'suffix_match'` and the confidence ternary to map suffix → `'low'`.
- **Lines 245–283 (per-aggregate matching loop)**: today builds `exactRecords` + `equivRecords` then short-circuits via `pickBest` + `ambiguousObservations`. Tier 3 slots in as a third pass: only run when `exactRecords.length === 0 && equivRecords.length === 0` (so exact + placeholder always win) AND `M > 0`. Build a `suffixRecords[]` list of `CandidateRecord`s where:
  - `methodCompatible(r, observationMethod)` (existing helper)
  - The candidate template's first non-empty literal segment matches the corresponding (last K-th from the end) segment of the observation's normalized path **literally** (not via placeholder rule). Concretely: candidate-template first non-empty segment must be a literal (`!PLACEHOLDER_SEGMENT_REGEX.test(seg)`).
  - `log_segs.length >= candidate_segs.length` AND `log_segs.length - candidate_segs.length <= M`.
  - Apply `arePathsEquivalentByPlaceholder(candidateNormalized, lastKSegmentsOfLog)` (or a segment-by-segment check using the same placeholder-equivalence rule) over the LAST K segments.
- After Tier 3 matches, route through the same `pickBest()` specificity disambiguator (more-literal segments wins). Ambiguous Tier-3 → push to `ambiguousObservations` (existing path).

### 1.3 Per-candidate aggregate merge

Multiple aggregates can now point at the same candidate (e.g. one log carries both `/ui/job/12345/succinct` and `/job/12345/succinct`). Today (lines 276–283) the code does `matched.push(buildMatchedEvidence(aggregate, chosen, reason))` per-aggregate without dedup. The matcher returns an array, persisted later by `persistRuntimeEvidence`. **New requirement**: merge per `chosen.candidate.id`:
- Sum: `totalLogRequests`, `observedUsageCount`, `status2xxCount`, `status3xxCount`, `status4xxCount`, `status5xxCount`.
- Union: `firstSeen` = min(existing, new), `lastSeen` = max(existing, new).
- `topStatusCodes`: re-aggregate (sum counts per status, sort desc).
- `sourceLogFileCount`: take max (or recompute as union of source log file ids — but the aggregate doesn't carry ids here).
- `matchConfidence` / `matchReason`: pick highest confidence (`high` > `medium` > `low`); if tied, prefer the most-specific reason (exact > equivalent > suffix).
- `normalizedLogPath` / `codePathTemplate`: keep the candidate's `originalTemplate`; on conflict for `normalizedLogPath`, prefer the exact/equivalent log path over the suffix one (matches the chosen confidence).
- Implementation: at the end of the per-aggregate loop, fold `matched: MatchedRuntimeEvidence[]` through a `Map<candidateId, MatchedRuntimeEvidence>` reducer and emit values.

### 1.4 Type definitions

File: `discovery-service/src/services/runtimeEvidence/httpRuntimeObservation.ts`

- **Line 105**: `matchConfidence: 'high' | 'medium' | 'low'` — **already includes `'low'`** (the comment at line 104 even says `'low' reserved`). No type change needed.
- **Line 107**: `matchReason: string` — already a free string. No change. (Optionally tighten to a union once tier-3 ships, but that's a follow-up; keep as `string` for backward compat with persisted rows.)

### 1.5 Where the matcher reads `config_snapshot` today

File: `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`

- **Lines 152–154 `RunDiscoveryRuntimeEvidenceArgs.configSnapshot`**: already accepts `configSnapshot: Record<string, unknown> | null | undefined` (the run's full config_snapshot blob). Today only `inputArtifacts.logFiles[]` is read (via `readLogFileArtifacts` lines 181–196).
- **Insertion point**: add a `readMaxLogPathPrefixSegments(configSnapshot)` helper in the same file (right next to `readLogFileArtifacts`). Reads `configSnapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`. Returns a clamped integer in `[0..5]`, default `1` when missing or out of range.
- **Threading**: pass the value into the matcher. Today line 495–498 invokes `matchAggregatesToCandidates(aggregates, deterministicCandidates)` — extend to a third arg `{ maxLogPathPrefixSegments: number }` (an options object so future toggles don't add positional args).
- **Caller seam**: `runDiscoveryRuntimeEvidence` is called from `runDiscoveryV3.ts` between Stage 2 and Stage 3. The orchestrator already reads the run's `discoveryRun.config_snapshot` (its arg `configSnapshot`); no new fetch is needed.

### 1.6 Run-start payload path & where to inject M

The run-creation pipeline:

1. **Frontend modal** (`StartDiscoveryRunModal.tsx` / `PreflightModal.tsx`):
   - `StartDiscoveryRunModal.handleStart` (line 122) calls `startDiscoveryRun(projectId, architectureId, serviceId, false)` — that's `frontend/src/services/gatewayClient.ts` line 167.
   - `PreflightModal` calls back through Grid.tsx → `handlePreflightConfirm` (Grid.tsx line ~654) which calls the same `startDiscoveryRun` then `uploadDiscoveryRunLogFiles`.
2. **Gateway** `gateway/src/routes/discovery.ts` line 114: `POST /projects/:projectId/architectures/:architectureId/runs` — pure pass-through to discovery-service.
3. **Discovery-service** `discovery-service/src/routes/runs.ts` line 158: `POST /projects/:projectId/architectures/:architectureId/runs` — body shape today is `{ serviceId?, confirmLlmSolo?, doPerformanceRun?, runMode?, includeExternal?, libraryId? }`. Calls `archModelClient.createDiscoveryRun(projectId, architectureId, serviceId, { mode, warnings, confirmedLlmSolo })` (line 327).
4. **archModelClient.createDiscoveryRun** `discovery-service/src/services/archModelClient.ts` line 652: POSTs to AMS `/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs` with body `{ service_id?, mode?, warnings?, confirm_llm_solo? }`.
5. **AMS** `DiscoveryRunController.CreateDiscoveryRunRequest` (line 345 of controller, partial) accepts those fields. The `DiscoveryRunService.createRun(...)` builds the entity with an empty `config_snapshot = new HashMap<>()` (the existing default — confirmed by reading `createRun` doc strings around line 169).

**The run-start payload does NOT today carry config_snapshot extension fields.** `inputArtifacts.logFiles[]` is added AFTER the run is created via the dedicated PATCH:

- **`PATCH /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/input-artifacts/log-files`** (`DiscoveryRunController.java` line 274, `patchLogFileArtifacts`). Service method is `DiscoveryRunService.patchLogFileArtifacts` (around line 681) which reads existing `config_snapshot.inputArtifacts`, merges, and writes back.

**Decision for M's wire path** (autonomous low-stakes recommendation): **piggy-back on the existing log-files PATCH**. Reasoning:
- M and the log files are conceptually paired (M only matters when logs are uploaded). One persistence write keeps them coherent.
- No new endpoint, no AMS controller change beyond the existing patch handler — but the request body needs an optional `runtimeEvidenceConfig?: { maxLogPathPrefixSegments?: int }` field, and the service-level merge needs to write `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` alongside the `inputArtifacts` merge.
- Edge case: when the user uploads NO log files but still wants to set M (rare — M only matters with logs), the modal's Start button can simply skip the upload call. Default M=1 is preserved on disk by the orchestrator's clamp.

**Frontend wire**: extend `gateway/src/routes/discovery.ts` upload route (line 2182) and `gateway/src/services/architectureModelClient.ts:patchDiscoveryRunLogFileArtifacts` (line 2018) so the gateway forwards an optional `runtimeEvidenceConfig` block alongside `logFiles` and `attemptedCount` in the PATCH body.

**Frontend API**: add an optional 5th arg `maxLogPathPrefixSegments?: number` to `uploadDiscoveryRunLogFiles(projectId, architectureId, runId, files, maxLogPathPrefixSegments?)` — sent as a separate FormData field (e.g. `runtimeEvidenceConfig` as a JSON-string field) since the upload is multipart. Both modals thread the value in.

### 1.7 Modal UX conventions

Existing numeric inputs (precedent for the M control):
- `frontend/src/components/ProductView/WorkItemCreateModal.tsx` line 245–253: `<input type="number" />` with a `<span className={styles.hint}>` description below. Plain text input, no spinner buttons styled. **Match this pattern.**
- `frontend/src/components/ProductView/WorkItemEditModal.tsx` line 253: same pattern.
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` line 1199: same pattern.

No existing slider component in the codebase. No existing stepper component. **Recommend: plain `<input type="number" min="0" max="5" step="1" />` matching WorkItemCreateModal**.

### 1.8 Existing tests for normalizer / matcher / orchestrator

- `discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.test.ts` (orchestrator unit tests).
- `discovery-service/src/services/runtimeEvidence/__tests__/runDiscoveryRuntimeEvidence.e2e.test.ts` (orchestrator e2e tests).
- Look for any `endpointPathNormalizer.test.ts` or `endpointRuntimeMatcher.test.ts` in the same `__tests__/` dir for tier-1/tier-2 coverage that tier-3 tests should mirror.

---

## Section 2 — Service Deletion FK Strategy (Option C)

### 2.1 Current FK definition

- **Original FK**: `architecture-model-service/src/main/resources/db/changelog/sql/081-discovery-run-service-id.sql` line 10 — `ALTER TABLE discovery_run ADD COLUMN service_id TEXT REFERENCES services(id);`. Default `ON DELETE` semantics is **NO ACTION / RESTRICT** (PostgreSQL default).
- **Follow-up**: `082-discovery-run-service-id-deferrable.sql` lines 14–19 — drops + re-adds the FK as `DEFERRABLE INITIALLY DEFERRED` (still RESTRICT semantics, just deferred to commit). The header comment explains why: `ModelService.saveModel` does DELETE-ALL → re-INSERT-ALL within one transaction, and a non-deferred FK fired immediately on the DELETE phase even though the same IDs were re-inserted moments later.
- **Net current state**: `discovery_run.service_id` is **nullable already** (the original ADD COLUMN didn't say NOT NULL), FK is `DEFERRABLE INITIALLY DEFERRED`, ON DELETE is the implicit RESTRICT. The user-reported "FK violation blocks save" must be the case where the user *deletes a service entirely* (not part of a save-model cycle), so the deferred check still fails at commit.

### 2.2 Liquibase changeset for option (c)

- **Highest existing changeset**: `125-discovery-candidate-library-id.sql` (plus the unnumbered `2026-04-20-tech-hints-resolved.sql` legacy entry). **Next number: 126.**
- **New file**: `architecture-model-service/src/main/resources/db/changelog/sql/126-discovery-run-service-id-set-null.sql`. Content:
  ```sql
  ALTER TABLE discovery_run DROP CONSTRAINT IF EXISTS discovery_run_service_id_fkey;

  ALTER TABLE discovery_run
    ADD CONSTRAINT discovery_run_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;
  ```
  Keeps `DEFERRABLE INITIALLY DEFERRED` (still needed for save-model cycle), changes the action to `SET NULL`. Column was already nullable so no `ALTER COLUMN ... DROP NOT NULL` needed.
- **Master changelog**: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` — add a `changeSet:` entry for `126-discovery-run-service-id-set-null` in the existing pattern (id, author, preConditions, sqlFile path).

Per saved feedback (`feedback_liquibase_immutable_changesets`): do NOT edit 081 or 082; create a new changeset 126.

### 2.3 Run-create code path (where to add `serviceIdentitySnapshot`)

**Discovery-service-side seam** is `runManager.startServiceScopedRun` line 1554:
```typescript
const service = await archModelClient.getService(projectId, architectureId, serviceId);
```
This already fetches the service entity at run-start. **The snapshot can be built right here, then PATCH'd onto the run's `config_snapshot.serviceIdentitySnapshot` via a one-shot AMS call.**

But this is service-scoped only. The library-scoped path (`startLibraryScopedRun`) and the project-scoped path also have a `serviceId` (when present). For consistency, **prefer hoisting the snapshot creation to before the path-specific dispatch** — i.e. early in `startRun` (line 1057) immediately after `bindRunArchitecture`, when `serviceId` is non-null:

```typescript
if (serviceId) {
  const service = await archModelClient.getService(projectId, architectureId, serviceId);
  if (service) {
    await archModelClient.updateDiscoveryRunConfigSnapshot(projectId, runId, {
      serviceIdentitySnapshot: { serviceId, serviceName: service.name, /* ... */ }
    });
  }
}
```

Or **even earlier** at run-create time inside `discovery-service/src/routes/runs.ts` — the route already fetches `service` (line 249) for tier computation. Stash it in the snapshot via the createRun call. **Recommendation: the route is the better seam** because (a) the service is already fetched, (b) the snapshot is then in the DB before any async `startRun` work begins, (c) it's atomic with run creation.

**Wire change for option B (route-level snapshot)**:
- `archModelClient.createDiscoveryRun` (line 652) currently sends `{ service_id?, mode?, warnings?, confirm_llm_solo? }`. Extend body with optional `service_identity_snapshot?: { service_id, service_name, ... }` field.
- AMS `DiscoveryRunController.CreateDiscoveryRunRequest` (line 345) accepts an extra `@JsonProperty("service_identity_snapshot") Map<String, Object> serviceIdentitySnapshot` field.
- `DiscoveryRunService.createRun` writes that map into `config_snapshot.serviceIdentitySnapshot` on the new entity (around line 220 where `config_snapshot` is initialised).

### 2.4 Service identity snapshot fields

Available on `ServiceResponseDto` (`discovery-service/src/services/archModelClient.ts` line 79–126):

| Field | Useful for orphan-display? |
|---|---|
| `id` | yes (already serviceId, the FK) |
| `name` | **YES** — primary display |
| `description` | borderline — could help reviewer recognize |
| `application_id` | yes — context (which app it belonged to) |
| `app_component_id` | yes |
| `service_type` | yes |
| `core_tech` | borderline — useful for recognition |
| `repo_location` | **YES** — strong identifier |
| `repo_subfolder` | yes |
| `tags` | optional |

**Recommendation (autonomous low-stakes call)**: snapshot these six — `serviceId`, `serviceName`, `serviceType`, `applicationId`, `repoLocation`, `repoSubfolder`. Skip `description` (long, not identifier-like), `tags` (rarely set in current data), and the `core_tech_*` resolved columns (already capture `core_tech`-equivalent info via the discovery candidates). Keeps the snapshot ≤200 bytes typical.

### 2.5 Frontend orphan-run UI

Confirmed: `DiscoveryRunsList.tsx` does NOT currently render service name today (lines 175–211). It renders status badge + log-attach warning chip + tier badge + date. So **a new render slot for service name + "Service deleted" chip needs to be added** to the row.

CSS module: `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` (DiscoveryRunsList imports its styles). **Add new styles for `serviceNameLabel`, `serviceDeletedChip`** following the `logsAttachWarningChip` pattern (lines 189–201).

`DiscoveryRunDetailView.tsx` does not render service name either (no matches at line search). The chip needs to be rendered:
- in the row in `DiscoveryRunsList.tsx`.
- in the detail-view header in `DiscoveryRunDetailView.tsx` (the surface that shows the run currently being viewed).

Logic predicate: `run.service_id == null && run.config_snapshot?.serviceIdentitySnapshot?.serviceName != null`.

Backward-compat case: `service_id == null && no snapshot present` (legacy orphans) — render "Service deleted (id: <truncated uuid>)" using the *original* `serviceId` if we ever stored it. Since the FK column will be nulled, the original ID is lost. Compromise: render "Service deleted" with no ID when neither snapshot nor service_id exist. (User accepted this graceful-degradation in raw-idea.md.)

### 2.6 Tests likely to break

- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DiscoveryRunServiceScopedConfigOptionalTest.java` lines 99, 129 assert `entity.getServiceId()` after creation. Won't break (we're not nulling at create-time, only on service deletion).
- `DiscoveryRunModePersistenceTest.java` lines 63, 108, 179 — same pattern.
- **No tests found that assert `service_id` is non-null on `discovery_run`.** The original FK was already nullable — defence-in-depth tests don't exist.
- **One concern**: any test that DELETEs a service and then asserts the discovery_run row is also gone (CASCADE) will break — but no such test was found. Today the FK is RESTRICT, so DELETE-service was always blocked, so no such test would have been writeable.

---

## Section 3 — `discovery_run.architecture_id` exposed on AMS DTO

### 3.1 Current DTO state (confirmed missing)

File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java`

- **Lines 41–83**: `public record DiscoveryRunDto(...)` declares **14 components**: `id`, `projectId`, `serviceId`, `mode`, `tier`, `warnings`, `confirmedLlmSolo`, `status`, `currentStep`, `configSnapshot`, `stepsPayload`, `errorMessage`, `createdAt`, `updatedAt`.
- **`architectureId` is missing.** Confirmed.
- **Insertion point**: between `projectId` (line 45) and `serviceId` (line 48), to match `DiscoveryRunEntity` declaration order (entity declares `projectId` line 64, `architectureId` line 80, `serviceId` line 88).
- **Annotation convention**: every existing component uses `@JsonProperty("snake_case")` (e.g. `@JsonProperty("project_id") UUID projectId`). Match this.

```java
@JsonProperty("architecture_id")
UUID architectureId,
```

### 3.2 `toDto()` and other `new DiscoveryRunDto(...)` call sites

File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java`

- **Line 806–824 `toDto()`**: positional 14-arg constructor. Add `entity.getArchitectureId()` at position 3 (after `entity.getProjectId()`).

Confirmed via grep: `toDto` is the **only** `new DiscoveryRunDto(...)` site in the production code (only one line 807 match). **All other call sites are in `src/test/`.**

### 3.3 `DiscoveryRunEntity.getArchitectureId()` confirmed

`DiscoveryRunEntity.java` line 80: `private UUID architectureId;`. Lombok `@Getter` (line 52) auto-generates `getArchitectureId(): UUID`. **Method exists.**

### 3.4 Test files that construct `DiscoveryRunDto` positionally (will break compile until updated)

All in `architecture-model-service/src/test/java/com/example/architecturemodel/`:

- `controller/DiscoveryEntityOriginsControllerTest.java` lines 62, 66, 124 (3 sites)
- `controller/DiscoveryRunControllerArchitectureScopingTest.java` lines 86, 175 (2 sites)
- `controller/DiscoveryRunControllerTest.java` lines 65, 127, 132, 200, 244, 254 (6 sites)
- `service/DiscoveryRunModePersistenceTest.java` lines 60, 105 (and likely line ~165 — the file has 3 patterns) (2–3 sites)

**Total**: ~13 positional-constructor sites in test files. All need a new `UUID architectureId` arg inserted at position 3 (after `projectId`). Most can be a sentinel `UUID.randomUUID()` or a fixed test constant.

### 3.5 Existing AMS controller test coverage of the DTO output shape

- `DiscoveryRunControllerTest.java` constructs DTOs and stubs them as service responses, then asserts MockMvc JSON paths. None of the existing JSON-path assertions name `architecture_id` (it's not in the DTO today). Adding the new field won't break the existing assertions; need a new assertion (`jsonPath("$.architecture_id").value(...)`) on at least one happy-path test.
- `DiscoveryRunControllerArchitectureScopingTest.java` — this IS the test file most likely to grow a new assertion ("the run carries its bound architecture in the DTO").

### 3.6 Frontend save-back flow that consumes `architecture_id`

The bug surfaces in the "Save to canonical model" modal that resolves the architecture name from `ArchitectureContext.architectures` using `run.architecture_id`. The frontend type already has the field (`DiscoveryRunDto.architecture_id?: string` in `frontend/src/api/discoveryApi.ts` line 95). No frontend change needed.

Existing test that should be extended to assert `architecture_id` resolves correctly: `frontend/src/components/DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx` (per file listing). Or a save-back-modal-specific test (look for `SaveCanonicalModelModal` or similar).

### 3.7 Gateway pass-through

Confirmed `gateway/src/routes/discovery.ts` line 561 (`GET /projects/:projectId/architectures/:architectureId/runs/:runId`) does verbatim pass-through: lines 587–603 just `await response.json()` and `res.status(response.status).json(responseBody)`. No field stripping. So once AMS emits `architecture_id` it will reach the frontend untouched.

---

## Resolved Decisions (from shaping conversation)

### Section 1 — Configurable Log Path Prefix Tolerance
- **D1.1**: Per-run integer M = "max log path prefix segments to tolerate". Default 1, range 0..5, M=0 disables suffix matching.
- **D1.2**: M is set in `StartDiscoveryRunModal` (Spec 4 default-flow modal) AND `PreflightModal` (Spec 4 library-scan flow).
- **D1.3**: M persisted at `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` (sibling of `config_snapshot.inputArtifacts.logFiles[]`).
- **D1.4**: Discovery-service tier-3 suffix matcher: candidate template segments equal the LAST K segments of the log's normalized path; `log_segs - candidate_segs <= M`; candidate template's first non-empty segment MUST be a literal (rejects `/{id}/foo`); use existing placeholder-equivalence rules for segment comparison; confidence `'low'`, reason `'suffix_match'`.
- **D1.5**: Per-candidate aggregate merge — when multiple aggregates point at the same candidate, merge into ONE `MatchedRuntimeEvidence` (sum counts, union time window, pick highest-confidence reason).
- **D1.6**: REMOVE the recently-added `LOG_PROXY_PATH_PREFIXES` env var, `parseProxyPrefixes()`, `stripProxyPrefix()`, the proxy-strip step inside `normalizePath()`, and related env-driven tests.

### Section 2 — Service Deletion FK Strategy
- **D2.1**: Option (c) — make FK optional with `ON DELETE SET NULL`, AND snapshot service identity at run start so orphaned runs remain useful.
- **D2.2**: Liquibase changeset alters `discovery_run.service_id` FK to `ON DELETE SET NULL` (column already nullable).
- **D2.3**: At run start, snapshot service identity into `config_snapshot.serviceIdentitySnapshot` (`serviceId`, `serviceName`, plus other identifying fields TBD per shaper investigation).
- **D2.4**: Frontend renders a "Service deleted" chip next to the (snapshot-derived) service name on orphaned runs (run-list AND run-detail surfaces).
- **D2.5**: Existing runs without a snapshot degrade gracefully to "Service deleted (id: <uuid>)" or just "Service deleted" — no data backfill.

### Section 3 — `discovery_run.architecture_id` on AMS DTO
- **D3.1**: Add `@JsonProperty("architecture_id") UUID architectureId,` to the `DiscoveryRunDto` record between `projectId` and `serviceId` (matching entity declaration order).
- **D3.2**: Update `DiscoveryRunService.toDto()` to pass `entity.getArchitectureId()` as the corresponding argument.
- **D3.3**: No frontend change, no gateway change, no migration required (column already populated NOT NULL).

### Bundle-level
- **D4.1**: NO new top-level discovery-service pipeline step. Section 1 modifies the existing runtime-evidence sub-stage inside `runDiscoveryV3`.
- **D4.2**: NO new backend endpoints. Section 2 reuses existing run-fetch / candidate-fetch paths.
- **D4.3**: Per saved feedback `no_src_edits_during_run`: discovery-service/src/** edits MUST NOT happen during a live tsx watch run.
- **D4.4**: Per saved feedback `liquibase_immutable_changesets`: do NOT edit changesets 081/082; create new changeset 126.

---

## Resolved decisions (user-confirmed 2026-05-11)

The user accepted all five recommended defaults from the shaping pass.

### Already-locked design (from earlier shaping conversation)

**Section 1 — Configurable log path prefix tolerance:**
- Per-run integer M, default 1, range 0..5, M=0 disables suffix matching
- Set in both `StartDiscoveryRunModal` and `PreflightModal`
- Persisted at `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`
- Discovery-service tier-3 suffix matcher with literal-first-segment guardrail
- Per-candidate aggregate merge: sum counts, union time window, highest-confidence reason wins
- New tier-3 entries use `matchConfidence: 'low'` and `matchReason: 'suffix_match'`
- REMOVE the `LOG_PROXY_PATH_PREFIXES` env var + `parseProxyPrefixes()` + `stripProxyPrefix()` and the proxy-strip step inside `normalizePath()`

**Section 2 — Service deletion FK strategy (option c):**
- Liquibase changeset 126: alter `discovery_run.service_id` FK to `ON DELETE SET NULL` (column already nullable per changeset 081)
- Snapshot service identity at run start into `config_snapshot.serviceIdentitySnapshot`
- Frontend "Service deleted" chip on orphaned runs

**Section 3 — discovery_run.architecture_id on AMS DTO:**
- Add `@JsonProperty("architecture_id") UUID architectureId,` to the `DiscoveryRunDto` record at position 3 (after projectId, matching entity field order)
- Pass `entity.getArchitectureId()` in `DiscoveryRunService.toDto()` at position 3
- Update ~13 test-file call sites to insert a sentinel UUID at position 3

### Resolved during shaping (5 questions, all defaults accepted)

1. **Wire path for M → piggy-back on the existing log-files PATCH endpoint.**
   - Extend the existing PATCH body shape with a sibling key `runtimeEvidenceConfig: { maxLogPathPrefixSegments: number }` alongside the existing `inputArtifacts.logFiles[]` payload.
   - Single write, conceptually paired with the logs themselves. No new AMS endpoint, no new gateway route.
   - The frontend sends M only when it sends log files. When M is its default (1) AND no logs are uploaded, the M value is irrelevant and need not be persisted (matcher uses default 1 from missing-key defensive read).

2. **Modal placement of M input → always-visible directly below the upload section, hidden when no files are selected.**
   - Renders as a plain `<input type="number" min="0" max="5" />` matching the precedent at `WorkItemCreateModal.tsx:245`.
   - One-line hint: `"Tolerate up to N proxy prefix segments when matching log paths to endpoints (0–5, default 1)"`.
   - Visibility gated on `selectedFiles.length > 0`. Hidden when no files selected (M is irrelevant without logs).

3. **Service identity snapshot fields → six identifier-ish fields.**
   - Snapshot exactly: `serviceId, serviceName, serviceType, applicationId, repoLocation, repoSubfolder`.
   - All available on `ServiceResponseDto` from `archModelClient.ts:79`.
   - Skip `description`, `tags`, resolved-tech columns (they're not needed for orphaned-run identification).
   - Snapshot is taken at the route level in `discovery-service/src/routes/runs.ts:249` (the existing service-fetch site for tier computation), so the snapshot is in the DB before async startRun begins.

4. **Orphan badge label + color.**
   - Label: `"Service deleted"`.
   - Color: warning amber, matching the existing `logsAttachWarningChipPartial` style in `DiscoveryRunDetailView.module.css:189-201`.
   - Placement: render adjacent to the snapshot-derived service name in BOTH the run-list row (`DiscoveryRunsList.tsx:175-211`) AND the run-detail header.
   - Render only when `service_id` is NULL but `serviceIdentitySnapshot.serviceName` exists (graceful degradation when no snapshot: badge shows `"Service deleted (id: <uuid>)"` using the FK value alone).

5. **Per-candidate merge tie-break for `normalizedLogPath` → highest-confidence contributor wins.**
   - When merging two aggregates pointing at the same candidate with different confidences (e.g. tier-1 exact `/job/123/succinct` and tier-3 suffix `/ui/job/123/succinct`):
     - Sum: `observedUsageCount`, `totalLogRequests`, status counts (2xx/3xx/4xx/5xx), `sourceLogFileCount`
     - Union: `firstSeen` (min) and `lastSeen` (max)
     - Highest-confidence contributor wins for: `matchConfidence`, `matchReason`, `normalizedLogPath`, `codePathTemplate`
   - Confidence ordering: `'high' > 'medium' > 'low'`.
   - Tie within same confidence (rare): pick the first encountered (deterministic via aggregate-Map iteration order).

---
