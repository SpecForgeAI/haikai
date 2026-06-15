# Task Breakdown: Implement Assistant Stage 3 - Bootstrap Phase with Rich Background Context

## Overview
Total Tasks: 32 (across 5 task groups)

**Goal:** Auto-provide LLM with rich background context (Product Book of Work, current feature, meta-model) before user interaction.

**Bootstrap Flow:**
1. User enters Implement screen -> Frontend auto-triggers `phase: 'bootstrap'` request
2. Gateway fetches product summary + meta-model from architecture-model-service
3. Gateway assembles context and sends to LLM with bootstrap prompt
4. LLM responds with welcome acknowledging context
5. User proceeds with `phase: 'refine'` for subsequent messages

## Task List

### Backend Layer (architecture-model-service)

#### Task Group 1: Product Summary Endpoint
**Dependencies:** None

- [x] 1.0 Complete product summary endpoint
  - [x] 1.1 Write 4-6 focused tests for product summary functionality
    - Test `GET /api/projects/{projectId}/product-summary` returns hierarchical structure
    - Test response includes Initiatives > Epics > Features with names and descriptions
    - Test 404 response for non-existent project
    - Test empty project returns empty structure
    - Test condensed format excludes Stories and detailed spec content
  - [x] 1.2 Create `ProductSummaryDto.java` DTO
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProductSummaryDto.java`
    - Fields: `List<InitiativeSummary> initiatives`
    - Nested record: `InitiativeSummary(String id, String title, String description, List<EpicSummary> epics)`
    - Nested record: `EpicSummary(String id, String title, String description, List<FeatureSummary> features)`
    - Nested record: `FeatureSummary(String id, String title, String description)`
    - Reuse pattern from existing DTOs in `model/dto/` directory
  - [x] 1.3 Create `ProductSummaryService.java` service
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProductSummaryService.java`
    - Inject `WorkItemRepository` for data access
    - Method: `getProductSummary(String projectId)` returns `ProductSummaryDto`
    - Build hierarchical structure from flat work items list
    - Filter to only INITIATIVE, EPIC, FEATURE types (exclude STORY)
    - Follow pattern from `WorkItemService.java`
  - [x] 1.4 Create `ProductSummaryController.java` controller
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProductSummaryController.java`
    - Endpoint: `GET /api/projects/{projectId}/product-summary`
    - Inject `ProductSummaryService`
    - Validate projectId not blank
    - Return `ResponseEntity<ProductSummaryDto>`
    - Follow pattern from `WorkItemController.java`
  - [x] 1.5 Ensure product summary endpoint tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify endpoint returns correct hierarchical structure
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `GET /api/projects/{projectId}/product-summary` returns condensed hierarchical work items
- Response excludes Stories and detailed spec content
- Response format is LLM-friendly (concise names and descriptions)

---

#### Task Group 2: Meta-Model Summary Endpoint
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete meta-model summary endpoint
  - [x] 2.1 Write 4-6 focused tests for meta-model summary functionality
    - Test `GET /api/projects/{projectId}/meta-model-summary` returns all entities
    - Test response includes services, data entities, interfaces, relationships
    - Test 404 response for non-existent project
    - Test entities resolved to human-readable names (not raw IDs)
    - Test response scoped to project (no cross-project leakage)
  - [x] 2.2 Create `MetaModelSummaryDto.java` DTO
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelSummaryDto.java`
    - Fields: `List<ResolvedEntitySummary> services`, `List<ResolvedEntitySummary> dataEntities`, `List<ResolvedEntitySummary> interfaces`, `List<RelationshipSummary> relationships`
    - Nested record: `RelationshipSummary(String sourceEntity, String targetEntity, String relationshipType)`
    - Reuse `ResolvedEntitySummary` from existing DTOs where possible
  - [x] 2.3 Create `MetaModelSummaryService.java` service
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/MetaModelSummaryService.java`
    - Inject `ModelService` or appropriate repository
    - Method: `getMetaModelSummary(String projectId)` returns `MetaModelSummaryDto`
    - Resolve all entity types to human-readable names
    - Extract key relationships between entities
    - Follow patterns from `ImplementContextResolutionService.java`
  - [x] 2.4 Create `MetaModelSummaryController.java` controller
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/MetaModelSummaryController.java`
    - Endpoint: `GET /api/projects/{projectId}/meta-model-summary`
    - Inject `MetaModelSummaryService`
    - Validate projectId not blank
    - Return `ResponseEntity<MetaModelSummaryDto>`
    - Follow pattern from `ImplementContextResolutionController.java`
  - [x] 2.5 Ensure meta-model summary endpoint tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify endpoint returns LLM-friendly entity summaries
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- `GET /api/projects/{projectId}/meta-model-summary` returns all project entities
- Entities include services, data entities, interfaces, and relationships
- All entities resolved to human-readable names
- Response scoped to active project only

