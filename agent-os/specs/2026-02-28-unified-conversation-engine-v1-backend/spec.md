# Specification: Unified Conversation Engine v1 (Backend)

## Goal
Build the backend foundation for a unified, config-driven conversation engine that replaces the current bespoke per-mode chat infrastructure with a composable system of persona registry, task registry, prompt composition pipeline, thread persistence model, and a new POST /api/chat/v2 endpoint -- all operating in parallel with the existing v1 system with zero shared state.

## User Stories
- As a developer, I want a registry-driven conversation engine so that adding new personas and tasks requires only JSON config and markdown prompt files instead of modifying TypeScript code in `promptBuilder.ts` and `chat.ts`.
- As a developer, I want a unified thread persistence model so that all conversation types (hub, feature, panel) share a single storage pattern instead of the current mix of in-memory sessions and bespoke disk persistence.
- As a developer, I want a POST /api/chat/v2 endpoint with a unified response contract so that the frontend can interact with any persona/task combination through a single API shape.

## Specific Requirements

**Persona Registry (JSON Config Files)**
- Create 6 persona JSON definition files under `gateway/src/config/personas/`: `assistant.json`, `product-manager.json`, `architect.json`, `ux-designer.json`, `test-engineer.json`, `software-developer.json`
- Each persona JSON defines: `id` (string), `displayName` (string), `color` (string -- hex or Tailwind token), `identityPromptRef` (relative path to .md file), `tasks` (array of task ID strings), `menuLabel` (string for UI menus)
- Create 6 identity prompt `.md` files under `gateway/src/config/prompts/` (e.g., `architect.identity.md`) -- each with substantive content: clear role description, expertise areas, communication style, and boundaries (1-2 solid paragraphs)
- For personas with existing prompt templates (product-manager, architect), extract the identity/personality essence from `PRODUCT_MANAGER_PROMPT_TEMPLATE` and `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` into the `.md` files
- For personas without existing prompts (assistant, ux-designer, test-engineer, software-developer), write original identity content sufficient for downstream testing

**Task Registry (JSON Config Files)**
- Create task JSON definition files under `gateway/src/config/tasks/` using the naming convention `{personaId}--{taskSlug}.json` (e.g., `product-manager--define-product.json`)
- 5 full task definitions for existing working tasks: `product-manager--define-product`, `product-manager--roadmap`, `architect--define-architecture`, `architect--oas-spec`, `product-manager--implement-support`
- ~10 stub task definitions with valid structure but placeholder/minimal taskPrompt content: `assistant--whats-next`, `assistant--freeform`, `product-manager--backlog`, `product-manager--definition-of-done`, `architect--detailed-data-model`, `architect--service-breakdown`, `architect--tech-standards`, `ux-designer--ui-domain`, `test-engineer--test-strategy`, `test-engineer--feature-tests`, `test-engineer--verify-implementation`
- Each task JSON defines: `id`, `personaId`, `menuLabel`, `description`, `mode` (one of `discovery` | `advisory` | `workflow` | `assessment`), `taskPromptRef` (path to .md file), `responseFormat` (JSON schema object describing the structured response shape), `contextNeeds` (array of context resolver keys), `persistence` (thread scope type), `artifacts` (array of artifact slot declarations), `phases` (array of phase definitions for workflow-mode tasks, null for others), `availableFrom` (array of entry point types: `hub` | `panel` | `embedded`)
- Task prompt `.md` files stored under `gateway/src/config/prompts/` using naming convention `{personaId}.{taskSlug}.task.md`
- For the 5 full tasks, extract prompt content from existing TypeScript string constants in `promptBuilder.ts` (e.g., `PRODUCT_MANAGER_PROMPT_TEMPLATE` -> `product-manager.define-product.task.md`)
- For stub tasks, create minimal placeholder `.md` files with a brief description of the task's intent

**Prompt Composition Pipeline**
- Create a new service module `gateway/src/services/promptComposer.ts` that composes system prompts from layers: persona identity + task instructions + project context + response format instructions
- The composition function signature accepts: `personaId`, `taskId`, optional `phaseId`, and a `resolvedContext` record (key-value pairs from context resolvers)
- The pipeline reads the persona identity `.md` file content, appends the task prompt `.md` file content, appends any resolved context sections (delimited with `=== SECTION_NAME ===` markers matching the existing pattern in `buildSystemPrompt`), and appends the response format contract from the task definition
- For the 5 existing tasks, the composed output must be semantically equivalent to what `buildSystemPrompt()` currently produces: same template content, same injected context, same structure -- differences in whitespace, section ordering, or delimiters are acceptable
- Snapshot tests validate that key content sections are present and correct in the composed output, not character-for-character match
- Context resolver interfaces are defined and registered but implementations are stubs for this increment

