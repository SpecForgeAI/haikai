name: user-journey-overview-parent-child-diagram-linking
summary: Wire generated/saved User Journey Overview parent diagrams to saved child USER_JOURNEY diagrams using the existing diagram-link capability, so overview journey nodes become navigable entry points into the detailed child journey diagrams.

motivation:
- Increment 13 introduces the generated parent diagram type USER_JOURNEY_OVERVIEW with nodes = USER_JOURNEY, edges = USER_JOURNEY_LINK, grouped by Business Process
- The parent overview becomes much more valuable when each journey node can open the corresponding saved detailed USER_JOURNEY diagram
- The codebase already has a concept of diagram links (linkedDiagramId) on diagram objects/components
- This increment connects the two diagram layers: parent = role/process-level overview, child = application-swimlane detailed USER_JOURNEY diagram

scope:
- Add deterministic parent-node -> child-diagram linking for USER_JOURNEY_OVERVIEW diagrams
- Use the existing diagram-link/navigation mechanism already present in the tool
- Support linking for temporary generated overview diagrams and saved overview diagrams
- Add deterministic mapping logic from overview nodes (USER_JOURNEY ids) to saved child USER_JOURNEY diagrams
- Add click/open navigation from parent node to linked child diagram
- Preserve existing one-way sync philosophy
- No manual per-node link authoring
- No bidirectional diagram sync

out_of_scope:
- New meta-model entities, workbook/XLSX changes, manual editing of parent-child links in canvas, bulk link-management UI, automatic creation of missing child diagrams, bidirectional sync, changes to child USER_JOURNEY diagram structure/renderer, changes to USER_JOURNEY_LINK semantics, cross-project linking, deep-linking to specific step

linking_model:
- Parent overview node represents one USER_JOURNEY by id
- Child detailed diagram represents one USER_JOURNEY by linked source metadata from Increment 9 sync-aware typed content
- Match: overview node USER_JOURNEY id = child saved diagram typedContent.sync.source_user_journey_id
- No separate mapping table/entity required

deterministic_link_resolution_rule:
- For a given USER_JOURNEY id:
  1. Find saved diagrams where diagram_type=USER_JOURNEY and typedContent linked to source_user_journey_id = that id
  2. Exactly one match: use that diagram id as linkedDiagramId
  3. Multiple matches: choose most recently updated, fall back to deterministic ordering
  4. No match: node has no linkedDiagramId, UI shows "No linked child diagram saved yet"

backend_requirements:
- Extend overview projection to include per-node link metadata: linked_diagram_id, linked_diagram_name, link_status (LINKED/UNLINKED/AMBIGUOUS_RESOLVED)
- Derive server-side during projection
- Reuse existing diagram persistence/query services

frontend_requirements:
- Extend overview renderer so linked nodes are visually navigable
- Reuse existing diagram link/navigation behavior
- Clicking linked node opens saved child USER_JOURNEY diagram
- Unlinked node shows lightweight feedback message
- Works in both temporary review mode and saved diagram mode

acceptance_criteria: 1-10 as specified
testing_requirements: backend projection linking tests, frontend navigation tests, regression tests
