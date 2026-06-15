# Task Breakdown: SA Increment 1 -- Add Solution Architect Mode + UI Entry Point (Tool-less, No Saving)

## Overview
Total Tasks: 42 (across 5 task groups)

This spec introduces a new `solution_architect` chat mode in the gateway and a corresponding `SolutionArchitectChatPanel` in the frontend, enabling structured architecture discovery conversations scoped to a Product. This increment is tool-less and does NOT persist any architecture changes -- it only enables the conversation and its transcript.

## Task List

### Gateway Types & Configuration

#### Task Group 1: Gateway Types, Transcript Config, and Service Exports
**Dependencies:** None

- [x] 1.0 Complete gateway types and configuration layer
  - [x] 1.1 Write 4 focused tests for SA type definitions and transcript kind validation
    - Test that `'solution_architect'` is accepted by `normalizeKind()` in `transcriptWriter.ts` (currently only `['implement', 'product']` are allowed)
    - Test that `SolutionArchitectResponse` interface fields serialize/deserialize correctly (phase, section, questions, summary, assumptions, openItems)
    - Test that `SolutionArchitectValidationResult` follows the same shape as `ProductManagerValidationResult` (valid, solutionArchitectResponse, error)
    - Test that `ChatResponse` can carry an optional `solutionArchitectResponse` field alongside existing fields
  - [x] 1.2 Extend `ChatMode` union type in `gateway/src/types/chat.ts`
    - File: `gateway/src/types/chat.ts`, line 76
    - Change: `export type ChatMode = 'oas_assistant' | 'implement_feature' | 'product_manager';` to include `| 'solution_architect'`
    - Update the JSDoc comment above to document the new mode
  - [x] 1.3 Add `SolutionArchitectResponse` interface to `gateway/src/types/chat.ts`
    - Place after `ProductManagerResponse` interface (after line 648)
    - Fields:
      - `phase`: `'questions' | 'ready'`
      - `section`: `'context_and_boundaries' | 'ui_and_channels' | 'integrations' | 'data_model' | 'service_decomposition' | 'business_logic' | 'non_functional_requirements'`
      - `questions`: `string[]`
      - `summary`: `string`
      - `assumptions`: `string[]`
      - `openItems`: `string[]`
    - Follow doc pattern from `ProductManagerResponse`
  - [x] 1.4 Add `SolutionArchitectValidationResult` interface to `gateway/src/types/chat.ts`
    - Place after `SolutionArchitectResponse`
    - Fields: `valid: boolean`, `solutionArchitectResponse?: SolutionArchitectResponse`, `error?: string`
    - Follow pattern from `ProductManagerValidationResult` (line 656)
  - [x] 1.5 Add `solutionArchitectResponse` field to `ChatResponse` interface in `gateway/src/types/chat.ts`
    - File: `gateway/src/types/chat.ts`, line 728 (`ChatResponse` interface)
    - Add: `solutionArchitectResponse?: SolutionArchitectResponse;` parallel to `productManagerResponse` (line 770)
    - Add JSDoc referencing this spec
  - [x] 1.6 Add `'solution_architect'` to `ALLOWED_KINDS` array in `gateway/src/services/transcriptWriter.ts`
    - File: `gateway/src/services/transcriptWriter.ts`, line 39
    - Change: `const ALLOWED_KINDS = ['implement', 'product'];` to `const ALLOWED_KINDS = ['implement', 'product', 'solution_architect'];`
  - [x] 1.7 Ensure gateway types and config tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify `normalizeKind('solution_architect')` does not throw
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `ChatMode` union includes `'solution_architect'`
- `SolutionArchitectResponse` interface exists with all 6 fields (phase, section, questions, summary, assumptions, openItems)
- `SolutionArchitectValidationResult` interface exists with valid/solutionArchitectResponse/error fields
- `ChatResponse` includes optional `solutionArchitectResponse` field
- `normalizeKind('solution_architect')` resolves without error
- The 4 tests from 1.1 pass

---

### Gateway Services (Prompt + Validator)

#### Task Group 2: Solution Architect System Prompt Template
**Dependencies:** Task Group 1 (completed)

