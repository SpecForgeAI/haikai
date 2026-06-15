---
name: user-journey-temporary-diagram-json-generation
summary: Generate deterministic temporary User Journey diagram JSON for each persisted USER_JOURNEY by projecting USER_JOURNEY and ordered ACTIVITY_STEP data into a stable diagram contract (no UI rendering yet).

motivation:
- After Increment 4, USER_JOURNEY and ACTIVITY_STEP are persisted as authoritative meta-model data.
- The next step in the UX Designer flow is to visualize each journey as a diagram.
- The LLM must NOT render diagrams; instead, the system must deterministically project the meta-model into a diagram JSON contract.
- This increment produces that contract for each journey, enabling later UI selection and rendering.

scope:
- Implement a projection layer that reads USER_JOURNEY + ACTIVITY_STEP + linked entities and produces deterministic diagram JSON per journey.
- Define and implement a stable diagram contract (v1).
- Expose backend endpoint(s) to retrieve generated diagram JSON for a single journey and optionally for all journeys in a project.
- Integrate with UX Designer flow so the system can fetch/generate diagrams after save.
- No frontend rendering in this increment.
- No new diagram type registration in UI yet.
- No editing of diagrams.

out_of_scope:
- Diagram canvas/editor UI.
- Temporary diagram chooser UI.
- Persisting diagrams as diagram artifacts.
- LLM generation of diagram visuals.
- Any layout engine in frontend.
- Changes to spreadsheet or save logic.

architectural_intent:
- Diagram JSON is a pure projection of the meta-model.
- No diagram state is stored in DB in this increment.
- Every call regenerates the diagram from authoritative data.
- Output must be deterministic and stable for identical inputs.
- The contract must support future extension (branching, swimlanes, etc.).

diagram_contract_v1:
  top_level: diagram_type "USER_JOURNEY", version "1.0"
  journey: id, name, user_role_id, user_role_name, description, parent_business_process_id, parent_business_process_name
  lanes: id (application_id), name (application_name), order (integer)
  steps: id, journey_id, order, lane_id, process_activity_id, process_activity_name, name, description, activity_related_issues, ui_related_issues, has_issues
  edges: id, from_step_id, to_step_id, order, is_cross_lane
  render_hints: lane_axis VERTICAL, flow_direction LEFT_TO_RIGHT, show_title true, etc.

projection_rules:
  journey: populate from USER_JOURNEY entity, resolve linked BUSINESS_USER and BUSINESS_PROCESS names
  lanes: derived from unique APPLICATIONs referenced by ACTIVITY_STEPs, ordered by first occurrence in sequence_order
  steps: one per ACTIVITY_STEP, ordered by sequence_order, assigned to correct lane, name fallback to PROCESS_ACTIVITY.name
  edges: connect sequential steps, flag cross-lane transitions
  id_generation: edge.id = deterministic string e.g. "edge-{journeyId}-{fromOrder}-{toOrder}"

api_requirements:
  GET /api/diagrams/user-journeys/{userJourneyId}/temporary → single diagram contract
  GET /api/diagrams/user-journeys/temporary?projectId={projectId} → array of diagram contracts
  Always regenerate from DB, enforce project scoping, return 404 if not found

service_layer_requirements:
  Create UserJourneyDiagramProjectionService
  Stateless and deterministic
  Fetch USER_JOURNEY, ACTIVITY_STEPs, linked APPLICATION, PROCESS_ACTIVITY, BUSINESS_USER, BUSINESS_PROCESS
  Build contract object

validation_rules:
  Sort ACTIVITY_STEPs by sequence_order
  Deterministic fallback sort by id for duplicate sequence_order
  Fail fast with clear error for missing linked entities

integration_with_ux_designer_flow:
  After save (Increment 4), system calls diagram generation endpoint
  LLM receives list of journeys + diagram metadata
  LLM informs user about available diagrams

acceptance_criteria:
1. System generates diagram JSON matching defined contract for any persisted USER_JOURNEY
2. Lanes correspond to APPLICATIONs used in ACTIVITY_STEPs
3. Steps ordered by sequence_order, assigned to correct lane
4. Edges connect sequential steps, cross-lane flagged correctly
5. Issue fields mapped correctly, has_issues accurate
6. Name fallback works when ACTIVITY_STEP.name is null
7. Output deterministic for identical data
8. Single journey endpoint works
9. Project-level endpoint works
10. No diagram data persisted in DB
11. No UI rendering required
12. UX Designer flow can trigger diagram generation after save

testing_requirements:
  Unit: single lane, multiple lanes, issues/no issues, edge generation, lane ordering, name fallback
  Integration: endpoint structure, project scoping
  Regression: existing diagram endpoints unaffected
---
