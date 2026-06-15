# Specification: UnifiedChatPanel UX Polish

## Goal
Improve the chat UX across Hub and screen RHS panels by making the room/persona model explicit in the header, turning persona selection into a single-action flow that immediately triggers the greeting and task menu, displaying task labels (not routing artifacts) in user message bubbles, and suppressing raw JSON from structured question responses in favor of summary text plus the questions table.

## User Stories
- As a user, I want the chat header to show which room I am in, which persona is active, and which personas are available so that I always know the conversational context at a glance.
- As a user, I want clicking an available persona icon (or selecting from the @ dropdown) to immediately switch personas and trigger the greeting with task menu so that persona switching is a single action rather than a multi-step process.
- As a user, I want task selection to display the task label (e.g., "Define Product") as my message bubble text so that the transcript reads naturally without routing artifacts like "@Product Manager".

## Specific Requirements

**FR1: Room Header with Room/Persona Model**
- Replace the current header content in `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` lines 354-374, which renders "Chat" title + single `personaIndicator` circle + collapse button
- New header format: `Chat - Room: <RoomName> - In: <Icon><PersonaName> - Available: <Icons...> [collapse button]`
- Add a pure function `getRoomName(threadKey: ThreadKey): string` that derives the room name from the `threadKey` discriminated union: `{ type: 'hub' }` => "Project Room", `{ type: 'panel', screen: 'product' | 'roadmap' | 'backlog' }` => "Product Strategy Room", `{ type: 'panel', screen: 'metamodel' | 'architecture' }` => "Architecture Room", all others => "Room"
- "In:" section renders the active persona's 24px colored circle icon (reusing the existing `personaIndicator` CSS class at line 62-72 of `UnifiedChatPanel.module.css`) plus the persona `displayName` text
- "Available:" section renders 24px circle icons (initials only, no names) for each allowed persona except the active persona; clicking an icon calls `selectPersona(personaId)`
- Available persona list is computed as: take `allowedPersonaIds` (or all 6 from `PERSONA_CONFIGS` if undefined), ensure `'assistant'` is always included, then remove the currently active persona; use `useMemo` for this computation
- Import `PERSONA_CONFIGS` from `frontend/src/config/personaConfig.ts` (currently only `getPersonaConfig` is imported at line 59) to iterate available personas
- The "Room:", "In:", and "Available:" labels are visible text in the header; the collapse button remains at the far right
- Add new CSS classes in `UnifiedChatPanel.module.css` for the header layout: `headerRoom`, `headerIn`, `headerAvailable`, and `availableIcon` (clickable variant of `personaIndicator` with `cursor: pointer` and hover state); handle graceful wrapping via `flex-wrap: wrap` since the panel minimum width is 280px

**FR2: Persona Switch Auto-Send (selectPersona triggers greeting + task menu)**
- Modify `selectPersona` in `frontend/src/hooks/useChatThread.ts` lines 640-663 so that after the existing logic (system message insertion, `postHandoff`, `setActivePersonaId`, `setActiveTaskId('unknown')`), it also calls `sendMessage('')`
- Because `activeTaskId` is set to `'unknown'` synchronously and `sendMessage` reads `activeTaskIdRef.current`, the empty-string message enters the queuing path and hits the backend with `taskId='unknown'`, which triggers the backend's task-menu response (greeting + task list)
- The existing "Switched to {displayName}" system message and fire-and-forget `postHandoff` call remain unchanged
- `selectPersona` currently has no dependency on `sendMessage` in its `useCallback` deps array (line 663 has `[]`); this must be updated to `[sendMessage]`
- Wire each available persona icon's `onClick` in the header (FR1) to call `selectPersona(personaId)`, which now triggers the full flow

**FR3: @-Mention Persona Selection Clears Input (No Text Insertion)**
- Modify `handleSelectPersona` in `frontend/src/components/UnifiedChat/MentionInput.tsx` lines 143-174 to remove the text insertion logic (lines 150-154 that build `@DisplayName ` and splice it into the textarea value)
- Instead of inserting text: call `onChange('')` to clear the input, call `onPersonaSelected(persona.id)` to trigger the persona switch (which per FR2 now auto-sends), close the dropdown, and focus the textarea
- Remove the `setTimeout` cursor-positioning logic at lines 165-171 since no text is inserted; simply call `textarea.focus()` after clearing
- The `onPersonaSelected` callback flows up through `ChatInputBar.tsx` line 153 to `UnifiedChatPanel.tsx` line 397 where it calls `selectPersona`, which now handles the full greeting + task menu flow
- Input should remain empty and focused after selection

