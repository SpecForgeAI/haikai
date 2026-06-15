# Task Breakdown: Unified Conversation Engine v1 (Backend)

## Overview
Total Tasks: 8 Task Groups, ~58 sub-tasks

This is a backend-only increment that replaces the bespoke per-mode chat infrastructure with a config-driven, composable conversation engine. All new code operates in parallel with the existing v1 system -- zero shared state, zero modifications to existing files.

**Key Constraint:** The existing `POST /api/chat` endpoint, `chat.ts`, `promptBuilder.ts`, `conversation.ts`, and `sessionStore.ts` must remain completely untouched.

## Task List

---

### Foundation Layer

#### Task Group 1: Types and Interfaces
**Dependencies:** None
**Assignee Profile:** Backend engineer (TypeScript)

This group defines every type, interface, and discriminated union used by subsequent groups. Nothing is implemented beyond type declarations. Getting these right first prevents ripple-effect refactors later.

- [x] 1.0 Complete v2 types module
  - [x] 1.1 Write 4 focused tests for type contracts
    - Test that `ThreadKey` discriminated union narrowing works correctly for all 3 variants (`hub`, `feature`, `panel`)
    - Test that `threadKeyToString()` produces the expected serialized form for each variant
    - Test that `parseThreadKey()` round-trips correctly (serialize then parse)
    - Test that `ChatV2Request` and `ChatV2Response` type guards validate required fields
  - [x] 1.2 Create `gateway/src/types/chatV2.ts` with all type definitions
    - `ThreadKey` discriminated union: `{ type: 'hub'; projectId: string }`, `{ type: 'feature'; projectId: string; featureId: string }`, `{ type: 'panel'; projectId: string; screen: string; entityId?: string }`
    - `threadKeyToString(key: ThreadKey): string` -- serializes to deterministic string form (e.g., `project:{projectId}:hub`)
    - `parseThreadKey(raw: string): ThreadKey` -- deserializes back to object form
    - `ThreadMessage` interface: `id` (UUID), `role` (`user` | `assistant` | `system`), `personaId` (string | null), `taskId` (string | null), `content` (string), `structuredResponse` (unknown | null), `timestamp` (ISO-8601 string)
    - `Thread` interface: `threadKey` (string), `projectId` (string), `messages` (ThreadMessage[]), `activePersonaId` (string | null), `activeTaskId` (string | null), `createdAt` (ISO-8601), `updatedAt` (ISO-8601)
    - `PersonaDefinition` interface: `id`, `displayName`, `color`, `identityPromptRef`, `tasks` (string[]), `menuLabel`
    - `TaskDefinition` interface: `id`, `personaId`, `menuLabel`, `description`, `mode` (`discovery` | `advisory` | `workflow` | `assessment`), `taskPromptRef`, `responseFormat` (JSON schema object or null), `contextNeeds` (string[]), `persistence` (string), `artifacts` (array), `phases` (PhaseDefinition[] | null), `availableFrom` (string[])
    - `PhaseDefinition` interface: `id`, `label`, `phasePromptRef`, `responseFormat` (JSON schema object or null)
    - `ContextResolverConfig` interface: `key` (string), `resolverType` (string)
    - `ChatV2Request` interface: `threadKey` (object), `personaId` (string), `taskId` (string), `message` (string), `files` (optional array of `{ filename, mimeType, base64 }`)
    - `ChatV2Response` interface: `threadKey` (string), `personaId` (string), `taskId` (string), `assistant` (`{ message: string }`), `structuredResponse` (unknown | null), `error` (optional string)
  - [x] 1.3 Export all v2 types from `gateway/src/types/index.ts` barrel file
    - Add a new v2 export section at the bottom of the existing barrel file
    - Do NOT modify any existing exports
  - [x] 1.4 Ensure type tests pass
    - Run ONLY the tests written in 1.1
    - Verify TypeScript compilation succeeds with `npx tsc --noEmit`

**Acceptance Criteria:**
- All v2 types compile without errors
- `ThreadKey` discriminated union narrows correctly in type guards
- `threadKeyToString` / `parseThreadKey` round-trip correctly for all 3 variants
- Types are accessible from `gateway/src/types/index.ts`
- No changes to any existing types in `gateway/src/types/chat.ts`