---

### Gateway Layer

#### Task Group 3: Gateway Client and Types
**Dependencies:** Task Groups 1 and 2 (backend endpoints must exist)

- [x] 3.0 Complete gateway client and type updates
  - [x] 3.1 Write 4-6 focused tests for gateway client functions
    - Test `fetchProductSummary(projectId)` returns ProductSummary or null on error
    - Test `fetchMetaModelSummary(projectId)` returns MetaModelSummary or null on error
    - Test error handling logs warning and returns null (does not throw)
    - Test URL construction with encoded projectId
  - [x] 3.2 Add `'bootstrap'` to `ChatPhase` type
    - File: `gateway/src/types/chat.ts` (line 30)
    - Change: `export type ChatPhase = 'refine' | 'handoff';` -> `export type ChatPhase = 'refine' | 'handoff' | 'bootstrap';`
    - Update JSDoc comment to document bootstrap phase
  - [x] 3.3 Add TypeScript interfaces for new DTOs
    - File: `gateway/src/types/chat.ts`
    - Add `ProductSummaryDto` interface matching backend DTO
    - Add `MetaModelSummaryDto` interface matching backend DTO
    - Add nested types for hierarchical structures
  - [x] 3.4 Add `fetchProductSummary()` function
    - File: `gateway/src/services/architectureModelClient.ts`
    - Function signature: `export async function fetchProductSummary(projectId: string): Promise<ProductSummaryDto | null>`
    - URL: `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/product-summary`
    - Follow error handling pattern from `resolveImplementContext()`
    - Log with `logger.debug` and `logger.warn`
  - [x] 3.5 Add `fetchMetaModelSummary()` function
    - File: `gateway/src/services/architectureModelClient.ts`
    - Function signature: `export async function fetchMetaModelSummary(projectId: string): Promise<MetaModelSummaryDto | null>`
    - URL: `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/meta-model-summary`
    - Follow error handling pattern from `resolveImplementContext()`
    - Log with `logger.debug` and `logger.warn`
  - [x] 3.6 Export new functions from services index
    - File: `gateway/src/services/index.ts`
    - Add exports for `fetchProductSummary` and `fetchMetaModelSummary`
  - [x] 3.7 Ensure gateway client tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify client functions handle success and error cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- `'bootstrap'` added to `ChatPhase` type with backward compatibility
- New client functions follow existing patterns
- Proper error handling with null return on failure

---

#### Task Group 4: Gateway Prompt and Routing
**Dependencies:** Task Group 3 (client functions must exist)

