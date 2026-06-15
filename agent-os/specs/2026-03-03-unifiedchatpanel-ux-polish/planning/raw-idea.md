# Raw Idea

## Title
UnifiedChatPanel UX polish: Room header, persona switch auto-send, task-click sends label, questions render summary (no JSON)

## Description
Improve the chat UX across Hub and screen RHS panels by (1) making the room/persona model explicit in the header, (2) turning persona selection into a single action that immediately triggers the persona greeting + task menu, (3) making task selection display a natural user message (the task label) rather than routing artifacts like "@Role", and (4) ensuring structured question responses never show raw JSON and instead show summary text above the table.

## Scope

### Frontend
- UnifiedChatPanel header (applies to hub and panel variants):
    * Display format:
      "Chat - Room: <RoomName> - In: <ActivePersonaIcon><ActivePersonaName> - Available: <OtherPersonaIcons...>"
    * RoomName must be derived from threadKey (not from route):
      - { type:'hub' } => "Project Room"
      - { type:'panel', screen:'product'|'roadmap'|'backlog' } => "Product Strategy Room"
      - { type:'panel', screen:'metamodel'|'architecture' } => "Architecture Room"
    * "In:" shows icon + persona name.
    * "Available:" shows icons only (no names), excluding the active persona; include Assistant as available in ALL rooms/panels.
    * Clicking an available persona icon performs an immediate persona switch AND triggers the persona greeting with task options list (no second send action).
- @-mention UX change:
    * When user types '@' and selects a persona from the dropdown, do NOT insert "@Persona" into the input.
    * Instead: immediately switch active persona and immediately send the persona-switch trigger so the assistant responds (greeting + task list).
    * Input should remain empty and focused after selection.
- Task menu click behavior:
    * When task cards/buttons are rendered ("How can I help?" list), clicking a task must:
      1) Append a USER message bubble whose visible text equals the task label exactly (e.g., "Define Product").
      2) Send the request immediately to the backend with the selected taskId/personaId in metadata.
    * Do NOT append "@Role" or re-send the persona mention as the visible user message.
- Structured "questions" rendering fix (no raw JSON):
    * When an assistant message represents a questions-phase structured response:
      - Do NOT render any raw JSON/text blob.
      - Render only:
        (a) the structuredResponse.summary as plain assistant text above the table (if summary exists),
        (b) the questions table UI.
    * Ensure the chat does not render both "message.content" and the structured table for the same message.
    * If message.content happens to be JSON for questions responses, it must be suppressed in favor of summary+table.
- Keep all other rendering behavior unchanged.

### Backend
- No new endpoints and no new artifact endpoints.
- No changes required provided backend already returns persona task menu on persona switch and accepts task selection metadata.

## Constraints
- Do not introduce new "allowedArtifactIds" or any new artifact gating abstraction.
- Do not change Implement screen.
- Do not add streaming, summarisation, completion chips, or artifact preview/save changes.
- Keep existing persistence/thread behavior unchanged.

## Acceptance Criteria
- Header shows correct Room name derived from threadKey and always shows "In" + "Available" sections; Assistant appears in Available in all rooms.
- Clicking an Available persona icon causes an immediate assistant response (greeting + task menu) with no extra user send click.
- Selecting a persona via @ dropdown causes the same immediate assistant response, without inserting "@Persona" into the input.
- Clicking a task card appends a user bubble that reads exactly the task label (e.g., "Define Product") and triggers the next assistant step; transcript no longer shows "@Product Manager" as the task selection action.
- For questions responses, the raw JSON is never visible; only the summary text + questions table render.
- No regressions to normal message sending, file attachment UI, or existing hub/panel navigation.
