# Specification: Upload Book of Work from Markdown

## Goal
Add a Roadmap-screen feature that lets users upload a single Markdown "Book of Work" file representing a hierarchy up to 4 levels deep (Initiative, Epic, Feature, Story), parse it server-side, persist the work items with parent/child relationships, and immediately display the imported hierarchy in the UI.

## User Stories
- As a product owner, I want to upload a Book of Work markdown file so that I can quickly populate my project with a full hierarchy of work items without manual entry.
- As a delivery lead, I want incomplete hierarchies (branches stopping at any level) to import successfully so that I can iteratively build out my work breakdown structure.

## Specific Requirements

**Frontend: Upload Book of Work Button**
- Add a new button labeled "Upload Book of Work" in the Roadmap control row (ProductView.tsx)
- Position the button beside the existing "Import/Refresh roadmap.md" button
- Button should be disabled when no active project is selected (same pattern as existing import button)
- Use consistent button styling from ProductView.module.css (controlRowButton class)

**Frontend: File Chooser and Upload Flow**
- On button click, open a browser file chooser dialog
- Accept file types: .md files (set accept attribute to ".md" or "text/markdown")
- Read the file content using FileReader API in the browser
- Send the markdown content to the backend API as a JSON body with the content string
- Show a loading/in-progress indicator while upload is processing (reuse importing state pattern)

**Frontend: Error Handling and Display**
- Display parse/import errors returned from the backend in the existing error card UI
- Error messages should include line/heading references when available from the backend
- Use the existing errorMessage/errorStatus state pattern from ProductRoadmapPage

**Frontend: Post-Upload Refresh**
- After successful upload, refresh the work item data by calling fetchWorkItems
- Rebuild the tree display to show the newly imported hierarchy immediately
- Do not require a manual page reload
- Preserve existing expansion state behavior for newly imported items

**Backend: New API Endpoint**
- Add endpoint: POST /api/projects/{projectId}/book-of-work/upload
- Create a new controller (BookOfWorkController.java) following RoadmapImportController patterns
- Request body: JSON object containing the markdown content string (not multipart)
- Response: Return all persisted work items for the project plus import summary metadata (counts)

**Backend: Markdown Parser for Book of Work Format**
- Create a new parser class (BookOfWorkParser.java) following RoadmapParser patterns
- Heading level mapping: H2 (##) = INITIATIVE, H3 (###) = EPIC, H4 (####) = FEATURE, H5 (#####) = STORY
- Text following a heading until the next same-or-higher-level heading becomes the item's description
- Walk headings in document order and build parent/child relationships based on heading levels
- Each child attaches to the nearest prior heading of the immediately higher level

**Backend: Tolerance and Incomplete Hierarchies**
- Allow any branch to stop at any level (e.g., Initiative with no Epics, Epic with no Features)
- Missing lower levels must NOT cause rejection; persist whatever headings are present
- If a heading appears without valid parent context (e.g., FEATURE before any EPIC), attach to nearest valid ancestor or skip with warning
- Reject files with zero recognized headings (H2-H5) with a clear error message

**Backend: Work Item Creation and Upsert Semantics**
- Use destructive sync strategy: delete all existing work items for the project before inserting new ones
- This provides a clean "replace all" behavior for v1, avoiding complex duplicate detection
- Generate deterministic UUIDs using StableIdGenerator pattern with normalized titles and parent chain
- Set all imported items to status "PLANNED" initially
- Return created/updated counts in the response for user feedback

**Backend: Response DTO**
- Create BookOfWorkUploadResultDto with: projectId, workItems (list), importSummary (counts by type)
- Include counts for each work item type: initiativesCreated, epicsCreated, featuresCreated, storiesCreated
- Return the full list of work items so the frontend can update immediately without a separate fetch

**Backend: Validation and Security**
- Apply a file size limit (e.g., 500KB) to prevent abuse and excessive payloads
- Validate projectId exists before processing
- Return 400 Bad Request for empty files or files with no valid headings
- Return 404 if project not found

## Existing Code to Leverage

**RoadmapParser.java (C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\util\RoadmapParser.java)**
- Provides patterns for parsing markdown headings (H2/H3 patterns)
- Shows how to iterate lines, identify sections, and build parent/child relationships
- Demonstrates description collection (text between headings)
- Use as template for BookOfWorkParser with extended heading levels (H4, H5)

**StableIdGenerator.java (C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\util\StableIdGenerator.java)**
- Provides deterministic UUID generation based on normalized titles and parent chains
- Extend key format for FEATURE and STORY types following the EPIC pattern
- Reuse normalizeTitle() method for consistent title normalization

**RoadmapImportController.java and RoadmapImportService.java**
- Controller shows REST endpoint patterns with projectId path variable
- Service shows transaction handling and work item upsert/delete patterns
- Use WorkItemRepository methods for bulk operations (deleteByProjectId, save)
- Follow the RoadmapImportResultDto pattern for response structure

**ProductRoadmapPage.tsx (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ProductRoadmapPage.tsx)**
- Shows existing import button and control state pattern (importing, errorMessage, importResult)
- Provides loadRoadmapItems() pattern for refreshing work item data after import
- Demonstrates error handling and display with errorCard component

**roadmapApi.ts (C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\api\roadmapApi.ts)**
- Shows API client patterns with fetch, error handling, and DTO mapping
- Demonstrates snake_case to camelCase transformation for response data
- Use as template for new bookOfWorkApi.ts with upload function

## Out of Scope
- DOCX, PDF, or any file format other than Markdown
- Changes to the existing roadmap.md import/refresh functionality
- Planner/LLM integration for auto-generating work items
- Agent-OS specs, task execution, or Implement pipeline changes
- Work item editing or status management during import (all items start as PLANNED)
- Upsert/merge semantics (v1 uses destructive replace-all)
- Multi-file upload or batch processing
- Progress indication for large files (v1 uses simple in-progress state)
- Work item reordering or sort order customization during import
- Integration with external systems (Jira, Azure DevOps, etc.)
