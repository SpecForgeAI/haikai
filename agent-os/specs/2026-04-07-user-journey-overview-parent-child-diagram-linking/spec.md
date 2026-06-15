# Specification: User Journey Overview Parent-Child Diagram Linking

## Goal
Wire User Journey Overview parent diagrams to saved child USER_JOURNEY diagrams so that clicking an overview journey node navigates to its detailed child diagram, using deterministic link resolution during projection and the existing diagram-link navigation pattern.

## User Stories
- As an architect, I want to click a journey node in the overview diagram and navigate directly to its detailed child USER_JOURNEY diagram so that I can drill down from a role-level view to application-swimlane detail without manually searching.
- As an architect, I want visual feedback on which overview nodes have linked child diagrams so that I can quickly see coverage gaps where detailed diagrams have not yet been created.

## Specific Requirements

**Backend: Add `findByModelFileIdAndDiagramType` to DiagramRepository**
- Add a new Spring Data JPA derived query method `List<DiagramEntity> findByModelFileIdAndDiagramType(String modelFileId, String diagramType)` to `DiagramRepository`
- This avoids loading all diagram types when only USER_JOURNEY diagrams are needed for link resolution

**Backend: Add nested link sub-record to UserJourneyOverviewNodeDto**
- Add a new inner record `UserJourneyOverviewNodeLinkDto` inside `UserJourneyOverviewNodeDto`, following the established `UserJourneyOverviewNodeMetadataDto` nested sub-record pattern
- Fields: `linked_diagram_id` (String, nullable, `@JsonProperty("linked_diagram_id")`), `linked_diagram_name` (String, nullable), `link_status` (String, always non-null: `"LINKED"`, `"UNLINKED"`, or `"AMBIGUOUS_RESOLVED"`)
- Add a new `link` field of type `UserJourneyOverviewNodeLinkDto` to the `UserJourneyOverviewNodeDto` record constructor, serialized as `@JsonProperty("link")`
- The `link` field is always present (never null) with `link_status` always populated
- Update the `deriveNodes` call in `UserJourneyOverviewDiagramProjectionService` to pass link data into each node constructor

**Backend: Extend projection service with link resolution**
- Inject `DiagramRepository` into `UserJourneyOverviewDiagramProjectionService` via the existing `@RequiredArgsConstructor` pattern
- After resolving the `modelFileId` in `projectOverview()`, call `diagramRepository.findByModelFileIdAndDiagramType(modelFileId, "USER_JOURNEY")` once to fetch all candidate child diagrams
- For each candidate diagram, parse `typedContentJson` to extract `source_user_journey_id` following the `UserJourneySyncService` pattern: `typedContentJson -> "content" (Map) -> "sync" (Map) -> "source_user_journey_id" (String)`. Skip diagrams with null typed content, null content block, or null sync block (v1 diagrams)
- Build a `Map<String, List<DiagramEntity>>` keyed by `source_user_journey_id` for O(1) lookup during node construction
- Resolution rule per node: zero matches = UNLINKED; exactly one match = LINKED with that diagram's id and name; multiple matches = AMBIGUOUS_RESOLVED, choosing the diagram with the alphabetically last ID (since `DiagramEntity` has no `updatedAt` field, use `Collections.max` by `id` as the deterministic tiebreaker)
- Pass the resolution map into `deriveNodes` and populate each node's `link` sub-record accordingly

**Frontend: Extend TypeScript overview node type with link sub-interface**
- Add a new `UserJourneyOverviewNodeLinkDto` interface in `userJourneyOverviewDiagram.ts` with fields: `linked_diagram_id: string | null`, `linked_diagram_name: string | null`, `link_status: 'LINKED' | 'UNLINKED' | 'AMBIGUOUS_RESOLVED'`
- Add an optional `link?: UserJourneyOverviewNodeLinkDto` field to `UserJourneyOverviewNodeDto` (optional so that pre-existing saved overviews without the field are treated as UNLINKED)
- Update `UserJourneyOverviewContent` in `typedContent.ts` if the node type import path changes

**Frontend: Add `onNodeClick` callback prop to UserJourneyOverviewDiagramRenderer**
- Add `onNodeClick?: (node: UserJourneyOverviewNodeDto) => void` to the `UserJourneyOverviewDiagramRendererProps` interface
- Pass `onNodeClick` into the `renderNode` helper function as an additional parameter
- In `renderNode`, wrap the node `<g>` element with an `onClick` handler that calls `onNodeClick(node)` if provided, and set `cursor: 'pointer'` on the group when the node has `link?.link_status` of `LINKED` or `AMBIGUOUS_RESOLVED`

**Frontend: Add visual cue for linked nodes**
- In `renderNode`, when `node.link?.link_status` is `'LINKED'` or `'AMBIGUOUS_RESOLVED'`, apply: node name text `fill="#1976D2"` (blue) instead of `#333`, and `textDecoration="underline"` on the name `<text>` element
- This matches the existing `linkedDiagramId` convention in `Canvas.tsx` (line ~2546-2551: `#1976D2` blue text, underline text-decoration)
- Unlinked nodes retain default styling (`fill="#333"`, no underline, default cursor)