- [x] 2.0 Complete SA system prompt and routing
  - [x] 2.1 Write 3 focused tests for SA prompt template and routing
    - Test that `buildSystemPrompt()` returns `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` when `context.mode === 'solution_architect'`
    - Test that the returned prompt contains the 7 enumerated section names (context_and_boundaries, ui_and_channels, integrations, data_model, service_decomposition, business_logic, non_functional_requirements)
    - Test that the returned prompt contains JSON schema instruction with all 6 fields (phase, section, questions, summary, assumptions, openItems)
  - [x] 2.2 Create `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` constant in `gateway/src/services/promptBuilder.ts`
    - Place after `PRODUCT_MANAGER_PROMPT_TEMPLATE` (after line 348) and before `MISSION_GENERATION_PROMPT_TEMPLATE`
    - Follow the structural pattern of `PRODUCT_MANAGER_PROMPT_TEMPLATE`:
      - YOUR ROLE section: "Senior Solution Architect conducting structured architecture discovery"
      - ARCHITECTURE DISCOVERY SECTIONS (replaces MINIMUM REQUIRED INFORMATION): enumerate the 7 sections in order -- context_and_boundaries, ui_and_channels, integrations, data_model, service_decomposition, business_logic, non_functional_requirements
      - QUESTION STRATEGY section: 2-4 questions per round, soft cap of ~10 rounds, progress through sections in order
      - HANDLING UNCERTAINTY section: instruct the LLM to accept "I don't know", "Skip this", "Not decided yet" responses and map them to the `openItems` array
      - DEFAULT SERVICE BOUNDARY: instruct the LLM to always create at least one "Core Application Service" if the user cannot define service boundaries
      - SUFFICIENCY TRACKING section: when enough info gathered, transition to `phase="ready"` with empty questions array
      - RESPONSE FORMAT section: describe the full 6-field JSON schema (phase, section, questions, summary, assumptions, openItems)
      - RULES section: no markdown, no prose outside JSON, no tool calls, no extra fields, summary always present, questions non-empty when phase="questions"
  - [x] 2.3 Add `solution_architect` mode routing in `buildSystemPrompt()` function
    - File: `gateway/src/services/promptBuilder.ts`, around line 1250
    - Add check: `if (context?.mode === 'solution_architect') { return SOLUTION_ARCHITECT_PROMPT_TEMPLATE; }`
    - Place immediately after the `product_manager` check (line 1252-1254), before the `implement_feature` block (line 1257)
  - [x] 2.4 Ensure SA prompt tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify prompt routing returns correct template
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` constant exists with persona, 7 sections, question strategy, uncertainty handling, response format, and rules
- `buildSystemPrompt()` returns the SA template when `context.mode === 'solution_architect'`
- The SA check is positioned between the `product_manager` and `implement_feature` checks
- The 3 tests from 2.1 pass

---

#### Task Group 3: Solution Architect Response Validator
**Dependencies:** Task Group 1 (completed)

- [x] 3.0 Complete SA response validator
  - [x] 3.1 Write 6 focused tests for SA response validation
    - Test valid response with phase="questions" parses correctly (all 6 fields extracted)
    - Test valid response with phase="ready" and empty questions array parses correctly
    - Test invalid phase value (e.g., "planning") returns `{ valid: false }`
    - Test invalid section value (e.g., "unknown_section") returns `{ valid: false }`
    - Test missing `assumptions` field returns `{ valid: false }`
    - Test `createFallbackSolutionArchitectResponse()` returns expected safe defaults
  - [x] 3.2 Create `gateway/src/services/solutionArchitectResponseValidator.ts`
    - Follow the structural pattern of `productManagerResponseValidator.ts`
    - Import `SolutionArchitectResponse` and `SolutionArchitectValidationResult` from `../types/chat`
    - Import `extractJson` from `./plannerResponseValidator`
    - Import `logger` from `./logger`
    - Define `VALID_PHASES: ReadonlySet<string>` = `new Set(['questions', 'ready'])`
    - Define `VALID_SECTIONS: ReadonlySet<string>` = `new Set(['context_and_boundaries', 'ui_and_channels', 'integrations', 'data_model', 'service_decomposition', 'business_logic', 'non_functional_requirements'])`
  - [x] 3.3 Implement `validateSolutionArchitectResponse(content: string)` function
    - Step 1: Extract JSON via `extractJson(content)`, return error if null
    - Step 2: Parse JSON via `JSON.parse()`, return error on parse failure
    - Step 3: Validate `phase` is in `VALID_PHASES`
    - Step 4: Validate `section` is in `VALID_SECTIONS`
    - Step 5: Validate `questions` is `string[]` (array of strings)
    - Step 6: Validate `summary` is a non-empty string
    - Step 7: Validate `assumptions` is `string[]` (array of strings)
    - Step 8: Validate `openItems` is `string[]` (array of strings)
    - Step 9: Validate that `questions` is non-empty when `phase === 'questions'`
    - Return `{ valid: true, solutionArchitectResponse: { ... } }` on success
    - Return `{ valid: false, error: '...' }` on any failure, with `logValidationFailure()` call
  - [x] 3.4 Implement `createFallbackSolutionArchitectResponse()` function
    - Return safe defaults: `{ phase: 'questions', section: 'context_and_boundaries', questions: [], summary: '', assumptions: [], openItems: [] }`
  - [x] 3.5 Implement `logValidationFailure(error, content)` private helper
    - Log via `logger.warn()` with event `'solution_architect_validation_failed'`, error message, and raw content preview (truncated to 200 chars)
    - Follow pattern from `productManagerResponseValidator.ts`
  - [x] 3.6 Export validator functions from `gateway/src/services/index.ts`
    - Add export block after the Product Manager validator exports:
      ```
      export {
        validateSolutionArchitectResponse,
        createFallbackSolutionArchitectResponse,
      } from './solutionArchitectResponseValidator';
      ```
  - [x] 3.7 Ensure SA validator tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all validation paths work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `solutionArchitectResponseValidator.ts` exists with `validateSolutionArchitectResponse()` and `createFallbackSolutionArchitectResponse()`
- Validates all 6 fields with appropriate type and value checks
- Section validation uses a `ReadonlySet<string>` constant with 7 enumerated values
- Exported from `gateway/src/services/index.ts`
- The 6 tests from 3.1 pass

---

### Gateway Route Handler

#### Task Group 4: Wire SA Validation with Corrective Retry in Chat Route Handler
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete SA validation wiring in chat route handler
  - [x] 4.1 Write 5 focused tests for SA validation and corrective retry in chat route
    - Test that a valid SA JSON response is parsed and `solutionArchitectResponse` is attached to `chatResponse`
    - Test that `assistant.message` is set to the `summary` field from a valid SA response
    - Test that when first validation fails but corrective retry succeeds, the retried response is used
    - Test that when both validation attempts fail, `createFallbackSolutionArchitectResponse()` is used and `chatResponse.error` is set
    - Test that the corrective retry appends a corrective instruction message to the messages array before resending
  - [x] 4.2 Add SA validator imports to `gateway/src/routes/chat.ts`
    - Add `SolutionArchitectResponse` to the type imports from `'../types'` (line 36-52)
    - Add `validateSolutionArchitectResponse` and `createFallbackSolutionArchitectResponse` to the service imports from `'../services'` (line 53-82)
    - Also import `sendChatRequest` if not already imported (it is, at line 57)
  - [x] 4.3 Create `shouldValidateSolutionArchitectResponse(context)` helper function
    - Place near the existing `shouldValidateImplementerResponse` and `shouldValidatePlannerResponse` helpers
    - Return `true` when `context?.mode === 'solution_architect'`
  - [x] 4.4 Add SA validation block with corrective retry in the chat route handler
    - Place after the existing planner validation block (after line 745) and before the generate_specs validation block (line 747)
    - Implementation pattern (new corrective-retry pattern, not present in existing validators):
      1. Check `shouldValidateSolutionArchitectResponse(context)`
      2. First attempt: call `validateSolutionArchitectResponse(response.content || '')`
      3. If valid: attach `solutionArchitectResponse` to `chatResponse`, set `assistant.message` to `validationResult.solutionArchitectResponse.summary`
      4. If invalid: append corrective instruction message `"Your last response was not valid JSON. Return ONLY a single JSON object matching the required schema; no markdown or extra text."` to the messages array
      5. Resend once via `sendChatRequest` with the updated messages array
      6. Second attempt: call `validateSolutionArchitectResponse()` on the retry response
      7. If second validation succeeds: use the retried response
      8. If second validation also fails: use `createFallbackSolutionArchitectResponse()` as fallback and set `chatResponse.error` with the validation error message
    - Add structured logging at each step (logger.info for validation results, logger.warn for failures, logger.debug for success details)
  - [x] 4.5 Ensure SA chat route tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify validation, retry, and fallback paths work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- SA validation block is wired in `chat.ts` with the corrective-retry pattern
- First validation failure triggers a single retry with corrective instruction
- Second validation failure falls back to `createFallbackSolutionArchitectResponse()` with error set
- Successful validation attaches `solutionArchitectResponse` to `chatResponse` and uses `summary` as `assistant.message`
- The corrective-retry block is self-contained and can later be generalized
- The 5 tests from 4.1 pass

---

### Frontend Layer

#### Task Group 5: Frontend Types, SolutionArchitectChatPanel, and ProductPage Sub-Tab Layout
**Dependencies:** Task Groups 1-4 (gateway must accept `solution_architect` mode)

- [x] 5.0 Complete frontend SA integration
  - [x] 5.1 Write 6 focused tests for frontend SA components
    - Test that `SolutionArchitectResponse` type exists with all 6 fields (phase, section, questions, summary, assumptions, openItems) in `chatApi.ts`
    - Test that `SolutionArchitectChatPanel` renders the chat container with `data-testid="sa-chat-container"`
    - Test that `SolutionArchitectChatPanel` displays section label badge for the current discovery section
    - Test that `SolutionArchitectChatPanel` renders assumptions list when SA response contains assumptions
    - Test that `SolutionArchitectChatPanel` renders ready banner with correct text when `phase="ready"`
    - Test that `ProductPage` renders sub-tab bar with "Product Manager" and "Discuss Architecture" tabs, defaulting to "Product Manager"
  - [x] 5.2 Add `SolutionArchitectResponse` interface to `frontend/src/api/chatApi.ts`
    - Place after `ProductManagerResponse` interface (after line 499)
    - Fields mirror gateway type:
      - `phase`: `'questions' | 'ready'`
      - `section`: `string` (enumerated on gateway side; string on frontend for flexibility)
      - `questions`: `string[]`
      - `summary`: `string`
      - `assumptions`: `string[]`
      - `openItems`: `string[]`
  - [x] 5.3 Add `solutionArchitectResponse` field to frontend `ChatResponse` interface
    - File: `frontend/src/api/chatApi.ts`, in the `ChatResponse` interface (line 501)
    - Add: `solutionArchitectResponse?: SolutionArchitectResponse;` after `productManagerResponse` field (line 550)
  - [x] 5.4 Create `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css`
    - Replicate all styles from `ProductManagerChatPanel.module.css` as a baseline
    - Add new styles:
      - `.sectionLabel`: small colored badge for current discovery section (e.g., `background: #e3f2fd; color: #1565c0; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 6px;`)
      - `.assumptionsList`: list styling for assumptions (amber/neutral tones, e.g., `background: #fff8e1; color: #f57f17;` on items)
      - `.assumptionItem`: individual assumption item styling
      - `.openItemsList`: list styling for open/deferred items (muted/grey tones, e.g., `background: #f5f5f5; color: #757575;` on items)
      - `.openItem`: individual open item styling
      - `.readyBanner`: same green pattern as PM's ready banner (`background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32;`) -- reuse PM styling
  - [x] 5.5 Create `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
    - Mirror the full structure of `ProductManagerChatPanel.tsx` with the following swaps:
      - Mode: `'solution_architect'` (PM uses `'product_manager'`)
      - Kind: `'solution_architect'` for `getImplementConversation` call (PM uses `'product'`)
      - `featureTitle`: `'Solution Architect'` (PM uses `'Product'`)
      - Bootstrap message: `"Help me define the high-level architecture for ${productName}."` (PM uses `"Help me create a MISSION.MD for the ${productName} product."`)
      - Message ID prefix: `"sa-msg-"` (PM uses `"pm-msg-"`)
      - Persona label: `"Solution Architect"` (PM uses `"Product Manager"`)
      - `data-testid` prefix: `"sa-chat-"` (PM uses `"pm-chat-"`)
    - State:
      - `messages`, `sessionId`, `loading`, `error`, `inputDraft`, `isBootstrapped` (same as PM)
      - `saResponses`: `Map<string, SolutionArchitectResponse>` keyed by message ID (PM uses `pmResponses` with `ProductManagerResponse`)
      - `isUploadModalOpen` (same as PM)
    - Functions:
      - `buildSolutionArchitectContext(projectId, projectParentFolder)`: returns `{ mode: 'solution_architect', filename: projectId, projectParentFolder, featureId: projectId, featureTitle: 'Solution Architect' }`
      - `generateMsgId()`: returns `"sa-msg-${Date.now()}-${Math.random()...}"`
      - `initConversation()`: rehydrate via `getImplementConversation(projectId, projectId, projectParentFolder, 'Solution Architect', 'solution_architect')`
      - `sendBootstrapMessage()`, `handleSend()`, `handleFormSubmit()`, `handleKeyDown()`, `handleSendWithSources()`, `handleUploadDocuments()`: follow PM patterns exactly with swapped context builder and response map
    - Rendering (phase-based):
      - Section label badge: render a small styled badge showing human-readable section name (e.g., "Context & Boundaries", "UI & Channels", "Integrations", "Data Model", "Service Decomposition", "Business Logic", "Non-Functional Requirements") based on `saResponse.section`
      - Questions list: render as `<ul>` items when `phase="questions"` and questions is non-empty (same as PM)
      - Assumptions list: render when `assumptions` array is non-empty, styled distinctly from questions (amber tones)
      - Open items list: render when `openItems` array is non-empty, styled to indicate deferred/unresolved items (muted grey tones)
      - Ready banner: render when `phase="ready"` with text "Architecture baseline is ready. Save functionality coming in a future increment." (no save action wired)
    - Rehydration: during rehydration, parse assistant message content as JSON to extract `SolutionArchitectResponse` fields including `section`, `assumptions`, and `openItems` (same pattern as PM rehydration but with the 6-field schema)
    - Upload Documents: reuse `UploadDocumentsModal` component as-is, same `handleSendWithSources` pattern as PM
  - [x] 5.6 Create section name display helper in `SolutionArchitectChatPanel.tsx`
    - Create a `sectionDisplayName(section: string): string` helper function that maps enumerated section values to human-readable labels:
      - `'context_and_boundaries'` -> `'Context & Boundaries'`
      - `'ui_and_channels'` -> `'UI & Channels'`
      - `'integrations'` -> `'Integrations'`
      - `'data_model'` -> `'Data Model'`
      - `'service_decomposition'` -> `'Service Decomposition'`
      - `'business_logic'` -> `'Business Logic'`
      - `'non_functional_requirements'` -> `'Non-Functional Requirements'`
      - Default: return the raw section value with underscores replaced by spaces
  - [x] 5.7 Modify `frontend/src/components/ProductView/ProductPage.tsx` to add sub-tab layout
    - Add `useState<'pm' | 'sa'>('pm')` for active tab state (default: Product Manager)
    - Add sub-tab bar JSX with two tab buttons: "Product Manager" and "Discuss Architecture"
    - Active tab gets highlighted styling (primary blue `#1976D2` border-bottom or background)
    - When `activeTab === 'pm'`: render `ProductManagerChatPanel` (preserving current behavior)
    - When `activeTab === 'sa'`: render `SolutionArchitectChatPanel`
    - Import `SolutionArchitectChatPanel` from `'./SolutionArchitectChatPanel'`
    - Both panels receive the same props: `projectId`, `projectParentFolder`, `productName`
    - Conditionally render only the active panel (do NOT render inactive panel as hidden) to avoid duplicate bootstrap messages on mount
  - [x] 5.8 Add sub-tab bar styles to `frontend/src/components/ProductView/ProductPage.module.css`
    - `.subTabBar`: flex container for tab buttons (`display: flex; gap: 0; border-bottom: 1px solid #e0e0e0; margin-bottom: 0; flex-shrink: 0;`)
    - `.subTab`: individual tab button (`padding: 8px 16px; font-size: 13px; font-weight: 500; color: #333; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; transition: all 0.15s ease;`)
    - `.subTabActive`: active tab state (`color: #1976D2; border-bottom-color: #1976D2; font-weight: 600;`)
    - `.subTab:hover:not(.subTabActive)`: hover state (`color: #1976D2; background: rgba(25, 118, 210, 0.04);`)
    - Follow existing design system: colors `#1976D2` primary, `#333` text; border-radius `6px`; font-sizes `12-13px`
  - [x] 5.9 Ensure frontend SA component tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify SA panel renders, sub-tabs toggle, section labels display
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `SolutionArchitectResponse` type exists in `frontend/src/api/chatApi.ts` with all 6 fields
- `ChatResponse` includes optional `solutionArchitectResponse` field
- `SolutionArchitectChatPanel.tsx` exists and mirrors PM panel with SA-specific mode, kind, bootstrap message, persona label, and additional rendering for section/assumptions/openItems
- `SolutionArchitectChatPanel.module.css` includes styles for section label, assumptions list, open items list, and ready banner
- `ProductPage.tsx` has sub-tab bar toggling between "Product Manager" and "Discuss Architecture"
- Only the active panel is rendered (no hidden panel mounting)
- Default tab is "Product Manager" preserving current behavior
- The 6 tests from 5.1 pass

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests written by Task Group 1 (gateway types and config)
    - Review the 3 tests written by Task Group 2 (SA prompt template and routing)
    - Review the 6 tests written by Task Group 3 (SA response validator)
    - Review the 5 tests written by Task Group 4 (SA chat route handler wiring)
    - Review the 6 tests written by Task Group 5 (frontend types, components, sub-tabs)
    - Total existing tests: approximately 24 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - End-to-end flow: user sends message in SA mode -> gateway returns validated SA response -> frontend parses and renders correctly
      - Corrective retry edge case: first response has valid JSON but wrong `section` value -> retry with corrective instruction
      - Transcript persistence: SA conversation is saved under `conversations/solution_architect/<folderName>/` path
      - Rehydration: SA panel rehydrates correctly from persisted conversation (parses 6-field JSON, maps section/assumptions/openItems)
      - Sub-tab switching: switching from PM to SA tab unmounts PM panel and mounts SA panel without triggering duplicate bootstraps
      - SA prompt template: verify prompt instructs LLM to map "I don't know" responses to openItems
      - Frontend rendering: open items and assumptions lists render with correct styling when SA response contains them
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 24-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-34 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Gateway Types, Transcript Config, Service Exports
    |
    +---> Task Group 2: SA System Prompt Template (depends on types)
    |         |
    +---> Task Group 3: SA Response Validator (depends on types)
    |         |
    +---------+---> Task Group 4: Chat Route Handler Wiring (depends on prompt + validator)
                        |
                        +---> Task Group 5: Frontend Types, SA Panel, ProductPage Sub-Tabs
                                    |
                                    +---> Task Group 6: Test Review & Gap Analysis
