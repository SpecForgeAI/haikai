# Specification: RM Increment 6 -- Wire Confirmation, Save Roadmap + Success Message

## Goal
Complete the Roadmap PM end-to-end save flow: detect user confirmation after phase="ready", extract proposedInitiatives from conversation history, invoke `save_roadmap_structure` via the gateway, and return a success message with a clickable link to the Roadmap tab.

## User Stories
- As a product manager, I want to click a "Save Roadmap" button (or type a confirmation word) after the PM reaches phase="ready" so that my structured initiatives and epics are persisted without further manual steps.
- As a product manager, I want to see a success message with a clickable link to the Roadmap tab so that I can immediately review the saved structure.

## Specific Requirements

**Gateway: Confirmation detection (`isRoadmapConfirmation`)**
- Create a new `ROADMAP_CONFIRMATION_REGEX` constant: `/^\s*(yes|y|ok|okay|proceed|go ahead|confirm|save)\s*[.!]?\s*$/i` (same as `BASELINE_CONFIRMATION_REGEX` but adds "save" and removes "generate")
- Create a new exported `isRoadmapConfirmation(messages, userMessage)` function following the exact structure of `isBaselineConfirmation()` at `chat.ts` lines 322-350
- Two-condition check: (1) most recent assistant message in `messages` is valid JSON with `phase === "ready"`, and (2) `userMessage` matches `ROADMAP_CONFIRMATION_REGEX`
- Place the call site inside the chat route handler AFTER `buildMessagesForTurn()` but BEFORE `sendChatRequest()`, gated by `shouldValidateRoadmapPmResponse(context) && isRoadmapConfirmation(messages, message)`

**Gateway: Dedicated save branch (short-circuits normal chat flow)**
- When confirmation is detected, enter a dedicated save branch that returns early before `sendChatRequest` -- no LLM call is made
- Extract `proposedInitiatives` by parsing the most recent assistant message from the `messages` array as JSON and reading its `proposedInitiatives` field
- Build `roadmapJson` as `JSON.stringify({ initiatives: proposedInitiatives })`, preserving any `externalRef` fields already present on initiative/epic objects in the raw JSON (do not strip or auto-populate `externalRef`)
- Invoke `executeTool('save_roadmap_structure', { projectId: context.filename, roadmapJson }, session.mcpSessionId, requestId, effectiveSessionId)`
- Wrap the entire branch in a try/catch; on unexpected error, return the failure response

**Gateway: Success and failure message constants**
- `RM_SAVE_SUCCESS_MESSAGE = 'Roadmap saved. You can review it here.'` -- the frontend renders "here" as a clickable React Router Link
- `RM_SAVE_FAILURE_MESSAGE = 'Roadmap save failed. Please review and try again.'` -- no MCP tool error details exposed; log full error server-side
- If `toolResult.status === 200`, respond with success; otherwise respond with failure

**Gateway: Transcript persistence (save branch)**
- Follow the SA save branch persistence pattern exactly (chat.ts lines 1208-1226)
- Persist ONLY: `[messages[0] (system message), { role: 'user', content: message } (original confirmation), { role: 'assistant', content: chatResponse.assistant.message }]`
- Exclude: `roadmapJson`, tool arguments, tool results, any intermediate data
- Call `persistConversation`, then `appendTranscriptEntry` for USER and ASSISTANT, then `flushTranscriptToDisk`, then `updateSession`

**Gateway: Logging**
- Log confirmation detection event with `requestId` and `sessionId`
- Log tool invocation result (status, durationMs)
- Log save branch completion (success/failure, durationMs)
- Log tool invocation failures and catch-all unexpected errors with full error detail (server-side only)

**Frontend: Replace ready banner with "Save Roadmap" button**
- Replace the placeholder text at `RoadmapPmChatPanel.tsx` lines 449-453 ("Roadmap planning is complete. Save functionality coming in a future increment.") with a "Save Roadmap" button inside the `rmResponse.phase === 'ready'` block
- Button click programmatically sends a confirmation word (e.g., "save") through the existing `handleSend` mechanism by setting `inputDraft` to "save" then calling `handleSend`, or via a dedicated handler that calls `postChatMessage` directly
- Button disabled while `loading` is true to prevent double-click
- Styling: new `.saveButton` CSS class in `RoadmapPmChatPanel.module.css` using design system primary blue (`#1976D2`), similar to `.sendButton` but placed within the ready banner area
- `data-testid="rm-chat-save-roadmap"`

