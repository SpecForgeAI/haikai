# Task Breakdown: User Journey One-Way Sync from Meta-Model

## Overview
Total Tasks: 5 Task Groups, 32 sub-tasks

This feature converts saved USER_JOURNEY diagrams from independent snapshots into meta-model-linked artifacts. It adds sync metadata to the TypedContent envelope (v2), backend endpoints for sync-status detection and refresh-from-model, and frontend UI for automatic sync checking with a status banner and refresh action.

## Task List

### Backend Layer

#### Task Group 1: Hash Utility and Sync Service
**Dependencies:** None (uses existing `UserJourneyDiagramProjectionService`, `DiagramEntity`, `DiagramRepository`)

- [x] 1.0 Complete backend hash utility and sync service
  - [x] 1.1 Write 6 focused tests for hash utility and sync service
    - Test 1: `UserJourneyDiagramHashUtil.computeCanonicalHash()` produces consistent SHA-256 for the same `UserJourneyDiagramDto` input
    - Test 2: `computeCanonicalHash()` produces different hashes for different inputs (e.g., changed step name)
    - Test 3: `UserJourneySyncService.checkSyncStatus()` returns `IN_SYNC` when saved hash matches fresh projection hash
    - Test 4: `checkSyncStatus()` returns `STALE` when saved hash differs from fresh projection hash
    - Test 5: `checkSyncStatus()` returns `BROKEN_SOURCE` when projection throws `ResourceNotFoundException`
    - Test 6: `checkSyncStatus()` returns `UNLINKED` for v1 diagrams (no sync block in typed_content_json)
  - [x] 1.2 Create `UserJourneyDiagramHashUtil` utility class
    - Location: `architecture-model-service/.../util/UserJourneyDiagramHashUtil.java`
    - Method: `public static String computeCanonicalHash(UserJourneyDiagramDto dto)`
    - Use Jackson `ObjectMapper` with `SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS` and sorted property ordering for deterministic JSON serialization
    - Compute SHA-256 of the canonical JSON string
    - Return hex-encoded hash string
  - [x] 1.3 Create `UserJourneySyncService` service class
    - Location: `architecture-model-service/.../service/UserJourneySyncService.java`
    - Inject `DiagramRepository` and `UserJourneyDiagramProjectionService`
    - Method: `checkSyncStatus(UUID projectId, String diagramId)` -- reads `DiagramEntity.typedContentJson`, extracts sync block, re-projects via `projectSingleJourney()`, compares hashes, returns sync status response
    - Method: `refreshFromModel(UUID projectId, String diagramId)` -- re-projects, rebuilds `typedContentJson` with fresh content and updated sync metadata (new hash, new `last_synced_at`, `sync_status: IN_SYNC`, cleared `stale_reason`), saves entity, returns updated diagram DTO
    - Handle v1 diagrams (no sync block) by returning `UNLINKED` status without error
    - Catch `ResourceNotFoundException` from projection service and map to `BROKEN_SOURCE`
    - Enrich `source_model_file_id` if null during status check or refresh
  - [x] 1.4 Create `UserJourneySyncStatusResponse` DTO
    - Location: `architecture-model-service/.../model/dto/diagram/UserJourneySyncStatusResponse.java`
    - Fields: `syncStatus` (String enum: `IN_SYNC`, `STALE`, `BROKEN_SOURCE`, `UNLINKED`), `staleReason` (String, nullable), `lastSyncedAt` (String, nullable), `lastSyncedHash` (String, nullable)
    - Use Java record for conciseness, following existing DTO patterns
  - [x] 1.5 Ensure hash utility and sync service tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify deterministic hashing works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 1.1 all pass
- Hash computation is deterministic (same input always produces same hash)
- Sync status correctly identified for all four states: `IN_SYNC`, `STALE`, `BROKEN_SOURCE`, `UNLINKED`
- Refresh rebuilds typed_content_json with fresh content and updated sync metadata
- `source_model_file_id` enrichment works when null

---

#### Task Group 2: Sync Controller Endpoints
**Dependencies:** Task Group 1

