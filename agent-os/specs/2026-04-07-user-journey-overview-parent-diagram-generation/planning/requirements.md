# Spec Requirements: User Journey Overview Parent Diagram Generation

## Initial Description

Introduce a new generated parent diagram type, User Journey Overview, derived entirely from existing Business Architecture truth for a selected user role: USER_JOURNEY entities grouped by Business Process, connected by USER_JOURNEY_LINK relationships, with no manual post-drawing required.

Child USER_JOURNEY diagrams already exist and are generated/rendered natively as application-swimlane diagrams. USER_JOURNEY_LINK now exists as a first-class Business Architecture relationship. Users need a zoomed-out parent diagram for a given role that is useful on its own and acts as a high-level architectural overview. That parent diagram should be generated from architecture entities and relationships, not from manually added arrows after auto-drawing. This increment creates the parent overview diagram generation and native rendering; parent-to-child diagram linking/navigation comes later.

The recommended overview contract v1 includes: diagram_type "USER_JOURNEY_OVERVIEW", version "1.0", an overview header (business_user_id, business_user_name, title), lanes (one per Business Process), nodes (one per USER_JOURNEY with metadata for step_count, application_count, relationship_in_count, relationship_out_count), edges (one per USER_JOURNEY_LINK), and render_hints (lane_axis VERTICAL, flow_direction LEFT_TO_RIGHT).

## Requirements Discussion

### First Round Questions

**Q1:** I assume the entry point for generating an overview diagram will be a user action in the existing diagram workspace UI -- for example, a button or menu option like "Generate Journey Overview" that presents a dropdown/selector of available Business Users from the current project's meta-model. Is that correct, or do you envision a different trigger mechanism (e.g., from the Dashboard, from a chat/AI-assisted flow, or from the grid/meta-model view)?
**Answer:** Yes, the trigger should be a user action in the existing diagram/workspace flow, with a Business User selector and a "Generate Journey Overview" style entry point; do not trigger it from Dashboard or the chat flow in Increment 13.

**Q2:** I'm assuming the temporary review flow follows the same pattern as existing temporary diagrams -- where the generated diagram appears in a "review" or "preview" mode within the Canvas workspace, with explicit "Save" and "Discard" actions, and the user cannot edit the content until it is saved. Is that correct? Should the review mode also show any summary information (e.g., "12 journeys across 4 business processes for [Role Name]") before the user commits to saving?
**Answer:** Yes, it should open in temporary review/preview mode in the Canvas/workspace with Save and Discard-style actions, and a compact summary banner is desirable (e.g. journey count and business process count for the selected role).

**Q3:** For the renderer layout, the contract says lane_axis: "VERTICAL" with flow_direction: "LEFT_TO_RIGHT". I'm interpreting this as: horizontal swimlane bands stacked vertically (one band per Business Process), with journey nodes flowing left-to-right within each lane, and directed edges (from USER_JOURNEY_LINK) drawn between nodes across or within lanes. Is that interpretation correct? Should the lane header appear on the left side of each band?
**Answer:** Correct: render horizontal swimlane bands stacked vertically (one per Business Process), with left-to-right node flow within each lane and lane headers labeling each band.

**Q4:** Regarding the node visual design -- I assume each USER_JOURNEY node should display: the journey name (primary label), an optional description (secondary text, possibly truncated), and metadata counts (step_count, application_count, relationship counts) shown as small badges or an info line. Is there a preferred visual treatment, or should this follow whatever pattern existing diagram node types use for metadata display?
**Answer:** Use the native visual language of the existing diagram system rather than inventing a radically different card style; journey name should be primary, description secondary if present, and step/application counts can appear as lightweight metadata/badges only if they stay visually compact.

**Q5:** For edge rendering, I assume USER_JOURNEY_LINK edges should be rendered as directed arrows (with arrowheads) and display the label field from the relationship. Should edge routing be auto-calculated (since this is a generated diagram with deterministic layout), or should it follow the existing waypoint/polyline system with generated waypoints?
**Answer:** Use the existing waypoint/polyline rendering approach if that is the native canvas convention, with deterministic generated waypoints; do not invent a completely separate edge-routing system unless required for minimal correctness.

**Q6:** When saving the overview diagram as a first-class artifact, I assume it gets a standard diagram entry in the project's diagram list, with diagram_type = USER_JOURNEY_OVERVIEW, and the typed content envelope stores the full overview DTO snapshot (lanes, nodes, edges, render_hints). When the user opens a saved overview diagram later, should it render from the saved snapshot (potentially stale if the model changed), or should it re-project from current model data? The spec says "no one-way sync yet," so I'm assuming it renders from the saved snapshot only.
**Answer:** Yes, reopening a saved overview diagram should render from its saved snapshot in Increment 13; do not re-project from current model data yet because one-way sync for overview diagrams is not part of this increment.

