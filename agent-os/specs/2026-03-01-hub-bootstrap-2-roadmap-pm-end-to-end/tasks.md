# Task Breakdown: Hub Bootstrap 2 -- Roadmap (PM) End-to-End

## Overview
Total Tasks: 68
Task Groups: 8
Estimated Build Order: Task Definition + Prompt Config -> Backend Endpoint Extensions -> Backend Dashboard Integration -> API Client Generalization -> Frontend Components -> useChatThread Hook Generalization -> Frontend Integration Wiring -> Test Review & Gap Analysis

This is Increment 5 of the 11-increment plan. Increments 1 (backend POST /api/chat/v2, registries, thread persistence, prompt composition), 2 (frontend UnifiedChatPanel components, useChatThread hook, GET /api/chat/v2/thread, Dashboard integration), 3 (Hub Chat MVP wiring -- @-mention, message queuing, persona handoff, PersonaHelperPanel cleanup), and 4 (PM "Define Product" end-to-end -- artifact generation, preview, confirm/save, completion chip, dashboard reflection) are all complete and verified. This increment wires the second bootstrap conversation flow: PM "Build Roadmap" discovery -> inline context injection -> deterministic first-turn -> artifact extraction from thread history -> structured roadmap preview -> adapter-pattern save -> completion chip -> dashboard real roadmap data -- generalizing the Increment 4 mission-specific code into a task-agnostic artifact pipeline.

**Key Constraint:** The existing v1 `POST /api/chat` endpoint, `chat.ts`, `RoadmapPmChatPanel.tsx`, and `promptBuilder.ts` remain completely untouched. The v1 PM roadmap flow continues to work alongside this new Hub-based flow until Increment 10 removal.

---

## Task List

### Backend Layer

#### Task Group 1: Task Definition and Prompt Configuration
**Dependencies:** None
**Assignee Profile:** Backend engineer (TypeScript / JSON config / Markdown)

This group updates the PM roadmap task definition to declare the roadmap artifact slot and appends the Jira awareness instruction block to the task prompt file. No runtime code changes -- only the JSON config file and the prompt markdown file.

- [x] 1.0 Complete task definition and prompt configuration
  - [x] 1.1 Write 3 focused tests for task definition and prompt validation
    - Test that `gateway/src/config/tasks/product-manager--roadmap.json` parses as valid JSON and contains an `artifacts` array with at least one entry where `artifactId === 'roadmap'`
    - Test that the `artifacts[0]` entry has the expected shape: `{ artifactId: 'roadmap', filename: 'ROADMAP', tool: 'save_roadmap_structure', description: string }`
    - Test that `gateway/src/config/prompts/product-manager.roadmap.task.md` contains the Jira awareness instruction block text ("Jira import is coming in a future increment")
  - [x] 1.2 Update `gateway/src/config/tasks/product-manager--roadmap.json`
    - Change the `artifacts` field from `[]` to:
      ```json
      [
        {
          "artifactId": "roadmap",
          "filename": "ROADMAP",
          "tool": "save_roadmap_structure",
          "description": "Roadmap structure with initiatives and epics"
        }
      ]
      ```
    - Leave `responseFormat` unchanged -- the 7 required fields including nested `proposedInitiatives` with `epics` sub-array remain as-is
    - Leave `contextNeeds` as `["mission", "existing-roadmap"]` -- unchanged
    - Leave `taskPromptRef` unchanged
  - [x] 1.3 Update `gateway/src/config/prompts/product-manager.roadmap.task.md`
    - Append the content of `JIRA_AWARENESS_INSTRUCTION_BLOCK` (from `gateway/src/services/promptBuilder.ts` line 211-213) as a permanent section at the end of the .md file
    - The block reads: "If the user mentions having a Jira roadmap... respond with: 'Jira import is coming in a future increment...'"
    - `ROADMAP_EXISTS_INSTRUCTION_BLOCK` is NOT added to the .md file; it remains a conditional suffix injected by the pipeline at runtime
  - [x] 1.4 Ensure task definition and prompt tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify JSON parses correctly and artifact slot is declared
    - Verify prompt file contains the Jira awareness block

**Acceptance Criteria:**
- All 3 tests pass
- `product-manager--roadmap.json` has a valid `artifacts` array with the `roadmap` entry
- Existing `responseFormat`, `contextNeeds`, and `taskPromptRef` are unchanged
- `product-manager.roadmap.task.md` ends with the Jira awareness instruction block
- `ROADMAP_EXISTS_INSTRUCTION_BLOCK` is NOT in the .md file (remains runtime-injected)
- Registry loader continues to load the task definition without errors

---

#### Task Group 2: Backend Endpoint Extensions (POST /, /generate, /save-artifact, validateStructuredResponse)
**Dependencies:** Task Group 1
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Extends four areas of `gateway/src/routes/chatV2.ts`: (1) inline context assembly and deterministic first-turn short-circuit in the POST `/` handler, (2) artifactType branching in POST `/generate`, (3) adapter pattern in POST `/save-artifact`, and (4) nested schema validation in `validateStructuredResponse`. These generalize the Increment 4 mission-specific paths into a task-agnostic pipeline.

