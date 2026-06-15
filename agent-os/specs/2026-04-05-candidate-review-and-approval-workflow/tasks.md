# Task Breakdown: Candidate Review and Approval Workflow

## Overview
Total Tasks: 46 (across 6 task groups)

Increment 13 of 16 for the legacy/current-state discovery capability. This increment introduces user-governed review of discovery candidates (approve/reject/defer), gates save-back by review state, and adds a lightweight audit trail. The work spans four layers: database migration, Java backend (entity + DTO + service + controller), gateway proxy routes, MCP save-back service modification, and React frontend (API client + table UI + filter bar + save-all-approved button).

## Task List

### Database and Backend Entity Layer

#### Task Group 1: Database Migration and JPA Entity Extension
**Dependencies:** None

- [x] 1.0 Complete database migration and JPA entity extension for review fields
  - [x] 1.1 Write 4 focused tests for the review fields on DiscoveryCandidateEntity
    - Test 1: Entity with review_status defaults to "pending_review" when built via @Builder
    - Test 2: Entity accepts all four valid review_status values (pending_review, approved, rejected, deferred)
    - Test 3: Audit fields (reviewed_by, reviewed_at, previous_review_status) are nullable and round-trip correctly
    - Test 4: toDto conversion includes all four new fields in the DiscoveryCandidateDto record
  - [x] 1.2 Create Liquibase migration SQL file `074-candidate-review-fields.sql`
    - Add `review_status VARCHAR(32) NOT NULL DEFAULT 'pending_review'` to `discovery_candidate`
    - Add `reviewed_by TEXT` (nullable) to `discovery_candidate`
    - Add `reviewed_at TIMESTAMPTZ` (nullable) to `discovery_candidate`
    - Add `previous_review_status VARCHAR(32)` (nullable) to `discovery_candidate`
    - UPDATE existing rows: SET `review_status = 'pending_review'` (covered by DEFAULT clause for new rows; explicit UPDATE for rows with status = 'proposed' to ensure they get 'pending_review')
    - Add index `idx_discovery_candidate_run_id_review_status` on `(run_id, review_status)`
  - [x] 1.3 Register the migration in `db.changelog-master.yaml`
    - Add changeset `074-candidate-review-fields` after the existing `073-discovery-candidate-entity-mapping` entry
    - Use precondition `columnExists` guard on `review_status` to ensure idempotency
  - [x] 1.4 Extend `DiscoveryCandidateEntity.java` with four new fields
    - `reviewStatus` (String, `@Column(name = "review_status")`, `@Builder.Default` = "pending_review")
    - `reviewedBy` (String, nullable, `@Column(name = "reviewed_by")`)
    - `reviewedAt` (Instant, nullable, `@Column(name = "reviewed_at")`)
    - `previousReviewStatus` (String, nullable, `@Column(name = "previous_review_status")`)
    - Add `@Index` on `(run_id, review_status)` in the `@Table` annotation
  - [x] 1.5 Extend `DiscoveryCandidateDto.java` record with four new parameters
    - `@JsonProperty("review_status") String reviewStatus`
    - `@JsonProperty("reviewed_by") String reviewedBy`
    - `@JsonProperty("reviewed_at") String reviewedAt`
    - `@JsonProperty("previous_review_status") String previousReviewStatus`
  - [x] 1.6 Update `DiscoveryCandidateService.toDto()` to map the four new fields
    - Map `entity.getReviewStatus()` to dto `reviewStatus`
    - Map `entity.getReviewedBy()` to dto `reviewedBy`
    - Map `entity.getReviewedAt()` to dto `reviewedAt` (convert Instant to ISO-8601 string, null-safe)
    - Map `entity.getPreviousReviewStatus()` to dto `previousReviewStatus`
  - [x] 1.7 Update `DiscoveryCandidateService.bulkCreate()` to map review fields from DTO to entity
    - Default `reviewStatus` to "pending_review" if not provided in the DTO
    - Allow passthrough of `reviewedBy`, `reviewedAt`, `previousReviewStatus` if provided
  - [x] 1.8 Ensure database layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration SQL is syntactically valid
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Migration adds all four columns with correct types and defaults
- Existing rows get `review_status = 'pending_review'`
- Entity and DTO include all four new fields
- `toDto()` correctly maps all review fields
- The 4 tests from 1.1 pass

