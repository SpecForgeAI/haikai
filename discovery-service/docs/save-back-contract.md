# Save-Back Contract

Internal developer documentation for the candidate-to-entity save-back flow:
how approved discovery candidates are promoted into the canonical architecture
meta-model.

## Overview

The save-back flow takes discovery candidates (Phase 1d output) that have
been reviewed and approved, converts them into canonical meta-model entities,
and persists them into the architecture model. The flow supports two modes
(auto and manual), enforces idempotency guarantees, and maintains provenance
mappings between candidates and their created entities.

**Primary implementation**: `mcp-server/src/services/candidateSaveBackService.ts`

## Approval Workflow

Candidates progress through the following statuses during the review and
save-back lifecycle:

```
proposed / pending_review
       |
       v
  +----+----+----+
  |         |    |
  v         v    v
approved  rejected  deferred
  |
  v
committed
```

| Status | Description |
|---|---|
| `proposed` | Initial status from pipeline output |
| `pending_review` | Equivalent to `proposed` for review purposes. Existing `proposed` rows are migrated to `pending_review` during the Increment 13 database migration. |
| `approved` | User has reviewed and accepted the candidate |
| `rejected` | User has reviewed and rejected the candidate |
| `deferred` | Review deferred to a later time (run-scoped) |
| `committed` | Candidate has been promoted to the canonical model via save-back |

The `committed` status is the terminal state for save-back. Once a candidate
is committed, it is excluded from future save-back executions.

## Save-Back Modes

### Auto Mode (default)

Used by the pipeline for automatic promotion of high-confidence candidates.

**Eligibility filter**:
- `confidence >= CANDIDATE_AUTO_ACCEPT_THRESHOLD` (0.75)
- `status` not in `EXCLUDED_STATUSES` (`['rejected', 'merged', 'committed']`)
- `review_status` not in `REVIEW_EXCLUDED_STATUSES` (`['rejected', 'deferred']`)

### Manual Mode

Used by the "Save All Approved" user action for explicit promotion of
reviewed candidates.

**Eligibility filter**:
- `review_status === 'approved'` only
- `status` not in `EXCLUDED_STATUSES` (`['rejected', 'merged', 'committed']`)
- Ignores confidence threshold entirely

## POST Endpoint

### Gateway Route

```
POST /projects/:projectId/runs/:runId/save-approved
```

**File**: `gateway/src/routes/discovery.ts` (line ~1172)

The gateway proxies this request to the MCP server:

```
POST {mcpBaseUrl}/mcp/tools/save_approved_candidates
```

**Request body** (forwarded to MCP):
```json
{
  "project_id": "<uuid>",
  "run_id": "<uuid>",
  "mode": "manual"
}
```

### MCP Route

**File**: `mcp-server/src/routes/saveApprovedCandidatesRoute.ts`

Mounts at `/mcp/tools/save_approved_candidates`. Calls
`saveDiscoveryCandidatesToModel(projectId, runId, mode)`.

### Response

```json
{
  "projectId": "<uuid>",
  "runId": "<uuid>",
  "entitiesCreated": 5,
  "entitiesSkipped": 2,
  "candidatesCommitted": 7
}
```

| Field | Type | Description |
|---|---|---|
| `projectId` | `string` | Project UUID |
| `runId` | `string` | Discovery run UUID |
| `entitiesCreated` | `number` | Count of new entities added to the model |
| `entitiesSkipped` | `number` | Count of entities that already existed (matched by name) |
| `candidatesCommitted` | `number` | Total candidates processed (created + skipped) |

## Orchestration Flow

The `saveDiscoveryCandidatesToModel` function in
`mcp-server/src/services/candidateSaveBackService.ts` follows a
GET-merge-PUT pattern:

1. **Validate project**: Fetch project via `archModelClient.getProjectById(projectId)`.
   Derive the model filename from `project.name`.

2. **Fetch candidates**: Get all candidates for the run via
   `archModelClient.getCandidatesByRun(projectId, runId)`.

