# Specification: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End

## Goal

Wire the Architect's "Define Architecture" task end-to-end through the unified conversation engine (Increment 6 of 11): inline context injection (MISSION.MD + optional TECH-STACK.MD), architecture baseline generation via direct LLM call with jsonMode and corrective retry, a new ArchitecturePreviewBubble with entity counts and expandable sections, adapter-pattern save with defense-in-depth validation, completion chip, TASK_ARTIFACT_MAP entry, and dashboard integration replacing mock highLevelArchitecture values with real counts from fetchMetaModelSummary.

## User Stories

- As a user on the Dashboard Hub Chat, I want to @Architect, select "Define Architecture", conduct a discovery conversation with my product mission and tech stack context injected, review a generated architecture baseline preview with service/interface/entity counts, and confirm to save it so that my architecture baseline is persisted and the Dashboard reflects real architecture metrics.
- As a user who already has an architecture baseline, I want a warning that completing the conversation will replace the existing baseline, and after saving I want the Dashboard architecture card to show updated counts.

## Specific Requirements

**Task definition update (`gateway/src/config/tasks/architect--define-architecture.json`)**
- Change `"artifacts": []` (line 42) to contain one entry: `{ "artifactId": "architecture-baseline", "filename": "ARCHITECTURE_BASELINE", "tool": "save_architecture_baseline", "description": "Architecture baseline meta-model" }`
- Leave `contextNeeds: ["mission", "tech-stack"]` (line 40), `responseFormat` (lines 8-38), `taskPromptRef`, `phases`, and `mode` unchanged
- The existing prompt files `architect.identity.md` and `architect.define-architecture.task.md` require no changes

**Inline context assembly for architecture task in POST `/` handler (`gateway/src/routes/chatV2.ts`)**
- After the existing roadmap context block (line 1051) and before Step 6 `composeSystemPrompt` (line 1136), add an architecture-specific inline context block guarded by `task.id === 'architect--define-architecture'`
- Load MISSION.MD from disk using the same two-path fallback pattern already at lines 1024-1036: try `path.join(basePath, 'agent-os', 'product', 'MISSION.MD')`, fall back to lowercase `mission.md` -- inject into `resolvedContext['MISSION']`
- Load TECH-STACK.MD from disk using the same pattern: try `path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD')`, fall back to lowercase `tech-stack.md` -- inject into `resolvedContext['TECH STACK']`
- TECH-STACK.MD is OPTIONAL: if the file is not found, log at debug level and proceed without it (do NOT halt, unlike v1 which returns `SA_STANDARDS_MISSING_HALT_MESSAGE` at `chat.ts` line 1295)
- No deterministic first-turn short-circuit: the LLM handles the first turn naturally through the discovery prompt (unlike roadmap which has a canned first response at lines 1055-1132)

**Architecture baseline generation (`/generate` endpoint, `gateway/src/routes/chatV2.ts` lines 495-683)**
- Add a new `architecture-baseline` branch in the `/generate` handler, triggered when the derived `artifactType === 'architecture-baseline'` (from task registry lookup at line 551: `taskDef.artifacts[0].artifactId`)
- Build a conversation transcript from thread messages using the `buildConversationTranscript` pattern from `chat.ts` line 637: filter to messages for the current task, skip system messages, format as `"User: ...\nAssistant: ..."` dialogue
- Populate `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` (from `promptBuilder.ts` line 749): replace `{missionContent}` with resolved MISSION.MD content (or `'Not available'`), `{techStackContent}` with resolved TECH-STACK.MD content (or `'Not available'`), and `{conversationTranscript}` with the built transcript
- Build generation messages: `[{ role: 'system', content: populatedTemplate }, { role: 'user', content: 'Generate the architecture baseline JSON now.' }]` (matching v1 at `chat.ts` lines 1819-1822)
- Call `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 64000 }` (matching v1 at `chat.ts` line 1831)
- Validate: parse JSON, call `validateBaselineJsonShape` (from `chat.ts` line 586), call `ensureMinimumServices` (from `chat.ts` line 616)
- On first validation failure: append invalid response + `BASELINE_JSON_CORRECTIVE_INSTRUCTION` (`chat.ts` line 198) to messages, retry once with same LLM options (matching v1 at lines 1856-1866)
- On second failure: return `{ success: false, error: 'Architecture baseline generation failed after validation retry' }`
- On success: return `{ success: true, artifactContent: JSON.stringify(validatedJson) }`
- Import or replicate these from `chat.ts`: `validateBaselineJsonShape` (line 586, exported), `ensureMinimumServices` (line 616, exported), `buildConversationTranscript` (line 637, exported), `BASELINE_JSON_CORRECTIVE_INSTRUCTION` (line 198, currently module-private -- must be exported or replicated), `BASELINE_ARRAY_FIELDS` (line 318, currently module-private -- only needed if replicating `validateBaselineJsonShape`)
- Import `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` from `promptBuilder.ts` (line 749, already exported)

