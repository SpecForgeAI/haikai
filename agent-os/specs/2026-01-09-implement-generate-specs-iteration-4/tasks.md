# Task Breakdown: Implement Generate Specs - Iteration 4

## Overview
Total Tasks: 22

This feature extends the Implementation Assistant with a "Generate Specs" capability. After the clarification dialog (steps 1a-1e), users can click an Implement button to have the OpenAI Planner convert the agreed feature into a JSON array of `/agent-os:write-spec` commands, displayed read-only without execution.

## Execution Order

The implementation follows a dependency-driven order:
1. **Gateway Layer** (Task Groups 1-3) - Types, validation, and prompt changes must be complete before frontend can consume them
2. **Frontend Layer** (Task Groups 4-5) - Consumes the Gateway changes

---

## Gateway Layer

### Task Group 1: Type Extensions and Validation
**Dependencies:** None

- [x] 1.0 Complete Gateway type extensions and validation logic
  - [x] 1.1 Write 3-4 focused tests for specs validation
    - Test valid JSON array with proper `/agent-os:write-spec` prefixes returns `{ valid: true, specs: [...] }`
    - Test invalid JSON returns `{ valid: false, error: "Response is not valid JSON" }`
    - Test non-array JSON returns `{ valid: false, error: "Response is not a JSON array" }`
    - Test array with invalid string format returns `{ valid: false, error: "Invalid spec format" }`
  - [x] 1.2 Extend ChatIntent type in `gateway/src/types/chat.ts`
    - Change `type ChatIntent = 'normal_chat';` to `type ChatIntent = 'normal_chat' | 'generate_specs';`
  - [x] 1.3 Extend ChatResponse interface in `gateway/src/types/chat.ts`
    - Add optional `specs?: string[]` field to `ChatResponse` interface
    - Document: "Only populated when intent is generate_specs and validation succeeds"
  - [x] 1.4 Create `gateway/src/services/specsValidator.ts`
    - Implement `validateGeneratedSpecs(content: string): { valid: boolean; specs?: string[]; error?: string }`
    - Parse content with `JSON.parse` wrapped in try-catch
    - Check `Array.isArray` on parsed result
    - Check each element is a non-empty string
    - Check each string starts with `/agent-os:write-spec`
    - Return appropriate validation result
  - [x] 1.5 Export specsValidator from `gateway/src/services/index.ts`
  - [x] 1.6 Ensure validation tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify all validation scenarios work correctly

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- ChatIntent type includes "generate_specs"
- ChatResponse interface has optional specs field
- validateGeneratedSpecs correctly validates all edge cases

---

### Task Group 2: Generate Specs System Prompt
**Dependencies:** Task Group 1

- [x] 2.0 Complete Generate Specs prompt template
  - [x] 2.1 Write 2-3 focused tests for prompt building
    - Test that buildSystemPrompt returns generate specs prompt when mode is "implement_feature" and intent is "generate_specs"
    - Test that prompt contains work item and architecture context placeholders replaced
    - Test that prompt contains JSON array format instructions
  - [x] 2.2 Create IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE in `gateway/src/services/promptBuilder.ts`
    - Include work item context placeholders: `{workItemTitle}`, `{workItemType}`, `{workItemDescription}`
    - Include architecture context placeholders: `{entityIds}`, `{diagramIds}`, `{resolvedContext}`
    - Instruct model to produce ONLY a JSON array of strings
    - Each string must be a complete `/agent-os:write-spec` command with YAML content inline
    - Include example format: `[ "/agent-os:write-spec ...", "/agent-os:write-spec ..." ]`
    - Explicitly forbid: explanatory prose, executing commands, modifying code, calling tools
    - Instruct model to consider full conversation history and clarified feature understanding
  - [x] 2.3 Create buildGenerateSpecsPrompt function in `gateway/src/services/promptBuilder.ts`
    - Follow pattern from existing `buildImplementPlannerPrompt`
    - Accept context and resolvedContext parameters
    - Replace all placeholders with actual values
    - Reuse `formatResolvedContext` helper for resolved context injection
  - [x] 2.4 Update buildSystemPrompt to select generate specs prompt
    - Add condition: if `context?.mode === 'implement_feature' && context?.intent === 'generate_specs'`
    - Call `buildGenerateSpecsPrompt` instead of `buildImplementPlannerPrompt`
  - [x] 2.5 Ensure prompt building tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify prompt selection logic works correctly

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE is well-structured with clear instructions
- buildSystemPrompt correctly selects generate specs prompt based on mode and intent
- Prompt includes all required context injection

---

