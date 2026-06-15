# Spec Requirements: Unified Conversation Engine v1 (Backend)

## Initial Description
Increment 1: Unified Conversation Engine v1 (Backend) - Build the backend foundation for a unified conversation engine including persona registry, task registry, prompt composition pipeline, thread persistence model, and POST /api/chat/v2 endpoint. This replaces the current bespoke per-mode chat infrastructure with a config-driven, composable system.

## Requirements Discussion

### First Round Questions

**Q1:** The design document lists 6 personas (assistant, product-manager, architect, ux-designer, test-engineer, software-developer). For Increment 1, I assume the identity prompt .md files for personas that have existing prompt templates (product-manager, architect) should capture their identity/personality from the existing PRODUCT_MANAGER_PROMPT_TEMPLATE, SOLUTION_ARCHITECT_PROMPT_TEMPLATE, etc. For personas with no existing prompts (ux-designer, test-engineer, software-developer, assistant), should the identity .md files be minimal stubs (just name and role description), or do you want substantive persona identity content written for all 6 in this increment?
**Answer:** Somewhere in the middle -- not minimal stubs but not full production-quality either. Enough substance to be testable going forward. Each persona should have a clear role description, expertise areas, communication style, and boundaries. A solid paragraph or two per persona.

**Q2:** The design document lists both existing tasks (mapped from current modes like define-product, define-architecture, roadmap, implement-feature phases) and new tasks (backlog, definition-of-done, ui-domain, test-strategy, etc.). For Increment 1, I assume we create full task JSON definitions for the 5 existing tasks that currently work (product-manager:define-product, architect:define-architecture, product-manager:roadmap, architect:oas-spec, and the implement-feature phases), plus stub definitions for the ~10 new tasks (with placeholder taskPrompt references). Is that correct, or should we limit the registry to only tasks that have existing prompts today?
**Answer:** Create full task definitions for the 5 existing working tasks (product-manager:define-product, product-manager:roadmap, architect:define-architecture, architect:oas-spec, product-manager:implement-support) + stub definitions for the ~10 new tasks. Stubs should have valid structure but placeholder/minimal taskPrompt content.

**Q3:** The spec says "Prompt composition snapshot tests (input string matches expected output)". The current buildSystemPrompt() function produces different prompts depending on mode, phase, resolved context, mission content, tech-stack content, and existing roadmap summary. Should the new prompt composition pipeline produce character-for-character identical output to the current buildSystemPrompt() for the same inputs, or is it acceptable that the composed output is semantically equivalent (same template content, same injected context, same structure) but may differ in whitespace, section ordering, or delimiter formatting?
**Answer:** Semantically equivalent is acceptable. Same template content, same injected context, same structure -- but may differ in whitespace, section ordering, or delimiter formatting. Snapshot tests should validate the key content sections are present and correct, not character-for-character match.

**Q4:** The design document defines thread keys like project:{projectId}:hub, project:{projectId}:feature:{featureId}, and project:{projectId}:panel:{screen}:{entityId?}. The current implementConversations.ts persistence uses a folder structure under projectParentFolder/conversations/{kind}/{derivedFolderName}/. For the v2 thread model, I assume we should store threads under a similar disk-based pattern. However, for Increment 1, which thread key types do we need? I assume only project:{projectId}:hub is needed initially. Should I also account for feature-scoped and panel-scoped thread keys in the data model, even if only hub threads are exercised in this increment?
**Answer:** Yes, the data model should account for ALL thread key types (hub, feature, panel) from the start -- it is just a schema definition and costs nothing to include now. Only hub threads will be exercised in this increment, but the model should be forward-looking for subsequent increments. Define the ThreadKey type with all three variants.

**Q5:** The existing POST /api/chat uses ChatRequest (with sessionId, message, context, sources, files) and returns ChatResponse (with sessionId, assistant, plus mode-specific response fields like plannerResponse, productManagerResponse, etc.). For the v2 endpoint, I assume the request contract changes to include threadKey (instead of sessionId), personaId, and taskId (or these are derived from thread state). And the response always includes a personaId attribution field. Should the v2 response still carry the mode-specific structured response fields (plannerResponse, solutionArchitectResponse, etc.), or should there be a single unified structuredResponse field whose shape is determined by the task's declared responseFormat?
**Answer:** Single unified structuredResponse field whose shape is determined by the task's declared responseFormat. No more mode-specific fields (plannerResponse, solutionArchitectResponse, etc.). The response should include personaId and taskId attribution.

