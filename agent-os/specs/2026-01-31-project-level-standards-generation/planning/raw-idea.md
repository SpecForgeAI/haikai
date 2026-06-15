# Raw Idea: Project-level Standards Generation

## Title
Project-level standards generation (Project → Generate Standards)

## Intent
Add a Project menu action to generate project (product-level) technical standards by calling the external standards service endpoint POST /api/v1/standards/product/generate, using the active project's organisation name + project name, and user-provided sources (paths/URLs).

## Scope

### In Scope
- Frontend: add "Generate Standards" menu item under Project menu (between Open and Save)
- Frontend: modal UI to collect sources as multi-value chips input (same behavior/component as org modal)
- Frontend: call Gateway endpoint to trigger external standards generation for the active project
- Gateway: proxy/forward request to external standards service product generate endpoint with required auth
- Frontend: user feedback (success/error toast/banner) and basic loading state

### Out of Scope
- Persisting project standards sources to DB
- Editing or viewing previously generated project standards
- Async job queue/polling or retries
- Any changes to company/org standards generation flows

## UI Changes

### Project Menu
- Insert new item label: "Generate Standards"
- Placement: directly below "Open" and directly above "Save"
- Enabled only when there is an active project selected/loaded

### Modal: "Generate Project Standards"
- Body text (primary): "Choose the input documents (local files, external URLs) that will generate the project standards."
- Body text (note): "Note - project standards override your company standards if the same topic, otherwise company standards remain."
  - Note styling: slightly smaller font, dark grey color, on new line
- Fields:
  - Label: "Sources"
  - Component: MultiValueChipsInput (reuse from Organisation modal)
  - Behavior: paste commits chip, delimiters (|, ,, ;) commit chip, onBlur commits, Enter commits, backspace removes last chip, x removes chip
  - Normalization: trim tokens, ignore empty, de-duplicate case-insensitively
- Buttons:
  - Cancel: closes modal, no action
  - Generate Standards: disabled when active project missing or request in progress

## Integration

### Active Context Source
- company: activeProject.organisation.name
- project: activeProject.name
- sources: chips[] from modal field

### Frontend to Gateway
- Add gateway route for project standards generation
- Frontend must not call external service directly

### Gateway to External
- Forward to: POST /api/v1/standards/product/generate
- Gateway supplies required authentication (reuse existing STANDARDS_SERVICE_BEARER_TOKEN)

### Request Body Contract
```json
{
  "company": "<active org name>",
  "project": "<active project name>",
  "sources": ["<path-or-url>", "..."]
}
```

## Runtime Behavior
- When user clicks Generate Standards:
  - Show loading indicator (spinner on button, button disabled)
  - On HTTP 200/201: show success toast and close modal
  - On any non-200/201 or network error: show error toast and keep modal open (user can retry or cancel)

## Tests
- Project menu renders Generate Standards in correct position (Open < Generate Standards < Save)
- Modal opens/closes via menu item; Cancel closes without API call
- MultiValueChipsInput behaviors: paste, delimiters, chip removal
- Payload mapping uses activeProject.organisation.name + activeProject.name + sources
