# Spec Requirements: RM Increment 6 -- Wire Confirmation, Save Roadmap + Success Message

## Initial Description

Complete the Roadmap PM flow end-to-end:
- PM structures Initiatives (L1) and Epics (L2)
- PM transitions to phase="ready"
- User confirms saving
- Gateway triggers a dedicated save branch
- Gateway invokes MCP tool save_roadmap_structure
- Assistant responds with a success message and link to the Roadmap screen

This increment persists canonical roadmap structure in the tool. No Jira import logic here (handled in RM-4).

Scope includes: confirmation detection for roadmap_pm mode, dedicated save branch (separate from normal chat loop), generate roadmapJson from PM's structured response, invoke save_roadmap_structure tool, transcript persistence excluding roadmapJson/tool args, success/failure messaging with link to Roadmap view.

Scope excludes: Jira import execution, dates/scheduling fields, delivery team assignment, work items below EPIC (features/stories), roadmap merge/diff UI, conversation reset controls.

Systems: primary gateway, dependency mcp-server (save_roadmap_structure already built in RM Increment 5), frontend RoadmapPmChatPanel (minimal changes).

## Requirements Discussion

### First Round Questions

**Q1:** I assume the confirmation detection for roadmap_pm mode should reuse the existing isBaselineConfirmation() function (or a clone/generalization of it) -- it checks that the most recent assistant message in conversation history has phase="ready" and the user message matches the BASELINE_CONFIRMATION_REGEX. Is that correct, or should this new function use a different regex or detection logic?

**Answer:** Reuse the existing isBaselineConfirmation() pattern but adjust the word list to include "save" (and optionally remove "generate"); keep the same "phase=ready + strict single-word confirmation" requirement.

**Q2:** Looking at the SA save branch pattern in chat.ts (lines ~1060-1280), the SA flow has an extra generation step where it calls the LLM again with a dedicated prompt to produce the architecture baseline JSON from the conversation transcript. For Roadmap PM, the proposedInitiatives array already exists on the last validated RoadmapPmResponse (from the phase="ready" turn). I assume we should extract proposedInitiatives directly from the most recent assistant message in the conversation history (parse it as JSON), then transform it into the roadmapJson format expected by save_roadmap_structure -- rather than making a dedicated LLM call. Is that correct?

**Answer:** Yes -- extract proposedInitiatives directly from the most recent phase="ready" RoadmapPmResponse in persisted history; no extra LLM call.

**Q3:** The save_roadmap_structure MCP tool expects roadmapJson as a JSON string with the shape { initiatives: [{ title, description, epics: [{ title, description }] }] } (matching RoadmapInput from mcp-server/src/types/saveRoadmapStructure.ts). The proposedInitiatives in RoadmapPmResponse already matches this shape exactly (array of { title, description, epics: [{ title, description }] }). I assume the gateway builds roadmapJson by simply wrapping: JSON.stringify({ initiatives: proposedInitiatives }). Is that correct, or should any additional fields (e.g., externalRef) be populated?