```

1. **Task Group 1** (Gateway Types & Config) -- no dependencies, foundational types needed by all subsequent groups
2. **Task Group 2** (SA Prompt) and **Task Group 3** (SA Validator) -- can run in parallel, both depend only on Task Group 1
3. **Task Group 4** (Chat Route Handler) -- depends on Task Groups 2 and 3 (needs both prompt and validator)
4. **Task Group 5** (Frontend) -- depends on Task Group 4 (gateway must fully support `solution_architect` mode before frontend can integrate)
5. **Task Group 6** (Test Review & Gap Analysis) -- depends on all prior groups

## Key Files Modified

| File | Task Group | Change Description |
|------|-----------|-------------------|
| `gateway/src/types/chat.ts` | 1 | Add ChatMode value, SA types, ChatResponse field |
| `gateway/src/services/transcriptWriter.ts` | 1 | Add `'solution_architect'` to ALLOWED_KINDS |
| `gateway/src/services/promptBuilder.ts` | 2 | Add SOLUTION_ARCHITECT_PROMPT_TEMPLATE + routing |
| `gateway/src/services/solutionArchitectResponseValidator.ts` | 3 | New file: validator + fallback |
| `gateway/src/services/index.ts` | 3 | Export SA validator functions |
| `gateway/src/routes/chat.ts` | 4 | Add SA validation block with corrective retry |
| `frontend/src/api/chatApi.ts` | 5 | Add SA types + ChatResponse field |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | 5 | New file: SA chat panel component |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` | 5 | New file: SA panel styles |
| `frontend/src/components/ProductView/ProductPage.tsx` | 5 | Add sub-tab layout for PM/SA toggle |
| `frontend/src/components/ProductView/ProductPage.module.css` | 5 | Add sub-tab bar styles |

## Key Files Referenced (Read-Only)

| File | Purpose |
|------|---------|
| `gateway/src/services/productManagerResponseValidator.ts` | Template pattern for SA validator |
| `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` | Template pattern for SA panel |
| `frontend/src/components/ProductView/ProductManagerChatPanel.module.css` | Template pattern for SA panel styles |
| `gateway/src/services/plannerResponseValidator.ts` | Provides `extractJson()` utility |
| `frontend/src/components/ProductView/UploadDocumentsModal.tsx` | Reused as-is in SA panel |