---

### Backend API Layer

#### Task Group 2: Review Action Endpoint (PATCH)
**Dependencies:** Task Group 1

- [x] 2.0 Complete the PATCH review endpoint on DiscoveryCandidateController
  - [x] 2.1 Write 5 focused tests for the review endpoint
    - Test 1: PATCH returns 200 with updated DTO when review_status is set to "approved"
    - Test 2: PATCH captures previous_review_status from the candidate's current value
    - Test 3: PATCH defaults reviewed_by to "anonymous" when not provided in request body
    - Test 4: PATCH returns 400 when review_status is an invalid value (e.g., "invalid")
    - Test 5: PATCH returns 404 when candidateId does not exist
  - [x] 2.2 Add `reviewCandidate()` method to `DiscoveryCandidateService.java`
    - Accept parameters: `runId`, `candidateId`, `reviewStatus`, `reviewedBy` (nullable)
    - Validate `reviewStatus` is one of: `approved`, `rejected`, `deferred` (throw `IllegalArgumentException` for invalid values)
    - Find candidate by ID, verify it belongs to the run
    - Capture `entity.getReviewStatus()` as `previousReviewStatus` before overwriting
    - Set `reviewStatus`, `reviewedBy` (default to "anonymous" if null/blank), `reviewedAt = Instant.now()`, `previousReviewStatus`
    - Save and return DTO via `toDto()`
    - Throw appropriate exceptions: `IllegalArgumentException` for invalid status, entity not found, or run mismatch
  - [x] 2.3 Add PATCH endpoint to `DiscoveryCandidateController.java`
    - Path: `/{candidateId}/review`
    - Method: `@PatchMapping("/{candidateId}/review")`
    - Request body: Map with `review_status` (required) and `reviewed_by` (optional)
    - Delegates to `discoveryCandidateService.reviewCandidate()`
    - Return 200 with updated `DiscoveryCandidateDto` on success
    - Return 400 for invalid `review_status`
    - Return 404 for candidate not found (catch `IllegalArgumentException` and inspect message)
  - [x] 2.4 Ensure review endpoint tests pass
    - Run ONLY the 5 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- PATCH endpoint correctly updates review_status, reviewed_by, reviewed_at, previous_review_status
- Validation rejects invalid review_status values
- 404 returned for missing candidates
- Default "anonymous" for missing reviewed_by
- The 5 tests from 2.1 pass

---

#### Task Group 3: Save-Approved Backend Endpoint
**Dependencies:** Task Group 1

- [x] 3.0 Complete the save-approved backend endpoint and save-back modification
  - [x] 3.1 Write 4 focused tests for save-back mode support
    - Test 1: In `auto` mode, candidates with `review_status = 'rejected'` are excluded from eligibility
    - Test 2: In `auto` mode, candidates with `review_status = 'deferred'` are excluded from eligibility
    - Test 3: In `manual` mode, only candidates with `review_status = 'approved'` are eligible (ignores confidence threshold)
    - Test 4: In `manual` mode, candidates with `review_status = 'pending_review'` and high confidence are excluded
  - [x] 3.2 Modify `saveDiscoveryCandidatesToModel()` in `mcp-server/src/services/candidateSaveBackService.ts`
    - Add optional `mode` parameter: `'auto' | 'manual'`, defaulting to `'auto'`
    - Auto path (existing + enhanced): filter on `confidence >= CANDIDATE_AUTO_ACCEPT_THRESHOLD` AND `status not in EXCLUDED_STATUSES` AND `review_status not in ['rejected', 'deferred']`
    - Manual path (new): filter on `review_status === 'approved'` AND `status not in EXCLUDED_STATUSES` (ignore confidence threshold)
    - Update the eligibility filter block (Step 3) to branch on mode
  - [x] 3.3 Extend `DiscoveryCandidateDto` in `mcp-server/src/services/archModelClient.ts`
    - Add `review_status?: string` field to the interface
    - This allows the filter predicates in save-back to read the review_status field
  - [x] 3.4 Add `POST /api/model/projects/{projectId}/discovery/runs/{runId}/save-approved` endpoint
    - Option A: Add to `DiscoveryCandidateController.java` or a new `DiscoverySaveBackController.java`
    - Delegates to a service method that fetches approved candidates and invokes save-back logic
    - Alternatively, this can be handled entirely by the gateway calling the MCP save-back function with `mode = 'manual'`
    - Return 200 with `SaveBackResult` (entitiesCreated, entitiesSkipped, candidatesCommitted)
  - [x] 3.5 Ensure save-back tests pass
    - Run ONLY the 4 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Auto mode preserves existing behavior but additionally excludes rejected/deferred candidates
