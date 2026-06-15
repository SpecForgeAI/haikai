# Specification: RM Increment 1 -- Roadmap PM Mode + LHS Chat Panel (Tool-less, No Saving)

## Goal
Introduce a new `roadmap_pm` chat mode in the gateway and a corresponding `RoadmapPmChatPanel` in the frontend, enabling structured roadmap planning conversations with a Senior Product Manager persona on the Roadmap screen. This increment is tool-less and does NOT persist or import any roadmap data -- it only enables the conversation, its structured response contract (with `proposedInitiatives`, `assumptions`, `openItems`), and transcript persistence.

## User Stories
- As a product team member, I want to discuss high-level roadmap planning with a Product Manager persona so that I can iteratively define initiatives and epics before any formal roadmap data is saved.
- As a product team member, I want to see the roadmap PM chat panel alongside the existing roadmap grid so that I can reference imported roadmap data while shaping new initiatives.

## Specific Requirements

**Add `roadmap_pm` to the ChatMode union type**
- In `gateway/src/types/chat.ts`, extend the `ChatMode` union to include `'roadmap_pm'` as a fifth literal value
- Add a new `RoadmapPmResponse` interface with fields: `phase` (`"questions"` | `"ready"`), `section` (one of 7 enumerated values), `questions` (`string[]`), `summary` (`string`), `proposedInitiatives` (array of `{ title: string, description: string, epics: { title: string, description: string }[] }`), `assumptions` (`string[]`), `openItems` (`string[]`)
- Add a `RoadmapPmValidationResult` interface following the same pattern as `SolutionArchitectValidationResult`
- Add a `roadmapPmResponse` optional field to the `ChatResponse` interface, parallel to `solutionArchitectResponse`

**Define the 7 roadmap discovery sections**
- The `section` field must be one of 7 enumerated values in strict discovery order: `roadmap_existence_check`, `outcome_alignment`, `architecture_alignment`, `sequencing_strategy`, `initiative_structure`, `epic_structure`, `final_review`
- These sections represent the logical progression from understanding the current state of the roadmap through to structured initiative/epic definitions

**Create the Roadmap PM system prompt template**
- Add a new `ROADMAP_PM_PROMPT_TEMPLATE` constant in `gateway/src/services/promptBuilder.ts`, following the structural pattern of `SOLUTION_ARCHITECT_PROMPT_TEMPLATE`
- Persona: "Senior Product Manager -- Roadmap Planning" conducting structured roadmap discovery
- The prompt must instruct the LLM to progress through the 7 sections in order, gathering information about existing roadmap state, business outcomes, architecture alignment, sequencing, and then structuring initiatives and epics
- The response format block must describe the full 7-field JSON schema (phase, section, questions, summary, proposedInitiatives, assumptions, openItems)
- `proposedInitiatives` must be allowed empty/omitted during `phase="questions"` and required non-empty during `phase="ready"`
- `assumptions` and `openItems` may appear in any phase and grow progressively
- The prompt must enforce JSON-only output with no markdown, no prose outside JSON, and no tool calls
- Add a CONTEXT ALIGNMENT section instructing the LLM to use injected PRODUCT MISSION content for internal reasoning alignment

**Add `roadmap_pm` mode routing in `buildSystemPrompt`**
- In the `buildSystemPrompt()` function in `promptBuilder.ts`, add a new check for `context?.mode === 'roadmap_pm'` that returns the `ROADMAP_PM_PROMPT_TEMPLATE`
- Place this check adjacent to the existing `solution_architect` check (before the `implement_feature` block)
- When `missionContent` is provided and non-empty, append it as a delimited `=== PRODUCT MISSION ===` section (same pattern as SA mode)
- TECH-STACK.MD injection is omitted in this increment

**Auto-inject MISSION.MD into the system prompt**
- In the `chat.ts` route handler, when `mode === 'roadmap_pm'` and `projectParentFolder` is present, load `MISSION.MD` using the existing `loadProjectFile()` helper (same mechanism as SA mode)
- Pass `missionContent` to `buildSystemPrompt()` for context alignment
- TECH-STACK.MD loading is NOT required for this increment (roadmap is primarily value sequencing, not technical standards)
- Do NOT implement a standards-missing short-circuit for roadmap_pm (unlike SA mode which halts on missing TECH-STACK.MD)

