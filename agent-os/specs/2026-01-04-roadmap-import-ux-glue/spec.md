# Specification: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX

## Goal
Improve the Product Roadmap experience with persisted "Last imported" status, detailed importer counts (inserted/updated/archived/deleted), actionable error messages, and a clear "Go to Backlog" next-step CTA.

## User Stories
- As a product manager, I want to see persisted "Last imported" status (revision, timestamp, source) on the Roadmap page so that I know when the roadmap was last synchronized even after refreshing the page.
- As a developer, I want to see detailed import counts (inserted/updated/archived/deleted for both initiatives and epics) so that I understand exactly what changed during each import.

## Specific Requirements

**Enhance RoadmapImportResultDto with detailed counts**
- Expand the existing DTO to include: initiatives_inserted, initiatives_updated, initiatives_archived, initiatives_deleted
- Add corresponding epic counts: epics_inserted, epics_updated, epics_archived, epics_deleted
- Include artifact_revision as currently exists
- Remove or deprecate the generic "created" counts in favor of the detailed breakdown

**Compute detailed counts in RoadmapImportService**
- Track inserted count: items with IDs not present in existing items map
- Track updated count: items that existed and had any field change (title, description, parent_id, sort_order, status)
- Track archived count: items transitioned to status="ARCHIVED" during removed items processing
- Track deleted count: items removed entirely (no children) during removed items processing
- Return counts separately for INITIATIVE and EPIC types

**Add latest-metadata endpoint for artifact status**
- New endpoint: GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata
- Returns lightweight metadata without content: project_id, artifact_type, revision, created_at, source
- Returns 404 if no artifact exists for the given project and type
- Validate artifactType against allowlist (ROADMAP_MD, MISSION_MD)

**Extend frontend API client with new types and methods**
- Add RoadmapImportResult type with all detailed count fields (initiativesInserted, initiativesUpdated, etc.)
- Add ArtifactMetadata type with projectId, artifactType, revision, createdAt, source
- Add fetchLatestArtifactMetadata(projectId, artifactType) function returning Promise<ArtifactMetadata>
- Update importRoadmap function to map the enhanced response DTO

**Implement persisted "Last imported" panel on Roadmap page**
- On component mount, call fetchLatestArtifactMetadata(projectId, "ROADMAP_MD")
- If 404 returned, display "Not imported yet" message
- If metadata returned, display: revision number, formatted timestamp, source badge
- Update panel immediately after successful import without requiring manual refresh

**Display import summary with detailed counts**
- After successful import, show compact summary card with all counts
- Format: "Initiatives: +X inserted / ~Y updated / Z archived / W deleted"
- Format: "Epics: +X inserted / ~Y updated / Z archived / W deleted"
- Use visual indicators (green for inserted, blue for updated, gray for archived, red for deleted)

**Add "Go to Backlog" next-step CTA**
- After import success, check if any active (non-ARCHIVED) epics exist in roadmapItems state
- If activeEpics.length > 0, display prominent "Go to Backlog" button
- Button navigates to /product/backlog route
- If no active epics, display hint: "No active epics found. Edit roadmap.md and re-import."

**Implement actionable error UX**
- 404 error: Display "roadmap.md not found. Expected at: agent-os/product/roadmap.md"
- 400 error: Display "Couldn't parse roadmap.md. Supported formats: headings, lists, initiative bullets, tables."
- 409 error: Display server error message with "Retry" button
- Other errors: Display server message with "Retry" button
- Ensure no unhandled crashes; all states (loading/importing/error) render gracefully

## Existing Code to Leverage

**RoadmapImportService.java**
- Already implements upsert logic with existing items map lookup
- Already tracks which items are archived vs deleted in archiveOrDeleteRemovedItems()
- Extend the existing int[] counts return to capture all four categories per type
- Preserve the deterministic ID generation and title normalization logic

**RoadmapImportResultDto.java**
- Currently has projectId, artifactRevision, initiativesCreated, epicsCreated fields
- Extend with inserted/updated/archived/deleted variants
- Use @JsonProperty annotations for snake_case JSON output

**ProjectArtifactController.java**
- Already has GET /{artifactType}/latest endpoint returning full ProjectArtifactDto
- Add sibling endpoint GET /{artifactType}/latest-metadata for lightweight metadata-only response
- Reuse existing validation and service layer patterns

**ProductRoadmapPage.tsx**
- Already has importResult state and error handling patterns
- Already displays import counts in status card
- Extend to call metadata endpoint on mount and update panel
- Add navigation logic for "Go to Backlog" CTA

**roadmapApi.ts**
- Already has importRoadmap function and ImportResult/ImportResultDto types
- Extend types with detailed count fields
- Add fetchLatestArtifactMetadata function following same fetch patterns

## Out of Scope
- No roadmap editing functionality (read-only view only)
- No LLM or chat integration for import suggestions
- No backlog CRUD changes (handled in separate spec)
- No database schema changes (use existing project_artifact and work_item tables)
- No migration of historical import data
- No batch import from multiple roadmap files
- No export/generation from DB back to roadmap.md
- No UI for viewing artifact revision history
- No conflict detection for concurrent imports
- No audit logging of import operations
