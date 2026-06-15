title: Add "+ New Activity Flow" creation button to Activity diagram RHS palette (create + wire edge placement)

problem:
  - Activity diagrams show collapsible sections for Activities, Activity Flows, and Activity Partitions.
  - Only Activities and Partitions have creation buttons ("+ New Activity", "+ New Partition").
  - There is no "+ New Activity Flow" button, so users cannot create flows (edges) between activity nodes from the diagram view.

goal:
  - Add a third creation button: "+ New Activity Flow" in the Activity diagram RHS panel.
  - Clicking the button enables a simple "flow creation mode":
      - user selects a source Activity node
      - user selects a target Activity node
      - system creates an ActivityFlow entity AND a diagram edge referencing it
  - The flow appears on the canvas immediately as an arrow between the two activity nodes.

scope:
  in:
    - frontend only
    - Activity diagram RHS panel (PalettePanel activity section)
    - diagram interaction state for "create flow mode"
    - creation logic for ActivityFlow + diagram edge
  out:
    - backend schema changes
    - complex flow routing / waypoints
    - swimlane behaviour changes

acceptance_criteria:
  - When an Activity diagram is selected, RHS CREATE section shows:
      - + New Partition
      - + New Activity
      - + New Activity Flow
  - Clicking "+ New Activity Flow" enters "select source then target" mode.
  - After selecting two Activity nodes:
      - ActivityFlow entity is created (persisted via existing save path)
      - Diagram edge is created referencing that ActivityFlow
      - Canvas renders the new flow arrow
      - mode exits automatically
  - If user presses Esc or clicks the button again, the mode exits without changes.
  - If user clicks a non-Activity node while in the mode, ignore and show a small inline hint (or no-op).

implementation:

1) Add the button in the Activity CREATE area
  file: src/components/DiagramsView/PalettePanel.tsx (or the Activity-specific section file used by PalettePanel)

  - In the conditional block that renders Activity diagram create controls, add:
      <Button ...>+ New Activity Flow</Button>
    placed under the existing two buttons.

2) Add Activity Flow creation mode state
  file: src/components/DiagramsView/DiagramsView.tsx (or whichever component currently owns "creation modes")

  - Add UI state:
      - isCreatingActivityFlow: boolean
      - activityFlowFromNodeId: string | null

  - Wire the new button:
      - onClick:
          - toggle isCreatingActivityFlow
          - reset activityFlowFromNodeId when entering/exiting

3) Hook into canvas node-click handling
  files:
    - src/components/DiagramsView/Canvas.tsx (or the node selection handler module)
    - any existing "edge creation mode" or "interaction mode" handler utilities

  - When isCreatingActivityFlow is true:
      - on node click:
          - if node.entity_type !== 'ACTIVITY': return
          - if activityFlowFromNodeId is null:
              set activityFlowFromNodeId = clickedNodeId
              (optional hint: "Select target activity…")
            else:
              targetNodeId = clickedNodeId
              if targetNodeId === fromNodeId: reset and exit (no-op)
              else:
                call createActivityFlowAndEdge(fromNodeId, targetNodeId)
                reset activityFlowFromNodeId
                set isCreatingActivityFlow = false

4) Implement createActivityFlowAndEdge()
  file: src/utils/activityFlowCreation.ts (new) OR existing activity diagram utilities module

  Inputs:
    - model: ArchitectureModel (from context)
    - activeDiagramId: string
    - fromNodeId: string
    - toNodeId: string

  Steps:
    a) Resolve node -> entity ids:
       - fromActivityId = diagram.nodes.find(n.id==fromNodeId).entity_id
       - toActivityId = diagram.nodes.find(n.id==toNodeId).entity_id
    b) Create ActivityFlow entity:
       - id: `flow-${nanoid()}`
       - fromActivityId, toActivityId
       - guardExpression: null
       - flowKind: 'Control' (default)
       - modelFileId = active model id if required by entity shape
       - append to metaModel.entities.activity_flows
    c) Create diagram edge:
       - id: `edge-${nanoid()}`
       - fromNodeId, toNodeId
       - relationship_kind: 'ACTIVITY_FLOW' (or existing enum used for activity flow edges)
       - toRefKind: 'ACTIVITY_FLOW'
       - toRefId: created flow id
       - append to diagram.edges

  Return updated model/diagram for reducer update.

  NOTE:
    - Use the same persistence path as the other "create in diagram" buttons:
        - update ArchitectureContext model state, then call existing save.
    - Do not call a dedicated API.

5) Ensure rendering picks up new edges
  file: src/components/DiagramsView/renderers/activity/activityFlowRendering.ts (or wherever activity edges are drawn)

  - Confirm it renders diagram edges that reference ACTIVITY_FLOW (or relationship_kind == ACTIVITY_FLOW).
  - If it currently only renders flows from entity list but no edges exist:
      - adjust renderer to draw only edges (preferred), or:
      - for each ActivityFlow entity, compute endpoints using linked nodes and draw.

6) Keyboard cancel
  file: DiagramsView.tsx
  - add keydown listener for Esc when isCreatingActivityFlow:
      - set isCreatingActivityFlow = false
      - activityFlowFromNodeId = null

7) UI feedback (minimal)
  - When isCreatingActivityFlow is true:
      - show small inline text under the button:
          - if no from selected: "Select source activity…"
          - else: "Select target activity…"
    (Optional: highlight selected source node)

manual_test_plan:
  - Open Activity diagram.
  - Add two Activities via + New Activity.
  - Click + New Activity Flow.
  - Click Activity A, then Activity B.
  - Verify:
      - Flow appears as arrow
      - "Activity Flows" section lists the new flow
      - Reload file and confirm flow persists.

definition_of_done:
  - Activity diagram RHS contains "+ New Activity Flow"
  - Flow creation works end-to-end and renders correctly.
