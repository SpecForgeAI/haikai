# Task Breakdown: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End

## Overview
Total Tasks: 62
Task Groups: 7
Estimated Build Order: Task Definition Update -> Backend Endpoint Extensions (inline context + /generate + /save-artifact) -> Backend Dashboard Integration -> Frontend Components (ArchitecturePreviewBubble + MessageBubble) -> useChatThread Hook Extension -> Frontend Integration Wiring -> Test Review & Gap Analysis

This is Increment 6 of the 11-increment unified conversation engine plan. Increments 1-5 are complete and verified: (1) backend POST /api/chat/v2, registries, thread persistence, prompt composition; (2) frontend UnifiedChatPanel, useChatThread hook, GET /api/chat/v2/thread, Dashboard integration; (3) Hub Chat MVP wiring -- @-mention, message queuing, persona handoff; (4) PM "Define Product" end-to-end -- artifact generation, preview, confirm/save, completion chip, dashboard reflection; (5) PM "Build Roadmap" end-to-end -- inline context injection, deterministic first-turn, artifact extraction, structured roadmap preview, adapter-pattern save, TASK_ARTIFACT_MAP generalization. This increment wires the third bootstrap conversation flow: Solution Architect "Define Architecture" discovery -> inline context injection (MISSION.MD + optional TECH-STACK.MD) -> architecture baseline generation via direct LLM call with jsonMode and corrective retry -> ArchitecturePreviewBubble with entity counts and expandable sections -> adapter-pattern save with defense-in-depth validation -> completion chip -> dashboard real architecture counts from fetchMetaModelSummary.

**Key Constraint:** The existing v1 `POST /api/chat` endpoint, `chat.ts`, `SolutionArchitectChatPanel.tsx`, and `promptBuilder.ts` remain completely untouched. The v1 SA flow continues to work alongside this new Hub-based flow until Increment 10 removal. TECH-STACK.MD is optional -- if not found, the flow proceeds without it (no halt, unlike v1 at `chat.ts` line 1295).

---

## Task List

### Backend Layer

#### Task Group 1: Task Definition Update
**Dependencies:** None
**Assignee Profile:** Backend engineer (TypeScript / JSON config)

This group updates the SA task definition to declare the architecture baseline artifact slot. No runtime code changes -- only the JSON config file. The existing prompt files (`architect.identity.md` and `architect.define-architecture.task.md`) require no changes.

- [x] 1.0 Complete task definition update
  - [x] 1.1 Write 3 focused tests for task definition validation
    - Test that `gateway/src/config/tasks/architect--define-architecture.json` parses as valid JSON and contains an `artifacts` array with at least one entry where `artifactId === 'architecture-baseline'`
    - Test that the `artifacts[0]` entry has the expected shape: `{ artifactId: 'architecture-baseline', filename: 'ARCHITECTURE_BASELINE', tool: 'save_architecture_baseline', description: string }`
    - Test that `contextNeeds` remains `["mission", "tech-stack"]` and `responseFormat` remains unchanged (required fields: `phase`, `section`, `questions`, `summary`)
  - [x] 1.2 Update `gateway/src/config/tasks/architect--define-architecture.json`
    - Change the `artifacts` field at line 42 from `[]` to:
      ```json
      [
        {
          "artifactId": "architecture-baseline",
          "filename": "ARCHITECTURE_BASELINE",
          "tool": "save_architecture_baseline",
          "description": "Architecture baseline meta-model"
        }
      ]
      ```
    - Leave `contextNeeds: ["mission", "tech-stack"]` (line 40) unchanged
    - Leave `responseFormat` (lines 8-38), `taskPromptRef`, `phases`, and `mode` unchanged
  - [x] 1.3 Ensure task definition tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify JSON parses correctly and artifact slot is declared
    - Verify contextNeeds and responseFormat are unchanged

**Acceptance Criteria:**
- All 3 tests pass
- `architect--define-architecture.json` has a valid `artifacts` array with the `architecture-baseline` entry
- Existing `responseFormat`, `contextNeeds`, `taskPromptRef`, and `mode` are unchanged
- Registry loader continues to load the task definition without errors

---

#### Task Group 2: Backend Endpoint Extensions (POST /, /generate, /save-artifact)
**Dependencies:** Task Group 1
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Extends three areas of `gateway/src/routes/chatV2.ts`: (1) inline context assembly for architecture task in the POST `/` handler (MISSION.MD + optional TECH-STACK.MD), (2) `architecture-baseline` branch in POST `/generate` with direct LLM call, jsonMode, validation, and corrective retry, (3) `architecture-baseline` adapter in POST `/save-artifact` with defense-in-depth validation. Also requires exporting or replicating key functions from `chat.ts`.

