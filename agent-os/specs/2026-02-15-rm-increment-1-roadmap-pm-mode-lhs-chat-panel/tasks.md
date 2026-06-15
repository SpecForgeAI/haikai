# Task Breakdown: RM Increment 1 -- Roadmap PM Mode + LHS Chat Panel (Tool-less, No Saving)

## Overview
Total Tasks: 46 (across 6 task groups)

This spec introduces a new `roadmap_pm` chat mode in the gateway and a corresponding `RoadmapPmChatPanel` in the frontend, enabling structured roadmap planning conversations with a Senior Product Manager persona on the Roadmap screen. This increment is tool-less and does NOT persist or import any roadmap data -- it only enables the conversation, its structured response contract (with `proposedInitiatives`, `assumptions`, `openItems`), and transcript persistence.

**Systems affected:** Gateway (types, services, routes), Frontend (API types, new component, ProductRoadmapPage layout)
**Systems NOT affected:** mcp-server, architecture-model-service, jira-service

## Task List

### Gateway Types & Configuration

#### Task Group 1: Gateway Types, Transcript Config, and Service Exports
**Dependencies:** None

- [x] 1.0 Complete gateway types and configuration layer
  - [x] 1.1 Write 5 focused tests for RM type definitions and transcript kind validation
    - Test that `'roadmap_pm'` is accepted by `normalizeKind()` in `transcriptWriter.ts` (currently `['implement', 'product', 'solution_architect']` are allowed)
    - Test that `RoadmapPmResponse` interface fields serialize/deserialize correctly (phase, section, questions, summary, proposedInitiatives, assumptions, openItems -- all 7 fields)
    - Test that `RoadmapPmValidationResult` follows the same shape as `SolutionArchitectValidationResult` (valid, roadmapPmResponse, error)
    - Test that `ChatResponse` can carry an optional `roadmapPmResponse` field alongside existing fields
    - Test that `ChatMode` union accepts `'roadmap_pm'` as a valid value
  - [x] 1.2 Extend `ChatMode` union type in `gateway/src/types/chat.ts`
    - File: `gateway/src/types/chat.ts`, line 83
    - Change: `export type ChatMode = 'oas_assistant' | 'implement_feature' | 'product_manager' | 'solution_architect';` to include `| 'roadmap_pm'`
    - Update the JSDoc comment (lines 76-82) to document the new mode: `"roadmap_pm": Roadmap PM persona for structured roadmap planning (Spec 2026-02-15: RM Increment 1)`
  - [x] 1.3 Add `RoadmapPmResponse` interface to `gateway/src/types/chat.ts`
    - Place after `SolutionArchitectValidationResult` interface (after line 724)
    - Fields:
      - `phase`: `'questions' | 'ready'`
      - `section`: `'roadmap_existence_check' | 'outcome_alignment' | 'architecture_alignment' | 'sequencing_strategy' | 'initiative_structure' | 'epic_structure' | 'final_review'`
      - `questions`: `string[]`
      - `summary`: `string`
      - `proposedInitiatives`: `Array<{ title: string; description: string; epics: Array<{ title: string; description: string }> }>`
      - `assumptions`: `string[]`
      - `openItems`: `string[]`
    - Include JSDoc referencing this spec, documenting 7 discovery sections and 7 response fields
    - Note: This is the richest structured response type in the system (7 fields vs SA's 4 and PM's 3)
  - [x] 1.4 Add `RoadmapPmValidationResult` interface to `gateway/src/types/chat.ts`
    - Place after `RoadmapPmResponse`
    - Fields: `valid: boolean`, `roadmapPmResponse?: RoadmapPmResponse`, `error?: string`
    - Follow pattern from `SolutionArchitectValidationResult` (lines 717-724)
  - [x] 1.5 Add `roadmapPmResponse` field to `ChatResponse` interface in `gateway/src/types/chat.ts`
    - File: `gateway/src/types/chat.ts`, inside the `ChatResponse` interface (after `solutionArchitectResponse` at line 840)
    - Add: `roadmapPmResponse?: RoadmapPmResponse;` parallel to `solutionArchitectResponse`
    - Add JSDoc: `Roadmap PM response - populated for mode='roadmap_pm'. Contains structured roadmap planning phase, section, questions, summary, proposedInitiatives, assumptions, and openItems. Spec 2026-02-15: RM Increment 1`
  - [x] 1.6 Export new types from `gateway/src/types/index.ts`
    - Add `RoadmapPmResponse` and `RoadmapPmValidationResult` to the exports from `'./chat'`
    - Place in a new comment section: `// Roadmap PM Response types (Spec 2026-02-15: RM Increment 1)`
  - [x] 1.7 Add `'roadmap_pm'` to `ALLOWED_KINDS` array in `gateway/src/services/transcriptWriter.ts`
    - File: `gateway/src/services/transcriptWriter.ts`, line 42
    - Change: `const ALLOWED_KINDS = ['implement', 'product', 'solution_architect'];` to `const ALLOWED_KINDS = ['implement', 'product', 'solution_architect', 'roadmap_pm'];`
  - [x] 1.8 Ensure gateway types and config tests pass
    - Run ONLY the 5 tests written in 1.1
    - Verify `normalizeKind('roadmap_pm')` does not throw
    - Verify TypeScript compilation succeeds with `npx tsc --noEmit` in the gateway directory
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `ChatMode` union includes `'roadmap_pm'` as a fifth literal value
- `RoadmapPmResponse` interface exists with all 7 fields (phase, section, questions, summary, proposedInitiatives, assumptions, openItems)
- `RoadmapPmValidationResult` interface exists with valid/roadmapPmResponse/error fields
- `ChatResponse` includes optional `roadmapPmResponse` field
- `normalizeKind('roadmap_pm')` resolves without error
- All new types exported from `gateway/src/types/index.ts`
- The 5 tests from 1.1 pass