- [x] 2.0 Complete sync controller endpoints
  - [x] 2.1 Write 5 focused tests for sync controller
    - Test 1: `GET .../user-journey-sync-status` returns 200 with `IN_SYNC` for a synced v2 diagram
    - Test 2: `GET .../user-journey-sync-status` returns 200 with `STALE` when meta-model has changed
    - Test 3: `GET .../user-journey-sync-status` returns 200 with `UNLINKED` for a v1 diagram
    - Test 4: `POST .../refresh-user-journey-from-model` returns 200 with updated diagram content and `IN_SYNC` status
    - Test 5: `POST .../refresh-user-journey-from-model` returns appropriate error when source is broken
    - Follow pattern from: `UserJourneyDiagramControllerTest.java`
  - [x] 2.2 Create `UserJourneySyncController`
    - Location: `architecture-model-service/.../controller/UserJourneySyncController.java`
    - Use `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` following `UserJourneyDiagramController` pattern
    - Base path: `/api/projects/{projectId}/diagrams/{diagramId}`
    - Inject `UserJourneySyncService`
  - [x] 2.3 Implement GET sync-status endpoint
    - Path: `GET /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status`
    - Delegates to `UserJourneySyncService.checkSyncStatus()`
    - Returns `UserJourneySyncStatusResponse` as JSON
    - Returns 404 if diagram not found
  - [x] 2.4 Implement POST refresh-from-model endpoint
    - Path: `POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model`
    - Delegates to `UserJourneySyncService.refreshFromModel()`
    - Returns updated `DiagramDto` (via `DiagramMapper.toDto()`) so frontend can reload without a second fetch
    - Preserves the user-chosen diagram name unchanged
    - Returns 404 if diagram not found; returns error status if source is broken
  - [x] 2.5 Ensure sync controller tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify both endpoints return correct HTTP status codes and response bodies
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests from 2.1 all pass
- GET sync-status endpoint correctly returns all four status variants
- POST refresh endpoint updates typed_content_json and returns updated diagram
- 404 returned for missing diagrams
- Controller follows existing `@ConditionalOnProperty` pattern

---

### Frontend Type and API Layer

#### Task Group 3: TypedContent v2, API Client, and Save Flow
**Dependencies:** Task Group 2 (backend endpoints must exist for API client to target)