- [x] 2.0 Complete backend endpoint extensions
  - [x] 2.1 Write 8 focused tests for the endpoint extensions
    - Test POST `/` with `taskId === 'architect--define-architecture'` injects `resolvedContext['MISSION']` from MISSION.MD disk read and `resolvedContext['TECH STACK']` from TECH-STACK.MD disk read (when both files exist)
    - Test POST `/` with `taskId === 'architect--define-architecture'` when TECH-STACK.MD is missing proceeds without error (TECH-STACK.MD is optional -- no halt, no error message returned)
    - Test POST `/` with `taskId === 'architect--define-architecture'` does NOT produce a deterministic first-turn short-circuit (unlike roadmap, the LLM handles the first turn naturally)
    - Test POST `/generate` with `artifactType === 'architecture-baseline'` calls `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 64000 }` and returns `{ success: true, artifactContent: string }` containing validated JSON
    - Test POST `/generate` with `artifactType === 'architecture-baseline'` on first validation failure performs corrective retry with `BASELINE_JSON_CORRECTIVE_INSTRUCTION` appended to messages
    - Test POST `/generate` with `artifactType === 'architecture-baseline'` on second validation failure returns `{ success: false, error: 'Architecture baseline generation failed after validation retry' }`
    - Test POST `/save-artifact` with architecture adapter calls `executeToolCall` with `'save_architecture_baseline'` and args `{ projectId, architectureBaselineJson: content }`, and inserts a completion chip with `artifactId: 'architecture-baseline'` and `artifactName: 'ARCHITECTURE_BASELINE'`
    - Test POST `/save-artifact` with architecture adapter runs defense-in-depth validation (`validateBaselineJsonShape` + `ensureMinimumServices`) on `content` before calling `executeToolCall`
  - [x] 2.2 Export or replicate required functions from `chat.ts` for use in `chatV2.ts`
    - `validateBaselineJsonShape` (line 586): already exported -- import directly
    - `ensureMinimumServices` (line 616): already exported -- import directly
    - `buildConversationTranscript` (line 637): already exported -- import directly
    - `BASELINE_JSON_CORRECTIVE_INSTRUCTION` (line 198): currently module-private (`const` without `export`) -- must either add `export` keyword or replicate the string constant in `chatV2.ts`
    - `BASELINE_ARRAY_FIELDS` (line 318): currently module-private -- only needed if replicating `validateBaselineJsonShape` (not needed since we import the function directly)
    - Import `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` from `promptBuilder.ts` (line 749, already exported)
  - [x] 2.3 Add inline context assembly for architecture task in POST `/` handler
    - In `gateway/src/routes/chatV2.ts`, after the existing roadmap context block (line 1051) and before Step 6 `composeSystemPrompt` (line 1136), add an architecture-specific inline context block
    - Guard with `task.id === 'architect--define-architecture'`
    - Load MISSION.MD from disk using the same two-path fallback pattern already at lines 1024-1036: try `path.join(basePath, 'agent-os', 'product', 'MISSION.MD')`, fall back to lowercase `mission.md` -- inject into `resolvedContext['MISSION']`
    - Load TECH-STACK.MD from disk using the same pattern: try `path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD')`, fall back to lowercase `tech-stack.md` -- inject into `resolvedContext['TECH STACK']`
    - TECH-STACK.MD is OPTIONAL: if the file is not found, log at debug level and proceed without it (do NOT halt)
    - No deterministic first-turn short-circuit: the LLM handles the first turn naturally through the discovery prompt
  - [x] 2.4 Add `architecture-baseline` branch in POST `/generate` handler
    - In the `/generate` handler (lines 495-683), after the existing roadmap branch (line 554-589) and before the mission path (line 591), add a new branch triggered when `artifactType === 'architecture-baseline'` (derived from task registry lookup at line 551: `taskDef.artifacts[0].artifactId`)
    - Build conversation transcript from thread messages using `buildConversationTranscript` (imported from `chat.ts` line 637): filter to messages for the current task, skip system messages, format as `"User: ...\nAssistant: ..."` dialogue
    - Load MISSION.MD and TECH-STACK.MD content from disk (same fallback pattern as inline context assembly) or from thread `resolvedContext` if available
    - Populate `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE`: replace `{missionContent}` with resolved MISSION.MD content (or `'Not available'`), `{techStackContent}` with resolved TECH-STACK.MD content (or `'Not available'`), and `{conversationTranscript}` with the built transcript
    - Build generation messages: `[{ role: 'system', content: populatedTemplate }, { role: 'user', content: 'Generate the architecture baseline JSON now.' }]` (matching v1 at `chat.ts` lines 1819-1822)
    - Call `sendChatRequest` with `{ jsonMode: true, temperature: 0.2, maxTokens: 64000 }` (matching v1 at `chat.ts` line 1831)
    - Validate: parse JSON, call `validateBaselineJsonShape`, call `ensureMinimumServices`
    - On first validation failure: append invalid response + `BASELINE_JSON_CORRECTIVE_INSTRUCTION` to messages, retry once with same LLM options (matching v1 at lines 1856-1866)
    - On second failure: return `{ success: false, error: 'Architecture baseline generation failed after validation retry' }`
    - On success: return `{ success: true, artifactContent: JSON.stringify(validatedJson) }`
  - [x] 2.5 Add `architecture-baseline` adapter in POST `/save-artifact` handler
    - In the `/save-artifact` handler (lines 706-895), add a new adapter branch alongside the existing roadmap (line 774) and mission (line 787) adapters
    - Defense-in-depth: before calling the MCP tool, parse `content` as JSON, run `validateBaselineJsonShape`, and run `ensureMinimumServices` as a final safety gate
    - Call `executeToolCall` with tool name `'save_architecture_baseline'`, args `{ projectId, architectureBaselineJson: content }` (matching `toolExecutor.ts` line 44 required params and v1 at `chat.ts` lines 1895-1904)
    - No `projectParentFolder`, `productName`, or `overwrite` needed (simpler than mission adapter)
    - Completion chip values: `artifactId: 'architecture-baseline'`, `artifactName: 'ARCHITECTURE_BASELINE'`, `content: 'Architecture Baseline complete.'`
  - [x] 2.6 Ensure backend endpoint extension tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify inline context injection, generate branching with LLM call + validation + retry, save adapter with defense-in-depth, and completion chip values all work correctly