**Q7:** I assume that if a Business User has zero USER_JOURNEY entities with matching primary_business_user_id, the generation endpoint should return an empty (but valid) diagram structure with just the title and no lanes/nodes/edges, rather than an error. Is that correct?
**Answer:** Yes, return an empty but valid overview diagram structure for a Business User with zero matching journeys rather than an error.

**Q8:** Is there anything that should explicitly be excluded from this increment that I haven't already captured from the out_of_scope section? For example, any concerns about performance limits (maximum number of journeys/edges before the overview becomes unwieldy), or any export/print functionality for the overview diagram?
**Answer:** Explicitly exclude export/print functionality, performance optimization work beyond normal reasonable data sizes, manual layout editing, advanced graph-routing optimization, and any sync/refresh behavior for overview diagrams in Increment 13.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Diagram Type Registration - Path: `frontend/src/types/diagramType.ts`
  - DiagramType union type, ALL_DIAGRAM_TYPES array, CREATABLE_DIAGRAM_TYPES array, DIAGRAM_TYPE_LABELS record, normalizeDiagramType function, DIAGRAM_TYPE_MAP
  - USER_JOURNEY_OVERVIEW must be added to ALL_DIAGRAM_TYPES but NOT to CREATABLE_DIAGRAM_TYPES (generated, not manually creatable)

- Feature: Typed Content Envelope - Path: `frontend/src/types/typedContent.ts`
  - TypedContentEnvelope interface, DiagramTypedContentType union, TYPED_DIAGRAM_TYPES array, createDefaultTypedContent factory
  - USER_JOURNEY_OVERVIEW needs a new content type (UserJourneyOverviewContent) added to the union and factory

- Feature: Existing User Journey Diagram Types - Path: `frontend/src/types/userJourneyDiagram.ts`
  - UserJourneyDiagramDto, UserJourneyDiagramJourneyDto, UserJourneyDiagramLaneDto, UserJourneyDiagramStepDto, UserJourneyDiagramEdgeDto, UserJourneyDiagramRenderHintsDto
  - These are the child USER_JOURNEY types; the overview needs its own parallel type set

- Feature: Existing User Journey Renderer (child diagrams) - Path: `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`
  - SVG swimlane renderer with computeLayout, computeContentBounds, onContentBounds callback
  - Horizontal lane bands with lane headers, step nodes, directed edges
  - Same visual language should be used for the overview renderer

- Feature: Canvas.tsx Dispatch - Path: `frontend/src/components/DiagramsView/Canvas.tsx`
  - Line ~749: isUserJourneyDiagram flag, line ~3551: conditional rendering branch
  - extractUserJourneyDiagram helper to pull typed content from Diagram object
  - New isUserJourneyOverviewDiagram branch needed in the same conditional chain

- Feature: Journey Review Context - Path: `frontend/src/contexts/UserJourneyReviewContext.tsx`
  - UserJourneyReviewProvider, useUserJourneyReviewContext, activateReviewSession, markJourneySaved, closeReviewSession
  - Pattern to follow for overview review context (simpler: single diagram, not multi-journey list)

- Feature: Journey Review Banner - Path: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx`
  - Preview badge, journey name, navigation controls, Save as Diagram button, Close Review button
  - Overview needs a similar banner but without multi-journey navigation (just summary, save, discard)

- Feature: Save Journey Diagram Flow - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (line ~946)
  - handleSaveJourneyDiagram: builds typed content envelope, dispatches ADD_DIAGRAM, marks saved
  - Overview save should follow the same pattern with USER_JOURNEY_OVERVIEW type and overview content

- Feature: User Journey Diagram API Client - Path: `frontend/src/api/userJourneyDiagramApi.ts`
  - fetchTemporaryUserJourneyDiagrams pattern (GET with projectId)
  - Overview needs a similar API client with businessUserId query param

- Feature: Backend Projection Service - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyDiagramProjectionService.java`
  - Stateless, deterministic projection from DB entities to diagram DTO
  - Uses repositories for UserJourney, ActivityStep, Application, BusinessUser, BusinessProcess
  - Overview needs a new parallel service (UserJourneyOverviewDiagramProjectionService) using UserJourneyRepository, UserJourneyLinkRepository, BusinessUserRepository, BusinessProcessRepository, ActivityStepRepository

- Feature: Backend Controller - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/UserJourneyDiagramController.java`
  - GET /api/projects/{projectId}/user-journey-diagrams/temporary endpoint
  - Overview needs: GET /api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}

- Feature: UserJourneyEntity - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyEntity.java`
  - Fields: id, modelFileId, name, description, tags, primaryBusinessUserId, parentBusinessProcessId
  - These fields directly map to overview node derivation rules

