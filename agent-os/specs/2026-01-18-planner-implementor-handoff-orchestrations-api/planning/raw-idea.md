# Raw Idea

title: Implement Planner → Implementor Handoff via Orchestrations API (Shape-Spec Payload + Headers + UI Confirmation)

context:
  The Implementation Assistant (Planner LLM) currently produces a final conversational message
  containing a "Proposed Final Feature Definition", but clicking the green "Implement" button
  does not deterministically convert this final intent into an execution-ready spec payload and
  trigger the implementation workflow through the external Orchestrations API. We need a strict,
  deterministic handoff: extract the final agreed intent, convert it into a shape-spec text
  payload (without the command prefix), call POST /api/v1/orchestrations with required headers
  and request body fields, and then inform the user that implementation has begun.

goal:
  When the user clicks "Implement", the tool must (1) extract the final PROPOSED feature
  definition from the Planner conversation, (2) transform it into a valid shape-spec text
  starting with "title:" (no "/agent-os:shape-spec" prefix), (3) call the configured
  Orchestrations endpoint with required headers and request body, and (4) show a planner reply
  confirming that implementation has started.

scope:
  - Frontend Implement screen (Implement button behavior, conversation parsing, status messaging)
  - Gateway (proxy endpoint to Orchestrations service, header forwarding, config)
  - No changes to the external Orchestrations service implementation
  - No changes to the Planner chat generation except extracting the final PROPOSED block for handoff
  - This spec covers single-intent handoff only (spec_intents array size = 1). Multi-intent splitting
    is handled separately unless already implemented.

requirements:
  extract_final_proposed_definition:
    - Identify the most recent Planner assistant message that contains the marker:
        "--- Part 4: Proposed Final Feature Definition ---"
    - Within that message, extract only the text content following:
        "PROPOSED —"
      and treat this extracted content as the authoritative final feature intent.
    - If the marker or PROPOSED block is missing:
        - disable the Implement button OR show a blocking error:
          "Cannot implement: final proposed feature definition not found."

  transform_to_shape_spec_payload:
    - Convert the extracted PROPOSED content into a shape-spec text payload that:
        - starts with "title: ..."
        - includes sections:
            context:
            goal:
            scope:
            requirements:
            acceptance_criteria:
            non_goals:
        - is declarative and execution-ready
        - contains no conversational framing and no planner commentary
        - MUST NOT include the "/agent-os:shape-spec" command prefix
    - The generated shape-spec payload must be a single string suitable for inclusion in the
      Orchestrations request body spec_intents[].

  orchestrations_api_call:
    - On Implement button click (after generating shape-spec payload), call:
        POST <orchestrations_base_url_from_config>/api/v1/orchestrations
    - Request headers must include:
        - Authorization: Bearer <token> (use the same bearer token mechanism currently used)
        - Content-Type: application/json
        - Accept: */*
        - User-Agent: Rivvy-Portal-UI
    - Ensure User-Agent is exactly "Rivvy-Portal-UI" (not PostmanRuntime or browser default where overridden).
    - Request body must be JSON with fields:
        - company: the active project's organisation name
        - project: the active project's project name
        - spec_intents: array<string> containing exactly one element (the shape-spec payload string)
        - options: object with:
            - stop_on_error: true
            - retry_on_failure: true
            - max_retries: 1
            - timeout_seconds: 0
    - spec_ids is not required and must be omitted unless the Orchestrations service requires it.

  gateway_proxy_and_config:
    - Add/ensure a gateway configuration value for the Orchestrations base URL (host:port).
    - Implement a gateway route that proxies the frontend request to the Orchestrations service:
        - POST /api/v1/orchestrations (gateway) -> POST <orchestrations_base_url>/api/v1/orchestrations
    - Gateway must forward:
        - Authorization header unchanged
        - Content-Type, Accept
        - User-Agent set/overridden to "Rivvy-Portal-UI" if not provided by the client
    - Gateway must return Orchestrations response status/body transparently to the frontend.

  planner_confirmation_message:
    - After receiving a successful HTTP response (2xx) from Orchestrations:
        - append a Planner assistant message to the conversation:
          "The Implementation Assistant has begun to implement this feature."
    - If the Orchestrations call fails (non-2xx or network error):
        - show an error message in the chat UI:
          "Failed to start implementation: <status/message>"
        - do not append the success confirmation message.

  ui_states_and_safety:
    - Disable the Implement button while the Orchestrations request is in flight.
    - Prevent duplicate submissions by ignoring additional clicks until completion.
    - Log the generated shape-spec payload (locally) for debugging, but do not display it to the user unless
      a developer/debug mode is enabled.

acceptance_criteria:
  - Clicking Implement extracts the latest PROPOSED final feature definition from the Planner conversation.
  - The extracted intent is converted into a shape-spec payload string that begins with "title:" and contains
    the required sections, without the "/agent-os:shape-spec" prefix.
  - The tool calls POST /api/v1/orchestrations with:
      company = active project organisation name,
      project = active project project name,
      spec_intents[0] = generated shape-spec payload,
      options exactly as specified,
      and headers including Authorization bearer token and User-Agent "Rivvy-Portal-UI".
  - On 2xx response, the Planner assistant posts:
      "The Implementation Assistant has begun to implement this feature."
  - On failure, the UI displays a clear error and does not claim implementation has started.

non_goals:
  - Multi-intent splitting into multiple spec_intents entries (handled separately)
  - Implementation progress tracking/status UI
  - Any changes to Orchestrations service behavior or authentication scheme