**Acceptance Criteria:**
- All 8 tests pass
- POST `/` injects MISSION.MD (required) and TECH-STACK.MD (optional) into resolvedContext for architecture task
- POST `/` does NOT halt when TECH-STACK.MD is missing
- POST `/` does NOT produce a first-turn short-circuit for architecture task
- POST `/generate` architecture-baseline path calls LLM with jsonMode, validates JSON, and retries on failure
- POST `/generate` returns `{ success: true, artifactContent }` on success or `{ success: false, error }` on double failure
- POST `/save-artifact` architecture-baseline adapter runs defense-in-depth validation before calling `executeToolCall`
- POST `/save-artifact` inserts completion chip with correct architecture artifact metadata
- Existing mission and roadmap paths in `/generate` and `/save-artifact` are unaffected

---

#### Task Group 3: Backend Dashboard Integration (Real Architecture Counts)
**Dependencies:** Task Group 2
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Adds real architecture baseline entity counts to the dashboard summary endpoint, replacing mock `highLevelArchitecture` values when `fetchMetaModelSummary` returns data.

- [x] 3.0 Complete backend dashboard integration
  - [x] 3.1 Write 3 focused tests for dashboard architecture data
    - Test that `GET /api/dashboard/summary` returns real `highLevelArchitecture` counts (services, interfaces, dataStores) when `fetchMetaModelSummary` returns a MetaModelSummaryDto with services, interfaces, and data_entities arrays
    - Test that `GET /api/dashboard/summary` returns `highLevelArchitecture` counts all at 0 when `fetchMetaModelSummary` returns null (no baseline exists)
    - Test that `GET /api/dashboard/summary` leaves mock `highLevelArchitecture` values unchanged when `fetchMetaModelSummary` throws an error (graceful degradation)
  - [x] 3.2 Add real architecture data to dashboard summary endpoint
    - In `gateway/src/routes/dashboardSummary.ts`, after the existing roadmap block (lines 99-121), add an architecture block following the same try/catch pattern
    - Call `fetchMetaModelSummary(projectId)` from `architectureModelClient.ts` (line 507, already exported)
    - When the result is non-null and has entities: override mock `highLevelArchitecture` values with real counts:
      ```typescript
      dto.strategicFoundation.highLevelArchitecture.services = { label: 'Services', value: metaModel.services.length };
      dto.strategicFoundation.highLevelArchitecture.interfaces = { label: 'Interfaces', value: metaModel.interfaces.length };
      dto.strategicFoundation.highLevelArchitecture.dataStores = { label: 'Data Stores', value: metaModel.data_entities.length };
      dto.strategicFoundation.highLevelArchitecture.overall = { label: 'Overall', value: metaModel.services.length + metaModel.interfaces.length + metaModel.data_entities.length };
      dto.strategicFoundation.highLevelArchitecture.applications = { label: 'Applications', value: 0 }; // no applications in MetaModelSummaryDto
      ```
    - When `fetchMetaModelSummary` returns null: set all HLA values to 0 (architecture not yet defined)
    - On fetch failure: log warning and leave mock values unchanged (graceful degradation)
    - Import `fetchMetaModelSummary` from `architectureModelClient.ts`
  - [x] 3.3 Ensure dashboard integration tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify real data overrides mock values and graceful degradation on error

**Acceptance Criteria:**
- All 3 tests pass
- Dashboard summary returns real architecture entity counts from `fetchMetaModelSummary` when baseline exists
- Dashboard summary returns 0 counts when no baseline exists
- Dashboard summary gracefully degrades to mock values when the service is unavailable
- Existing MISSION.MD and roadmap data blocks are unaffected