---

### Gateway Services (Prompt + Validator)

#### Task Group 2: Roadmap PM System Prompt Template and Routing
**Dependencies:** Task Group 1 (completed)

- [x] 2.0 Complete RM system prompt and routing
  - [x] 2.1 Write 4 focused tests for RM prompt template and routing
    - Test that `buildSystemPrompt()` returns `ROADMAP_PM_PROMPT_TEMPLATE` when `context.mode === 'roadmap_pm'`
    - Test that the returned prompt contains the 7 enumerated section names (roadmap_existence_check, outcome_alignment, architecture_alignment, sequencing_strategy, initiative_structure, epic_structure, final_review)
    - Test that the returned prompt contains JSON schema instruction with all 7 response fields (phase, section, questions, summary, proposedInitiatives, assumptions, openItems)
    - Test that when `missionContent` is provided, the returned prompt contains the `=== PRODUCT MISSION ===` delimited section
  - [x] 2.2 Create `ROADMAP_PM_PROMPT_TEMPLATE` constant in `gateway/src/services/promptBuilder.ts`
    - Place after `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` and before `MISSION_GENERATION_PROMPT_TEMPLATE`
    - Follow the structural pattern of `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`:
      - YOUR ROLE section: "Senior Product Manager -- Roadmap Planning" conducting structured roadmap discovery
      - ROADMAP DISCOVERY SECTIONS: enumerate the 7 sections in strict discovery order:
        1. `roadmap_existence_check` -- Understand what roadmap state already exists (imported initiatives, epics, prior planning)
        2. `outcome_alignment` -- Clarify business outcomes, strategic goals, success metrics
        3. `architecture_alignment` -- Ensure roadmap aligns with architecture capabilities and constraints
        4. `sequencing_strategy` -- Determine initiative ordering, dependencies, delivery cadence
        5. `initiative_structure` -- Define initiative titles, descriptions, and boundaries
        6. `epic_structure` -- Define epics within each initiative with titles and descriptions
        7. `final_review` -- Present consolidated roadmap recap with all assumptions and open items
      - QUESTION STRATEGY section: 2-4 questions per round, progress through sections in order
      - HANDLING UNCERTAINTY section: accept "I don't know", "Skip", "Not decided yet" and map to assumptions/openItems
      - RESPONSE FORMAT section: describe the full 7-field JSON schema:
        - `phase`: `"questions"` or `"ready"`
        - `section`: one of 7 enumerated values
        - `questions`: array of strings (non-empty when phase="questions")
        - `summary`: non-empty string
        - `proposedInitiatives`: array of `{ title: string, description: string, epics: [{ title: string, description: string }] }` -- allowed empty/omitted during questions, required non-empty during ready
        - `assumptions`: array of strings (progressive, any phase)
        - `openItems`: array of strings (progressive, any phase)
      - CONTEXT ALIGNMENT section: instruct the LLM to use injected PRODUCT MISSION content for internal reasoning alignment
      - RULES section: no markdown, no prose outside JSON, no tool calls, no extra fields, summary always present, questions non-empty when phase="questions", JSON-only output
  - [x] 2.3 Add `roadmap_pm` mode routing in `buildSystemPrompt()` function
    - File: `gateway/src/services/promptBuilder.ts`, inside `buildSystemPrompt()`
    - Add check: `if (context?.mode === 'roadmap_pm') { ... }`
    - Place adjacent to the existing `solution_architect` check, before the `implement_feature` block
    - When `missionContent` is provided and non-empty, append it as a delimited `=== PRODUCT MISSION ===` section (same pattern as SA mode)
    - TECH-STACK.MD injection is omitted in this increment
  - [x] 2.4 Ensure RM prompt tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify prompt routing returns correct template
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `ROADMAP_PM_PROMPT_TEMPLATE` constant exists with persona, 7 discovery sections, question strategy, uncertainty handling, response format, context alignment, and rules
- `buildSystemPrompt()` returns the RM template when `context.mode === 'roadmap_pm'`
- Mission content is injected when available via `=== PRODUCT MISSION ===` delimiter
- The RM check is positioned adjacent to the `solution_architect` check, before `implement_feature`
- The 4 tests from 2.1 pass

