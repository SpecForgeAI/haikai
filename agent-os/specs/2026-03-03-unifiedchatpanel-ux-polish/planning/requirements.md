# Spec Requirements: UnifiedChatPanel UX Polish

## Initial Description

Improve the chat UX across Hub and screen RHS panels by (1) making the room/persona model explicit in the header, (2) turning persona selection into a single action that immediately triggers the persona greeting + task menu, (3) making task selection display a natural user message (the task label) rather than routing artifacts like "@Role", and (4) ensuring structured question responses never show raw JSON and instead show summary text above the table.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea specifies three room name mappings: `hub` => "Project Room", `panel` with `screen='product'|'roadmap'|'backlog'` => "Product Strategy Room", and `panel` with `screen='metamodel'|'architecture'` => "Architecture Room". There is also a `feature` thread key type in the codebase (`FeatureThreadKey`). Should the feature thread type have its own room name (e.g., "Feature Room"), or is it not used with UnifiedChatPanel and can be ignored?
**Answer:** Ignore FeatureThreadKey for now; it does not need its own room name in this increment.

**Q2:** The raw idea says "Available" shows icons for all personas except the active persona, and that "Assistant" should always appear in Available across all rooms/panels. Currently, the panel receives an `allowedPersonaIds` prop that restricts which personas can be @-mentioned. Should the "Available" icons in the header respect this `allowedPersonaIds` filter (showing only allowed personas minus the active one, plus always including Assistant), or should the header show ALL 6 personas regardless of the allowed list?
**Answer:** Available icons must respect allowedPersonaIds and show only allowed personas minus the active one, with Assistant included in all rooms.

**Q3:** Currently `selectPersona()` in `useChatThread.ts` inserts a "Switched to {name}" system message, resets `activeTaskId` to `'unknown'`, and calls `postHandoff()`. It does NOT then call `sendMessage()` to trigger the greeting + task menu. The new behavior requires that after switching, an automatic `sendMessage('')` (or equivalent) is fired so the backend responds with the persona greeting and task menu. Should we modify `selectPersona` to also call `sendMessage` with an empty string (which, with `activeTaskId='unknown'`, will trigger the backend task-menu response), or should a different API call be used?
**Answer:** Modify selectPersona() to also trigger the task-menu flow (e.g., sendMessage('') or equivalent) so persona switch immediately returns greeting + task list.

**Q4:** Currently, selecting a persona from the @ dropdown in MentionInput inserts `@DisplayName ` into the textarea text. The new behavior should NOT insert text, should clear the input, and should trigger the immediate persona switch + greeting. Should MentionInput.handleSelectPersona be changed to: (a) call `onPersonaSelected(personaId)`, (b) clear the input text via `onChange('')`, (c) close the dropdown, and (d) NOT insert any `@DisplayName` text?
**Answer:** Yes, selecting from the @ dropdown should call onPersonaSelected(personaId), clear the input, close the dropdown, and not insert any @text.

**Q5:** Currently in `selectTask()` within `useChatThread.ts`, when no pending message is queued, it sends `"Selected task: {menuLabel}"` (e.g., "Selected task: Define Product"). The raw idea says the user bubble should show the task label exactly (e.g., "Define Product"), not "Selected task: Define Product". Should the `sendMessage()` call simply send the `menuLabel` directly (e.g., `sendMessage(label)` instead of `sendMessage("Selected task: " + label)`)?
**Answer:** Send just the menuLabel directly (e.g., "Define Product"), not "Selected task: Define Product".

**Q6:** In MessageBubble.tsx, when `showQuestions` is true, the component currently renders BOTH the `content` text AND the `StructuredQuestionsRenderer` below it. When `content` contains the raw JSON of the structured questions response, both the JSON blob and the table are visible. Should we: (a) when `showQuestions` is true, suppress `content` entirely and render only the `structuredResponse.summary` field (if present) as the text above the table, or (b) always suppress `content` entirely when questions are present (even if it is not JSON)?
**Answer:** Always suppress message.content entirely when a questions structured response is detected and render only summary + questions table.

**Q7:** The current header is simple: "Chat" title + one persona indicator circle + collapse button. The new header needs: "Chat - Room: {name} - In: {icon}{name} - Available: {icons...}". Should the "Room:", "In:", and "Available:" labels be visible text, or should they be implied by layout? Should the available persona icons use the same 24px colored circle icons?
**Answer:** Keep visible labels "Room:", "In:", and "Available:" and use the same 24px colored circle icons (no names) for available personas.

