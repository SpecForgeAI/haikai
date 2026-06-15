# Spec Requirements: SA Increment 3 -- Structured SA Response Contract + Skip/Unknown Handling + Readiness Gate

## Initial Description

Formalize the Solution Architect (SA) JSON response contract, enforce validation with corrective retry, support user skip/unknown handling, and implement a deterministic readiness gate. This increment remains tool-less and does NOT persist architecture data.

**Key Scope from Raw Idea:**
- Strict JSON response schema for solution_architect mode with expanded section enum (adds `artefact_review`, `final_review`; `non_functional` replaces `non_functional_requirements`)
- Server-side validation + single corrective retry on parse failure (already exists from SA Inc 1, needs updates)
- Enumerated section progression model in system prompt
- Explicit skip/unknown handling logic in system prompt
- Deterministic readiness gate with minimum baseline requirements
- Minor frontend adjustments to SolutionArchitectChatPanel

**Excludes (from Raw Idea):**
- MCP tools
- Architecture meta-model writes
- Diagram creation
- Changes to product_manager mode
- Changes to standards/mission injection

## Requirements Discussion

### First Round Questions

**Q1: Section Enum Rename Coordination**
The current validator and type definition use `non_functional_requirements`. The spec renames this to `non_functional` and adds `artefact_review` and `final_review` (9 sections total). Should the rename be a hard cut-over (update types, validator, prompt, and frontend together; old `non_functional_requirements` becomes invalid immediately) or a soft migration (accept both old and new values during a transition period)?

**Answer:** Option A (Hard cut-over) -- update types, validator, prompt, and frontend together; old `non_functional_requirements` becomes invalid immediately.

**Q2: Fallback Response Update**
Current `createFallbackSolutionArchitectResponse` returns `section: 'context_and_boundaries'`. Should the fallback section remain `context_and_boundaries` or change to one of the new sections?

**Answer:** Option A -- keep fallback section as `context_and_boundaries`.

**Q3: Section Progression Enforcement**
There is an expected section order with skip/revisit allowance. Should progression enforcement be prompt-level only (instruct the LLM in the system prompt) or should there also be code-level enforcement/tracking?

**Answer:** Option A -- prompt-level only (no code-level enforcement/tracking in this increment).

**Q4: Readiness Gate Enforcement**
There are minimum requirements before `phase="ready"` is allowed. Should the readiness gate be enforced at the prompt level only, or should the validator also inspect conversation history?

**Answer:** Option A -- prompt-level only (no validator inspection of conversation history yet).

**Q5: New Sections Behavior**
What is the expected behavior of the two new sections (`artefact_review` and `final_review`)?

**Answer:**
- `artefact_review` = SA explicitly asks/handles "upload any additional artefacts" and can ask brief follow-ups about the uploaded docs.
- `final_review` = SA presents consolidated architecture recap + assumptions/open items and is the last step before `phase="ready"`.

**Q6: Ready Banner Text Update**
The current ready banner text reads: "Architecture baseline is ready. Save functionality coming in a future increment." Should it be updated?

