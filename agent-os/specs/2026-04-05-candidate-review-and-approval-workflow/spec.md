# Specification: Candidate Review and Approval Workflow

## Goal
Enable users to review discovery candidates (approve, reject, defer), gate save-back to the canonical model by review state, and maintain a lightweight audit trail -- making save-back user-governed rather than purely automatic.

## User Stories
- As an architect, I want to approve or reject individual discovery candidates so that only vetted elements are persisted into the canonical architecture model.
- As a discovery user, I want to save all approved candidates in a single action so that the review-to-persist workflow is efficient and explicit.

## Specific Requirements

**Extend candidate model with review state fields**
- Add a `review_status` field to `DiscoveryCandidateEntity` with four values: `pending_review`, `approved`, `rejected`, `deferred`
- Add audit fields directly on the candidate entity: `reviewed_by` (nullable TEXT), `reviewed_at` (nullable TIMESTAMPTZ), `previous_review_status` (nullable TEXT)
- Create a new Liquibase migration SQL file (`074-candidate-review-fields.sql`) adding these four columns to the `discovery_candidate` table
- Default all existing rows to `review_status = 'pending_review'` via the migration's DEFAULT clause
- Add `review_status` to `DiscoveryCandidateDto` (Java record) and frontend `DiscoveryCandidateDto` (TypeScript interface) with the audit fields
- Do not create a separate review/audit table; all state lives on the candidate row

**Add pending_review to CandidateStatus union**
- Extend the `CandidateStatus` union in `discovery-service/src/types/candidate.ts` with `pending_review` and `deferred`
- The existing `proposed` status from the pipeline becomes equivalent to `pending_review` for review purposes; the migration should UPDATE existing `proposed` rows to `pending_review`

**Review action endpoint in architecture-model-service**
- Add a new `PATCH /api/model/projects/{projectId}/discovery/runs/{runId}/candidates/{candidateId}/review` endpoint on `DiscoveryCandidateController`
- Request body: `{ "review_status": "approved" | "rejected" | "deferred", "reviewed_by": "optional-label" }`
- The endpoint sets `review_status`, `reviewed_by`, `reviewed_at = now()`, and captures `previous_review_status` from the current value before overwriting
- Return the updated `DiscoveryCandidateDto` on success; 400 if review_status is invalid; 404 if candidate not found
- This endpoint is separate from the existing PUT update endpoint to keep review semantics isolated

**Gateway proxy route for review action**
- Add a PATCH proxy route in `gateway/src/routes/discovery.ts` at `/projects/:projectId/runs/:runId/candidates/:candidateId/review`
- Proxy to `{architectureModelServiceBaseUrl}/api/model/projects/{projectId}/discovery/runs/{runId}/candidates/{candidateId}/review`
- Forward the JSON body transparently; follow the existing proxy pattern (503 on network error, passthrough status codes)

**Frontend API client: review and save-back functions**
- Add `reviewCandidate(projectId, runId, candidateId, reviewStatus, reviewedBy?)` to `discoveryApi.ts` calling `PATCH .../candidates/{candidateId}/review`
- Add `saveApprovedCandidates(projectId, runId)` to `discoveryApi.ts` calling `POST .../save-approved` (new gateway route, see below)
- Extend `DiscoveryCandidateDto` TypeScript interface with `review_status`, `reviewed_by`, `reviewed_at`, `previous_review_status`

**Inline review actions in DiscoveryCandidateTable**
- Add an "Actions" column to the existing candidate table with Approve, Reject, and Defer buttons per row
- Buttons call `reviewCandidate()` and optimistically update local state; show loading indicator per-row during the API call
- Disable action buttons that match the current `review_status` (e.g., hide Approve on already-approved rows)
- Style approved rows with a subtle green-tinted background, rejected with red-tinted, deferred with grey-tinted, pending with no tint
- Keep the existing read-only columns (Name, Type, Confidence, Status, Synthesized At); replace the generic "Status" display with the `review_status` value

**Review state filter control**
- Add a simple filter bar above the candidate table in `DiscoveryCandidateTable` with buttons/chips: All, Pending, Approved, Rejected, Deferred
- Filtering is client-side: fetch all candidates once, then filter the displayed list by `review_status`
- Default filter is "All" showing every candidate
- Show a count badge on each filter chip (e.g., "Pending (12)")

**Save all approved candidates action**
- Add a "Save All Approved" button in `DiscoveryRunDetailView` visible when the candidate table is shown and at least one candidate has `review_status === 'approved'`
- Button triggers `saveApprovedCandidates(projectId, runId)` and shows a loading/success/error state
- After successful save, refresh the candidate list to reflect updated statuses (approved candidates become `committed`)