---

#### Task Group 2: Config Extension
**Dependencies:** Task Group 1
**Assignee Profile:** Backend engineer (TypeScript)

Extends the existing `Config` singleton with two new fields needed by the registry loader and thread store. Follows the established pattern exactly.

- [x] 2.0 Complete config extension
  - [x] 2.1 Write 3 focused tests for config extension
    - Test that `threadPersistBasePath` defaults to `process.cwd()` when env var is absent
    - Test that `registryBasePath` defaults to `path.resolve(__dirname, 'config')` when env var is absent
    - Test that both fields are overridden when `THREAD_PERSIST_BASE_PATH` and `REGISTRY_BASE_PATH` env vars are set
  - [x] 2.2 Add fields to `Config` interface in `gateway/src/config.ts`
    - `threadPersistBasePath: string` -- base directory for thread JSON files
    - `registryBasePath: string` -- base directory for persona/task/prompt config files
  - [x] 2.3 Add field initialization to `loadConfig()` function
    - `threadPersistBasePath`: `process.env.THREAD_PERSIST_BASE_PATH || process.cwd()`
    - `registryBasePath`: `process.env.REGISTRY_BASE_PATH || path.resolve(__dirname, 'config')`
    - Follow existing pattern: add import for `path` if not already present
  - [x] 2.4 Ensure config tests pass
    - Run ONLY the tests written in 2.1

**Acceptance Criteria:**
- `getConfig().threadPersistBasePath` returns a valid path
- `getConfig().registryBasePath` returns a valid path
- Both fields respect environment variable overrides
- Existing config fields and behavior are unchanged

---

### Registry Layer

#### Task Group 3: Persona and Task Config Files
**Dependencies:** Task Group 2
**Assignee Profile:** Backend engineer / content author

This group creates all the JSON config files and markdown prompt files that the registries consume. No TypeScript service code is written here -- only the data layer that drives the engine.

