# Spec Requirements: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End

## Initial Description

Increment 6: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End

This is Increment 6 of the 11-increment unified conversation engine plan. Increments 1-5 are complete and verified. This increment wires the Solution Architect's "Baseline Architecture" task through the unified conversation engine, including task registration, context injection (MISSION.MD + TECH-STACK.MD content), artifact preview/confirm/save, completion chip, and dashboard integration.

## Requirements Discussion

### First Round Questions

**Q1:** The SA task config (`architect--define-architecture.json`) declares `contextNeeds: ["mission", "tech-stack"]`, but the context resolvers are currently stubs returning empty strings. The Increment 5 roadmap spec used inline context assembly in `chatV2.ts` (Step 5b) to bypass the stubs for `mission` and `existing-roadmap`. I assume this increment should follow the same inline context assembly pattern -- loading MISSION.MD and TECH-STACK.MD from disk inside the POST handler when `task.id === 'architect--define-architecture'`, injecting them into `resolvedContext['MISSION']` and `resolvedContext['TECH STACK']`. Real context resolvers remain deferred to Increment 8-9. Is that correct?

**Answer:** Yes, follow the same inline context assembly pattern in chatV2.ts for now (load MISSION.MD and TECH-STACK.MD if present and inject into resolvedContext), with real resolvers deferred.

**Q2:** The v1 SA flow has a standards-missing short-circuit (chat.ts line 1295): if TECH-STACK.MD is not found, it returns a deterministic halt message (`SA_STANDARDS_MISSING_HALT_MESSAGE = 'Project standards have not been generated. Please generate standards before proceeding.'`). Should we replicate this short-circuit in v2? In the 11-increment plan, TECH-STACK.MD generation is Increment 7 (not yet built), so in practice TECH-STACK.MD might not exist during this increment's testing. Should we: (a) replicate the halt and require TECH-STACK.MD to exist, (b) make TECH-STACK.MD optional (proceed without it, inject if available), or (c) something else?

**Answer:** Choose (b): TECH-STACK.MD is optional for now -- proceed without it and inject when available (do not halt).

**Q3:** The v1 SA baseline generation flow (`chat.ts` lines 1809-1982) uses a direct `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` with `{missionContent}`, `{techStackContent}`, and `{conversationTranscript}` placeholders, calls `sendChatRequest` with `jsonMode: true, temperature: 0.2, maxTokens: 64000`, performs JSON validation with corrective retry (`BASELINE_JSON_CORRECTIVE_INSTRUCTION`), then calls `executeTool('save_architecture_baseline', ...)` directly -- no tool-call forcing like the mission generation uses. The v2 `/generate` endpoint for mission uses forced tool calls. I assume the architecture `/generate` path should use the v1 pattern (direct LLM call with jsonMode, JSON validation with corrective retry, return the validated JSON as `artifactContent`), since the architecture schema is complex and not tool-call-shaped. Is that correct?

**Answer:** Yes: use direct LLM call with jsonMode, strict JSON schema validation, and one corrective retry before preview (no tool-call forcing).