**Answer:** Option B -- update banner to reflect the ready gate: "Architecture baseline is complete. Would you like to save?" (even though save isn't wired until Increment 5).

**Q7: Frontend Scope**
Is the frontend scope limited to updating `sectionDisplayName` + replacing `non_functional_requirements` with `non_functional` + adding the two new section display names, with no other UI changes?

**Answer:** Yes -- scope is limited to updating `sectionDisplayName` + replacing `non_functional_requirements` with `non_functional` + adding the two new section display names; no other UI changes.

**Q8: Additional Exclusions**
Are there any additional items to explicitly exclude from scope?

**Answer:** Yes -- explicitly exclude conversation reset/clear and exclude any changes to the Upload Documents flow (reuse as-is).

### Existing Code to Reference

The following files and locations were identified during codebase research as directly relevant to this increment:

**Validator (server-side):**
- File: `gateway/src/services/solutionArchitectResponseValidator.ts`
  - Lines 36-44: `VALID_SECTIONS` set with current 7 values (`context_and_boundaries`, `stakeholders_and_concerns`, `functional_requirements`, `non_functional_requirements`, `integration_and_data`, `security_and_compliance`, `infrastructure_and_deployment`)
  - Contains corrective retry logic from SA Inc 1

**Type Definitions:**
- File: `gateway/src/types/chat.ts`
  - `SolutionArchitectResponse` type with `section` union of current 7 values
  - `phase` field already supports `"discovery"`, `"deepening"`, `"ready"`

**System Prompt:**
- File: `gateway/src/services/promptBuilder.ts`
  - `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` listing current 7 sections
  - Standards/mission injection already exists from SA Inc 2

**Frontend:**
- File: `frontend/src/components/SolutionArchitectChatPanel.tsx`
  - Lines 59-67: `sectionDisplayName()` function with 7 entries
  - Ready banner with current text: "Architecture baseline is ready. Save functionality coming in a future increment."
  - `createFallbackSolutionArchitectResponse` returning `section: 'context_and_boundaries'`

### Follow-up Questions

No follow-up questions were needed. All 8 questions received clear, unambiguous answers.

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` directory exists but contains no image files.

### Visual Insights:
Not applicable -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Section Enum Expansion (7 to 9 sections):**
- Rename `non_functional_requirements` to `non_functional` (hard cut-over, no backward compatibility)
- Add `artefact_review` section -- SA asks user to upload any additional artefacts and can ask brief follow-ups about uploaded docs
- Add `final_review` section -- SA presents consolidated architecture recap with assumptions and open items; this is the last step before `phase="ready"`
- Full 9-section list: `context_and_boundaries`, `stakeholders_and_concerns`, `functional_requirements`, `non_functional`, `integration_and_data`, `security_and_compliance`, `infrastructure_and_deployment`, `artefact_review`, `final_review`

**Section Progression (Prompt-Level Only):**
- Define expected section order in the system prompt
- Allow skipping sections and revisiting previous sections
- No code-level enforcement or tracking -- this is entirely prompt-driven

**Skip/Unknown Handling (Prompt-Level Only):**
- System prompt instructs the SA how to handle user responses like "I don't know" or "skip"
- SA should acknowledge the skip and move on gracefully
- No code-level detection of skip/unknown

**Readiness Gate (Prompt-Level Only):**
- System prompt defines minimum baseline requirements before SA may set `phase="ready"`
- No validator inspection of conversation history in this increment
- Enforcement is entirely through prompt instructions to the LLM

**Fallback Response:**
- Keep `createFallbackSolutionArchitectResponse` returning `section: 'context_and_boundaries'` (no change)

**Ready Banner Update:**
- Change text from "Architecture baseline is ready. Save functionality coming in a future increment." to "Architecture baseline is complete. Would you like to save?"

**Frontend Display Names:**
- Update `sectionDisplayName()` to:
  - Remove entry for `non_functional_requirements`
  - Add entry for `non_functional`
  - Add entry for `artefact_review`
  - Add entry for `final_review`
- No other UI changes

### Reusability Opportunities

- SA corrective retry and validation logic already exist from Inc 1 -- update in place, do not rewrite
- Standards/mission injection already exists from Inc 2 -- no changes needed
- Upload Documents flow is reused as-is -- no changes to that flow
- The existing `VALID_SECTIONS` set pattern in the validator is the template for the update

### Scope Boundaries

**In Scope:**
- Update `VALID_SECTIONS` set in validator (7 to 9 values, rename `non_functional_requirements` to `non_functional`)
- Update `SolutionArchitectResponse` type union (7 to 9 values, same rename)
- Update `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` with 9 sections, section progression order, skip/unknown handling instructions, and readiness gate instructions
- Update `sectionDisplayName()` in frontend (remove old, add 3 new entries)
- Update ready banner text
- Update any tests affected by the above changes

**Out of Scope:**
- MCP tools
- Architecture meta-model writes / persistence
- Diagram creation
- Changes to product_manager mode
- Changes to standards/mission injection (already complete from Inc 2)
- Conversation reset/clear functionality
- Any changes to the Upload Documents flow
- Code-level section progression enforcement or tracking
- Validator inspection of conversation history for readiness gate
- Save functionality wiring (deferred to Increment 5)

### Technical Considerations

**Files That Will Need Changes:**
1. `gateway/src/services/solutionArchitectResponseValidator.ts` -- update `VALID_SECTIONS` set (lines 36-44) from 7 to 9 entries, rename `non_functional_requirements` to `non_functional`
2. `gateway/src/types/chat.ts` -- update `SolutionArchitectResponse` type `section` union from 7 to 9 values, same rename
3. `gateway/src/services/promptBuilder.ts` -- update `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` with 9 sections, add section progression order, add skip/unknown handling instructions, add readiness gate instructions
4. `frontend/src/components/SolutionArchitectChatPanel.tsx` -- update `sectionDisplayName()` (lines 59-67) with new/renamed entries, update ready banner text

**Existing Behavior Preserved:**
- Corrective retry on parse failure (from Inc 1) -- continues to work, now validates against 9 sections instead of 7
- Standards/mission injection (from Inc 2) -- unchanged
- Fallback response returns `section: 'context_and_boundaries'` -- unchanged
- Upload Documents flow -- unchanged, reused as-is

**Key Constraint:**
- Hard cut-over for the rename means all four files (validator, types, prompt, frontend) must be updated together in a single coordinated change
