name: sequence-diagram-interface-endpoint-separate-request-response-what-to-show-and-fix-3line-label-yoffset
scope: full-stack
type: sequence-message-ux + persistence-mapping + label-rendering-bugfix

intent:
  For Sequence Diagram Message Exchanges where the REQUEST is a Reference to an InterfaceEndpoint:
    1) Allow users to choose different "What to Show?" options for the request label vs the endpoint-derived response label (Endpoint Response).
    2) Fix readability when all 3 label lines are shown by shifting the multi-line label up by 10px.

applies_when:
  - request.content_mode == "Reference"
  - request.reference_type == "InterfaceEndpoint"

frontend_modal_changes:
  request_section:
    - Show a checkbox group titled: "What to Show?" with options: Name, Verb and Path, Request Data
    - Defaults: Name unchecked, Verb and Path checked, Request Data checked
    - Validation: at least one checked

  response_section:
    - When InterfaceEndpoint AND "Include Response Message" checked:
        - Response Content radios: Label Text / Reference / Endpoint Response
        - When "Endpoint Response" selected: hide ref controls, show SECOND "What to Show?" group with: Name, Verb and Path, Response Data
        - Defaults: Name unchecked, Verb+Path unchecked, Response Data checked
        - Validation: at least one checked
    - When "Endpoint Response" NOT selected: no response checkbox group

data_persistence: Each message row has its own show_endpoint_name, show_endpoint_verb_path, show_endpoint_req_res_data booleans. response_mode: "normal" or "endpoint_response". Backward compat: legacy messages show endpoint name by default.

model_service: Don't copy request flags to response. Store independently. Validate at least one flag true per message.

renderer: Fixed line order (Name, Verb+Path, Data). 3-line labels shift up 10px. Request uses request_data_entity_point_id, response uses response_data_entity_point_id.