- [x] 3.0 Complete frontend type definitions, API client, and save flow updates
  - [x] 3.1 Write 6 focused tests for TypedContent v2, API client, and save flow
    - Test 1: `UserJourneyContent` with `sync` field passes type validation (TypeScript compile check or runtime guard)
    - Test 2: `createDefaultTypedContent('USER_JOURNEY')` returns version 2 envelope
    - Test 3: `extractUserJourneyDiagram()` correctly extracts diagram data from v2 content (with sync block present)
    - Test 4: `extractUserJourneyDiagram()` continues to work for v1 content (no sync block) -- backward compatibility
    - Test 5: `fetchUserJourneySyncStatus()` calls correct URL and parses response
    - Test 6: `refreshUserJourneyFromModel()` calls correct URL with POST method and parses response
  - [x] 3.2 Extend `UserJourneyContent` interface with optional `sync` field
    - File: `frontend/src/types/typedContent.ts`
    - Add `UserJourneySyncMetadata` interface with fields: `source_user_journey_id` (string), `source_project_id` (string), `source_model_file_id` (string | null), `source_projection_version` (string), `last_synced_at` (string), `last_synced_hash` (string), `sync_status` ('IN_SYNC' | 'STALE' | 'BROKEN_SOURCE'), `stale_reason` (string | null)
    - Add optional `sync?: UserJourneySyncMetadata` field to `UserJourneyContent`
    - Export the `UserJourneySyncMetadata` type
  - [x] 3.3 Update `createDefaultTypedContent('USER_JOURNEY')` to produce version 2
    - File: `frontend/src/types/typedContent.ts`
    - Change the `USER_JOURNEY` case in `createDefaultTypedContent()` to return `version: 2`
    - The default content does not need a populated sync block (sync is optional on the interface)
  - [x] 3.4 Verify `extractUserJourneyDiagram()` handles v2 content
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - The existing `isUserJourneyDiagramDto()` type guard checks for `lanes`, `steps`, `edges`, `journey` -- these are all still present in v2 content alongside the sync block
    - Confirm no changes needed to `extractUserJourneyDiagram()` since `sync` is an additional field that does not interfere with the existing shape check
    - If any adjustment is needed, make the minimal change to support both v1 and v2
  - [x] 3.5 Create API client functions for sync endpoints
    - File: `frontend/src/api/userJourneyDiagramApi.ts` (extend existing file)
    - Add `fetchUserJourneySyncStatus(projectId: string, diagramId: string): Promise<UserJourneySyncStatusResponse>`
    - Add `refreshUserJourneyFromModel(projectId: string, diagramId: string): Promise<Diagram>`
    - Follow existing `fetchTemporaryUserJourneyDiagrams()` pattern: plain `fetch()` with `API_BASE`, `encodeURIComponent` for path params
    - Define `UserJourneySyncStatusResponse` interface in the API file (or a shared types file) matching backend DTO: `syncStatus`, `staleReason`, `lastSyncedAt`, `lastSyncedHash`
  - [x] 3.6 Update `handleSaveJourneyDiagram` to populate sync metadata
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx` (line ~941)
    - Change `version: 1` to `version: 2` in the typedContent envelope
    - Add `sync` block to the content: `source_user_journey_id` from `currentJourney.journey.id`, `source_project_id` from `journeyReview.projectId`, `source_model_file_id: null` (backend enriches later), `source_projection_version: '1.0'`, `last_synced_at` set to `new Date().toISOString()`, `last_synced_hash: ''` (backend computes authoritative hash on first sync-status check), `sync_status: 'IN_SYNC'`, `stale_reason: null`
  - [x] 3.7 Ensure TypedContent v2, API client, and save flow tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify v2 envelope creation, backward compatibility with v1, and API client URL construction
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 3.1 all pass
- `UserJourneyContent` interface correctly extended with optional `sync` field
- `createDefaultTypedContent('USER_JOURNEY')` returns version 2 envelope
- `extractUserJourneyDiagram()` works for both v1 and v2 content
- API client functions target correct endpoints with proper HTTP methods
- Save flow produces v2 envelopes with sync metadata populated

---

### Frontend UI Layer

#### Task Group 4: Sync Status Banner and Auto-Check
**Dependencies:** Task Group 3 (TypedContent v2 types and API client must exist)

- [x] 4.0 Complete sync status banner and automatic sync check on diagram open
  - [x] 4.1 Write 6 focused tests for sync status banner and auto-check behavior
    - Test 1: `SyncStatusBanner` renders "In Sync" badge with green styling when `syncStatus` is `IN_SYNC`
    - Test 2: `SyncStatusBanner` renders "Stale" badge with amber styling and shows "Refresh from Model" button when `syncStatus` is `STALE`
    - Test 3: `SyncStatusBanner` renders "Broken Source" badge with red styling and hides/disables refresh button when `syncStatus` is `BROKEN_SOURCE`
    - Test 4: `SyncStatusBanner` renders loading spinner when `isLoading` is true
    - Test 5: Sync status banner is NOT rendered for v1 diagrams (no sync block in typedContent)
    - Test 6: "Refresh from Model" button click calls `onRefresh` callback
  - [x] 4.2 Create `SyncStatusBanner` component
    - File: `frontend/src/components/DiagramsView/SyncStatusBanner.tsx`
    - Follow structural and styling pattern from `JourneyReviewBanner.tsx`: horizontal flex layout, colored badge, text label, action button
    - Props: `syncStatus` ('IN_SYNC' | 'STALE' | 'BROKEN_SOURCE' | 'LOADING' | 'ERROR' | null), `staleReason` (string | null), `isLoading` (boolean), `onRefresh` (() => void)
    - Badge styles: `IN_SYNC` -- green background (#E8F5E9, color #2E7D32); `STALE` -- amber background (#FFF3E0, color #E65100); `BROKEN_SOURCE` -- red background (#FFEBEE, color #C62828)
    - Show "Refresh from Model" button only when `syncStatus === 'STALE'`; disable or hide for `BROKEN_SOURCE`
    - Show spinner/loading indicator when `isLoading` is true
    - Handle `ERROR` state gracefully with "Sync status unknown" text
    - Use `data-testid` attributes for test targeting (e.g., `sync-status-banner`, `sync-status-badge`, `sync-refresh-button`)
  - [x] 4.3 Create `useUserJourneySyncStatus` custom hook
    - File: `frontend/src/hooks/useUserJourneySyncStatus.ts`
    - Accepts `projectId`, `diagramId`, and `typedContent` (to check version)
    - On mount (and when diagramId changes), if typedContent is v2 (version === 2 and has sync block), calls `fetchUserJourneySyncStatus(projectId, diagramId)`
    - Returns `{ syncStatus, staleReason, isLoading, error, refresh }` where `refresh` calls `refreshUserJourneyFromModel` and updates local state
    - Skips API call for v1 diagrams (returns `syncStatus: null`)
    - Handles network errors gracefully: sets `syncStatus` to `'ERROR'` rather than throwing
  - [x] 4.4 Integrate `SyncStatusBanner` into Canvas toolbar (Row 1)
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx` (toolbar area)
    - When viewing a saved USER_JOURNEY diagram with v2 typedContent, render `SyncStatusBanner` in the toolbar Row 1 area
    - Wire `useUserJourneySyncStatus` hook to provide sync status data and refresh callback
    - Do not render the banner for v1 diagrams or non-USER_JOURNEY diagram types
    - After successful refresh, update the diagram in state with the returned updated diagram data (re-render canvas with fresh content)
  - [x] 4.5 Handle refresh completion -- update diagram in-place
    - When `refreshUserJourneyFromModel` returns the updated diagram DTO, dispatch an update to replace the diagram's `typedContent` in the model state
    - The canvas should re-render with fresh content without requiring navigation away and back
    - Show a success toast message (e.g., "Diagram refreshed from model")
  - [x] 4.6 Ensure sync status banner and auto-check tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify banner renders correctly for all status states
    - Verify v1 diagrams do not trigger sync check
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests from 4.1 all pass
- Sync status banner displays correct badge color and text for each status
- "Refresh from Model" button appears only for STALE status
- Loading state shows spinner
- v1 diagrams show no sync banner
- Refresh updates diagram content in-place and shows success feedback
- Network errors degrade gracefully to "Sync status unknown"

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 6 tests from Task Group 1 (hash utility and sync service)
    - Review the 5 tests from Task Group 2 (sync controller endpoints)
    - Review the 6 tests from Task Group 3 (TypedContent v2, API client, save flow)
    - Review the 6 tests from Task Group 4 (sync status banner and auto-check)
    - Total existing tests: 23 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to one-way sync feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
    - Key workflows to verify coverage: (a) save v2 diagram with sync metadata -> open -> auto-check -> shows "In Sync", (b) meta-model changes -> open saved diagram -> shows "Stale" -> user clicks refresh -> diagram updates to "In Sync", (c) source journey deleted -> open saved diagram -> shows "Broken Source" -> refresh button disabled, (d) v1 diagram -> open -> no sync banner rendered
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Focus on integration points between frontend and backend layers
    - Potential gap areas:
      - Round-trip test: save v2 diagram -> verify sync block is persisted correctly in typed_content_json
      - Integration test: refresh endpoint actually updates the JSONB column and returns correct response shape
      - Edge case: sync-status check when diagram exists but is not USER_JOURNEY type (should handle gracefully)
      - Edge case: refresh when diagram has been concurrently deleted (404 handling)
      - Frontend integration: `useUserJourneySyncStatus` hook correctly transitions through loading -> result states
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 23-33 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-33 tests total)
- Critical user workflows for one-way sync are covered end-to-end
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Hash Utility and Sync Service** (Backend) -- Foundation layer with no dependencies. Creates the hash computation utility and core sync service logic that all other groups depend on.