- [x] 3.0 Complete persona and task config files
  - [x] 3.1 Create directory structure
    - `gateway/src/config/personas/` -- persona JSON definitions
    - `gateway/src/config/tasks/` -- task JSON definitions
    - `gateway/src/config/prompts/` -- identity and task prompt markdown files
  - [x] 3.2 Create 6 persona JSON definition files under `gateway/src/config/personas/`
    - `assistant.json` -- id: `assistant`, displayName: `Assistant`, tasks: [`assistant--whats-next`, `assistant--freeform`]
    - `product-manager.json` -- id: `product-manager`, displayName: `Product Manager`, tasks: [`product-manager--define-product`, `product-manager--roadmap`, `product-manager--implement-support`, `product-manager--backlog`, `product-manager--definition-of-done`]
    - `architect.json` -- id: `architect`, displayName: `Solution Architect`, tasks: [`architect--define-architecture`, `architect--oas-spec`, `architect--detailed-data-model`, `architect--service-breakdown`, `architect--tech-standards`]
    - `ux-designer.json` -- id: `ux-designer`, displayName: `UX Designer`, tasks: [`ux-designer--ui-domain`]
    - `test-engineer.json` -- id: `test-engineer`, displayName: `Test Engineer`, tasks: [`test-engineer--test-strategy`, `test-engineer--feature-tests`, `test-engineer--verify-implementation`]
    - `software-developer.json` -- id: `software-developer`, displayName: `Software Developer`, tasks: []
    - Each JSON includes: `id`, `displayName`, `color` (hex or Tailwind token), `identityPromptRef` (relative path), `tasks`, `menuLabel`
  - [x] 3.3 Create 6 identity prompt `.md` files under `gateway/src/config/prompts/`
    - `assistant.identity.md` -- General-purpose AI assistant; expertise in codebase navigation, task routing; friendly, concise style
    - `product-manager.identity.md` -- Extract identity/personality essence from `PRODUCT_MANAGER_PROMPT_TEMPLATE` (line 329 of promptBuilder.ts); Senior PM conducting discovery; expertise in product strategy, stakeholder alignment, requirements elicitation; structured questioning style
    - `architect.identity.md` -- Extract identity/personality essence from `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` (line 414); Senior SA conducting architecture discovery; expertise in system design, integration patterns, data modeling; methodical, section-based style
    - `ux-designer.identity.md` -- UX/UI design specialist; expertise in wireframing, design systems, user research; user-centered, visual-thinking style
    - `test-engineer.identity.md` -- QA/Test specialist; expertise in test strategy, acceptance criteria, verification; thorough, detail-oriented style
    - `software-developer.identity.md` -- Implementation specialist; expertise in code generation, refactoring, debugging; pragmatic, code-first style
    - Each file should be 1-2 solid paragraphs with: clear role description, expertise areas, communication style, and boundaries
  - [x] 3.4 Create 5 full task JSON definition files under `gateway/src/config/tasks/`
    - `product-manager--define-product.json` -- maps to current `product_manager` mode; mode: `discovery`; responseFormat: `{ phase, questions, summary }` schema; contextNeeds: []; availableFrom: [`hub`]
    - `product-manager--roadmap.json` -- maps to current `roadmap_pm` mode; mode: `discovery`; responseFormat: `{ phase, section, questions, summary, proposedInitiatives, assumptions, openItems }` schema; contextNeeds: [`mission`, `existing-roadmap`]; availableFrom: [`hub`, `panel`]
    - `architect--define-architecture.json` -- maps to current `solution_architect` mode; mode: `discovery`; responseFormat: `{ phase, section, questions, summary }` schema; contextNeeds: [`mission`, `tech-stack`]; availableFrom: [`hub`]
    - `architect--oas-spec.json` -- maps to current `oas_assistant` mode; mode: `workflow`; responseFormat: null (freeform with tool calls); contextNeeds: []; availableFrom: [`panel`]
    - `product-manager--implement-support.json` -- maps to current `implement_feature` mode; mode: `workflow`; phases array with `bootstrap`, `refine`, `implementation_planning`, `generate_specs` phase definitions; contextNeeds: [`meta-model-summary`, `product-summary`]; availableFrom: [`embedded`]
  - [x] 3.5 Create 5 full task prompt `.md` files under `gateway/src/config/prompts/`
    - `product-manager.define-product.task.md` -- Extract content from `PRODUCT_MANAGER_PROMPT_TEMPLATE` constant (promptBuilder.ts line 329-390)
    - `product-manager.roadmap.task.md` -- Extract content from `ROADMAP_PM_PROMPT_TEMPLATE` constant (promptBuilder.ts line 570-644)
    - `architect.define-architecture.task.md` -- Extract content from `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` constant (promptBuilder.ts line 414-546)
    - `architect.oas-spec.task.md` -- Extract content from `SYSTEM_PROMPT_TEMPLATE` constant (promptBuilder.ts line 83-105)
    - `product-manager.implement-support.task.md` -- Extract content from `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` constant (promptBuilder.ts line 118-181); phase-specific prompt files for bootstrap, implementation_planning, generate_specs as needed
  - [x] 3.6 Create ~10 stub task JSON definition files under `gateway/src/config/tasks/`
    - `assistant--whats-next.json`, `assistant--freeform.json`
    - `product-manager--backlog.json`, `product-manager--definition-of-done.json`
    - `architect--detailed-data-model.json`, `architect--service-breakdown.json`, `architect--tech-standards.json`
    - `ux-designer--ui-domain.json`
    - `test-engineer--test-strategy.json`, `test-engineer--feature-tests.json`, `test-engineer--verify-implementation.json`
    - Each stub has valid structure with all required fields but minimal/placeholder taskPrompt content
  - [x] 3.7 Create ~10 stub task prompt `.md` files under `gateway/src/config/prompts/`
    - One `.md` file per stub task definition using naming convention `{personaId}.{taskSlug}.task.md`
    - Each contains a brief description of the task's intent (1-3 sentences)
  - [x] 3.8 Validate all JSON files parse correctly
    - Run a simple validation script or manual check that all `.json` files are valid JSON
    - Verify all `identityPromptRef` and `taskPromptRef` paths point to existing `.md` files