### Task Group 3: Gateway Response Handling
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete Gateway response handling for generate_specs intent
  - [x] 3.1 Write 3-4 focused tests for response handling
    - Test that valid generate_specs response returns ChatResponse with specs array
    - Test that invalid generate_specs response returns ChatResponse with error message and no specs
    - Test that normal_chat intent does not trigger specs validation
    - Test that specs field is not present when intent is normal_chat
  - [x] 3.2 Update POST /api/chat handler in `gateway/src/routes/chat.ts`
    - Import `validateGeneratedSpecs` from services
    - After receiving OpenAI response when `context?.intent === 'generate_specs'`:
      - Call `validateGeneratedSpecs(response.content)`
      - If validation succeeds: add `specs` field to ChatResponse
      - If validation fails: set `assistant.message` to error explanation
  - [x] 3.3 Ensure response content is preserved correctly
    - When valid: set `assistant.message` to raw JSON string, add `specs` array
    - When invalid: set `assistant.message` to error explanation, no `specs` field
  - [x] 3.4 Add logging for generate_specs validation
    - Log validation result (success/failure) with request ID
    - Log spec count on success
    - Log error message on failure
  - [x] 3.5 Ensure response handling tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify specs are correctly returned or errors are handled

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Valid generate_specs responses include specs array
- Invalid responses return meaningful error messages
- Normal chat flow is unaffected

---

## Frontend Layer

### Task Group 4: Frontend Types and API Extension
**Dependencies:** Task Group 3 (Gateway must be complete)

- [x] 4.0 Complete Frontend type and API extensions
  - [x] 4.1 Write 2-3 focused tests for API types and state
    - Test that ImplementChatContext accepts intent "generate_specs"
    - Test that ChatResponse type allows optional specs array
    - Test that generatedSpecs state initializes to null
  - [x] 4.2 Extend ImplementChatContext interface in `frontend/src/api/chatApi.ts`
    - Change `intent: 'normal_chat'` to `intent: 'normal_chat' | 'generate_specs'`
  - [x] 4.3 Extend ChatResponse interface in `frontend/src/api/chatApi.ts`
    - Add optional `specs?: string[]` field
  - [x] 4.4 Add generatedSpecs state to ImplementationAssistantPanel
    - Add state: `const [generatedSpecs, setGeneratedSpecs] = useState<string[] | null>(null);`
    - Clear generatedSpecs in useEffect when workItemId changes (alongside sessionId/messages reset)
  - [x] 4.5 Ensure frontend type tests pass
    - Run ONLY the 2-3 tests written in 4.1

**Acceptance Criteria:**
- The 2-3 tests written in 4.1 pass
- ImplementChatContext supports generate_specs intent
- ChatResponse supports optional specs array
- generatedSpecs state is properly managed

---

### Task Group 5: Implement Button and Click Handler
**Dependencies:** Task Group 4

