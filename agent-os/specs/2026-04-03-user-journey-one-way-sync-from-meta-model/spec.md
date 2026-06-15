# Specification: User Journey One-Way Sync from Meta-Model

## Goal
Convert saved USER_JOURNEY diagrams from independent snapshots into meta-model-linked artifacts that detect drift and support explicit user-triggered refresh, enabling one-way sync (meta-model to diagram only) so saved diagrams stay aligned with authoritative meta-model data.

## User Stories
- As a product architect, I want to see whether my saved User Journey diagram is still in sync with the meta-model so that I know immediately if upstream entity changes have caused drift.
- As a product architect, I want to explicitly refresh a stale saved User Journey diagram from the meta-model so that the diagram reflects the latest authoritative data without manual recreation.

## Specific Requirements

**TypedContent Version 2 Envelope with Sync Metadata**
- Bump the `TypedContentEnvelope` version from `1` to `2` for all newly saved USER_JOURNEY diagrams
- Add a `sync` metadata block inside `content` alongside the existing diagram fields (journey, lanes, steps, edges, render_hints)
- The `sync` block contains: `source_user_journey_id` (string), `source_project_id` (string), `source_model_file_id` (string | null), `source_projection_version` (string), `last_synced_at` (ISO-8601 string), `last_synced_hash` (string), `sync_status` ('IN_SYNC' | 'STALE' | 'BROKEN_SOURCE'), `stale_reason` (string | null)
- Extend the `UserJourneyContent` interface in `typedContent.ts` to include the optional `sync` field for v2 awareness; v1 content has no sync field
- Update `createDefaultTypedContent('USER_JOURNEY')` to produce version 2 envelopes going forward

**Canonical SHA-256 Hash Computation**
- Backend computes `last_synced_hash` as SHA-256 of the full `UserJourneyDiagramDto` JSON output from `UserJourneyDiagramProjectionService.projectSingleJourney()`
- Hash includes all fields: journey, lanes, steps, edges, and render_hints
- Serialization must be deterministic: use Jackson's canonical JSON serialization with consistent field ordering to ensure identical inputs always produce identical hashes
- Create a dedicated utility method (e.g., `UserJourneyDiagramHashUtil.computeCanonicalHash(UserJourneyDiagramDto)`) for reuse by both sync-status and refresh endpoints

**Sync Status Detection Endpoint (GET)**
- `GET /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status`
- Reads the saved diagram's `typed_content_json`, extracts the `sync` metadata block
- If the diagram is v1 (no sync block), returns a response indicating `UNLINKED` status (not an error)
- Re-projects from meta-model via `UserJourneyDiagramProjectionService.projectSingleJourney()` using `source_user_journey_id` and `source_project_id` from sync metadata
- Computes a fresh hash and compares against `last_synced_hash`: returns `IN_SYNC` if matching, `STALE` if different
- Returns `BROKEN_SOURCE` if the projection throws any exception (missing journey, missing referenced activity steps, applications, or process activities)
- Enriches `source_model_file_id` on the saved diagram if it was null, updating `typed_content_json` in-place

**Refresh from Model Endpoint (POST)**
- `POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model`
- Calls `projectSingleJourney()` to get a fresh projection from the meta-model
- Rebuilds `typed_content_json` with updated diagram content (journey, lanes, steps, edges, render_hints) and updated sync metadata (new hash, new `last_synced_at`, `sync_status: 'IN_SYNC'`, cleared `stale_reason`)
- Saves only the `typed_content_json` JSONB column on the `DiagramEntity`; does not modify diagram_nodes, diagram_edges, name, or any other diagram fields
- Preserves the user-chosen diagram name unchanged
- Returns the updated diagram DTO (or sync status response) so the frontend can reload without a second fetch

**New Backend Controller and Service**
- Create a new controller (e.g., `UserJourneySyncController`) at the diagram-level path `/api/projects/{projectId}/diagrams/{diagramId}/...` following the `@ConditionalOnProperty` pattern from `UserJourneyDiagramController`
- The controller depends on `DiagramRepository` (for reading/saving `DiagramEntity`) and `UserJourneyDiagramProjectionService` (for fresh projections)
- Create a service class (e.g., `UserJourneySyncService`) encapsulating sync-status checking, hash comparison, and refresh logic

**Frontend Save Flow Updates**
- In `handleSaveJourneyDiagram` (DiagramsView.tsx), change the envelope version from `1` to `2`
- Populate the `sync` metadata block at save time: `source_user_journey_id` from `currentJourney.journey.id`, `source_project_id` from `journeyReview.projectId`, `last_synced_hash` computed on the frontend or left for backend enrichment, `last_synced_at` set to current ISO-8601 timestamp, `sync_status: 'IN_SYNC'`
- `source_model_file_id` may be left null at initial save; the backend enriches it during sync-status or refresh operations

