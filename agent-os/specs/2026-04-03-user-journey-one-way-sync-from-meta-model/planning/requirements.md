# Spec Requirements: User Journey One-Way Sync from Meta-Model

## Initial Description
Convert saved USER_JOURNEY diagrams from independent snapshots into meta-model-linked diagram artifacts that can detect drift and be refreshed/regenerated from authoritative USER_JOURNEY and ACTIVITY_STEP data via one-way sync (meta-model -> diagram only).

Increments 5-8 now exist with authoritative meta-model entities, temporary projections, and saved diagram artifacts. Current saved-diagram behavior causes drift: editing/saving breaks live relationship to meta-model. Need one-way sync: meta-model -> diagram, with refresh/regeneration support.

Scope:
- Add source-link metadata to saved USER_JOURNEY diagram typed content
- Backend sync status detection and refresh/regenerate endpoints
- Frontend save/load/view flows with sync status and "Refresh from Model"
- Strictly one-way: meta-model -> diagram

Out of Scope (from raw idea):
- XLSX upload/parsing, bidirectional sync, auto-refresh, meta-model editing from diagram
- Rich diff/conflict resolution, background jobs, live streaming
- Sync for non-USER_JOURNEY diagram types

Key Design Decisions (from raw idea):
- Typed content version 2 with sync metadata object
- Backend canonical hash for drift detection
- Explicit user-triggered refresh only
- Legacy v1 diagrams render but show as unlinked
- USER_JOURNEY diagrams are view-oriented linked projections, not editable working copies

Recommended typed content shape (from raw idea):
```
type: 'USER_JOURNEY'
version: 2
content:
  diagram_type: 'USER_JOURNEY'
  version: '1.0'
  journey: {...existing journey dto...}
  lanes: [...existing lane dto...]
  steps: [...existing step dto...]
  edges: [...existing edge dto...]
  render_hints: {...existing hints...}
  sync:
    source_user_journey_id: string
    source_project_id: string
    source_model_file_id: string | null
    source_projection_version: string
    last_synced_at: string (ISO-8601)
    last_synced_hash: string
    sync_status: 'IN_SYNC' | 'STALE' | 'BROKEN_SOURCE'
    stale_reason: string | null
```

Recommended backend endpoints (from raw idea):
- GET  /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status
- POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model

## Requirements Discussion

### First Round Questions

**Q1:** TypedContent Envelope Version Bump: I assume that when saving a new USER_JOURNEY diagram going forward, the envelope version should be bumped from 1 to 2 (with the sync metadata block added inside content), and that existing v1 diagrams should continue to render normally but display as "unlinked" (no sync metadata). Is that correct, or should the version remain at 1 with the sync block being optional?
**Answer:** Use a real typed-content version bump to 2 for sync-aware USER_JOURNEY diagrams; keep existing version 1 diagrams loading/rendering as legacy unlinked snapshots rather than overloading version 1 with an optional sync block.

**Q2:** Hash Computation Strategy: For last_synced_hash, I assume the backend will compute a canonical hash (e.g., SHA-256) of the UserJourneyDiagramDto JSON output from UserJourneyDiagramProjectionService.projectSingleJourney() -- that is, the hash represents the full projected diagram content (journey, lanes, steps, edges, render_hints). Is that correct? Should the hash include or exclude any specific fields (e.g., should render_hints be excluded since they are static)?
**Answer:** Yes, compute last_synced_hash as a canonical SHA-256 of the normalized projected USER_JOURNEY payload used for rendering, and include render_hints as part of that canonical payload so the hash reflects the full rendered contract consistently.

**Q3:** Sync Status Detection Endpoint: The recommended endpoint GET /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status implies a new controller method that reads the saved diagram's typed_content_json, extracts the sync metadata, re-projects from the meta-model via UserJourneyDiagramProjectionService, computes a fresh hash, and compares. I assume BROKEN_SOURCE means the source user_journey_id no longer exists in the meta-model (or the model file is gone). Is that correct? Should BROKEN_SOURCE also cover the case where referenced activity steps, applications, or process activities are missing (i.e., the projection throws ResourceNotFoundException)?
**Answer:** Yes, BROKEN_SOURCE should cover any case where the source can no longer be projected cleanly from authoritative data, including missing source journey and projection failures caused by missing referenced steps/applications/process activities.

**Q4:** Refresh Endpoint Behavior: For POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model, I assume this endpoint will: (a) call projectSingleJourney() to get a fresh projection, (b) rebuild the typed_content_json with updated diagram data AND updated sync metadata (new hash, new last_synced_at, status=IN_SYNC), (c) save the diagram entity. Should this endpoint also update the diagram's name field to match the journey's current name, or leave the user's chosen diagram name unchanged?
**Answer:** Leave the saved diagram's chosen name unchanged on refresh; refresh updates linked content and sync metadata only, not the user-facing artifact name.