**Architecture baseline save (`/save-artifact` endpoint, `gateway/src/routes/chatV2.ts` lines 706-895)**
- Add a new `architecture-baseline` adapter branch in the `/save-artifact` handler, alongside the existing mission (line 787) and roadmap (line 774) adapters
- Defense-in-depth: before calling the MCP tool, parse `content` as JSON, run `validateBaselineJsonShape`, and run `ensureMinimumServices` as a final safety gate (even though `/generate` already validated)
- Call `executeToolCall` with tool name `'save_architecture_baseline'`, args `{ projectId, architectureBaselineJson: content }` (matching `toolExecutor.ts` line 44 required params and `chat.ts` lines 1895-1904)
- No `projectParentFolder`, `productName`, or `overwrite` needed (simpler than mission adapter)
- Completion chip: `artifactId: 'architecture-baseline'`, `artifactName: 'ARCHITECTURE_BASELINE'`, `content: 'Architecture Baseline complete.'`

**Frontend TASK_ARTIFACT_MAP entry (`frontend/src/hooks/useChatThread.ts` lines 58-82)**
- Add a third entry to `TASK_ARTIFACT_MAP` for `'architect--define-architecture'` with: `artifactId: 'architecture-baseline'`, `artifactName: 'ARCHITECTURE_BASELINE'`, `artifactKey: 'architecture'`, `completionMessage: 'Architecture Baseline complete.'`, `warningText: 'An Architecture Baseline already exists. Completing this conversation will replace it.'`, `previewType: 'architecture-preview'`
- The existing generalized pipeline (`generateArtifact` at line 276, `confirmArtifact` at line 357, `selectTask` at line 601) will automatically use this mapping with no structural changes

**ArchitecturePreviewBubble component (`frontend/src/components/UnifiedChat/`)**
- New file `ArchitecturePreviewBubble.tsx` modeled on `RoadmapPreviewBubble.tsx` (184 lines)
- Props: `{ content: string; onConfirm: () => void; onReject: () => void; isConfirming?: boolean; disabled?: boolean }`
- Parse `content` (JSON string) into the architecture baseline shape: `{ services: [], interfaces: [], interfaceEndpoints: [], logicalDataEntities: [], physicalDataEntities: [], businessLogic: [], dataMovements: [] }`
- Header with entity counts summary: e.g., "Generated Architecture Baseline -- 3 services, 5 interfaces, 4 data entities"
- Expandable/collapsible sections for each of the 7 entity arrays: show entity names with descriptions when available
- "Show JSON" toggle button switching between readable summary and raw pretty-printed JSON (same pattern as `RoadmapPreviewBubble.tsx` lines 121-161)
- Confirm/Reject buttons identical to `RoadmapPreviewBubble.tsx` lines 164-181: Confirm shows "Saving..." when `isConfirming`, both disabled when `disabled || isConfirming`
- New CSS module `ArchitecturePreviewBubble.module.css` following `RoadmapPreviewBubble.module.css` patterns
- `data-testid="architecture-preview-bubble"`