**Acceptance Criteria:**
- 6 persona JSON files exist under `gateway/src/config/personas/`
- 6 identity prompt `.md` files exist under `gateway/src/config/prompts/`
- 5 full task JSON files + ~10 stub task JSON files exist under `gateway/src/config/tasks/`
- 5 full task prompt `.md` files + ~10 stub task prompt `.md` files exist under `gateway/src/config/prompts/`
- All JSON files parse without error
- All file path references in JSON files point to existing `.md` files
- Full task prompts contain the substantive content extracted from `promptBuilder.ts` template constants
- Identity prompts each contain 1-2 paragraphs with role description, expertise, style, and boundaries

---

#### Task Group 4: Registry Loader and Context Resolver Interfaces
**Dependencies:** Task Groups 1, 2, 3
**Assignee Profile:** Backend engineer (TypeScript)

This group creates the registry loader service that reads all JSON configs at startup, validates cross-references, and holds the composed registries in memory. It also defines the context resolver interface and stub registry.

- [x] 4.0 Complete registry loader and context resolver stubs
  - [x] 4.1 Write 6 focused tests for registry loading and validation
    - Test that `initializeRegistries()` loads all 6 persona definitions into the persona registry map
    - Test that `initializeRegistries()` loads all ~15 task definitions into the task registry map
    - Test that a persona JSON referencing a non-existent `.md` file logs a warning and is skipped (registry still loads valid entries)
    - Test that a task JSON referencing a non-existent persona ID logs a warning and is skipped
    - Test that `getPersonaRegistry()` returns a Map keyed by persona ID
    - Test that `getTaskRegistry()` returns a Map keyed by task ID with `personaId` correctly set
  - [x] 4.2 Create `gateway/src/services/registryLoader.ts`
    - `initializeRegistries(): Promise<void>` -- reads all persona JSONs from `{registryBasePath}/personas/*.json`, reads all task JSONs from `{registryBasePath}/tasks/*.json`, validates cross-references, populates in-memory maps
    - `getPersonaRegistry(): Map<string, PersonaDefinition>` -- returns the loaded persona map
    - `getTaskRegistry(): Map<string, TaskDefinition>` -- returns the loaded task map
    - Validation checks:
      - (a) Every persona JSON `identityPromptRef` points to an existing `.md` file on disk
      - (b) Every task JSON `personaId` exists in the persona registry
      - (c) Every task JSON `taskPromptRef` points to an existing `.md` file on disk
      - (d) Phase definitions within workflow tasks reference valid phase prompt files
    - On validation failure: log `logger.warn(...)` with the invalid persona/task ID and the nature of the error, skip the invalid entry, continue loading valid ones
    - Use `fs.readdir` + `fs.readFile` with `path.resolve` to read config directory
    - Use the existing `logger` from `gateway/src/services/logger.ts`
  - [x] 4.3 Create `gateway/src/services/contextResolvers.ts`
    - Define `ContextResolver` interface: `resolve(projectId: string, threadKey: string): Promise<Record<string, string>>`
    - Create `ContextResolverRegistry` class or map: maps context-need keys (`mission`, `tech-stack`, `roadmap-summary`, `meta-model-summary`, `product-summary`, `existing-roadmap`) to resolver implementations
    - All resolver implementations in this increment are stubs that return empty strings
    - Export `getContextResolverRegistry(): Map<string, ContextResolver>`
    - Registry is populated during `initializeRegistries()` alongside persona and task registries
  - [x] 4.4 Ensure registry tests pass
    - Run ONLY the tests written in 4.1
    - Verify that loading succeeds with the config files from Task Group 3

**Acceptance Criteria:**
- `initializeRegistries()` loads all valid persona and task definitions from disk
- Invalid entries are skipped with clear warning logs (gateway does not crash)
- `getPersonaRegistry()` returns a Map with 6 entries (keyed by persona ID)
- `getTaskRegistry()` returns a Map with ~15 entries (keyed by task ID)
- Context resolver registry is populated with stub resolvers for all known context-need keys
- No modifications to any existing service files

