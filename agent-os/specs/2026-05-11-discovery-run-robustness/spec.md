# Specification: Discovery Run Robustness

## Goal
Bundle three discovery-run lifecycle robustness fixes surfaced during real-world internal testing of the just-shipped 7-spec discovery candidate evidence explainability roadmap: (1) replace a brittle env-driven proxy-prefix-strip hotfix with a per-run configurable suffix matcher, (2) make `discovery_run.service_id` survive service deletion via `ON DELETE SET NULL` plus an identity snapshot, and (3) expose the already-persisted `discovery_run.architecture_id` on the AMS DTO that today silently omits it.

## User Stories
- As a discovery reviewer collecting logs from proxy components, I want a per-run knob that lets the matcher tolerate up to N leading proxy-prefix segments so that `/ui/job/{id}/succinct` log lines correctly attach to a backend `/job/{id}/succinct` endpoint candidate without me editing environment variables.
- As an architect cleaning up the application architecture, I want to delete an obsolete service without blocking project save, while preserving enough identity on historical discovery runs to still recognise which service they came from.
- As a frontend user clicking "Save to canonical model" on a finished run, I want the architecture name resolved correctly so the Save button is enabled (today the AMS response is silently missing `architecture_id` and the modal blocks).

## Specific Requirements

**Section 1 — Per-run M setting in both run-start modals**
- Add a numeric input `<input type="number" min="0" max="5" step="1" />` in both `StartDiscoveryRunModal` and `PreflightModal`, matching the precedent at `WorkItemCreateModal.tsx:245-253` (plain text input, no spinner styling, hint span below).
- Visibility gated on `selectedFiles.length > 0`; the M control is hidden when no log files are selected (M is irrelevant without logs).
- One-line hint text directly below: "Tolerate up to N proxy prefix segments when matching log paths to endpoints (0-5, default 1)".
- Default value `1`; clamp display to `[0..5]`.
- Both modals own the value alongside their existing `selectedFiles` state and thread it into their existing submit handlers.

**Section 1 — Wire M through to AMS via the existing log-files PATCH (no new endpoint)**
- Frontend `uploadDiscoveryRunLogFiles(projectId, architectureId, runId, files, maxLogPathPrefixSegments?)` gains an optional 5th argument; the value is added as a JSON-string FormData field `runtimeEvidenceConfig` because the existing call is multipart.
- Gateway upload route at `gateway/src/routes/discovery.ts:2182` forwards an optional `runtimeEvidenceConfig` block alongside the existing `logFiles` and `attemptedCount` keys when calling AMS.
- Gateway `architectureModelClient.patchDiscoveryRunLogFileArtifacts` (line 2018) accepts an optional `runtimeEvidenceConfig` arg and includes it in the PATCH body sent to AMS.
- AMS PATCH endpoint at `DiscoveryRunController.patchLogFileArtifacts` (line 274) accepts an optional sibling key `runtimeEvidenceConfig: { maxLogPathPrefixSegments: number }` in its request body alongside the existing `logFiles[]` / `attemptedCount`.
- AMS `DiscoveryRunService.patchLogFileArtifacts` (around line 681) merges the value into `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` in the same write that merges `inputArtifacts.logFiles[]`.
- The run-create POST body shape is UNCHANGED (M never rides the create POST, only the log-files PATCH).
- When user uploads no log files, the modal skips the upload call entirely; default M=1 is preserved via the orchestrator's defensive read.

**Section 1 — Discovery-service tier-3 suffix matcher**
- In `runDiscoveryRuntimeEvidence.ts`, add a `readMaxLogPathPrefixSegments(configSnapshot)` helper alongside the existing `readLogFileArtifacts`. Returns an integer clamped to `[0..5]`, default `1` when the key is missing or out of range.
- Thread the value into `matchAggregatesToCandidates(aggregates, candidates, { maxLogPathPrefixSegments })` as a new options-object argument (no positional churn).
- In `endpointRuntimeMatcher.ts`, after the existing Tier-1 (exact) and Tier-2 (equivalent-placeholder) passes return empty AND when `M > 0`, run a Tier-3 suffix-match pass per aggregate:
  - Method compatibility check via existing `methodCompatible` helper.
  - Candidate template's first non-empty segment MUST be a literal (`!PLACEHOLDER_SEGMENT_REGEX.test(seg)`); reject patterns like `/{id}/foo`.
  - `log_segs.length >= candidate_segs.length` AND `log_segs.length - candidate_segs.length <= M`.
  - Compare candidate segments to the LAST K segments of the log's normalized path using the existing placeholder-equivalence rule (`arePathsEquivalentByPlaceholder` or equivalent segment-by-segment check), where K = candidate's segment count.
  - Disambiguate ambiguous tier-3 matches through the same `pickBest()` specificity selector used by tier-1/2; ambiguous tier-3 results route through the existing `ambiguousObservations` path.
