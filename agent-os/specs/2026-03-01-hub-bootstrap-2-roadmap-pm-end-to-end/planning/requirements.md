# Spec Requirements: Hub Bootstrap 2 -- Roadmap (PM) End-to-End

## Initial Description

No `initialization.md` file was found in the planning folder. The spec idea was communicated directly by the user: wire the second bootstrap conversation flow (Increment 5 of the 11-increment plan) through the Increments 1-4 infrastructure -- a PM "Build Roadmap" discovery conversation that reaches readiness, generates a roadmap artifact, presents a preview with Confirm/Reject buttons, saves via the existing `save_roadmap_structure` MCP tool on confirm, seals the segment with a completion chip, and reflects the saved state on the Dashboard. This follows the canonical pattern established by Increment 4 (Hub Bootstrap 1 -- Product Definition).

## Requirements Discussion

### First Round Questions

Based on the extensive codebase analysis, the following questions cover all the critical design decisions for this increment. The analysis reveals that the `product-manager--roadmap.json` task definition already exists with `contextNeeds: ["mission", "existing-roadmap"]`, the `save_roadmap_structure` MCP tool is already defined in `tools.ts`, the `ROADMAP_PM_PROMPT_TEMPLATE` is already in `promptBuilder.ts` with the task prompt extracted to `product-manager.roadmap.task.md`, and the Increment 4 (Hub Bootstrap 1) patterns for `/generate`, `/save-artifact`, `ArtifactPreviewBubble`, `CompletionChip`, and `useChatThread` extensions are all implemented and proven.

**Q1:** The `product-manager--roadmap.json` task definition already exists with `"contextNeeds": ["mission", "existing-roadmap"]` and `"artifacts": []`. For Increment 4, the context resolvers in `contextResolvers.ts` were left as stubs (returning empty strings) and context assembly was handled inline in the `/generate` endpoint using `MISSION_GENERATION_PROMPT_TEMPLATE`. For this increment, the roadmap task needs MISSION.MD content and existing roadmap data injected into the DISCOVERY conversation (not just the generation step) -- this means the context resolvers must actually be implemented. I assume we need to:
- Implement a real `mission` context resolver that reads `agent-os/product/MISSION.MD` from disk (mirroring the v1 pattern at `chat.ts` lines 1158-1167 using `loadProjectFile`)
- Implement a real `existing-roadmap` context resolver that calls `fetchProductSummary()` then `buildRoadmapSummary()` from `roadmapSummaryBuilder.ts` (mirroring the v1 pattern at `chat.ts` lines 1368-1381)
- These resolvers would then be invoked automatically by the POST `/` handler in `chatV2.ts` (lines 822-836) via the `task.contextNeeds` lookup, and the resolved content would be injected into the system prompt via `composeSystemPrompt()` as `=== MISSION ===` and `=== EXISTING ROADMAP ===` sections

Is this the correct approach, or should context assembly remain inline in a roadmap-specific code path?

**Answer:** Keep context assembly inline for Increment 5 (read mission/roadmap via existing gateway/service calls as needed) and defer "real" resolver infrastructure until side panels/Inc 8-9.

**Q2:** The v1 roadmap flow has two special behaviors that depend on context beyond plain section injection:
- **JIRA Awareness Block**: `JIRA_AWARENESS_INSTRUCTION_BLOCK` is always appended to the roadmap prompt (lines 1734 in promptBuilder.ts). This is a static instruction string, not dynamic context.
- **Roadmap Exists Guidance**: `ROADMAP_EXISTS_INSTRUCTION_BLOCK` is conditionally appended only when `existingRoadmapSummary` is non-empty (lines 1737-1739 in promptBuilder.ts). This tells the LLM to skip `roadmap_existence_check` and start at `outcome_alignment`.

I assume these should be handled by enriching the task prompt `.md` file (`product-manager.roadmap.task.md`) to include the JIRA awareness block directly (since it is always present), and having the `existing-roadmap` context resolver also append the `ROADMAP_EXISTS_INSTRUCTION_BLOCK` when roadmap data is found. Alternatively, we could add these as additional static context blocks in the prompt composition pipeline. Which approach do you prefer?

**Answer:** Inject both as task-level prompt suffix blocks via the prompt composition pipeline: always append JIRA_AWARENESS, append ROADMAP_EXISTS only when the backend detects roadmap exists.

**Q3:** The v1 roadmap flow has a deterministic first-turn short-circuit (`isFirstTurnRoadmapPm` at `chat.ts` lines 1181-1288) that bypasses the LLM entirely:
- If roadmap exists: returns a pre-built response with `section: "outcome_alignment"` and 3 canned questions
- If no roadmap: returns a pre-built response with `section: "roadmap_existence_check"` and 2 canned questions

In the v2 flow, the context resolver pipeline injects mission and existing roadmap data into the system prompt, and the LLM generates the first response. I assume we should NOT replicate the deterministic first-turn short-circuit in v2, because:
- The context resolver + prompt composition pipeline handles context injection generically
- The LLM with proper context will naturally start at the right section
- The `ROADMAP_EXISTS_INSTRUCTION_BLOCK` tells the LLM to skip `roadmap_existence_check` when a roadmap exists