- [x] 2.0 Complete backend endpoint extensions
  - [x] 2.1 Write 8 focused tests for the endpoint extensions
    - Test POST `/` with `taskId === 'product-manager--roadmap'` and zero prior roadmap messages (first turn, no existing roadmap) returns a canned response with `section: 'roadmap_existence_check'` and 2 questions
    - Test POST `/` with `taskId === 'product-manager--roadmap'` and zero prior roadmap messages (first turn, existing roadmap) returns a canned response with `section: 'outcome_alignment'` and 3 questions with initiative/epic count summary
    - Test POST `/` with `taskId === 'product-manager--roadmap'` and prior messages (not first turn) proceeds to LLM call with `resolvedContext` containing `MISSION`, `EXISTING ROADMAP`, and conditionally `EXISTING ROADMAP GUIDANCE` sections
    - Test POST `/generate` with `taskId === 'product-manager--roadmap'` extracts `proposedInitiatives` from the last assistant message in thread history and returns `{ success: true, artifactContent: string }` without calling the LLM
    - Test POST `/generate` with `taskId === 'product-manager--define-product'` (mission path) continues to call the LLM and returns both `missionMarkdown` and `artifactContent` fields
    - Test POST `/generate` with roadmap taskId when no assistant message has `proposedInitiatives` returns `{ success: false, error: string }`
    - Test POST `/save-artifact` with roadmap adapter calls `executeToolCall` with `'save_roadmap_structure'` and args `{ projectId, roadmapJson: content }`, and inserts a completion chip with `artifactId: 'roadmap'` and `artifactName: 'ROADMAP'`
    - Test `validateStructuredResponse` with nested schema validates that `proposedInitiatives` array items are objects with a required `title` string field, rejecting `[42, "string"]` as invalid
  - [x] 2.2 Add inline context assembly for roadmap task in POST `/` handler
    - In `gateway/src/routes/chatV2.ts`, after the existing stub-resolver loop (Step 5, lines 822-836) and before `composeSystemPrompt` (Step 6, line 839), add a roadmap-specific inline context block
    - Guard with `task.id === 'product-manager--roadmap'`
    - Read MISSION.MD from disk using the `loadProjectFile` pattern from v1 (`chat.ts` lines 1158-1167): `loadProjectFile(config.conversationPersistBasePath, 'agent-os/product/MISSION.MD', 'agent-os/product/mission.md', requestId)` -- add result to `resolvedContext['MISSION']`
    - Call `fetchProductSummary(threadKey.projectId)` from `architectureModelClient.ts`, then `buildRoadmapSummary(productSummary)` from `roadmapSummaryBuilder.ts` -- add result to `resolvedContext['EXISTING ROADMAP']`
    - If `hasExistingRoadmap(productSummary)` returns true, set `resolvedContext['EXISTING ROADMAP GUIDANCE']` to `ROADMAP_EXISTS_INSTRUCTION_BLOCK`
    - Add imports: `loadProjectFile` from `chat.ts` (or replicate inline), `fetchProductSummary` from `architectureModelClient.ts`, `buildRoadmapSummary`, `hasExistingRoadmap`, `countRoadmapItems` from `roadmapSummaryBuilder.ts`, `ROADMAP_EXISTS_INSTRUCTION_BLOCK` from `promptBuilder.ts` (must be exported)
  - [x] 2.3 Add deterministic first-turn short-circuit for roadmap task in POST `/` handler
    - Before system prompt composition (Step 6) and LLM call (Step 8), detect first turn: `task.id === 'product-manager--roadmap'` AND `thread.messages.filter(m => m.taskId === task.id).length === 0`
    - Call `fetchProductSummary(threadKey.projectId)` and `hasExistingRoadmap()` to determine the branch
    - If roadmap exists: build a canned `RoadmapPmResponse` with `phase: "questions"`, `section: "outcome_alignment"`, 3 canned questions (matching v1 at `chat.ts` lines 1198-1210), summary text with initiative/epic counts from `countRoadmapItems()`, and empty `proposedInitiatives/assumptions/openItems`
    - If no roadmap: build a canned response with `section: "roadmap_existence_check"`, 2 canned questions (matching v1 at `chat.ts` lines 1245-1256), and appropriate summary
    - Persist user message and canned assistant message to thread via `appendMessage()`, then return a `ChatV2Response` with the canned `structuredResponse` -- skip the LLM call entirely
  - [x] 2.4 Extend POST `/generate` endpoint with artifactType branching
    - Accept new optional field `artifactType` in the request body, or derive from `taskId` via task registry lookup of `task.artifacts[0].artifactId`
    - Mission path (existing, `artifactType === 'mission'` or `taskId === 'product-manager--define-product'`): preserve current LLM-based generation unchanged; also return `artifactContent` set equal to `missionMarkdown` for generalization; keep `missionMarkdown` as a deprecated alias
    - Roadmap path (`artifactType === 'roadmap'` or `taskId === 'product-manager--roadmap'`): do NOT call the LLM; scan `thread.messages` in reverse to find the last assistant message, parse its JSON content, extract `proposedInitiatives` array (replicating v1 pattern at `chat.ts` lines 1435-1448); return `{ success: true, artifactContent: JSON.stringify({ initiatives: proposedInitiatives || [] }) }`
    - On failure (no assistant message found, no `proposedInitiatives`): return `{ success: false, error: 'descriptive message' }`
  - [x] 2.5 Extend POST `/save-artifact` endpoint with adapter pattern
    - Accept new optional field `artifactType` in the request body, or derive from `taskId` via task registry lookup
    - Mission adapter (existing path): maps `content` to `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }` and calls `executeToolCall` with `'save_product_artifacts'`; completion chip uses `artifactId: 'mission-md'`, `artifactName: 'MISSION.MD'`, `content: 'Product Definition complete.'`
    - Roadmap adapter (new path): maps `content` to `{ projectId, roadmapJson: content }` and calls `executeToolCall` with `'save_roadmap_structure'`; completion chip uses `artifactId: 'roadmap'`, `artifactName: 'ROADMAP'`, `content: 'Roadmap complete.'`
    - Adapter selection is a simple `if/else` or `switch` on the derived `artifactType`
    - Roadmap adapter does NOT need `projectParentFolder`, `productName`, or `overwrite` -- only `projectId` and `roadmapJson`
    - `executeToolCall` in `toolExecutor.ts` already supports `save_roadmap_structure` with no changes needed
  - [x] 2.6 Extend `validateStructuredResponse` for nested roadmap schema
    - Add one level of nested validation for `array` type fields when the schema includes `items.type === 'object'` and `items.properties`
    - For roadmap: verify `proposedInitiatives` array items are objects with a required `title` string field; verify `epics` sub-array items (when present) are objects with a required `title` string field
    - Prevents malformed responses like `proposedInitiatives: [42, "string"]` from passing validation
    - Keep the extension generic (driven by the schema's `items.properties` definition) so future tasks benefit
  - [x] 2.7 Ensure backend endpoint extension tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify first-turn short-circuit, context injection, generate branching, save adapter, and nested validation all work correctly

**Acceptance Criteria:**
- All 8 tests pass
- POST `/` first-turn short-circuit returns correct canned responses for both "has roadmap" and "no roadmap" branches
- POST `/` non-first-turn assembles inline context with MISSION, EXISTING ROADMAP, and conditional EXISTING ROADMAP GUIDANCE sections
- POST `/generate` roadmap path extracts `proposedInitiatives` from thread history without LLM call
- POST `/generate` mission path returns both `missionMarkdown` and `artifactContent` for backward compatibility
- POST `/save-artifact` roadmap adapter calls `save_roadmap_structure` with correct args and inserts roadmap completion chip
- `validateStructuredResponse` rejects malformed nested arrays
- Existing mission paths in `/generate` and `/save-artifact` are unaffected

---

#### Task Group 3: Backend Dashboard Integration (Real Roadmap Data)
**Dependencies:** Task Group 2
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Adds real roadmap existence and initiative/epic count data to the dashboard summary endpoint, replacing mock values when the Architecture Model Service has roadmap data available.

- [x] 3.0 Complete backend dashboard integration
  - [x] 3.1 Write 3 focused tests for dashboard roadmap data
    - Test that `GET /api/dashboard/summary` returns `roadmap.state.value === 100` and correct `initiativesCount` and `epicsCount` when `fetchProductSummary` returns a product with existing roadmap data (mock `fetchProductSummary` to return data with initiatives/epics)
    - Test that `GET /api/dashboard/summary` returns `roadmap.state.value === 0` when `hasExistingRoadmap` returns false
    - Test that `GET /api/dashboard/summary` leaves mock roadmap values unchanged when `fetchProductSummary` throws an error (graceful degradation)
  - [x] 3.2 Add real roadmap data to dashboard summary endpoint
    - In `gateway/src/routes/dashboardSummary.ts`, after the existing MISSION.MD check (lines 78-94), add a roadmap existence block following the same pattern
    - Call `fetchProductSummary(projectId)` from `architectureModelClient.ts`
    - Call `hasExistingRoadmap()` and `countRoadmapItems()` from `roadmapSummaryBuilder.ts`
    - Override mock values:
      ```typescript
      dto.strategicFoundation.roadmap.state = { label: 'State', value: roadmapExists ? 100 : 0 };
      dto.strategicFoundation.roadmap.initiativesCount = { label: 'Initiatives', value: initiativeCount };
      dto.strategicFoundation.roadmap.epicsCount = { label: 'Epics', value: epicCount };
      ```
    - Wrap in try/catch: on failure (service unavailable), log a warning and leave mock values unchanged (graceful degradation)
    - Add imports: `fetchProductSummary` from `architectureModelClient.ts`, `hasExistingRoadmap`, `countRoadmapItems` from `roadmapSummaryBuilder.ts`
  - [x] 3.3 Ensure dashboard integration tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify real data overrides mock values and graceful degradation on error

**Acceptance Criteria:**
- All 3 tests pass
- Dashboard summary returns real roadmap state, initiative count, and epic count when Architecture Model Service is available
- Dashboard summary gracefully degrades to mock values when the service is unavailable
- Existing MISSION.MD existence check is unaffected

---

### Frontend API Client Layer

#### Task Group 4: Frontend API Client Generalization
**Dependencies:** Task Group 2 (backend endpoints must be extended)
**Assignee Profile:** Frontend engineer (TypeScript)

Generalizes the `postGenerateArtifact` response type in `chatV2Api.ts` to include the new `artifactContent` field alongside the existing `missionMarkdown` field for backward compatibility.

- [x] 4.0 Complete API client generalization
  - [x] 4.1 Write 2 focused tests for the API client generalization
    - Test `postGenerateArtifact` returns `artifactContent` field from the response when present (roadmap path)
    - Test `postGenerateArtifact` returns `missionMarkdown` field for backward compatibility (mission path) and also returns `artifactContent` set to the same value
  - [x] 4.2 Update `postGenerateArtifact` response type in `frontend/src/api/chatV2Api.ts`
    - Update the return type to include `artifactContent?: string` alongside the existing `missionMarkdown?: string`:
      ```typescript
      export async function postGenerateArtifact(
        threadKey: ThreadKey,
        personaId: string,
        taskId: string
      ): Promise<{ success: boolean; missionMarkdown?: string; artifactContent?: string; error?: string }>
      ```
    - The hook should prefer `result.artifactContent` and fall back to `result.missionMarkdown`
  - [x] 4.3 Ensure API client tests pass
    - Run ONLY the 2 tests written in 4.1
    - Verify both `artifactContent` and `missionMarkdown` fields are handled

**Acceptance Criteria:**
- Both tests pass
- `postGenerateArtifact` response type includes both `artifactContent` and `missionMarkdown` fields
- Existing `postSaveArtifact` function is unaffected
- Existing `postChatV2`, `getThreadHistory`, and `postHandoff` functions are unaffected

---

### Frontend Components Layer

#### Task Group 5: Frontend Components (RoadmapPreviewBubble + MessageBubble)
**Dependencies:** Task Group 4 (types used by new components)
**Assignee Profile:** Frontend engineer (React, TypeScript, CSS)

Creates the `RoadmapPreviewBubble` component for structured roadmap preview with Show JSON toggle, and updates `MessageBubble.tsx` with a new type guard and rendering branch for `roadmap-preview` structured responses. Also parameterizes the existing `ArtifactPreviewBubble` header label.

- [x] 5.0 Complete frontend components for roadmap preview
  - [x] 5.1 Write 8 focused tests for the new components and MessageBubble updates
    - Test `RoadmapPreviewBubble` renders a readable summary: list of initiatives with nested epics showing titles and descriptions
    - Test `RoadmapPreviewBubble` renders initiative/epic counts in the header (e.g., "Generated Roadmap (3 initiatives, 7 epics)")
    - Test `RoadmapPreviewBubble` toggles between readable summary view and raw JSON view when "Show JSON" button is clicked
    - Test `RoadmapPreviewBubble` renders Confirm and Reject buttons; Confirm button shows spinner text when `isConfirming` is true
    - Test `RoadmapPreviewBubble` calls `onConfirm` when Confirm is clicked and `onReject` when Reject is clicked
    - Test `RoadmapPreviewBubble` disables both buttons when `disabled` is true
    - Test `isRoadmapPreview` type guard returns true for `{ type: 'roadmap-preview', ... }` and false for other types
    - Test `MessageBubble` renders `RoadmapPreviewBubble` when `structuredResponse.type === 'roadmap-preview'` and `onConfirmArtifact` is provided
  - [x] 5.2 Create `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx`
    - Props interface:
      ```typescript
      export interface RoadmapPreviewBubbleProps {
        jsonContent: string;
        onConfirm: () => void;
        onReject: () => void;
        isConfirming: boolean;
        disabled: boolean;
      }
      ```
    - Parse `jsonContent` (JSON string with `{ initiatives: [...] }`) and render a readable summary:
      - List of initiatives with nested epics showing titles and descriptions
      - Initiative/epic counts in the header (e.g., "Generated Roadmap (3 initiatives, 7 epics)")
    - Add "Show JSON" toggle button that switches between readable summary view and raw JSON view (pretty-printed)
    - Confirm/Reject buttons identical in behavior to `ArtifactPreviewBubble`:
      - "Confirm" button: primary style with green tint; shows "Saving..." when `isConfirming` is true; calls `onConfirm`
      - "Reject" button: secondary/outlined style; calls `onReject`
      - Both buttons disabled when `disabled` or `isConfirming` is true
    - Max-height container with `overflow-y: auto` for long content
    - `data-testid="roadmap-preview-bubble"`
  - [x] 5.3 Create `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.module.css`
    - `.container`: bordered container with subtle background tint, `border-radius: 8px`, `padding: 16px`, `max-height: 400px`, `overflow-y: auto`
    - `.header`: header label styling with initiative/epic counts
    - `.initiativeList`: list styling for initiatives
    - `.initiative`: initiative item with title emphasis
    - `.epicList`: nested list styling for epics
    - `.epic`: epic item with title and description
    - `.toggleButton`: "Show JSON" toggle button styling
    - `.jsonView`: raw JSON view with monospace font, pre-wrap
    - `.actions`: button container, `display: flex`, `gap: 8px`, `justify-content: flex-end`
    - `.confirmButton`: green-tinted primary button
    - `.rejectButton`: outlined secondary button
  - [x] 5.4 Parameterize `ArtifactPreviewBubble` header label
    - In `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`, accept a new optional `headerLabel` prop (default `'Generated MISSION.MD'` for backward compatibility)
    - Use `headerLabel` in the header rendering instead of the hardcoded string
  - [x] 5.5 Add `isRoadmapPreview` type guard to `MessageBubble.tsx`
    - Add `isRoadmapPreview(sr)` type guard after the existing `isArtifactPreview`:
      ```typescript
      function isRoadmapPreview(
        sr: unknown
      ): sr is { type: 'roadmap-preview'; content: string } {
        if (sr == null || typeof sr !== 'object') return false;
        const obj = sr as Record<string, unknown>;
        return obj.type === 'roadmap-preview' && typeof obj.content === 'string';
      }
      ```
  - [x] 5.6 Add rendering branch for `roadmap-preview` in `MessageBubble.tsx`
    - Add a rendering check: `const showRoadmapPreview = isRoadmapPreview(structuredResponse);`
    - In the JSX, when `showRoadmapPreview && onConfirmArtifact`:
      ```typescript
      <RoadmapPreviewBubble
        jsonContent={(structuredResponse as any).content}
        onConfirm={onConfirmArtifact}
        onReject={onRejectArtifact!}
        isConfirming={isConfirmingArtifact || false}
        disabled={disabled || false}
      />
      ```
    - Import `RoadmapPreviewBubble` from `./RoadmapPreviewBubble`
  - [x] 5.7 Ensure component tests pass
    - Run ONLY the 8 tests written in 5.1
    - Verify rendering, JSON toggle, interaction behaviors, and type guard correctness

**Acceptance Criteria:**
- All 8 tests pass
- `RoadmapPreviewBubble` renders a readable initiative/epic summary with counts in the header
- "Show JSON" toggle switches between summary and raw JSON views
- Confirm/Reject buttons work correctly with loading and disabled states
- `ArtifactPreviewBubble` accepts an optional `headerLabel` prop
- `isRoadmapPreview` type guard correctly identifies `roadmap-preview` structured responses
- `MessageBubble` renders `RoadmapPreviewBubble` for roadmap-preview messages
- Existing `ArtifactPreviewBubble` behavior for mission previews is unaffected

---

#### Task Group 6: useChatThread Hook Generalization
**Dependencies:** Task Groups 4 (API client), 5 (components and type guards)
**Assignee Profile:** Frontend engineer (React hooks, TypeScript)

Generalizes `useChatThread` from mission-specific to task-agnostic artifact handling via a `TASK_ARTIFACT_MAP` constant. Replaces `missionExists` with `artifactExists` record, generalizes `generateArtifact`, `confirmArtifact`, and `selectTask` to use the mapping.

- [x] 6.0 Complete useChatThread hook generalization
  - [x] 6.1 Write 10 focused tests for hook generalization
    - Test that `TASK_ARTIFACT_MAP` contains entries for both `'product-manager--define-product'` and `'product-manager--roadmap'` with correct `artifactId`, `artifactName`, `artifactKey`, `completionMessage`, and `warningText`
    - Test `generateArtifact` for roadmap task: calls `postGenerateArtifact`, checks `result.artifactContent`, and appends an assistant message with `structuredResponse.type === 'roadmap-preview'` and `content` set to the roadmap JSON string
    - Test `generateArtifact` for mission task: continues to check `result.artifactContent` (with fallback to `result.missionMarkdown`) and appends `structuredResponse.type === 'artifact-preview'`
    - Test `generateArtifact` failure for roadmap task appends a system error message using the artifact name "Roadmap" (not hardcoded "Mission")
    - Test `confirmArtifact` for roadmap task: calls `postSaveArtifact` with `artifactId: 'roadmap'`, inserts completion chip with `artifactName: 'ROADMAP'` and `content: 'Roadmap complete.'`, and calls `onArtifactSaved` callback
    - Test `confirmArtifact` for mission task: continues to use `artifactId: 'mission-md'` and `artifactName: 'MISSION.MD'`
    - Test `selectTask` with `taskId === 'product-manager--roadmap'` and `artifactExists.roadmap === true` inserts a warning message: "A Roadmap already exists. Completing this conversation will update it."
    - Test `selectTask` with `taskId === 'product-manager--define-product'` and `artifactExists.mission === true` continues to show the mission warning
    - Test `selectTask` with `taskId === 'product-manager--roadmap'` and `artifactExists.roadmap === false` does NOT insert a warning message
    - Test that `UseChatThreadOptions` accepts `artifactExists?: Record<string, boolean>` and the hook uses it for warning logic
  - [x] 6.2 Define `TASK_ARTIFACT_MAP` constant
    - Add a constant in `useChatThread.ts` (or a separate `taskArtifactMap.ts` utility):
      ```typescript
      const TASK_ARTIFACT_MAP: Record<string, {
        artifactId: string;
        artifactName: string;
        artifactKey: string;
        completionMessage: string;
        warningText: string;
      }> = {
        'product-manager--define-product': {
          artifactId: 'mission-md',
          artifactName: 'MISSION.MD',
          artifactKey: 'mission',
          completionMessage: 'Product Definition complete.',
          warningText: 'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.',
        },
        'product-manager--roadmap': {
          artifactId: 'roadmap',
          artifactName: 'ROADMAP',
          artifactKey: 'roadmap',
          completionMessage: 'Roadmap complete.',
          warningText: 'A Roadmap already exists. Completing this conversation will update it.',
        },
      };
      ```
  - [x] 6.3 Replace `missionExists` with `artifactExists` in `UseChatThreadOptions`
    - Replace `missionExists?: boolean` (line 59) with `artifactExists?: Record<string, boolean>` (e.g., `{ mission: true, roadmap: false }`)
    - Update the ref: replace `missionExistsRef` with `artifactExistsRef` storing `options?.artifactExists`
  - [x] 6.4 Generalize `generateArtifact` function
    - Check `result.artifactContent` (generalized) instead of `result.missionMarkdown`, with fallback to `result.missionMarkdown` for backward compatibility
    - For roadmap task (`taskId === 'product-manager--roadmap'`): set `structuredResponse.type` to `'roadmap-preview'` and `content` to the roadmap JSON string
    - For mission task: continue using `structuredResponse.type === 'artifact-preview'` and `markdownContent`
    - Error messages use the artifact name from `TASK_ARTIFACT_MAP` rather than hardcoded "Mission"
  - [x] 6.5 Generalize `confirmArtifact` function
    - Look up `artifactId`, `artifactName`, and `completionMessage` from `TASK_ARTIFACT_MAP` using `artifactPreview.taskId`
    - Replace hardcoded `'mission-md'`, `'MISSION.MD'`, and `'Product Definition complete.'` with mapped values
    - Error messages use the mapped artifact name
  - [x] 6.6 Generalize `selectTask` warning logic
    - Replace `taskId === 'product-manager--define-product' && missionExistsRef.current` with:
      ```typescript
      const mapping = TASK_ARTIFACT_MAP[taskId];
      if (mapping && artifactExistsRef.current?.[mapping.artifactKey]) {
        // Insert warning using mapping.warningText
      }
      ```
  - [x] 6.7 Ensure hook generalization tests pass
    - Run ONLY the 10 tests written in 6.1
    - Verify both mission and roadmap paths work correctly through the generalized logic

**Acceptance Criteria:**
- All 10 tests pass
- `TASK_ARTIFACT_MAP` correctly maps both task IDs to their artifact metadata
- `generateArtifact` produces `roadmap-preview` type for roadmap tasks and `artifact-preview` for mission tasks
- `confirmArtifact` uses mapped `artifactId`, `artifactName`, and `completionMessage` for both task types
- `selectTask` shows the correct warning text for both task types when the artifact already exists
- `artifactExists` record replaces the single `missionExists` boolean
- Error messages use context-appropriate artifact names
- Mission flow continues to work identically to Increment 4

---

### Integration Layer

#### Task Group 7: Frontend Integration Wiring
**Dependencies:** Task Groups 5 (components), 6 (hook generalization)
**Assignee Profile:** Frontend engineer (React, TypeScript)

Wires the generalized hook and new components through `UnifiedChatPanel`, `DashboardView`, and transcript export. Replaces `missionExists` prop threading with `artifactExists` record throughout the component tree.

- [x] 7.0 Complete frontend integration wiring
  - [x] 7.1 Write 10 focused tests for integration wiring
    - Test `UnifiedChatPanel` passes `artifactExists` record to `useChatThread` options instead of `missionExists`
    - Test `UnifiedChatPanel` `handleDownloadTranscript` determines `taskId` and `artifactDescription` from the last completed task rather than hardcoding mission values
    - Test `UnifiedChatPanel` `handleDownloadTranscript` for roadmap task uses `'ROADMAP (initiative/epic structure)'` as the artifact description
    - Test `UnifiedChatPanel` `handleDownloadTranscript` for mission task continues to use `'agent-os/product/MISSION.MD'` as the artifact description
    - Test `DashboardView` passes `artifactExists={{ mission: ..., roadmap: ... }}` to `UnifiedChatPanel` derived from dashboard data
    - Test `DashboardView` derives `roadmap` existence from `data?.strategicFoundation?.roadmap?.state?.value > 0`
    - Test `buildTranscriptMarkdown` accepts `artifactDescription` parameter and uses it in the appendix section
    - Test `buildTranscriptMarkdown` with roadmap artifact description produces `> Saved artifact: ROADMAP (initiative/epic structure)`
    - Test `buildTranscriptMarkdown` with mission artifact description continues to produce `> Saved artifact: agent-os/product/MISSION.MD`
    - Test `UnifiedChatPanel` props include `artifactExists?: Record<string, boolean>` instead of `missionExists?: boolean`
  - [x] 7.2 Generalize `UnifiedChatPanel` props
    - In `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`, replace `missionExists?: boolean` (line 85) with `artifactExists?: Record<string, boolean>`
    - Pass `artifactExists` through to `useChatThread` options instead of `missionExists`
  - [x] 7.3 Generalize `handleDownloadTranscript` in `UnifiedChatPanel`
    - Determine `taskId` and `artifactDescription` from the last completed task (find the last completion chip message in `messages`) rather than hardcoding `'product-manager--define-product'`
    - For roadmap: use `'ROADMAP (initiative/epic structure)'` as artifact description plus the saved JSON content as the appendix
    - For mission: continue using `'agent-os/product/MISSION.MD'` as artifact description
    - Import and use updated `buildTranscriptMarkdown` with the `artifactDescription` parameter
  - [x] 7.4 Update `DashboardView` to pass `artifactExists` record
    - In `frontend/src/components/DashboardView/DashboardView.tsx`, replace `missionExists={...}` with:
      ```typescript
      artifactExists={{
        mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
        roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
      }}
      ```
    - Pass `artifactExists` to `UnifiedChatPanel` instead of `missionExists`
    - The `onArtifactSaved={fetchData}` callback remains unchanged -- re-fetches all dashboard data including real roadmap counts
  - [x] 7.5 Parameterize `buildTranscriptMarkdown` in `transcriptExport.ts`
    - Add a new parameter `artifactDescription: string` to `buildTranscriptMarkdown` (line 30) replacing the hardcoded `> Saved artifact: agent-os/product/MISSION.MD`
    - The appendix format becomes: `> Saved artifact: ${artifactDescription}\n\n${artifactContent}`
    - Mission callers pass `'agent-os/product/MISSION.MD'`; roadmap callers pass `'ROADMAP (initiative/epic structure)'`
    - For roadmap, include the tool result revision/id in the description if available from the save response
  - [x] 7.6 Verify CompletionChip reuse (no changes needed)
    - Confirm `CompletionChip` is already fully parameterized via props (`taskLabel`, `personaColor`, `artifactName`, `onDownloadTranscript`) and requires no changes
    - Roadmap usage passes: `taskLabel: 'Roadmap Complete'`, `personaColor: '#00897B'` (Product Manager), `artifactName: 'ROADMAP'`
  - [x] 7.7 Ensure integration wiring tests pass
    - Run ONLY the 10 tests written in 7.1
    - Verify prop threading, transcript parameterization, and dashboard data derivation

**Acceptance Criteria:**
- All 10 tests pass
- `UnifiedChatPanel` accepts `artifactExists` record and passes it to `useChatThread`
- `handleDownloadTranscript` is parameterized for both mission and roadmap tasks
- `DashboardView` derives both `mission` and `roadmap` existence from dashboard data
- `buildTranscriptMarkdown` uses the parameterized `artifactDescription` in the appendix
- `CompletionChip` requires zero changes and works for both mission and roadmap
- Existing mission flow wiring is unaffected

---

### Test Review

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7 (all implementation complete)
**Assignee Profile:** Test engineer / full-stack engineer

Reviews all tests written by prior task groups, identifies critical coverage gaps in the end-to-end roadmap bootstrap flow and the generalized artifact pipeline, and adds up to 24 additional strategic tests.

- [x] 8.0 Review all tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 3 tests from Task Group 1 (task definition and prompt validation)
    - Review the 8 tests from Task Group 2 (backend endpoint extensions)
    - Review the 3 tests from Task Group 3 (dashboard roadmap integration)
    - Review the 2 tests from Task Group 4 (API client generalization)
    - Review the 8 tests from Task Group 5 (RoadmapPreviewBubble + MessageBubble)
    - Review the 10 tests from Task Group 6 (useChatThread hook generalization)
    - Review the 10 tests from Task Group 7 (frontend integration wiring)
    - Total existing tests: 44
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's roadmap bootstrap flow and artifact pipeline generalization
    - Do NOT assess entire application test coverage
    - Prioritize the following workflows:
      - Full end-to-end roadmap: user selects Build Roadmap -> first-turn short-circuit -> answers questions -> phase=ready -> confirm -> extract proposedInitiatives -> roadmap preview -> confirm save -> completion chip appears -> dashboard updates with real counts
      - Full end-to-end mission (regression): existing mission flow still works through generalized pipeline
      - Error recovery: roadmap generation fails (no proposedInitiatives in thread) -> user sees error -> retries
      - Error recovery: roadmap save fails -> retry -> success
      - First-turn branching: existing roadmap vs. no roadmap produces correct canned responses
      - Sealed segment: roadmap questions in sealed segment are disabled
      - Re-run flow: artifactExists.roadmap warning appears when re-running roadmap task
      - Nested validation: malformed proposedInitiatives rejected by validateStructuredResponse
      - JSON toggle: roadmap preview Show JSON toggle works correctly
      - Transcript: roadmap transcript uses correct artifact description
  - [x] 8.3 Write up to 24 additional strategic tests to fill critical gaps
    - Possible gap areas (assess and add only where critical coverage is missing):
      - End-to-end: POST `/` first-turn with existing roadmap returns correct initiative/epic counts in summary text
      - End-to-end: POST `/generate` roadmap path scans messages in reverse and extracts from the LAST assistant message
      - End-to-end: POST `/save-artifact` roadmap completion chip is persisted to thread on disk
      - End-to-end: Dashboard re-fetch callback fires after successful roadmap `confirmArtifact`
      - Integration: `RoadmapPreviewBubble` handles malformed JSON gracefully (shows error, not crash)
      - Integration: `RoadmapPreviewBubble` renders empty initiatives array with "No initiatives found" message
      - Integration: `isRoadmapPreview` returns false for `artifact-preview` type (no false positives)
      - Integration: `generateArtifact` prefers `artifactContent` over `missionMarkdown` for mission task
      - Integration: `confirmArtifact` with unknown taskId (not in TASK_ARTIFACT_MAP) falls back gracefully
      - Integration: Phase detection triggers generation for roadmap task when `phase === 'ready'`
      - Integration: `selectTask` does NOT show warning when `artifactExists` is undefined
      - Integration: Inline context assembly includes all three sections (MISSION, EXISTING ROADMAP, EXISTING ROADMAP GUIDANCE) when roadmap exists
      - Integration: Inline context assembly includes only MISSION and EXISTING ROADMAP (no guidance) when no roadmap exists
      - Edge case: `validateStructuredResponse` accepts valid nested `proposedInitiatives` with `epics` sub-array
      - Edge case: `validateStructuredResponse` rejects `proposedInitiatives` items missing required `title` field
      - Edge case: POST `/generate` roadmap path handles assistant message with unparseable JSON content
      - Edge case: POST `/generate` roadmap path handles assistant message with valid JSON but no `proposedInitiatives` key
      - Edge case: `countRoadmapItems` returns correct counts for a roadmap with zero epics
      - Edge case: `buildTranscriptMarkdown` with roadmap includes the JSON artifact content in appendix
      - Edge case: `RoadmapPreviewBubble` Show JSON toggle preserves scroll position
      - Regression: Mission `generateArtifact` still produces `artifact-preview` type (not `roadmap-preview`)
      - Regression: Mission `confirmArtifact` still uses `'mission-md'` artifactId
      - Regression: Mission `selectTask` warning still works through generalized `TASK_ARTIFACT_MAP` lookup
      - Regression: Existing `postSaveArtifact` API client function is unchanged
    - Add a maximum of 24 new tests to fill identified gaps
    - Do NOT write exhaustive edge-case or stress tests
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 44-68 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 44-68 total)
- Critical end-to-end roadmap bootstrap workflows are covered
- Regression coverage confirms mission flow still works through generalized pipeline
- No more than 24 additional tests added when filling gaps
- Testing focused exclusively on this spec's roadmap bootstrap flow and artifact pipeline generalization
- Error handling, retry flows, and nested validation have at least basic coverage

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Task Definition + Prompt Config    (no dependencies)
    |