---

### Frontend Components Layer

#### Task Group 4: Frontend Components (ArchitecturePreviewBubble + MessageBubble + useChatThread)
**Dependencies:** Task Group 2 (backend endpoints must be extended)
**Assignee Profile:** Frontend engineer (React, TypeScript, CSS)

Creates the `ArchitecturePreviewBubble` component for structured architecture baseline preview with expandable sections and Show JSON toggle. Updates `MessageBubble.tsx` with a new type guard and rendering branch. Adds TASK_ARTIFACT_MAP entry and preview-type routing in `useChatThread.ts`.

- [x] 4.0 Complete frontend components for architecture preview
  - [x] 4.1 Write 8 focused tests for the new components, MessageBubble updates, and hook extension
    - Test `ArchitecturePreviewBubble` renders entity counts in the header (e.g., "Generated Architecture Baseline -- 3 services, 5 interfaces, 4 data entities")
    - Test `ArchitecturePreviewBubble` renders expandable sections for each of the 7 entity arrays (services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements) with entity names and descriptions
    - Test `ArchitecturePreviewBubble` toggles between readable summary view and raw JSON view when "Show JSON" button is clicked
    - Test `ArchitecturePreviewBubble` renders Confirm and Reject buttons; Confirm button shows "Saving..." when `isConfirming` is true; both disabled when `disabled || isConfirming`
    - Test `ArchitecturePreviewBubble` handles malformed JSON gracefully (shows error message, not crash)
    - Test `isArchitecturePreview` type guard returns true for `{ type: 'architecture-preview', content: '...' }` and false for other types (e.g., `roadmap-preview`, `artifact-preview`)
    - Test `MessageBubble` renders `ArchitecturePreviewBubble` when `structuredResponse.type === 'architecture-preview'` and `onConfirmArtifact` is provided
    - Test `TASK_ARTIFACT_MAP` contains entry for `'architect--define-architecture'` with `artifactId: 'architecture-baseline'`, `previewType: 'architecture-preview'`, and correct `warningText`
  - [x] 4.2 Add entry to `TASK_ARTIFACT_MAP` in `frontend/src/hooks/useChatThread.ts`
    - Add a third entry to the map at line 82 (after the `product-manager--roadmap` entry):
      ```typescript
      'architect--define-architecture': {
        artifactId: 'architecture-baseline',
        artifactName: 'ARCHITECTURE_BASELINE',
        artifactKey: 'architecture',
        completionMessage: 'Architecture Baseline complete.',
        warningText: 'An Architecture Baseline already exists. Completing this conversation will replace it.',
        previewType: 'architecture-preview',
      },
      ```
    - The existing generalized pipeline (`generateArtifact` at line 276, `confirmArtifact` at line 357, `selectTask` at line 601) will automatically use this mapping with no structural changes
  - [x] 4.3 Add `architecture-preview` routing in `generateArtifact` (useChatThread.ts lines 276-349)
    - The existing `previewType` lookup at line 294 already handles roadmap-preview vs artifact-preview
    - Add an explicit branch at line 298: `else if (previewType === 'architecture-preview') { structuredResponse = { type: 'architecture-preview', content: artifactContent } }`
    - This follows the same shape pattern as `roadmap-preview` at lines 298-302
  - [x] 4.4 Create `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx`
    - Modeled on `RoadmapPreviewBubble.tsx` (184 lines)
    - Props interface:
      ```typescript
      export interface ArchitecturePreviewBubbleProps {
        content: string;
        onConfirm: () => void;
        onReject: () => void;
        isConfirming?: boolean;
        disabled?: boolean;
      }
      ```
    - Parse `content` (JSON string) into the architecture baseline shape: `{ services: [], interfaces: [], interfaceEndpoints: [], logicalDataEntities: [], physicalDataEntities: [], businessLogic: [], dataMovements: [] }`
    - Header with entity counts summary: e.g., "Generated Architecture Baseline -- 3 services, 5 interfaces, 4 data entities"
    - Expandable/collapsible sections for each of the 7 entity arrays: show entity `name` with `description` when available; each section starts collapsed with a count indicator (e.g., "Services (3)") and expands on click to show entity list
    - "Show JSON" toggle button switching between readable summary and raw pretty-printed JSON (same pattern as `RoadmapPreviewBubble.tsx` lines 121-161)
    - Confirm/Reject buttons identical to `RoadmapPreviewBubble.tsx` lines 164-181: Confirm shows "Saving..." when `isConfirming`, both disabled when `disabled || isConfirming`
    - Graceful error handling for malformed JSON (display error message, not crash)
    - `data-testid="architecture-preview-bubble"`
  - [x] 4.5 Create `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.module.css`
    - Follow `RoadmapPreviewBubble.module.css` patterns (210 lines):
    - `.container`: bordered container with subtle blue-tinted background (architecture theme, distinct from green roadmap), `border-radius: 8px`, `padding: 16px`, `max-height: 400px`, `overflow-y: auto`
    - `.header`: header label styling with entity counts
    - `.sectionHeader`: expandable section header with click-to-toggle, entity type name + count, cursor pointer
    - `.sectionContent`: entity list within expanded section
    - `.entityItem`: entity item with name emphasis and description
    - `.toggleButton`: "Show JSON" toggle button styling (same as roadmap)
    - `.rawJson`: raw JSON view with monospace font, pre-wrap
    - `.errorMessage`: error state styling
    - `.actions`: button container, `display: flex`, `gap: 8px`, `justify-content: flex-end`
    - `.confirmButton`: primary button styling (same as roadmap)
    - `.rejectButton`: outlined secondary button styling (same as roadmap)
  - [x] 4.6 Add `isArchitecturePreview` type guard to `MessageBubble.tsx`
    - Add after the existing `isRoadmapPreview` type guard at line 135:
      ```typescript
      function isArchitecturePreview(
        sr: unknown
      ): sr is { type: 'architecture-preview'; content: string } {
        if (sr == null || typeof sr !== 'object') return false;
        const obj = sr as Record<string, unknown>;
        return obj.type === 'architecture-preview' && typeof obj.content === 'string';
      }
      ```
  - [x] 4.7 Add rendering branch for `architecture-preview` in `MessageBubble.tsx`
    - Add a rendering check: `const showArchitecturePreview = isArchitecturePreview(structuredResponse);` (after `showRoadmapPreview` at line 170)
    - Update the `showQuestions` guard (line 172) to also exclude `showArchitecturePreview`
    - In the JSX, insert a new branch between the `showRoadmapPreview` branch (line 243) and the `showCompletionChip` branch (line 259):
      ```typescript
      ) : showArchitecturePreview && onConfirmArtifact ? (
        <div className={styles.structuredResponseArea}>
          {content && (
            <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
              {content}
            </div>
          )}
          <ArchitecturePreviewBubble
            content={(structuredResponse as { content: string }).content}
            onConfirm={onConfirmArtifact}
            onReject={onRejectArtifact!}
            isConfirming={isConfirmingArtifact || false}
            disabled={disabled || false}
          />
        </div>
      ```
    - Import `ArchitecturePreviewBubble` from `./ArchitecturePreviewBubble`
  - [x] 4.8 Ensure component tests pass
    - Run ONLY the 8 tests written in 4.1
    - Verify rendering, JSON toggle, expandable sections, interaction behaviors, type guard, and TASK_ARTIFACT_MAP entry