Is that correct, or do you want to preserve the deterministic first-turn behavior for consistency/speed?

**Answer:** Replicate the v1 deterministic first-turn canned questions for roadmap bootstrap (skip LLM on turn 1), then use LLM + context for subsequent turns.

**Q4:** The roadmap save flow in v1 (`chat.ts` lines 1423-1569) does NOT use a generation prompt template -- it directly extracts `proposedInitiatives` from the last assistant message's JSON and calls `save_roadmap_structure` with `roadmapJson: JSON.stringify({ initiatives: proposedInitiatives })`. This is fundamentally different from the mission flow which uses `MISSION_GENERATION_PROMPT_TEMPLATE` to synthesize a markdown document.

For the v2 roadmap flow, I assume:
- The `/generate` endpoint should be extended (or the existing logic parameterized) to handle roadmap generation differently: instead of calling the LLM with a generation prompt, it should extract `proposedInitiatives` directly from the thread's last assistant message (the one with `phase: "ready"`) and return them as the artifact content
- OR: we keep the `/generate` endpoint as LLM-based and create a `ROADMAP_GENERATION_PROMPT_TEMPLATE` that synthesizes a clean roadmap JSON from the conversation

Which approach should we use? Extracting directly (matching v1 pattern) seems simpler and more reliable since the proposedInitiatives are already structured.

**Answer:** Follow the v1 pattern: extract proposedInitiatives from the last assistant message (no separate generation prompt yet).