---

#### Task Group 3: Roadmap PM Response Validator
**Dependencies:** Task Group 1 (completed)

- [x] 3.0 Complete RM response validator
  - [x] 3.1 Write 8 focused tests for RM response validation
    - Test valid response with phase="questions" parses correctly (all 7 fields extracted, proposedInitiatives empty)
    - Test valid response with phase="ready" and non-empty proposedInitiatives with at least one epic parses correctly
    - Test invalid phase value (e.g., "planning") returns `{ valid: false }`
    - Test invalid section value (e.g., "unknown_section") returns `{ valid: false }`
    - Test phase="ready" with empty proposedInitiatives returns `{ valid: false }` (readiness gate)
    - Test phase="ready" with proposedInitiatives but zero total epics across all initiatives returns `{ valid: false }`
    - Test proposedInitiatives with empty title string returns `{ valid: false }`
    - Test `createFallbackRoadmapPmResponse()` returns expected safe defaults (phase="questions", section="roadmap_existence_check", empty arrays)
  - [x] 3.2 Create `gateway/src/services/roadmapPmResponseValidator.ts`
    - Follow the structural pattern of `solutionArchitectResponseValidator.ts`
    - Import `RoadmapPmResponse` and `RoadmapPmValidationResult` from `'../types/chat'`
    - Import `extractJson` from `'./plannerResponseValidator'`
    - Import `logger` from `'./logger'`
    - Define `VALID_PHASES: ReadonlySet<string>` = `new Set(['questions', 'ready'])`
    - Define `VALID_SECTIONS: ReadonlySet<string>` = `new Set(['roadmap_existence_check', 'outcome_alignment', 'architecture_alignment', 'sequencing_strategy', 'initiative_structure', 'epic_structure', 'final_review'])`
  - [x] 3.3 Implement `validateRoadmapPmResponse(content: string)` function
    - Step 1: Extract JSON via `extractJson(content)`, return error if null
    - Step 2: Parse JSON via `JSON.parse()`, return error on parse failure
    - Step 3: Validate `phase` is in `VALID_PHASES`
    - Step 4: Validate `section` is in `VALID_SECTIONS`
    - Step 5: Validate `questions` is `string[]` and non-empty when `phase === 'questions'`
    - Step 6: Validate `summary` is a non-empty string
    - Step 7: Validate `proposedInitiatives` is an array when present (each item must have a non-empty `title` string, `description` as string, `epics` as array)
    - Step 8: Validate that when `phase="ready"`, `proposedInitiatives` is present, non-empty, and at least one epic exists across all initiatives (lenient per-initiative)
    - Step 9: Validate `assumptions` is `string[]` when present (default to empty array)
    - Step 10: Validate `openItems` is `string[]` when present (default to empty array)
    - Return `{ valid: true, roadmapPmResponse: { ... } }` on success
    - Return `{ valid: false, error: '...' }` on any failure, with `logValidationFailure()` call
  - [x] 3.4 Implement `createFallbackRoadmapPmResponse()` function
    - Return safe defaults: `{ phase: 'questions', section: 'roadmap_existence_check', questions: [], summary: '', proposedInitiatives: [], assumptions: [], openItems: [] }`
  - [x] 3.5 Define `ROADMAP_PM_CORRECTIVE_INSTRUCTION` constant
    - Follow pattern of `SA_CORRECTIVE_INSTRUCTION` in `solutionArchitectResponseValidator.ts`
    - Text: corrective instruction telling the LLM to return ONLY valid JSON matching the required 7-field schema with no markdown or extra text
  - [x] 3.6 Implement `logValidationFailure(error, content)` private helper
    - Log via `logger.warn()` with event `'roadmap_pm_validation_failed'`, error message, and raw content preview (truncated to 200 chars)
    - Follow pattern from `solutionArchitectResponseValidator.ts`
  - [x] 3.7 Export validator functions and corrective instruction from `gateway/src/services/index.ts`
    - Add export block after the Solution Architect validator exports:
      ```
      export {
        validateRoadmapPmResponse,
        createFallbackRoadmapPmResponse,
        ROADMAP_PM_CORRECTIVE_INSTRUCTION,
      } from './roadmapPmResponseValidator';
      ```
  - [x] 3.8 Ensure RM validator tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify all validation paths work correctly including the readiness gate checks
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `roadmapPmResponseValidator.ts` exists with `validateRoadmapPmResponse()`, `createFallbackRoadmapPmResponse()`, and `ROADMAP_PM_CORRECTIVE_INSTRUCTION`
- Validates all 7 fields with appropriate type and value checks
- Section validation uses a `ReadonlySet<string>` constant with 7 enumerated values
- Readiness gate: when `phase="ready"`, proposedInitiatives must be non-empty with at least one epic across all initiatives
- `proposedInitiatives` allowed empty/omitted during `phase="questions"`
- `assumptions` and `openItems` default to empty arrays when absent
- Exported from `gateway/src/services/index.ts`
- The 8 tests from 3.1 pass