**Automatic Sync Status Check on Diagram Open**
- When a saved USER_JOURNEY v2 diagram is opened/navigated to in the Canvas view, automatically call the sync-status endpoint
- Display the result in a sync status banner (see below); do not block diagram rendering while the check is in progress
- Handle network errors gracefully: show "Unknown" or degrade to no indicator rather than blocking render
- For v1 diagrams, skip the sync-status call entirely and show no sync banner

**Sync Status Banner in Canvas View**
- Render a horizontal banner in the toolbar area (Row 1) when viewing a saved USER_JOURNEY v2 diagram, following the structural and styling pattern of `JourneyReviewBanner.tsx`
- Display a badge and text reflecting the current sync status: "In Sync" (green/neutral), "Stale -- meta-model has changed" (amber/warning), "Broken -- source journey unavailable" (red/error)
- Show a "Refresh from Model" button when status is `STALE`, which calls the refresh endpoint and reloads the diagram content in place
- Show a loading/spinner state while the sync-status check or refresh is in progress
- For `BROKEN_SOURCE`, display the status but disable the refresh button (or hide it) since refresh would also fail

**Saved USER_JOURNEY Diagrams are View-Only**
- Saved USER_JOURNEY diagrams remain fully view-only in the canvas: no node dragging, no palette, no edge editing, no decoration editing
- The only content update path is the explicit "Refresh from Model" action triggered from the sync status banner

**Legacy v1 Backward Compatibility**
- Existing v1 USER_JOURNEY diagrams continue to load and render normally using the existing `extractUserJourneyDiagram()` logic in Canvas.tsx
- `extractUserJourneyDiagram()` must handle both v1 (no sync block) and v2 (with sync block) content shapes without breaking
- v1 diagrams display as unlinked snapshots: no sync banner, no refresh capability, no automatic sync-status check

## Visual Design
No visual mockups were provided.

## Existing Code to Leverage

**`UserJourneyDiagramProjectionService.projectSingleJourney()`**
- Stateless projection service that deterministically generates `UserJourneyDiagramDto` from persisted meta-model data (USER_JOURNEY and ACTIVITY_STEP entities)
- Reuse directly for both hash computation (sync-status check) and content regeneration (refresh)
- Already throws `ResourceNotFoundException` for missing journeys, applications, and process activities, which maps directly to `BROKEN_SOURCE` detection
- Located at `architecture-model-service/.../service/UserJourneyDiagramProjectionService.java`

**`JourneyReviewBanner.tsx` Banner Pattern**
- Provides the structural and styling template for the new sync status banner: horizontal flex layout, colored badge, text label, action buttons
- Reuse the same inline style patterns (badge colors, button sizing, gap/alignment) for visual consistency
- Adapt the props interface to accept sync status, loading state, and an `onRefresh` callback instead of navigation callbacks
- Located at `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx`

**`TypedContentEnvelope` and `UserJourneyContent` in `typedContent.ts`**
- Current `UserJourneyContent` interface defines the v1 content shape (journey, lanes, steps, edges, render_hints, diagram_type, version)
- Extend with an optional `sync` field for v2; the `TypedContentEnvelope.version` field distinguishes v1 from v2
- `createDefaultTypedContent('USER_JOURNEY')` factory should be updated to produce v2 envelopes
- Located at `frontend/src/types/typedContent.ts`

**`DiagramEntity` / `DiagramRepository` Persistence Pipeline**
- `DiagramEntity.typedContentJson` is a `Map<String, Object>` JSONB column -- no schema migration needed; the sync block is simply additional JSON content within the existing column
- `DiagramRepository` provides `findById()` via JPA for reading individual diagrams by ID
- `DiagramMapper.toDto()` / `toEntity()` pass `typedContentJson` through transparently
- Located at `architecture-model-service/.../model/entity/DiagramEntity.java` and `architecture-model-service/.../repository/diagram/DiagramRepository.java`

**`userJourneyDiagramApi.ts` API Client Pattern**
- Uses plain `fetch()` with `API_BASE` environment variable and `encodeURIComponent` for path parameters
- Follow this same pattern for new `fetchUserJourneySyncStatus(projectId, diagramId)` and `refreshUserJourneyFromModel(projectId, diagramId)` API client functions
- Located at `frontend/src/api/userJourneyDiagramApi.ts`

## Out of Scope
- Batch refresh of multiple diagrams at once
- Sync badges or indicators in the global diagram list, DiagramAutocomplete, or DiagramSelector
- Automatic migration of existing v1 USER_JOURNEY diagrams to v2 format
- Auto-refresh on load (status is checked automatically, but content refresh is always user-triggered)
- Any diagram-to-meta-model write-back or bidirectional sync
- XLSX upload or parsing
- Rich diff or conflict resolution UI between stale and current versions
- Background jobs or live streaming for sync detection
- Sync for non-USER_JOURNEY diagram types (Sequence, ER, Activity, State, UI_SCREEN)
- Editing capabilities for saved USER_JOURNEY diagrams (they remain view-only)
