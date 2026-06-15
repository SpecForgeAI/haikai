# Spec Initialization

## Title
Project-level standards generation (Project -> Generate Standards)

## Raw Idea/Intent

intent:
  Add a Project menu action to generate project (product-level) technical standards by calling the external
  standards service endpoint POST /api/v1/standards/product/generate, using the active project's organisation
  name + project name, and user-provided sources (paths/URLs).

scope:
  in_scope:
    - Frontend: add "Generate Standards" menu item under Project menu (between Open and Save)
    - Frontend: modal UI to collect sources as multi-value chips input (same behavior/component as org modal)
    - Frontend: call Gateway endpoint to trigger external standards generation for the active project
    - Gateway: proxy/forward request to external standards service product generate endpoint with required auth
    - Frontend: user feedback (success/error toast/banner) and basic loading state
  out_of_scope:
    - Persisting project standards sources to DB
    - Editing or viewing previously generated project standards
    - Async job queue/polling or retries
    - Any changes to company/org standards generation flows

ui_changes:
  project_menu:
    - Insert new item label: "Generate Standards"
    - Placement: directly below "Open" and directly above "Save"
    - Enabled only when there is an active project selected/loaded
  modal:
    name: "Generate Project Standards"
    body_text:
      primary: "Choose the input documents (local files, external URLs) that will generate the project standards."
      note: "Note - project standards override your company standards if the same topic, otherwise company standards remain."
      styling:
        - note_font_size: slightly smaller than primary
        - note_color: dark grey (not black)
        - note_on_new_line: true
    fields:
      - label: "Sources"
        component: MultiValueChipsInput (reuse from Organisation modal)
        behavior:
          - paste commits a chip (trim whitespace)
          - typing commits a chip on delimiters: "|", ",", ";"
          - onBlur={() => commitValue()} on the input element commits a chip
          - Enter commits current token if non-empty
          - backspace on empty input removes last chip
          - each chip removable via "x"
        normalization:
          - trim tokens
          - ignore empty tokens
          - de-duplicate case-insensitively within the field (keep first occurrence)
    buttons:
      - Cancel: closes modal, no action
      - Generate Project:
          disabled_when:
            - active project missing
            - request in progress
          action: calls API (see integration)

integration:
  active_context_source:
    - company: activeProject.organisation.name
    - project: activeProject.name
    - sources: chips[] from modal field
  frontend_to_gateway_endpoint:
    - Add or reuse a gateway route dedicated to project standards generation that accepts the request body below
    - Frontend must not call the external service directly
  gateway_to_external_forward:
    - Forward to external standards service:
      POST /api/v1/standards/product/generate
    - Gateway supplies required authentication header(s) for the external service (API key / bearer as configured)
  request_body_contract:
    {
      "company": "<active org name>",
      "project": "<active project name>",
      "sources": ["<path-or-url>", "..."]
    }

runtime_behavior:
  - When user clicks Generate Project:
      - show non-blocking loading indicator in modal (e.g., spinner on button)
      - on HTTP 200/201: show success toast/banner and close modal
      - on any non-200/201 or network error: show error toast/banner and keep modal open (user can retry or cancel)

tests:
  add_or_update:
    - Project menu renders Generate Standards in correct position (Open < Generate Standards < Save)
    - Modal opens/closes via menu item; Cancel closes without API call
    - MultiValueChipsInput behaviors: paste, delimiters, chip removal
    - Payload mapping uses activeProject.organisation.name + activeProject.name + sources chips[]
    - Gateway route forwards to external endpoint and returns status to frontend
    - Success closes modal and shows success notification; failure keeps modal open and shows error

acceptance_criteria:
  - "Generate Standards" appears under Project menu between Open and Save and is disabled without an active project.
  - Modal text matches exactly, with the Note line smaller and dark grey.
  - Sources field supports multi-value chips via paste and delimiters "|", ",", ";".
  - Clicking Generate Project calls external POST /api/v1/standards/product/generate via Gateway with correct body.
  - User sees clear success/failure feedback; Cancel performs no action.

## Spec Path
C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-01-31-project-level-standards-generation