- [x] 5.0 Complete Implement button and click handler
  - [x] 5.1 Write 3-4 focused tests for Implement button
    - Test button renders adjacent to Send button
    - Test button is disabled when no sessionId exists
    - Test button is disabled when isLoading is true
    - Test button is enabled when sessionId exists AND isLoading is false AND workItemId is present
  - [x] 5.2 Add Implement button to input area in ImplementationAssistantPanel
    - Position adjacent to ChatInput (may require restructuring inputArea)
    - Use distinct visual style (green or secondary accent background)
    - Button label: "Implement"
    - Add data-testid="implement-button"
  - [x] 5.3 Add CSS styles for Implement button in ImplementationAssistantPanel.module.css
    - Create `.implementButton` class with green/accent background (#4CAF50 or similar)
    - Include hover and disabled states
    - Match sizing and border-radius with Send button pattern from ChatInput.module.css
    - Add `.buttonRow` class for flex layout containing both buttons
  - [x] 5.4 Implement button disabled state logic
    - Disabled when: `!sessionId || isLoading || !workItemId`
    - Enabled when: `sessionId && !isLoading && workItemId`
  - [x] 5.5 Create handleImplement callback in ImplementationAssistantPanel
    - Follow pattern from existing `handleSend` callback
    - Construct context with `intent: 'generate_specs'`
    - Set message to "Proceed to implementation planning"
    - Include: mode, intent, projectId (as filename), workItem, architectureContext
    - Set isLoading to true during request
    - On success: extract specs array from response, call `setGeneratedSpecs(response.specs || null)`
    - On error: handle similarly to handleSend error handling
    - Set isLoading to false in finally block
  - [x] 5.6 Ensure Implement button tests pass
    - Run ONLY the 3-4 tests written in 5.1

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Implement button renders with correct styling
- Button state (enabled/disabled) follows specification rules
- handleImplement correctly calls API with generate_specs intent
- generatedSpecs state is updated on successful response

---

### Task Group 6: Generated Specs Display Panel
**Dependencies:** Task Group 5

- [x] 6.0 Complete Generated Specs display panel
  - [x] 6.1 Write 3-4 focused tests for specs display
    - Test panel is hidden when generatedSpecs is null
    - Test panel is hidden when generatedSpecs is empty array
    - Test panel renders with header when generatedSpecs has items
    - Test each spec is displayed in pre-formatted code block
  - [x] 6.2 Create GeneratedSpecsPanel component or inline section
    - Conditionally render when `generatedSpecs && generatedSpecs.length > 0`
    - Include header: "Generated Specifications (Not Yet Executed)"
    - Include warning message: "These specifications have not been executed. No changes have been made."
    - Display each spec string in a `<pre>` block with monospace font
  - [x] 6.3 Add CSS styles for specs panel in ImplementationAssistantPanel.module.css
    - Create `.specsPanel` container class
    - Create `.specsPanelHeader` class for header styling
    - Create `.specsWarning` class for warning message (amber/yellow background)
    - Create `.specBlock` class for individual spec display (monospace, background, padding)
    - Create `.copyButton` class for copy button styling
  - [x] 6.4 Implement Copy functionality
    - Add "Copy All" button in panel header
    - On click: copy all specs joined by newlines to clipboard using `navigator.clipboard.writeText`
    - Optional: add individual copy button per spec
  - [x] 6.5 Position specs panel in component layout
    - Display inline within ImplementationAssistantPanel (not modal)
    - Position between messages/content area and input area, or as overlay/modal
    - Ensure scrollability for long spec lists
  - [x] 6.6 Ensure specs display tests pass
    - Run ONLY the 3-4 tests written in 6.1

**Acceptance Criteria:**
- The 3-4 tests written in 6.1 pass
- Panel displays only when generatedSpecs has content
- Header and warning are clearly visible
- Specs are displayed in readable pre-formatted blocks
- Copy functionality works correctly

---

## Integration Testing

### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 3-4 tests from Task Group 1 (validation)
    - Review the 2-3 tests from Task Group 2 (prompt building)
    - Review the 3-4 tests from Task Group 3 (response handling)
    - Review the 2-3 tests from Task Group 4 (frontend types)
    - Review the 3-4 tests from Task Group 5 (button behavior)
    - Review the 3-4 tests from Task Group 6 (display panel)
    - Total existing tests: approximately 17-22 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflow gaps
    - Focus on integration between Gateway and Frontend
    - Prioritize user journey: click Implement -> receive specs -> view specs
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - End-to-end: Implement button click triggers API call with correct context
    - End-to-end: Successful response populates generatedSpecs and displays panel
    - End-to-end: Error response shows error message, no specs panel
    - Integration: workItemId change clears generatedSpecs
    - Integration: Session continuity preserved after generate_specs call
    - Edge case: Empty specs array from API hides panel
    - Skip exhaustive coverage for all component states
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 25-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical user workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-30 tests total)
- Critical user workflows are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on Iteration 4 feature requirements

---

## Summary

| Task Group | Focus Area | Estimated Tests | Actual Tests |
|------------|------------|-----------------|--------------|
| 1 | Gateway Types & Validation | 3-4 | 14 |
| 2 | Generate Specs Prompt | 2-3 | 9 |
| 3 | Gateway Response Handling | 3-4 | 8 |
| 4 | Frontend Types & API | 2-3 | 6 |
| 5 | Implement Button & Handler | 3-4 | 8 |
| 6 | Specs Display Panel | 3-4 | 9 |
| 7 | Integration Testing | up to 8 | 19 (11 gateway + 8 frontend) |
| **Total** | | **25-30** | **73** |

## Key Files Modified

**Gateway:**
- `gateway/src/types/chat.ts` - ChatIntent and ChatResponse extensions
- `gateway/src/services/specsValidator.ts` - New file for validation logic
- `gateway/src/services/promptBuilder.ts` - IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE and buildGenerateSpecsPrompt
- `gateway/src/services/index.ts` - Export specsValidator
- `gateway/src/routes/chat.ts` - Response handling for generate_specs intent

**Frontend:**
- `frontend/src/api/chatApi.ts` - ImplementChatContext and ChatResponse extensions
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Implement button, handler, specs state, display panel
- `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` - Button and panel styles

## Test Files Created

**Gateway:**
- `gateway/src/__tests__/specs-validator.test.ts` - 14 tests
- `gateway/src/__tests__/generate-specs-prompt.test.ts` - 9 tests
- `gateway/src/__tests__/generate-specs-response.test.ts` - 8 tests
- `gateway/src/__tests__/generate-specs-integration.test.ts` - 11 tests

**Frontend:**
- `frontend/src/__tests__/generate-specs-types.test.ts` - 6 tests
- `frontend/src/__tests__/implement-button.test.tsx` - 8 tests
- `frontend/src/__tests__/generated-specs-panel.test.tsx` - 9 tests
- `frontend/src/__tests__/generate-specs-integration.test.tsx` - 8 tests

## Implementation Status: COMPLETE

All 7 task groups have been implemented and tested. The feature is ready for review.