---

### Service Layer

#### Task Group 5: Thread Persistence Store
**Dependencies:** Task Groups 1, 2
**Assignee Profile:** Backend engineer (TypeScript)

Creates the disk-based thread persistence layer. This is an entirely new service module with no interaction with the existing session store or conversation.ts utilities.

- [x] 5.0 Complete thread persistence store
  - [x] 5.1 Write 6 focused tests for thread store operations
    - Test `createThread()` creates a new thread JSON file on disk at the correct path
    - Test `getThread()` returns null when no thread file exists (ENOENT graceful degradation)
    - Test `getThread()` returns the thread when the file exists
    - Test `appendMessage()` adds a message to an existing thread and persists to disk
    - Test `rehydrate()` loads a full thread from disk including all messages
    - Test `threadKeyToPath()` produces deterministic filesystem paths for each ThreadKey variant (hub, feature, panel)
  - [x] 5.2 Create `gateway/src/services/threadStore.ts`
    - `threadKeyToPath(threadKey: ThreadKey, basePath: string): string` -- converts a ThreadKey to a deterministic filesystem path: `{basePath}/threads/{projectId}/{threadType}/{derivedName}/thread.json`
      - Hub: `{basePath}/threads/{projectId}/hub/thread.json`
      - Feature: `{basePath}/threads/{projectId}/feature/{featureId}/thread.json`
      - Panel: `{basePath}/threads/{projectId}/panel/{screen}/{entityId || '_'}/thread.json`
    - `createThread(threadKey: ThreadKey): Promise<Thread>` -- creates a new Thread object, writes initial JSON to disk, returns the Thread
    - `getThread(threadKey: ThreadKey): Promise<Thread | null>` -- reads thread JSON from disk, returns null if file does not exist (ENOENT pattern from `implementConversations.ts`)
    - `appendMessage(threadKey: ThreadKey, message: ThreadMessage): Promise<Thread>` -- loads thread, pushes message, writes back to disk atomically
    - `rehydrate(threadKey: ThreadKey): Promise<Thread | null>` -- alias for getThread with explicit intent of full disk load
    - Atomic write pattern: write to `.tmp` then `fs.rename()` (reference `implementConversations.ts` lines 294-301)
    - Use `fs.mkdir` with `{ recursive: true }` for directory creation
    - Use `getConfig().threadPersistBasePath` for the base directory
    - Use the existing `logger` for debug/error logging
  - [x] 5.3 Ensure thread store tests pass
    - Run ONLY the tests written in 5.1
    - Tests should use a temporary directory (e.g., `os.tmpdir()`) to avoid polluting project directories

**Acceptance Criteria:**
- Thread JSON files are created, read, updated, and rehydrated from disk
- Atomic writes prevent data corruption (write to `.tmp` then rename)
- ENOENT is handled gracefully (returns null, does not throw)
- Filesystem paths are deterministic and match the spec pattern
- No interaction with existing session store, conversation.ts, or sessionStore.ts

---

#### Task Group 6: Prompt Composition Pipeline
**Dependencies:** Task Groups 1, 3, 4
**Assignee Profile:** Backend engineer (TypeScript)

Creates the new prompt composition service that replaces `buildSystemPrompt()` for v2 conversations. The composed output must be semantically equivalent to what the existing function produces for the same inputs.

