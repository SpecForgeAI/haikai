title: Fix Feature Edit 400 Error by Including Work Item Type in Update Payload (PUT Semantics)

context:
  Editing a work item (e.g., a Feature) in the UI fails with a 400 Bad Request from the
  architecture-model-service:
    "Work item type is required"
  The backend requires the work item `type` field on update validation. The frontend update
  request currently omits `type`, causing validation to fail even when only changing the title.

goal:
  Ensure all work item update requests include the work item `type` so that editing a Feature
  (or any work item) succeeds without backend changes.

scope:
  - Frontend only (UI + API client DTO mapping)
  - No backend changes
  - Applies to editing any work item type (INITIATIVE/EPIC/FEATURE/STORY)

requirements:
  update_payload_contract:
    - Extend the frontend work item update payload and DTO mapping to include:
        - type: string (required)
    - Ensure the HTTP request body sent to the backend for work item updates always contains
      the work item type.

  ui_edit_modal:
    - In the Edit Work Item modal, when constructing the update payload:
        - include the existing work item type from the loaded item (not user-editable)
        - do not allow the user to change type in this modal
    - If the item type is missing in the UI state for any reason:
        - block the save action and show a clear validation message:
            "Work item type is missing; please reload the project."

  api_client_mapping:
    - Update the work item update API client function to accept a payload containing type.
    - Update the mapping function (payload -> request DTO) to include `type`.
    - Ensure the update request uses the same field name expected by the backend (type).

  regression_test:
    - Add a frontend unit test for the update DTO mapper to assert that when editing an item,
      the request body includes `type` and matches the original item's type.
    - Add an integration-level test (if present) or lightweight component test that simulates
      editing a Feature title and verifies the update API call includes `type`.

acceptance_criteria:
  - Editing a Feature title and clicking Save results in a successful update (no 400 error).
  - The outgoing update request body includes `type` for all work item updates.
  - The work item type remains unchanged by the edit flow.

non_goals:
  - No backend validation changes
  - No ability to change a work item type via the Edit modal
