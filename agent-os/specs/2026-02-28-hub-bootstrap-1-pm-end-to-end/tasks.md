# Task Breakdown: Hub Bootstrap 1 -- Product Definition (PM) End-to-End

## Overview
Total Tasks: 57
Task Groups: 8
Estimated Build Order: Task Definition Update -> Backend Endpoints -> Frontend API Client -> Frontend Components -> useChatThread Hook Extensions -> Dashboard Integration -> Frontend Integration Wiring -> Test Review & Gap Analysis

This is Increment 4 of the 11-increment plan. Increments 1 (backend POST /api/chat/v2, registries, thread persistence, prompt composition), 2 (frontend UnifiedChatPanel components, useChatThread hook, GET /api/chat/v2/thread, Dashboard integration), and 3 (Hub Chat MVP wiring -- @-mention, message queuing, persona handoff, PersonaHelperPanel cleanup) are all complete and verified. This increment wires the first complete bootstrap conversation flow: PM "Define Product" discovery -> artifact generation -> preview -> confirm/save -> completion chip -> dashboard reflection.

**Key Constraint:** The existing v1 `POST /api/chat` endpoint, `chat.ts`, `ProductManagerChatPanel.tsx`, and `promptBuilder.ts` remain completely untouched. The v1 PM flow continues to work alongside this new Hub-based flow.

---

## Task List

### Backend Layer

#### Task Group 1: Task Definition Update and Backend Configuration
**Dependencies:** None
**Assignee Profile:** Backend engineer (TypeScript / JSON config)

This group updates the PM task definition to declare the MISSION.md artifact slot and ensures the question normalization concern is documented. No runtime code changes -- only the JSON config file.

- [x] 1.0 Complete task definition update
  - [x] 1.1 Write 2 focused tests for task definition validation
    - Test that `gateway/src/config/tasks/product-manager--define-product.json` parses as valid JSON and contains an `artifacts` array with at least one entry where `artifactId === 'mission-md'`
    - Test that the `artifacts[0]` entry has the expected shape: `{ artifactId: 'mission-md', filename: 'MISSION.MD', tool: 'save_product_artifacts', description: string }`
  - [x] 1.2 Update `gateway/src/config/tasks/product-manager--define-product.json`
    - Change the `artifacts` field from `[]` to:
      ```json
      [
        {
          "artifactId": "mission-md",
          "filename": "MISSION.MD",
          "tool": "save_product_artifacts",
          "description": "Product mission statement"
        }
      ]
      ```
    - Leave `contextNeeds` as `[]` -- no context injection needed for this increment
    - Leave `phases` as `null` -- generation is handled by a separate endpoint, not as a formal task phase
    - Leave `responseFormat` unchanged -- the PM prompt already returns questions as plain strings; frontend normalization handles this (Task Group 4)
  - [x] 1.3 Ensure task definition tests pass
    - Run ONLY the 2 tests written in 1.1
    - Verify JSON parses correctly and artifact slot is declared

**Acceptance Criteria:**
- Both tests pass
- `product-manager--define-product.json` has a valid `artifacts` array with the `mission-md` entry
- Existing `responseFormat`, `contextNeeds`, `phases`, and `taskPromptRef` are unchanged
- Registry loader continues to load the task definition without errors

---

#### Task Group 2: Backend Generation and Save Endpoints
**Dependencies:** Task Group 1
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Adds two new POST handlers to `chatV2Router` in `gateway/src/routes/chatV2.ts`: `/generate` (calls LLM to produce MISSION.md content) and `/save-artifact` (calls MCP tool to persist to disk). These follow the existing handler patterns established in Increments 1-3.