- Extend `buildMatchedEvidence` (lines 177-201): reason union becomes `'exact_normalized_path' | 'equivalent_placeholders' | 'suffix_match'`; confidence mapping becomes `exact -> 'high'`, `equivalent -> 'medium'`, `suffix -> 'low'`.
- The `httpRuntimeObservation.ts` type `matchConfidence: 'high' | 'medium' | 'low'` already includes `'low'`; no type change needed. `matchReason: string` already permits the new reason value.

**Section 1 — Per-candidate aggregate merge**
- After the per-aggregate matching loop emits `MatchedRuntimeEvidence[]`, fold the array through a `Map<candidateId, MatchedRuntimeEvidence>` reducer keyed on `chosen.candidate.id`.
- SUM: `observedUsageCount`, `totalLogRequests`, `status2xxCount`, `status3xxCount`, `status4xxCount`, `status5xxCount`, `sourceLogFileCount`.
- UNION: `firstSeen = min(existing, new)`, `lastSeen = max(existing, new)`; re-aggregate `topStatusCodes` (sum per status, sort descending).
- Highest-confidence contributor wins for `matchConfidence`, `matchReason`, `normalizedLogPath`, `codePathTemplate`. Confidence ordering: `high > medium > low`.
- Same-confidence tie: first encountered wins (deterministic via Map iteration order over aggregates).
- Emit `Array.from(map.values())` from the matcher.

**Section 1 — Remove the env-driven proxy-strip hotfix**
- Delete `parseProxyPrefixes()` helper and the `LOG_PROXY_PATH_PREFIXES` env read in `endpointPathNormalizer.ts:40-58`.
- Delete the `PROXY_PREFIXES` module-load constant at line 60.
- Delete the `stripProxyPrefix()` helper at lines 62-86.
- Delete the `proxyStripped = stripProxyPrefix(pathOnly)` step inside `normalizePath()` (line 126) and the explanatory comment block at line 125. After removal, `normalizePath` reduces to: strip query, split, per-segment `isIdSegment`, join.
- Delete or rewrite the proxy-prefix doc comment block at lines 22-32 and remove the now-stale `/ui/job/123/succinct => /job/{id}/succinct` JSDoc example.
- Delete the related env-driven proxy-strip tests in `__tests__/endpointPathNormalizer.test.ts` (or the aggregator test that mocks `process.env.LOG_PROXY_PATH_PREFIXES`).

**Section 2 — Liquibase changeset 126: ON DELETE SET NULL**
- New file `architecture-model-service/src/main/resources/db/changelog/sql/126-discovery-run-service-id-set-null.sql`:
  - `ALTER TABLE discovery_run DROP CONSTRAINT IF EXISTS discovery_run_service_id_fkey;`
  - Re-add the constraint as `FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;` (keep deferred semantics for compatibility with `ModelService.saveModel` delete-all-then-reinsert).
- Add a corresponding `changeSet:` entry to `db.changelog-master.yaml` following the existing id/author/preConditions/sqlFile pattern.
- Column already nullable per changeset 081; no `ALTER COLUMN ... DROP NOT NULL` is needed.
- Per the immutable-changesets feedback rule: do NOT edit changeset 081 or 082; only create 126.