**Frontend: Wire onNodeClick in overview review mode (DiagramsView.tsx)**
- In the `overviewReview.active` rendering branch of DiagramsView.tsx (around line 3867), pass an `onNodeClick` callback to `UserJourneyOverviewDiagramRenderer`
- The callback checks `node.link?.link_status`: if `'LINKED'` or `'AMBIGUOUS_RESOLVED'`, call `overviewReview.closeOverviewReview()` then `dispatch({ type: 'SELECT_DIAGRAM', payload: node.link.linked_diagram_id })`
- If `'UNLINKED'` or link is missing, call `setToastState({ visible: true, message: 'No linked child diagram saved yet', type: 'info' })`
- The `dispatch` and `setToastState` are already in scope at the DiagramsView component level

**Frontend: Wire onNodeClick in saved overview mode (Canvas.tsx)**
- In the `isUserJourneyOverviewDiagram` rendering branch of Canvas.tsx (around line 3639), pass an `onNodeClick` callback to `UserJourneyOverviewDiagramRenderer`
- The callback checks `node.link?.link_status`: if `'LINKED'` or `'AMBIGUOUS_RESOLVED'`, call `dispatch({ type: 'SELECT_DIAGRAM', payload: node.link.linked_diagram_id })` and scroll to top (same as `handleLinkedTextClick` pattern)
- For unlinked nodes, Canvas.tsx does not have direct access to `setToastState` from DiagramsView. Either pass a toast callback prop down from DiagramsView, or add a local toast mechanism. The simplest approach is to accept an `onUnlinkedNodeClick?: () => void` prop on Canvas and wire it from DiagramsView with `setToastState`

**Backward compatibility for saved overviews**
- Frontend must handle missing `link` field gracefully: if `node.link` is undefined (from a pre-increment-14 saved overview), treat the node as UNLINKED (default styling, toast on click)
- The `UserJourneyOverviewDiagramDto` version stays `"1.0"` -- this is an additive, backward-compatible change
- The `typedContent` envelope version for USER_JOURNEY_OVERVIEW remains unchanged

## Visual Design
No visual assets provided. The visual treatment follows existing codebase conventions: linked nodes use `#1976D2` blue text with underline (matching `Canvas.tsx` `linkedDiagramId` styling), pointer cursor on linked nodes, default styling on unlinked nodes.

## Existing Code to Leverage

**Canvas.tsx `handleLinkedTextClick` (line ~2424-2434)**
- Dispatches `{ type: 'SELECT_DIAGRAM', payload: linkedDiagramId }` and scrolls container to top
- This is the canonical diagram-link navigation pattern to replicate in the overview renderer's `onNodeClick` callback
- Both the review-mode and saved-mode wiring should follow this exact dispatch pattern

**Canvas.tsx linked node styling (line ~2546-2551)**
- `node.linkedDiagramId ? '#1976D2' : (node.text_color || '#333')` for text color
- `node.linkedDiagramId ? 'underline' : (node.text_text_decoration || 'none')` for text decoration
- This convention defines the blue + underline visual cue to apply to linked overview nodes

**UserJourneySyncService typed content parsing (line ~58-78)**
- Demonstrates the exact `Map<String, Object>` casting chain: `typedContentJson -> get("content") -> get("sync") -> get("source_user_journey_id")`
- Includes null checks at each level and graceful handling of v1 diagrams without sync blocks
- The projection service link resolver should follow this same defensive parsing pattern

**UserJourneyOverviewNodeDto.UserJourneyOverviewNodeMetadataDto nested sub-record pattern**
- Existing inner record with `@JsonProperty` annotations inside `UserJourneyOverviewNodeDto`
- The new `UserJourneyOverviewNodeLinkDto` should follow this exact structural pattern (inner public record with `@JsonProperty` on each field)

**DiagramsView.tsx `toastState` / `setToastState` (line ~837)**
- Existing `useState<{ visible: boolean; message: string; type: ToastType }>` for transient feedback
- The `Toast` component is rendered at line ~4076 with dismiss handler
- Reuse this mechanism for the "No linked child diagram saved yet" unlinked-node feedback

## Out of Scope
- New meta-model entities or workbook/XLSX changes
- Manual editing of parent-child links in canvas
- Bulk link-management UI
- Automatic creation of missing child diagrams when a node is unlinked
- Bidirectional sync between parent overview and child diagrams
- Changes to child USER_JOURNEY diagram structure or renderer
- Changes to USER_JOURNEY_LINK edge semantics
- Cross-project linking (links are scoped to the same model file)
- Deep-linking to a specific step within a child diagram
- JSONB native query optimization for typed content parsing
- Heavy new visual treatments (icons, badges, animations) for linked/unlinked state
- Separate link-resolution REST endpoint (resolution is inline in projection service)
- Adding `updatedAt` timestamp column to the `diagrams` table (use ID-based tiebreaker instead)