**Acceptance Criteria:**
- All 8 tests pass
- `ArchitecturePreviewBubble` renders a readable entity summary with expandable sections and counts in the header
- "Show JSON" toggle switches between summary and raw JSON views
- Confirm/Reject buttons work correctly with loading and disabled states
- Malformed JSON displays an error message rather than crashing
- `isArchitecturePreview` type guard correctly identifies `architecture-preview` structured responses
- `MessageBubble` renders `ArchitecturePreviewBubble` for architecture-preview messages
- `TASK_ARTIFACT_MAP` has the `architect--define-architecture` entry with correct metadata
- `generateArtifact` produces `architecture-preview` type for architecture tasks
- Existing `ArtifactPreviewBubble` and `RoadmapPreviewBubble` behavior is unaffected

---

### Integration Layer

#### Task Group 5: Frontend Integration Wiring
**Dependencies:** Task Groups 3 (dashboard), 4 (components + hook)
**Assignee Profile:** Frontend engineer (React, TypeScript)

Wires the architecture task through `DashboardView` (artifactExists), `UnifiedChatPanel` (handleDownloadTranscript), and verifies the generalized pipeline handles the new task end-to-end.

- [x] 5.0 Complete frontend integration wiring
  - [x] 5.1 Write 6 focused tests for integration wiring
    - Test `DashboardView` passes `artifactExists` record with `architecture` key to `UnifiedChatPanel` (alongside existing `mission` and `roadmap`)
    - Test `DashboardView` derives `architecture` existence from `(data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0`
    - Test `UnifiedChatPanel` `handleDownloadTranscript` for architecture task uses `'ARCHITECTURE_BASELINE (architecture meta-model)'` as the artifact description
    - Test `UnifiedChatPanel` `handleDownloadTranscript` for architecture task generates filename `'architect-define-architecture-transcript.md'`
    - Test `selectTask` with `taskId === 'architect--define-architecture'` and `artifactExists.architecture === true` inserts warning message: "An Architecture Baseline already exists. Completing this conversation will replace it."
    - Test `selectTask` with `taskId === 'architect--define-architecture'` and `artifactExists.architecture === false` does NOT insert a warning message
  - [x] 5.2 Update `DashboardView` to pass `architecture` in `artifactExists` record
    - In `frontend/src/components/DashboardView/DashboardView.tsx`, extend the `artifactExists` record at line 518-521:
      ```typescript
      artifactExists={{
        mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
        roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
        architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0,
      }}
      ```
    - The `onArtifactSaved={fetchData}` callback remains unchanged -- re-fetches all dashboard data including real architecture counts
  - [x] 5.3 Extend `handleDownloadTranscript` in `UnifiedChatPanel`
    - In `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`, extend the `artifactDescription` and `filename` resolution at lines 216-244 to handle the architecture task
    - Add a mapping branch for `'architect--define-architecture'`: `artifactDescription = 'ARCHITECTURE_BASELINE (architecture meta-model)'`, `filename = 'architect-define-architecture-transcript.md'`
    - Extend the existing conditional logic (currently handles `product-manager--roadmap` at line 230 and falls back to mission)
  - [x] 5.4 Verify CompletionChip reuse (no changes needed)
    - Confirm `CompletionChip` is already fully parameterized via props (`taskLabel`, `personaColor`, `artifactName`, `onDownloadTranscript`) and requires no changes
    - Architecture usage passes: `taskLabel: 'architect--define-architecture'`, `personaColor` from architect persona config, `artifactName: 'ARCHITECTURE_BASELINE'`
  - [x] 5.5 Ensure integration wiring tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify prop threading, transcript parameterization, and dashboard data derivation

