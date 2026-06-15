```
intent:
  For Sequence Diagram Message Exchanges where Request Content is a Reference to an InterfaceEndpoint:
    - Provide an endpoint-specific response mode ("Endpoint Response") when "Include Response Message" is enabled.
    - Replace the single-line label (endpoint name) with a configurable multi-line label that can show:
        1) Endpoint Name
        2) Verb + Path
        3) Request/Response Data (derived from the InterfaceEndpoint's request/response data entity point FKs)
    - Require the user to select at least one "What to Show?" option.

applies_when:
  - message_exchange.request.content_mode == "Reference"
  - message_exchange.request.reference_type == "InterfaceEndpoint"

frontend_modal_changes:
  add_message_exchange_modal:
    request_section:
      - When applies_when is true, show a new checkbox group titled: "What to Show?"
        options (multi-select):
          - Name
          - Verb and Path
          - Request/Response Data
      - Validation: at least one must be selected -> "Choose at least one thing to show"
      - Default selection:
          - Verb and Path = checked
          - Request/Response Data = checked
          - Name = unchecked

    response_section:
      - When applies_when is true AND "Include Response Message" is checked:
          - Add a third Response Content option (radio): "Endpoint Response"
          - If selected: response reference is implicitly the SAME InterfaceEndpoint
          - Response does NOT ask for a reference type or reference picker
          - Response label uses same "What to Show?" selections but resolves response data
      - When applies_when is false: no changes

data_persistence_requirements:
  - show_endpoint_name: boolean (default false)
  - show_endpoint_verb_path: boolean (default true)
  - show_endpoint_req_res_data: boolean (default true)
  - response_mode: string enum "normal" | "endpoint_response" (default "normal")
  - Backward compatibility: existing messages default to false/false/false/"normal"

database_changes_liquibase:
  table: sequence_messages
  add_columns:
    - show_endpoint_name BOOLEAN NOT NULL DEFAULT FALSE
    - show_endpoint_verb_path BOOLEAN NOT NULL DEFAULT FALSE
    - show_endpoint_req_res_data BOOLEAN NOT NULL DEFAULT FALSE
    - response_mode TEXT NOT NULL DEFAULT 'normal'
  migrations:
    - add_sql_file: db/changelog/sql/0XX-seq-messages-interface-endpoint-display-options.sql
    - update_master_changelog with author: architecture-tool

model_service_changes:
  - Entity/DTO mapping for all 4 new fields
  - Validation: if reference_type != InterfaceEndpoint -> response_mode must be "normal"
  - If InterfaceEndpoint -> at least one show_* flag must be true

sequence_renderer_changes:
  request_label_rendering_for_interface_endpoint:
    - Build label lines in fixed order:
        1) if show_endpoint_name: endpoint.name
        2) if show_endpoint_verb_path: "${endpoint.verb} ${endpoint.pathAddress}"
        3) if show_endpoint_req_res_data: requestDataEntityName
    - Multi-line label above arrow

  response_label_rendering_for_endpoint_response_mode:
    - Same show_* flags, same order, but resolves response data entity

  non_endpoint_messages:
    - Render exactly as today

constraints:
  - No changes to InterfaceEndpoint meta-model (separate spec)
  - No changes to message routing, lifeline layout, fragments, or spacing beyond label height
  - No export/print changes

non_goals:
  - No new reference types or changes to existing reference rendering
  - No auto-generation of request/response data
  - No user-configurable templates beyond the 3 options

acceptance_criteria:
  - "Endpoint Response" option appears when Request Reference Type is InterfaceEndpoint and Include Response Message is enabled
  - Endpoint request labels render multi-line per "What to Show?" selections
  - "Endpoint Response" response label uses endpoint response data
  - Saving blocked with "Choose at least one thing to show" if none selected
  - Existing diagrams load without migration; new fields default safely
```