**Frontend: Typed confirmation still supported**
- Users can type confirmation words ("yes", "y", "ok", "save", "confirm", etc.) instead of clicking the button
- Both paths produce the same server-side behavior via `isRoadmapConfirmation()`

**Frontend: Clickable success link in assistant message**
- Define a `RM_SUCCESS_LINK_MARKER` constant (e.g., `'can review it here'`) to detect the success message, following the SA pattern of `SUCCESS_LINK_MARKER` at `SolutionArchitectChatPanel.tsx` line 52
- Create a `renderMessageContent` function (or equivalent conditional logic) that splits the message around the last occurrence of "here" and renders it as a clickable `<span>` or React Router `<Link>` navigating to `?tab=roadmap`
- The link uses the current pathname with `?tab=roadmap` query parameter (consistent with `ProductView.tsx` updateUrl pattern)
- Style the clickable link with teal or primary blue color, cursor pointer, and underline (follow SA's `.architectureLink` pattern)
- `data-testid="rm-roadmap-link"`

**Frontend: No automatic roadmap tree refresh**
- The right-hand roadmap tree panel does NOT automatically refresh after save
- Users manually trigger refresh via existing controls

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`gateway/src/routes/chat.ts` -- SA save branch (lines 1060-1282)**
- Direct structural analog: confirmation detection, dedicated save branch, tool invocation, success/failure response, transcript persistence, timing/logging, catch-all error handler
- The RM branch is simpler: no LLM generation call (Steps 1-3 eliminated), no JSON validation/corrective retry, no `ensureMinimumServices`; extract `proposedInitiatives` directly from conversation history
- Reuse the same persistence pattern: `persistConversation` with 3-element array, `appendTranscriptEntry` USER + ASSISTANT, `flushTranscriptToDisk`, `updateSession`

**`gateway/src/routes/chat.ts` -- `isBaselineConfirmation()` (lines 322-350) and `BASELINE_CONFIRMATION_REGEX` (line 166)**
- Clone the function structure for `isRoadmapConfirmation()`: reverse-iterate `messages` to find most recent assistant message, parse as JSON, check `phase === "ready"`, then test user message against regex
- Adjust the regex word list: add "save", remove "generate"

**`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` -- `renderMessageContent()` and `SUCCESS_LINK_MARKER`**
- Follow the same pattern for rendering a clickable "here" link inside assistant messages: detect marker substring, split around last "here", render as clickable `<span>` with `role="link"`, `tabIndex={0}`, keyboard handler
- The SA version uses `useArchitectureDispatch` for navigation; the RM version should use `window.history.pushState` or React Router navigation to `?tab=roadmap`

**`gateway/src/services/toolExecutor.ts` -- `save_roadmap_structure` registration (lines 32, 45)**
- Already fully registered: endpoint at `/mcp/tools/save_roadmap_structure`, required params `['projectId', 'roadmapJson']`
- No changes needed to `toolExecutor.ts`; the save branch calls `executeTool` directly

**`frontend/src/components/ProductView/RoadmapPmChatPanel.module.css` -- `.readyBanner` (lines 223-232)**
- Existing green-accented banner styling; the new `.saveButton` class should be placed adjacent to or replace the banner content
- Follow `.sendButton` pattern for button styling but use the green banner context or primary blue depending on design preference

## Out of Scope
- Jira import execution (handled in RM-4)
- Dates/scheduling fields on work items
- Delivery team assignment
- Work items below EPIC level (features/stories)
- Roadmap merge/diff UI
- Conversation reset controls
- Auto status transitions on work_items beyond defaulting new items to PLANNED
- Automatic reordering/refresh of the right-hand roadmap tree after save
- Extra LLM generation call (proposedInitiatives already available in conversation history)
- Auto-populating new externalRef values (only pass through existing ones from raw JSON)
