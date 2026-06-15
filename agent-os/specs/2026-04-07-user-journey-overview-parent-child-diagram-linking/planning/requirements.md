# Spec Requirements: User Journey Overview Parent-Child Diagram Linking

## Initial Description
Wire generated/saved User Journey Overview parent diagrams to saved child USER_JOURNEY diagrams using the existing diagram-link capability, so overview journey nodes become navigable entry points into the detailed child journey diagrams. Increment 13 introduced the generated parent diagram type USER_JOURNEY_OVERVIEW with nodes = USER_JOURNEY, edges = USER_JOURNEY_LINK, grouped by Business Process. This increment connects the two diagram layers: parent = role/process-level overview, child = application-swimlane detailed USER_JOURNEY diagram. The codebase already has a concept of diagram links (linkedDiagramId) on diagram objects/components.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the backend link resolution should happen inside the existing `UserJourneyOverviewDiagramProjectionService.projectOverview()` method -- meaning the projection service enriches each node with `linked_diagram_id`, `linked_diagram_name`, and `link_status` at generation time, rather than requiring a separate endpoint call. Is that correct, or should this be a separate endpoint that decorates an already-projected overview?
**Answer:** Resolve links inside the existing UserJourneyOverviewDiagramProjectionService during overview projection so each node is enriched at generation time; do not create a separate link-resolution endpoint in Increment 14.

**Q2:** Looking at the current `UserJourneyOverviewNodeDto`, it has no linking fields. I assume we extend this Java record by adding `linked_diagram_id` (String, nullable), `linked_diagram_name` (String, nullable), and `link_status` (String: "LINKED" / "UNLINKED" / "AMBIGUOUS_RESOLVED") fields, and correspondingly update the `UserJourneyOverviewNodeDto` TypeScript interface. Is that the right approach, or do you prefer link metadata in a separate sub-record (similar to how `metadata` is already a nested record)?
**Answer:** Extend UserJourneyOverviewNodeDto with a small nested link sub-object (preferred over multiple flat fields) so the contract stays tidy and future-safe.

**Q3:** The resolution rule says to find saved diagrams where `diagram_type=USER_JOURNEY` and `typedContent.sync.source_user_journey_id` matches the node's journey ID. This requires querying the JSONB `typed_content_json` column. I assume we should add a new repository query method, something like `DiagramRepository.findByDiagramTypeAndModelFileId("USER_JOURNEY", modelFileId)` and then filter in Java by parsing the typed content JSON to extract `source_user_journey_id`, rather than writing a raw JSONB SQL query. Is that correct, or do you want a native `@Query` with JSONB path extraction for performance?
**Answer:** Start with the simpler repository/query approach: fetch candidate USER_JOURNEY diagrams scoped to the current project/model and resolve source_user_journey_id in Java by reading typed content; do not introduce JSONB-specific native query optimization in Increment 14 unless it is already a well-established pattern in this codebase.

**Q4:** For the temporary review mode (overview not yet saved): the `UserJourneyOverviewDiagramRenderer` currently has no click/navigation behavior on nodes. I assume clicking a linked node should dispatch a `SELECT_DIAGRAM` action (same as the existing `handleLinkedTextClick` pattern in Canvas.tsx), which would navigate to the saved child diagram and simultaneously close/exit the overview review mode. Is that the expected behavior, or should it open the child diagram in a separate view/tab?
**Answer:** In temporary review mode, clicking a linked node should navigate/open the child diagram through the normal diagram-opening flow and effectively leave/close the parent temporary review context rather than opening a parallel secondary view.

**Q5:** For saved overview diagrams loaded via Canvas.tsx: the Canvas already has `handleLinkedTextClick` wired for native nodes/edges/decorations that have `linkedDiagramId`. However, the saved overview diagram is rendered via `UserJourneyOverviewDiagramRenderer` (inline SVG), not via native `DiagramNode` objects. I assume the click handler needs to be added directly to the `UserJourneyOverviewDiagramRenderer` component (and also to the overview review mode wrapper), receiving a callback prop like `onNodeClick(diagramId: string)`. Is that correct?
**Answer:** Yes, add the click handling directly to UserJourneyOverviewDiagramRenderer via a callback prop (e.g. onNodeClick or onLinkedNodeClick) since the overview is rendered as SVG, not native DiagramNode objects.

**Q6:** When a node is UNLINKED (no matching saved child diagram), the spec says "UI shows lightweight feedback message." I assume this means a transient toast or tooltip on click (e.g., "No linked child diagram saved yet"), rather than a persistent label on the node or a modal. Is that correct?
**Answer:** Yes, use lightweight transient feedback such as a toast/tooltip/message for unlinked nodes; do not add a persistent label or modal for this case.