**Create the Roadmap PM response validator**
- Create a new file `gateway/src/services/roadmapPmResponseValidator.ts` following the structure of `solutionArchitectResponseValidator.ts`
- Define `VALID_SECTIONS` as a `ReadonlySet<string>` with the 7 enumerated section values
- Implement `validateRoadmapPmResponse(content: string)` that: extracts JSON via `extractJson()`, parses JSON, validates `phase` is `"questions"` or `"ready"`, validates `section` is one of the 7 values, validates `questions` is `string[]` and non-empty when phase is `"questions"`, validates `summary` is a non-empty string, validates `proposedInitiatives` is an array when present (titles must be non-empty strings, epics must be arrays), validates that when `phase="ready"` proposedInitiatives is present, non-empty, and at least one epic exists across all initiatives
- Implement `createFallbackRoadmapPmResponse()` returning safe defaults: `phase: "questions"`, `section: "roadmap_existence_check"`, `questions: []`, `summary: ""`, `proposedInitiatives: []`, `assumptions: []`, `openItems: []`
- Define a `ROADMAP_PM_CORRECTIVE_INSTRUCTION` constant mirroring `SA_CORRECTIVE_INSTRUCTION`
- Export both functions and the corrective instruction from `gateway/src/services/index.ts`

**Wire validation with corrective retry in the chat route handler**
- In `gateway/src/routes/chat.ts`, add a `shouldValidateRoadmapPmResponse()` function returning true when `context?.mode === 'roadmap_pm'`
- Add a new validation block mirroring the SA corrective-retry pattern: first attempt validates response, if invalid append corrective instruction and resend once, if second attempt also fails use fallback
- When valid, attach `roadmapPmResponse` to `chatResponse` and use `summary` as `assistant.message`
- When falling back, set `chatResponse.error` with the validation error message

**Add `roadmap_pm` to transcript persistence**
- In `gateway/src/services/transcriptWriter.ts`, add `'roadmap_pm'` to the `ALLOWED_KINDS` array
- Transcripts persist under path `<projectParentFolder>/conversations/roadmap_pm/<folderName>/` using `featureId=projectId` and `featureTitle="Roadmap PM"`
- In `chat.ts`, extend `shouldAppendToTranscript()` to include `context?.mode === 'roadmap_pm'`
- In `chat.ts`, extend `flushTranscriptToDisk()` to handle `mode === 'roadmap_pm'` by mapping kind to `'roadmap_pm'`

**Create the RoadmapPmChatPanel frontend component**
- Create `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` adapting the structure of `SolutionArchitectChatPanel.tsx`
- Props: `projectId`, `projectParentFolder`, `productName` (identical signature to SA panel)
- Build chat context with `mode: 'roadmap_pm'` (as a string, the frontend chatApi passes mode as a string field), `featureId: projectId`, `featureTitle: 'Roadmap PM'`
- Bootstrap message: `"Help me define the high-level roadmap for ${productName}."`
- Message ID prefix: `"rm-msg-"` (distinct from SA's `"sa-msg-"` and PM's `"pm-msg-"`)
- Persona label for assistant messages: `"Roadmap PM"`
- Rehydrate conversation on mount via `getImplementConversation` with `kind='roadmap_pm'`
- Store structured responses in a `Map<string, RoadmapPmResponse>` keyed by message ID
- Render section label badge showing human-readable section name (e.g., "Roadmap Existence Check", "Initiative Structure")
- Render questions list as `<ul>` items when `phase="questions"`
- Render `proposedInitiatives` when non-empty: show each initiative title with nested epic titles
- Render `assumptions` list when non-empty, styled distinctly from questions
- Render `openItems` list when non-empty, styled to indicate deferred/unresolved items
- Render a ready banner when `phase="ready"` with text like "Roadmap planning is complete. Save functionality coming in a future increment."
- Do NOT include `UploadDocumentsModal` (explicitly excluded from this increment)
- During rehydration, parse assistant message content as JSON to extract `RoadmapPmResponse` fields (same pattern as SA rehydration, but extracting the additional `proposedInitiatives`, `assumptions`, `openItems` fields)

**Create the RoadmapPmChatPanel CSS module**
- Create `frontend/src/components/ProductView/RoadmapPmChatPanel.module.css` replicating the styling from `SolutionArchitectChatPanel.module.css`
- Reuse design system tokens: colors `#1976D2` primary, `#333` text, `#888` muted; border-radius `6px`; font-sizes `12-13px`
- Add styles for: section label badge (matching SA's `.sectionLabel`), proposed initiatives rendering (nested list with initiative titles and epic sub-items), assumptions list (visually distinct, e.g., amber/neutral), openItems list (muted/grey), ready banner (green pattern matching SA's `.readyBanner`)
- Do NOT include `.uploadButton` styles (no document upload in this increment)

**Add frontend types for RoadmapPmResponse**
- In `frontend/src/api/chatApi.ts`, add a `RoadmapPmResponse` interface with fields: `phase`, `section`, `questions`, `summary`, `proposedInitiatives`, `assumptions`, `openItems`
- Add a `roadmapPmResponse` optional field to the frontend `ChatResponse` interface