**Acceptance Criteria:**
- All 6 tests pass
- `DashboardView` passes `architecture` existence flag derived from real dashboard data
- `handleDownloadTranscript` produces correct artifact description and filename for architecture task
- `selectTask` shows the correct warning text when architecture baseline already exists
- `CompletionChip` requires zero changes and works for architecture
- Existing mission and roadmap flow wiring is unaffected

---

### Test Review

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5 (all implementation complete)
**Assignee Profile:** Test engineer / full-stack engineer

Reviews all tests written by prior task groups, identifies critical coverage gaps in the end-to-end architecture baseline flow, and adds up to 20 additional strategic tests.

- [x] 6.0 Review all tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3 tests from Task Group 1 (task definition validation)
    - Review the 8 tests from Task Group 2 (backend endpoint extensions)
    - Review the 3 tests from Task Group 3 (dashboard architecture integration)
    - Review the 8 tests from Task Group 4 (ArchitecturePreviewBubble + MessageBubble + useChatThread)
    - Review the 6 tests from Task Group 5 (frontend integration wiring)
    - Total existing tests: 28
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's architecture baseline flow
    - Do NOT assess entire application test coverage
    - Prioritize the following workflows:
      - Full end-to-end architecture: user selects @Architect -> Define Architecture -> discovery conversation with mission+tech-stack context -> phase=ready -> generate architecture baseline JSON -> architecture preview with expandable sections -> confirm save -> completion chip appears -> dashboard updates with real counts
      - Context injection: MISSION.MD found and injected, TECH-STACK.MD missing proceeds gracefully
      - Context injection: both MISSION.MD and TECH-STACK.MD found and injected
      - Generation: LLM returns valid JSON -> validateBaselineJsonShape passes -> ensureMinimumServices passes -> success
      - Generation: LLM returns invalid JSON -> corrective retry -> second attempt succeeds
      - Generation: LLM returns invalid JSON -> corrective retry -> second attempt fails -> error returned
      - Save: defense-in-depth validation catches corrupted content before MCP tool call
      - Save: defense-in-depth validation passes and MCP tool call succeeds
      - Preview: expandable sections render for all 7 entity arrays
      - Preview: Show JSON toggle works correctly
      - Dashboard: real counts replace mock values; graceful degradation on error
      - Re-run flow: artifactExists.architecture warning appears when re-running architecture task
      - Sealed segment: architecture messages in sealed segment are disabled
      - Transcript: architecture transcript uses correct artifact description
  - [x] 6.3 Write up to 20 additional strategic tests to fill critical gaps
    - Possible gap areas (assess and add only where critical coverage is missing):
      - End-to-end: POST `/` injects MISSION into resolvedContext when only MISSION.MD (uppercase) exists
      - End-to-end: POST `/` injects MISSION into resolvedContext when only mission.md (lowercase fallback) exists
      - End-to-end: POST `/generate` architecture-baseline path builds correct generation messages with populated template
      - End-to-end: POST `/generate` architecture-baseline path uses `buildConversationTranscript` from thread messages
      - End-to-end: POST `/save-artifact` architecture adapter defense-in-depth rejects content with non-array `services` field
      - End-to-end: POST `/save-artifact` architecture adapter inserts completion chip persisted to thread on disk
      - End-to-end: Dashboard re-fetch callback fires after successful architecture `confirmArtifact`
      - Integration: `ArchitecturePreviewBubble` renders expandable section for services with 3 services showing name and description
      - Integration: `ArchitecturePreviewBubble` renders empty entity arrays gracefully (section shows count of 0)
      - Integration: `isArchitecturePreview` returns false for `roadmap-preview` type (no false positives)
      - Integration: `generateArtifact` for architecture task produces `architecture-preview` structuredResponse type
      - Integration: `confirmArtifact` for architecture task uses `artifactId: 'architecture-baseline'` and `artifactName: 'ARCHITECTURE_BASELINE'`
      - Integration: `confirmArtifact` for architecture task calls `onArtifactSaved` callback
      - Integration: Phase detection triggers generation for architecture task when `phase === 'ready'`
      - Regression: Mission `generateArtifact` still produces `artifact-preview` type (not `architecture-preview`)
      - Regression: Roadmap `generateArtifact` still produces `roadmap-preview` type
      - Regression: Mission `confirmArtifact` still uses `'mission-md'` artifactId
      - Regression: Roadmap `confirmArtifact` still uses `'roadmap'` artifactId
      - Regression: Dashboard roadmap block still produces correct initiative/epic counts
      - Regression: Dashboard MISSION.MD existence check still works
    - Add a maximum of 20 new tests to fill identified gaps
    - Do NOT write exhaustive edge-case or stress tests
  - [x] 6.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 28-48 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-48 total)
