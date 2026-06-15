# Specification: SA Increment 3 -- Structured SA Response Contract + Skip/Unknown Handling + Readiness Gate

## Goal
Expand the Solution Architect JSON response contract from 7 to 9 sections (renaming `non_functional_requirements` to `non_functional`, adding `artefact_review` and `final_review`), and enhance the system prompt with section progression, skip/unknown handling, and a deterministic readiness gate -- all enforced at the prompt level only, with no code-level tracking.

## User Stories
- As a Solution Architect user, I want the SA to progress logically through architecture discovery sections (including artefact upload and final review) so that the conversation produces a comprehensive baseline before signaling readiness.
- As a Solution Architect user, I want to say "I don't know" or "skip" to questions I cannot answer, and have the SA gracefully record the gap and move on, so that progress is never blocked.

## Specific Requirements

**R-1: Section Enum Expansion (Hard Cut-over, 7 to 9 Sections)**
- Remove `non_functional_requirements` from all locations and replace with `non_functional`
- Add `artefact_review` and `final_review` as new valid section values
- Full 9-section list: `context_and_boundaries`, `ui_and_channels`, `integrations`, `data_model`, `service_decomposition`, `business_logic`, `non_functional`, `artefact_review`, `final_review`
- This is a hard cut-over: all four files (validator, types, prompt, frontend) must be updated together; old `non_functional_requirements` becomes immediately invalid
- Update `VALID_SECTIONS` set in `gateway/src/services/solutionArchitectResponseValidator.ts` (lines 36-44) from 7 entries to 9 entries with the rename
- Update `SolutionArchitectResponse` type union in `gateway/src/types/chat.ts` (line 704) from 7 values to 9 values with the rename
- Update the JSDoc comment on `SolutionArchitectResponse` that references "7 enumerated sections" to say "9 enumerated sections"
- Update the validator JSDoc comment (line 34) referencing "7 enumerated architecture discovery sections" to "9"

**R-2: Prompt Template -- Section List Update**
- In `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts`, replace the current 7-section list under "ARCHITECTURE DISCOVERY SECTIONS" with the full 9-section list
- Section 7 becomes: `non_functional` -- Performance targets, scalability needs, availability/SLA, security, compliance, observability
- Section 8: `artefact_review` -- SA explicitly asks whether the user wants to upload any additional artefacts (documents, diagrams, specs); SA can ask brief follow-up questions about uploaded content
- Section 9: `final_review` -- SA presents a consolidated architecture recap including all assumptions and open items; this is the last section before phase="ready"
- Update the `"section"` field definition in the RESPONSE FORMAT block to list all 9 values
- Update RULES item 3 to reference "9 enumerated values" instead of "7"

**R-3: Prompt Template -- Section Progression Model (Prompt-Level Only)**
- Add a new "SECTION PROGRESSION" block (or extend existing guidance) that defines the expected order: context_and_boundaries, ui_and_channels, integrations, data_model, service_decomposition, business_logic, non_functional, artefact_review, final_review
- Instruct the SA to progress through sections in logical order but allow skipping sections and revisiting previous sections for clarification
- Instruct the SA that it must reach `final_review` before setting `phase="ready"`
- No code-level enforcement or tracking of progression -- this is entirely driven by prompt instructions

**R-4: Prompt Template -- Skip/Unknown Handling (Prompt-Level Only)**
- Expand the existing "HANDLING UNCERTAINTY" block in the prompt to explicitly list trigger phrases: "I don't know", "Not decided", "Skip", "Come back later", "No idea", "Pass"
- Instruct the SA: when the user gives a skip/unknown response, do NOT repeat the question, record an assumption in the `assumptions` array, add the topic to `openItems`, and move to the next question or section
- Ensure the instruction is clear that skipped items should never block section progression
- No code-level detection of skip/unknown -- this is entirely driven by prompt instructions

**R-5: Prompt Template -- Readiness Gate (Prompt-Level Only)**
- Add a new "READINESS GATE" block to the prompt that defines the minimum baseline requirements before the SA may set `phase="ready"`
- Minimum baseline: at least one service identified (or the default "Core Application Service"), at least one data entity identified or an explicit "none needed" acknowledgment, at least one integration identified or an explicit "none needed" acknowledgment, a high-level architecture summary exists in the conversation, and all sections have been visited or explicitly skipped
- When ready: set `phase="ready"`, set `section="final_review"`, set `questions` to empty array, include an architecture recap in `summary`, and ask the user for confirmation to save
- Replace the existing "SUFFICIENCY TRACKING" block with this more prescriptive readiness gate
- No validator inspection of conversation history -- this is entirely driven by prompt instructions