- [x] 6.0 Complete prompt composition pipeline
  - [x] 6.1 Write 6 focused snapshot-style tests for prompt composition
    - Test that composing the `product-manager--define-product` task produces output containing all key content sections from `PRODUCT_MANAGER_PROMPT_TEMPLATE` (response format, rules, question strategy, sufficiency tracking)
    - Test that composing the `architect--define-architecture` task produces output containing all key content sections from `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` (discovery sections, question strategy, readiness gate, response format)
    - Test that composing the `product-manager--roadmap` task produces output containing all key content sections from `ROADMAP_PM_PROMPT_TEMPLATE` (roadmap sections, response format, context alignment)
    - Test that the persona identity content appears at the top of the composed prompt (before task instructions)
    - Test that context sections are delimited with `=== SECTION_NAME ===` markers matching the existing pattern in `buildSystemPrompt`
    - Test that the response format contract from the task definition is appended at the end of the composed prompt
  - [x] 6.2 Create `gateway/src/services/promptComposer.ts`
    - `composeSystemPrompt(personaId: string, taskId: string, phaseId: string | null, resolvedContext: Record<string, string>): Promise<string>`
    - Composition pipeline layers (in order):
      1. Read persona identity `.md` file content (from `identityPromptRef` via persona registry)
      2. Read task prompt `.md` file content (from `taskPromptRef` via task registry; or phase-specific prompt if `phaseId` is provided)
      3. Append resolved context sections delimited with `=== SECTION_NAME ===` markers (e.g., `=== PRODUCT MISSION ===\n{content}`)
      4. Append response format contract from the task definition's `responseFormat` field (formatted as a JSON schema instruction block)
    - Use `getPersonaRegistry()` and `getTaskRegistry()` to look up definitions
    - Use `fs.readFile()` to read `.md` file content (resolve paths relative to `registryBasePath`)
    - Skip empty context values (do not append `=== SECTION_NAME ===` with empty content)
    - For tasks with no `responseFormat` (null), skip step 4
  - [x] 6.3 Ensure prompt composition tests pass
    - Run ONLY the tests written in 6.1
    - Verify that composed output for existing tasks is semantically equivalent to what `buildSystemPrompt()` produces (same content sections present, not character-for-character match)

**Acceptance Criteria:**
- `composeSystemPrompt()` produces semantically equivalent output to `buildSystemPrompt()` for the 5 existing tasks
- Persona identity content appears at the top of the composed output
- Task prompt content follows the persona identity
- Context sections use `=== SECTION_NAME ===` delimiters matching existing patterns
- Response format instructions are appended when the task defines a `responseFormat`
- No modifications to `promptBuilder.ts` or any existing prompt-related code

---

### Endpoint Layer

#### Task Group 7: POST /api/chat/v2 Endpoint
**Dependencies:** Task Groups 1-6
**Assignee Profile:** Backend engineer (TypeScript, Express.js)

Creates the new v2 chat endpoint that ties everything together: registry lookup, prompt composition, thread management, LLM call, response validation, and thread persistence.