- Critical end-to-end architecture baseline workflows are covered
- Regression coverage confirms mission and roadmap flows still work through generalized pipeline
- No more than 20 additional tests added when filling gaps
- Testing focused exclusively on this spec's architecture baseline flow
- Error handling, retry flows, and defense-in-depth validation have at least basic coverage

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Task Definition Update              (no dependencies)
    |
Task Group 2: Backend Endpoint Extensions          (depends on 1)
    |
    +---> Task Group 3: Backend Dashboard Integration  (depends on 2)
    |
    +---> Task Group 4: Frontend Components            (depends on 2)
              |
              v
          Task Group 5: Integration Wiring             (depends on 3, 4)
              |
              v
          Task Group 6: Test Review                    (depends on 1-5)
```

**Parallelizable work:**
- Task Groups 3 and 4 can begin as soon as Task Group 2 is complete (independent of each other)
- Task Group 3 (backend dashboard) modifies `dashboardSummary.ts` only; Task Group 4 (frontend components) modifies frontend files only -- no file conflicts

**Sequential constraints:**
- Task Group 1 must complete before Task Group 2 (the task definition must have the artifacts array before endpoint extensions can derive `artifactType`)
- Task Group 2 must complete before Task Groups 3 and 4 (they depend on the extended backend endpoints and exported functions)
- Task Groups 3 and 4 must both complete before Task Group 5 (integration wiring needs both dashboard data and frontend components)
- Task Group 5 must complete before Task Group 6 (test review covers all implementation)

---

## File Inventory

### New Files to Create
| File | Task Group | Purpose |
|------|-----------|---------|
| `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx` | 4 | Structured architecture baseline preview with expandable sections, entity counts, and Show JSON toggle |
| `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.module.css` | 4 | Styles for architecture preview bubble (blue-tinted theme) |

### Existing Files to Modify
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/config/tasks/architect--define-architecture.json` | 1 | Add `artifacts` array with `architecture-baseline` entry (change line 42 from `[]`) |
| `gateway/src/routes/chatV2.ts` | 2 | Add inline context assembly for architecture task in POST `/` (MISSION.MD + optional TECH-STACK.MD); add `architecture-baseline` branch in POST `/generate` (LLM call, jsonMode, validation, corrective retry); add `architecture-baseline` adapter in POST `/save-artifact` (defense-in-depth validation + executeToolCall) |
| `gateway/src/routes/chat.ts` | 2 | Export `BASELINE_JSON_CORRECTIVE_INSTRUCTION` constant (line 198, currently module-private `const` -- must add `export` keyword) OR replicate the constant in `chatV2.ts` |
| `gateway/src/routes/dashboardSummary.ts` | 3 | Add real architecture entity counts from `fetchMetaModelSummary`, following the roadmap block pattern (lines 99-121) |
| `frontend/src/hooks/useChatThread.ts` | 4 | Add `architect--define-architecture` entry to `TASK_ARTIFACT_MAP` (line 82); add `architecture-preview` routing branch in `generateArtifact` (line 298) |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | 4 | Add `isArchitecturePreview` type guard (after line 135); add `showArchitecturePreview` boolean (after line 170); add rendering branch for `ArchitecturePreviewBubble` (between lines 258-259); update `showQuestions` guard (line 172) |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 5 | Add `architecture` key to `artifactExists` record (line 518-521) |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | 5 | Extend `handleDownloadTranscript` to handle `architect--define-architecture` task (lines 216-244) |