**R-6: Frontend -- sectionDisplayName() Update**
- In `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`, update the `sectionDisplayName()` function (lines 59-68)
- Remove the entry for `non_functional_requirements`
- Add entry: `non_functional` maps to `"Non-Functional"`
- Add entry: `artefact_review` maps to `"Artefact Review"`
- Add entry: `final_review` maps to `"Final Review"`
- No other UI component changes

**R-7: Frontend -- Ready Banner Text Update**
- In `SolutionArchitectChatPanel.tsx`, update the ready banner text (line 492) from `"Architecture baseline is ready. Save functionality coming in a future increment."` to `"Architecture baseline is complete. Would you like to save?"`
- Save functionality is not wired in this increment (deferred to Increment 5); the text change is forward-looking

**R-8: Fallback Response Unchanged**
- `createFallbackSolutionArchitectResponse()` in the validator continues to return `section: 'context_and_boundaries'`
- No changes needed to the fallback function

**R-9: Existing Tests Update**
- Update `gateway/src/services/__tests__/solutionArchitectResponseValidator.test.ts` to validate against the new 9-section set and ensure `non_functional_requirements` is rejected as invalid
- Update `frontend/src/__tests__/solutionArchitect-frontend.test.ts` to test the updated `sectionDisplayName()` entries and new ready banner text
- Update `frontend/src/__tests__/solutionArchitect-gap-tests.test.ts` if it contains references to the old section names
- Add test cases verifying `artefact_review` and `final_review` are accepted as valid sections by the validator
- Add test case verifying `non_functional` is accepted and `non_functional_requirements` is rejected

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`gateway/src/services/solutionArchitectResponseValidator.ts` -- Validator with VALID_SECTIONS set**
- Lines 36-44 define `VALID_SECTIONS` as a `ReadonlySet<string>` with the current 7 values; update in place to 9 values
- The `validateSolutionArchitectResponse()` function validates `section` against this set (line 105); no logic changes needed, only the set contents change
- `createFallbackSolutionArchitectResponse()` returns `section: 'context_and_boundaries'` (line 199); keep unchanged
- Corrective retry logic from SA Increment 1 continues to work against the updated 9-section set without modification

**`gateway/src/types/chat.ts` -- SolutionArchitectResponse type**
- Line 704 defines the `section` union type with 7 literal string values; update to 9 values with the rename
- The `phase` field already supports `"discovery"`, `"deepening"`, `"ready"` which remains unchanged
- The `SolutionArchitectValidationResult` interface needs no changes

**`gateway/src/services/promptBuilder.ts` -- SOLUTION_ARCHITECT_PROMPT_TEMPLATE**
- Lines 375-457 define the full SA system prompt template; update the ARCHITECTURE DISCOVERY SECTIONS list, RESPONSE FORMAT section field, RULES section count, HANDLING UNCERTAINTY block, and SUFFICIENCY TRACKING block
- The CONTEXT ALIGNMENT section (lines 452-457) for standards/mission injection remains unchanged
- The `buildSystemPrompt()` SA branch (lines 1379-1393) appending mission and tech-stack content requires no changes

**`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` -- Frontend panel**
- Lines 58-69: `sectionDisplayName()` is a standalone exported function with a simple Record lookup; update the map entries
- Line 492: Ready banner text is a plain string in JSX; update the text content
- Upload Documents flow (lines 328-383) and modal integration remain unchanged

**Existing test files**
- `gateway/src/services/__tests__/solutionArchitectResponseValidator.test.ts` tests validation against the 7-section set; update to 9 sections
- `frontend/src/__tests__/solutionArchitect-frontend.test.ts` and `solutionArchitect-gap-tests.test.ts` test the frontend component rendering; update for new section names and banner text

## Out of Scope
- MCP tools integration or any tool_calls from the SA persona
- Architecture meta-model writes or persistence (saving architecture data to disk or database)
- Diagram creation or any deliverable artifact generation
- Changes to `product_manager` mode (prompts, types, or frontend)
- Changes to standards/mission injection logic (already complete from SA Increment 2)
- Conversation reset or "start over" functionality
- Any changes to the Upload Documents flow or `UploadDocumentsModal` component
- Code-level section progression enforcement or state tracking (no server-side progression tracking)
- Validator inspection of conversation history for readiness gate enforcement
- Save functionality wiring (deferred to Increment 5; this spec only updates the banner text)
- Adding `"discovery"` or `"deepening"` as new phase values (phase remains `"questions"` | `"ready"`)