**Q7:** The deterministic resolution rule says "multiple matches: choose most recently updated, fall back to deterministic ordering." I assume the "most recently updated" tiebreaker uses the `DiagramEntity.updatedAt` timestamp, and the fallback deterministic ordering is alphabetical by diagram ID. Is that the expected behavior?
**Answer:** Yes, use most-recently-updated as the deterministic primary tiebreaker, with diagram ID/name stable ordering as fallback if timestamps are equal or unavailable.

**Q8:** Is there anything specific you want to explicitly exclude from this increment beyond what's listed in the out-of-scope section? For example: should we avoid adding visual differentiation between linked and unlinked nodes (e.g., different border color, link icon badge), or should linked nodes have a subtle visual cue (like the blue underline treatment used by `linkedDiagramId` in Canvas.tsx)?
**Answer:** Yes, linked nodes should have a subtle visual cue consistent with existing diagram-link styling conventions if possible, but keep it understated and do not add heavy new visual treatments in this increment.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Canvas.tsx handleLinkedTextClick -- Path: `frontend/src/components/DiagramsView/Canvas.tsx` (lines ~2424-2434) -- The exact diagram-link navigation pattern: dispatches `SELECT_DIAGRAM`, scrolls to top. This is the canonical navigation behavior to replicate inside the overview renderer.
- Feature: Canvas.tsx linked node styling -- Path: `frontend/src/components/DiagramsView/Canvas.tsx` (lines ~2546-2551) -- Blue text (#1976D2), underline text-decoration for nodes with `linkedDiagramId`. This is the visual cue convention to follow for linked overview nodes.
- Feature: UserJourneyOverviewDiagramProjectionService -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyOverviewDiagramProjectionService.java` -- The projection service to extend with link resolution logic. Currently produces `UserJourneyOverviewNodeDto` without link metadata.
- Feature: UserJourneyOverviewNodeDto -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewNodeDto.java` -- The Java record to extend with a nested link sub-record. Currently has `metadata` as a nested sub-record pattern to follow.
- Feature: UserJourneyOverviewDiagramRenderer -- Path: `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx` -- The SVG renderer to extend with click handlers and visual cues. Currently has no interaction behavior on nodes.
- Feature: UserJourneySyncService typed content reading -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneySyncService.java` (lines ~58-78) -- Pattern for reading `typedContentJson` Map and extracting nested `sync.source_user_journey_id` from a DiagramEntity. This is the exact parsing pattern needed for link resolution.
- Feature: DiagramRepository -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/diagram/DiagramRepository.java` -- Has `findByModelFileId(String modelFileId)` which returns all diagrams for a model; needs a new method `findByModelFileIdAndDiagramType(String modelFileId, String diagramType)` for scoped querying.
- Feature: UserJourneyOverviewReviewContext -- Path: `frontend/src/contexts/UserJourneyOverviewReviewContext.tsx` -- The ephemeral review session context. The overview review close action (`closeOverviewReview`) will need to be called when navigating from a temporary review node to a child diagram.
- Feature: DiagramsView overview review wiring -- Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines ~3867 onward) -- Where the overview renderer is mounted in both review mode and saved mode; both paths need the new callback prop wiring.
- Feature: TypeScript overview types -- Path: `frontend/src/types/userJourneyOverviewDiagram.ts` -- The `UserJourneyOverviewNodeDto` interface to extend with a link sub-interface, mirroring the backend change.
- Feature: Toast pattern in DiagramsView -- Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (line ~837) -- The existing `toastState`/`setToastState` pattern for transient feedback messages, to be used for "No linked child diagram saved yet" on unlinked node click.

### Follow-up Questions
No follow-up questions were needed. All answers were comprehensive and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable -- no visual assets were submitted.

## Requirements Summary

### Functional Requirements

**Backend Link Resolution (inside ProjectionService):**
- Extend `UserJourneyOverviewDiagramProjectionService.projectOverview()` to resolve child diagram links for each overview node during projection
- For each USER_JOURNEY node, find saved diagrams where `diagram_type=USER_JOURNEY` and `typedContent.content.sync.source_user_journey_id` matches the node's journey ID, scoped to the same model file
- Add a new `DiagramRepository` query method: `findByModelFileIdAndDiagramType(String modelFileId, String diagramType)` to fetch candidate USER_JOURNEY diagrams efficiently
- Parse `typedContentJson` in Java to extract `source_user_journey_id` from the sync metadata block (following the `UserJourneySyncService` pattern)
- Apply deterministic resolution: exactly one match = LINKED; multiple matches = choose most-recently-updated (by entity timestamp), fallback to alphabetical diagram ID ordering (AMBIGUOUS_RESOLVED); no match = UNLINKED
- Inject `DiagramRepository` into the projection service