**Gateway route: save approved candidates**
- Add a POST proxy route in `gateway/src/routes/discovery.ts` at `/projects/:projectId/runs/:runId/save-approved`
- This route calls the existing MCP tool `save_discovery_candidates_to_model` or a new dedicated endpoint on architecture-model-service that filters to `review_status = 'approved'` before executing save-back
- The simpler approach: proxy to a new backend endpoint that reuses `candidateSaveBackService` logic but filters on `review_status` instead of only confidence threshold

**Modify save-back eligibility to respect review state**
- In `candidateSaveBackService.ts`, change the eligibility filter in `saveDiscoveryCandidatesToModel` to support two paths:
- Path 1 (automatic, called by pipeline): keep existing behavior filtering on `confidence >= 0.75` AND status not in EXCLUDED_STATUSES -- but now also require `review_status` is not `rejected` or `deferred`
- Path 2 (manual, called by "Save All Approved"): filter to `review_status === 'approved'` AND status not in EXCLUDED_STATUSES, ignoring confidence threshold
- Accept an optional `mode` parameter (`'auto' | 'manual'`) to distinguish the two paths; default to `'auto'` for backward compatibility

**Deferred status is run-scoped**
- Deferred candidates remain visible in the current run's candidate list with `review_status = 'deferred'`
- When a new discovery run produces updated results, new candidates start fresh with `review_status = 'pending_review'`; deferred state does not carry forward
- No cross-run deferred state tracking or migration logic needed

**Lightweight user identity for audit**
- The `reviewed_by` field accepts a freeform string label (e.g., "session-abc123" or "Alice")
- Frontend sends the current session identifier or a user-provided label; no authenticated identity required
- If no label is provided, the backend defaults `reviewed_by` to `"anonymous"`

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx` -- Candidate list UI**
- Currently a read-only HTML table displaying Name, Type, Confidence, Status, Synthesized At columns with parent-child indentation
- This component is the primary extension target: add the Actions column with inline Approve/Reject/Defer buttons and the filter bar above the table
- Already receives `projectId` and `runId` props and fetches candidates via `getDiscoveryCandidates`
- Local state management pattern (`useState`, `useEffect` with cancellation) should be reused for optimistic review updates

**`frontend/src/api/discoveryApi.ts` -- Discovery API client**
- Contains typed fetch functions for runs, candidates, counts, and entity-origin mappings
- Already has `getDiscoveryCandidates(projectId, runId, type?, status?)` with query param forwarding
- Existing `DiscoveryCandidateDto` interface needs extension with `review_status`, `reviewed_by`, `reviewed_at`, `previous_review_status` fields
- New functions (`reviewCandidate`, `saveApprovedCandidates`) follow the same pattern: build URL, fetch, check `res.ok`, return typed JSON

**`gateway/src/routes/discovery.ts` -- Gateway discovery proxy routes**
- Contains all existing discovery proxy routes following a consistent pattern: extract params, build backend URL, forward with error handling (503 on network error)
- The new PATCH review route and POST save-approved route follow the same pattern exactly
- Routes proxy to `architectureModelServiceBaseUrl` for persisted data operations

**`mcp-server/src/services/candidateSaveBackService.ts` -- Save-back orchestration**
- Full GET-merge-PUT orchestration with eligibility filtering on `confidence >= 0.75` and excluded statuses
- The manual save-approved path reuses this same function with a modified filter predicate (review_status === approved instead of confidence threshold)
- `CANDIDATE_AUTO_ACCEPT_THRESHOLD`, `EXCLUDED_STATUSES`, `buildDepthMap`, `convertCandidateToEntity` are all reusable as-is

**`architecture-model-service` DiscoveryCandidate JPA stack**
- `DiscoveryCandidateEntity.java`: add four new columns (review_status, reviewed_by, reviewed_at, previous_review_status) with appropriate types and defaults
- `DiscoveryCandidateDto.java`: extend the record with the four new fields using `@JsonProperty` snake_case naming
- `DiscoveryCandidateService.java`: already has `updateCandidate()` method; the new review endpoint uses a similar pattern but only touches review fields
- `DiscoveryCandidateController.java`: add the PATCH /review endpoint alongside the existing PUT update

## Out of Scope
- Bulk editing or advanced filtering UX (multi-select approve/reject, column sorting, search)
- Editing candidate details (rename, retype, re-parent)
- Multi-user collaboration or conflict resolution on review actions
- Advanced approval workflows (multi-stage, role-based, quorum-based)
- Deep evidence inspection UI (viewing source clusters, atoms, relationships for a candidate)
- Log-based enrichment (Increment 14)
- AST enrichment
- Language/version-specific analyzer packs
- Per-candidate selective save-back (only batch "save all approved" is in scope)
- Carrying deferred state across discovery runs
- Separate review/audit table (review state stored on candidate model)
- Full authentication-based identity for audit attribution (OAuth2/OIDC)
- Undo/rollback of committed entities from the canonical model