2. **Task Group 2: Sync Controller Endpoints** (Backend) -- Depends on Task Group 1. Exposes the sync-status and refresh-from-model REST endpoints that the frontend will call.

3. **Task Group 3: TypedContent v2, API Client, and Save Flow** (Frontend Types/API) -- Depends on Task Group 2 (endpoints must exist). Extends type definitions, creates API client functions, and updates the save flow to produce v2 envelopes with sync metadata.

4. **Task Group 4: Sync Status Banner and Auto-Check** (Frontend UI) -- Depends on Task Group 3 (types and API client must exist). Builds the visible sync status banner component, the auto-check hook, and integrates them into the canvas toolbar.

5. **Task Group 5: Test Review and Gap Analysis** (Testing) -- Depends on Task Groups 1-4. Reviews all tests written during development and fills critical coverage gaps with up to 10 additional tests.

## Key Files Modified or Created

### New Files
| File | Task Group | Description |
|------|-----------|-------------|
| `architecture-model-service/.../util/UserJourneyDiagramHashUtil.java` | 1 | Canonical SHA-256 hash computation utility |
| `architecture-model-service/.../service/UserJourneySyncService.java` | 1 | Sync status checking and refresh logic |
| `architecture-model-service/.../model/dto/diagram/UserJourneySyncStatusResponse.java` | 1 | Sync status response DTO |
| `architecture-model-service/.../controller/UserJourneySyncController.java` | 2 | REST controller for sync endpoints |
| `frontend/src/components/DiagramsView/SyncStatusBanner.tsx` | 4 | Sync status banner UI component |
| `frontend/src/hooks/useUserJourneySyncStatus.ts` | 4 | Custom hook for automatic sync status checking |

### Modified Files
| File | Task Group | Change |
|------|-----------|--------|
| `frontend/src/types/typedContent.ts` | 3 | Add `UserJourneySyncMetadata` interface, optional `sync` field on `UserJourneyContent`, version 2 default |
| `frontend/src/api/userJourneyDiagramApi.ts` | 3 | Add `fetchUserJourneySyncStatus()` and `refreshUserJourneyFromModel()` functions |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 3, 4 | Save flow v2 envelope with sync metadata; integrate SyncStatusBanner in toolbar |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3 | Verify/update `extractUserJourneyDiagram()` for v2 compatibility (likely no changes needed) |