Task Group 2: Backend Endpoint Extensions        (depends on 1)
    |
Task Group 3: Backend Dashboard Integration      (depends on 2)
    |
Task Group 4: API Client Generalization          (depends on 2)
    |
    +---> Task Group 5: Frontend Components      (depends on 4)
    |
    +---> Task Group 6: Hook Generalization      (depends on 4, 5)
              |
              v
          Task Group 7: Integration Wiring       (depends on 5, 6)
              |
              v
          Task Group 8: Test Review              (depends on 1-7)
```

**Parallelizable work:**
- Task Groups 3 and 4 can begin as soon as Task Group 2 is complete (independent of each other)
- Task Group 5 (frontend components) can begin as soon as Task Group 4 is complete
- Task Group 6 depends on both Task Group 4 and 5 (needs API client types and component type guards)

**Sequential constraints:**
- Task Group 2 must complete before Task Groups 3 and 4 (they need the extended backend endpoints)
- Task Group 5 must complete before Task Group 6 (hook needs to know about `roadmap-preview` type)
- Task Group 6 must complete before Task Group 7 (integration wiring needs generalized hook)
- Task Group 7 must complete before Task Group 8 (test review covers all implementation)

---

## File Inventory

### New Files to Create
| File | Task Group | Purpose |
|------|-----------|---------|
| `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx` | 5 | Structured roadmap preview with initiative/epic list and Show JSON toggle |
| `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.module.css` | 5 | Styles for roadmap preview bubble |

### Existing Files to Modify
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/config/tasks/product-manager--roadmap.json` | 1 | Add `artifacts` array with `roadmap` entry |
| `gateway/src/config/prompts/product-manager.roadmap.task.md` | 1 | Append Jira awareness instruction block |
| `gateway/src/routes/chatV2.ts` | 2 | Add inline context assembly for roadmap in POST `/`; add first-turn short-circuit; extend POST `/generate` with artifactType branching; extend POST `/save-artifact` with adapter pattern; extend `validateStructuredResponse` with nested schema validation |
| `gateway/src/services/promptBuilder.ts` | 2 | Export `ROADMAP_EXISTS_INSTRUCTION_BLOCK` constant (if not already exported) |
| `gateway/src/routes/dashboardSummary.ts` | 3 | Add real roadmap existence and count data from Architecture Model Service |
| `frontend/src/api/chatV2Api.ts` | 4 | Add `artifactContent` to `postGenerateArtifact` response type |
| `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx` | 5 | Add optional `headerLabel` prop for parameterized header |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | 5 | Add `isRoadmapPreview` type guard; add rendering branch for `roadmap-preview` type |
| `frontend/src/hooks/useChatThread.ts` | 6 | Add `TASK_ARTIFACT_MAP`; replace `missionExists` with `artifactExists`; generalize `generateArtifact`, `confirmArtifact`, `selectTask` |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | 7 | Replace `missionExists` with `artifactExists` prop; generalize `handleDownloadTranscript` |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 7 | Pass `artifactExists={{ mission: ..., roadmap: ... }}` to `UnifiedChatPanel` |
| `frontend/src/utils/transcriptExport.ts` | 7 | Add `artifactDescription` parameter to `buildTranscriptMarkdown` |

