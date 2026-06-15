# Spec Initialization

## Name
activate-project-on-open-and-propagate-active-project-context

## Scope
- product_area: "Global (applies across Product & Delivery / Architecture & Design / Diagrams)"
- target: "Project selection/open flow + active project lifecycle + chat/context propagation"
- services: frontend, gateway (verify/align), architecture-model-service (verify/align)

## Intent
- When a user selects/opens a project from the UI, that project must become the active project immediately (set, not just fetched).
- Ensure the active project state is reliably available to downstream features (implement chat, context resolution, transcript persistence), including:
    - active project name/id in frontend state
    - projectParentFolder included in chat context when applicable
- Remove confusing "No active project" errors occurring immediately after opening a project.

## Changes

### Frontend
- Project open/selection behavior:
    - Update the "open project" user action to call the activate endpoint (POST) to set the selected project as active.
    - After successful activation, update the client-side active project state immediately (and/or re-fetch active project) so all screens see the active project without requiring a refresh.
    - Ensure error handling distinguishes between:
        - "no active project yet" (before selection)
        - activation failure (after selection)
    - Avoid calling GET active project as the primary mechanism for opening a project; use it only for initial app bootstrap or refresh scenarios.

- Active project propagation:
    - Ensure chat/implement requests include active project context derived from the activated project (where currently expected), including projectParentFolder when present.
    - Ensure implement flows that depend on active project (e.g., transcript persistence metadata, project naming) have the required data after activation.

- App bootstrap behavior:
    - On initial app load with no active project, keep current UX (no active project is acceptable).
    - Once a project is selected, the active project should be set deterministically and persist across navigation within the session.

### Gateway
- Confirm the existing activation route is used by frontend (no new endpoint required).
- Ensure any transcript persistence prerequisites that depend on project context are satisfied when frontend supplies projectParentFolder.

### Architecture Model Service
- Confirm the existing project activation endpoint and active-project retrieval are consistent with the frontend expectations (no new endpoint required).

## Tests
- Add/update tests to validate:
    - Selecting/opening a project triggers the activate (POST) call.
    - After activation, active project state is populated and GET active project no longer returns "no active project" for the session.
    - Subsequent implement chat requests include the expected project context.
