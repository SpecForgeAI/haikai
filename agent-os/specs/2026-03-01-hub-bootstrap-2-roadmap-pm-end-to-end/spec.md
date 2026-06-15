# Specification: Hub Bootstrap 2 -- Roadmap (PM) End-to-End

## Goal

Wire the second bootstrap conversation flow through the Increments 1-4 infrastructure: a PM "Build Roadmap" discovery conversation with inline context injection, deterministic first-turn short-circuit, artifact extraction from thread history (no LLM generation step), a structured roadmap preview with Show JSON toggle, adapter-pattern save via the existing `save_roadmap_structure` MCP tool, completion chip with parameterized transcript, and real roadmap existence/counts on the Dashboard -- generalizing the Increment 4 mission-specific code into a task-agnostic artifact pipeline that both mission and roadmap share.

## User Stories

- As a user on the Dashboard Hub Chat, I want to @PM, select "Build Roadmap", answer discovery questions with MISSION.md and existing roadmap context injected, review a generated roadmap preview of initiatives and epics, and confirm to save it so that my roadmap is persisted and the Dashboard reflects initiative/epic counts.
- As a user who already has a roadmap, I want the conversation to start at "outcome_alignment" with an existing-roadmap summary and "update" language so that I refine rather than recreate.

## Specific Requirements

**Task definition update (`gateway/src/config/tasks/product-manager--roadmap.json`)**
- Add an `artifacts` array entry: `{ "artifactId": "roadmap", "filename": "ROADMAP", "tool": "save_roadmap_structure", "description": "Roadmap structure with initiatives and epics" }`
- The existing `responseFormat` (7 required fields including nested `proposedInitiatives` with `epics` sub-array), `contextNeeds: ["mission", "existing-roadmap"]`, and `taskPromptRef` all remain unchanged
- This mirrors the pattern in `product-manager--define-product.json` which has `artifacts: [{ "artifactId": "mission-md", ... }]`

**Task prompt update (`gateway/src/config/prompts/product-manager.roadmap.task.md`)**
- Append the content of `JIRA_AWARENESS_INSTRUCTION_BLOCK` (from `gateway/src/services/promptBuilder.ts` line 211-213) as a permanent section at the end of the .md file
- The block reads: "If the user mentions having a Jira roadmap... respond with: 'Jira import is coming in a future increment...'"
- `ROADMAP_EXISTS_INSTRUCTION_BLOCK` is NOT added to the .md file; it remains a conditional suffix injected by the pipeline (see context injection requirement below)

**Inline context assembly in POST `/` handler (`gateway/src/routes/chatV2.ts`, lines 822-836)**
- After the existing stub-resolver loop (Step 5, lines 822-836) and before `composeSystemPrompt` (Step 6, line 839), add a roadmap-specific inline context block that executes when `task.id === 'product-manager--roadmap'`
- Read MISSION.MD from disk using the `loadProjectFile` pattern from v1 (`chat.ts` lines 1158-1167): `loadProjectFile(config.conversationPersistBasePath, 'agent-os/product/MISSION.MD', 'agent-os/product/mission.md', requestId)` -- add the result to `resolvedContext['MISSION']`
- Call `fetchProductSummary(threadKey.projectId)` from `architectureModelClient.ts` (line 314), then `buildRoadmapSummary(productSummary)` from `roadmapSummaryBuilder.ts` (line 32) -- add the result to `resolvedContext['EXISTING ROADMAP']`
- If `hasExistingRoadmap(productSummary)` returns true, append `ROADMAP_EXISTS_INSTRUCTION_BLOCK` (from `promptBuilder.ts` line 201-203) to `resolvedContext['EXISTING ROADMAP GUIDANCE']` -- this tells the LLM to skip `roadmap_existence_check`
- These context sections flow into `composeSystemPrompt()` via the existing Layer 3 mechanism (`=== SECTION_NAME ===` delimiters at `promptComposer.ts` line 91)
- Import `loadProjectFile` from `chat.ts` or replicate its `fs.readFile` + fallback pattern inline; import `fetchProductSummary` from `architectureModelClient.ts`; import `buildRoadmapSummary`, `hasExistingRoadmap`, `countRoadmapItems` from `roadmapSummaryBuilder.ts`; import `ROADMAP_EXISTS_INSTRUCTION_BLOCK` from `promptBuilder.ts` (must be exported)