---

### Gateway Route Handler

#### Task Group 4: Wire RM Validation, Corrective Retry, MISSION.MD Injection, and Transcript Persistence in Chat Route
**Dependencies:** Task Groups 1, 2, 3 (all completed)

- [x] 4.0 Complete RM wiring in chat route handler
  - [x] 4.1 Write 7 focused tests for RM validation, retry, file loading, and transcript persistence in chat route
    - Test that a valid RM JSON response is parsed and `roadmapPmResponse` is attached to `chatResponse`
    - Test that `assistant.message` is set to the `summary` field from a valid RM response
    - Test that when first validation fails but corrective retry succeeds, the retried response is used
    - Test that when both validation attempts fail, `createFallbackRoadmapPmResponse()` is used and `chatResponse.error` is set
    - Test that `shouldAppendToTranscript()` returns `true` for `roadmap_pm` mode
    - Test that `flushTranscriptToDisk()` calls `writeTranscriptToFile()` with `kind='roadmap_pm'` and `featureTitle='Roadmap PM'` for `roadmap_pm` mode
    - Test that when `mode === 'roadmap_pm'` and `projectParentFolder` is present, `MISSION.MD` is loaded via `loadProjectFile()`
  - [x] 4.2 Add RM validator imports to `gateway/src/routes/chat.ts`
    - Add `RoadmapPmResponse` to the type imports from `'../types'`
    - Add `validateRoadmapPmResponse`, `createFallbackRoadmapPmResponse`, and `ROADMAP_PM_CORRECTIVE_INSTRUCTION` to the service imports from `'../services'`
  - [x] 4.3 Add MISSION.MD loading for `roadmap_pm` mode
    - In the `chat.ts` route handler, where SA mode loads MISSION.MD, add a parallel check for `mode === 'roadmap_pm'`
    - When `mode === 'roadmap_pm'` and `projectParentFolder` is present, load `MISSION.MD` using the existing `loadProjectFile()` helper
    - Pass `missionContent` to `buildSystemPrompt()` for context alignment
    - Do NOT load TECH-STACK.MD for this mode
    - Do NOT implement a standards-missing short-circuit (unlike SA mode which halts on missing TECH-STACK.MD)
  - [x] 4.4 Create `shouldValidateRoadmapPmResponse(context)` helper function
    - Place near the existing `shouldValidateSolutionArchitectResponse` helper
    - Return `true` when `context?.mode === 'roadmap_pm'`
  - [x] 4.5 Extend `shouldBypassToolExecution()` for `roadmap_pm`
    - Add `context?.mode === 'roadmap_pm'` to the condition (roadmap_pm is tool-less)
  - [x] 4.6 Add RM validation block with corrective retry in the chat route handler
    - Place after the existing SA validation block, mirroring the SA corrective-retry pattern:
      1. Check `shouldValidateRoadmapPmResponse(context)`
      2. First attempt: call `validateRoadmapPmResponse(response.content || '')`
      3. If valid: attach `roadmapPmResponse` to `chatResponse`, set `assistant.message` to `validationResult.roadmapPmResponse.summary`
      4. If invalid: append `ROADMAP_PM_CORRECTIVE_INSTRUCTION` message to the messages array
      5. Resend once via `sendChatRequest` with the updated messages array
      6. Second attempt: call `validateRoadmapPmResponse()` on the retry response
      7. If second validation succeeds: use the retried response
      8. If second validation also fails: use `createFallbackRoadmapPmResponse()` as fallback and set `chatResponse.error` with the validation error message
    - Add structured logging at each step (logger.info for validation results, logger.warn for failures)
  - [x] 4.7 Extend `shouldAppendToTranscript()` to include `roadmap_pm` mode
    - Add `context?.mode === 'roadmap_pm'` to the existing condition
  - [x] 4.8 Extend `flushTranscriptToDisk()` for `roadmap_pm` mode
    - Add handling for `mode === 'roadmap_pm'`: use `context.filename` (projectId) as `featureId`, use constant `"Roadmap PM"` as `featureTitle`, pass `'roadmap_pm'` as the `kind` parameter
    - Transcript path will resolve to: `<projectParentFolder>/conversations/roadmap_pm/<derivedFolderName>/`
  - [x] 4.9 Ensure RM chat route tests pass
    - Run ONLY the 7 tests written in 4.1
    - Verify validation, retry, fallback, file loading, and transcript persistence paths work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- RM validation block is wired in `chat.ts` with the corrective-retry pattern (mirroring SA)