**Q6:** The design document says "Engine loads at startup, validates references, holds composed registry in memory." I assume validation should: (a) verify every persona JSON references an existing identity prompt .md file, (b) verify every task JSON references an existing persona and a valid taskPrompt .md file, (c) verify phase definitions within workflow tasks reference valid taskPrompt files. Should validation fail hard (crash the gateway process with a clear error) on any reference error, or should it warn and skip the invalid persona/task while allowing the gateway to start with the valid ones?
**Answer:** Warn and skip the invalid persona/task. The gateway should still start and serve valid personas/tasks. Log clear warnings for anything invalid so developers can fix issues without the whole service being down.

**Q7:** The current system uses getOrCreateSession() with in-memory sessions and sessionId to maintain conversation state. The new v2 endpoint uses thread-based persistence. I assume the v2 endpoint operates entirely on its own thread model and does NOT interact with the existing session store at all -- they are fully parallel systems. The existing POST /api/chat endpoint continues using sessions as-is. Is that correct?
**Answer:** Confirmed -- v2 operates entirely on its own thread model with zero interaction with the existing session store. Fully parallel systems. The existing POST /api/chat endpoint and its session management remain completely untouched.

**Q8:** Is there anything explicitly out of scope for this increment that you want to call out? For instance: streaming support for v2, @-mention parsing, task selection menus, persona handoff protocol, artifact hooks, context resolvers (fetching MISSION.md, meta-model summaries, etc.), or summarisation. I assume all of these are out of scope for Increment 1 and will be addressed in later increments.
**Answer:** Out of scope for Increment 1: Streaming support for v2 (later increment). @-mention parsing from message text (Increment 3 -- Hub MVP). Task selection menu responses (Increment 3 -- the v2 endpoint should have the hook point where task=unknown triggers a menu, but the actual menu rendering is frontend work in Increment 2/3). Persona handoff protocol (Increment 3). Artifact hooks including preview/confirm/save (Increments 4-7). Summarisation (Increment 11). Frontend changes (Increment 2). Any changes to the existing POST /api/chat endpoint (all increments until Increment 10 cleanup). Partially IN scope: define the context resolver INTERFACES and register them, but implementations can be stubs. The PM define-product task (the proof task for this increment) does not need context injection, so stubs are sufficient for the acceptance criteria.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Disk-based conversation persistence - Path: `gateway/src/routes/implementConversations.ts`
  - GET/PUT endpoints for JSON + transcript file persistence
  - Atomic write pattern (write to .tmp then rename)
  - Folder name derivation via `deriveFolderName()` and `buildTranscriptPath()`
  - Pattern for the new thread persistence layer to reference (but not reuse directly)
- Feature: Prompt composition with mode switching - Path: `gateway/src/services/promptBuilder.ts`
  - `buildSystemPrompt()` function at line 1687 -- the function being replaced by registry-driven composition
  - Mode-specific prompt template constants (PRODUCT_MANAGER_PROMPT_TEMPLATE, SOLUTION_ARCHITECT_PROMPT_TEMPLATE, ROADMAP_PM_PROMPT_TEMPLATE, SYSTEM_PROMPT_TEMPLATE, IMPLEMENT_PLANNER_PROMPT_TEMPLATE, etc.)
  - Context injection patterns (mission content, tech-stack content, existing roadmap summary, condensed context DTOs)
- Feature: In-memory session management - Path: `gateway/src/services/conversation.ts`
  - `buildMessagesForTurn()` -- pattern for composing [system, ...history, user] message arrays
  - `truncateConversation()` -- FIFO truncation with message count and byte size limits
  - `persistConversation()` -- session-based persistence (NOT to be reused by v2, but referenced for message formatting patterns)
- Feature: OpenAI client - Path: `gateway/src/services/openaiClient.ts`
  - `sendChatRequest()` -- to be reused as-is for making LLM calls from v2 endpoint
  - `OpenAIMessage` interface and `ContentPart` type -- message format for the LLM
  - `ChatRequestOptions` -- jsonMode, tools, toolChoice, temperature, maxTokens