**Q4:** The architecture baseline generation produces a JSON blob (services, interfaces, endpoints, data entities, business logic, data movements), not markdown. The `ArtifactPreviewBubble` currently supports markdown rendering (for mission) and structured JSON rendering (for roadmap's `RoadmapPreviewBubble` with initiative/epic list + Show JSON toggle). I assume we need a new architecture preview variant (e.g., `ArchitecturePreviewBubble` or `structuredResponse.type === 'architecture-preview'`) that renders a readable summary of the baseline (service count, interface count, data entity count, etc. with expandable sections) plus a "Show JSON" toggle, similar to how the roadmap preview works. Is that correct, or is a simpler preview sufficient (e.g., just entity counts + raw JSON toggle)?

**Answer:** Create an ArchitecturePreviewBubble that shows key counts (services/interfaces/entities) with expandable sections and a "Show JSON" toggle (parallel to RoadmapPreviewBubble).

**Q5:** The SA task config has `"artifacts": []` (empty). Following the pattern from Increments 4 and 5, I assume we need to add an artifact entry like: `{ "artifactId": "architecture-baseline", "filename": "ARCHITECTURE_BASELINE", "tool": "save_architecture_baseline", "description": "Architecture baseline meta-model" }`. And correspondingly, a new entry in the frontend's `TASK_ARTIFACT_MAP` at `useChatThread.ts`. Is that correct?

**Answer:** Yes, add an artifact entry for architecture-baseline and wire it through the same generic artifact pipeline (frontend TASK_ARTIFACT_MAP + backend artifactType adapter).

**Q6:** For the `/save-artifact` adapter, the `save_architecture_baseline` tool requires `{ projectId, architectureBaselineJson }` (per `toolExecutor.ts` line 44). The v1 flow also calls `ensureMinimumServices()` and `validateBaselineJsonShape()` before saving. Should the v2 `/save-artifact` adapter replicate these validation/safety checks on the `content` before calling `executeToolCall`, or should we rely on the validation done during the `/generate` step (since the content is already validated there before being returned for preview)?

**Answer:** Replicate ensureMinimumServices() and validateBaselineJsonShape() in the v2 save adapter as a final safety gate (defense-in-depth even after /generate validation).

**Q7:** For dashboard integration, the `highLevelArchitecture` section currently shows mock data (services, interfaces, applications, dataStores counts). The architecture-model-service has a `fetchMetaModelSummary(projectId)` function that returns real `services[]`, `data_entities[]`, `interfaces[]`, and `relationships[]`. I assume this increment should override the mock `highLevelArchitecture` values with real counts from `fetchMetaModelSummary`, similar to how Increment 5 overrode the roadmap counts. Additionally, `artifactExists` in `DashboardView` should include an `architecture` key (e.g., `architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0`). Is that correct, or should we use a different detection mechanism for architecture existence (e.g., a dedicated flag or file check)?

**Answer:** Yes, replace mock highLevelArchitecture with real counts from fetchMetaModelSummary() and add artifactExists.architecture based on a real persisted baseline/meta-model presence (not on >0 mock values).

**Q8:** The v1 SA flow does NOT have a deterministic first-turn short-circuit like the roadmap flow does. The SA flow starts with `document_intake` and proceeds through discovery sections normally. I assume we should NOT add a first-turn short-circuit for the SA task, and should let the LLM handle the first turn naturally. Is that correct?

**Answer:** Correct: no deterministic first-turn shortcut -- let the LLM handle the first turn naturally.

**Q9:** Is there anything specifically out of scope that I should be aware of beyond the standard exclusions carried over from Increments 4 and 5 (no streaming, no summarization, no side panels, no v1 removal, no implement screen changes)?

**Answer:** Also out of scope: generating TECH-STACK.MD/standards in this increment, any diagram rendering, diff/merge of baselines, and per-entity deep-linking from the preview.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ArtifactPreviewBubble (mission markdown preview) - Path: `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`
- Feature: RoadmapPreviewBubble (structured JSON preview with Show JSON toggle) - Path: `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx`
- Feature: CompletionChip (fully parameterized, likely zero changes needed) - Path: `frontend/src/components/UnifiedChat/CompletionChip.tsx`
- Feature: TASK_ARTIFACT_MAP constant (task-to-artifact mapping) - Path: `frontend/src/hooks/useChatThread.ts` (lines 58-82)
- Feature: chatV2 /generate endpoint with artifactType branching - Path: `gateway/src/routes/chatV2.ts` (lines 495-683)
- Feature: chatV2 /save-artifact endpoint with adapter pattern - Path: `gateway/src/routes/chatV2.ts` (lines 706-895)
- Feature: Inline context assembly pattern (roadmap precedent) - Path: `gateway/src/routes/chatV2.ts` (lines 1019-1051)
- Feature: v1 SA baseline generation flow (full reference) - Path: `gateway/src/routes/chat.ts` (lines 1798-2010)
- Feature: ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE - Path: `gateway/src/services/promptBuilder.ts` (line 749)
- Feature: validateBaselineJsonShape + ensureMinimumServices + buildConversationTranscript - Path: `gateway/src/routes/chat.ts` (lines 586-648)
- Feature: BASELINE_ARRAY_FIELDS constant - Path: `gateway/src/routes/chat.ts` (lines 318-326)
- Feature: BASELINE_JSON_CORRECTIVE_INSTRUCTION - Path: `gateway/src/routes/chat.ts` (line 198)
- Feature: formatBaselineSuccessMessage (entity count formatting) - Path: `gateway/src/routes/chat.ts` (lines 211-235)
- Feature: save_architecture_baseline tool wiring - Path: `gateway/src/services/toolExecutor.ts` (lines 31, 44)
- Feature: save_architecture_baseline tool definition (params) - Path: `gateway/src/types/tools.ts` (lines 159-164, 317-330)
- Feature: fetchMetaModelSummary (returns services/entities/interfaces/relationships) - Path: `gateway/src/services/architectureModelClient.ts` (line 507)
- Feature: Dashboard summary route with real-data overrides - Path: `gateway/src/routes/dashboardSummary.ts`
- Feature: Dashboard mock service (HLA mock values to override) - Path: `gateway/src/services/dashboardSummaryMockService.ts`
- Feature: DashboardView artifactExists wiring to UnifiedChatPanel - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (lines 513-523)
- Feature: MessageBubble type guards and structured response routing - Path: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- Feature: Architect task config (define-architecture) - Path: `gateway/src/config/tasks/architect--define-architecture.json`
- Feature: Architect identity prompt - Path: `gateway/src/config/prompts/architect.identity.md`
- Feature: Architect define-architecture task prompt - Path: `gateway/src/config/prompts/architect.define-architecture.task.md`
- Feature: Prompt composition pipeline - Path: `gateway/src/services/promptComposer.ts`
- Feature: chatV2Api frontend API functions - Path: `frontend/src/api/chatV2Api.ts`

### Follow-up Questions

No follow-up questions were needed. All answers were clear and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. (Confirmed via directory check -- no image/PDF files found in planning/visuals/)

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements

**Task Definition Update**
- Update `architect--define-architecture.json` to add an `artifacts` array entry: `{ "artifactId": "architecture-baseline", "filename": "ARCHITECTURE_BASELINE", "tool": "save_architecture_baseline", "description": "Architecture baseline meta-model" }`
- Leave `contextNeeds`, `responseFormat`, `taskPromptRef`, and `phases` unchanged (context assembly is handled inline in the route handler)

**Inline Context Assembly (Backend)**
- In chatV2.ts POST `/` handler, add an architecture-specific inline context block when `task.id === 'architect--define-architecture'`
- Load MISSION.MD from disk (same pattern as roadmap: try uppercase path, fall back to lowercase) and inject into `resolvedContext['MISSION']`
- Load TECH-STACK.MD from disk (same pattern) and inject into `resolvedContext['TECH STACK']` -- this is OPTIONAL: if file not found, proceed without it (no halt, no error)
- This differs from v1 which halts when TECH-STACK.MD is missing
- No deterministic first-turn short-circuit -- let the LLM handle the first turn naturally (unlike roadmap which has a canned first response)

**Architecture Baseline Generation (/generate endpoint)**
- Add a new `architecture-baseline` branch to the `/generate` endpoint, triggered when `artifactType === 'architecture-baseline'` (derived from task registry lookup of `task.artifacts[0].artifactId`)
- Build generation messages: populate `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` with `{missionContent}`, `{techStackContent}`, and `{conversationTranscript}` (built from thread history using `buildConversationTranscript`-style logic)
- Call `sendChatRequest` with `jsonMode: true, temperature: 0.2, maxTokens: 64000`
- Validate response: parse JSON, run `validateBaselineJsonShape`, run `ensureMinimumServices`
- On first validation failure: append invalid response + `BASELINE_JSON_CORRECTIVE_INSTRUCTION` to messages, retry once with same options
- On second validation failure: return `{ success: false, error: 'Architecture baseline generation failed after validation retry' }`
- On success: return `{ success: true, artifactContent: JSON.stringify(validatedJson) }`
- Import or replicate: `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` from `promptBuilder.ts`, `validateBaselineJsonShape`, `ensureMinimumServices`, `buildConversationTranscript`, `BASELINE_JSON_CORRECTIVE_INSTRUCTION`, and `BASELINE_ARRAY_FIELDS` from `chat.ts`

**Architecture Baseline Save (/save-artifact endpoint)**
- Add a new `architecture-baseline` adapter branch in the `/save-artifact` endpoint
- Defense-in-depth: before calling the MCP tool, parse the `content` as JSON, run `validateBaselineJsonShape`, and run `ensureMinimumServices` as a final safety gate
- Call `executeToolCall` with tool name `'save_architecture_baseline'`, args `{ projectId, architectureBaselineJson: content }`
- Completion chip: `artifactId: 'architecture-baseline'`, `artifactName: 'ARCHITECTURE_BASELINE'`, `content: 'Architecture Baseline complete.'`
- No `projectParentFolder`, `productName`, or `overwrite` needed (unlike mission adapter)

**Frontend TASK_ARTIFACT_MAP Extension**
- Add new entry to `TASK_ARTIFACT_MAP` in `useChatThread.ts`:
  ```
  'architect--define-architecture': {
    artifactId: 'architecture-baseline',
    artifactName: 'ARCHITECTURE_BASELINE',
    artifactKey: 'architecture',
    completionMessage: 'Architecture Baseline complete.',
    warningText: 'An Architecture Baseline already exists. Completing this conversation will replace it.',
    previewType: 'architecture-preview',
  }
  ```

**ArchitecturePreviewBubble Component (Frontend)**
- New React component rendered when `structuredResponse.type === 'architecture-preview'`
- Parses the `artifactContent` JSON string and renders a readable summary:
  - Header with entity counts (e.g., "3 services, 5 interfaces, 4 logical data entities, ...")
  - Expandable sections for each entity category (services, interfaces, interface endpoints, logical data entities, physical data entities, business logic, data movements)
  - Each section lists entity names with descriptions when available
- "Show JSON" toggle button that switches between readable summary and raw JSON view (same pattern as RoadmapPreviewBubble)
- Confirm/Reject buttons identical to existing artifact preview pattern
- CSS module: `ArchitecturePreviewBubble.module.css`

**MessageBubble Updates**
- Add type guard `isArchitecturePreview(sr)` checking `structuredResponse.type === 'architecture-preview'`
- Route to `ArchitecturePreviewBubble` when type matches

**useChatThread Hook Updates**
- In `generateArtifact`: handle `previewType === 'architecture-preview'` -- build `structuredResponse` with `type: 'architecture-preview'` and `content: artifactContent`
- The existing generalized artifact pipeline (TASK_ARTIFACT_MAP lookup, artifactExists warning, confirmArtifact, rejectArtifact) should work without structural changes -- only the new map entry is needed

**Dashboard Integration**
- In `dashboardSummary.ts`: call `fetchMetaModelSummary(projectId)` and override mock `highLevelArchitecture` values with real counts:
  - `overall`: derive from total entity count or a meaningful aggregate
  - `services`: `metaModelSummary.services.length`
  - `interfaces`: `metaModelSummary.interfaces.length`
  - `dataStores`: count of data entities (from `metaModelSummary.data_entities`)
  - `applications`: retain mock value or set to 0 (applications are not in MetaModelSummaryDto)
- When `fetchMetaModelSummary` returns null or fails: set all HLA values to 0 (architecture not yet defined)
- Graceful degradation on fetch failure: log warning, keep mock values
- In `DashboardView.tsx`: add `architecture` key to `artifactExists` record, derived from real persisted baseline/meta-model presence (e.g., `architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0` after the mock override ensures real data)

### Reusability Opportunities
- `CompletionChip.tsx`: Already fully parameterized -- zero changes expected
- `ArtifactPreviewBubble.tsx` pattern: Use as structural reference for ArchitecturePreviewBubble
- `RoadmapPreviewBubble.tsx` pattern: Direct template for expandable sections + Show JSON toggle
- `TASK_ARTIFACT_MAP` generalization from Increment 5: Already task-agnostic -- only a new entry needed
- `/generate` and `/save-artifact` adapter branching: Established pattern, add a third branch
- Inline context assembly pattern from Increment 5: Direct template for the architecture context block
- `validateBaselineJsonShape`, `ensureMinimumServices`, `buildConversationTranscript`, `BASELINE_ARRAY_FIELDS`, `BASELINE_JSON_CORRECTIVE_INSTRUCTION`: These are currently private to `chat.ts` -- need to be extracted/replicated for use in `chatV2.ts`
- `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE`: Already exported from `promptBuilder.ts`
- `fetchMetaModelSummary`: Already exported from `architectureModelClient.ts`

### Scope Boundaries

**In Scope:**
- Architect "Define Architecture" task wired through v2 registry and prompt composition pipeline
- Inline context assembly: MISSION.MD injection (required if available) and TECH-STACK.MD injection (optional, no halt if missing)
- Architecture baseline generation via `/generate` endpoint (LLM call with jsonMode, validation, corrective retry)
- Architecture preview via new `ArchitecturePreviewBubble` component (entity counts, expandable sections, Show JSON toggle)
- Architecture baseline save via `/save-artifact` endpoint with defense-in-depth validation
- Completion chip on successful save (using existing parameterized CompletionChip)
- TASK_ARTIFACT_MAP entry and artifactExists wiring for architecture
- Dashboard `highLevelArchitecture` real counts from `fetchMetaModelSummary`
- Existing artifact warning when architecture baseline already exists

**Out of Scope:**
- Streaming responses
- Thread summarization
- Side panel integration
- v1 chat route removal or modification
- Implement screen changes
- Generating TECH-STACK.MD / standards (Increment 7)
- Diagram rendering from architecture baseline
- Diff/merge of baselines (comparing old vs new)
- Per-entity deep-linking from the preview (e.g., clicking a service to navigate to its detail)
- Real context resolvers (deferred to Increment 8-9)
- Deterministic first-turn short-circuit for SA task (not needed -- LLM handles first turn naturally)

### Technical Considerations
- The `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` uses `{missionContent}`, `{techStackContent}`, and `{conversationTranscript}` placeholder variables that must be populated before sending to the LLM
- The LLM call for generation requires `jsonMode: true, temperature: 0.2, maxTokens: 64000` -- higher token limit than standard chat calls due to the large JSON output schema
- The `validateBaselineJsonShape` and `ensureMinimumServices` functions currently live in `chat.ts` as module-private functions (exported only for testing) -- they need to be made importable or replicated in `chatV2.ts`
- The `save_architecture_baseline` MCP tool requires `{ projectId, architectureBaselineJson }` -- simpler args than mission (no `projectParentFolder`, `productName`, `overwrite`)
- The architecture JSON schema has 7 entity arrays (services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements) with cross-reference constraints (e.g., `serviceRef` must match a service name)
- The `MetaModelSummaryDto` returned by `fetchMetaModelSummary` has `services[]`, `data_entities[]`, `interfaces[]`, and `relationships[]` but no `applications` field -- the dashboard `applications` metric may need to remain at 0 or derive from a different source
- The `ArchitecturePreviewBubble` receives a JSON string (not markdown) -- it must parse and render structured content, unlike the mission preview which renders markdown
- Context assembly loads files from `config.conversationPersistBasePath + 'agent-os/product/MISSION.MD'` and `config.conversationPersistBasePath + 'agent-os/product/TECH-STACK.MD'` with case-insensitive fallback