- [x] 2.0 Complete backend generation and save endpoints
  - [x] 2.1 Write 6 focused tests for the new endpoints
    - Test POST `/api/chat/v2/generate` with valid `{ threadKey, personaId, taskId }` and a thread containing discovery messages returns `{ success: true, missionMarkdown: string }` (mock `sendChatRequest` to return a tool call with `missionMarkdown`)
    - Test POST `/api/chat/v2/generate` with missing `threadKey` returns 400
    - Test POST `/api/chat/v2/generate` when LLM returns no tool call returns `{ success: false, error: string }`
    - Test POST `/api/chat/v2/save-artifact` with valid `{ threadKey, taskId, artifactId, content }` returns `{ success: true }` (mock `executeToolCall` to return status 200)
    - Test POST `/api/chat/v2/save-artifact` with missing `content` returns 400
    - Test POST `/api/chat/v2/save-artifact` when `executeToolCall` returns an error returns `{ success: false, error: string }` and does NOT insert a completion chip message
  - [x] 2.2 Add POST `/generate` handler to `gateway/src/routes/chatV2.ts`
    - Add `chatV2Router.post('/generate', ...)` handler after the existing POST `/handoff` handler (after line 363)
    - Add these new imports at the top of the file:
      - `import { MISSION_GENERATION_PROMPT_TEMPLATE } from '../services/promptBuilder';` (line 664 of promptBuilder.ts)
      - `import { TOOL_DEFINITIONS, ToolDefinition } from '../types/tools';`
      - `import { fetchProductName } from '../services/architectureModelClient';`
      - `import { executeToolCall } from '../services/toolExecutor';`
      - `import { getConfig } from '../config';`
    - Extract `threadKey`, `personaId`, `taskId` from `req.body`
    - Validate: return 400 if any of `threadKey`, `personaId`, or `taskId` is missing
    - Resolve the thread via `getThread(threadKey)` -- return 400 if thread is null (no conversation to generate from)
    - Build transcript messages: filter `thread.messages` to messages where `msg.taskId === taskId`, skip messages with `role === 'system'`, map each to OpenAI format `{ role: msg.role as 'user' | 'assistant', content: msg.content }`
    - Build generation messages array:
      ```typescript
      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: MISSION_GENERATION_PROMPT_TEMPLATE },
        ...transcriptMessages,
        { role: 'user', content: 'Generate the MISSION.MD now.' },
      ];
      ```
    - Filter `TOOL_DEFINITIONS` to only `save_product_artifacts`:
      ```typescript
      const saveProductArtifactsTool = (TOOL_DEFINITIONS as ToolDefinition[]).filter(
        t => t.function.name === 'save_product_artifacts'
      );
      ```
    - Call `sendChatRequest(generationMessages, requestId, threadKeyStr, { tools: saveProductArtifactsTool, toolChoice: { type: 'function', function: { name: 'save_product_artifacts' } } })`
    - Extract `missionMarkdown` from `generationResponse.toolCalls[0].arguments.missionMarkdown`
    - On success (tool call present with `missionMarkdown`): return `{ success: true, missionMarkdown }`
    - On failure (no tool call, missing `missionMarkdown`, or LLM error): return `{ success: false, error: 'descriptive message' }`
    - Do NOT save the artifact -- saving is a separate step
    - Wrap in try/catch with 500 error handling following the pattern at lines 586-596
  - [x] 2.3 Add POST `/save-artifact` handler to `gateway/src/routes/chatV2.ts`
    - Add `chatV2Router.post('/save-artifact', ...)` handler after the `/generate` handler
    - Extract `threadKey`, `taskId`, `artifactId`, `content` from `req.body`
    - Validate: return 400 if any required field is missing or `content` is not a non-empty string
    - Resolve `projectParentFolder` server-side: use `getConfig().conversationPersistBasePath` as the workspace root (this is the `process.cwd()` value used throughout the gateway) -- MUST NOT accept `projectParentFolder` from the request body
    - Resolve `projectId` from `threadKey.projectId`
    - Resolve `productName` by calling `fetchProductName(projectId)` from `gateway/src/services/architectureModelClient.ts` (line 441); fall back to `projectId` if the result is null
    - Generate a fresh `mcpSessionId` via `uuidv4()` for this single tool execution call
    - Call `executeToolCall()` from `gateway/src/services/toolExecutor.ts` (line 205) with:
      - `callId`: a fresh `uuidv4()`
      - `toolName`: `'save_product_artifacts'`
      - `args`: `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }`
      - `mcpSessionId`: the fresh UUID
      - `requestId`: the request UUID
      - `sessionId`: `'v2-save-' + threadKeyToString(threadKey)`
    - On success (tool result `status === 200`):
      - Resolve the persona from the thread (find the last assistant message's `personaId`) or default to `'product-manager'`
      - Build a completion chip `ThreadMessage`:
        ```typescript
        const completionChip: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: resolvedPersonaId,
          taskId: taskId,
          content: 'Product Definition complete.',
          structuredResponse: {
            type: 'completion-chip',
            artifactId: 'mission-md',
            artifactName: 'MISSION.MD',
            taskId: taskId,
            personaId: resolvedPersonaId,
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        ```
      - Persist via `appendMessage(threadKey, completionChip)`
      - Return `{ success: true }`
    - On failure (tool result has `error` or non-200 status): return `{ success: false, error: toolResult.error || 'Save failed' }` -- do NOT insert completion chip
    - Wrap in try/catch with 500 error handling
  - [x] 2.4 Update dashboard summary endpoint for real MISSION.MD existence check
    - In `gateway/src/routes/dashboardSummary.ts`, add imports:
      - `import { getConfig } from '../config';`
      - `import * as fs from 'fs/promises';`
      - `import * as path from 'path';`
    - After line 72 (`const dto = buildMockDashboardSummary(...)`) and before the return, add a MISSION.MD existence check:
      ```typescript
      // Spec 2026-02-28: Hub Bootstrap 1 -- Real MISSION.MD existence check
      try {
        const missionPath = path.join(
          getConfig().conversationPersistBasePath,
          'agent-os', 'product', 'MISSION.MD'
        );
        await fs.access(missionPath);
        // File exists: override mock values with real data
        dto.strategicFoundation.productDefinition.missionExists = { label: 'Mission Exists', value: 1 };
        dto.strategicFoundation.productDefinition.state = { label: 'State', value: 100 };
      } catch {
        // File does not exist: set to "not started" state
        dto.strategicFoundation.productDefinition.missionExists = { label: 'Mission Exists', value: 0 };
        dto.strategicFoundation.productDefinition.state = { label: 'State', value: 0 };
      }
      ```
    - All other cards remain mock data -- only Product Definition gets real data in this increment
  - [x] 2.5 Ensure backend endpoint tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify both endpoints handle success and failure cases
    - Verify dashboard summary endpoint returns real MISSION.MD existence status

**Acceptance Criteria:**
- All 6 tests pass
- POST `/generate` calls LLM with `MISSION_GENERATION_PROMPT_TEMPLATE` and returns `missionMarkdown` on success
- POST `/save-artifact` resolves `projectParentFolder` server-side, calls `executeToolCall`, inserts completion chip on success
- Dashboard summary endpoint returns real `missionExists` and `state` values for the Product Definition card
- `projectParentFolder` is NEVER sourced from the frontend request body
- Existing POST `/`, GET `/thread`, and POST `/handoff` endpoints are unaffected

---

### Frontend API Client Layer

#### Task Group 3: chatV2Api Client Additions
**Dependencies:** Task Group 2 (backend endpoints must exist)
**Assignee Profile:** Frontend engineer (TypeScript)

Adds two new API client functions to `frontend/src/api/chatV2Api.ts` for the generate and save-artifact endpoints, following the established fetch + error-throw pattern.

- [x] 3.0 Complete API client additions
  - [x] 3.1 Write 4 focused tests for the new API client functions
    - Test `postGenerateArtifact` sends correct JSON body `{ threadKey, personaId, taskId }` to `/api/chat/v2/generate` via POST and returns parsed response on 200
    - Test `postGenerateArtifact` throws on non-2xx response
    - Test `postSaveArtifact` sends correct JSON body `{ threadKey, taskId, artifactId, content }` to `/api/chat/v2/save-artifact` via POST and returns parsed response on 200
    - Test `postSaveArtifact` throws on non-2xx response
  - [x] 3.2 Add `postGenerateArtifact` function to `frontend/src/api/chatV2Api.ts`
    - Add after the existing `postHandoff` function (after line 266)
    - Signature:
      ```typescript
      export async function postGenerateArtifact(
        threadKey: ThreadKey,
        personaId: string,
        taskId: string
      ): Promise<{ success: boolean; missionMarkdown?: string; error?: string }>
      ```
    - POST to `${GATEWAY_BASE}/api/chat/v2/generate` with JSON body `{ threadKey, personaId, taskId }`
    - Follow the exact `fetch` + `res.ok` check + `throw new Error` pattern from `postChatV2` (lines 213-225)
    - Return the parsed JSON response
  - [x] 3.3 Add `postSaveArtifact` function to `frontend/src/api/chatV2Api.ts`
    - Add after `postGenerateArtifact`
    - Signature:
      ```typescript
      export async function postSaveArtifact(
        threadKey: ThreadKey,
        taskId: string,
        artifactId: string,
        content: string
      ): Promise<{ success: boolean; error?: string }>
      ```
    - POST to `${GATEWAY_BASE}/api/chat/v2/save-artifact` with JSON body `{ threadKey, taskId, artifactId, content }`
    - Follow the same fetch + error-throw pattern
    - Return the parsed JSON response
  - [x] 3.4 Ensure API client tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify both functions handle success and error cases

**Acceptance Criteria:**
- All 4 tests pass
- `postGenerateArtifact` correctly calls POST `/api/chat/v2/generate` and parses the response
- `postSaveArtifact` correctly calls POST `/api/chat/v2/save-artifact` and parses the response
- Both functions throw on non-2xx responses
- Existing `postChatV2`, `getThreadHistory`, and `postHandoff` functions are unaffected

---

### Frontend Components Layer

#### Task Group 4: MessageBubble Updates and Question Normalization
**Dependencies:** Task Group 3 (types used by new components)
**Assignee Profile:** Frontend engineer (React, TypeScript)

Updates `MessageBubble.tsx` to handle plain string question arrays from the PM task, and adds type guards for the two new structured response types (`artifact-preview` and `completion-chip`). Also adds new callback props for artifact and transcript actions.

- [x] 4.0 Complete MessageBubble updates and question normalization
  - [x] 4.1 Write 6 focused tests for MessageBubble changes
    - Test that `hasQuestions` returns true when `structuredResponse.questions` is an array of plain strings like `["Q1", "Q2"]`
    - Test that `extractQuestions` normalizes plain string `"Q1"` into `{ id: 'q-0', question: 'Q1' }` object format
    - Test that `extractQuestions` passes through existing `{ id, question }` objects unchanged
    - Test that `isArtifactPreview` returns true for `{ type: 'artifact-preview', markdownContent: '...' }`
    - Test that `isCompletionChip` returns true for `{ type: 'completion-chip', taskId: '...', personaId: '...', artifactName: '...' }`
    - Test that `MessageBubble` renders `ArtifactPreviewBubble` when `structuredResponse.type === 'artifact-preview'` and `onConfirmArtifact` is provided
  - [x] 4.2 Update `hasQuestions` type guard in `MessageBubble.tsx` (line 57-66)
    - Modify the check to also detect arrays of plain strings:
      ```typescript
      function hasQuestions(sr: unknown): boolean {
        if (sr == null || typeof sr !== 'object') return false;
        const obj = sr as Record<string, unknown>;
        const qs = obj.questions ?? obj.openQuestions;
        if (!Array.isArray(qs) || qs.length === 0) return false;
        // Accept arrays of strings OR arrays of {id, question} objects
        return typeof qs[0] === 'string' || (typeof qs[0] === 'object' && qs[0] !== null && 'question' in qs[0]);
      }
      ```
  - [x] 4.3 Update `extractQuestions` function in `MessageBubble.tsx` (lines 71-77)
    - Normalize plain string items into `{ id, question }` objects with auto-generated IDs:
      ```typescript
      function extractQuestions(sr: Record<string, unknown>): Array<{ id: string; question: string }> {
        const raw = (Array.isArray(sr.questions) && sr.questions.length > 0)
          ? sr.questions
          : (Array.isArray(sr.openQuestions) && sr.openQuestions.length > 0)
            ? sr.openQuestions
            : [];
        return raw.map((item: unknown, index: number) => {
          if (typeof item === 'string') {
            return { id: `q-${index}`, question: item };
          }
          return item as { id: string; question: string };
        });
      }
      ```
  - [x] 4.4 Add new type guards for `artifact-preview` and `completion-chip`
    - Add `isArtifactPreview(sr)` type guard after `hasQuestions` (after line 66):
      ```typescript
      function isArtifactPreview(
        sr: unknown
      ): sr is { type: 'artifact-preview'; markdownContent: string } {
        if (sr == null || typeof sr !== 'object') return false;
        const obj = sr as Record<string, unknown>;
        return obj.type === 'artifact-preview' && typeof obj.markdownContent === 'string';
      }
      ```
    - Add `isCompletionChip(sr)` type guard after `isArtifactPreview`:
      ```typescript
      function isCompletionChip(
        sr: unknown
      ): sr is { type: 'completion-chip'; taskId: string; personaId: string; artifactName: string; artifactId: string; timestamp: string } {
        if (sr == null || typeof sr !== 'object') return false;
        const obj = sr as Record<string, unknown>;
        return obj.type === 'completion-chip' && typeof obj.taskId === 'string' && typeof obj.artifactName === 'string';
      }
      ```
  - [x] 4.5 Add new optional callback props to `MessageBubbleProps` (line 30-37)
    - Add to the `MessageBubbleProps` interface:
      ```typescript
      /** Callback when user confirms an artifact preview */
      onConfirmArtifact?: () => void;
      /** Callback when user rejects an artifact preview */
      onRejectArtifact?: () => void;
      /** Callback to download the transcript for a completed segment */
      onDownloadTranscript?: () => void;
      /** Whether this message is in a sealed segment (disables interactions) */
      disabled?: boolean;
      /** Whether an artifact confirmation is in progress */
      isConfirmingArtifact?: boolean;
      ```
  - [x] 4.6 Add rendering branches for new structured response types
    - In the component body (around lines 90-93 where type checks occur), add checks:
      ```typescript
      const showArtifactPreview = isArtifactPreview(structuredResponse);
      const showCompletionChip = isCompletionChip(structuredResponse);
      ```
    - In the JSX (inside the bubble div, around lines 132-161), add:
      - When `showArtifactPreview && onConfirmArtifact`: render `<ArtifactPreviewBubble markdownContent={structuredResponse.markdownContent} onConfirm={onConfirmArtifact} onReject={onRejectArtifact!} isConfirming={isConfirmingArtifact || false} disabled={disabled || false} />` (import from `./ArtifactPreviewBubble`)
      - When `showCompletionChip && onDownloadTranscript`: render `<CompletionChip taskLabel={(structuredResponse as any).taskId} personaColor={personaConfig?.color || '#9E9E9E'} artifactName={(structuredResponse as any).artifactName} timestamp={(structuredResponse as any).timestamp} onDownloadTranscript={onDownloadTranscript} />` (import from `./CompletionChip`)
    - Pass `disabled` prop through to `StructuredQuestionsRenderer` at line 156-158:
      ```typescript
      <StructuredQuestionsRenderer
        questions={questions}
        onSubmitAnswers={onSubmitAnswers}
        disabled={disabled}
      />
      ```
  - [x] 4.7 Ensure MessageBubble tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify question normalization works for both plain strings and structured objects
    - Verify new type guards correctly identify artifact-preview and completion-chip types

**Acceptance Criteria:**
- All 6 tests pass
- Plain string question arrays like `["Q1", "Q2"]` are normalized to `[{ id: 'q-0', question: 'Q1' }, { id: 'q-1', question: 'Q2' }]`
- Existing `{ id, question }` arrays pass through unchanged
- New type guards correctly identify `artifact-preview` and `completion-chip` structured responses
- New callback props are wired to `ArtifactPreviewBubble` and `CompletionChip` components
- `StructuredQuestionsRenderer` receives the `disabled` prop for sealed segments

---

#### Task Group 5: ArtifactPreviewBubble and CompletionChip Components
**Dependencies:** Task Group 4 (MessageBubble knows how to render them)
**Assignee Profile:** Frontend engineer (React, CSS)

Creates the two new leaf components that MessageBubble delegates to for artifact preview and completion chip rendering.

- [x] 5.0 Complete ArtifactPreviewBubble and CompletionChip components
  - [x] 5.1 Write 6 focused tests for the new components
    - Test `ArtifactPreviewBubble` renders markdown content as HTML (heading detection: `# Heading` renders as bold/large text)
    - Test `ArtifactPreviewBubble` renders Confirm and Reject buttons; Confirm button shows spinner text when `isConfirming` is true
    - Test `ArtifactPreviewBubble` calls `onConfirm` when Confirm is clicked
    - Test `ArtifactPreviewBubble` disables both buttons when `disabled` is true
    - Test `CompletionChip` renders task label, artifact name, and download transcript button
    - Test `CompletionChip` calls `onDownloadTranscript` when the download button is clicked
  - [x] 5.2 Create `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`
    - Props interface:
      ```typescript
      export interface ArtifactPreviewBubbleProps {
        markdownContent: string;
        onConfirm: () => void;
        onReject: () => void;
        isConfirming: boolean;
        disabled: boolean;
      }
      ```
    - Render a bordered container with header label "Generated MISSION.MD" and subtle background tint
    - Render `markdownContent` as HTML using a lightweight line-by-line approach:
      - Lines starting with `# ` -> `<h1>`, `## ` -> `<h2>`, `### ` -> `<h3>`
      - Lines starting with `- ` or `* ` -> `<li>` items inside `<ul>`
      - Lines starting with `**` -> bold text
      - Lines starting with `> ` -> `<blockquote>`
      - All other lines -> `<p>` elements
      - No heavy markdown library -- keep the renderer under 50 lines
    - Display two action buttons below the preview:
      - "Confirm" button: primary style with green tint (`background: #2E7D32`); shows "Saving..." when `isConfirming` is true; calls `onConfirm` on click
      - "Reject" button: secondary/outlined style; calls `onReject` on click
      - Both buttons disabled when `disabled` prop is true or `isConfirming` is true
    - Max-height container with `overflow-y: auto` for long content
    - `data-testid="artifact-preview-bubble"`
  - [x] 5.3 Create `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.module.css`
    - `.container`: `border: 1px solid #e0e0e0`, `border-radius: 8px`, `background: #f5faf5`, `padding: 16px`, `max-height: 400px`, `overflow-y: auto`
    - `.header`: `font-size: 13px`, `font-weight: 600`, `color: #2E7D32`, `margin-bottom: 12px`
    - `.content`: markdown content area with base typography styles
    - `.actions`: `display: flex`, `gap: 8px`, `margin-top: 16px`, `justify-content: flex-end`
    - `.confirmButton`: green-tinted primary button
    - `.rejectButton`: outlined secondary button
    - `.confirmButton:disabled, .rejectButton:disabled`: reduced opacity
  - [x] 5.4 Create `frontend/src/components/UnifiedChat/CompletionChip.tsx`
    - Props interface:
      ```typescript
      export interface CompletionChipProps {
        taskLabel: string;
        personaColor: string;
        artifactName: string;
        timestamp: string;
        onDownloadTranscript: () => void;
      }
      ```
    - Render as a distinct horizontal pill/chip (not a regular message bubble):
      - Persona-colored left border (`border-left: 3px solid ${personaColor}`)
      - Task label text in bold (e.g., "Product Definition Complete")
      - Artifact name as a muted secondary label (e.g., "MISSION.MD")
      - Small download icon/button (use lucide-react `Download` icon, 16px) that calls `onDownloadTranscript`
    - Static chip with no expand/collapse for this increment
    - `data-testid="completion-chip"`
  - [x] 5.5 Create `frontend/src/components/UnifiedChat/CompletionChip.module.css`
    - `.chip`: `display: flex`, `align-items: center`, `gap: 12px`, `padding: 10px 16px`, `background: #fafafa`, `border-radius: 6px`, `border: 1px solid #e0e0e0`, `margin: 8px 0`
    - `.taskLabel`: `font-size: 13px`, `font-weight: 600`
    - `.artifactName`: `font-size: 12px`, `color: #757575`
    - `.downloadButton`: icon button, `cursor: pointer`, `color: #5C6BC0`, hover highlight
  - [x] 5.6 Ensure component tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify rendering and interaction behaviors

**Acceptance Criteria:**
- All 6 tests pass
- `ArtifactPreviewBubble` renders markdown preview with Confirm/Reject buttons
- Confirm button shows "Saving..." when `isConfirming` is true
- Both buttons are disabled when `disabled` is true
- `CompletionChip` renders as a pill with persona color accent, task label, artifact name, and download button
- Components have clean CSS modules following existing project conventions

---

#### Task Group 6: Transcript Download Utility
**Dependencies:** Task Group 5 (CompletionChip needs onDownloadTranscript)
**Assignee Profile:** Frontend engineer (TypeScript)

Creates the transcript export utility that formats a task segment's messages as a downloadable markdown file.

- [x] 6.0 Complete transcript download utility
  - [x] 6.1 Write 3 focused tests for transcript export
    - Test `buildTranscriptMarkdown` filters messages to the specified `taskId` and formats user messages with "### You" and assistant messages with "### Product Manager"
    - Test `buildTranscriptMarkdown` appends artifact content as an appendix section with the marker `> Saved artifact: agent-os/product/MISSION.MD`
    - Test `downloadMarkdownFile` triggers a browser download (mock `URL.createObjectURL` and verify a link click is simulated)
  - [x] 6.2 Create `frontend/src/utils/transcriptExport.ts`
    - Import `ThreadMessage` from `../api/chatV2Api`
    - Import `getPersonaConfig` from `../config/personaConfig`
    - Implement `buildTranscriptMarkdown(messages: ThreadMessage[], taskId: string, artifactContent: string): string`:
      - Filter messages to those where `msg.taskId === taskId` (include system messages for context)
      - Format each message as a markdown section:
        - User messages: `### You\n\n{content}\n\n`
        - Assistant messages: `### {personaDisplayName}\n\n{content}\n\n` (look up display name via `getPersonaConfig(msg.personaId)`)
        - System messages: `> *{content}*\n\n` (italic blockquote)
      - Append an appendix section at the end:
        ```
        ---\n\n## Appendix: Generated Artifact\n\n> Saved artifact: agent-os/product/MISSION.MD\n\n{artifactContent}
        ```
      - Return the complete markdown string
    - Implement `downloadMarkdownFile(content: string, filename: string): void`:
      - Create a Blob with `type: 'text/markdown'`
      - Create object URL via `URL.createObjectURL(blob)`
      - Create a temporary `<a>` element, set `href` and `download` attributes
      - Trigger click, then revoke object URL
  - [x] 6.3 Ensure transcript tests pass
    - Run ONLY the 3 tests written in 6.1
    - Verify markdown formatting and download trigger

**Acceptance Criteria:**
- All 3 tests pass
- `buildTranscriptMarkdown` produces well-formatted markdown with persona-attributed sections
- Final artifact content is appended as an appendix with the saved artifact marker
- `downloadMarkdownFile` triggers a browser file download

---

### Hook Layer

#### Task Group 7: useChatThread Hook Extensions
**Dependencies:** Task Groups 3 (API client), 4 (type guards), 5 (component props), 6 (transcript utility)
**Assignee Profile:** Frontend engineer (React hooks, TypeScript)

Extends `useChatThread` with generation, confirmation, rejection flows, phase detection, sealed segment tracking, and dashboard re-fetch callback wiring. Also updates `ChatThread` and `UnifiedChatPanel` to wire the new props.

- [x] 7.0 Complete useChatThread hook extensions and wiring
  - [x] 7.1 Write 8 focused tests for hook extensions
    - Test `generateArtifact` calls `postGenerateArtifact` and on success appends an assistant message with `structuredResponse.type === 'artifact-preview'` and sets `artifactPreview` state
    - Test `generateArtifact` on failure appends a system error message and does NOT set `artifactPreview`
    - Test `confirmArtifact` calls `postSaveArtifact` and on success appends a completion chip message, clears `artifactPreview`, and calls `onArtifactSaved` callback
    - Test `confirmArtifact` on failure appends a system error message and keeps `artifactPreview` available
    - Test `rejectArtifact` clears `artifactPreview`, sends a follow-up "I'd like to make changes." message
    - Test that when latest assistant message has `structuredResponse.phase === 'ready'` and user sends a confirmation message, `generateArtifact` is auto-triggered
    - Test `sealedTaskIds` computation: when messages contain a completion chip with `taskId: 'product-manager--define-product'`, that taskId is in the sealed set
    - Test that the hook returns `isGenerating`, `isSaving`, `artifactPreview`, `sealedTaskIds` in the return object
  - [x] 7.2 Add new state and refs to `useChatThread` hook in `frontend/src/hooks/useChatThread.ts`
    - After line 111 (`const [error, setError] = ...`), add:
      ```typescript
      const [isGenerating, setIsGenerating] = useState<boolean>(false);
      const [isSaving, setIsSaving] = useState<boolean>(false);
      const [artifactPreview, setArtifactPreview] = useState<{ taskId: string; content: string } | null>(null);
      ```
    - Add imports at top of file:
      ```typescript
      import { postGenerateArtifact, postSaveArtifact } from '../api/chatV2Api';
      ```
  - [x] 7.3 Add `sealedTaskIds` computed value
    - After the state declarations, add a `useMemo` computation:
      ```typescript
      const sealedTaskIds = useMemo(() => {
        const sealed = new Set<string>();
        for (const msg of messages) {
          const sr = msg.structuredResponse as { type?: string; taskId?: string } | null;
          if (sr && sr.type === 'completion-chip' && sr.taskId) {
            sealed.add(sr.taskId);
          }
        }
        return sealed;
      }, [messages]);
      ```
    - Import `useMemo` from React
  - [x] 7.4 Implement `generateArtifact(taskId: string): Promise<void>`
    - Add as a `useCallback` after the existing `selectTask` function (after line 338):
      ```typescript
      const generateArtifact = useCallback(async (taskId: string) => {
        setIsGenerating(true);
        setError(null);
        try {
          const result = await postGenerateArtifact(
            threadKeyRef.current,
            activePersonaIdRef.current,
            taskId
          );
          if (result.success && result.missionMarkdown) {
            // Insert artifact preview message
            const previewMessage: ThreadMessage = {
              id: generateMessageId(),
              role: 'assistant',
              personaId: activePersonaIdRef.current,
              taskId: taskId,
              content: '',
              structuredResponse: {
                type: 'artifact-preview',
                markdownContent: result.missionMarkdown,
              },
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, previewMessage]);
            setArtifactPreview({ taskId, content: result.missionMarkdown });
          } else {
            // Insert error message
            const errorMsg: ThreadMessage = {
              id: generateMessageId(),
              role: 'system',
              personaId: null,
              taskId: null,
              content: `Mission generation failed: ${result.error || 'Unknown error'}. You can try again.`,
              structuredResponse: null,
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, errorMsg]);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Generation failed';
          const errorMsg: ThreadMessage = {
            id: generateMessageId(),
            role: 'system',
            personaId: null,
            taskId: null,
            content: `Mission generation failed: ${errorMessage}. You can try again.`,
            structuredResponse: null,
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errorMsg]);
        } finally {
          setIsGenerating(false);
        }
      }, []);
      ```
  - [x] 7.5 Implement `confirmArtifact(): Promise<void>`
    - Add a `useCallback` that references `onArtifactSaved` callback from options:
    - Update `UseChatThreadOptions` interface to add `onArtifactSaved?: () => void`
    - Store the callback in a ref: `const onArtifactSavedRef = useRef(options?.onArtifactSaved);` and keep it updated
    - Implementation:
      ```typescript
      const confirmArtifact = useCallback(async () => {
        if (!artifactPreview) return;
        setIsSaving(true);
        setError(null);
        try {
          const result = await postSaveArtifact(
            threadKeyRef.current,
            artifactPreview.taskId,
            'mission-md',
            artifactPreview.content
          );
          if (result.success) {
            // Insert completion chip (optimistic -- backend also persists it)
            const chipMessage: ThreadMessage = {
              id: generateMessageId(),
              role: 'assistant',
              personaId: activePersonaIdRef.current,
              taskId: artifactPreview.taskId,
              content: 'Product Definition complete.',
              structuredResponse: {
                type: 'completion-chip',
                artifactId: 'mission-md',
                artifactName: 'MISSION.MD',
                taskId: artifactPreview.taskId,
                personaId: activePersonaIdRef.current,
                timestamp: new Date().toISOString(),
              },
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, chipMessage]);
            setArtifactPreview(null);
            // Trigger dashboard re-fetch
            onArtifactSavedRef.current?.();
          } else {
            const errorMsg: ThreadMessage = {
              id: generateMessageId(),
              role: 'system',
              personaId: null,
              taskId: null,
              content: `Failed to save MISSION.md: ${result.error || 'Unknown error'}. Click Confirm to retry.`,
              structuredResponse: null,
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, errorMsg]);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Save failed';
          const isTimeout = errorMessage.toLowerCase().includes('timeout');
          const errorMsg: ThreadMessage = {
            id: generateMessageId(),
            role: 'system',
            personaId: null,
            taskId: null,
            content: isTimeout
              ? 'Save timed out. Please try again.'
              : `Failed to save MISSION.md: ${errorMessage}. Click Confirm to retry.`,
            structuredResponse: null,
            timestamp: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errorMsg]);
        } finally {
          setIsSaving(false);
        }
      }, [artifactPreview]);
      ```
  - [x] 7.6 Implement `rejectArtifact(): Promise<void>`
    - Add a `useCallback`:
      ```typescript
      const rejectArtifact = useCallback(async () => {
        setArtifactPreview(null);
        // Send a follow-up message to resume discovery
        await sendMessage("I'd like to make changes.");
      }, [sendMessage]);
      ```
  - [x] 7.7 Add phase detection: auto-trigger `generateArtifact` after user confirms readiness
    - In `sendMessage`, after the assistant response is processed (after the `setMessages` call that appends the assistant message, around line 235), add a check:
      ```typescript
      // Auto-trigger generation when PM returns phase='ready' and user confirms
      const sr = response.structuredResponse as { phase?: string } | null;
      if (sr && sr.phase === 'ready') {
        // The NEXT user message after a 'ready' phase triggers generation
        // Store a flag; generation is triggered after the next sendMessage completes
        // Actually: the spec says "when the user sends a confirmation-like message"
        // after seeing phase=ready, auto-trigger generateArtifact
        // We handle this by checking the PREVIOUS assistant message for phase=ready
        // before sending the current message
      }
      ```
    - Actually implement this at the TOP of `sendMessage` (before the API call), since the detection should happen when the user SENDS a message while the last assistant response has `phase === 'ready'`:
      ```typescript
      // Check if the latest assistant message has phase='ready' -- if so, this
      // user message is a confirmation, and we should auto-trigger generation
      const latestAssistant = messages.findLast(m => m.role === 'assistant');
      const latestSr = latestAssistant?.structuredResponse as { phase?: string } | null;
      if (latestSr && latestSr.phase === 'ready' && !artifactPreview) {
        // User is confirming readiness -- send the message, then generate
        // Append user message optimistically first
        const userMessage: ThreadMessage = { /* ... same as existing ... */ };
        setMessages(prev => [...prev, userMessage]);
        // Trigger generation using the current taskId
        await generateArtifact(activeTaskIdRef.current);
        return; // Skip the normal sendMessage flow
      }
      ```
    - NOTE: This replaces the v1 `isMissionConfirmation()` server-side detection -- in v2, the frontend detects phase=ready and triggers generation
  - [x] 7.8 Add `missionExists` warning for re-run flow
    - Update `UseChatThreadOptions` to add `missionExists?: boolean`
    - Store in a ref: `const missionExistsRef = useRef(options?.missionExists ?? false);`
    - In `selectTask`, after setting the active task to `'product-manager--define-product'`, check `missionExistsRef.current`:
      ```typescript
      if (taskId === 'product-manager--define-product' && missionExistsRef.current) {
        const warningMsg: ThreadMessage = {
          id: generateMessageId(),
          role: 'system',
          personaId: null,
          taskId: null,
          content: 'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.',
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, warningMsg]);
      }
      ```
  - [x] 7.9 Update hook return type to include new values
    - Update `UseChatThreadReturn` interface:
      ```typescript
      isGenerating: boolean;
      isSaving: boolean;
      artifactPreview: { taskId: string; content: string } | null;
      sealedTaskIds: Set<string>;
      generateArtifact: (taskId: string) => Promise<void>;
      confirmArtifact: () => Promise<void>;
      rejectArtifact: () => Promise<void>;
      ```
    - Update the return statement to include all new values
  - [x] 7.10 Update `ChatThread.tsx` to pass new props through to `MessageBubble`
    - Add new props to `ChatThreadProps` interface in `frontend/src/components/UnifiedChat/ChatThread.tsx` (line 26-35):
      ```typescript
      onConfirmArtifact?: () => void;
      onRejectArtifact?: () => void;
      onDownloadTranscript?: () => void;
      sealedTaskIds?: Set<string>;
      isConfirmingArtifact?: boolean;
      ```
    - In the `messages.map` loop (line 100-107), pass through to each `MessageBubble`:
      ```typescript
      <MessageBubble
        key={message.id}
        message={message}
        onSelectTask={onSelectTask}
        onSubmitAnswers={onSubmitAnswers}
        onConfirmArtifact={onConfirmArtifact}
        onRejectArtifact={onRejectArtifact}
        onDownloadTranscript={onDownloadTranscript}
        disabled={sealedTaskIds?.has(message.taskId || '') || false}
        isConfirmingArtifact={isConfirmingArtifact}
      />
      ```
  - [x] 7.11 Update `UnifiedChatPanel.tsx` to wire new hook values to ChatThread
    - Destructure new values from `useChatThread` (line 88-95):
      ```typescript
      const {
        messages,
        activePersonaId,
        activeTaskId,
        isLoading,
        isGenerating,
        isSaving,
        artifactPreview,
        sealedTaskIds,
        sendMessage,
        selectPersona,
        selectTask,
        confirmArtifact,
        rejectArtifact,
      } = useChatThread(threadKey, { initialPersonaId, allowedPersonaIds, onArtifactSaved, missionExists });
      ```
    - Add `onArtifactSaved` and `missionExists` to `UnifiedChatPanelProps` interface (line 66-73):
      ```typescript
      onArtifactSaved?: () => void;
      missionExists?: boolean;
      ```
    - Add a `handleDownloadTranscript` callback using the transcript utility:
      ```typescript
      const handleDownloadTranscript = useCallback(() => {
        const taskId = 'product-manager--define-product';
        const artifactContent = artifactPreview?.content || '';
        const md = buildTranscriptMarkdown(messages, taskId, artifactContent);
        downloadMarkdownFile(md, 'pm-define-product-transcript.md');
      }, [messages, artifactPreview]);
      ```
    - Import `buildTranscriptMarkdown` and `downloadMarkdownFile` from `../../utils/transcriptExport`
    - Pass new props to `ChatThread`:
      ```typescript
      <ChatThread
        messages={messages}
        isLoading={isLoading || isGenerating}
        onSelectTask={selectTask}
        onSubmitAnswers={handleSubmitAnswers}
        onConfirmArtifact={confirmArtifact}
        onRejectArtifact={rejectArtifact}
        onDownloadTranscript={handleDownloadTranscript}
        sealedTaskIds={sealedTaskIds}
        isConfirmingArtifact={isSaving}
      />
      ```
  - [x] 7.12 Update `DashboardView.tsx` to pass `onArtifactSaved` and `missionExists` to `UnifiedChatPanel`
    - At line 502-507, update the `UnifiedChatPanel` render:
      ```typescript
      <UnifiedChatPanel
        threadKey={chatThreadKey}
        initialPersonaId="assistant"
        onArtifactSaved={fetchData}
        missionExists={data?.strategicFoundation?.productDefinition?.missionExists?.value === 1}
      />
      ```
    - `fetchData` is the existing callback (line 137) that re-fetches dashboard data
    - `missionExists` is derived from the current dashboard data
  - [x] 7.13 Ensure hook extension tests pass
    - Run ONLY the 8 tests written in 7.1
    - Verify generation, confirmation, rejection, phase detection, sealed segments, and re-run warning

**Acceptance Criteria:**
- All 8 tests pass
- `generateArtifact` calls the backend, inserts an artifact-preview message on success, inserts error on failure
- `confirmArtifact` calls the backend, inserts a completion chip on success, keeps preview available on failure
- `rejectArtifact` clears the preview and resumes discovery
- Phase detection auto-triggers generation when user confirms after `phase === 'ready'`
- `sealedTaskIds` correctly identifies completed task segments
- `missionExists` warning appears when re-running a completed PM conversation
- `DashboardView` re-fetches dashboard data after successful artifact save
- All prop wiring through `ChatThread` and `UnifiedChatPanel` is correct

---

### Test Review

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7 (all implementation complete)
**Assignee Profile:** Test engineer / full-stack engineer

Reviews all tests written by prior task groups, identifies critical coverage gaps in the end-to-end PM bootstrap flow, and adds up to 10 additional strategic tests.

- [x] 8.0 Review all tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2 tests from Task Group 1 (task definition validation)
    - Review the 6 tests from Task Group 2 (backend generate + save endpoints)
    - Review the 4 tests from Task Group 3 (API client additions)
    - Review the 6 tests from Task Group 4 (MessageBubble updates)
    - Review the 6 tests from Task Group 5 (ArtifactPreviewBubble + CompletionChip)
    - Review the 3 tests from Task Group 6 (transcript export)
    - Review the 8 tests from Task Group 7 (useChatThread extensions)
    - Total existing tests: 35
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's PM bootstrap flow requirements
    - Do NOT assess entire application test coverage
    - Prioritize the following workflows:
      - Full end-to-end: user answers questions -> phase=ready -> confirm -> generate -> preview -> confirm save -> completion chip appears -> dashboard updates
      - Error recovery: generation fails -> retry -> success
      - Error recovery: save fails -> retry -> success
      - Sealed segment: questions in sealed segment are disabled
      - Re-run flow: missionExists warning appears
  - [x] 8.3 Write up to 10 additional strategic tests to fill critical gaps
    - Possible gap areas (assess and add only where critical coverage is missing):
      - End-to-end: POST `/generate` endpoint reads correct thread messages filtered by taskId
      - End-to-end: POST `/save-artifact` completion chip is persisted to thread on disk
      - Integration: `hasQuestions` correctly handles mixed array types (edge case: array with both strings and objects)
      - Integration: `extractQuestions` handles empty arrays gracefully
      - Integration: `ArtifactPreviewBubble` renders multi-line markdown with headings and bullets
      - Integration: CompletionChip download button triggers `buildTranscriptMarkdown` with correct arguments
      - Integration: Dashboard re-fetch callback fires after successful `confirmArtifact`
      - Integration: Phase detection does NOT trigger generation if `artifactPreview` is already set
      - Edge case: `generateArtifact` handles network timeout gracefully
      - Edge case: `rejectArtifact` resumes conversation with correct persona and task
    - Add a maximum of 10 new tests to fill identified gaps
    - Do NOT write exhaustive edge-case or stress tests
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 35-45 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 35-45 total)
- Critical end-to-end PM bootstrap workflows are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's PM bootstrap flow requirements
- Error handling and retry flows have at least basic coverage

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Task Definition Update          (no dependencies)
    |