**Backend DTO Contract Extension:**
- Add a nested link sub-record to `UserJourneyOverviewNodeDto` (following the existing `UserJourneyOverviewNodeMetadataDto` pattern): fields `linked_diagram_id` (String, nullable), `linked_diagram_name` (String, nullable), `link_status` (String: "LINKED" / "UNLINKED" / "AMBIGUOUS_RESOLVED")
- The sub-record should be named something like `UserJourneyOverviewNodeLinkDto` and serialized as a `link` field on the node DTO
- The link sub-record is always present (never null at the top level) with `link_status` always populated

**Frontend TypeScript Type Extension:**
- Add a `UserJourneyOverviewNodeLinkDto` interface to `userJourneyOverviewDiagram.ts` with fields: `linked_diagram_id` (string | null), `linked_diagram_name` (string | null), `link_status` (string: 'LINKED' | 'UNLINKED' | 'AMBIGUOUS_RESOLVED')
- Add `link: UserJourneyOverviewNodeLinkDto` field to `UserJourneyOverviewNodeDto` interface
- Update `UserJourneyOverviewContent` in `typedContent.ts` if needed to reflect the updated node shape

**Frontend Renderer Click Handling:**
- Add a callback prop to `UserJourneyOverviewDiagramRenderer`: `onNodeClick?: (node: UserJourneyOverviewNodeDto) => void`
- Wire the callback to each node's SVG `<g>` element (or a clickable overlay rect) so clicking a node invokes the callback with the node data
- The parent component (DiagramsView or Canvas.tsx) implements the callback to:
  - If node has `link.link_status === 'LINKED'`: dispatch `SELECT_DIAGRAM` with `link.linked_diagram_id` to navigate to the child diagram
  - If node has `link.link_status === 'UNLINKED'`: show a transient toast message "No linked child diagram saved yet"
  - If node has `link.link_status === 'AMBIGUOUS_RESOLVED'`: navigate to the resolved diagram (same as LINKED)

**Frontend Renderer Visual Cues:**
- Linked nodes (LINKED or AMBIGUOUS_RESOLVED) should have subtle visual differentiation consistent with existing `linkedDiagramId` styling in Canvas.tsx:
  - Node name text color: `#1976D2` (blue) instead of default `#333`
  - Node name text decoration: `underline`
  - Cursor: `pointer` on the node group
- Unlinked nodes retain the default styling (no color change, default cursor)

**Temporary Review Mode Navigation:**
- When the overview is in temporary review mode (via `UserJourneyOverviewReviewContext`) and the user clicks a linked node:
  - Close the overview review session (`overviewReview.closeOverviewReview()`)
  - Dispatch `SELECT_DIAGRAM` with the linked diagram ID to navigate to the child diagram
  - The previous view restoration is handled by the diagram selection, not by restoring the pre-review view
- The callback needs to be wired in the DiagramsView overview review rendering path (where `UserJourneyOverviewDiagramRenderer` is mounted with `overviewReview.overviewDiagram`)

**Saved Overview Diagram Navigation:**
- When a saved USER_JOURNEY_OVERVIEW diagram is rendered in Canvas.tsx via the `UserJourneyOverviewDiagramRenderer`, the same `onNodeClick` callback prop is wired
- Canvas.tsx implements the callback the same way: dispatch `SELECT_DIAGRAM` for linked nodes, show toast for unlinked nodes
- The overview data comes from `extractUserJourneyOverviewDiagram(diagram)` which reads from `typedContent.content`

**Unlinked Node Feedback:**
- Clicking an unlinked node shows a transient toast using the existing `toastState`/`setToastState` pattern in DiagramsView
- Message: "No linked child diagram saved yet" (or similar concise text)
- Toast type: `'info'` or neutral styling (not error)

### Reusability Opportunities
- `Canvas.tsx handleLinkedTextClick` pattern: exact same `dispatch({ type: 'SELECT_DIAGRAM', payload: linkedDiagramId })` + scroll-to-top logic
- `Canvas.tsx` linked node styling: `#1976D2` blue text + `underline` text-decoration convention
- `UserJourneySyncService` typed content parsing: `Map<String, Object>` casting chain to extract `content.sync.source_user_journey_id`
- `UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto` nested sub-record pattern: structural pattern for the new link sub-record
- `DiagramRepository.findByModelFileId`: basis for the new `findByModelFileIdAndDiagramType` query method
- `toastState` / `setToastState` in DiagramsView: existing transient feedback mechanism for unlinked node click
- `OverviewReviewBanner` / `UserJourneyOverviewReviewContext`: the review mode lifecycle management for temporary overview close-on-navigate behavior