**Deterministic first-turn short-circuit in POST `/` handler**
- Before the system prompt composition (Step 6) and LLM call (Step 8), detect first turn for the roadmap task: `task.id === 'product-manager--roadmap'` AND `thread.messages.filter(m => m.taskId === task.id).length === 0`
- Call `fetchProductSummary(threadKey.projectId)` and `hasExistingRoadmap()` to determine the branch
- If roadmap exists: build a canned `RoadmapPmResponse` with `phase: "questions"`, `section: "outcome_alignment"`, 3 canned questions (matching v1 at `chat.ts` lines 1198-1210), summary text with initiative/epic counts from `countRoadmapItems()`, and empty `proposedInitiatives/assumptions/openItems`
- If no roadmap: build a canned response with `section: "roadmap_existence_check"`, 2 canned questions (matching v1 at `chat.ts` lines 1245-1256), and appropriate summary
- Persist the user message and canned assistant message to the thread via `appendMessage()`, then return a `ChatV2Response` with the canned `structuredResponse` -- skip the LLM call entirely
- This replaces the v1 `isFirstTurnRoadmapPm()` check at `chat.ts` line 1181

**Extend POST `/generate` endpoint with artifactType branching (`gateway/src/routes/chatV2.ts`, lines 395-536)**
- Accept a new optional field `artifactType` in the request body (e.g., `'mission'` or `'roadmap'`), or derive it from `taskId` via task registry lookup of `task.artifacts[0].artifactId`
- Mission path (existing, `artifactType === 'mission'` or `taskId === 'product-manager--define-product'`): preserve the current LLM-based generation with `MISSION_GENERATION_PROMPT_TEMPLATE` unchanged
- Roadmap path (`artifactType === 'roadmap'` or `taskId === 'product-manager--roadmap'`): do NOT call the LLM; instead scan `thread.messages` in reverse to find the last assistant message, parse its JSON content, extract `proposedInitiatives` array (replicating the v1 pattern at `chat.ts` lines 1435-1448); return `{ success: true, artifactContent: JSON.stringify({ initiatives: proposedInitiatives || [] }) }`
- Generalize the response field from `missionMarkdown` to `artifactContent` -- the mission path should also return `artifactContent` (set equal to `missionMarkdown`) for backward compatibility; keep `missionMarkdown` in the response as a deprecated alias during this increment
- On failure (no assistant message found, no `proposedInitiatives` in parsed JSON): return `{ success: false, error: 'descriptive message' }`

**Extend POST `/save-artifact` endpoint with adapter pattern (`gateway/src/routes/chatV2.ts`, lines 557-719)**
- Accept a new optional field `artifactType` in the request body, or derive from `taskId` via task registry lookup
- Mission adapter (existing path): maps `content` to `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }` and calls `executeToolCall` with `'save_product_artifacts'`; completion chip uses `artifactId: 'mission-md'`, `artifactName: 'MISSION.MD'`, `content: 'Product Definition complete.'`
- Roadmap adapter (new path): maps `content` to `{ projectId, roadmapJson: content }` and calls `executeToolCall` with `'save_roadmap_structure'`; completion chip uses `artifactId: 'roadmap'`, `artifactName: 'ROADMAP'`, `content: 'Roadmap complete.'`
- The adapter selection is a simple `if/else` or `switch` on the derived `artifactType`, not a plugin system
- The roadmap adapter does NOT need `projectParentFolder`, `productName`, or `overwrite` -- only `projectId` and `roadmapJson` as defined in `gateway/src/types/tools.ts` lines 338-359
- The `executeToolCall` function in `toolExecutor.ts` (line 45: `save_roadmap_structure: ['projectId', 'roadmapJson']`) already supports this tool with no changes needed