### Existing Files NOT Modified
| File | Reason |
|------|--------|
| `gateway/src/routes/chat.ts` | Existing v1 endpoint remains untouched |
| `gateway/src/services/toolExecutor.ts` | `executeToolCall` already supports `save_roadmap_structure`; imported and reused, not modified |
| `gateway/src/services/architectureModelClient.ts` | `fetchProductSummary` is imported and reused, not modified |
| `gateway/src/services/roadmapSummaryBuilder.ts` | `buildRoadmapSummary`, `hasExistingRoadmap`, `countRoadmapItems` are reused as-is |
| `gateway/src/services/promptComposer.ts` | `composeSystemPrompt` already supports `resolvedContext` map; no changes needed |
| `gateway/src/services/contextResolvers.ts` | Context resolvers remain stubs; inline assembly bypasses them |
| `gateway/src/services/openaiClient.ts` | `sendChatRequest` is reused as-is |
| `gateway/src/services/threadStore.ts` | `getThread`, `appendMessage` are reused as-is |
| `gateway/src/types/tools.ts` | `save_roadmap_structure` tool definition already exists |
| `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` | V1 roadmap PM chat panel remains functional until Increment 10 |
| `frontend/src/components/UnifiedChat/CompletionChip.tsx` | Already fully parameterized; requires no changes |
| `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx` | Already accepts `disabled` prop; no changes needed |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | Already passes through artifact callback props from Increment 4; no changes needed |
| `frontend/src/config/personaConfig.ts` | Read-only usage for persona config lookups |