### Existing Files NOT Modified
| File | Reason |
|------|--------|
| `gateway/src/routes/chat.ts` (main logic) | Existing v1 endpoint remains untouched; only `BASELINE_JSON_CORRECTIVE_INSTRUCTION` export may be added |
| `gateway/src/services/toolExecutor.ts` | `executeToolCall` already supports `save_architecture_baseline` at line 31 (endpoint) and line 44 (required params); imported and reused, not modified |
| `gateway/src/services/architectureModelClient.ts` | `fetchMetaModelSummary` (line 507) and `fetchProductSummary` (line 314) are imported and reused, not modified |
| `gateway/src/services/promptBuilder.ts` | `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` (line 749) is already exported; imported and reused, not modified |
| `gateway/src/services/promptComposer.ts` | `composeSystemPrompt` already supports `resolvedContext` map; no changes needed |
| `gateway/src/services/contextResolvers.ts` | Context resolvers remain stubs; inline assembly bypasses them |
| `gateway/src/services/openaiClient.ts` | `sendChatRequest` is reused as-is with `jsonMode`, `temperature`, `maxTokens` options |
| `gateway/src/services/threadStore.ts` | `getThread`, `appendMessage` are reused as-is |
| `gateway/src/services/roadmapSummaryBuilder.ts` | Roadmap helper functions are unaffected |
| `gateway/src/types/tools.ts` | `save_architecture_baseline` tool definition already exists |
| `gateway/src/config/prompts/architect.identity.md` | Identity prompt requires no changes per spec |
| `gateway/src/config/prompts/architect.define-architecture.task.md` | Task prompt requires no changes per spec |
| `frontend/src/api/chatV2Api.ts` | `postGenerateArtifact` (line 281) already returns `{ success, artifactContent?, missionMarkdown?, error? }` which works for architecture; `postSaveArtifact` (line 312) already accepts generic `{ threadKey, taskId, artifactId, content }` |
| `frontend/src/utils/transcriptExport.ts` | `buildTranscriptMarkdown` (line 36) already accepts `artifactDescription` parameter from Increment 5 generalization |
| `frontend/src/components/UnifiedChat/CompletionChip.tsx` | Already fully parameterized; requires no changes |
| `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx` | Not modified; architecture uses a new dedicated component |
| `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx` | Used as structural template only; not modified |
| `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx` | Already accepts `disabled` prop; no changes needed |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | Already passes through artifact callback props; no changes needed |
| `frontend/src/config/personaConfig.ts` | Read-only usage for persona config lookups |

### Existing Files Referenced (read-only patterns)
| File | Purpose |
|------|---------|
| `gateway/src/routes/chat.ts` line 198 | `BASELINE_JSON_CORRECTIVE_INSTRUCTION` constant (module-private, to be exported or replicated) |
| `gateway/src/routes/chat.ts` lines 318-326 | `BASELINE_ARRAY_FIELDS` constant (used internally by `validateBaselineJsonShape`) |
| `gateway/src/routes/chat.ts` lines 586-602 | `validateBaselineJsonShape()` (exported, to be imported in chatV2.ts) |
| `gateway/src/routes/chat.ts` lines 616-622 | `ensureMinimumServices()` (exported, to be imported in chatV2.ts) |
| `gateway/src/routes/chat.ts` lines 637-648 | `buildConversationTranscript()` (exported, to be imported in chatV2.ts) |
| `gateway/src/routes/chat.ts` lines 1809-1982 | V1 complete baseline generation-validate-retry-save flow (reference for /generate implementation) |
| `gateway/src/routes/chat.ts` line 1295 | V1 TECH-STACK.MD missing halt (NOT replicated in v2 -- TECH-STACK.MD is optional) |
| `gateway/src/services/promptBuilder.ts` line 749 | `ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE` with `{missionContent}`, `{techStackContent}`, `{conversationTranscript}` placeholders |
| `gateway/src/services/toolExecutor.ts` line 31 | `save_architecture_baseline` endpoint mapping |
| `gateway/src/services/toolExecutor.ts` line 44 | `save_architecture_baseline: ['projectId', 'architectureBaselineJson']` param mapping |
| `gateway/src/services/architectureModelClient.ts` line 507 | `fetchMetaModelSummary(projectId)` returns `MetaModelSummaryDto` with `services[]`, `data_entities[]`, `interfaces[]`, `relationships[]` |
| `gateway/src/routes/chatV2.ts` lines 1019-1051 | Existing roadmap inline context assembly pattern (template for architecture context block) |
| `gateway/src/routes/chatV2.ts` lines 554-589 | Existing roadmap branch in /generate (pattern for architecture-baseline branch) |
| `gateway/src/routes/chatV2.ts` lines 774-786 | Existing roadmap adapter in /save-artifact (pattern for architecture-baseline adapter) |
| `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx` | Structural template for ArchitecturePreviewBubble: JSON parse pattern (lines 65-75), Show JSON toggle (line 88), Confirm/Reject buttons (lines 164-181), CSS module patterns |
| `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.module.css` | CSS class patterns to replicate for ArchitecturePreviewBubble styles |