- Manual mode selects only approved candidates regardless of confidence
- Save-back result accurately reflects counts
- The 4 tests from 3.1 pass

---

### Gateway Proxy Layer

#### Task Group 4: Gateway Proxy Routes for Review and Save-Approved
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete gateway proxy routes for review and save-approved actions
  - [x] 4.1 Write 4 focused tests for the new gateway routes
    - Test 1: PATCH `/projects/:projectId/runs/:runId/candidates/:candidateId/review` proxies to architecture-model-service and returns 200
    - Test 2: PATCH review route returns 503 on network error
    - Test 3: POST `/projects/:projectId/runs/:runId/save-approved` proxies correctly and returns 200
    - Test 4: POST save-approved route returns 503 on network error
  - [x] 4.2 Add PATCH review proxy route in `gateway/src/routes/discovery.ts`
    - Path: `/projects/:projectId/runs/:runId/candidates/:candidateId/review`
    - Proxy to: `{architectureModelServiceBaseUrl}/api/model/projects/{projectId}/discovery/runs/{runId}/candidates/{candidateId}/review`
    - Forward JSON body transparently
    - Follow existing proxy pattern: requestId logging, `Content-Type: application/json`, 503 on network error
  - [x] 4.3 Add POST save-approved proxy route in `gateway/src/routes/discovery.ts`
    - Path: `/projects/:projectId/runs/:runId/save-approved`
    - Proxy to the MCP server at `{mcpBaseUrl}/mcp/tools/save_approved_candidates` with `{ sessionId: 'gateway', projectId, runId }` body
    - Follow existing proxy pattern: requestId logging, 503 on network error
  - [x] 4.4 Ensure gateway route tests pass
    - Run ONLY the 4 tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- PATCH review route proxies correctly to backend and forwards response status/body
- POST save-approved route proxies correctly and forwards response
- Network errors produce 503 with structured error body
- The 4 tests from 4.1 pass

---

### Frontend Layer

#### Task Group 5: Frontend API Client and Candidate Table UI
**Dependencies:** Task Group 4