- [x] 7.0 Complete v2 chat endpoint
  - [x] 7.1 Write 8 focused tests for the v2 endpoint
    - Test that a valid request with `taskId: 'product-manager--define-product'` returns a `ChatV2Response` with `personaId`, `taskId`, `assistant.message`, and `structuredResponse`
    - Test that `taskId: 'unknown'` returns a deterministic menu response listing the persona's available tasks as the `structuredResponse`
    - Test that a request with an invalid `personaId` returns a 400 error
    - Test that a request with an invalid `taskId` (not `unknown` and not in registry) returns a 400 error
    - Test that the thread is created on the first request and rehydrated on subsequent requests (verify messages accumulate)
    - Test that structured response validation failure sets the `error` field and passes through raw assistant message as fallback
    - Test that `files` array is correctly forwarded to the LLM message (multimodal content parts)
    - Test that `jsonMode: true` is set in `ChatRequestOptions` for tasks whose `responseFormat` is non-null
  - [x] 7.2 Create `gateway/src/routes/chatV2.ts`
    - Export `chatV2Router` using `Router()` from Express
    - `POST /` handler (will be mounted at `/api/chat/v2`):
      1. **Validate request**: Parse and validate `ChatV2Request` body; return 400 with descriptive error for missing/invalid fields
      2. **Resolve/create thread**: Convert `threadKey` object to `ThreadKey` type; call `getThread()` or `createThread()` if not exists
      3. **Look up persona and task**: Get `PersonaDefinition` from `getPersonaRegistry()` by `personaId`; get `TaskDefinition` from `getTaskRegistry()` by `taskId`; return 400 if either not found
      4. **Handle `taskId: 'unknown'`**: Return deterministic menu response listing persona's tasks from the persona definition's `tasks` array
      5. **Resolve context**: For each key in task's `contextNeeds`, call the corresponding stub context resolver from `getContextResolverRegistry()`; collect results into `Record<string, string>`
      6. **Compose system prompt**: Call `composeSystemPrompt(personaId, taskId, null, resolvedContext)`
      7. **Build messages array**: `[{ role: 'system', content: systemPrompt }, ...thread.messages (mapped to OpenAIMessage format), { role: 'user', content: request.message }]`; handle `files` attachment by building `ContentPart[]` for the user message (reference existing pattern in `chat.ts`)
      8. **Call LLM**: Call `sendChatRequest(messages, requestId, threadKey, { jsonMode: task.responseFormat !== null })` from `openaiClient.ts`
      9. **Validate response**: If task has `responseFormat`, parse LLM response as JSON; check required top-level fields exist and field types match; on failure: log warning, set `error` field, pass through raw assistant message
      10. **Append messages to thread**: Append user message and assistant message as `ThreadMessage` entries via `appendMessage()`
      11. **Return response**: Build and send `ChatV2Response` with `threadKey` (serialized), `personaId`, `taskId`, `assistant`, `structuredResponse`, optional `error`
    - Use `requestIdMiddleware` pattern (access `req.requestId` or generate UUID)
    - Import `sendChatRequest` from `openaiClient.ts` -- do NOT modify `openaiClient.ts`
    - Import `OpenAIMessage` from types for building the messages array
  - [x] 7.3 Create response validation utility
    - In `chatV2.ts` or as a helper: `validateStructuredResponse(raw: string, responseFormat: object): { valid: boolean; parsed?: unknown; error?: string }`
    - Check required top-level fields exist (from `responseFormat` schema)
    - Check field types match expected types
    - On failure: return `{ valid: false, error: 'Missing field: xyz' }` or `{ valid: false, error: 'Type mismatch: xyz expected string, got number' }`
    - Lightweight validation only -- no full JSON Schema validator library
  - [x] 7.4 Export `chatV2Router` from `gateway/src/routes/index.ts`
    - Add export line: `export { chatV2Router } from './chatV2';`
    - Do NOT modify any existing exports
  - [x] 7.5 Mount endpoint and initialize registries in `gateway/src/server.ts`
    - Import `chatV2Router` from routes
    - Import `initializeRegistries` from `registryLoader`
    - Add route mount: `app.use('/api/chat/v2', chatV2Router)` alongside existing routes
    - Call `initializeRegistries()` during startup before `app.listen()`:
      ```
      // Initialize v2 conversation engine registries
      initializeRegistries().then(() => {
        logger.info('V2 registries initialized');
      }).catch(err => {
        logger.error('Failed to initialize v2 registries', { error: err.message });
      });
      ```
    - Add console.log line for the new endpoint in the startup block
  - [x] 7.6 Ensure v2 endpoint tests pass
    - Run ONLY the tests written in 7.1
    - Tests should mock `sendChatRequest` to avoid real OpenAI calls
    - Tests should use `supertest` to make HTTP requests against the Express app

**Acceptance Criteria:**
- `POST /api/chat/v2` accepts a `ChatV2Request` and returns a `ChatV2Response`
- Existing `POST /api/chat` endpoint continues to work unchanged
- Registry lookup, prompt composition, thread management, and LLM call all operate correctly
- `taskId: 'unknown'` returns the persona's available task list
- Structured response validation catches missing/wrong-type fields and sets `error` without crashing
- `files` array is correctly handled as multimodal content parts
- `jsonMode` is set when the task has a `responseFormat`
- Thread state persists across multiple requests (messages accumulate)
- Registries are initialized before the server starts accepting requests

---

### Test Review Layer

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7
**Assignee Profile:** Test engineer / backend engineer

Reviews all tests written by prior task groups, identifies critical coverage gaps, and adds up to 10 additional tests focused on integration points and end-to-end workflows.