### Existing Files Referenced (read-only patterns)
| File | Purpose |
|------|---------|
| `gateway/src/routes/chat.ts` lines 1158-1167 | V1 `loadProjectFile` pattern for MISSION.MD disk read |
| `gateway/src/routes/chat.ts` lines 1180-1289 | V1 deterministic first-turn two-branch canned response with exact question text |
| `gateway/src/routes/chat.ts` lines 1368-1381 | V1 context injection pattern: `fetchProductSummary` + `buildRoadmapSummary` |
| `gateway/src/routes/chat.ts` lines 1435-1448 | V1 `proposedInitiatives` extraction: reverse scan, JSON parse, extract array |
| `gateway/src/services/promptBuilder.ts` line 201-203 | `ROADMAP_EXISTS_INSTRUCTION_BLOCK` constant for conditional context injection |
| `gateway/src/services/promptBuilder.ts` line 211-213 | `JIRA_AWARENESS_INSTRUCTION_BLOCK` content to append to task prompt file |
| `gateway/src/services/roadmapSummaryBuilder.ts` line 32 | `buildRoadmapSummary()` for L1/L2 text context |
| `gateway/src/services/roadmapSummaryBuilder.ts` line 92 | `hasExistingRoadmap()` for first-turn branching |
| `gateway/src/services/roadmapSummaryBuilder.ts` line 134 | `countRoadmapItems()` for dashboard metrics and summary text |
| `gateway/src/services/promptComposer.ts` line 76 | `composeSystemPrompt()` with `resolvedContext` and `=== SECTION_NAME ===` delimiters |
| `gateway/src/services/toolExecutor.ts` line 45 | `save_roadmap_structure: ['projectId', 'roadmapJson']` param mapping |
| `gateway/src/types/tools.ts` lines 338-359 | `SaveRoadmapStructureParams` interface for argument shape reference |