- First validation failure triggers a single retry with `ROADMAP_PM_CORRECTIVE_INSTRUCTION`
- Second validation failure falls back to `createFallbackRoadmapPmResponse()` with error set
- Successful validation attaches `roadmapPmResponse` to `chatResponse` and uses `summary` as `assistant.message`
- `MISSION.MD` is auto-loaded when `mode === 'roadmap_pm'` and `projectParentFolder` is present
- No standards-missing short-circuit for `roadmap_pm`
- `roadmap_pm` mode bypasses tool execution
- Transcript is flushed with `kind='roadmap_pm'`, `featureId=projectId`, `featureTitle='Roadmap PM'`
- The 7 tests from 4.1 pass

---

### Frontend Layer

#### Task Group 5: Frontend Types, RoadmapPmChatPanel Component, CSS Module, and ProductRoadmapPage Layout Integration
**Dependencies:** Task Groups 1-4 (gateway must fully accept `roadmap_pm` mode)

- [x] 5.0 Complete frontend RM integration
  - [x] 5.1 Write 8 focused tests for frontend RM components
    - Test that `RoadmapPmResponse` type exists with all 7 fields (phase, section, questions, summary, proposedInitiatives, assumptions, openItems) in `chatApi.ts`
    - Test that `RoadmapPmChatPanel` renders the chat container with a recognizable test ID (e.g., `data-testid="rm-chat-container"`)
    - Test that `RoadmapPmChatPanel` displays section label badge for the current discovery section (e.g., "Roadmap Existence Check")
    - Test that `RoadmapPmChatPanel` renders questions list when `phase="questions"` and questions is non-empty
    - Test that `RoadmapPmChatPanel` renders proposedInitiatives with initiative titles and nested epic titles when non-empty
    - Test that `RoadmapPmChatPanel` renders assumptions list with distinct styling when non-empty
    - Test that `RoadmapPmChatPanel` renders ready banner with correct text when `phase="ready"` (e.g., "Roadmap planning is complete. Save functionality coming in a future increment.")
    - Test that `ProductRoadmapPage` renders with `RoadmapPmChatPanel` in the left pane of the outer split pane
  - [x] 5.2 Add `RoadmapPmResponse` interface to `frontend/src/api/chatApi.ts`
    - Place after `SolutionArchitectResponse` interface
    - Fields mirror gateway type:
      - `phase`: `'questions' | 'ready'`
      - `section`: `string` (enumerated on gateway side; string on frontend for flexibility)
      - `questions`: `string[]`
      - `summary`: `string`
      - `proposedInitiatives`: `Array<{ title: string; description: string; epics: Array<{ title: string; description: string }> }>`
      - `assumptions`: `string[]`
      - `openItems`: `string[]`
    - Include JSDoc referencing this spec
  - [x] 5.3 Add `roadmapPmResponse` field to frontend `ChatResponse` interface
    - File: `frontend/src/api/chatApi.ts`, in the `ChatResponse` interface
    - Add: `roadmapPmResponse?: RoadmapPmResponse;` after `solutionArchitectResponse` field
    - Include JSDoc referencing this spec
  - [x] 5.4 Create `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css`
    - Replicate all styles from `SolutionArchitectChatPanel.module.css` as a baseline
    - Reuse design system tokens: colors `#1976D2` primary, `#333` text, `#888` muted; border-radius `6px`; font-sizes `12-13px`
    - Add new/adapted styles:
      - `.sectionLabel`: small colored badge for current section (matching SA's `.sectionLabel` pattern: `background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 10px; font-size: 11px;`)
      - `.initiativesList`: container for proposed initiatives rendering
      - `.initiativeItem`: individual initiative with title styling (bold, grouped)
      - `.epicSubList`: nested list for epics within an initiative
      - `.epicItem`: individual epic item styling
      - `.assumptionsList`: list styling for assumptions (amber/neutral tones, e.g., `background: #fff8e1; color: #f57f17;`)
      - `.assumptionItem`: individual assumption item
      - `.openItemsList`: list styling for open/deferred items (muted/grey tones, e.g., `background: #f5f5f5; color: #757575;`)
      - `.openItem`: individual open item
      - `.readyBanner`: green pattern matching SA's `.readyBanner` (`background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32;`)
    - Do NOT include `.uploadButton` styles (no document upload in this increment)
  - [x] 5.5 Create `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx`
    - Mirror the full structure of `SolutionArchitectChatPanel.tsx` with the following swaps:
      - Mode: `'roadmap_pm'` (SA uses `'solution_architect'`)
      - Kind: `'roadmap_pm'` for `getImplementConversation` call (SA uses `'solution_architect'`)
      - `featureTitle`: `'Roadmap PM'` (SA uses `'Solution Architect'`)
      - Bootstrap message: `"Help me define the high-level roadmap for ${productName}."` (SA uses architecture-focused text)
      - Message ID prefix: `"rm-msg-"` (distinct from SA's `"sa-msg-"` and PM's `"pm-msg-"`)
      - Persona label for assistant messages: `"Roadmap PM"` (SA uses `"Solution Architect"`)
      - `data-testid` prefix: `"rm-chat-"` (SA uses `"sa-chat-"`)
    - Props: `projectId: string`, `projectParentFolder: string`, `productName: string` (identical signature to SA panel)
    - State:
      - `messages`, `sessionId`, `loading`, `error`, `inputDraft`, `isBootstrapped` (same as SA)
      - `rmResponses`: `Map<string, RoadmapPmResponse>` keyed by message ID (SA uses `saResponses`)
    - Functions:
      - `buildRoadmapPmContext(projectId, projectParentFolder)`: returns `{ mode: 'roadmap_pm', filename: projectId, projectParentFolder, featureId: projectId, featureTitle: 'Roadmap PM' }`
      - `generateMsgId()`: returns `"rm-msg-${Date.now()}-${Math.random()...}"`
      - `initConversation()`: rehydrate via `getImplementConversation(projectId, projectId, projectParentFolder, 'Roadmap PM', 'roadmap_pm')`
      - `sendBootstrapMessage()`, `handleSend()`, `handleFormSubmit()`, `handleKeyDown()`: follow SA patterns exactly with swapped context builder and response map
    - Do NOT include `UploadDocumentsModal` or `handleSendWithSources` / `handleUploadDocuments` (explicitly excluded)
  - [x] 5.6 Create section name display helper in `RoadmapPmChatPanel.tsx`
    - Create a `sectionDisplayName(section: string): string` helper function that maps section values to human-readable labels:
      - `'roadmap_existence_check'` -> `'Roadmap Existence Check'`
      - `'outcome_alignment'` -> `'Outcome Alignment'`
      - `'architecture_alignment'` -> `'Architecture Alignment'`
      - `'sequencing_strategy'` -> `'Sequencing Strategy'`
      - `'initiative_structure'` -> `'Initiative Structure'`
      - `'epic_structure'` -> `'Epic Structure'`
      - `'final_review'` -> `'Final Review'`
      - Default: return the raw section value with underscores replaced by spaces
  - [x] 5.7 Implement phase-based rendering in `RoadmapPmChatPanel.tsx`
    - Section label badge: render styled badge showing human-readable section name via `sectionDisplayName()`
    - Questions list: render as `<ul>` items when `phase="questions"` and questions is non-empty
    - Proposed initiatives: when `proposedInitiatives` is non-empty, render each initiative title (bold) with its description, and nested epic titles with descriptions as sub-items
    - Assumptions list: when `assumptions` is non-empty, render with distinct styling (amber tones) to differentiate from questions
    - Open items list: when `openItems` is non-empty, render with muted/grey styling to indicate deferred/unresolved items
    - Ready banner: when `phase="ready"`, render banner with text "Roadmap planning is complete. Save functionality coming in a future increment." (no save action wired)
  - [x] 5.8 Implement rehydration in `RoadmapPmChatPanel.tsx`
    - During rehydration, parse assistant message content as JSON to extract `RoadmapPmResponse` fields
    - Extract all 7 fields: phase, section, questions, summary, proposedInitiatives, assumptions, openItems
    - Same pattern as SA rehydration but with the richer 7-field schema
    - Store extracted responses in the `rmResponses` Map keyed by message ID
  - [x] 5.9 Modify `frontend/src/components/ProductView/ProductRoadmapPage.tsx` layout to integrate chat panel
    - Replace the current `ResizableSplitPane` left/right layout with an outer split pane:
      - LHS (left pane): `RoadmapPmChatPanel` component
      - RHS (right pane): the entire existing roadmap content (tree + details, still resizable within the right area via the existing inner `ResizableSplitPane`)
    - Import `RoadmapPmChatPanel` from `'./RoadmapPmChatPanel'`
    - Pass props to `RoadmapPmChatPanel`:
      - `projectId`: derived from `loadedFileName` (from ArchitectureContext)
      - `projectParentFolder`: derived from ArchitectureContext or ProjectContext as available
      - `productName`: derived from active project or `loadedFileName`
    - Persist the new outer split pane width using a distinct localStorage key: `"pd.roadmap.chatWidth"`
    - The existing roadmap grid behavior (import, tree display, expand/collapse, metadata, CTA) must remain completely unchanged
    - The `onNavigateToBacklog` and `onControlStateChange` props must continue working unchanged
  - [x] 5.10 Ensure frontend RM component tests pass
    - Run ONLY the 8 tests written in 5.1
    - Verify RM panel renders, section labels display, initiatives render, ready banner displays
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `RoadmapPmResponse` type exists in `frontend/src/api/chatApi.ts` with all 7 fields
- `ChatResponse` includes optional `roadmapPmResponse` field
- `RoadmapPmChatPanel.tsx` exists and mirrors SA panel with RM-specific mode, kind, bootstrap message, persona label, and additional rendering for proposedInitiatives/assumptions/openItems
- `RoadmapPmChatPanel.module.css` includes styles for section label, initiatives list (with nested epics), assumptions list, open items list, and ready banner
- No `UploadDocumentsModal` or upload-related code in `RoadmapPmChatPanel`
- `ProductRoadmapPage.tsx` has outer split pane with chat panel (LHS) and existing roadmap content (RHS)
- Outer split pane width persisted to localStorage with key `"pd.roadmap.chatWidth"`
- Existing roadmap functionality (import, tree, expand/collapse, CTA) unchanged
- `onNavigateToBacklog` and `onControlStateChange` props continue working
- The 8 tests from 5.1 pass

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5 (all completed)

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 5 tests written by Task Group 1 (gateway types and config)
    - Review the 4 tests written by Task Group 2 (RM prompt template and routing)
    - Review the 8 tests written by Task Group 3 (RM response validator)
    - Review the 7 tests written by Task Group 4 (RM chat route handler wiring)
    - Review the 8 tests written by Task Group 5 (frontend types, components, layout)
    - Total existing tests: approximately 32 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - End-to-end flow: user sends message in roadmap_pm mode -> gateway returns validated RM response -> frontend parses and renders correctly
      - Corrective retry edge case: first response has valid JSON but wrong section value -> retry with corrective instruction
      - Transcript persistence: RM conversation is saved under `conversations/roadmap_pm/<folderName>/` path
      - Rehydration: RM panel rehydrates correctly from persisted conversation (parses 7-field JSON including proposedInitiatives)
      - MISSION.MD injection: when MISSION.MD is present, content is included in system prompt; when absent, prompt still works without short-circuit
      - Validator readiness gate: phase="ready" with valid initiatives+epics passes; phase="ready" with no epics fails
      - Non-regression: existing SA and PM modes remain unaffected by the new roadmap_pm additions
      - ProductRoadmapPage layout: existing roadmap tree/import/CTA behavior unchanged after chat panel integration
      - Frontend rendering: proposedInitiatives with nested epics render correctly in the chat panel
      - OpenItems and assumptions render with correct distinct styling
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 32-42 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 32-42 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Non-regression verified for existing SA and PM modes
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Gateway Types, Transcript Config, Service Exports
    |
    +---> Task Group 2: RM System Prompt Template (depends on types)
    |         |
    +---> Task Group 3: RM Response Validator (depends on types)
    |         |
    +---------+---> Task Group 4: Chat Route Handler Wiring (depends on prompt + validator)
                        |
                        +---> Task Group 5: Frontend Types, RM Panel, ProductRoadmapPage Layout
                                    |
                                    +---> Task Group 6: Test Review & Gap Analysis
```

1. **Task Group 1** (Gateway Types & Config) -- no dependencies, foundational types needed by all subsequent groups
2. **Task Group 2** (RM Prompt) and **Task Group 3** (RM Validator) -- can run in parallel, both depend only on Task Group 1
3. **Task Group 4** (Chat Route Handler) -- depends on Task Groups 2 and 3 (needs both prompt and validator)
4. **Task Group 5** (Frontend) -- depends on Task Group 4 (gateway must fully support `roadmap_pm` mode before frontend can integrate)
5. **Task Group 6** (Test Review & Gap Analysis) -- depends on all prior groups

## Key Files Modified

| File | Task Group | Change Description |
|------|-----------|-------------------|
| `gateway/src/types/chat.ts` | TG1 | Add `'roadmap_pm'` to ChatMode, add RoadmapPmResponse (7 fields), add RoadmapPmValidationResult, add roadmapPmResponse to ChatResponse |
| `gateway/src/types/index.ts` | TG1 | Export RoadmapPmResponse and RoadmapPmValidationResult |
| `gateway/src/services/transcriptWriter.ts` | TG1 | Add `'roadmap_pm'` to ALLOWED_KINDS |
| `gateway/src/services/promptBuilder.ts` | TG2 | Add ROADMAP_PM_PROMPT_TEMPLATE + routing in buildSystemPrompt() with MISSION.MD injection |
| `gateway/src/services/roadmapPmResponseValidator.ts` | TG3 | **New file**: validator + fallback + corrective instruction |
| `gateway/src/services/index.ts` | TG3 | Export RM validator functions and corrective instruction |
| `gateway/src/routes/chat.ts` | TG4 | Add RM validation block with corrective retry, MISSION.MD loading, shouldValidateRoadmapPmResponse, extend shouldBypassToolExecution, extend shouldAppendToTranscript, extend flushTranscriptToDisk |
| `frontend/src/api/chatApi.ts` | TG5 | Add RoadmapPmResponse type (7 fields) + ChatResponse field |
| `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` | TG5 | **New file**: RM chat panel component with section badges, initiatives/assumptions/openItems rendering, rehydration |
| `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css` | TG5 | **New file**: RM panel styles including initiatives, assumptions, openItems, ready banner |
| `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | TG5 | Wrap existing layout in outer ResizableSplitPane with LHS=chat panel, RHS=existing content |

## Key Files Referenced (Read-Only)

| File | Purpose |
|------|---------|
| `gateway/src/services/solutionArchitectResponseValidator.ts` | Template pattern for RM validator (structure, VALID_SECTIONS, corrective instruction, fallback) |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | Template pattern for RM panel (state management, rehydration, section badges, phase rendering) |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` | Template pattern for RM panel styles |
| `frontend/src/components/ProductView/ProductManagerChatPanel.module.css` | Design system color and spacing tokens |
| `gateway/src/services/plannerResponseValidator.ts` | Provides `extractJson()` utility |
| `gateway/src/routes/chat.ts` (SA blocks) | Template for corrective-retry flow, shouldAppendToTranscript, flushTranscriptToDisk, MISSION.MD loading |