- [x] 8.0 Review existing tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 type contract tests (Task 1.1)
    - Review the 3 config extension tests (Task 2.1)
    - Review the 6 registry loader tests (Task 4.1)
    - Review the 6 thread store tests (Task 5.1)
    - Review the 6 prompt composition tests (Task 6.1)
    - Review the 8 v2 endpoint tests (Task 7.1)
    - Total existing tests: approximately 33 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to v2 conversation engine requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 8.3 Write up to 10 additional strategic tests to fill gaps
    - Possible gap areas (write tests only where genuinely needed):
      - End-to-end flow: valid request -> registry lookup -> prompt compose -> LLM call -> response validation -> thread append -> response returned
      - Thread rehydration across turns: send message 1, verify thread has 2 messages (user + assistant), send message 2, verify thread has 4 messages
      - Prompt composition with context injection: compose with non-empty resolved context and verify `=== SECTION_NAME ===` markers appear in output
      - Registry loader error resilience: missing prompts directory, empty personas directory, malformed JSON file
      - Response validation edge cases: LLM returns non-JSON for a task expecting JSON; LLM returns valid JSON missing required fields
      - Thread store concurrent writes: two rapid appends do not corrupt the thread file (atomic write pattern)
      - Config field interaction: verify `registryBasePath` is used by `initializeRegistries()` and `threadPersistBasePath` is used by `threadStore`
    - Do NOT exceed 10 additional tests
    - Focus on integration points and end-to-end workflows
  - [x] 8.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 33-43 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 33-43 tests total)
- Critical user workflows for the v2 conversation engine are covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's feature requirements
- No regressions in existing functionality (existing `POST /api/chat` endpoint untouched)

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Types and Interfaces        (no dependencies)
    |
Task Group 2: Config Extension             (depends on 1)
    |
    +---> Task Group 3: Config Files       (depends on 2)
    |         |
    |         v
    |     Task Group 4: Registry Loader    (depends on 1, 2, 3)
    |
    +---> Task Group 5: Thread Store       (depends on 1, 2)
              |
              v
          Task Group 6: Prompt Composer    (depends on 1, 3, 4)
              |
              v
          Task Group 7: V2 Endpoint        (depends on 1-6)
              |
              v
          Task Group 8: Test Review        (depends on 1-7)
```

**Parallelizable work:**
- Task Groups 3 and 5 can run in parallel after Task Group 2 completes
- Task Group 4 must wait for Task Group 3 (needs config files on disk)
- Task Group 6 must wait for Task Group 4 (needs registry to look up definitions)
- Task Group 7 depends on everything
- Task Group 8 runs last as a review and gap-fill pass

## Files Created (New)

| File | Purpose |
|------|---------|
| `gateway/src/types/chatV2.ts` | All v2 type definitions |
| `gateway/src/services/registryLoader.ts` | Loads persona/task registries at startup |
| `gateway/src/services/contextResolvers.ts` | Context resolver interface + stub implementations |
| `gateway/src/services/threadStore.ts` | Disk-based thread persistence |
| `gateway/src/services/promptComposer.ts` | Registry-driven prompt composition pipeline |
| `gateway/src/routes/chatV2.ts` | POST /api/chat/v2 route handler |
| `gateway/src/config/personas/*.json` | 6 persona definition files |
| `gateway/src/config/tasks/*.json` | ~15 task definition files |
| `gateway/src/config/prompts/*.md` | ~21 prompt files (6 identity + ~15 task) |

## Files Modified (Existing)

| File | Change |
|------|--------|
| `gateway/src/config.ts` | Add `threadPersistBasePath` and `registryBasePath` to Config interface and loadConfig() |
| `gateway/src/types/index.ts` | Add v2 type exports |
| `gateway/src/routes/index.ts` | Add `chatV2Router` export |
| `gateway/src/server.ts` | Mount `/api/chat/v2` route; call `initializeRegistries()` at startup |

## Files NOT Modified

| File | Reason |
|------|--------|
| `gateway/src/routes/chat.ts` | Existing v1 endpoint remains untouched |
| `gateway/src/services/promptBuilder.ts` | Existing prompt builder remains untouched (content is extracted, not moved) |
| `gateway/src/services/conversation.ts` | Existing session-based conversation service remains untouched |
| `gateway/src/services/openaiClient.ts` | Reused as-is for LLM calls |
| `gateway/src/types/chat.ts` | Existing v1 types remain untouched |