**Q5:** The `/save-artifact` endpoint currently hardcodes `save_product_artifacts` as the tool name and `missionMarkdown` as the content parameter. For roadmap, the tool is `save_roadmap_structure` with parameters `{ projectId, roadmapJson }`. I assume we need to:
- Parameterize the `/save-artifact` endpoint to accept a `toolName` field (or derive it from the task definition's `artifacts[].tool` field)
- Handle different tool argument shapes based on the tool name (mission uses `{ projectParentFolder, projectId, productName, missionMarkdown, overwrite }` while roadmap uses `{ projectId, roadmapJson }`)
- Update the task definition `product-manager--roadmap.json` to add an `artifacts` entry like `{ "artifactId": "roadmap", "filename": "roadmap", "tool": "save_roadmap_structure", "description": "Roadmap structure with initiatives and epics" }`

Is it correct to extend the single `/save-artifact` endpoint to handle multiple tool types, or should we create a separate `/save-roadmap-artifact` endpoint?

**Answer:** Extend the existing /api/chat/v2/save-artifact endpoint with conditional branching by artifactType to call the correct MCP tool (no new endpoint).

**Q6:** The `ArtifactPreviewBubble` component currently has a hardcoded header label "Generated MISSION.MD". For roadmap, this should show something like "Generated Roadmap". Additionally, the roadmap preview content is structured JSON (initiatives and epics), not markdown -- it needs a different rendering approach (possibly a tree/list view of initiatives with nested epics). I assume:
- The `ArtifactPreviewBubble` header label should be parameterized (passed as a prop)
- The content rendering should be configurable: markdown for mission, structured list for roadmap
- OR: we create a separate `RoadmapPreviewBubble` component that renders the initiative/epic tree

Which approach do you prefer?

**Answer:** Add a second preview variant for structured roadmap JSON: render a readable summary (Initiatives to Epics counts/titles) with an optional "Show JSON" toggle.

**Q7:** The `CompletionChip` component and `useChatThread` hook have some mission-specific hardcoded values:
- `confirmArtifact()` hardcodes `artifactId: 'mission-md'` and content text `'Product Definition complete.'`
- `generateArtifact()` checks for `result.missionMarkdown` specifically
- Phase detection checks `latestSr.phase === 'ready'` which works for both roadmap and mission (the roadmap prompt also uses `phase: "ready"`)

I assume these need to be generalized:
- The `artifactId` should come from the task definition's artifacts array (looked up by current taskId)
- The completion message should be parameterized (e.g., "Roadmap complete." for roadmap)
- The generate response should use a generic field name (e.g., `content` or `artifactContent`) instead of `missionMarkdown`

Is this the right generalization scope for this increment, or should we keep it minimal and just add roadmap-specific branches alongside the existing mission-specific code?

**Answer:** Generalize generate/confirm functions to be artifact-type parameterized (task-agnostic) so mission/roadmap share the same pipeline.

**Q8:** The dashboard currently displays roadmap metrics as mock data (`dashboardSummaryMockService.ts` lines 87-92): `state`, `initiativesCount`, `epicsCount`, `epicsCompletedCount`. In Increment 4, only the Product Definition card was updated with real data (MISSION.MD existence check). I assume for this increment we should:
- Add a real roadmap existence check in `dashboardSummary.ts` similar to the MISSION.MD check
- Call `fetchProductSummary()` and `countRoadmapItems()` from `roadmapSummaryBuilder.ts` to get real initiative/epic counts
- Override the mock `roadmap.state`, `roadmap.initiativesCount`, and `roadmap.epicsCount` values with real data

Is that correct, or should dashboard real data integration be deferred?

**Answer:** Yes, add real roadmap existence + initiative/epic counts to dashboard summary (same spirit as missionExists hardening).

**Q9:** The `useChatThread` hook needs a `roadmapExists` equivalent of the existing `missionExists` prop for the overwrite warning. When the user selects "Build Roadmap" and a roadmap already exists, the frontend should show a warning like "A Roadmap already exists. Completing this conversation will update it." I assume:
- We generalize the `missionExists` prop to be artifact-aware (e.g., `existingArtifacts: Record<string, boolean>` or a simpler `roadmapExists: boolean` alongside `missionExists`)
- The `selectTask` function checks for the relevant artifact based on taskId

Should we generalize the approach or add another specific boolean?

**Answer:** Generalize missionExists to a per-artifact existence map (e.g., artifactExists.{mission,roadmap,...}) rather than adding ad-hoc booleans.

**Q10:** The v1 roadmap flow in `chat.ts` has a `ROADMAP_PM_CORRECTIVE_INSTRUCTION` import (line 127) used for validation/correction of malformed LLM responses. In v2, the `chatV2.ts` POST `/` handler has generic `validateStructuredResponse()` logic. I assume the existing v2 validation is sufficient for the roadmap task since the `responseFormat` in `product-manager--roadmap.json` already defines the full 7-field JSON schema with required fields and type validation. Is that correct, or does the roadmap flow need additional corrective/retry logic beyond what `validateStructuredResponse()` provides?

**Answer:** Extend validateStructuredResponse() to support the roadmap's richer schema (including nested initiatives/epics arrays and required fields).

**Q11:** The roadmap task prompt file (`product-manager.roadmap.task.md`) currently contains the full prompt content extracted from `ROADMAP_PM_PROMPT_TEMPLATE`, but does NOT include the `JIRA_AWARENESS_INSTRUCTION_BLOCK` or `ROADMAP_EXISTS_INSTRUCTION_BLOCK` (those are appended conditionally in `buildSystemPrompt()`). For v2, context injection happens through the prompt composition pipeline. Should the JIRA awareness block be:
(a) Added directly to `product-manager.roadmap.task.md` (since it is always present), OR
(b) Registered as a separate static context resolver (e.g., `jira-awareness`), OR
(c) Added as a special suffix block in the prompt composition pipeline for this task?

**Answer:** Put JIRA_AWARENESS in the task prompt .md (as canonical "always-on" instruction) and keep ROADMAP_EXISTS as a conditional suffix appended by the pipeline.

**Q12:** The `save_roadmap_structure` tool requires `{ projectId, roadmapJson }` where `roadmapJson` is `JSON.stringify({ initiatives: [...] })`. Unlike `save_product_artifacts` which requires `projectParentFolder` and `productName`, the roadmap tool only needs `projectId`. I assume the `/save-artifact` endpoint's tool argument assembly should be driven by the tool definition -- but the current implementation builds args manually for `save_product_artifacts`. How should we handle the divergent argument shapes? Should we:
(a) Use a switch/map based on tool name to build the correct args object, OR
(b) Accept tool-specific args from the frontend request body (with server-side validation), OR
(c) Define a tool argument template in the task definition JSON?

**Answer:** In /save-artifact, map generic content to tool args via an artifactType-specific adapter (mission to markdown artifact payload; roadmap to initiative/epic DTO payload) rather than one generic mapping.

**Q13:** For the transcript download feature, the Increment 4 `buildTranscriptMarkdown()` in `transcriptExport.ts` is hardcoded to append the artifact marker `> Saved artifact: agent-os/product/MISSION.MD`. For roadmap, the artifact location is different (the roadmap is persisted via `save_roadmap_structure` which stores it in the backend database, not as a file). I assume:
- The transcript utility should be parameterized to accept an artifact path/description string
- For roadmap, the marker might be `> Saved artifact: Roadmap Structure (Initiatives & Epics)` since it is not a file path

Is that correct?

**Answer:** Transcript download should include an artifact marker like "Saved artifact: ROADMAP (initiative/epic structure)" plus the saved revision/id returned by the tool/service (not a file path).

**Q14:** Are there any edge cases around re-running the roadmap conversation that differ from the mission re-run flow? The v1 roadmap tool supports upsert semantics (`externalRef-first, title-fallback upsert matching` per the tool description), so re-running should update existing items rather than creating duplicates. Should the overwrite warning mention "update" rather than "replace"?

**Answer:** Use "update"/"overwrite existing roadmap" wording (treat as upsert) rather than "replace".

**Q15:** What is explicitly out of scope for this increment? I assume the following based on the Increment 4 pattern:
- Streaming responses
- Conversation summarization (Increment 11)
- Side panel roadmap usage (Increment 9)
- Removal of the v1 `RoadmapPmChatPanel` (Increment 10)
- Jira import functionality (the JIRA awareness block just acknowledges it is coming later)
- Implement screen changes
- Heavy roadmap visualization in the preview (a simple list view is sufficient)

Are there other items to exclude?

**Answer:** Confirmed out of scope as listed (all items), plus out of scope: roadmap diffing/merge and Jira import execution beyond awareness text.

### Existing Code to Reference

**Similar Features Identified (from codebase analysis):**

- Feature: Hub Bootstrap 1 -- Product Definition (PM) End-to-End - Spec: `C:\Workspaces\SSD\architecture-store-and-diagrams\agent-os\specs\2026-02-28-hub-bootstrap-1-pm-end-to-end\spec.md`
  - This is the canonical pattern being replicated. Every component and endpoint from Increment 4 is directly reusable or extensible.
- Feature: POST /generate endpoint - Path: `gateway/src/routes/chatV2.ts` (lines 395-536)
  - Currently hardcoded to call LLM with `MISSION_GENERATION_PROMPT_TEMPLATE` and extract `missionMarkdown` from tool call. Must be extended with an `artifactType` branch: mission path stays as-is (LLM generation), roadmap path extracts `proposedInitiatives` from thread history without LLM call.
- Feature: POST /save-artifact endpoint - Path: `gateway/src/routes/chatV2.ts` (lines 557-719)
  - Currently hardcodes `save_product_artifacts` tool name and mission-specific args `{ projectParentFolder, projectId, productName, missionMarkdown, overwrite }`. Must be extended with an `artifactType`-specific adapter pattern to also call `save_roadmap_structure` with `{ projectId, roadmapJson }`.
- Feature: useChatThread hook - Path: `frontend/src/hooks/useChatThread.ts`
  - `generateArtifact` (line 238): hardcodes `result.missionMarkdown` check and `markdownContent` in structuredResponse
  - `confirmArtifact` (line 297): hardcodes `artifactId: 'mission-md'`, content `'Product Definition complete.'`, artifactName `'MISSION.MD'`
  - `selectTask` (line 534): hardcodes `taskId === 'product-manager--define-product'` for missionExists warning
  - Options interface (line 51): has `missionExists?: boolean`
  - All of the above must be generalized to be artifact-type parameterized.
- Feature: ArtifactPreviewBubble - Path: `frontend/src/components/UnifiedChat/ArtifactPreviewBubble.tsx`
  - Hardcoded header "Generated MISSION.MD" (line 130) and renders markdown via `renderMarkdownLines`. Roadmap needs a second variant that renders structured initiative/epic data with a "Show JSON" toggle.
- Feature: CompletionChip - Path: `frontend/src/components/UnifiedChat/CompletionChip.tsx`
  - Fully parameterized already via props (`taskLabel`, `personaColor`, `artifactName`, `onDownloadTranscript`). Reusable as-is.
- Feature: Context Resolvers (stubs) - Path: `gateway/src/services/contextResolvers.ts`
  - All stubs returning empty strings. Remain as stubs per user decision. Context assembly handled inline in the POST `/` handler.
- Feature: Prompt Composition Pipeline - Path: `gateway/src/services/promptComposer.ts`
  - `composeSystemPrompt()` accepts `resolvedContext: Record<string, string>` and injects as `=== SECTION_NAME ===` blocks (line 91). The inline context assembly in the POST `/` handler will populate this map before calling `composeSystemPrompt`.
- Feature: V1 Roadmap Deterministic First-Turn - Path: `gateway/src/routes/chat.ts` (lines 1180-1289)
  - Two branches: roadmap-exists returns `section: "outcome_alignment"` with 3 canned questions and `summary: "I found an existing roadmap with N initiatives and M epics..."`. No-roadmap returns `section: "roadmap_existence_check"` with 2 canned questions. Both use `phase: "questions"` and empty `proposedInitiatives/assumptions/openItems`. Must replicate this exact pattern in v2.
- Feature: V1 proposedInitiatives Extraction - Path: `gateway/src/routes/chat.ts` (lines 1429-1448)
  - Scans `messages` array in reverse, finds last assistant message, parses JSON, extracts `proposedInitiatives`. Then wraps as `{ initiatives: proposedInitiatives || [] }` and `JSON.stringify()` for `roadmapJson`. Must replicate this in the `/generate` endpoint's roadmap branch.
- Feature: V1 Roadmap Confirmation Detection - Path: `gateway/src/routes/chat.ts` (lines 501-529)
  - `isRoadmapConfirmation()` checks: (1) last assistant message has `phase === "ready"`, (2) user message matches `ROADMAP_CONFIRMATION_REGEX`. In v2, confirmation detection is on the frontend (useChatThread phase detection at line 383), so this function is NOT needed in v2 backend.
- Feature: V1 ROADMAP_CONFIRMATION_REGEX - Path: `gateway/src/routes/chat.ts` (line 189)
  - `/^\s*(yes|y|ok|okay|proceed|go ahead|confirm|save)\s*[.!]?\s*$/i` -- NOT replicated in v2; the frontend phase detection in useChatThread triggers `generateArtifact` on any user message after `phase: "ready"`.
- Feature: fetchProductSummary - Path: `gateway/src/services/architectureModelClient.ts` (line 314)
  - Calls `GET /api/model/projects/{projectId}/work-items` on architecture-model-service. Returns `ProductSummaryDto | null`. Used for: (a) inline context assembly to detect existing roadmap, (b) dashboard summary real data, (c) deterministic first-turn roadmap-exists detection.
- Feature: Roadmap Summary Builder - Path: `gateway/src/services/roadmapSummaryBuilder.ts`
  - `buildRoadmapSummary()` (line 32): Produces L1/L2-only text summary of initiatives/epics for prompt context injection.
  - `hasExistingRoadmap()` (line 92): Boolean check for roadmap existence (initiatives > 0 or orphan epics). Used for first-turn detection and ROADMAP_EXISTS conditional block.
  - `countRoadmapItems()` (line 134): Returns `{ initiativeCount, epicCount }` for dashboard metrics and first-turn summary text.
- Feature: Dashboard Summary Endpoint - Path: `gateway/src/routes/dashboardSummary.ts`
  - Lines 78-94: Real MISSION.MD existence check pattern (`fs.access` + override mock values). Roadmap check follows the same pattern but calls `fetchProductSummary` + `hasExistingRoadmap` + `countRoadmapItems` instead of file access.
- Feature: Dashboard Mock Service - Path: `gateway/src/services/dashboardSummaryMockService.ts`
  - `RoadmapMetrics` type at lines 87-92: `{ state, initiativesCount, epicsCount, epicsCompletedCount }`. These mock values will be overridden with real data.
- Feature: DashboardView prop passing - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (lines 507-513)
  - Currently passes `missionExists={data?.strategicFoundation?.productDefinition?.missionExists?.value === 1}` to UnifiedChatPanel. Must be generalized to `artifactExists` map.
- Feature: UnifiedChatPanel prop receiving - Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
  - Line 85: `missionExists?: boolean` prop. Line 116: passes to useChatThread options. Must be generalized.
- Feature: Task Definition (roadmap) - Path: `gateway/src/config/tasks/product-manager--roadmap.json`
  - Already exists with full responseFormat schema (7 required fields including nested `proposedInitiatives` array of objects with `title`, `description`, `epics` sub-array), contextNeeds `["mission", "existing-roadmap"]`, and empty `artifacts: []`. Needs `artifacts` entry added.
- Feature: Task Definition (define-product, for pattern reference) - Path: `gateway/src/config/tasks/product-manager--define-product.json`
  - Has `artifacts: [{ "artifactId": "mission-md", "filename": "MISSION.MD", "tool": "save_product_artifacts", "description": "Product mission statement" }]`. Roadmap task needs a similar entry.
- Feature: Roadmap Task Prompt - Path: `gateway/src/config/prompts/product-manager.roadmap.task.md`
  - Already contains the full prompt content. Does NOT include JIRA_AWARENESS or ROADMAP_EXISTS blocks. Per user answer, JIRA_AWARENESS must be appended to this file. ROADMAP_EXISTS stays conditional, appended by the pipeline.
- Feature: ROADMAP_EXISTS_INSTRUCTION_BLOCK - Path: `gateway/src/services/promptBuilder.ts` (lines 201-203)
  - Content: "A roadmap already exists in the tool. The roadmap_existence_check section is pre-answered. Skip directly to outcome_alignment..." Must be imported or duplicated for use in the v2 inline context assembly path.
- Feature: JIRA_AWARENESS_INSTRUCTION_BLOCK - Path: `gateway/src/services/promptBuilder.ts` (lines 211-213)
  - Content: "If the user mentions having a Jira roadmap... respond with: 'Jira import is coming in a future increment...'" Must be appended to `product-manager.roadmap.task.md`.
- Feature: save_roadmap_structure Tool Definition - Path: `gateway/src/types/tools.ts` (lines 338-359)
  - MCP tool: `{ projectId: string, roadmapJson: string }` where roadmapJson is `JSON.stringify({ initiatives: [...] })`. Also has optional `sessionId` (auto-injected).
- Feature: save_product_artifacts Tool Definition - Path: `gateway/src/types/tools.ts` (lines 284-312)
  - MCP tool: `{ projectParentFolder, projectId, productName, missionMarkdown, overwrite? }`. Different arg shape from roadmap tool.
- Feature: executeToolCall - Path: `gateway/src/services/toolExecutor.ts` (line 205)
  - Generic tool executor: validates tool name, validates args against `REQUIRED_ARGS_MAP` (line 43: `save_roadmap_structure: ['projectId', 'roadmapJson']`), calls MCP endpoint. Already supports `save_roadmap_structure` -- no changes needed to toolExecutor.
- Feature: Transcript Export Utility - Path: `frontend/src/utils/transcriptExport.ts`
  - `buildTranscriptMarkdown()` (line 30): Hardcodes `> Saved artifact: agent-os/product/MISSION.MD`. Must be parameterized to accept artifact description string.
  - `downloadMarkdownFile()` (line 72): Generic, reusable as-is.
- Feature: validateStructuredResponse - Path: `gateway/src/routes/chatV2.ts` (lines 68-160)
  - Only validates top-level field presence, required fields, and type matching. Does NOT recurse into nested object/array schemas. For roadmap's `proposedInitiatives` (array of objects with nested `epics` array), it only checks that `proposedInitiatives` is an array -- not that items have `title`/`description`/`epics`. Must be extended with at least one level of nested validation.

### Follow-up Questions

No follow-up questions needed. All 15 answers are internally consistent and form a complete, coherent set of requirements. The one potential tension between Answer 1 (inline context) and Answer 2/11 (prompt composition pipeline injection) resolves naturally: the inline code in the POST `/` handler populates the `resolvedContext` map manually (by calling `loadProjectFile` for mission and `fetchProductSummary`/`buildRoadmapSummary`/`hasExistingRoadmap` for roadmap data), then passes this map to `composeSystemPrompt()` where it is injected as `=== SECTION_NAME ===` blocks via the normal Layer 3 mechanism. The JIRA_AWARENESS block is baked into the task prompt .md file (Layer 2), and the ROADMAP_EXISTS block is conditionally added to the `resolvedContext` map by the inline code. This approach defers real resolver classes to Increment 8-9 while still using the prompt composition pipeline's context injection mechanism.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visuals found.

## Requirements Summary

### Functional Requirements

**Core Discovery Conversation:**
- Wire the PM "Build Roadmap" task through the v2 Hub Chat infrastructure established in Increments 1-4
- Full roadmap discovery conversation using existing task prompt at `gateway/src/config/prompts/product-manager.roadmap.task.md` with JIRA_AWARENESS_INSTRUCTION_BLOCK appended to the .md file
- 7-section progressive discovery: roadmap_existence_check, outcome_alignment, architecture_alignment, sequencing_strategy, initiative_structure, epic_structure, final_review
- Structured JSON responses matching the 7-field schema: `{ phase, section, questions, summary, proposedInitiatives, assumptions, openItems }`

**Context Injection (Inline Assembly):**
- On each turn of the roadmap conversation, the POST `/` handler assembles context inline (no real resolver classes):
  - Read MISSION.MD from disk via `loadProjectFile()` pattern from v1
  - Call `fetchProductSummary()` and `buildRoadmapSummary()` to get existing roadmap data
  - Check `hasExistingRoadmap()` to conditionally include ROADMAP_EXISTS_INSTRUCTION_BLOCK
- Assembled context is passed to `composeSystemPrompt()` via the `resolvedContext` parameter for Layer 3 injection as `=== MISSION ===` and `=== EXISTING ROADMAP ===` sections

**Deterministic First-Turn Short-Circuit:**
- Replicate the v1 pattern: on the first turn of a roadmap task conversation, bypass the LLM entirely and return a canned response:
  - If roadmap exists: `section: "outcome_alignment"`, 3 canned questions about reviewing/refining the existing roadmap, summary with initiative/epic counts
  - If no roadmap: `section: "roadmap_existence_check"`, 2 canned questions about existing external roadmaps vs. creating new
- Both branches return `phase: "questions"` with empty `proposedInitiatives`, `assumptions`, `openItems`
- The response is persisted to the thread just like a normal LLM response

**Artifact Generation (Extract, Not Generate):**
- Extend the POST `/generate` endpoint with an `artifactType` branch
- For roadmap: do NOT call the LLM; instead scan `thread.messages` in reverse to find the last assistant message with `phase: "ready"`, parse its JSON, extract `proposedInitiatives` array
- Return `{ success: true, artifactContent: JSON.stringify({ initiatives: proposedInitiatives }) }` using a generic field name (replacing the mission-specific `missionMarkdown`)
- For mission: preserve existing LLM-based generation (backward compatible)

**Artifact Preview (Roadmap-Specific Rendering):**
- Add a second preview variant for structured roadmap JSON:
  - Render a readable summary: list of Initiatives with nested Epics (titles + descriptions)
  - Show initiative/epic counts in the header
  - Optional "Show JSON" toggle to view the raw JSON
  - Confirm/Reject buttons below (same as mission preview)
- Parameterize the `ArtifactPreviewBubble` header label (e.g., "Generated Roadmap" vs. "Generated MISSION.MD")

**Artifact Save (Adapter Pattern):**
- Extend POST `/save-artifact` endpoint with conditional branching by `artifactType`:
  - Mission adapter: maps `content` to `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }` and calls `save_product_artifacts`
  - Roadmap adapter: maps `content` to `{ projectId, roadmapJson: content }` and calls `save_roadmap_structure`
- `artifactType` derived from request body (sent by frontend based on current task) or from task definition lookup
- Completion chip persisted with roadmap-specific labels: `artifactName: 'ROADMAP'`, `content: 'Roadmap complete.'`

**Generalized useChatThread Hook:**
- Replace `missionExists?: boolean` option with `artifactExists?: Record<string, boolean>` (e.g., `{ mission: true, roadmap: false }`)
- `generateArtifact()`: use generic response field (`artifactContent` or `content`) instead of `missionMarkdown`; artifact preview structuredResponse type varies by artifact (markdown for mission, structured data for roadmap)
- `confirmArtifact()`: derive `artifactId`, `artifactName`, and completion message from a task-to-artifact mapping instead of hardcoding `'mission-md'`
- `selectTask()`: check `artifactExists[artifactKey]` based on taskId mapping instead of hardcoding `'product-manager--define-product'`
- Overwrite warning text uses "update" language for roadmap: "A Roadmap already exists. Completing this conversation will update it."
- Phase detection (`phase === 'ready'`) already works for both tasks -- no change needed

**Dashboard Integration:**
- Extend `dashboardSummary.ts` with real roadmap data:
  - Call `fetchProductSummary(projectId)` from architectureModelClient
  - Call `hasExistingRoadmap()` and `countRoadmapItems()` from roadmapSummaryBuilder
  - Override mock values: `dto.strategicFoundation.roadmap.state` (100 if exists, 0 if not), `dto.strategicFoundation.roadmap.initiativesCount.value`, `dto.strategicFoundation.roadmap.epicsCount.value`
- Frontend `DashboardView` passes `artifactExists` map (including roadmap existence) to `UnifiedChatPanel`
- `onArtifactSaved` callback triggers dashboard re-fetch after roadmap save

**Completion Chip and Transcript:**
- CompletionChip component is reused as-is with roadmap-specific props: `taskLabel: "Roadmap Complete"`, `artifactName: "ROADMAP"`, persona color for Product Manager (#00897B)
- `buildTranscriptMarkdown()` parameterized to accept artifact description string
- Roadmap transcript appendix: `> Saved artifact: ROADMAP (initiative/epic structure)` followed by the saved JSON content

**Validation Extension:**
- Extend `validateStructuredResponse()` to support at least one level of nested validation for the roadmap schema:
  - Verify `proposedInitiatives` array items have required `title` (string) field
  - Verify `epics` sub-array items (when present) have required `title` (string) field
  - This prevents the LLM from returning `proposedInitiatives: [42, "not-an-object"]` which would currently pass validation

**Task Definition Update:**
- Add `artifacts` entry to `product-manager--roadmap.json`: `{ "artifactId": "roadmap", "filename": "ROADMAP", "tool": "save_roadmap_structure", "description": "Roadmap structure with initiatives and epics" }`

**Task Prompt Update:**
- Append `JIRA_AWARENESS_INSTRUCTION_BLOCK` content to `product-manager.roadmap.task.md` as a permanent section

### Reusability Opportunities
- POST `/generate` endpoint -- extend with `artifactType` branching (mission: LLM generation, roadmap: thread extraction)
- POST `/save-artifact` endpoint -- extend with adapter pattern for divergent tool args
- `ArtifactPreviewBubble` -- parameterize header label; add roadmap preview variant alongside existing markdown preview
- `CompletionChip` -- reuse as-is with different label props
- `useChatThread` hook -- generalize from `missionExists` to `artifactExists` map; generalize `generateArtifact`/`confirmArtifact` from mission-specific to task-agnostic
- `chatV2Api.ts` -- existing `postGenerateArtifact` and `postSaveArtifact` reusable with response field renaming
- `buildTranscriptMarkdown` -- parameterize artifact description string
- `validateStructuredResponse` -- extend with nested validation (benefits all future tasks with complex schemas)
- Dashboard summary endpoint -- extend existing real-data override pattern for roadmap card
- `fetchProductSummary`, `hasExistingRoadmap`, `buildRoadmapSummary`, `countRoadmapItems` -- all already exist and are reusable directly

### Scope Boundaries

**In Scope:**
- Task definition update: add `artifacts` entry to `product-manager--roadmap.json`
- Task prompt update: append JIRA_AWARENESS_INSTRUCTION_BLOCK to `product-manager.roadmap.task.md`
- Inline context assembly in POST `/` handler: read MISSION.MD, fetch roadmap summary, conditionally inject ROADMAP_EXISTS block
- Deterministic first-turn short-circuit: replicate v1 canned responses for roadmap-exists and no-roadmap branches
- POST `/generate` endpoint extension: `artifactType` branching for roadmap (thread extraction, no LLM call)
- POST `/save-artifact` endpoint extension: adapter pattern for `save_roadmap_structure` tool with different arg shape
- Roadmap preview variant: readable initiative/epic list with "Show JSON" toggle
- `ArtifactPreviewBubble` header label parameterization
- `useChatThread` generalization: `artifactExists` map, generic `generateArtifact`/`confirmArtifact`, task-to-artifact mapping
- `UnifiedChatPanel` and `DashboardView` prop generalization from `missionExists` to `artifactExists`
- `validateStructuredResponse` nested validation extension for roadmap schema
- Dashboard summary endpoint: real roadmap existence check and initiative/epic counts via `fetchProductSummary` + `countRoadmapItems`
- Transcript export parameterization: artifact description string instead of hardcoded MISSION.MD path
- CompletionChip reuse with roadmap-specific labels
- Error handling and retry patterns matching Increment 4 spirit
- Overwrite/update warning with upsert-aware "update" language

**Out of Scope:**
- Streaming responses (v2 returns full responses, not SSE)
- Conversation summarization (Increment 11)
- Side panel PM usage on Roadmap screen (Increment 9)
- Removal of the v1 `RoadmapPmChatPanel.tsx` (Increment 10)
- Jira import functionality (only the awareness instruction text)
- Implement screen changes
- Rich roadmap visualization (Gantt charts, timeline views)
- Multi-artifact batch generation
- Version diff/merge for comparing old and new roadmaps
- Roadmap diffing/merge
- Fine-grained permissions or access control
- Real context resolver classes (deferred to Increment 8-9)
- Heavy markdown rendering library upgrades

### Technical Considerations

**Context Assembly Strategy:**
- Context resolvers remain as stubs returning empty strings. All context assembly for the roadmap task is done inline in the POST `/` handler by directly calling `loadProjectFile` (for MISSION.MD) and `fetchProductSummary`/`buildRoadmapSummary`/`hasExistingRoadmap` (for roadmap data).
- The inline code populates the `resolvedContext: Record<string, string>` map, which is then passed to `composeSystemPrompt()`. This means the prompt composition pipeline's Layer 3 (context sections) is still used -- the context is just assembled manually rather than via resolver classes.
- JIRA_AWARENESS is baked into the task prompt .md file (Layer 2), so it flows through automatically.
- ROADMAP_EXISTS is conditionally added to `resolvedContext` by the inline code when `hasExistingRoadmap()` returns true.

**Deterministic First-Turn Implementation:**
- The first-turn detection must happen BEFORE the system prompt is composed and the LLM is called. The POST `/` handler needs to check if the thread has zero messages for the roadmap task, and if so, short-circuit with a canned response.
- The canned response must be persisted to the thread via `appendMessage()` as both a user message and an assistant message, matching the v1 pattern (lines 1213-1218 in chat.ts).
- The detection of "first turn" in v2: check `thread.messages.filter(m => m.taskId === 'product-manager--roadmap').length === 0`.

**Artifact Generation Divergence:**
- The POST `/generate` endpoint currently has a single code path: LLM call with `MISSION_GENERATION_PROMPT_TEMPLATE`. For roadmap, the generation is purely extractive (no LLM). This means an `artifactType` parameter must be accepted in the request body or derived from `taskId` lookup.
- The frontend `postGenerateArtifact()` in `chatV2Api.ts` currently returns `{ success, missionMarkdown?, error? }`. The response shape must be generalized to `{ success, artifactContent?, error? }` (or a new field name) to avoid roadmap code checking for `missionMarkdown`.

**Save Endpoint Adapter Pattern:**
- The POST `/save-artifact` endpoint needs a new `artifactType` field in the request body (or derivation from `artifactId`/`taskId`).
- Mission adapter: `content` is markdown string -> builds `{ projectParentFolder, projectId, productName, missionMarkdown: content, overwrite: true }` and calls `save_product_artifacts`.
- Roadmap adapter: `content` is JSON string `{ initiatives: [...] }` -> builds `{ projectId, roadmapJson: content }` and calls `save_roadmap_structure`.
- Both use the same `executeToolCall` function from `toolExecutor.ts` which already supports both tools.

**Validation Extension:**
- `validateStructuredResponse()` currently does flat field checking. Extension for nested schemas must be carefully scoped: validate one level deep for array-of-objects fields (`proposedInitiatives` items have `title` string, `epics` sub-array items have `title` string). Full recursive JSON Schema validation is out of scope.

**Dashboard Integration:**
- The `dashboardSummary.ts` real data override for roadmap differs from the mission pattern: mission checks a file on disk (`fs.access`), while roadmap calls `fetchProductSummary()` which is an HTTP call to architecture-model-service. Error handling must gracefully fall back to mock values if the service is unavailable.

**Frontend Prop Generalization:**
- `missionExists: boolean` in DashboardView, UnifiedChatPanel, and useChatThread must all be updated to `artifactExists: Record<string, boolean>` in a coordinated change. The dashboard summary response may need a new field or the frontend derives `artifactExists` from the existing dashboard data (e.g., `roadmap.state.value > 0` means roadmap exists).

**Backward Compatibility:**
- The POST `/generate` and `/save-artifact` endpoints must remain backward compatible with the existing mission flow. All changes are additive (new branches, not replacements).
- The `useChatThread` hook changes must not break the existing "Define Product" flow. The generalization must handle both artifacts transparently.