**Modify ProductRoadmapPage layout to integrate chat panel**
- In `frontend/src/components/ProductView/ProductRoadmapPage.tsx`, replace the current `ResizableSplitPane` left/right layout so that: LHS = `RoadmapPmChatPanel`, RHS = the entire existing roadmap content (the current tree + details, still resizable within the right area if already using a nested split pane)
- The chat panel becomes the new left pane of the outermost `ResizableSplitPane`; all existing roadmap UI content (work item tree, import summary cards, CTA buttons, details placeholder) moves into the right pane
- Pass `projectId` (from `loadedFileName`), `projectParentFolder` (derived from ArchitectureContext or ProjectContext as available), and `productName` (from active project or `loadedFileName`) as props to `RoadmapPmChatPanel`
- Persist the new split pane width using a distinct localStorage key (e.g., `"pd.roadmap.chatWidth"`)
- The existing roadmap grid behavior (import, tree display, expand/collapse, metadata, CTA) must remain completely unchanged

## Existing Code to Leverage

**SolutionArchitectChatPanel.tsx (`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`)**
- Closest frontend analog for a structured chat panel with section badges and phase-based rendering; the RoadmapPmChatPanel should replicate its state management pattern (messages, sessionId, loading, error, inputDraft, isBootstrapped, structured response map), rehydration logic via `getImplementConversation`, auto-bootstrap flow, `handleSend`/`handleFormSubmit`/`handleKeyDown` handlers, section badge rendering via `sectionDisplayName()`, questions list, and ready banner
- Key differences: swap mode to `roadmap_pm`, kind to `roadmap_pm`, featureTitle to `Roadmap PM`, bootstrap message to roadmap-focused text, add `proposedInitiatives`/`assumptions`/`openItems` rendering, remove Upload Documents support

**solutionArchitectResponseValidator.ts (`gateway/src/services/solutionArchitectResponseValidator.ts`)**
- Exact validator pattern to replicate: import `extractJson` from `plannerResponseValidator`, define `VALID_PHASES` and `VALID_SECTIONS` as `ReadonlySet<string>`, implement `validate` function (extract JSON, parse, validate each field, return typed result), implement `createFallback` function, implement `logValidationFailure` helper
- The roadmap PM validator extends this with additional validation for `proposedInitiatives` (array of objects with title/description/epics), `assumptions` (string array), `openItems` (string array), and the readiness gate check (proposedInitiatives non-empty with at least one epic when phase="ready")

**SA corrective-retry block in chat.ts (`gateway/src/routes/chat.ts`)**
- The SA validation block (around lines 628+) provides the exact corrective-retry flow to replicate: first validation attempt, on failure append corrective instruction to messages, resend once, validate again, on second failure use fallback response
- The `shouldValidateSolutionArchitectResponse()`, `SA_CORRECTIVE_INSTRUCTION` constant, and mode-check pattern should be directly mirrored for the roadmap_pm mode

**ProductRoadmapPage.tsx (`frontend/src/components/ProductView/ProductRoadmapPage.tsx`)**
- Current Roadmap screen layout that uses `ResizableSplitPane` with tree on left and details on right; the chat panel integration wraps this existing content in an outer split pane where the chat is left and the existing layout is right
- The component already receives `onNavigateToBacklog` and `onControlStateChange` props that must continue working unchanged after the layout modification

**promptBuilder.ts SA branch (`gateway/src/services/promptBuilder.ts`)**
- The `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` and the SA branch in `buildSystemPrompt()` provide the pattern for adding a new mode-specific prompt template with context injection; the roadmap PM branch follows the same structure but injects only `missionContent` (not `techStackContent`)

## Out of Scope
- Any roadmap saving or persistence of proposed initiatives to the database or file system
- Any Jira import or integration from this panel
- Any MCP tool calls or tool definitions for the roadmap_pm mode
- Any work_item writes or mutations from this panel
- Delivery team persistence or management
- Modification of the existing roadmap UI grid behavior (import, tree display, expand/collapse remain unchanged)
- Changes to existing PM (Product), SA (Solution Architect), or Implement modes
- UploadDocumentsModal or document upload support in RoadmapPmChatPanel
- Conversation reset or start-over functionality
- Confirmation-to-save wiring (save flow comes in a later increment)
- Code-level readiness gate checks beyond basic validator rules and the LLM's own judgment
- TECH-STACK.MD injection into the roadmap PM system prompt (omitted in v0.1)
- Changes to mcp-server, architecture-model-service, or jira-service