3. **Filter to eligible candidates**: Apply mode-specific filters (see
   [Save-Back Modes](#save-back-modes)).

4. **Exclude already-saved candidates**: Fetch existing
   `CandidateEntityMappingDto` records for the run and remove candidates
   with existing mappings from the eligible set (see
   [Idempotency Guarantees](#idempotency-guarantees)).

5. **Early return**: If no eligible candidates remain, return
   `{ entitiesCreated: 0, entitiesSkipped: 0, candidatesCommitted: 0 }`.

6. **GET existing model**: Fetch via `archModelClient.getModel(filename)`.
   If no model exists, create an empty model shell with all entity and
   relationship arrays initialized.

7. **Build depth map**: Compute candidate depth via `buildDepthMap(eligibleCandidates)`.
   Root candidates (no parent or parent not in eligible set) are depth 0;
   children are depth 1, grandchildren depth 2, etc.

8. **Sort by ascending depth**: Ensures parent entities are created before
   their children, enabling correct FK resolution.

9. **Merge candidates into model**: For each candidate in depth order:
   a. Resolve the `targetArrayKey` from `CANDIDATE_TYPE_CONFIG`.
   b. Check for existing entity with the same `name` in the target array
      (case-sensitive idempotent matching).
   c. If entity exists: skip creation, record existing entity ID in
      `candidateIdToEntityId` map, increment `entitiesSkipped`.
   d. If entity does not exist: convert via `convertCandidateToEntity`,
      push to target array, record new entity ID, increment `entitiesCreated`.

10. **PUT updated model**: Persist via `archModelClient.putModel(filename, model)`.

11. **Update candidate statuses**: For each processed candidate, update
    `status` to `'committed'` and `review_status` to `'committed'` via
    `archModelClient.updateCandidate`. The candidate's `data` payload is
    enriched with `committedEntityId` and `committedEntityType`. Status
    update failures are logged as warnings but do not fail the overall
    operation (the model is already saved).

12. **Persist provenance mappings**: Create `CandidateEntityMappingDto`
    records via `archModelClient.bulkCreateCandidateEntityMappings`. Each
    mapping records the `candidate_id`, `run_id`, `entity_type`,
    `entity_id`, and `action` ('created' or 'reused'). Mapping persistence
    failures are logged as warnings but do not fail the operation.

## Entity Mapping Persistence

### `CandidateEntityMappingDto`

```typescript
interface CandidateEntityMappingDto {
  id: string;            // Server-generated UUID
  candidate_id: string;  // Discovery candidate ID
  run_id: string;        // Discovery run UUID
  entity_type: string;   // Model array key (e.g., 'applications', 'services')
  entity_id: string;     // Created/reused entity ID in the model
  action: string;        // 'created' or 'reused'
  created_at: string;    // Server-generated ISO 8601 timestamp
}
```

Persisted to the `discovery_candidate_entity_mapping` table via the
architecture-model-service.

### Java Entity

`DiscoveryCandidateEntityMappingEntity` in the architecture-model-service
provides the JPA persistence layer for these mappings.

## Candidate Type Configuration

The `CANDIDATE_TYPE_CONFIG` maps each `CandidateType` to its target model
location:

| Candidate Type | Target Array Key | ID Prefix | Parent FK Field |
|---|---|---|---|
| `application` | `applications` | `app-` | (none -- top-level) |
| `app_component` | `app_components` | `comp-` | `application_id` |
| `service` | `services` | `svc-` | `application_id` |
| `interface` | `interfaces` | `ifc-` | `service_id` |
| `logical_entity` | `logical_data_entities` | `lde-` | (none -- top-level) |
| `physical_entity` | `physical_data_entities` | `pde-` | (none -- top-level) |
| `data_entity` | `physical_data_entities` | `pde-` | (none -- top-level) |
| `business_process` | `business_processes` | `bp-` | (none -- top-level) |

Types with a `parentFkField` require a parent candidate to have been
processed first (guaranteed by the depth-sorted processing order).

## Idempotency Guarantees

The save-back flow provides multiple layers of idempotency protection:

### 1. Mapping-Based Exclusion (Primary)

Before processing candidates, the flow fetches existing
`CandidateEntityMappingDto` records for the run via
`archModelClient.getCandidateEntityMappingsByRun(projectId, runId)`.
Candidates whose IDs appear in the existing mappings are excluded from
processing. This prevents any candidate from being processed twice,
regardless of its current status.

If the mapping fetch fails, the flow proceeds without exclusion and relies
on the secondary idempotency layer.

### 2. Name-Based Model Matching (Secondary)

During the merge step, for each candidate the flow checks whether an entity
with the same `name` already exists in the target model array. If it does,
the existing entity is reused (its ID is recorded in
`candidateIdToEntityId`) and no duplicate is created. This catches cases
where a candidate was previously saved but its mapping was lost.

### 3. Status Gating (Tertiary)

- The `EXCLUDED_STATUSES` array (`['rejected', 'merged', 'committed']`)
  prevents candidates in terminal states from being processed.
- In manual mode, only candidates with `review_status === 'approved'` are
  eligible; `committed` candidates are filtered out by the `EXCLUDED_STATUSES`
  check since their `status` is also `'committed'`.
- After successful save-back, candidate `review_status` transitions to
  `'committed'`, preventing the candidate from being processed again even
  if the mapping-based exclusion is bypassed.

### Re-Execution Behavior

Re-executing `POST /projects/:projectId/runs/:runId/save-approved` after a
successful save-back is safe and produces:
- `entitiesCreated: 0` (all entities already exist)
- `entitiesSkipped: 0` (all candidates excluded by mapping check)
- `candidatesCommitted: 0` (no eligible candidates)

## Key Source Files

| File | Responsibility |
|---|---|
| `mcp-server/src/services/candidateSaveBackService.ts` | Core save-back logic: filtering, conversion, model merge, idempotency |
| `mcp-server/src/routes/saveApprovedCandidatesRoute.ts` | MCP route handler for save_approved_candidates |
| `gateway/src/routes/discovery.ts` | Gateway proxy route for save-approved |
| `mcp-server/src/services/archModelClient.ts` | HTTP client for candidate/mapping/model CRUD |
| `discovery-service/src/types/candidate.ts` | `DiscoveryCandidate`, `CandidateStatus`, `CandidateType` types |

## Key Constants

| Constant | Value | Description |
|---|---|---|
| `CANDIDATE_AUTO_ACCEPT_THRESHOLD` | `0.75` | Confidence threshold for auto-mode eligibility |
| `EXCLUDED_STATUSES` | `['rejected', 'merged', 'committed']` | Statuses that exclude a candidate from processing |
| `REVIEW_EXCLUDED_STATUSES` | `['rejected', 'deferred']` | Review statuses excluded in auto mode |