**Extend `validateStructuredResponse` for nested roadmap schema (`gateway/src/routes/chatV2.ts`, lines 68-160)**
- Currently only checks top-level field presence and type; does NOT recurse into array item schemas
- Add one level of nested validation for `array` type fields when the schema includes `items.type === 'object'` and `items.properties`
- For roadmap: verify `proposedInitiatives` array items are objects with a required `title` string field; verify `epics` sub-array items (when present) are objects with a required `title` string field
- This prevents malformed responses like `proposedInitiatives: [42, "string"]` from passing validation
- Keep the extension generic (driven by the schema's `items.properties` definition) so future tasks benefit

**Generalize `useChatThread` hook (`frontend/src/hooks/useChatThread.ts`)**
- Replace `missionExists?: boolean` in `UseChatThreadOptions` (line 59) with `artifactExists?: Record<string, boolean>` (e.g., `{ mission: true, roadmap: false }`)
- Build a task-to-artifact mapping constant: `{ 'product-manager--define-product': { artifactId: 'mission-md', artifactName: 'MISSION.MD', artifactKey: 'mission', completionMessage: 'Product Definition complete.', warningText: 'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.' }, 'product-manager--roadmap': { artifactId: 'roadmap', artifactName: 'ROADMAP', artifactKey: 'roadmap', completionMessage: 'Roadmap complete.', warningText: 'A Roadmap already exists. Completing this conversation will update it.' } }`
- `generateArtifact` (line 238): check `result.artifactContent` (generalized) instead of `result.missionMarkdown`; for roadmap, the `structuredResponse` should use a new type `'roadmap-preview'` instead of `'artifact-preview'` (or a single type with an `artifactType` discriminator); set `artifactPreview.content` to the roadmap JSON string
- `confirmArtifact` (line 297): look up `artifactId`, `artifactName`, and `completionMessage` from the task-to-artifact mapping using `artifactPreview.taskId`; replace hardcoded `'mission-md'`, `'MISSION.MD'`, and `'Product Definition complete.'`
- `selectTask` (line 534): replace `taskId === 'product-manager--define-product' && missionExistsRef.current` with a generic lookup: `const mapping = TASK_ARTIFACT_MAP[taskId]; if (mapping && artifactExistsRef.current?.[mapping.artifactKey]) { insert warning using mapping.warningText }`
- Error messages in `generateArtifact` and `confirmArtifact` should use the artifact name from the mapping rather than hardcoded "Mission" or "MISSION.md"

**Generalize `postGenerateArtifact` response in `chatV2Api.ts` (`frontend/src/api/chatV2Api.ts`, lines 280-296)**
- Update the return type to include `artifactContent?: string` alongside the existing `missionMarkdown?: string` for backward compatibility
- The hook should prefer `result.artifactContent` and fall back to `result.missionMarkdown`

**Roadmap preview variant in `ArtifactPreviewBubble` (`frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`)**
- Parameterize the header label: accept a new `headerLabel` prop (default `'Generated MISSION.MD'` for backward compat); roadmap passes `'Generated Roadmap'`
- Add a second rendering mode for structured roadmap JSON: when `artifactType === 'roadmap'` (new prop), parse the `markdownContent` (which is actually a JSON string for roadmap) and render a readable summary: list of initiatives with nested epics showing titles and descriptions, plus initiative/epic counts in the header
- Add an optional "Show JSON" toggle button that switches between the readable summary view and raw JSON view
- Confirm/Reject buttons remain identical to the mission variant
- Alternatively, create a separate `RoadmapPreviewBubble` component that is rendered by `MessageBubble` when `structuredResponse.type === 'roadmap-preview'`; this avoids overloading `ArtifactPreviewBubble` with conditional logic

**MessageBubble type guard update (`frontend/src/components/UnifiedChat/MessageBubble.tsx`)**
- Add a new type guard `isRoadmapPreview(sr)` that checks for `structuredResponse.type === 'roadmap-preview'` (or extend `isArtifactPreview` to also check for an `artifactType` field)
- Add a rendering branch: when `isRoadmapPreview` is true, render the roadmap preview variant with `onConfirm`/`onReject` callbacks wired the same as the mission preview

**Dashboard summary real roadmap data (`gateway/src/routes/dashboardSummary.ts`)**
- After the existing MISSION.MD check (lines 78-94), add a roadmap existence block following the same pattern
- Call `fetchProductSummary(projectId)` from `architectureModelClient.ts`; call `hasExistingRoadmap()` and `countRoadmapItems()` from `roadmapSummaryBuilder.ts`
- Override mock values: `dto.strategicFoundation.roadmap.state = { label: 'State', value: roadmapExists ? 100 : 0 }`, `dto.strategicFoundation.roadmap.initiativesCount = { label: 'Initiatives', value: initiativeCount }`, `dto.strategicFoundation.roadmap.epicsCount = { label: 'Epics', value: epicCount }`
- Wrap in try/catch: on failure (service unavailable), log a warning and leave mock values unchanged (graceful degradation)
- Import `fetchProductSummary` from `architectureModelClient.ts`; import `hasExistingRoadmap`, `countRoadmapItems` from `roadmapSummaryBuilder.ts`

**Generalize `DashboardView` artifact existence prop (`frontend/src/components/DashboardView/DashboardView.tsx`, lines 507-513)**
- Replace `missionExists={...}` with `artifactExists={{ mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1, roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0 }}`
- Pass `artifactExists` to `UnifiedChatPanel` instead of `missionExists`
- The `onArtifactSaved={fetchData}` callback remains unchanged -- it re-fetches all dashboard data which now includes real roadmap counts

**Generalize `UnifiedChatPanel` props (`frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`)**
- Replace `missionExists?: boolean` (line 85) with `artifactExists?: Record<string, boolean>`
- Pass `artifactExists` through to `useChatThread` options
- Generalize `handleDownloadTranscript` (line 206-211): determine `taskId` and `artifactDescription` from the last completed task rather than hardcoding `'product-manager--define-product'`; for roadmap, use `'Saved artifact: ROADMAP (initiative/epic structure)'` plus the saved JSON content as the appendix

**Transcript export parameterization (`frontend/src/utils/transcriptExport.ts`)**
- Add a new parameter `artifactDescription: string` to `buildTranscriptMarkdown` (line 30) replacing the hardcoded `> Saved artifact: agent-os/product/MISSION.MD`
- Mission callers pass `'agent-os/product/MISSION.MD'`; roadmap callers pass `'ROADMAP (initiative/epic structure)'`
- The appendix format becomes: `> Saved artifact: ${artifactDescription}\n\n${artifactContent}`
- For roadmap, include the tool result revision/id in the description if available from the save response

**CompletionChip reuse**
- `CompletionChip` is already fully parameterized via props (`taskLabel`, `personaColor`, `artifactName`, `onDownloadTranscript`) and requires no changes
- Roadmap usage passes: `taskLabel: 'Roadmap Complete'`, `personaColor: '#00897B'` (Product Manager), `artifactName: 'ROADMAP'`

## Existing Code to Leverage

**Increment 4 artifact pipeline (`useChatThread` + `chatV2.ts` endpoints + `ArtifactPreviewBubble` + `CompletionChip`)**
- The entire generate-preview-confirm-save-seal pipeline from Increment 4 is the foundation; every component and endpoint is being generalized rather than duplicated
- `generateArtifact`, `confirmArtifact`, `rejectArtifact` in `useChatThread.ts` (lines 238-499) are extended with task-to-artifact mapping
- `ArtifactPreviewBubble.tsx` and `CompletionChip.tsx` are parameterized; `CompletionChip` requires zero changes

**V1 roadmap flow patterns in `gateway/src/routes/chat.ts`**
- Deterministic first-turn (lines 1180-1289): two-branch canned response with exact question text, summary format, and persistence pattern to replicate
- `proposedInitiatives` extraction (lines 1435-1448): reverse scan of messages array, JSON parse, extract array -- replicate in `/generate` roadmap branch
- MISSION.MD loading (lines 1158-1167): `loadProjectFile` with fallback filename pattern
- Context injection (lines 1368-1381): `fetchProductSummary` + `buildRoadmapSummary` for existing roadmap context

**Roadmap summary builder (`gateway/src/services/roadmapSummaryBuilder.ts`)**
- `buildRoadmapSummary()` (line 32): produces L1/L2 text for prompt context injection
- `hasExistingRoadmap()` (line 92): boolean check for first-turn branching and `ROADMAP_EXISTS_INSTRUCTION_BLOCK` conditional
- `countRoadmapItems()` (line 134): returns `{ initiativeCount, epicCount }` for dashboard metrics and first-turn summary text
- All three are existing, tested, and reusable directly with no modifications

**Prompt composition pipeline (`gateway/src/services/promptComposer.ts`)**
- `composeSystemPrompt()` (line 76) accepts `resolvedContext: Record<string, string>` and injects as `=== SECTION_NAME ===` blocks at Layer 3 (line 91)
- The inline context assembly populates this map manually for mission, existing-roadmap, and existing-roadmap-guidance sections
- Context resolvers in `contextResolvers.ts` remain as stubs; the manual population bypasses them

**`executeToolCall` in `gateway/src/services/toolExecutor.ts` (line 205)**
- Already supports `save_roadmap_structure` with required params `['projectId', 'roadmapJson']` (line 45)
- No changes needed to `toolExecutor.ts` -- the `/save-artifact` adapter just passes different args

## Out of Scope

- Streaming responses (v2 returns full responses, not SSE)
- Conversation summarization for context window management (Increment 11)
- Side panel PM usage on the Roadmap screen (Increment 9)
- Removal of the v1 `RoadmapPmChatPanel.tsx` (Increment 10); it remains fully functional alongside v2
- Jira import execution (only the awareness instruction text telling users it is coming)
- Implement screen changes of any kind
- Rich roadmap visualization (Gantt charts, timeline views) -- a simple initiative/epic list is sufficient for preview
- Multi-artifact batch generation (generating multiple artifacts in a single flow)
- Roadmap diffing/merge (comparing old vs. new roadmap before overwrite)
- Fine-grained permissions or role-based access control
- Real context resolver classes (deferred to Increment 8-9); context assembly remains inline
- Version diff/merge UI for comparing old and new roadmaps
- Heavy markdown rendering library upgrades
- `epicsCompletedCount` real data -- mock value retained for now
