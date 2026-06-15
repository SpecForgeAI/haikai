# Specification: Product Roadmap Stage 3 - Read-Only Review with ARCHIVED Status and Expandable Descriptions

## Goal
Enhance the existing Product Roadmap page with ARCHIVED status visual indication, default collapse behavior for archived items, and expandable epic descriptions, completing Stage 3 of the roadmap review functionality.

## User Stories
- As a product manager, I want to see which initiatives and epics are archived so that I can focus on active work items while still having visibility into historical items.
- As a product manager, I want to expand epic descriptions to see full details without cluttering the default view so that I can quickly scan the roadmap and dive deeper when needed.

## Specific Requirements

**ARCHIVED Status Visual Indication**
- Work items with status "ARCHIVED" display a distinct "ARCHIVED" badge alongside their type badge
- ARCHIVED badge uses a muted/greyed color scheme (e.g., grey background with dark grey text)
- ARCHIVED items have a muted overall row style (reduced opacity or greyed text color)
- Both INITIATIVE and EPIC types support ARCHIVED status display

**Default Collapse Behavior for ARCHIVED Items**
- Non-archived INITIATIVEs are expanded by default (existing behavior)
- ARCHIVED INITIATIVEs are collapsed by default on page load
- Users can manually expand/collapse any initiative regardless of archive status
- Collapse state is tracked in component state via expandedIds Set

**Epic Description Preview with Expand/Collapse**
- Epic descriptions show a 1-2 line preview by default using CSS line-clamp
- Each epic with a description longer than the preview shows a "Show more" toggle link
- Clicking "Show more" expands to reveal the full description text
- Expanded descriptions show a "Show less" toggle to collapse back to preview
- Description expansion state is per-epic, tracked in component state

**Import Summary Display Enhancement**
- Import result banner shows revision number, initiatives created/updated, epics created/updated
- If backend returns partial data, show only available fields with graceful fallback
- Success banner uses green accent color; displays for the session until next import

**Empty and Error State Handling**
- Empty state shows "No roadmap imported yet." with CTA button to import
- Initiatives with zero epics show "No epics defined." placeholder text
- 404 error: "roadmap.md not found at agent-os/product/roadmap.md"
- 409 error: Display the error message verbatim from the API
- Other errors: Generic message with Retry button

**Sorting and Hierarchy**
- Sort initiatives and epics by: sort_order ascending, then createdAt ascending, then id ascending
- Maintain parent-child hierarchy: INITIATIVEs as roots, EPICs as children under their parent initiative
- Use existing buildWorkItemTree utility with INITIATIVE/EPIC type filter

## Existing Code to Leverage

**ProductRoadmapPage.tsx (frontend/src/components/ProductView/ProductRoadmapPage.tsx)**
- Existing page component with import button, status card, and tree rendering
- Already handles loading, error, empty states and import API calls
- Modify expandedIds initialization to check for ARCHIVED status
- Add epicDescriptionExpandedIds state for description toggle tracking

**WorkItemTree.tsx (frontend/src/components/ProductView/WorkItemTree.tsx)**
- Existing tree component with expand/collapse, type badges, and indentation
- Extend to support optional ARCHIVED badge display alongside type badge
- Add optional description preview/expand section below title row for EPICs

**workItemTreeBuilder.ts (frontend/src/utils/workItemTreeBuilder.ts)**
- Pure function buildWorkItemTree for hierarchy building from flat array
- Already sorts by sortOrder, createdAt, id and handles orphan detection
- No changes needed; use existing filtering in ProductRoadmapPage

**WorkItemTree.module.css (frontend/src/components/ProductView/WorkItemTree.module.css)**
- Existing styles for tree rows, type badges, chevrons
- Add new styles: .archivedBadge, .archivedRow (muted), .descriptionPreview, .descriptionExpanded, .showMoreLink

**workItems.ts types (frontend/src/types/workItems.ts)**
- WorkItem interface includes status field already
- No type changes needed; ARCHIVED is just a status string value

## Out of Scope
- Editing work items from the Roadmap page (read-only view only)
- LLM or chat-based assistance on this page
- Creating or modifying backlog items (features/stories) from this page
- Markdown rendering for descriptions (display as plain text)
- Inline editing of roadmap.md file
- Drag-and-drop reordering of initiatives or epics
- Filtering or search functionality within the roadmap view
- Export functionality for roadmap data
- Multi-project roadmap comparison views
- Status transitions or workflow automation from this page