**Q5:** Save Flow Changes: Currently handleSaveJourneyDiagram in DiagramsView.tsx copies currentJourney as any into typedContent.content. I assume the new save flow should: (a) populate the sync metadata block with source_user_journey_id (from currentJourney.journey.id), source_project_id, and a freshly computed hash, (b) set sync_status: 'IN_SYNC' and last_synced_at to now. Should source_model_file_id also be populated at save time (requiring a new API call or passing it through the review context), or is it acceptable to leave it null initially and let the backend populate it during sync-status checks?
**Answer:** It is acceptable to leave source_model_file_id null at initial save and let the backend populate/enrich it during sync-status and/or refresh handling in this increment.

**Q6:** Frontend Sync Status Display: When viewing a saved USER_JOURNEY diagram in Canvas.tsx, I assume we need a visible indicator showing sync status -- something like a banner or badge showing "In Sync", "Stale - meta-model has changed", or "Broken - source journey deleted". For STALE status, I assume there should be a "Refresh from Model" button that calls the refresh endpoint and reloads the diagram. Should the sync status check happen automatically on diagram load (an API call when the user navigates to a USER_JOURNEY diagram), or should there be a manual "Check Status" button?
**Answer:** Sync status should be checked automatically on opening a saved USER_JOURNEY diagram so the user sees current linkage state without an extra manual action.

**Q7:** Scope Boundaries: The raw idea explicitly excludes bidirectional sync, auto-refresh, and background jobs. I want to confirm: (a) saved USER_JOURNEY diagrams should remain completely non-editable in the Canvas (no node dragging, no palette, no edge editing) -- purely view-only, and (b) the only way to update a saved USER_JOURNEY diagram's content is through the explicit "Refresh from Model" action. Is that correct?
**Answer:** Correct: in Increment 9 saved USER_JOURNEY diagrams are fully view-only in the canvas/workspace sense, and the only content update path is the explicit "Refresh from Model" action.

**Q8:** Is there anything you would like to explicitly exclude from this spec that I haven't mentioned -- for example, batch refresh of all stale diagrams, sync status in the diagram list/selector, or migration of existing v1 USER_JOURNEY diagrams to v2?
**Answer:** Explicitly exclude batch refresh of multiple diagrams, sync badges in the global diagram list/autocomplete, automatic migration of v1 diagrams to v2, auto-refresh on load, and any diagram-to-meta-model write-back behavior.

### Existing Code to Reference

No similar existing features were explicitly identified by the user for reference. However, based on codebase research, the following existing code is directly relevant and should be referenced by the spec-writer:

**Backend - Projection Service:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyDiagramProjectionService.java` - The stateless projection service that deterministically generates UserJourneyDiagramDto from meta-model data. Core method: `projectSingleJourney(UUID projectId, String userJourneyId)`.

**Backend - Diagram Persistence:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiagramEntity.java` - Entity with `typed_content_json` (JSONB column, `Map<String, Object>`)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java` - DTO record with `typedContent` field (`Map<String, Object>`)
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/DiagramMapper.java` - Maps between entity and DTO, normalizes diagram types including `USER_JOURNEY`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyDiagramDto.java` - The backend record DTO for the projected diagram contract

**Backend - Controller Pattern:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/UserJourneyDiagramController.java` - Existing controller at `/api/projects/{projectId}/user-journey-diagrams` with `@ConditionalOnProperty` pattern. New sync endpoints should follow this pattern.

**Backend - Entity Model:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyEntity.java` - Has `modelFileId` field linking journey to model file

**Frontend - TypedContent Pipeline:**
- `frontend/src/types/typedContent.ts` - Envelope structure (`TypedContentEnvelope`), `UserJourneyContent` interface, `createDefaultUserJourneyContent()`, `createDefaultTypedContent()`. Version bump from 1 to 2 will happen here.
- `frontend/src/types/userJourneyDiagram.ts` - `UserJourneyDiagramDto`, `UserJourneyDiagramJourneyDto`, etc.

**Frontend - Save Flow:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx` (line ~941) - `handleSaveJourneyDiagram` callback that creates a new Diagram with `typedContent: { type: 'USER_JOURNEY', version: 1, content: currentJourney as any }`
- `frontend/src/components/DiagramsView/modals/SaveJourneyDiagramModal.tsx` - Modal for naming the saved diagram

**Frontend - Canvas Rendering:**
- `frontend/src/components/DiagramsView/Canvas.tsx` (line ~621) - `extractUserJourneyDiagram()` adapter and `isUserJourneyDiagramDto()` type guard
- `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx` - SVG swim-lane renderer component

**Frontend - Review Flow:**
- `frontend/src/contexts/UserJourneyReviewContext.tsx` - Ephemeral review session state (carries `projectId`, `journeys[]`)
- `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` - Banner UI pattern with navigation, "Save as Diagram" button -- good template for sync status banner

**Frontend - API Client:**
- `frontend/src/api/userJourneyDiagramApi.ts` - `fetchTemporaryUserJourneyDiagrams()` -- pattern for new sync-status and refresh API calls

**Frontend - Model Type:**
- `frontend/src/types/model.ts` (line ~2041) - `Diagram` interface with `typedContent?: TypedContentEnvelope`

