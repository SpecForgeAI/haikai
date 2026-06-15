# Discovery Run Robustness — Spec Folder

This spec bundles three issues found during real-world internal testing of the discovery run flow. All three are robustness / correctness fixes around the discovery-run lifecycle. The user accepted all major design decisions during shaping; the spec-shaper should focus on code inspection and only surface genuinely-product-level calls.

## Section 1 — Configurable Log Path Prefix Tolerance

The just-shipped runtime-evidence matcher (Spec 5) does exact + placeholder-equivalent path matching. In practice, web access logs collected from proxy components carry leading path prefixes that the proxy strips before forwarding to the backend (e.g. log says `GET /ui/job/12345/succinct`, backend code defines `GET /job/{id}/succinct`). Spec 5's matcher misses these.

An earlier hotfix introduced an env var `LOG_PROXY_PATH_PREFIXES` (default `/ui`) to strip known prefixes. The user pushed back: env-configurable prefix lists don't scale across many services / scans / log sources. **Remove the env var entirely.** Replace with a tier-3 "tail-suffix" matcher.

### Design (user-confirmed)

- Add a **per-run integer `M`** = "max log path prefix segments to tolerate during matching"
  - Default `M = 1`
  - Allowed range `0..5`
  - `M = 0` disables suffix matching (only exact + placeholder-equivalent)
- M is set in the modal at run-start time:
  - `StartDiscoveryRunModal` (the new minimal modal for the default flow — Spec 4)
  - `PreflightModal` (the Library-Scan flow — extended by Spec 4)
- M is persisted on the discovery run alongside the log artifacts:
  - Location: `config_snapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments` (sibling to the existing `config_snapshot.inputArtifacts.logFiles[]` key)
- The discovery-service's runtime-evidence matcher reads M from the run's `config_snapshot` and applies tier-3 suffix matching:
  - **Match rule:** candidate template segments equal the LAST K segments of the log's normalized path, where K = candidate's segment count
  - **Cap:** `log_segs - candidate_segs <= M`
  - **Guardrail:** candidate template's first non-empty segment MUST be a literal (rejects greedy patterns like `/{id}/foo`)
  - Use existing placeholder-equivalence rules for the segment-by-segment comparison
  - **Confidence:** `'low'`
  - **Reason:** `'suffix_match'`
- **Per-candidate aggregate merge:** when multiple aggregates point at the same candidate (e.g. both `/ui/job/12345/succinct` and `/job/12345/succinct` are in the same log file), merge them into ONE `MatchedRuntimeEvidence` per candidate: sum counts, union time window, pick highest-confidence reason.

### What to remove

- Env var `LOG_PROXY_PATH_PREFIXES` (introduced in the recent hotfix)
- `parseProxyPrefixes()` / `stripProxyPrefix()` helpers in `endpointPathNormalizer.ts`
- The proxy-strip step inside `normalizePath()`
- Related tests for env-driven proxy stripping

### Tests

- Updated normalizer tests (no proxy-strip; the suffix-match logic moves to the matcher)
- New matcher tests for tier-3 suffix matching:
  - Match with M=1 and one prefix segment
  - Match with M=2 and two prefix segments
  - Reject with M=1 and two prefix segments (over the cap)
  - Reject candidate `/{id}/foo` (placeholder first segment — guardrail)
  - Per-candidate merge: two aggregates pointing at the same candidate produce one matched evidence with summed counts
- Frontend tests for the modal input (validation, persistence into run-start payload)
- AMS / gateway tests if persistence path needs updating

## Section 2 — Service Deletion Breaks Project Save (Optional FK with SET NULL)

Currently, when a user deletes a `Service` from the application architecture domain, any `discovery_run` rows that referenced that service via a foreign key become orphaned, and the project can't be saved because the FK constraint is violated.

### Design (user-confirmed)

**Option (c)** — Make the FK optional with `ON DELETE SET NULL`, AND snapshot the service identity at run start so orphaned runs are still useful.

- Liquibase changeset: alter `discovery_run.service_id` to nullable; add `ON DELETE SET NULL` to the FK constraint
- At run start (discovery-service `runManager.startRun`), snapshot the service identity into `config_snapshot.serviceIdentitySnapshot`:
  - `serviceId` (the original FK value)
  - `serviceName` (resolved from the architecture-model-service at run-start time)
  - Any other identifying fields that would help a reviewer recognize the service (e.g. tier, repo URL — pending shaper investigation)
- Frontend UI affordance for orphaned runs:
  - On the run-list surface, runs where `service_id` is NULL but `serviceIdentitySnapshot.serviceName` exists render with a chip / badge "Service deleted" adjacent to the service name (shown from the snapshot)
  - The run remains expandable, candidates remain visible, but no link to a current service exists
- Existing run logic unaffected for non-orphaned runs

### Backward compat

- Existing runs in the DB don't have `serviceIdentitySnapshot`; for those, the orphaned-run UI just shows "Service deleted (id: <uuid>)" using the FK value alone — graceful degradation
- No data backfill is required

## Section 3 — discovery_run.architecture_id Not Exposed on the AMS DTO

The just-shipped multi-architecture migration added `architecture_id NOT NULL FK` to `discovery_run` (Liquibase changeset 091). The frontend has a typed `DiscoveryRunDto` field `architecture_id?: string`. But the AMS Java DTO (`DiscoveryRunDto.java`) was never updated when the field was added — it doesn't expose `architectureId` in the record constructor or in `toDto()`. So the JSON the frontend receives has no `architecture_id`, the frontend reads it as `undefined`, and the "Save to canonical model" modal blocks with "Run is missing architecture_id; cannot save back."

### Design (no ambiguity — just an oversight)

Two-line AMS fix:
1. `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoveryRunDto.java` — add `@JsonProperty("architecture_id") UUID architectureId,` to the record constructor (after `projectId` to match entity declaration order)
2. `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java` — `toDto()` method around line 807 — pass `entity.getArchitectureId()` as the corresponding argument

### What this unblocks

- "Save to canonical model" modal shows the correct architecture name and the Save button works
- Per-run architecture binding becomes available to any other frontend code that needs it
- Spec 6 / Spec 7 surfaces that look up architecture by id can use this field directly

No frontend change, no gateway change, no migration. The DB column is already NOT NULL and populated.

### Tests

- AMS test asserting `toDto(...)` emits `architecture_id` in the JSON output
- One frontend test (or existing test extension) confirming the Save modal resolves the architecture name correctly when the run carries `architecture_id`

## Why these three are bundled

All three are discovery-run lifecycle robustness issues found in one internal testing session. Section 1 introduces a new persisted run-config field; Section 2 changes the run's FK behaviour and adds a snapshot field; Section 3 exposes an already-persisted field that's missing from the API surface. Bundling keeps the shaping cycle tight and the spec history coherent.

## Scope constraints

- **NO new top-level discovery-service pipeline step.** Section 1 modifies the existing runtime-evidence sub-stage inside `runDiscoveryV3`.
- **NO new backend endpoints.** Section 2 reuses existing run-fetch / candidate-fetch paths.
- **NO frontend changes for Section 3.** The frontend type is already correct.
- Per saved feedback: `discovery-service/src/**` edits must NOT happen during a live tsx watch run.