- [x] 4.0 Complete gateway prompt builder and routing updates
  - [x] 4.1 Write 4-6 focused tests for bootstrap prompt and routing
    - Test `buildSystemPrompt()` routes `phase: 'bootstrap'` to bootstrap template
    - Test `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` includes required sections
    - Test bootstrap prompt includes PRODUCT BACKLOG SUMMARY, CURRENT FEATURE, ARCHITECTURE META-MODEL SUMMARY placeholders
    - Test `tryResolveImplementContext()` allows empty user message for bootstrap
    - Test bootstrap prompt instructs LLM to acknowledge context and ask about diagrams
  - [x] 4.2 Create `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE`
    - File: `gateway/src/services/promptBuilder.ts`
    - Add new constant after `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
    - Include sections:
      - YOUR ROLE: Acknowledge feature and context, welcome user
      - WORK ITEM CONTEXT: {workItemTitle}, {workItemType}, {workItemDescription}
      - PRODUCT BACKLOG SUMMARY: {productSummary}
      - ARCHITECTURE META-MODEL SUMMARY: {metaModelSummary}
    - Include INSTRUCTIONS: Acknowledge feature, acknowledge context, respond with short welcome, ask if user wants to highlight architecture/diagrams
    - Include RULES: DO NOT ask detailed questions, DO NOT propose solutions, DO NOT refine requirements
  - [x] 4.3 Create `buildBootstrapPrompt()` function
    - File: `gateway/src/services/promptBuilder.ts`
    - Function signature: `export function buildBootstrapPrompt(context: ChatContext, productSummary: ProductSummaryDto | null, metaModelSummary: MetaModelSummaryDto | null): string`
    - Extract workItem fields from context
    - Format productSummary as condensed text or "No product backlog available"
    - Format metaModelSummary as condensed text or "No architecture context available"
    - Replace all placeholders in template
    - Follow pattern from `buildImplementPlannerPrompt()`
  - [x] 4.4 Update `buildSystemPrompt()` to route bootstrap phase
    - File: `gateway/src/services/promptBuilder.ts`
    - In the `if (context.phase)` block, add case for `phase === 'bootstrap'`
    - Call `buildBootstrapPrompt()` with context and fetched summaries
    - Note: summaries will be passed as additional parameters (see 4.6)
  - [x] 4.5 Modify `tryResolveImplementContext()` for bootstrap
    - File: `gateway/src/routes/chat.ts`
    - For `phase: 'bootstrap'`: skip entity/diagram resolution (empty arrays OK)
    - Add new helper `tryFetchBootstrapContext()` that calls both `fetchProductSummary()` and `fetchMetaModelSummary()`
    - Return object with `{ productSummary, metaModelSummary }`
  - [x] 4.6 Update POST /api/chat handler for bootstrap
    - File: `gateway/src/routes/chat.ts`
    - Detect `context?.phase === 'bootstrap'`
    - Allow empty or placeholder user message for bootstrap requests
    - Call `tryFetchBootstrapContext()` to get product and meta-model summaries
    - Pass summaries to `buildSystemPrompt()` (requires signature update)
    - Proceed with normal LLM call and response handling
  - [x] 4.7 Ensure gateway prompt and routing tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify bootstrap phase routes correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- `phase: 'bootstrap'` routes to new bootstrap prompt template
- Bootstrap prompt includes all required context sections
- Empty user message allowed for bootstrap requests
- Product and meta-model summaries fetched and injected into prompt

---

### Frontend Layer

#### Task Group 5: Frontend Bootstrap Integration
**Dependencies:** Task Group 4 (gateway must handle bootstrap)

- [x] 5.0 Complete frontend bootstrap integration
  - [x] 5.1 Write 4-6 focused tests for frontend bootstrap behavior
    - Test bootstrap triggers on mount when messages are empty and hasBootstrapped is false
    - Test "Initializing assistant..." loading indicator shown during bootstrap
    - Test bootstrap response displayed as first assistant message
    - Test hasBootstrapped set to true after bootstrap completes
    - Test bootstrap error allows proceeding with refine phase
    - Test bootstrap re-triggers on workItemId change (if no stored state)
  - [x] 5.2 Add `'bootstrap'` to `ImplementChatPhase` type
    - File: `frontend/src/api/chatApi.ts` (line 56)
    - Change: `export type ImplementChatPhase = 'refine' | 'handoff';` -> `export type ImplementChatPhase = 'refine' | 'handoff' | 'bootstrap';`
    - Update JSDoc comment to document bootstrap phase
  - [x] 5.3 Add bootstrap state variables
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Add: `const [isBootstrapping, setIsBootstrapping] = useState(false);`
    - Add: `const [hasBootstrapped, setHasBootstrapped] = useState(false);`
    - Add to `ImplementChatUiState` interface if needed for persistence
  - [x] 5.4 Create `triggerBootstrap()` function
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Create useCallback function to perform bootstrap request
    - Build context with `buildContext('normal_chat', 'bootstrap')`
    - Use empty string or placeholder for message
    - Set `isBootstrapping = true` at start
    - On success: add response as first assistant message, set `hasBootstrapped = true`
    - On error: log error, set `hasBootstrapped = true`, allow proceeding with refine
    - Set `isBootstrapping = false` in finally block
  - [x] 5.5 Add bootstrap useEffect hook
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Trigger condition: mount or workItemId change when messages are empty and hasBootstrapped is false
    - Check: `messages.length === 0 && !hasBootstrapped && !isBootstrapping`
    - Also check: no stored state exists (to avoid re-bootstrapping on tab switch)
    - Call `triggerBootstrap()` when conditions met
    - Dependencies: `[workItemId, messages.length, hasBootstrapped, isBootstrapping, triggerBootstrap]`
  - [x] 5.6 Update UI for bootstrap loading state
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - In empty state section, check `isBootstrapping`
    - If bootstrapping: show "Initializing assistant..." with spinner instead of empty state icon
    - Reuse existing loading indicator styles from `styles.loadingIndicator`
    - After bootstrap: normal empty state or messages display
  - [x] 5.7 Handle bootstrap state in hydration
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Update `ImplementChatUiState` interface to include `hasBootstrapped?: boolean`
    - In hydration useEffect: restore `hasBootstrapped` from stored state if present
    - In persist function: include `hasBootstrapped` in persisted state
    - This prevents re-bootstrapping when switching tabs
  - [x] 5.8 Ensure frontend bootstrap tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify bootstrap triggers correctly on mount
    - Verify loading state displays properly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Bootstrap automatically triggers when entering Implement screen with empty messages
- "Initializing assistant..." loading indicator displays during bootstrap
- Bootstrap response appears as first assistant message
- Bootstrap errors do not block the Implement screen
- Bootstrap state persisted across tab switches (no re-bootstrap on return)

---

### Integration Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests written by backend (Task 1.1)
    - Review the 4-6 tests written by backend (Task 2.1)
    - Review the 4-6 tests written by gateway (Task 3.1)
    - Review the 4-6 tests written by gateway (Task 4.1)
    - Review the 4-6 tests written by frontend (Task 5.1)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for bootstrap feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to bootstrap phase requirements
    - Prioritize: Frontend -> Gateway -> Backend round-trip
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Test: Full bootstrap flow from frontend mount to LLM response
    - Test: Bootstrap with empty product backlog handles gracefully
    - Test: Bootstrap with empty meta-model handles gracefully
    - Test: Subsequent refine messages work after bootstrap
    - Test: Bootstrap error recovery allows manual refine
    - Test: Tab switch after bootstrap does not re-trigger
    - Test: WorkItemId change triggers new bootstrap
    - Test: Bootstrap response format matches expected welcome structure
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to bootstrap feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 28-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical bootstrap workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-38 tests total)
- Critical end-to-end bootstrap workflow covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on bootstrap phase requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Backend (Parallel)
  |-- Task Group 1: Product Summary Endpoint
  |-- Task Group 2: Meta-Model Summary Endpoint

Phase 2: Gateway
  |-- Task Group 3: Gateway Client and Types (depends on 1, 2)
  |-- Task Group 4: Gateway Prompt and Routing (depends on 3)

Phase 3: Frontend
  |-- Task Group 5: Frontend Bootstrap Integration (depends on 4)

Phase 4: Integration
  |-- Task Group 6: Test Review and Gap Analysis (depends on 1-5)
```