**Section 2 — Service identity snapshot at run start**
- Snapshot is captured at the route level in `discovery-service/src/routes/runs.ts:249` (the existing service-fetch site used for tier computation) so the snapshot is in the DB before any async `startRun` work begins.
- Snapshot fields: `serviceId`, `serviceName`, `serviceType`, `applicationId`, `repoLocation`, `repoSubfolder`. All sourced from `ServiceResponseDto` (`discovery-service/src/services/archModelClient.ts:79-126`). Skip `description`, `tags`, and resolved-tech columns.
- Wire change: `archModelClient.createDiscoveryRun` (line 652) extends its POST body with optional `service_identity_snapshot: { service_id, service_name, service_type, application_id, repo_location, repo_subfolder }`.
- AMS `DiscoveryRunController.CreateDiscoveryRunRequest` (line 345) accepts an extra `@JsonProperty("service_identity_snapshot") Map<String, Object> serviceIdentitySnapshot` field.
- AMS `DiscoveryRunService.createRun` writes the map into `config_snapshot.serviceIdentitySnapshot` on the new entity at the existing `config_snapshot` initialisation site (~line 220).
- Snapshot is taken only when `serviceId` is non-null; library-scoped and project-scoped runs without a service get no snapshot.

**Section 2 — Frontend "Service deleted" chip**
- Label: `"Service deleted"`. Color: warning amber, matching the existing `logsAttachWarningChipPartial` style in `DiscoveryRunDetailView.module.css:189-201`.
- Add new CSS classes `serviceNameLabel` and `serviceDeletedChip` in `DiscoveryRunDetailView.module.css` reusing the same amber palette.
- Render in `DiscoveryRunsList.tsx:175-211` (run-list row) AND `DiscoveryRunDetailView.tsx` header surface, adjacent to the snapshot-derived service name.
- Predicate: `run.service_id == null && run.config_snapshot?.serviceIdentitySnapshot?.serviceName != null` -> render `"<snapshot.serviceName> | Service deleted"`.
- Graceful degradation: when `service_id == null` AND no snapshot present (legacy pre-snapshot orphans), render `"Service deleted"` with no name suffix (the original FK value is lost when SET NULL fires).
- Non-orphaned runs (FK still resolves) render unchanged — no chip.

**Section 3 — Add `architecture_id` to `DiscoveryRunDto`**
- In `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java`, insert `@JsonProperty("architecture_id") UUID architectureId,` between `projectId` and `serviceId` (position 3) to match `DiscoveryRunEntity` declaration order (`projectId` line 64, `architectureId` line 80, `serviceId` line 88).
- The new record becomes a 15-component constructor (was 14).
- Match the existing `@JsonProperty("snake_case")` annotation convention used by every existing component.

**Section 3 — Update `DiscoveryRunService.toDto()`**
- In `DiscoveryRunService.java` at line 806-824, add `entity.getArchitectureId()` at position 3 of the positional constructor call (after `entity.getProjectId()`). `DiscoveryRunEntity.getArchitectureId()` is already generated by Lombok `@Getter` (entity line 80).
- `toDto` is the only production call site of `new DiscoveryRunDto(...)`; all other positional construction sites are in `src/test/`.

**Section 3 — Update ~13 positional-constructor test sites**
- Insert a sentinel `UUID architectureId` argument at position 3 in every test-file `new DiscoveryRunDto(...)` call:
  - `controller/DiscoveryEntityOriginsControllerTest.java` lines 62, 66, 124 (3 sites).
  - `controller/DiscoveryRunControllerArchitectureScopingTest.java` lines 86, 175 (2 sites).
  - `controller/DiscoveryRunControllerTest.java` lines 65, 127, 132, 200, 244, 254 (6 sites).
  - `service/DiscoveryRunModePersistenceTest.java` lines 60, 105 plus the third occurrence (~line 165) (2-3 sites).
- Use `UUID.randomUUID()` or an existing fixed test UUID constant per test file's convention.
- Extend at least one happy-path `DiscoveryRunControllerTest` assertion to verify `jsonPath("$.architecture_id").value(...)`; `DiscoveryRunControllerArchitectureScopingTest` is the natural home for the assertion that the DTO carries its bound architecture.