**Context Resolver Interface**
- Define a `ContextResolver` interface in `gateway/src/services/contextResolvers.ts` with a single method: `resolve(projectId: string, threadKey: string): Promise<Record<string, string>>` that returns a map of context section names to content strings
- Create a `ContextResolverRegistry` that maps context-need keys (e.g., `mission`, `tech-stack`, `roadmap-summary`, `meta-model-summary`) to resolver implementations
- All resolver implementations in this increment are stubs that return empty strings -- the PM define-product proof task does not need context injection
- The registry is loaded at startup alongside persona and task registries

**Thread Persistence Model**
- Define a `ThreadKey` discriminated union type with three variants: `{ type: 'hub'; projectId: string }`, `{ type: 'feature'; projectId: string; featureId: string }`, `{ type: 'panel'; projectId: string; screen: string; entityId?: string }`
- Define a `ThreadMessage` interface with fields: `id` (UUID), `role` (`user` | `assistant` | `system`), `personaId` (string or null for user messages), `taskId` (string or null), `content` (string), `structuredResponse` (unknown or null -- the parsed structured response if applicable), `timestamp` (ISO-8601 string)
- Define a `Thread` interface with fields: `threadKey` (serialized string form), `projectId` (string), `messages` (ThreadMessage array), `activePersonaId` (string or null), `activeTaskId` (string or null), `createdAt` (ISO-8601), `updatedAt` (ISO-8601)
- Create a `ThreadStore` service in `gateway/src/services/threadStore.ts` with operations: `createThread(threadKey)`, `getThread(threadKey)`, `appendMessage(threadKey, message)`, `rehydrate(threadKey)` (loads full thread from disk)
- `threadKeyToPath(threadKey)` function converts a ThreadKey to a deterministic filesystem path under a configurable base directory
- Disk storage pattern follows `implementConversations.ts`: JSON files, atomic writes (write to `.tmp` then rename), `fs.mkdir` with `{ recursive: true }`
- Thread JSON file stored at: `{basePath}/threads/{projectId}/{threadType}/{derivedName}/thread.json`
- Add `threadPersistBasePath` to the existing `Config` interface in `gateway/src/config.ts`, defaulting to `process.env.THREAD_PERSIST_BASE_PATH || process.cwd()`