- Feature: Existing chat types - Path: `gateway/src/types/chat.ts`
  - `ChatMode`, `ChatContext`, `ChatRequest`, `ChatResponse` -- existing contracts that v1 uses (v2 will define its own)
  - `ProductManagerResponse`, `SolutionArchitectResponse`, `RoadmapPmResponse` -- structured response shapes to unify into single `structuredResponse`
- Feature: Existing chat route - Path: `gateway/src/routes/chat.ts`
  - MUST NOT BE MODIFIED -- existing endpoint remains untouched
  - Contains mode-specific validation, corrective retry patterns, confirmation detection, and transcript flushing
  - Pattern reference for how structured responses are validated and fallback responses created
- Feature: Gateway configuration - Path: `gateway/src/config.ts`
  - `Config` interface and `getConfig()` -- singleton pattern for configuration
  - Environment variable parsing utilities (parseIntEnv, parseBoolEnv, parseCommaSeparated)
  - Will need extension for v2-specific config (thread persistence base path, registry paths)

**Code Reuse Decision:** The v2 thread persistence should be its own new layer -- do not reuse the existing conversation.ts in-memory session utilities directly. However, low-level patterns (like how messages are formatted for the OpenAI API call) can be referenced. The openaiClient.ts should be reused as-is for making LLM calls.

### Follow-up Questions

No follow-up questions were needed. All answers were sufficiently detailed.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check confirmed no files in `C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-02-28-unified-conversation-engine-v1-backend/planning/visuals/`.

### Visual Insights:
Not applicable -- this is a backend-only increment with no UI components.

## Requirements Summary

### Functional Requirements

**1. Persona Registry (JSON Config Files)**
- 6 persona definition files loaded at startup: assistant, product-manager, architect, ux-designer, test-engineer, software-developer
- Each persona JSON defines: id, displayName, color, identityPrompt (reference to .md file), available tasks list, menuLabel
- 6 identity prompt .md files, each with substantive content: clear role description, expertise areas, communication style, and boundaries (solid paragraph or two per persona)
- Stored under `gateway/src/config/personas/`
- Identity prompts stored under `gateway/src/config/prompts/`

**2. Task Registry (JSON Config Files)**
- 5 full task definitions for existing working tasks:
  - `product-manager--define-product` (maps to current product_manager mode)
  - `product-manager--roadmap` (maps to current roadmap_pm mode)
  - `architect--define-architecture` (maps to current solution_architect mode)
  - `architect--oas-spec` (maps to current oas_assistant mode)
  - `product-manager--implement-support` (maps to current implement_feature mode phases)
- ~10 stub task definitions for future tasks with valid structure but placeholder/minimal taskPrompt content:
  - assistant--whats-next, assistant--freeform
  - product-manager--backlog, product-manager--definition-of-done
  - architect--detailed-data-model, architect--service-breakdown, architect--tech-standards
  - ux-designer--ui-domain
  - test-engineer--test-strategy, test-engineer--feature-tests, test-engineer--verify-implementation
- Each task defines: id, personaId, menuLabel, description, mode (discovery/advisory/workflow/assessment), taskPrompt ref, responseFormat, contextNeeds, persistence, artifacts, phases, availableFrom
- Stored under `gateway/src/config/tasks/`
- Task prompt .md files stored under `gateway/src/config/prompts/`

**3. Prompt Composition Pipeline**
- Composes system prompt from layers: persona identity + task instructions + project context + response format
- Must produce semantically equivalent prompts to current `buildSystemPrompt()` for existing tasks (same template content, same injected context, same structure -- whitespace/delimiter differences acceptable)
- Context resolver interfaces defined and registered, but implementations are stubs for this increment
- The PM define-product task is the "proof task" -- does not need context injection, so stubs are sufficient

**4. Thread Persistence Model**
- Thread and Message entities stored as JSON files on disk
- ThreadKey type defined with all three variants from the start:
  - `project:{projectId}:hub` -- Hub Chat thread (only one exercised in Increment 1)
  - `project:{projectId}:feature:{featureId}` -- Feature/work-item scoped thread
  - `project:{projectId}:panel:{screen}:{entityId?}` -- Side panel thread
- Operations: create, get (by thread key), append message, rehydrate (load full thread from disk)
- Own persistence layer -- does NOT reuse existing conversation.ts in-memory session utilities
- Disk storage pattern similar to implementConversations.ts (JSON files, atomic writes)