**MessageBubble updates (`frontend/src/components/UnifiedChat/MessageBubble.tsx`)**
- Add `isArchitecturePreview` type guard (after `isRoadmapPreview` at line 129): checks `structuredResponse.type === 'architecture-preview'` and `typeof obj.content === 'string'`
- Add `showArchitecturePreview` boolean (after `showRoadmapPreview` at line 170)
- Add rendering branch: when `showArchitecturePreview && onConfirmArtifact`, render `ArchitecturePreviewBubble` with `content`, `onConfirm`, `onReject`, `isConfirming`, `disabled` (insert between the roadmap-preview branch at line 243 and the completion-chip branch at line 259)
- Update the `showQuestions` guard (line 172) to also exclude `showArchitecturePreview`
- Import `ArchitecturePreviewBubble` from `./ArchitecturePreviewBubble`

**useChatThread generateArtifact architecture-preview routing (lines 276-349)**
- The existing mapping-driven `previewType` lookup at line 294 already handles this: when `previewType === 'architecture-preview'`, the code at line 298-308 needs an additional `else if` branch (or the existing `else` branch needs to become a generic handler that uses `previewType` and `content`)
- The `if (previewType === 'roadmap-preview')` block at line 298 currently falls through to the `else` (artifact-preview/markdown) branch for anything non-roadmap; for architecture-preview, the structuredResponse must use `{ type: 'architecture-preview', content: artifactContent }` (same shape as roadmap-preview)
- Add an explicit branch: `else if (previewType === 'architecture-preview') { structuredResponse = { type: 'architecture-preview', content: artifactContent } }`

**Dashboard integration -- real architecture counts (`gateway/src/routes/dashboardSummary.ts`)**
- After the existing roadmap block (lines 99-121), add an architecture block following the same try/catch pattern
- Call `fetchMetaModelSummary(projectId)` from `architectureModelClient.ts` (line 507, already exported)
- When the result is non-null and has entities: override mock `highLevelArchitecture` values with real counts: `services: metaModel.services.length`, `interfaces: metaModel.interfaces.length`, `dataStores: metaModel.data_entities.length`, `overall: services + interfaces + dataStores` (or similar aggregate), `applications: 0` (no applications field in `MetaModelSummaryDto` at `types/chat.ts` line 1156)
- When `fetchMetaModelSummary` returns null or throws: log warning and leave mock values unchanged (graceful degradation)
- Import `fetchMetaModelSummary` from `architectureModelClient.ts`

**DashboardView artifactExists wiring (`frontend/src/components/DashboardView/DashboardView.tsx` lines 513-523)**
- Add `architecture` key to the `artifactExists` record passed to `UnifiedChatPanel` (alongside existing `mission` and `roadmap`)
- Derive from real dashboard data: `architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0`
- After the mock override in `dashboardSummary.ts` ensures real data, a value > 0 means a baseline exists

**UnifiedChatPanel handleDownloadTranscript generalization (lines 216-244)**
- Extend the `artifactDescription` and `filename` resolution to handle the architecture task
- Add a mapping branch for `'architect--define-architecture'`: `artifactDescription = 'ARCHITECTURE_BASELINE (architecture meta-model)'`, `filename = 'architect-define-architecture-transcript.md'`
- The existing fallback-to-TASK_ARTIFACT_MAP approach works; just extend the conditional logic

**chatV2Api.ts (`frontend/src/api/chatV2Api.ts`)**
- No changes needed: `postGenerateArtifact` (line 281) already returns `{ success, artifactContent?, missionMarkdown?, error? }` which works for architecture
- `postSaveArtifact` (line 312) already accepts generic `{ threadKey, taskId, artifactId, content }` which works for architecture

**Transcript export (`frontend/src/utils/transcriptExport.ts`)**
- No changes needed: `buildTranscriptMarkdown` (line 36) already accepts `artifactDescription` parameter
- Architecture callers pass `'ARCHITECTURE_BASELINE (architecture meta-model)'`

## Existing Code to Leverage