- Feature: UserJourneyLinkEntity - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyLinkEntity.java`
  - Fields: id, modelFileId, sourceUserJourneyId, targetUserJourneyId, relationshipType, label, description, tags
  - These fields directly map to overview edge derivation

- Feature: UserJourneyLinkRepository - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/UserJourneyLinkRepository.java`
  - findByModelFileId(String modelFileId) - returns all links for a model file
  - Overview projection needs to filter these to only links where both source and target are in the selected role's journey set

### Follow-up Questions

No follow-up questions needed. The user's answers were comprehensive and consistent with the initialization description.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of both `discovery-service/agent-os/specs/2026-04-07-user-journey-overview-parent-diagram-generation/planning/visuals/` and `agent-os/specs/2026-04-07-user-journey-overview-parent-diagram-generation/planning/visuals/` confirmed no image files present.

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements

**Backend Projection Service:**
- New stateless `UserJourneyOverviewDiagramProjectionService` that deterministically generates an overview diagram DTO from persisted architecture data
- Input: projectId + businessUserId (selected role)
- Fetches USER_JOURNEY records where primary_business_user_id = selected business user
- Fetches BUSINESS_PROCESS records for lane grouping (from each journey's parent_business_process_id)
- Fetches USER_JOURNEY_LINK records where both source and target journey IDs are in the selected set
- Fetches ACTIVITY_STEP counts per journey (for step_count metadata)
- Fetches distinct APPLICATION counts per journey (for application_count metadata)
- Computes relationship_in_count and relationship_out_count per node from the filtered link set
- Lanes: one per unique parent Business Process, alphabetical order, "Unassigned" lane last for journeys with no parent
- Nodes: one per included USER_JOURNEY, sorted alphabetically by name within each lane
- Edges: one per included USER_JOURNEY_LINK, preserving direction and relationship_type
- Returns empty but valid diagram structure for zero-journey scenarios (no error)

**Backend REST Endpoint:**
- GET /api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}
- Returns the generated UserJourneyOverviewDiagramDto
- Project-scoped, stateless

**Frontend Diagram Type Registration:**
- Add USER_JOURNEY_OVERVIEW to DiagramType union, ALL_DIAGRAM_TYPES, DIAGRAM_TYPE_LABELS, normalizeDiagramType map
- Do NOT add to CREATABLE_DIAGRAM_TYPES (generated only, not manually creatable)
- Add to DiagramTypedContentType union and TYPED_DIAGRAM_TYPES array

**Frontend TypeScript Interfaces:**
- New UserJourneyOverviewDiagramDto top-level interface matching the recommended_overview_contract_v1
- Supporting interfaces: UserJourneyOverviewLaneDto, UserJourneyOverviewNodeDto (with metadata sub-object), UserJourneyOverviewEdgeDto, UserJourneyOverviewRenderHintsDto, UserJourneyOverviewHeaderDto
- New UserJourneyOverviewContent type for TypedContentEnvelope

**Frontend API Client:**
- New fetchTemporaryUserJourneyOverviewDiagram(projectId, businessUserId) function
- Follows existing userJourneyDiagramApi.ts pattern (plain fetch with API_BASE)

**Frontend Entry Point / Trigger:**
- User action in the existing diagram/workspace flow (button or menu)
- Business User selector dropdown populated from current project meta-model
- "Generate Journey Overview" action that calls the backend and opens review mode

**Frontend Review Flow:**
- Temporary review/preview mode in Canvas workspace
- Compact summary banner showing: Preview badge, "[Business User Name] Journey Overview" title, journey count and business process count, Save as Diagram button, Discard/Close button
- Read-only rendering in review mode
- No multi-diagram navigation (single overview per generation, unlike child journey chooser)

**Frontend Native Renderer:**
- New UserJourneyOverviewDiagramRenderer component (SVG)
- Horizontal swimlane bands stacked vertically, one per Business Process
- Lane headers labeling each band (on left side)
- Journey nodes with: name (primary label), description (secondary, truncated if needed), compact metadata badges (step_count, application_count)
- Directed edges from USER_JOURNEY_LINK with arrowheads and labels
- Left-to-right flow within lanes
- Deterministic layout computation
- Uses existing visual language (node fill, stroke, font sizing patterns from UserJourneyDiagramRenderer)
- Uses existing waypoint/polyline rendering approach with generated waypoints
- Title: "[Business User Name] Journey Overview"
- computeContentBounds and onContentBounds callback for auto-sizing

**Frontend Canvas.tsx Integration:**
- New isUserJourneyOverviewDiagram flag
- New conditional rendering branch dispatching to UserJourneyOverviewDiagramRenderer
- extractUserJourneyOverviewDiagram helper to pull typed content from saved Diagram object