**POST /api/chat/v2 Endpoint**
- Create a new route module `gateway/src/routes/chatV2.ts` that exports a `chatV2Router`
- Mount at `POST /api/chat/v2` in `server.ts` -- the existing `POST /api/chat` endpoint and its route module remain completely untouched
- Request body contract (`ChatV2Request`): `threadKey` (object with type/projectId/featureId/screen/entityId fields), `personaId` (string), `taskId` (string -- can be `unknown` to trigger menu hook), `message` (string), `files` (optional array of `{ filename, mimeType, base64 }` matching existing v1 pattern)
- Response body contract (`ChatV2Response`): `threadKey` (serialized string), `personaId` (string), `taskId` (string), `assistant` (object with `message` string), `structuredResponse` (unknown -- shape determined by task's `responseFormat`, null for freeform), `error` (optional string for validation failures)
- No mode-specific response fields (no `plannerResponse`, `solutionArchitectResponse`, etc.) -- all structured data goes through the single `structuredResponse` field
- The endpoint flow: validate request -> resolve/create thread -> look up persona and task from registries -> compose system prompt via promptComposer -> build messages array `[system, ...history, user]` -> call `sendChatRequest()` from `openaiClient.ts` -> validate response against task's `responseFormat` -> append user and assistant messages to thread -> return response
- When `taskId` is `unknown`, the endpoint returns a deterministic menu response listing the persona's available tasks (the actual menu rendering is frontend work in Increment 2/3 -- this increment just returns the task list as the `structuredResponse`)
- Reuse `openaiClient.ts` `sendChatRequest()` as-is for LLM calls -- no modifications to openaiClient
- Use `jsonMode: true` in `ChatRequestOptions` for tasks whose `responseFormat` requires structured JSON output

**Registry Loading and Validation at Startup**
- Create a `registryLoader.ts` service in `gateway/src/services/registryLoader.ts` that loads all persona JSONs and task JSONs at startup, validates references, and holds the composed registries in memory
- Export singleton accessor functions: `getPersonaRegistry(): Map<string, PersonaDefinition>`, `getTaskRegistry(): Map<string, TaskDefinition>`, `initializeRegistries(): Promise<void>`
- Call `initializeRegistries()` during gateway startup in `server.ts` before `app.listen()`
- Validation checks: (a) every persona JSON references an existing identity prompt `.md` file on disk, (b) every task JSON references an existing persona ID in the persona registry, (c) every task JSON references a valid taskPrompt `.md` file on disk, (d) phase definitions within workflow tasks reference valid phase prompt files
- On validation failure: log a clear warning with the invalid persona/task ID and the nature of the reference error, skip the invalid entry, and continue loading valid ones -- the gateway still starts and serves valid personas/tasks
- Registry data is loaded once at startup and held in memory -- no hot-reloading

**Response Validation**
- When the task's `responseFormat` declares a JSON schema, validate the LLM's response content against it using a lightweight validation approach (check required top-level fields exist, check field types match)
- On validation failure: log a warning, set `error` field on the response with the validation details, and pass through the raw assistant message as a fallback (matching the existing corrective-retry pattern in `chat.ts` but without the retry in this increment)
- For tasks with no structured response format (advisory/freeform mode), skip validation entirely and return the raw assistant message

**New Types Module**
- Create `gateway/src/types/chatV2.ts` for all v2-specific type definitions: `ChatV2Request`, `ChatV2Response`, `ThreadKey`, `ThreadMessage`, `Thread`, `PersonaDefinition`, `TaskDefinition`, `PhaseDefinition`, `ContextResolverConfig`
- Export these types from the existing `gateway/src/types/index.ts` barrel file
- Do not modify any existing types in `gateway/src/types/chat.ts`

**Config Extension**
- Add `threadPersistBasePath` (string) to the existing `Config` interface in `gateway/src/config.ts`
- Add `registryBasePath` (string) to the existing `Config` interface -- defaults to `path.resolve(__dirname, 'config')` to point at `gateway/src/config/` where persona/task/prompt files live
- Follow the existing pattern: add to `Config` interface, add to `loadConfig()` function with `process.env` override and sensible default

## Existing Code to Leverage

**`gateway/src/services/openaiClient.ts` -- LLM client**
- Reuse `sendChatRequest()` function as-is for all v2 LLM calls; do not modify this module
- Reuse `OpenAIMessage`, `ContentPart`, `ChatRequestOptions` types for building message arrays
- Reuse `jsonMode` option for tasks requiring structured JSON responses
- Reuse `buildToolResultMessages()` if any future tasks need tool execution

**`gateway/src/services/promptBuilder.ts` -- Prompt templates to extract**
- Extract content from `PRODUCT_MANAGER_PROMPT_TEMPLATE` (line 329), `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` (line 414), `ROADMAP_PM_PROMPT_TEMPLATE` (line 570), `SYSTEM_PROMPT_TEMPLATE` (line 83), and implement-feature phase templates into `.md` config files
- Reference the context injection pattern: `=== PRODUCT MISSION ===\n{content}` and `=== TECHNICAL STANDARDS ===\n{content}` delimiter style (lines 1710-1717) for the new prompt composition pipeline
- Reference the `buildSystemPrompt()` function (line 1687) for the overall composition structure that the new pipeline must replicate semantically

**`gateway/src/services/conversation.ts` -- Message array pattern**
- Reference `buildMessagesForTurn()` (line 82) for the `[system, ...history, user]` message array pattern to replicate in the v2 endpoint
- Reference `truncateConversation()` (line 51) for the FIFO truncation approach that thread rehydration may eventually need (not required in this increment but the pattern should be noted)

**`gateway/src/routes/implementConversations.ts` -- Disk persistence pattern**
- Reference the atomic write pattern: write to `.tmp` file then `fs.rename()` (lines 294-301) for thread persistence
- Reference `deriveFolderName()` and `buildTranscriptPath()` for deterministic path derivation
- Reference the `ENOENT` graceful degradation pattern (lines 200-218) for thread rehydration when no file exists

**`gateway/src/config.ts` -- Config singleton**
- Extend the existing `Config` interface (line 22) and `loadConfig()` function (line 134) with new v2-specific fields
- Follow existing patterns: `parseIntEnv`, `parseBoolEnv`, environment variable overrides with sensible defaults
- Follow the singleton pattern via `getConfig()` (line 215)

## Out of Scope
- Streaming support for the v2 endpoint (later increment)
- @-mention parsing from user message text (Increment 3 -- Hub MVP)
- Task selection menu rendering in the frontend (Increment 2/3 -- the v2 endpoint returns the task list but frontend rendering is out of scope)
- Persona handoff protocol between active speakers (Increment 3)
- Artifact hooks including preview, confirm, and save flows (Increments 4-7)
- Live context resolver implementations that actually fetch MISSION.md, meta-model summaries, tech-stack content, or roadmap summaries (only interfaces and stubs in this increment)
- Summarisation of long threads to manage context window size (Increment 11)
- Any frontend changes of any kind (Increment 2)
- Any modifications to the existing `POST /api/chat` endpoint, `chat.ts` route, `promptBuilder.ts`, `conversation.ts`, or `sessionStore.ts` (these remain untouched)
- Feature-scoped and panel-scoped thread creation or exercise (data model defined but only hub threads exercised)
- Corrective retry logic for structured response validation failures (v2 logs and falls back; retry is a future enhancement)