**RoadmapPreviewBubble as structural template (`frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx`)**
- Direct template for `ArchitecturePreviewBubble`: same JSON parse pattern (line 65-75), same "Show JSON" toggle state (line 88), same Confirm/Reject button layout (lines 164-181), same CSS module structure
- Architecture version extends this with expandable/collapsible sections and displays 7 entity arrays instead of initiatives/epics
- `RoadmapPreviewBubble.module.css` provides the exact CSS class patterns to replicate

**V1 architecture baseline generation flow (`gateway/src/routes/chat.ts` lines 1809-1982)**
- The complete generation-validate-retry-save flow to replicate in `/generate` and `/save-artifact`: `buildConversationTranscript` (line 637), template population (lines 1813-1817), `sendChatRequest` with `jsonMode: true, temperature: 0.2, maxTokens: 64000` (line 1831), JSON parse + `validateBaselineJsonShape` + `ensureMinimumServices` (lines 1841-1847), corrective retry with `BASELINE_JSON_CORRECTIVE_INSTRUCTION` (lines 1856-1866), and `executeTool('save_architecture_baseline', ...)` (lines 1895-1904)
- Key difference: v2 splits generation and save into separate endpoints with user-confirmed preview step in between

**Generalized artifact pipeline from Increments 4-5 (`useChatThread.ts` + `chatV2.ts` + `MessageBubble.tsx`)**
- The `TASK_ARTIFACT_MAP` (line 58), `generateArtifact` (line 276), `confirmArtifact` (line 357), `selectTask` (line 601), `artifactExists` record (line 96), and `previewType`-driven rendering are all already generalized; only a new map entry and a new preview type branch are needed
- The `/generate` and `/save-artifact` endpoints already use adapter-pattern branching (lines 554, 774) -- adding a third branch follows the established pattern

**Inline context assembly pattern (`gateway/src/routes/chatV2.ts` lines 1019-1051)**
- The roadmap block demonstrates the exact pattern to follow: check `task.id`, load files from disk with case-insensitive fallback, inject into `resolvedContext`, wrap in try/catch for graceful degradation
- Architecture block reuses the same MISSION.MD loading (lines 1024-1036) and adds a parallel TECH-STACK.MD loading

**Dashboard summary real-data override pattern (`gateway/src/routes/dashboardSummary.ts` lines 82-121)**
- The MISSION.MD file existence check (lines 84-97) and roadmap count override (lines 102-121) provide the exact pattern: call a service, override mock DTO values, wrap in try/catch with warning log on failure
- Architecture block follows the same structure, calling `fetchMetaModelSummary` instead of `fetchProductSummary`

**executeToolCall and save_architecture_baseline wiring (`gateway/src/services/toolExecutor.ts`)**
- `save_architecture_baseline` is already registered at line 31 (endpoint) and line 44 (required params: `['projectId', 'architectureBaselineJson']`)
- `executeToolCall` (line 205) is reused directly with no modifications, same as mission and roadmap adapters

## Out of Scope

- Streaming responses (v2 returns full responses, not SSE)
- Conversation summarization for context window management (Increment 11)
- Side panel integration (Increments 8-9)
- Removal of the v1 `SolutionArchitectChatPanel.tsx` or any v1 chat route code (Increment 10)
- Implement screen changes of any kind
- Generating TECH-STACK.MD / standards (Increment 7) -- TECH-STACK.MD is loaded if it exists but not created
- Diagram rendering from the architecture baseline
- Diff/merge of architecture baselines (comparing old vs. new before overwrite)
- Per-entity deep-linking from the preview (e.g., clicking a service name to navigate to its detail in the MetaModel screen)
- Real context resolver classes (deferred to Increments 8-9); context assembly remains inline in the route handler
- Deterministic first-turn short-circuit for the SA task (not needed -- the LLM handles first turn naturally via the discovery prompt)
- Halting when TECH-STACK.MD is missing (v1 behavior at `chat.ts` line 1295 is intentionally not replicated; TECH-STACK.MD is optional)
- `epicsCompletedCount` or other unrelated dashboard metric real data
- Multi-artifact batch generation
- Fine-grained permissions or role-based access control
