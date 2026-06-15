# Spec Requirements: RM Increment 1 -- Roadmap PM Mode + LHS Chat Panel (Tool-less, No Saving)

## Initial Description

Introduce a new Product Manager persona conversation on the Roadmap screen that structures high-level Initiatives (L1) and Epics (L2). This increment is tool-less and does NOT persist or import any roadmap data. It only enables structured roadmap discussion in a dedicated LHS chat panel.

Key elements from the raw idea:
- New chat mode: `roadmap_pm`
- LHS chat panel on Roadmap screen
- Structured JSON response contract (questions | ready) with 7 sections
- Roadmap-focused system prompt with "Senior Product Manager -- Roadmap Planning" persona
- Transcript persistence under `kind="roadmap_pm"`
- No MCP tools, no roadmap saving, no Jira import, no work_item writes
- Systems affected: gateway (primary), frontend (RoadmapScreen). No changes to mcp-server, architecture-model-service, or jira-service.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea specifies 7 section values for the structured response contract: `roadmap_existence_check`, `outcome_alignment`, `architecture_alignment`, `sequencing_strategy`, `initiative_structure`, `epic_structure`, `final_review`. The existing SA mode uses 9 sections and validates them strictly in the response validator. I assume we will follow the exact same validation pattern (validate section against a fixed allowlist, require `phase` to be `"questions"` or `"ready"`, require `questions` non-empty when phase is `"questions"`, require `summary` non-empty). Is that correct, or should the Roadmap PM response contract have any additional validation rules?
**Answer:** Follow the identical strict validation pattern (section allowlist + phase enum + non-empty summary + non-empty questions when phase="questions"); add one extra rule: when phase="ready", proposedInitiatives must be present and non-empty.

**Q2:** The raw idea includes `proposedInitiatives`, `assumptions`, and `openItems` as additional fields in the response contract beyond what PM and SA modes have (which only have `phase`, `questions`, `summary`, and optionally `section`). This makes the Roadmap PM response the richest structured response type in the system. I assume: (a) `proposedInitiatives` is only populated when `phase="ready"` and is an empty array during `phase="questions"`, (b) `assumptions` and `openItems` are populated progressively throughout the conversation and can appear in any phase, (c) validation should ensure `proposedInitiatives` items have `title` (string) and `epics` (array) but should be lenient on empty arrays. Are these assumptions correct, or should the fields behave differently?
**Answer:** Yes--(a) proposedInitiatives can be empty/omitted during phase="questions" and is required/non-empty in phase="ready"; (b) assumptions/openItems can appear in any phase and grow over time; (c) validate titles as non-empty strings and epics as arrays, allow empty epics during questions but require at least one epic overall by ready (lenient per-initiative).

**Q3:** The current Roadmap screen (`ProductRoadmapPage.tsx`) uses a `ResizableSplitPane` with a tree on the left and details on the right. The raw idea says: LHS = `RoadmapPmChatPanel`, RHS = existing roadmap grid (unchanged). I assume this means replacing the current `ResizableSplitPane` left/right content rather than adding a third column -- specifically, the chat panel becomes the new left pane and the entire existing `ProductRoadmapPage` content (tree + details) becomes the right pane. Alternatively, should the chat panel sit alongside the existing resizable layout as a separate column?
**Answer:** Replace the existing left pane with the chat panel (chat becomes left); keep the existing tree+details within the right side (still resizable within that right area if it already is).

**Q4:** The bootstrap message in the raw idea is: `"Help me define the high-level roadmap for this product."` The existing PM and SA panels both use `productName` in their bootstrap messages. I assume the Roadmap PM bootstrap should similarly include the product name: `"Help me define the high-level roadmap for ${productName}."` Is that correct?
**Answer:** Yes--bootstrap should include productName: "Help me define the high-level roadmap for ${productName}."

**Q5:** For transcript persistence, the raw idea specifies `kind="roadmap_pm"` with `featureId = projectId` and `featureTitle = "Roadmap PM"`. The existing `ALLOWED_KINDS` in `transcriptWriter.ts` are `['implement', 'product', 'solution_architect']`. I assume we need to add `'roadmap_pm'` to this allowlist, and the conversation path will be `<projectParentFolder>/conversations/roadmap_pm/<derivedFolderName>/`. I also assume the `shouldAppendToTranscript()` and `flushTranscriptToDisk()` functions in `chat.ts` need to be extended to include `mode === 'roadmap_pm'`, following the same pattern as `solution_architect`. Is that correct?
**Answer:** Yes--add 'roadmap_pm' to ALLOWED_KINDS and thread mode/kind through the same transcript append/flush mechanisms used for solution_architect.

**Q6:** The existing SA mode in `chat.ts` loads `MISSION.MD` and `TECH-STACK.MD` for context injection into the system prompt, and has a standards-missing short-circuit when `TECH-STACK.MD` is absent. Should the Roadmap PM mode also auto-inject any project files into its system prompt for context alignment, or should it operate purely from conversation history with no file loading?
**Answer:** Yes--auto-inject at least MISSION.MD into the system prompt for Roadmap PM; TECH-STACK.MD is optional here (can omit in v0.1) since roadmap is primarily value sequencing, but mission is required.