**Q8:** The raw idea mentions no streaming, no summarisation, no completion chips changes, no artifact preview/save changes, and no Implement screen changes. Are there any other behaviors or edge cases to explicitly exclude from this spec?
**Answer:** Also out of scope: changes to task definitions, backend workflow logic, persona permission model, broader error handling.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: UnifiedChatPanel header -- Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (lines 354-374, current header rendering)
- Feature: personaIndicator CSS -- Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` (lines 62-72, existing 24px circle style)
- Feature: MentionInput persona selection -- Path: `frontend/src/components/UnifiedChat/MentionInput.tsx` (lines 143-174, handleSelectPersona flow)
- Feature: selectPersona hook -- Path: `frontend/src/hooks/useChatThread.ts` (lines 640-663, current persona switch logic)
- Feature: selectTask hook -- Path: `frontend/src/hooks/useChatThread.ts` (lines 670-720, current task selection and sendMessage logic)
- Feature: MessageBubble questions rendering -- Path: `frontend/src/components/UnifiedChat/MessageBubble.tsx` (lines 376-392, current content + questions rendering)
- Feature: TaskMenu component -- Path: `frontend/src/components/UnifiedChat/TaskMenu.tsx` (task card rendering and click handler)
- Feature: personaConfig -- Path: `frontend/src/config/personaConfig.ts` (all 6 persona definitions with id, displayName, color, initials)

### Follow-up Questions

No follow-up questions were needed. The user's answers to the 8 clarifying questions, combined with the codebase analysis, provide sufficient detail for all four changes.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- No visuals were provided. The existing codebase provides the current header layout pattern (24px colored circles with initials) and the existing persona indicator styling in UnifiedChatPanel.module.css that will be extended.

## Requirements Summary

### Functional Requirements

**FR1: Room Header with Room/Persona Model**
- Replace the current header content ("Chat" title + single persona indicator circle) with the format: "Chat - Room: <RoomName> - In: <Icon><PersonaName> - Available: <Icons...>"
- RoomName is derived from `threadKey`:
  - `{ type: 'hub' }` => "Project Room"
  - `{ type: 'panel', screen: 'product' | 'roadmap' | 'backlog' }` => "Product Strategy Room"
  - `{ type: 'panel', screen: 'metamodel' | 'architecture' }` => "Architecture Room"
  - `{ type: 'feature' }` => ignored for this increment (fallback to empty or "Room")
- "In:" section shows the active persona's 24px colored circle icon + persona display name
- "Available:" section shows 24px colored circle icons (no names, initials only) for all allowed personas except the active persona
- The "assistant" persona must always appear in Available across all rooms, even if not in `allowedPersonaIds`
- Available filtering logic: take `allowedPersonaIds` (or all 6 if undefined), ensure `'assistant'` is included, remove the currently active persona
- The collapse button remains at the far right of the header
- "Room:", "In:", and "Available:" are visible text labels in the header

**FR2: Available Persona Icon Click Triggers Auto-Send**
- Clicking an available persona icon in the header performs an immediate persona switch AND triggers the persona greeting + task menu response
- This is a single action: click icon => switch persona => backend responds with greeting + task list
- Implementation: modify `selectPersona()` in `useChatThread.ts` to also call `sendMessage('')` (or equivalent) after switching, which with `activeTaskId='unknown'` triggers the backend task-menu response
- The existing "Switched to {name}" system message and `postHandoff` call remain
- The header needs to wire each available persona icon's click to `selectPersona(personaId)`

**FR3: @-Mention Persona Selection Auto-Send (No Text Insertion)**
- When the user types `@` and selects a persona from the MentionInput dropdown, do NOT insert `@DisplayName` into the textarea
- Instead: call `onPersonaSelected(personaId)`, clear the input via `onChange('')`, close the dropdown
- The `onPersonaSelected` callback already calls `selectPersona`, which (per FR2) now also triggers the greeting + task menu
- Input should remain empty and focused after selection

**FR4: Task Click Sends Label Text (Not "@Role")**
- When clicking a task card from the TaskMenu, the user message bubble should display the exact task label text (e.g., "Define Product"), not "Selected task: Define Product" and not "@Product Manager"
- Modify `selectTask()` in `useChatThread.ts` to call `sendMessage(label)` instead of `sendMessage("Selected task: " + label)` when no pending message is queued
- The `label` is derived from the `lastStructuredResponseRef.current` task-menu data's `menuLabel` field

**FR5: Questions Response Renders Summary (No Raw JSON)**
- When an assistant message has a structured response containing questions (detected by `hasQuestions()` in MessageBubble.tsx), always suppress `message.content` entirely
- Instead, render only:
  (a) `structuredResponse.summary` as plain text above the questions table (if the `summary` field exists)
  (b) The `StructuredQuestionsRenderer` table below the summary
- This means the questions rendering path must become a distinct branch in the MessageBubble conditional chain (similar to task-menu), not an addendum after the else branch
- If `structuredResponse.summary` is absent or empty, render only the questions table with no text above it

### Reusability Opportunities

- Reuse existing `personaIndicator` CSS class (24px circle) for available persona icons in the header
- Reuse existing `getPersonaConfig()` helper for persona color/initials lookup
- Reuse existing `PERSONA_CONFIGS` array for computing the available persona list
- Reuse existing `selectPersona` function signature (just extend its behavior)
- Reuse existing `hasQuestions()` and `extractQuestions()` helpers in MessageBubble.tsx
- The `threadKey` prop already has the `type` and `screen` fields needed for room name derivation

### Scope Boundaries

**In Scope:**
- UnifiedChatPanel header redesign (room name, In/Available persona model)
- Available persona icon click => auto-send persona greeting + task menu
- MentionInput @ selection => clear input, auto-send persona greeting + task menu (no text insertion)
- selectTask user bubble text change (send menuLabel directly, not "Selected task: {label}")
- MessageBubble questions rendering fix (suppress content, show summary + table)
- CSS additions for new header layout (room label, In section, Available section)
- Unit tests for new header rendering, persona switch auto-send, task label text, questions rendering

**Out of Scope:**
- FeatureThreadKey room name mapping
- Changes to task definitions or backend task configuration
- Backend workflow logic changes
- Persona permission model changes (allowedPersonaIds structure stays the same)
- Broader error handling improvements
- Streaming, summarisation, completion chips, or artifact preview/save changes
- Implement screen changes
- Any new "allowedArtifactIds" or artifact gating abstraction

### Technical Considerations

- **Thread key room name derivation**: The `threadKey` prop is a discriminated union (`ThreadKey = HubThreadKey | FeatureThreadKey | PanelThreadKey`). Room name can be computed with a pure function: `getRoomName(threadKey: ThreadKey): string` using the `type` discriminant and `screen` field for panel keys.
- **Available persona computation**: Must handle three cases: (1) `allowedPersonaIds` is undefined (hub) -- all 6 personas, (2) `allowedPersonaIds` is provided -- filter to allowed, (3) always include `'assistant'`. Then remove the active persona from the result. This can be a `useMemo` in `UnifiedChatPanel.tsx`.
- **selectPersona timing**: When `selectPersona` is modified to call `sendMessage('')`, the `activeTaskId` will already be set to `'unknown'` synchronously. The `sendMessage` uses `activeTaskIdRef.current`, so it will see `'unknown'` and enter the queuing path (sends empty string to API). The backend returns a task-menu response. The existing `postHandoff` fire-and-forget call can remain for persistence.
- **MentionInput change**: `handleSelectPersona` currently inserts `@DisplayName ` and sets cursor. The change removes the text insertion logic and instead calls `onChange('')` to clear the input. The `onPersonaSelected(persona.id)` call remains.
- **MessageBubble conditional restructuring**: Currently `showQuestions` is checked after the main conditional chain's else branch. It needs to be moved into the conditional chain as its own branch, before the else (regular text) branch, so that it can suppress `content` and render summary + table instead.
- **Consumers passing threadKey**: DashboardView passes `{ type: 'hub', projectId }` (no allowedPersonaIds -- all personas). ProductPage passes `{ type: 'panel', screen: 'product' }` with `allowedPersonaIds: ['product-manager']`. ProductRoadmapPage passes `{ type: 'panel', screen: 'product' }` with `allowedPersonaIds: ['product-manager']`. MetaModelView passes `{ type: 'panel', screen: 'metamodel' }` with `allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer']`.
- **Header width constraints**: Panel minimum width is 280px. The new header content ("Chat - Room: X - In: icon name - Available: icons... [collapse]") may be long. CSS should handle graceful wrapping or truncation. The spec should define whether the header wraps to multiple lines or uses truncation.
- **Existing test files**: Multiple test files exist for the affected components (containerIntegration.test.tsx, panelPersistence.test.tsx, screenPanelWiring.test.tsx). Tests will need updates for the new header structure and changed behaviors.