Task Group 2: Backend Endpoints               (depends on 1)
    |
Task Group 3: Frontend API Client             (depends on 2)
    |
    +---> Task Group 4: MessageBubble Updates  (depends on 3 for types)
    |         |
    |         v
    |     Task Group 5: New Components         (depends on 4)
    |         |
    |         v
    |     Task Group 6: Transcript Utility     (depends on 5)
    |
    +---> Task Group 7: Hook Extensions + Wiring  (depends on 3, 4, 5, 6)
              |
              v
          Task Group 8: Test Review            (depends on 1-7)
```

**Parallelizable work:**
- Task Groups 4 and 5 can begin as soon as Task Group 3 is complete (they need types but not the full hook)
- Task Group 6 (transcript utility) is independent of backend work and can overlap with Groups 4-5
- Task Group 7 depends on all frontend groups (3, 4, 5, 6) since it wires everything together
- Task Group 8 runs last as a review and gap-fill pass

**Sequential constraints:**
- Task Group 2 must complete before Task Group 3 (frontend API client needs backend endpoints)
- Task Group 4 must complete before Task Group 5 (MessageBubble must know how to render the new components)
- Task Group 7 must complete after all frontend groups (it integrates everything into useChatThread, ChatThread, UnifiedChatPanel, and DashboardView)

---

## File Inventory

### New Files to Create
| File | Task Group | Purpose |
|------|-----------|---------|
| `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx` | 5 | Inline markdown preview with Confirm/Reject buttons |
| `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.module.css` | 5 | Styles for artifact preview bubble |
| `frontend/src/components/UnifiedChat/CompletionChip.tsx` | 5 | Sealed segment completion chip with transcript download |
| `frontend/src/components/UnifiedChat/CompletionChip.module.css` | 5 | Styles for completion chip |
| `frontend/src/utils/transcriptExport.ts` | 6 | Transcript markdown builder and file download utility |

### Existing Files to Modify
| File | Task Group | Change |
|------|-----------|--------|
| `gateway/src/config/tasks/product-manager--define-product.json` | 1 | Add `artifacts` array with `mission-md` entry |
| `gateway/src/routes/chatV2.ts` | 2 | Add POST `/generate` and POST `/save-artifact` handlers; add imports for `MISSION_GENERATION_PROMPT_TEMPLATE`, `TOOL_DEFINITIONS`, `fetchProductName`, `executeToolCall`, `getConfig` |
| `gateway/src/routes/dashboardSummary.ts` | 2 | Add real MISSION.MD existence check for Product Definition card |
| `frontend/src/api/chatV2Api.ts` | 3 | Add `postGenerateArtifact` and `postSaveArtifact` functions |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | 4 | Update `hasQuestions`/`extractQuestions` for plain strings; add `isArtifactPreview`/`isCompletionChip` type guards; add new callback props; add rendering branches for new types; pass `disabled` to `StructuredQuestionsRenderer` |
| `frontend/src/hooks/useChatThread.ts` | 7 | Add `isGenerating`, `isSaving`, `artifactPreview`, `sealedTaskIds` state; add `generateArtifact`, `confirmArtifact`, `rejectArtifact` functions; add phase detection in `sendMessage`; add `missionExists` warning in `selectTask`; update `UseChatThreadOptions` and `UseChatThreadReturn` |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | 7 | Add new props to `ChatThreadProps`; pass `onConfirmArtifact`, `onRejectArtifact`, `onDownloadTranscript`, `disabled`, `isConfirmingArtifact` through to `MessageBubble` |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | 7 | Add `onArtifactSaved` and `missionExists` props; destructure new hook values; add `handleDownloadTranscript` callback; wire all new props to `ChatThread` |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 7 | Pass `onArtifactSaved={fetchData}` and `missionExists` to `UnifiedChatPanel` |

### Existing Files NOT Modified
| File | Reason |
|------|--------|
| `gateway/src/routes/chat.ts` | Existing v1 endpoint remains untouched |
| `gateway/src/services/promptBuilder.ts` | `MISSION_GENERATION_PROMPT_TEMPLATE` is imported and reused, not modified |
| `gateway/src/services/toolExecutor.ts` | `executeToolCall` is imported and reused, not modified |
| `gateway/src/services/architectureModelClient.ts` | `fetchProductName` is imported and reused, not modified |
| `gateway/src/services/openaiClient.ts` | `sendChatRequest` is reused as-is |
| `gateway/src/services/threadStore.ts` | `getThread`, `appendMessage` are reused as-is |
| `gateway/src/services/contextResolvers.ts` | Context resolvers remain stubs; transcript assembly is internal |
| `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` | V1 PM chat panel remains fully functional until Increment 10 |
| `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx` | Already accepts `disabled` prop -- no changes needed |
| `frontend/src/components/UnifiedChat/TaskMenu.tsx` | No changes needed |
| `frontend/src/config/personaConfig.ts` | Read-only usage for persona config lookups |

### Existing Files Referenced (read-only patterns)
| File | Purpose |
|------|---------|
| `gateway/src/routes/chat.ts` lines 1580-1704 | V1 mission generation flow pattern (discovery messages, tool restriction, tool call extraction) |
| `gateway/src/services/promptBuilder.ts` line 664 | `MISSION_GENERATION_PROMPT_TEMPLATE` constant to import |
| `gateway/src/types/tools.ts` lines 281-304 | `save_product_artifacts` tool definition for filtering |
| `gateway/src/types/tools.ts` lines 143-154 | `SaveProductArtifactsParams` interface for argument shape reference |
| `gateway/src/services/toolExecutor.ts` lines 205-260 | `executeToolCall` function signature |
| `gateway/src/services/architectureModelClient.ts` line 441 | `fetchProductName` function signature |
| `gateway/src/config.ts` line 52 | `conversationPersistBasePath` config field |
| `gateway/src/services/openaiClient.ts` lines 118-163 | `ChatRequestOptions` with `tools` and `toolChoice` fields |
| `gateway/src/services/dashboardSummaryMockService.ts` lines 81-85 | `ProductDefinitionMetrics` mock values to override |