**Q7:** The raw idea specifies corrective retry for validation (matching the SA pattern: first validation failure triggers a single retry with a corrective instruction, second failure falls back). I assume we follow the identical corrective-retry pattern from `chat.ts`, creating: (a) a `shouldValidateRoadmapPmResponse()` function, (b) a `ROADMAP_PM_CORRECTIVE_INSTRUCTION` constant, (c) a `validateRoadmapPmResponse()` function in a new `roadmapPmResponseValidator.ts`, (d) a `createFallbackRoadmapPmResponse()` function. Is that correct, or should there be any deviation from the SA corrective-retry pattern?
**Answer:** Yes--mirror the SA corrective-retry pattern with validateRoadmapPmResponse(), createFallbackRoadmapPmResponse(), and a corrective instruction constant.

**Q8:** The raw idea explicitly excludes Upload Documents support (no `sources` field handling). I assume we also exclude the `UploadDocumentsModal` component from `RoadmapPmChatPanel` (unlike the PM and SA panels which both include it). Is that correct, or should document upload be supported even if sources are not sent to the gateway?
**Answer:** Yes--exclude UploadDocumentsModal from RoadmapPmChatPanel in this increment.

**Q9:** Is there anything else that should be explicitly excluded from this increment that I have not covered? For example: no "start over" / conversation reset, no confirmation-to-save flow (unlike SA's baseline confirmation), no readiness gate checks beyond the LLM's own judgment?
**Answer:** Yes--explicitly exclude reset/start-over, exclude confirmation-to-save wiring (save comes later), and exclude any code-level readiness gate checks beyond the LLM's judgment/validator basics.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: SolutionArchitectChatPanel -- Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` -- Closest frontend analog for a structured chat panel with section badges and phase-based rendering
- Feature: SolutionArchitectChatPanel CSS -- Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` -- CSS module pattern to replicate for visual consistency
- Feature: ProductManagerChatPanel -- Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` -- Simpler chat panel variant without section badges (useful for understanding the base pattern)
- Feature: ProductManagerChatPanel CSS -- Path: `frontend/src/components/ProductView/ProductManagerChatPanel.module.css` -- Design system colors and spacing values
- Feature: solutionArchitectResponseValidator -- Path: `gateway/src/services/solutionArchitectResponseValidator.ts` -- Validator pattern to replicate for the new `roadmapPmResponseValidator.ts`
- Feature: promptBuilder (SA template) -- Path: `gateway/src/services/promptBuilder.ts` -- The `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`, the SA branch in `buildSystemPrompt()`, and mission/tech-stack context injection pattern
- Feature: chat route (SA corrective-retry) -- Path: `gateway/src/routes/chat.ts` -- The SA corrective-retry block, `shouldAppendToTranscript()`, `flushTranscriptToDisk()`, and mode-routing logic
- Feature: transcriptWriter -- Path: `gateway/src/services/transcriptWriter.ts` -- The `ALLOWED_KINDS` array and `normalizeKind()` function
- Feature: chat types -- Path: `gateway/src/types/chat.ts` -- `ChatContext`, `ChatMode`, `ChatResponse` type definitions
- Feature: services index -- Path: `gateway/src/services/index.ts` -- Export barrel for new validator exports
- Feature: ProductPage (sub-tab pattern) -- Path: `frontend/src/components/ProductView/ProductPage.tsx` -- Sub-tab bar pattern for conditionally mounting chat panels
- Feature: ProductRoadmapPage -- Path: `frontend/src/components/ProductView/ProductRoadmapPage.tsx` -- Current Roadmap screen layout using ResizableSplitPane
- Feature: chatApi -- Path: `frontend/src/api/chatApi.ts` -- Frontend API layer for chat requests

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `planning/visuals/` confirmed no image files found.

### Visual Insights:
N/A -- No visuals to analyze.

## Requirements Summary

### Functional Requirements
- Register a new chat mode `"roadmap_pm"` in the gateway type system (`ChatMode` union, `ChatContext` mode field)
- Create a `ROADMAP_PM_PROMPT_TEMPLATE` system prompt with a "Senior Product Manager -- Roadmap Planning" persona that enforces JSON-only output
- The prompt must define 7 discovery sections progressing in order: `roadmap_existence_check` -> `outcome_alignment` -> `architecture_alignment` -> `sequencing_strategy` -> `initiative_structure` -> `epic_structure` -> `final_review`
- Structured JSON response contract with fields: `phase` ("questions" | "ready"), `section` (7 enumerated values), `questions` (string[]), `summary` (string), `proposedInitiatives` (array of { title: string, description: string, epics: [{ title: string, description: string }] }), `assumptions` (string[]), `openItems` (string[])
- `proposedInitiatives` can be empty/omitted during `phase="questions"` but must be present and non-empty during `phase="ready"`
- `assumptions` and `openItems` can appear in any phase and grow progressively
- When `phase="ready"`, at least one initiative must exist and at least one epic must exist across all initiatives (lenient per-initiative)
- Auto-inject `MISSION.MD` content into the system prompt for context alignment (TECH-STACK.MD omitted in v0.1)
- Add `"roadmap_pm"` mode routing in `buildSystemPrompt()` in `promptBuilder.ts`
- Add `"roadmap_pm"` mode handling in `chat.ts` route with corrective-retry validation pattern (mirroring SA)
- Create `roadmapPmResponseValidator.ts` with `validateRoadmapPmResponse()`, `createFallbackRoadmapPmResponse()`, and a `ROADMAP_PM_CORRECTIVE_INSTRUCTION` constant
- Add `'roadmap_pm'` to `ALLOWED_KINDS` in `transcriptWriter.ts`
- Thread mode/kind through `shouldAppendToTranscript()` and `flushTranscriptToDisk()` for roadmap_pm conversations
- Transcript persistence path: `<projectParentFolder>/conversations/roadmap_pm/<derivedFolderName>/`
- `featureId = projectId`, `featureTitle = "Roadmap PM"`
- Frontend: Create `RoadmapPmChatPanel.tsx` component with chat state management, message rendering, phase-based display, section badge rendering, and `proposedInitiatives` / `assumptions` / `openItems` display
- Frontend: Create `RoadmapPmChatPanel.module.css` following existing design system (colors, border-radius, font-sizes from ProductManagerChatPanel.module.css)
- Frontend: Modify `ProductRoadmapPage.tsx` layout so LHS = `RoadmapPmChatPanel`, RHS = existing roadmap content (tree + details, still resizable within that right area)
- Bootstrap: auto-send `"Help me define the high-level roadmap for ${productName}."` if no transcript exists
- Rehydration: load existing transcript on mount (same pattern as SA/PM panels)
- Chat panel calls `/api/chat` with `mode="roadmap_pm"`
- No `UploadDocumentsModal` in this panel

### Reusability Opportunities
- `SolutionArchitectChatPanel.tsx` is the closest frontend analog -- its section-badge rendering, phase-based message display, bootstrap/rehydration logic, and CSS module can be directly referenced and adapted
- `solutionArchitectResponseValidator.ts` provides the exact validator pattern to replicate -- allowlist-based section validation, phase enum checking, corrective instruction constant, fallback response factory
- The SA corrective-retry block in `chat.ts` provides the exact flow to replicate for the new mode
- `ProductManagerChatPanel.module.css` design tokens (colors, spacing, border-radius) should be reused for visual consistency
- The SA branch in `buildSystemPrompt()` provides the pattern for adding mission content injection to a new mode
- `transcriptWriter.ts` `normalizeKind()` function already handles kind normalization -- just needs the new kind added to the allowlist

### Scope Boundaries
**In Scope:**
- New `roadmap_pm` chat mode in gateway (types, prompt, route handling, validation, transcript)
- New `RoadmapPmChatPanel` frontend component with CSS module
- Modified `ProductRoadmapPage` layout (chat panel in LHS)
- Structured response contract with 7 fields (phase, section, questions, summary, proposedInitiatives, assumptions, openItems)
- Response validation with corrective retry and fallback
- Transcript persistence under `kind="roadmap_pm"`
- MISSION.MD auto-injection into system prompt
- Bootstrap and rehydration flows

**Out of Scope:**
- Any roadmap saving / persistence of proposed initiatives
- Any Jira import or integration
- Any MCP tool calls or tool definitions
- Any work_item writes
- Delivery team persistence
- Modification of the existing roadmap UI grid (it remains unchanged and manually editable)
- Changes to existing PM (Product) or SA modes
- UploadDocumentsModal / document upload support
- Conversation reset / start-over functionality
- Confirmation-to-save wiring (save flow comes in a later increment)
- Code-level readiness gate checks beyond basic validator rules
- TECH-STACK.MD injection (omitted in v0.1)
- Changes to mcp-server, architecture-model-service, or jira-service

### Technical Considerations
- The `ChatMode` type union in `gateway/src/types/chat.ts` must be extended with `'roadmap_pm'`
- The `ChatResponse` type (or a new `RoadmapPmChatResponse` type) must accommodate the richer field set (proposedInitiatives, assumptions, openItems) compared to existing PM/SA response types
- The new mode is tool-less -- JSON-mode enforcement is via prompt-only (no OpenAI function/tool definitions sent)
- The `buildSystemPrompt()` function in `promptBuilder.ts` must add a new branch for `mode === 'roadmap_pm'` before the `implement_feature` check, following the existing SA pattern
- MISSION.MD loading in `chat.ts` can reuse the same file-loading mechanism already used by the SA mode
- The corrective-retry pattern must be wired into the main chat route handler alongside the existing SA and PM retry blocks
- The `RoadmapPmChatPanel` replaces the existing left pane content in `ProductRoadmapPage`'s `ResizableSplitPane` -- the existing tree+details content moves entirely into the right pane
- The frontend `chatApi.ts` should already support the new mode since it passes `mode` as a string field -- no API client changes expected
- New validator exports must be added to `gateway/src/services/index.ts`
- No regression to existing Product PM or SA modes must be ensured