**Answer:** Just JSON.stringify({ initiatives: proposedInitiatives }) and pass through any externalRef fields already present (don't auto-populate new externalRef values).

**Q4:** For the success message, the raw idea says "success message with link to Roadmap screen." The SA save returns a static string. I assume the roadmap save should return a similar static string and the frontend simply renders this as plain text in the chat bubble. Is that correct, or do you want an actual hyperlink/button in the chat panel?

**Answer:** Use a clickable link (React Router Link) that navigates to the Roadmap tab/route; text can be "Roadmap saved. You can review it here."

**Q5:** For the failure message, I assume we follow the SA pattern with a static failure message. Is that correct, or should the failure message include any additional detail (e.g., the error from the MCP tool response)?

**Answer:** Use a user-friendly static failure message (no tool error details); log details server-side.

**Q6:** For transcript persistence, the SA save branch persists only [system message, user confirmation, assistant success/failure] -- deliberately excluding the generation prompt, raw JSON, corrective retries, and tool args. I assume the roadmap save branch should follow the same pattern. Is that correct?

**Answer:** Yes -- follow SA pattern: persist only user confirmation + assistant success/failure; exclude roadmapJson/tool args entirely.

**Q7:** The current RoadmapPmChatPanel frontend component shows a "ready" banner with text: "Roadmap planning is complete. Save functionality coming in a future increment." I assume this increment will either remove that banner entirely and let the user confirm via a typed message, or replace it with a "Save Roadmap" button or prompt. Which approach do you prefer?

**Answer:** Replace the banner with a "Save Roadmap" button (more explicit now that saving exists) AND still accept typed confirmations; button click sends the same confirmation message.

**Q8:** Is there anything that should be explicitly excluded from this increment that I haven't already captured in the scope exclusions?

**Answer:** Also explicitly exclude any updates to work_item status beyond defaulting new items to PLANNED (no auto status transitions), and exclude any automatic reordering/refresh of the right-hand roadmap tree beyond what existing fetch already does.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: SA Increment 5 confirmation/save branch - Path: `gateway/src/routes/chat.ts` (lines ~1060-1280)
  - This is the direct analog pattern: confirmation detection -> dedicated save branch -> tool invocation -> success/failure response -> transcript persistence
- Feature: isBaselineConfirmation() helper - Path: `gateway/src/routes/chat.ts` (lines ~322-350)
  - Reusable pattern for phase="ready" detection + strict regex confirmation matching
  - Current regex: `/^\s*(yes|y|ok|okay|proceed|go ahead|confirm|generate)\s*[.!]?\s*$/i`
  - For RM: add "save", optionally remove "generate"
- Feature: BASELINE_CONFIRMATION_REGEX constant - Path: `gateway/src/routes/chat.ts` (line 166)
  - Static regex constant used by isBaselineConfirmation; RM needs its own constant or a generalized version
- Feature: executeTool function - Path: `gateway/src/services/toolExecutor.ts`
  - save_roadmap_structure already registered at line 32 with endpoint `/mcp/tools/save_roadmap_structure`
  - Required params already defined at line 45: `['projectId', 'roadmapJson']`
- Feature: SaveRoadmapStructureParams type - Path: `gateway/src/types/tools.ts` (lines 169-174)
  - Interface: `{ projectId: string; roadmapJson: string; }`
- Feature: RoadmapPmResponse type (gateway) - Path: `gateway/src/types/chat.ts` (lines 769-784)
  - proposedInitiatives shape: `Array<{ title: string; description: string; epics: Array<{ title: string; description: string }> }>`
  - Note: gateway type does NOT include externalRef, but raw JSON from LLM may include it -- user says pass through any present
- Feature: RoadmapInput / InitiativeInput / EpicInput (MCP) - Path: `mcp-server/src/types/saveRoadmapStructure.ts` (lines 57-85)
  - Accepts optional `externalRef?: ExternalRefInput | null` on both InitiativeInput and EpicInput
- Feature: shouldValidateRoadmapPmResponse() - Path: `gateway/src/routes/chat.ts` (lines 303-305)
  - Existing guard function that checks `context?.mode === 'roadmap_pm'`
- Feature: validateRoadmapPmResponse() - Path: `gateway/src/services/roadmapPmResponseValidator.ts`
  - Existing validator with corrective retry pattern already wired in chat.ts (lines 1682-1782)
- Feature: shouldBypassToolExecution() - Path: `gateway/src/routes/chat.ts` (lines 216-218)
  - roadmap_pm already returns true (bypasses agent loop); the save branch runs BEFORE this check
- Feature: RoadmapPmChatPanel (frontend) - Path: `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`
  - Ready banner at lines 449-453: current placeholder text to be replaced with Save Roadmap button
  - handleSend at lines 252-303: existing send handler that can be reused by button click
  - rmResponses Map: stores RoadmapPmResponse per assistant message ID; used to detect phase="ready"
- Feature: RoadmapPmChatPanel.module.css - Path: `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css`
  - .readyBanner style at lines 223-232: green accent (#e8f5e9 background, #2e7d32 text)
  - New .saveButton style needed; should use existing design system (#1976D2 primary blue)
- Feature: ProductView tab system - Path: `frontend/src/components/ProductView/ProductView.tsx`
  - Tabs are URL-parameter driven: `?tab=roadmap`
  - The RoadmapPmChatPanel is already rendered INSIDE the Roadmap tab
  - The success link target is the same page with `?tab=roadmap` (user is already there)
  - Consider: the link may be most useful if the user navigated away, or it could trigger a roadmap tree refresh

### Follow-up Questions

No follow-up questions needed. All requirements are sufficiently clear from the user's answers and the codebase analysis.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable -- no visual files were found in the `planning/visuals/` folder.

## Requirements Summary

### Functional Requirements

**Gateway -- Confirmation Detection:**
- Create a new `isRoadmapConfirmation()` function (or generalize `isBaselineConfirmation()`) for roadmap_pm mode
- Reuse the same two-condition pattern: (1) most recent assistant message in conversation history is valid JSON with `phase === "ready"`, and (2) user message matches a strict confirmation regex
- New regex constant `ROADMAP_CONFIRMATION_REGEX`: same as `BASELINE_CONFIRMATION_REGEX` but add "save" to the word list; optionally remove "generate"
  - Proposed: `/^\s*(yes|y|ok|okay|proceed|go ahead|confirm|save)\s*[.!]?\s*$/i`
- Call site: inside the `roadmap_pm` section of the chat route handler, AFTER `buildMessagesForTurn()` but BEFORE `sendChatRequest()` (same position as SA's `isBaselineConfirmation` check)

**Gateway -- Dedicated Save Branch:**
- When `shouldValidateRoadmapPmResponse(context)` is true AND `isRoadmapConfirmation(messages, message)` is true, enter the dedicated save branch
- This branch short-circuits the normal chat flow (returns early before `sendChatRequest`)
- NO extra LLM call (unlike SA which calls LLM to generate baseline JSON)
- Extract `proposedInitiatives` by parsing the most recent assistant message from the `messages` array as JSON and reading the `proposedInitiatives` field
- Build `roadmapJson` as `JSON.stringify({ initiatives: proposedInitiatives })` -- preserving any `externalRef` fields already present on initiative/epic objects in the raw JSON (do not auto-populate new externalRef values)
- Invoke `executeTool('save_roadmap_structure', { projectId: context.filename, roadmapJson }, session.mcpSessionId, requestId, effectiveSessionId)`
- If tool returns status 200: respond with success message and success constant
- If tool returns non-200: respond with failure message and failure constant
- Catch-all try/catch wrapping the entire branch for unexpected errors

**Gateway -- Success and Failure Messages:**
- Success constant: `RM_SAVE_SUCCESS_MESSAGE = 'Roadmap saved. You can review it here.'`
  - The frontend will render "here" as a clickable React Router Link
- Failure constant: `RM_SAVE_FAILURE_MESSAGE = 'Roadmap save failed. Please review and try again.'`
  - No MCP tool error details exposed to user; details logged server-side only

**Gateway -- Transcript Persistence (Save Branch):**
- Follow SA save branch pattern exactly
- Persist ONLY: `[system message (messages[0]), user confirmation (original message), assistant success/failure message]`
- Exclude: roadmapJson, tool arguments, tool results, any intermediate data
- Append to transcript and flush to disk for roadmap_pm conversation persistence (existing `shouldAppendToTranscript` already returns true for roadmap_pm)
- Update session after persistence

**Gateway -- Logging:**
- Log confirmation detection event
- Log tool invocation result (status, durationMs)
- Log save branch completion (success/failure, durationMs)
- Log tool invocation failures with full error detail (server-side only)
- Log unexpected errors from catch-all

**Frontend -- Save Roadmap Button:**
- Replace the existing ready banner text ("Roadmap planning is complete. Save functionality coming in a future increment.") with a "Save Roadmap" button
- Button rendered within the `rmResponse.phase === 'ready'` conditional block
- Button click sends a confirmation message (e.g., "save") through the existing `handleSend` mechanism (or a dedicated handler that calls the same `postChatMessage` API)
- Button should be disabled while `loading` is true (prevent double-click)
- Button styling: use existing design system (#1976D2 primary blue), new CSS class `.saveButton` in `RoadmapPmChatPanel.module.css`
- data-testid: `rm-chat-save-roadmap`

**Frontend -- Dual Confirmation Support:**
- Users can ALSO type confirmation words ("yes", "y", "ok", "save", "confirm", etc.) instead of clicking the button
- Both paths send the same message to the gateway; the gateway's `isRoadmapConfirmation()` handles detection identically

**Frontend -- Clickable Success Link:**
- When the assistant's success message is "Roadmap saved. You can review it here.", render "here" as a clickable React Router Link
- Link target: current page with `?tab=roadmap` query parameter (the user is already on the Roadmap tab, but the link ensures they can navigate back if they've moved)
- Detection approach: check if `assistant.message` matches the `RM_SAVE_SUCCESS_MESSAGE` text (or starts with "Roadmap saved"), then render with embedded Link component instead of plain text
- The link styling should follow the existing design system (teal or primary blue)

**Frontend -- No Automatic Roadmap Tree Refresh:**
- The right-hand roadmap tree panel does NOT automatically refresh/re-fetch after save
- Users can manually trigger refresh via existing roadmap import/refresh controls
- This keeps the increment minimal and avoids cross-component coupling

### Reusability Opportunities

- `isBaselineConfirmation()` pattern: can be generalized into a shared helper `isPhaseReadyConfirmation(messages, userMessage, confirmationRegex)` that both SA and RM branches call, or RM can have its own `isRoadmapConfirmation()` function with the same structure (simpler, less risk)
- SA save branch structure (chat.ts lines 1060-1280): the RM save branch is a simplified version (no LLM generation step, no JSON validation/corrective retry, no ensureMinimumServices); the structural pattern (detect -> extract -> tool invoke -> respond -> persist -> log) is identical
- `executeTool()` in toolExecutor.ts: save_roadmap_structure already registered; no changes needed
- `shouldBypassToolExecution()`: already returns true for roadmap_pm; no changes needed
- `shouldAppendToTranscript()` and `flushTranscriptToDisk()`: already handle roadmap_pm; no changes needed
- `buildRoadmapPmContext()` in RoadmapPmChatPanel.tsx (line 75): already provides the correct context shape for API calls

### Scope Boundaries

**In Scope:**
- Gateway: `isRoadmapConfirmation()` function with adjusted regex (add "save", optionally remove "generate")
- Gateway: Dedicated save branch in chat route for roadmap_pm mode (before sendChatRequest)
- Gateway: Extract proposedInitiatives from conversation history (no LLM call)
- Gateway: Build roadmapJson and invoke save_roadmap_structure via executeTool
- Gateway: Success/failure response constants
- Gateway: Transcript persistence (user confirmation + assistant response only)
- Gateway: Server-side logging of all tool invocation details
- Frontend: Replace ready banner with "Save Roadmap" button
- Frontend: Button click sends confirmation message through existing handleSend/postChatMessage
- Frontend: Render success message with clickable React Router Link to Roadmap tab
- Frontend: New CSS class for save button
- Frontend: Button disabled during loading state
- Tests: Unit tests for isRoadmapConfirmation, save branch logic, transcript persistence rules, frontend button rendering and click behavior

**Out of Scope:**
- Jira import execution (RM-4)
- Dates/scheduling fields on work items
- Delivery team assignment
- Work items below EPIC level (features/stories)
- Roadmap merge/diff UI
- Conversation reset controls
- Auto status transitions on work_items (new items default to PLANNED; no automatic status changes)
- Automatic reordering/refresh of the right-hand roadmap tree after save (existing fetch behavior unchanged)
- Extra LLM generation call (proposedInitiatives already available in conversation history)
- Auto-populating new externalRef values (only pass through existing ones)

### Technical Considerations

- **No LLM generation step:** Unlike SA Increment 5 which makes a dedicated LLM call to generate baseline JSON, the RM save branch extracts proposedInitiatives directly from the conversation history. This simplifies the branch significantly (no generation prompt template, no JSON validation/corrective retry for generated content, no temperature/maxTokens overrides).
- **proposedInitiatives extraction:** Parse the most recent assistant message from the `messages` array (built by `buildMessagesForTurn`) as JSON and read `proposedInitiatives`. The readiness gate in `validateRoadmapPmResponse` already ensures proposedInitiatives is non-empty and contains at least one epic when `phase="ready"`, so the data should always be valid at this point.
- **externalRef passthrough:** The gateway's TypeScript `RoadmapPmResponse` type does not include `externalRef`, but the raw JSON from the LLM conversation history may contain it. Since we extract from raw JSON (not the typed object), any `externalRef` fields present will naturally flow through to `roadmapJson`. The `InitiativeInput` and `EpicInput` types in the MCP server already accept optional `externalRef`.
- **Save branch placement:** Must be placed AFTER `buildMessagesForTurn()` (needs the messages array) but BEFORE `sendChatRequest()` and BEFORE the normal `shouldBypassToolExecution()` bypass. This mirrors the exact position of the SA `isBaselineConfirmation` check.
- **React Router Link in chat:** The RoadmapPmChatPanel currently renders `msg.content` as plain text inside a `<div className={styles.messageContent}>`. To support a clickable link in the success message, the rendering logic needs a conditional check: if the message matches the success pattern, render with an embedded `<Link>` component instead of plain text. Since the user is already on the Roadmap tab (the chat panel IS on the Roadmap tab), the link serves as both a confirmation visual and a navigation aid if the user has navigated away.
- **URL structure:** The Roadmap tab uses URL query parameter `?tab=roadmap` (see `ProductView.tsx` line 108). The Link `to` prop should use the current pathname with `?tab=roadmap`.
- **Button and typed confirmation coexistence:** Both the "Save Roadmap" button and typed confirmation words trigger the same server-side `isRoadmapConfirmation()` detection. The button simply programmatically sends a confirmation word (e.g., "save") through the existing `handleSend` mechanism. No special API changes needed.
- **Gateway types file (chat.ts):** No new types needed -- `ChatResponse` already has `roadmapPmResponse` and `assistant.message` fields. The success/failure messages are plain strings on `assistant.message`.
- **Frontend chatApi.ts:** No changes needed -- `ChatResponse` and `RoadmapPmResponse` interfaces already support all required fields.