**Parallelization Opportunities:**
- Task Groups 1 and 2 can run in parallel (no dependencies)
- Task Groups 3 and 4 must be sequential (4 depends on 3)
- Task Group 5 depends on 4 completing
- Task Group 6 depends on all previous groups

---

## Files to Modify/Create

| Layer | File | Action | Description |
|-------|------|--------|-------------|
| Backend | `model/dto/ProductSummaryDto.java` | Create | DTO for product summary |
| Backend | `service/ProductSummaryService.java` | Create | Service for building product summary |
| Backend | `controller/ProductSummaryController.java` | Create | REST controller for product summary endpoint |
| Backend | `model/dto/MetaModelSummaryDto.java` | Create | DTO for meta-model summary |
| Backend | `service/MetaModelSummaryService.java` | Create | Service for building meta-model summary |
| Backend | `controller/MetaModelSummaryController.java` | Create | REST controller for meta-model summary endpoint |
| Gateway | `types/chat.ts` | Modify | Add 'bootstrap' to ChatPhase, add new DTO interfaces |
| Gateway | `services/architectureModelClient.ts` | Modify | Add fetchProductSummary(), fetchMetaModelSummary() |
| Gateway | `services/promptBuilder.ts` | Modify | Add IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE, buildBootstrapPrompt() |
| Gateway | `routes/chat.ts` | Modify | Handle bootstrap phase, fetch context, route to prompt |
| Gateway | `services/index.ts` | Modify | Export new client functions |
| Frontend | `api/chatApi.ts` | Modify | Add 'bootstrap' to ImplementChatPhase |
| Frontend | `components/ProductView/ImplementationAssistantPanel.tsx` | Modify | Add bootstrap state, useEffect, loading UI |
| Frontend | `contexts/ProductUiStateContext.tsx` | Modify | Add hasBootstrapped to ImplementChatUiState |

---

## Integration Points

| From | To | Method | Description |
|------|-----|--------|-------------|
| Frontend | Gateway | `POST /api/chat` | Bootstrap request with `phase: 'bootstrap'` |
| Gateway | Backend | `GET /api/projects/{projectId}/product-summary` | Fetch product backlog summary |
| Gateway | Backend | `GET /api/projects/{projectId}/meta-model-summary` | Fetch architecture meta-model |
| Gateway | OpenAI | Chat Completions API | Send bootstrap prompt, receive welcome response |

---

## Out of Scope Reminders

Per spec, the following are explicitly excluded:
- Diagram injection during bootstrap phase (user selects diagrams after bootstrap)
- Conversation history persistence to disk
- Caching of bootstrap context
- Retry mechanisms for failed bootstrap requests
- Manual "refresh context" mechanism to re-trigger bootstrap
- Feature refinement or assumption validation in bootstrap response
- Changes to Implement button or execution flow
- Streaming endpoint support for bootstrap (POST only)
- Detailed spec content in Product Book of Work summary
- Changes to existing refine or handoff phase behavior