**5. POST /api/chat/v2 Endpoint**
- New endpoint at `POST /api/chat/v2` alongside existing `POST /api/chat`
- Existing `POST /api/chat` remains completely untouched and functional
- Request contract includes threadKey, personaId, taskId (or derived from thread state), message
- Response includes: personaId attribution, taskId attribution, single unified `structuredResponse` field (shape determined by task's declared responseFormat)
- No mode-specific response fields (no plannerResponse, solutionArchitectResponse, etc.)
- Reuses `openaiClient.ts` `sendChatRequest()` for LLM calls
- Hook point where task=unknown triggers a menu (but actual menu rendering is frontend work in Increment 2/3)
- Fully parallel to existing v1 system -- zero interaction with existing session store

**6. Registry Validation at Startup**
- Engine loads persona and task registries at startup, validates references, holds composed registry in memory
- Validation checks:
  - Every persona JSON references an existing identity prompt .md file
  - Every task JSON references an existing persona ID
  - Every task JSON references a valid taskPrompt .md file
  - Phase definitions within workflow tasks reference valid taskPrompt files
- On validation failure: warn and skip the invalid persona/task; gateway still starts with valid ones
- Log clear warnings for anything invalid so developers can fix issues

### Reusability Opportunities
- `openaiClient.ts` (`sendChatRequest`, `OpenAIMessage`, `ContentPart`, `ChatRequestOptions`) -- reuse as-is for LLM calls
- `implementConversations.ts` -- reference atomic write pattern (write .tmp then rename) for thread persistence
- `conversation.ts` `buildMessagesForTurn()` -- reference the [system, ...history, user] message array composition pattern
- `config.ts` -- extend existing Config interface and `getConfig()` singleton pattern for v2-specific config
- `promptBuilder.ts` existing prompt template constants -- extract content into .md files for the registry-driven system

### Scope Boundaries

**In Scope:**
- 6 persona JSON definitions + 6 identity prompt .md files (substantive content for all 6)
- 5 full task definitions + ~10 stub task definitions with valid structure
- Task prompt .md files for existing tasks (content extracted from existing prompt template constants)
- Placeholder/minimal task prompt .md files for stub tasks
- Prompt composition pipeline that produces semantically equivalent output for existing tasks
- Context resolver interfaces defined and registered (stub implementations)
- ThreadKey type with all three variants (hub, feature, panel)
- Thread persistence layer (create, get, append, rehydrate) -- disk-based JSON
- POST /api/chat/v2 endpoint with unified response contract
- Registry validation at startup (warn-and-skip strategy)
- Snapshot tests for prompt composition (validate key content sections present and correct)
- Response contract validation (correct JSON schema per task)
- Thread append and rehydrate tests

**Out of Scope:**
- Streaming support for v2 (later increment)
- @-mention parsing from message text (Increment 3 -- Hub MVP)
- Task selection menu responses (Increment 3 -- hook point exists but actual menu is frontend)
- Persona handoff protocol (Increment 3)
- Artifact hooks including preview/confirm/save (Increments 4-7)
- Live context resolver implementations (only interfaces + stubs in this increment)
- Summarisation (Increment 11)
- Frontend changes of any kind (Increment 2)
- Any modifications to existing POST /api/chat endpoint (untouched until Increment 10 cleanup)
- Feature-scoped and panel-scoped thread creation/exercise (data model defined but not exercised)

### Technical Considerations
- Existing gateway is Express.js + TypeScript with OpenAI (gpt-4o) for all persona conversations
- Thread persistence is disk-based JSON (no database) consistent with existing patterns
- Registry files are JSON config loaded at startup -- not hot-reloaded
- The v2 endpoint and v1 endpoint coexist as fully parallel systems with zero shared state
- OpenAI client (`openaiClient.ts`) is reused as-is -- no modifications
- Config singleton pattern (`getConfig()`) should be extended for new v2-related config values
- Prompt templates currently live as TypeScript string constants in `promptBuilder.ts` -- need extraction to .md files
- The design document specifies 3-level structure: Persona Definition > Task Definition > Phase Definition (for workflow-mode tasks)
- Task `responseFormat` determines the shape of the unified `structuredResponse` field in v2 responses
- The design document's full analysis conversation is at: `C:\Workspaces\SSD\architecture-store-and-diagrams\docs\unified-conversation-engine-analysis.txt`