**FR4: Task Click Sends menuLabel Directly (Not "Selected task: {label}")**
- Modify `selectTask` in `frontend/src/hooks/useChatThread.ts` at line 716, changing `sendMessage(\`Selected task: ${label}\`)` to `sendMessage(label)`
- The `label` variable is already resolved from `lastStructuredResponseRef.current` task-menu data's `menuLabel` field (lines 700-713), so the user bubble will display exactly the task label (e.g., "Define Product")
- No other changes needed; the `label` fallback to `taskId` at line 700 remains for edge cases where the structured response is missing

**FR5: Questions Response Renders Summary Only (No Raw JSON Content)**
- In `frontend/src/components/UnifiedChat/MessageBubble.tsx`, restructure the conditional rendering chain so that `showQuestions` becomes its own dedicated branch in the ternary chain (lines 273-381), rather than an addendum after the else branch (lines 383-392)
- When `showQuestions` is true: suppress `message.content` entirely, render `structuredResponse.summary` as plain text above the questions table (if the `summary` field exists and is non-empty), then render `StructuredQuestionsRenderer` below it
- Move the questions branch into the main ternary chain between the `showCompletionChip` branch (line 365) and the else (regular text) branch (line 376), structured as: `} : showQuestions && onSubmitAnswers ? ( <summary + table> ) : ( <regular text> )`
- Remove the standalone `showQuestions` block at lines 383-392 since it is now integrated into the chain
- Extract `summary` from `structuredResponse` by casting to `{ summary?: string }` and rendering it in a `messageContent` div only when present

## Visual Design

No visual mockups were provided. The layout is described below based on the requirements discussion.

**Header Layout (expanded panel)**
- Single-line or wrapping row: `[Chat] [-] [Room: <name>] [-] [In: <24px circle> <name>] [-] [Available: <24px circles...>] [collapse btn]`
- Dash separators are literal en-dash or styled spacing between sections
- "Room:", "In:", "Available:" are visible muted-color label text (similar to existing `headerTitle` style at 16px but lighter weight)
- Active persona in "In:" uses the existing `personaIndicator` 24px circle (white initials on colored background) with display name text beside it
- Available persona icons are the same 24px circles but are clickable (`cursor: pointer`, slight hover opacity or ring effect)
- At narrow panel widths (280px minimum), the header sections should `flex-wrap` to a second line rather than truncating
- The collapse button (PanelRightClose icon) stays pinned to the far right of the first line

## Existing Code to Leverage

**`personaIndicator` CSS class in `UnifiedChatPanel.module.css` (lines 62-72)**
- Defines the 24px circle with centered 10px bold white initials used for the current active persona indicator in the header
- Reuse this exact style for both the "In:" active persona icon and the "Available:" persona icons
- Add a clickable variant (cursor pointer + hover state) for the available icons

**`PERSONA_CONFIGS` array and `getPersonaConfig()` in `personaConfig.ts`**
- Static array of all 6 personas with `id`, `displayName`, `color`, `initials` fields
- `getPersonaConfig(id)` returns a single config with grey fallback for unknown IDs
- Use `PERSONA_CONFIGS` to compute the available persona list in the header, filtering by `allowedPersonaIds` and excluding the active persona, then ensuring `'assistant'` is always included

**`selectPersona()` in `useChatThread.ts` (lines 640-663)**
- Already handles system message insertion ("Switched to {name}"), `postHandoff` persistence, `setActivePersonaId`, and `setActiveTaskId('unknown')`
- Extend by adding a `sendMessage('')` call at the end to trigger the backend greeting + task menu response
- Dependency array must be updated from `[]` to `[sendMessage]`

**`handleSelectPersona()` in `MentionInput.tsx` (lines 143-174)**
- Currently splices `@DisplayName ` into the textarea value at the cursor position and positions the cursor after insertion
- The `onPersonaSelected(persona.id)` call at line 157 already exists and triggers `selectPersona` upstream
- Modify to call `onChange('')` instead of building and inserting the `@DisplayName` text, then focus the textarea

**`hasQuestions()` and `extractQuestions()` in `MessageBubble.tsx` (lines 107-132)**
- `hasQuestions(sr)` detects whether a structured response contains a questions or openQuestions array (strings or objects)
- `extractQuestions(sr)` normalizes the array into `{ id, question }` objects
- These helpers remain unchanged; the only change is how the rendering branch uses them (moving from addendum to dedicated ternary branch, suppressing content, and rendering summary)

## Out of Scope
- FeatureThreadKey room name mapping (ignored per requirements; fallback to "Room")
- Changes to task definitions or backend task configuration
- Backend workflow logic changes (no new endpoints, no changes to existing endpoint behavior)
- Persona permission model changes (allowedPersonaIds structure stays the same)
- Broader error handling improvements beyond the existing patterns
- Streaming, summarisation, or completion chip rendering changes
- Artifact preview/save flow changes
- Implement screen changes
- Any new "allowedArtifactIds" or artifact gating abstraction
- TaskMenu component changes (it already passes `taskId` to `onSelectTask`; the label resolution happens in `useChatThread.selectTask`)