**Cross-section coordination and unchanged surfaces**
- Section 3 is independent of Sections 1 and 2 and could ship standalone; bundling is for ergonomic shaping.
- Sections 1 and 2 both touch the run-start path but at different layers: Section 1 modifies the modal upload + AMS log-files PATCH; Section 2 modifies the route-level service fetch + AMS createRun body. They do not collide.
- UNCHANGED: `runtimeEvidenceContextBuilder.ts` (Spec 6), `runtimeBadgeHelpers.ts` and `displayConfidence.ts` (Spec 7), `CandidateEvidenceSectionCard.tsx`, `candidateDetailsSupport.ts`, all Spec 1-7 testid contracts, the run-create POST shape, the persisted `candidate.confidence` value, and the `Service` entity itself (Section 2 changes only the FK constraint on `discovery_run`).

**Acceptance criteria — Section 1**
- AC1.1: Both `StartDiscoveryRunModal` and `PreflightModal` render an `<input type="number" min="0" max="5" step="1" />` with default value `1` and a one-line hint, visible only when at least one log file is selected.
- AC1.2: When the user uploads logs, the gateway forwards a JSON field `runtimeEvidenceConfig: { maxLogPathPrefixSegments: <number> }` in the multipart body to its log-files route.
- AC1.3: The gateway PATCH call to AMS includes `runtimeEvidenceConfig` alongside `logFiles` and `attemptedCount`.
- AC1.4: AMS persists `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` in the same write that merges `inputArtifacts.logFiles[]`, idempotent on re-PATCH.
- AC1.5: Discovery-service orchestrator reads M from `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`, clamps to `[0..5]`, defaults to `1` on missing/invalid key.
- AC1.6: With `M = 0`, no tier-3 matches are produced.
- AC1.7: With `M = 1` and a candidate `GET /job/{id}/succinct`, a log path `GET /ui/job/12345/succinct` matches with `matchConfidence: 'low'` and `matchReason: 'suffix_match'`.
- AC1.8: With `M = 1` and a log path `GET /api/proxy/job/12345/succinct` (two leading segments), the same candidate does NOT match (over the cap).
- AC1.9: With `M = 2` the same two-segment-prefix log path DOES match.
- AC1.10: A candidate template `GET /{id}/foo` is REJECTED by the tier-3 literal-first-segment guardrail regardless of M.
- AC1.11: When two aggregates (e.g. `/ui/job/12345/succinct` exact-prefix-stripped vs `/job/12345/succinct` exact) point at the same candidate, exactly one `MatchedRuntimeEvidence` is emitted with summed counts, unioned time window, and the highest-confidence reason wins.
- AC1.12: `LOG_PROXY_PATH_PREFIXES` env var, `parseProxyPrefixes`, `stripProxyPrefix`, the `PROXY_PREFIXES` constant, and the `normalizePath` proxy-strip step are deleted from `endpointPathNormalizer.ts`.
- AC1.13: Tests that previously asserted env-driven proxy stripping are deleted.
- AC1.14: `normalizePath` post-removal behaves as: strip query, split, per-segment id-normalize, join.

**Acceptance criteria — Section 2**
- AC2.1: Liquibase changeset `126-discovery-run-service-id-set-null.sql` exists, is registered in `db.changelog-master.yaml`, and changes the FK action to `ON DELETE SET NULL` while preserving `DEFERRABLE INITIALLY DEFERRED`.
- AC2.2: Deleting a row from `services` no longer raises an FK violation; child `discovery_run` rows have `service_id` set to NULL.
- AC2.3: At run start, when `serviceId` is non-null, `config_snapshot.serviceIdentitySnapshot` is populated with the six fields (`serviceId`, `serviceName`, `serviceType`, `applicationId`, `repoLocation`, `repoSubfolder`) before async `startRun` begins.
- AC2.4: AMS `createRun` writes the snapshot map into `config_snapshot.serviceIdentitySnapshot` atomically with run creation.
- AC2.5: `DiscoveryRunsList.tsx` renders the snapshot-derived service name plus a warning-amber `"Service deleted"` chip when `service_id` is NULL and the snapshot's `serviceName` is present.
- AC2.6: `DiscoveryRunDetailView.tsx` header renders the same name + chip in orphaned runs.
- AC2.7: Legacy orphan rows (no snapshot, `service_id` NULL) render `"Service deleted"` alone (no name suffix); the page does not crash.
- AC2.8: Non-orphaned runs (`service_id` resolves) render unchanged — no chip is added.