- [x] 5.0 Complete frontend API client, candidate table review actions, filter bar, and save-all-approved button
  - [x] 5.1 Write 6 focused tests for frontend review workflow
    - Test 1: `reviewCandidate()` sends PATCH request with correct URL and body
    - Test 2: `saveApprovedCandidates()` sends POST request with correct URL
    - Test 3: DiscoveryCandidateTable renders action buttons (Approve, Reject, Defer) per row
    - Test 4: Clicking Approve calls `reviewCandidate()` with `review_status = 'approved'`
    - Test 5: Filter bar filters candidates by review_status when a filter chip is clicked
    - Test 6: "Save All Approved" button is visible when at least one candidate has `review_status === 'approved'`
  - [x] 5.2 Extend `DiscoveryCandidateDto` in `frontend/src/api/discoveryApi.ts`
    - Add `review_status: string` field
    - Add `reviewed_by: string | null` field
    - Add `reviewed_at: string | null` field
    - Add `previous_review_status: string | null` field
  - [x] 5.3 Add `reviewCandidate()` function to `frontend/src/api/discoveryApi.ts`
    - Signature: `reviewCandidate(projectId: string, runId: string, candidateId: string, reviewStatus: string, reviewedBy?: string): Promise<DiscoveryCandidateDto>`
    - Sends `PATCH` to `${GATEWAY_BASE}/api/v1/discovery/projects/${projectId}/runs/${runId}/candidates/${candidateId}/review`
    - Body: `{ review_status: reviewStatus, reviewed_by: reviewedBy }`
    - Follow existing pattern: check `res.ok`, throw on failure, return typed JSON
  - [x] 5.4 Add `saveApprovedCandidates()` function to `frontend/src/api/discoveryApi.ts`
    - Signature: `saveApprovedCandidates(projectId: string, runId: string): Promise<{ entitiesCreated: number; entitiesSkipped: number; candidatesCommitted: number }>`
    - Sends `POST` to `${GATEWAY_BASE}/api/v1/discovery/projects/${projectId}/runs/${runId}/save-approved`
    - Follow existing pattern: check `res.ok`, throw on failure, return typed JSON
  - [x] 5.5 Add review state filter bar to `DiscoveryCandidateTable.tsx`
    - Render filter chips above the table: All, Pending, Approved, Rejected, Deferred
    - Each chip shows a count badge (e.g., "Pending (12)")
    - Default filter is "All"
    - Filtering is client-side: filter `candidates` array by `review_status`
    - Track active filter in `useState<string>('all')`
    - Add CSS classes in `DiscoveryRunDetailView.module.css`: `.filterBar`, `.filterChip`, `.filterChipActive`, `.filterChipCount`
  - [x] 5.6 Add Actions column to `DiscoveryCandidateTable.tsx`
    - Add "Actions" `<th>` header after the existing columns
    - Render three buttons per row: Approve, Reject, Defer
    - Disable the button matching the current `review_status` (e.g., hide Approve on already-approved rows)
    - Each button calls `reviewCandidate()` with the appropriate status
    - Implement optimistic local state update: immediately update the candidate's `review_status` in local state, revert on error
    - Show a loading indicator per row during the API call (track `loadingCandidateId` in state)
  - [x] 5.7 Replace generic "Status" column with `review_status` display
    - Change the Status column to display `candidate.review_status` instead of `candidate.status`
    - Keep `candidate.status` accessible (perhaps as a tooltip or secondary display) since it represents pipeline lifecycle status
  - [x] 5.8 Add review-status row tinting styles to `DiscoveryRunDetailView.module.css`
    - `.rowApproved`: subtle green-tinted background (`#f1f8e9` or similar)
    - `.rowRejected`: subtle red-tinted background (`#fef0f0` or similar)
    - `.rowDeferred`: subtle grey-tinted background (`#f5f5f5` or similar)
    - `.rowPending`: no tint (default)
    - Apply appropriate class to each `<tr>` based on `candidate.review_status`
  - [x] 5.9 Add "Save All Approved" button to `DiscoveryRunDetailView.tsx`
    - Render button below the "View Candidates" toggle when candidates are visible
    - Visible only when at least one candidate has `review_status === 'approved'`
    - Button triggers `saveApprovedCandidates(projectId, runId)`
    - Show loading/success/error state during and after the API call
    - After successful save, re-fetch candidates to reflect updated statuses (approved candidates become `committed`)
    - Pass the necessary callback or state down to `DiscoveryCandidateTable` or lift state up to `DiscoveryRunDetailView`
  - [x] 5.10 Add action button styles to `DiscoveryRunDetailView.module.css`
    - `.actionButton`: small inline button style (compact padding, cursor pointer)
    - `.actionButtonApprove`: green-tinted text/border
    - `.actionButtonReject`: red-tinted text/border
    - `.actionButtonDefer`: grey-tinted text/border
    - `.actionButtonDisabled`: muted/disabled appearance
    - `.rowLoading`: loading indicator style (opacity or spinner)
    - `.saveApprovedButton`: prominent action button style
    - `.saveApprovedSuccess`: success feedback style
  - [x] 5.11 Ensure frontend tests pass
    - Run ONLY the 6 tests written in 5.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- API client functions correctly call the review and save-approved endpoints
- Action buttons per row call reviewCandidate with correct parameters
- Optimistic update reflects immediately; reverts on error
- Filter bar correctly filters displayed candidates by review_status with count badges
- Row tinting reflects review_status visually
- "Save All Approved" button appears only when approved candidates exist
- After save-approved, candidate list refreshes showing committed status
- The 6 tests from 5.1 pass

---

### Discovery Service Type Extension

#### Task Group 6: CandidateStatus Union Extension and Test Review
**Dependencies:** Task Groups 1-5

