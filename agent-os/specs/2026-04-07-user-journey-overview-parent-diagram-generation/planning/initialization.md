name: user-journey-overview-parent-diagram-generation
summary: Introduce a new generated parent diagram type, User Journey Overview, derived entirely from existing Business Architecture truth for a selected user role: USER_JOURNEY entities grouped by Business Process, connected by USER_JOURNEY_LINK relationships, with no manual post-drawing required.

motivation:
- Child USER_JOURNEY diagrams already exist and are generated/rendered natively as application-swimlane diagrams.
- USER_JOURNEY_LINK now exists as a first-class Business Architecture relationship.
- Users need a zoomed-out parent diagram for a given role that is useful on its own and acts as a high-level architectural overview.
- That parent diagram should be generated from architecture entities and relationships, not from manually added arrows after auto-drawing.
- This increment creates the parent overview diagram generation and native rendering; parent->child diagram linking/navigation comes later.

scope:
- Add a new native diagram type: USER_JOURNEY_OVERVIEW
- Generate temporary overview diagram JSON deterministically from the meta-model.
- The generated overview diagram must be: scoped to a selected Business User / role, grouped/swimlaned by Business Process, nodes = USER_JOURNEY, edges = USER_JOURNEY_LINK
- Add native renderer support for the new diagram type in the existing diagram workspace.
- Add temporary review flow for generated overview diagrams, consistent with existing temporary diagram/review patterns.
- Allow saving overview diagrams as first-class diagram artifacts using typed content, consistent with current saved-diagram patterns.
- Do not yet wire parent nodes to child diagrams via linkedDiagramId in this increment.
- Do not yet add one-way sync for overview diagrams in this increment unless required for minimal save/load correctness.

out_of_scope:
- Parent->child diagram linking/navigation
- Any diagram-link auto-assignment to child USER_JOURNEY diagrams
- New meta-model entities beyond those already introduced
- Workbook/XLSX changes
- UX Designer prompt redesign beyond whatever minimal generation/save wiring is required
- Bidirectional diagram/model sync
- Manual creation of blank USER_JOURNEY_OVERVIEW diagrams in the New Diagram modal
- Editing of overview node/edge semantics in the canvas
- Advanced graph layout customization
- Auto-generation of USER_JOURNEY_LINK relationships
- Any changes to child USER_JOURNEY diagram structure or renderer

architectural_intent:
- USER_JOURNEY_OVERVIEW is a generated, architecture-derived parent diagram.
- It is a role-centric overview: select a user role, see that role's journeys, grouped by Business Process, linked by USER_JOURNEY_LINK relationships
- The diagram must be fully derivable from persisted architecture truth: BUSINESS_USER, BUSINESS_PROCESS, USER_JOURNEY, USER_JOURNEY_LINK
- The overview diagram is a first-class diagram artifact when saved, but generation is deterministic from model data.

source-of-truth selection_rules:
- The overview diagram is generated for a selected Business User / role.
- A USER_JOURNEY is included if its primary_business_user_id matches the selected role
- Do NOT infer inclusion from ACTIVITY_STEP.business_user_id
- Group included USER_JOURNEY nodes by their parent_business_process_id
- USER_JOURNEY_LINK edges included if both source and target journeys are in the selected role's journey set

recommended_overview_contract_v1:
  diagram_type: "USER_JOURNEY_OVERVIEW"
  version: "1.0"
  overview: { business_user_id, business_user_name, title }
  lanes: [{ id, name, order }]
  nodes: [{ id, lane_id, name, description, primary_business_user_id, primary_business_user_name, parent_business_process_id, parent_business_process_name, metadata: { step_count, application_count, relationship_in_count, relationship_out_count } }]
  edges: [{ id, source_node_id, target_node_id, relationship_type, label, description }]
  render_hints: { lane_axis: "VERTICAL", flow_direction: "LEFT_TO_RIGHT", show_title: true, show_lane_headers: true, show_node_description: true, show_relationship_labels: true }

projection_rules:
- Input: selected business_user_id, active project/model
- Fetch: USER_JOURNEY records where primary_business_user_id = selected, linked BUSINESS_PROCESS for grouping, USER_JOURNEY_LINK where both ends in selected set, ACTIVITY_STEP counts, distinct APPLICATION count per journey
- Lanes: one per parent business process, "Unassigned" for no parent, alphabetical order with Unassigned last
- Nodes: one per included USER_JOURNEY, sorted by name alphabetically
- Edges: one per included USER_JOURNEY_LINK, preserve direction and type
- Metadata: step_count = ACTIVITY_STEP count, application_count = distinct application_id count

backend_requirements:
- Dedicated projection service (e.g. UserJourneyOverviewDiagramProjectionService)
- GET /api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}
- Stateless, project-scoped

frontend_requirements:
- Add USER_JOURNEY_OVERVIEW to diagram type system
- Native renderer component (UserJourneyOverviewDiagramRenderer)
- Integrate into Canvas.tsx dispatch
- Temporary review flow
- Save-as-diagram from review mode
- Read-only in canvas

renderer_requirements:
- Title: "[Business User Name] Journey Overview"
- Horizontal swimlanes by Business Process
- Journey nodes with name, description, metadata
- Directed edges from USER_JOURNEY_LINK with labels
- Left-to-right flow, deterministic layout

save_behavior:
- Creates saved diagram artifact with diagram_type = USER_JOURNEY_OVERVIEW
- Typed content envelope storing overview dto snapshot
- No blank manual creation
- No one-way sync yet

acceptance_criteria: 1-12 as specified
testing_requirements: backend projection tests, frontend type/renderer/save tests, regression tests