**Acceptance criteria — Section 3**
- AC3.1: `DiscoveryRunDto.java` exposes `@JsonProperty("architecture_id") UUID architectureId` at record position 3, between `projectId` and `serviceId`.
- AC3.2: `DiscoveryRunService.toDto()` passes `entity.getArchitectureId()` at position 3.
- AC3.3: AMS JSON response includes `"architecture_id": "<uuid>"` on every `GET /discovery/runs/{runId}` and matching list endpoints.
- AC3.4: Frontend "Save to canonical model" modal resolves the architecture name from `ArchitectureContext.architectures` using `run.architecture_id` (no frontend code change required; the type already declares the field).

## Visual Design
No visual mockups were provided in `planning/visuals/` (folder exists but is empty). UI shape is constrained by precedent: the M input matches `WorkItemCreateModal.tsx:245-253` (plain numeric input + hint span); the "Service deleted" chip reuses the warning-amber style of `logsAttachWarningChipPartial` in `DiscoveryRunDetailView.module.css:189-201`.

## Existing Code to Leverage

**`discovery-service/src/services/runtimeEvidence/endpointRuntimeMatcher.ts`**
- Tier-1 (exact) and Tier-2 (equivalent-placeholder) matching is already implemented at lines 245-283; Tier-3 slots in as a third pass under the same `pickBest` / `ambiguousObservations` flow.
- `PLACEHOLDER_SEGMENT_REGEX` (line 65) is reused for the literal-first-segment guardrail.
- `buildMatchedEvidence` (lines 177-201) is extended (not replaced) to map `'suffix_match'` -> `'low'`.

**`discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts`**
- The orchestrator already receives the full `configSnapshot` (lines 152-154) and reads `inputArtifacts.logFiles[]` via `readLogFileArtifacts` (lines 181-196). The new `readMaxLogPathPrefixSegments` helper sits alongside it; no new fetch needed.
- The matcher call (lines 495-498) is the single threading point — extend the call signature to pass the options object.

**AMS log-files PATCH (`DiscoveryRunController.patchLogFileArtifacts` line 274, `DiscoveryRunService.patchLogFileArtifacts` ~line 681)**
- Existing endpoint that already merges into `config_snapshot.inputArtifacts`. Section 1 piggy-backs on it by adding a sibling `runtimeEvidenceConfig` key — no new controller / service / route is added.

**`frontend/src/components/ProductView/WorkItemCreateModal.tsx:245-253`**
- Canonical numeric-input + hint-span pattern. Both `StartDiscoveryRunModal` and `PreflightModal` mirror this for the M control.

**`frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css:189-201` (`logsAttachWarningChipPartial`)**
- Warning-amber chip style reused for the new `serviceDeletedChip` class.

## Out of Scope
- Soft-delete pattern for `services` (option a rejected during shaping).
- Cascade-delete of `discovery_run` rows on service delete (option b rejected during shaping).
- Backward-compatibility shimming for runs created before Spec 1 multi-arch migration (no backfill of `architecture_id` on historical rows; user explicitly skipped during shaping).
- Re-prompting for M in the reprocess flow (the existing `POST /discovery/log-enrichment` reprocess route is not extended; user explicitly skipped during shaping).
- Re-association of orphaned runs when a service is later re-created with the same name (would require additional UI/API work; future spec if needed).
- Soft-tightening `DiscoveryRunDto.matchReason` to a typed union (kept as `string` for backward compat with persisted rows; follow-up only).
- Any change to discovery-service pipeline step names or `VALID_STEPS` (Section 1 modifies the existing runtime-evidence sub-stage inside `runDiscoveryV3`).
- Any new backend endpoint (Section 1 reuses log-files PATCH; Section 2 reuses createRun + standard fetch paths; Section 3 adds no endpoint).
- Any frontend or gateway change for Section 3 (the DTO field flows through the existing pass-through at `gateway/src/routes/discovery.ts:561` and the frontend already declares the field on `DiscoveryRunDto.architecture_id?: string`).