- [x] 6.0 Extend discovery-service types and review all tests across layers
  - [x] 6.1 Extend `CandidateStatus` union in `discovery-service/src/types/candidate.ts`
    - Add `'pending_review'` to the union
    - Add `'deferred'` to the union
    - Update JSDoc comments to document the two new statuses
  - [x] 6.2 Extend `DiscoveryCandidateDto` in `mcp-server/src/services/archModelClient.ts`
    - Verify `review_status` field was added in Task 3.3; if not, add it here
    - Add `reviewed_by?: string | null`
    - Add `reviewed_at?: string | null`
    - Add `previous_review_status?: string | null`
  - [x] 6.3 Review tests from Task Groups 1-5
    - Review the 4 tests from Task Group 1 (database/entity layer)
    - Review the 5 tests from Task Group 2 (review endpoint)
    - Review the 4 tests from Task Group 3 (save-back mode)
    - Review the 4 tests from Task Group 4 (gateway proxy routes)
    - Review the 6 tests from Task Group 5 (frontend)
    - Total existing tests: 23
  - [x] 6.4 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to the review and approval workflow
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 6.5 Write up to 7 additional strategic tests to fill identified gaps
    - Potential gap: Optimistic update rollback on API error in frontend
    - Potential gap: Filter bar count badges update after a review action
    - Potential gap: Save-approved button disappears after all approved candidates are committed
    - Potential gap: reviewCandidate correctly sets reviewed_at timestamp on the entity
    - Potential gap: Auto save-back mode respects the new review_status exclusions end-to-end
    - Potential gap: "Save All Approved" refreshes candidate list after success
    - Potential gap: Gateway PATCH route forwards 400/404 status codes from backend transparently
    - Add maximum of 7 new tests; skip if gaps are minor
  - [x] 6.6 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.5)
    - Expected total: approximately 23-30 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- CandidateStatus union includes `pending_review` and `deferred`
- archModelClient DTO includes all four review fields
- All feature-specific tests pass (approximately 23-30 tests total)
- Critical user workflows for this feature are covered
- No more than 7 additional tests added when filling in testing gaps

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** -- Database Migration and JPA Entity Extension (no dependencies; foundational layer)
2. **Task Group 2** -- Review Action Endpoint (depends on Task Group 1; provides PATCH /review)
3. **Task Group 3** -- Save-Approved Backend Endpoint (depends on Task Group 1; modifies save-back logic)
4. **Task Group 4** -- Gateway Proxy Routes (depends on Task Groups 2 and 3; provides frontend-accessible routes)
5. **Task Group 5** -- Frontend API Client and Candidate Table UI (depends on Task Group 4; user-facing layer)
6. **Task Group 6** -- Type Extension and Test Review (depends on all; cross-cutting cleanup and gap analysis)

Note: Task Groups 2 and 3 can run in parallel since they both depend only on Task Group 1 and modify independent files.

## Key Files Modified

| File | Task Group | Change Description |
|------|-----------|-------------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/074-candidate-review-fields.sql` | 1 | New migration file |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | 1 | Register migration |
| `architecture-model-service/.../model/entity/DiscoveryCandidateEntity.java` | 1 | Add 4 review fields |
| `architecture-model-service/.../model/dto/DiscoveryCandidateDto.java` | 1 | Add 4 review fields to record |
| `architecture-model-service/.../service/DiscoveryCandidateService.java` | 1, 2 | Update toDto, bulkCreate, add reviewCandidate() |
| `architecture-model-service/.../controller/DiscoveryCandidateController.java` | 2, 3 | Add PATCH /review, POST /save-approved |
| `gateway/src/routes/discovery.ts` | 4 | Add PATCH review proxy, POST save-approved proxy |
| `mcp-server/src/services/candidateSaveBackService.ts` | 3 | Add mode parameter to save-back logic |
| `mcp-server/src/services/archModelClient.ts` | 3, 6 | Extend DiscoveryCandidateDto interface |
| `mcp-server/src/routes/saveDiscoveryCandidatesRoute.ts` | 3 | Accept optional mode parameter |
| `mcp-server/src/routes/saveApprovedCandidatesRoute.ts` | 3 | New route for manual save-back |
| `mcp-server/src/routes/tools.ts` | 3 | Register save_approved_candidates route |
| `frontend/src/api/discoveryApi.ts` | 5 | Extend DTO, add reviewCandidate(), saveApprovedCandidates() |
| `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` | 5 | Actions column, filter bar, row tinting, optimistic updates |
| `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx` | 5 | Save All Approved button, candidate refresh |
| `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css` | 5 | Review action styles, filter bar styles, row tint styles |
| `discovery-service/src/types/candidate.ts` | 6 | Extend CandidateStatus union |