**Frontend Save Flow:**
- Save as Diagram creates a standard Diagram entry with diagram_type = USER_JOURNEY_OVERVIEW
- TypedContentEnvelope with type: 'USER_JOURNEY_OVERVIEW', version: 1, content: full overview DTO snapshot
- Dispatches ADD_DIAGRAM to state
- Saved overview renders from snapshot (no re-projection from model)
- No blank manual creation of USER_JOURNEY_OVERVIEW diagrams

### Reusability Opportunities

- **UserJourneyDiagramRenderer.tsx**: Direct template for the new overview renderer. Same SVG swimlane pattern, layout computation approach, lane/node/edge rendering structure. Overview renderer adapts this for Business Process lanes (instead of Application lanes) and journey nodes (instead of step nodes).
- **UserJourneyReviewContext.tsx**: Pattern for overview review context, but simpler (single diagram instead of multi-journey list with navigation).
- **JourneyReviewBanner.tsx**: Styling template for the overview review banner (Preview badge, Save as Diagram button). Overview version omits Previous/Next/Back to List navigation.
- **handleSaveJourneyDiagram in DiagramsView.tsx**: Exact save pattern to follow (build typed content envelope, dispatch ADD_DIAGRAM, mark saved).
- **UserJourneyDiagramProjectionService.java**: Backend projection pattern (stateless, deterministic, repository-based). Overview projection follows the same approach but queries different entity sets and produces a different DTO shape.
- **UserJourneyDiagramController.java**: REST endpoint pattern to follow (project-scoped GET, ConditionalOnProperty annotation).
- **diagramType.ts + typedContent.ts**: Registration patterns that must be extended for the new type.

### Scope Boundaries

**In Scope:**
- New USER_JOURNEY_OVERVIEW diagram type registration (frontend + backend)
- Backend projection service generating overview DTO from meta-model data for a selected Business User
- Backend REST endpoint: GET /api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}
- Frontend TypeScript interfaces for the overview DTO contract v1
- Frontend API client function for fetching temporary overview diagram
- Frontend entry point: user action in diagram workspace with Business User selector
- Frontend review flow: preview mode with summary banner, Save and Discard actions
- Frontend native SVG renderer (UserJourneyOverviewDiagramRenderer) with swimlane layout
- Canvas.tsx integration for rendering overview diagrams (both in review and for saved diagrams)
- Save-as-diagram flow storing overview snapshot as typed content
- Rendering saved overview diagrams from snapshot
- Empty diagram handling (zero journeys for a role returns valid empty structure)

**Out of Scope:**
- Parent-to-child diagram linking/navigation (linkedDiagramId wiring)
- Any diagram-link auto-assignment to child USER_JOURNEY diagrams
- New meta-model entities beyond those already introduced
- Workbook/XLSX changes
- UX Designer prompt redesign beyond minimal generation/save wiring
- Bidirectional diagram/model sync
- One-way sync/refresh from model for saved overview diagrams
- Manual creation of blank USER_JOURNEY_OVERVIEW diagrams in the New Diagram modal
- Editing of overview node/edge semantics in the canvas
- Advanced graph layout customization or graph-routing optimization
- Auto-generation of USER_JOURNEY_LINK relationships
- Any changes to child USER_JOURNEY diagram structure or renderer
- Export/print functionality for overview diagrams
- Performance optimization work beyond normal reasonable data sizes
- Manual layout editing of the overview diagram
- Triggering from Dashboard or chat/AI-assisted flow

### Technical Considerations

**Backend:**
- New projection service needs access to: UserJourneyRepository, UserJourneyLinkRepository, BusinessUserRepository, BusinessProcessRepository, ActivityStepRepository, ApplicationRepository, ModelFileRepository
- UserJourneyLinkRepository already has findByModelFileId -- projection needs to filter returned links to those where both source and target are in the selected role's journey set
- Endpoint follows existing ConditionalOnProperty pattern for database-backed services
- UserJourneyEntity already has primaryBusinessUserId and parentBusinessProcessId fields needed for filtering and grouping
- Overview DTO shape is distinct from child UserJourneyDiagramDto (different node/edge structures)

**Frontend:**
- DiagramType union must be extended (currently 8 types, becomes 9)
- Canvas.tsx conditional rendering chain grows by one branch
- Existing UserJourneyDiagramRenderer is SVG-based with deterministic layout -- overview renderer should follow the same SVG approach
- Review context for overview is simpler than child journey review (single diagram, not multi-item navigation)
- TypedContentEnvelope content union must be extended with UserJourneyOverviewContent
- Overview diagram is read-only in canvas (no editing)
- Save follows ADD_DIAGRAM dispatch pattern with typed content envelope

**Integration:**
- Frontend calls architecture-model-service directly via Vite /api/ proxy (same as existing userJourneyDiagramApi.ts)
- No gateway route changes needed
- No new meta-model entities or relationships required