**Frontend - Round-Trip Tests:**
- `frontend/src/__tests__/user-journey-save-roundtrip.test.ts` - Existing tests for save/load round-trip integrity, `prepareModelForApiSave`/`normalizeModelFromApi`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Saved USER_JOURNEY diagrams carry source-link metadata (`sync` block) enabling drift detection against the authoritative meta-model
- TypedContent envelope version bumps from 1 to 2 for sync-aware USER_JOURNEY diagrams
- Legacy v1 USER_JOURNEY diagrams continue to load and render as unlinked snapshots (no sync banner, no refresh capability)
- Backend computes canonical SHA-256 hash of the full projected UserJourneyDiagramDto (including render_hints) for drift detection
- `GET /api/projects/{projectId}/diagrams/{diagramId}/user-journey-sync-status` endpoint reads saved diagram sync metadata, re-projects from meta-model, compares hashes, and returns current sync status
- `BROKEN_SOURCE` status covers any projection failure: missing source journey, missing referenced activity steps, applications, or process activities
- `POST /api/projects/{projectId}/diagrams/{diagramId}/refresh-user-journey-from-model` endpoint re-projects the diagram, updates typed_content_json with fresh content and sync metadata (new hash, new timestamp, IN_SYNC status), and saves the entity
- Refresh preserves the user-chosen diagram name; only content and sync metadata are updated
- Frontend save flow populates sync metadata at save time: `source_user_journey_id`, `source_project_id`, hash, `last_synced_at`, `sync_status: 'IN_SYNC'`; `source_model_file_id` may be left null for backend enrichment
- Frontend automatically checks sync status when a saved USER_JOURNEY diagram is opened/viewed
- Sync status displayed via a banner or indicator in the canvas area showing "In Sync", "Stale", or "Broken Source"
- "Refresh from Model" button available when status is STALE, calling the refresh endpoint and reloading the diagram
- Saved USER_JOURNEY diagrams are fully view-only in the canvas (no dragging, no palette, no edge editing)
- The only content update path for saved USER_JOURNEY diagrams is the explicit "Refresh from Model" action

### Reusability Opportunities
- `JourneyReviewBanner.tsx` -- structural and styling template for the new sync status banner
- `UserJourneyDiagramProjectionService.projectSingleJourney()` -- reused directly for hash computation and refresh projection
- `DiagramMapper` and `DiagramEntity` -- existing typed_content_json persistence pipeline reused without schema changes
- `userJourneyDiagramApi.ts` fetch pattern -- template for new sync-status and refresh API client functions
- `extractUserJourneyDiagram()` in Canvas.tsx -- may need minor updates to handle v2 content shape
- `TypedContentEnvelope` and factory functions in `typedContent.ts` -- extended with v2 support

### Scope Boundaries
**In Scope:**
- TypedContent version 2 envelope with sync metadata block for USER_JOURNEY diagrams
- Backend sync-status detection endpoint (GET)
- Backend refresh-from-model endpoint (POST)
- Canonical SHA-256 hash computation of full projected UserJourneyDiagramDto
- Frontend save flow updated to populate sync metadata
- Automatic sync-status check on diagram open
- Sync status banner/indicator in canvas view
- "Refresh from Model" button for stale diagrams
- Legacy v1 diagram backward compatibility (render as unlinked)
- BROKEN_SOURCE detection covering all projection failure modes

**Out of Scope:**
- Batch refresh of multiple diagrams at once
- Sync badges/indicators in the global diagram list or DiagramAutocomplete/DiagramSelector
- Automatic migration of existing v1 USER_JOURNEY diagrams to v2
- Auto-refresh on load (status is checked automatically, but content refresh is always user-triggered)
- Any diagram-to-meta-model write-back (bidirectional sync)
- XLSX upload/parsing
- Rich diff/conflict resolution UI
- Background jobs or live streaming for sync
- Sync for non-USER_JOURNEY diagram types

### Technical Considerations
- New backend endpoints should follow the `@ConditionalOnProperty` pattern used by `UserJourneyDiagramController`
- The sync-status endpoint needs access to both `DiagramEntity` (for saved typed_content_json) and `UserJourneyDiagramProjectionService` (for fresh projection and hash comparison)
- Hash computation must be deterministic: serialize the `UserJourneyDiagramDto` to canonical JSON before hashing (consistent field ordering)
- The refresh endpoint modifies only the `typed_content_json` JSONB column on `DiagramEntity`; no changes to diagram_nodes, diagram_edges, or other diagram fields
- Frontend needs a new API client module (or extension of existing) for sync-status and refresh calls
- The `TypedContentEnvelope` version field and `UserJourneyContent` interface need v2 variants; `extractUserJourneyDiagram()` in Canvas.tsx must handle both v1 and v2
- `source_model_file_id` is nullable at frontend save time; backend enriches it during sync-status/refresh operations
- The sync-status check on diagram open should handle network errors gracefully (show "unknown" or degrade to no indicator rather than blocking render)