### Scope Boundaries

**In Scope:**
- Backend: Extend projection service to resolve child diagram links during overview generation
- Backend: Add nested link sub-record to UserJourneyOverviewNodeDto Java record
- Backend: Add `findByModelFileIdAndDiagramType` to DiagramRepository
- Backend: Parse typed_content_json in Java to extract source_user_journey_id (no JSONB native query)
- Frontend: Extend UserJourneyOverviewNodeDto TypeScript interface with link sub-interface
- Frontend: Add onNodeClick callback prop to UserJourneyOverviewDiagramRenderer
- Frontend: Wire click handler in both temporary review mode and saved diagram mode
- Frontend: Subtle blue underline visual cue on linked nodes (matching existing linkedDiagramId convention)
- Frontend: Transient toast for unlinked node click
- Frontend: Close temporary review session when navigating from review mode to child diagram
- Testing: Backend projection link resolution unit tests
- Testing: Frontend renderer click handler and visual cue tests
- Testing: Regression tests for existing overview functionality

**Out of Scope:**
- New meta-model entities
- Workbook/XLSX changes
- Manual editing of parent-child links in canvas
- Bulk link-management UI
- Automatic creation of missing child diagrams
- Bidirectional sync between parent and child diagrams
- Changes to child USER_JOURNEY diagram structure or renderer
- Changes to USER_JOURNEY_LINK semantics
- Cross-project linking
- Deep-linking to specific step within a child diagram
- JSONB native query optimization (may be a future performance enhancement)
- Heavy new visual treatments (icons, badges, animations) for linked/unlinked state
- Separate link-resolution endpoint (resolution is inline in projection)

### Technical Considerations

**Backend Architecture:**
- The projection service (`UserJourneyOverviewDiagramProjectionService`) already has `ModelFileRepository` injected and calls `resolveModelFile(projectId)` to get the `modelFileId`. The link resolution can reuse this same `modelFileId` to scope the diagram query.
- `DiagramRepository` currently has `findByModelFileId(String)` which returns ALL diagram types. A new `findByModelFileIdAndDiagramType(String, String)` method avoids loading unnecessary diagrams.
- The `DiagramEntity` stores `typedContentJson` as `Map<String, Object>`. Extracting `source_user_journey_id` requires navigating: `typedContentJson -> "content" (Map) -> "sync" (Map) -> "source_user_journey_id" (String)`. This matches the existing pattern in `UserJourneySyncService` lines 58-78.
- v1 USER_JOURNEY diagrams (no sync block) will not have `source_user_journey_id` and thus cannot be matched. This is correct behavior -- only sync-aware v2 diagrams participate in linking.
- The `DiagramEntity` does not currently have a dedicated `updatedAt` timestamp field visible in the entity. The tiebreaker implementation should check what timestamp fields are available (e.g., from the database schema or entity) and fall back to ID-based ordering if no timestamp is available.

**Frontend Architecture:**
- The `UserJourneyOverviewDiagramRenderer` is a pure SVG renderer component (`<g>` root). It needs a new optional `onNodeClick` prop. The `renderNode` helper function needs to receive the callback and wrap the node `<g>` with click handling.
- In temporary review mode, the renderer is mounted in DiagramsView at the overview review rendering path. The callback there needs access to both `overviewReview.closeOverviewReview()` and `dispatch({ type: 'SELECT_DIAGRAM' })`.
- In saved diagram mode, the renderer is mounted inside Canvas.tsx at the `isUserJourneyOverviewDiagram` branch. The callback there needs access to `dispatch` (already available in Canvas scope).
- Both rendering paths should share the same callback logic: check link status, navigate or show toast.
- The toast for unlinked nodes reuses the existing `toastState` mechanism in DiagramsView. For the Canvas.tsx path, the toast callback may need to be passed down or the Canvas may need its own toast state.

**Contract Compatibility:**
- The `UserJourneyOverviewDiagramDto` version remains "1.0" -- the link sub-record is an additive, backward-compatible change (link field is nullable/optional on the frontend type).
- Existing saved USER_JOURNEY_OVERVIEW diagrams (saved before this increment) will have nodes without the `link` field. The frontend must handle missing `link` gracefully (treat as UNLINKED).
- The typed content envelope version for USER_JOURNEY_OVERVIEW remains 1 -- no version bump needed since the change is additive.
