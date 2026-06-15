# Task Breakdown: LLM Persona/Task Save-Target Resolution (Spec #5)

## Overview
Total Tasks: 11 task groups covering backend foundation (interface→architecture lookup endpoint), gateway resolver and prompt composition, task JSON declarations, chatV2 binding intercept, frontend picker + invalidation banner, chat panel wiring, and final test gap analysis.

This spec extends spec #4 Group 5's `bound-by-system-prompt` foundation (already shipped for Discovery tasks) to the 6 remaining architect + UX architecture-scoped tasks across three modes:
- `bound-by-system-prompt` (extended) — `architect--define-architecture`, `architect--detailed-data-model`, `architect--generate-architecture-diagram`
- `derived-from-context` (NEW, interfaces-only V1) — `architect--oas-spec`
- `clarify-at-save` (NEW, picker modal) — `ux-designer--users-interactions`, `ux-designer--ui-domain`

## Task List

### Backend Layer (architecture-model-service)

#### Task Group 1: Interface→Architecture Binding Lookup Endpoint
**Dependencies:** None

- [x] 1.0 Add interface→architecture binding lookup endpoint to architecture-model-service
  - [x] 1.1 Write 2-8 focused tests for the new lookup endpoint and service
    - Limit to 2-8 highly focused tests maximum
    - Test: 200 with `{architectureId, architectureName, archived}` payload for a valid interface in a non-archived architecture
    - Test: 200 with `archived: true` flag for a valid interface in an archived architecture
    - Test: 404 when the interface does not exist for the given project
    - Skip exhaustive coverage of edge cases (auth, malformed UUIDs handled by framework)
  - [x] 1.2 Add service method to look up interface→architecture binding
    - Locate `ModelInterfacesService` (or equivalent — controller bucketing established in spec #1)
    - New method: `getArchitectureBinding(projectId, interfaceId)` returns `{architectureId, architectureName, archived}` DTO or throws `NotFound`
    - Implementation: query the interface's architecture row, hydrate name + archived flag
  - [x] 1.3 Add controller endpoint
    - Choose: extend `ModelInterfacesController` OR add a new `BindingLookupController` (implementer's call — see spec for guidance)
    - Path: `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding`
    - Returns: 200 with the binding DTO, or 404 on missing interface
    - Note: this lookup is intentionally project-scoped (no `:architectureId` segment) because the caller does not yet know the architecture — that is what the lookup resolves
  - [x] 1.4 Add response DTO type
    - New record / class: `InterfaceArchitectureBindingResponse(architectureId, architectureName, archived)`
    - Place alongside other model DTOs in the appropriate package
  - [x] 1.5 Ensure backend layer tests pass
    - Run ONLY the 2-8 tests written in 1.1 using the workaround from project memory:
      `mvn surefire:test -Dtest=<TestClass> -Dmaven.test.skip=false -Dtests.skip=false`
    - Pre-existing broken backend test files (`WorkItemImplementContextServiceTest`, `OrganisationControllerDocsAppliedTest`, `OrganisationControllerTextIdTest`, `RoadmapImportServiceV3Test`) block `mvn test-compile` — use `javac` direct-compile workaround if needed
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding` returns `{architectureId, architectureName, archived}` for valid interfaces
- Endpoint returns 404 for missing interfaces
- Archived flag correctly reflects parent architecture's archived state
- Pre-existing failing tests are NOT regressed

---

### Gateway Layer

#### Task Group 2: Gateway Client Helper + `derivedBindingResolver` Module
**Dependencies:** Task Group 1

- [x] 2.0 Add gateway client helper and derived-binding resolver module
  - [x] 2.1 Write 2-8 focused tests for the resolver and client helper
    - Limit to 2-8 highly focused tests maximum
    - Test: `lookupInterfaceArchitecture` happy path (URL shape + response parsing).
    - Test: `lookupInterfaceArchitecture` 404 throws `InterfaceArchitectureLookupError` with status 404.
    - Test: `derivedBindingResolver.resolve` happy path with `entityType: 'interface'`.
    - Test: `derivedBindingResolver.resolve` returns `unsupported_binding_type` for `entityType: 'service'`.
    - Test: `derivedBindingResolver.resolve` returns `archived_architecture` when interface's architecture is archived.
    - Use `jest.requireActual` spread when partially mocking `architectureModelClient.ts`.
  - [x] 2.2 Extend `saveTargetResolution` union type in `gateway/src/types/chatV2.ts`
    - Add `'derived-from-context'` as a third option to both `PersonaDefinition.saveTargetResolution` and `TaskDefinition.saveTargetResolution` field types.
  - [x] 2.3 Add typed binding fields shape to `Thread.metadata`
    - New `ThreadArchitectureBindingMetadata` interface in `gateway/src/types/chatV2.ts` with optional `boundArchitectureId`, `boundArchitectureName`, `boundEntityType`, `boundEntityId` keys.
    - `Thread.metadata` typed as `Record<string, unknown> & ThreadArchitectureBindingMetadata` so the field stays permissive while documenting the binding sub-shape for type-checked callers.
  - [x] 2.4 Add `lookupInterfaceArchitecture(projectId, interfaceId)` helper to `gateway/src/services/architectureModelClient.ts`
    - Returns `Promise<InterfaceArchitectureBinding>` (`{architectureId, architectureName, archived}`).
    - Hits `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding`.
    - Throws `InterfaceArchitectureLookupError` (typed error, carries upstream `status`) on 404 / non-2xx / network failure so callers can branch on the failure mode.
  - [x] 2.5 Create `gateway/src/services/derivedBindingResolver.ts`
    - Exports `resolve(projectId, entityType, entityId): Promise<DerivedBindingResult>`.
    - V1: only accepts `entityType: 'interface'`. Other types throw `DerivedBindingError` with `code: 'unsupported_binding_type'`.
    - For valid `'interface'`: calls `lookupInterfaceArchitecture`, returns the binding payload.
    - If resolved architecture has `archived: true`: throws `DerivedBindingError` with `code: 'archived_architecture'` and a message identifying the architecture name.
    - Upstream lookup failures (404 / 5xx / network): mapped to `DerivedBindingError` with `code: 'lookup_failed'` so the chatV2 handler doesn't leak upstream HTTP details to the LLM.
    - `DerivedBindingError` exposes the `code` field for the chatV2 handler (Group 6) to map to HTTP 422 responses.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- `lookupInterfaceArchitecture` exists on `architectureModelClient` and the upstream URL is project-scoped (no `:architectureId` segment).
- `derivedBindingResolver.resolve` exists, V1 supports only `'interface'`, refuses archived architectures, and exposes a typed `DerivedBindingError` with `code` field.
- `saveTargetResolution` union includes `'derived-from-context'` on both `PersonaDefinition` and `TaskDefinition`.
- `Thread.metadata` is typed to accommodate the binding sub-shape `ThreadArchitectureBindingMetadata`.
- Pre-existing gateway tests are not regressed.

---

#### Task Group 3: `saveTargetResolution` Declarations on the 6 Task JSONs
**Dependencies:** Task Group 2

- [x] 3.0 Declare `saveTargetResolution` on each of the 6 architect + UX architecture-scoped task JSON files
  - [x] 3.1 Write 1-2 focused tests for the declarations
    - Limit to 2 tests maximum (declarative configuration only — no runtime behaviour to exercise here; modes are exercised by Groups 4-10).
    - Test: registry loader hydrates each of the 6 task definitions with the correct `saveTargetResolution` value.
    - Test: spec #4 Discovery tasks (`architect--discovery-framing`, `architect--discovery-qa`) keep their existing `bound-by-system-prompt` declarations (no regression).
  - [x] 3.2 Add `"saveTargetResolution": "bound-by-system-prompt"` to `gateway/src/config/tasks/architect--define-architecture.json`
    - Append the field at the top level alongside `availableFrom`, mirroring the pattern in `architect--discovery-framing.json` and `architect--discovery-qa.json`.
  - [x] 3.3 Add `"saveTargetResolution": "bound-by-system-prompt"` to `gateway/src/config/tasks/architect--detailed-data-model.json`
    - Same field placement convention as 3.2.
  - [x] 3.4 Add `"saveTargetResolution": "bound-by-system-prompt"` to `gateway/src/config/tasks/architect--generate-architecture-diagram.json`
    - Same field placement convention as 3.2.
  - [x] 3.5 Add `"saveTargetResolution": "derived-from-context"` to `gateway/src/config/tasks/architect--oas-spec.json`
    - Uses the new union value added in Group 2.2.
  - [x] 3.6 Add `"saveTargetResolution": "clarify-at-save"` to `gateway/src/config/tasks/ux-designer--users-interactions.json`
    - Same field placement convention as 3.2.
  - [x] 3.7 Add `"saveTargetResolution": "clarify-at-save"` to `gateway/src/config/tasks/ux-designer--ui-domain.json`
    - Same field placement convention as 3.2.
  - [x] 3.8 Ensure gateway TypeScript still compiles and the new test passes
    - `npx tsc --noEmit` passes (the new union value from Group 2.2 already covers all three declared modes).
    - The 1-2 tests from 3.1 pass.
    - Existing `promptComposer-architecture-binding` tests remain green (no regression of spec #4 Group 5 behaviour).

**Acceptance Criteria:**
- All six task JSONs carry the correct `saveTargetResolution` value (per the mode-to-task locked assignments in the spec).
- The 1-2 tests written in 3.1 pass.
- Spec #4 Group 5's Discovery `saveTargetResolution` declarations remain intact and the `promptComposer-architecture-binding` suite still passes.
- `npx tsc --noEmit` passes for the gateway package.

---

#### Task Group 4: `composeSystemPrompt` Extended for `derived-from-context` Mode
**Dependencies:** Task Group 3

- [x] 4.0 Extend `composeSystemPrompt` so the `Architecture: <name> (id: <id>)` line is injected symmetrically for `bound-by-system-prompt` and `derived-from-context` whenever an `architectureBinding` is supplied
  - [x] 4.1 Write 2-8 focused tests for the new and existing inject paths
    - Limit to 2-8 highly focused tests maximum (5 written).
    - Test: `derived-from-context` (`architect--oas-spec`) + binding present → injects the architecture line (the chatV2 caller has synthesised the binding from `Thread.metadata.boundArchitectureId` after a previous turn's resolver fired).
    - Test: `derived-from-context` (`architect--oas-spec`) + no binding → line omitted (first-turn case; LLM operates in "I need to identify the entity first" mode).
    - Test: `bound-by-system-prompt` (`architect--define-architecture`) + binding present → injects (regression check from spec #4 Group 5; ensures relaxing the gate did not change bound-mode behaviour).
    - Test: `bound-by-system-prompt` (`architect--define-architecture`) + no binding → line omitted (defensive forward-only check).
    - Test: `clarify-at-save` (`ux-designer--ui-domain`) + binding present → line NOT injected (binding is for save-time picker, not prompt-time).
    - Place tests in `gateway/src/__tests__/promptComposer-derived-from-context-binding.test.ts`, mirroring the patterns in `promptComposer-architecture-binding.test.ts`.
  - [x] 4.2 Modify `gateway/src/services/promptComposer.ts`
    - Replace the `effectiveResolution === 'bound-by-system-prompt'` gate with `effectiveResolution === 'bound-by-system-prompt' || effectiveResolution === 'derived-from-context'` so a supplied `architectureBinding` is injected symmetrically for both modes.
    - When `effectiveResolution` is `derived-from-context` and `architectureBinding` is null/undefined (first conversation turn, no binding established yet), continue to omit the line — no defensive line fabrication.
    - Update JSDoc on `composeSystemPrompt` and `ArchitectureBindingContext` to document the symmetric inject and the Group 6 wiring expectation: the chatV2 caller is responsible for synthesising the binding from `Thread.metadata.boundArchitectureId` for already-bound `derived-from-context` threads.
    - `clarify-at-save` is left unchanged (no inject ever, even if a caller supplies the argument).
  - [x] 4.3 Ensure tests pass and TypeScript compiles
    - The 2-8 tests from 4.1 pass.
    - The existing `promptComposer-architecture-binding` suite still passes (spec #4 Group 5 regression check).
    - `npx tsc --noEmit` passes for the gateway package.

**Acceptance Criteria:**
- `composeSystemPrompt` injects `Architecture: <name> (id: <id>)` for both `bound-by-system-prompt` AND `derived-from-context` when a binding is supplied.
- `composeSystemPrompt` omits the line for `derived-from-context` when no binding is supplied (first-turn case).
- `composeSystemPrompt` omits the line for `clarify-at-save` even when a binding is supplied.
- The 5 tests in 4.1 pass; the 4 spec #4 Group 5 tests still pass.
- `npx tsc --noEmit` passes for the gateway package.

---

#### Task Group 5: `architect--generate-architecture-diagram` Task Prompt Swap-Architecture Hint
**Dependencies:** Task Group 4

- [x] 5.0 Add the swap-architecture hint instruction to the `architect--generate-architecture-diagram` task prompt so the LLM proactively tells the user which architecture is bound and how to switch
  - [x] 5.1 Write 1-2 focused tests for the swap-architecture hint
    - Limit to 1-2 highly focused tests maximum (1 written; the prompt is loaded as static text via `fs.readFile` so a single end-to-end composition assertion covers both the static instruction text and the bound-mode injection).
    - Test: composed system prompt for `architect--generate-architecture-diagram` with a binding contains BOTH the `Architecture: <name> (id: <id>)` line AND the static swap-architecture instructional sentence (`We are generating a diagram from architecture` / `switch architecture in the selector if you want to generate from a different one.`), with the architecture name appearing literally on the injected line so the LLM can read and parrot it.
    - Place test in `gateway/src/__tests__/promptComposer-generate-architecture-diagram-swap-hint.test.ts`, mirroring the patterns in `promptComposer-architecture-binding.test.ts` and `promptComposer-derived-from-context-binding.test.ts`.
  - [x] 5.2 Modify `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md`
    - Add a new top-level section `# ARCHITECTURE CONTEXT (SWAP-ARCHITECTURE HINT)` immediately after the opening preamble and before `# CORE PRINCIPLE`.
    - Section instructs the LLM to read the architecture name verbatim from the `Architecture:` line in the system prompt above and parrot it in its FIRST user-facing response (the opening message of Phase 1) using the exact wording: `We are generating a diagram from architecture **<name>** — switch architecture in the selector if you want to generate from a different one.`
    - Substitution mechanism: the task prompt file is loaded as static text via `fs.readFile` -- there is no template substitution in `composeSystemPrompt`. The static instruction therefore tells the LLM to read the bound architecture name from the `Architecture:` line that `bound-by-system-prompt` mode injects (Spec #4 Group 5 / Spec #5 Group 4 plumbing) and parrot it in its opening user-facing message.
    - Includes a fallback clause: if no `Architecture:` line is present (forward-only legacy threads with no binding), the LLM skips the swap-architecture sentence and proceeds directly with Phase 1 -- mirrors the forward-only behaviour of the bound-mode injection.
  - [x] 5.3 Ensure tests pass and no regressions
    - The 1-2 tests from 5.1 pass.
    - The existing `promptComposer-architecture-binding` and `promptComposer-derived-from-context-binding` suites still pass (no regression of spec #4 Group 5 / spec #5 Group 4 behaviour).
    - Pre-existing failing tests in `promptComposer.test.ts` (2 unrelated fails: `should produce output containing all key content sections from ROADMAP_PM_PROMPT_TEMPLATE for product-manager--roadmap` and `should append the response format contract from the task definition at the end of the composed prompt`) are NOT regressed (verified pre-existing via stash/pop).

**Acceptance Criteria:**
- The `architect--generate-architecture-diagram` task prompt carries the swap-architecture instructional section, telling the LLM to surface `We are generating a diagram from architecture <name> — switch architecture in the selector if you want to generate from a different one.` in its opening response.
- The LLM is instructed to read the architecture name verbatim from the `Architecture:` line that bound-mode injection adds to the system prompt -- no template substitution at composition time is required.
- The composed system prompt for the task contains BOTH the bound architecture line AND the static swap-architecture instructional sentence whenever a binding is supplied.
- A fallback clause covers forward-only legacy threads with no binding: the LLM skips the swap-architecture sentence in that case.
- The 1 test in 5.1 passes; the 4 spec #4 Group 5 tests and the 5 spec #5 Group 4 tests still pass.

---

#### Task Group 6: chatV2 Response Handler Intercepts `contextBinding`
**Dependencies:** Task Group 4

- [x] 6.0 Wire the chatV2 response handler to intercept the LLM's `contextBinding` block, call `derivedBindingResolver`, persist the binding on `Thread.metadata`, surface 422 refusals, and synthesise the architecture binding from `Thread.metadata` on subsequent turns
  - [x] 6.1 Write 2-8 focused tests for the chatV2 contextBinding intercept
    - Limit to 2-8 highly focused tests maximum (5 written) -- happy path + the two 422 refusal codes + V1 re-binding refusal + already-bound follow-up turn synthesis.
    - Test: chatV2 with valid `interface` `contextBinding` -> `derivedBindingResolver.resolve(...)` is called with `(projectId, "interface", entityId)` AND `Thread.metadata` is updated with `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` AND no `bindingError` on the response.
    - Test: chatV2 with `contextBinding` for an archived architecture -> `bindingError` on response with `{status: 422, code: 'archived_architecture'}` AND `Thread.metadata` binding fields stay undefined.
    - Test: chatV2 with `contextBinding` for unsupported `entityType` (e.g. `'service'`) -> `bindingError` on response with `{status: 422, code: 'unsupported_binding_type'}` AND `Thread.metadata` binding fields stay undefined.
    - Test: re-binding refused in V1 -- chatV2 with a NEW `contextBinding` block on a thread that is already bound -> resolver is NOT called a second time AND original `boundArchitectureId` (and supporting fields) is preserved (silent ignore -- warn-level log only, no `bindingError`).
    - Test: already-bound `derived-from-context` follow-up turn (no new `contextBinding` emitted) -> `composeSystemPrompt` is invoked with the synthesised `architectureBinding` (verified by inspecting the system message of the LLM messages array, which must contain the literal `Architecture: <name> (id: <id>)` line).
    - Place tests in `gateway/src/__tests__/chatV2-derived-binding-intercept.test.ts`. Mock `derivedBindingResolver` so each test can drive the resolver outcome (success / `DerivedBindingError` variants) without hitting any upstream service; mock `getLlmClient().sendChatRequest` so each test can drive the LLM reply; mock `architectureModelClient` with `jest.requireActual` spread so `fetchProjectFolder` returns a per-test temp directory while leaving other helpers untouched (per project memory).
  - [x] 6.2 Recover Group 2/3 typing changes that the in-flight chatV2 type file had lost
    - The `gateway/src/types/chatV2.ts` file was missing the typing changes recorded as done by Groups 2.2/2.3/3.x (an earlier in-flight edit got reverted before commit). Without these the route file (Step 5h, Step 9c) and `composeSystemPrompt` cannot type-check.
    - Restored: `SaveTargetResolutionMode` union (`'bound-by-system-prompt' | 'derived-from-context' | 'clarify-at-save'`) and the optional `saveTargetResolution` field on `PersonaDefinition` and `TaskDefinition`.
    - Restored: optional `architectureId` field on `ChatV2Request` (Spec #4 Group 5 plumbing -- referenced by Step 5h `bound-by-system-prompt` branch).
    - Restored: `ThreadArchitectureBindingMetadata` sub-shape interface and `Thread.metadata` typed as `Record<string, unknown> & ThreadArchitectureBindingMetadata`.
  - [x] 6.3 Add Group 6 typing for the `bindingError` payload on `ChatV2Response`
    - New `ChatV2BindingErrorCode` union (`'unsupported_binding_type' | 'archived_architecture' | 'lookup_failed'`) mirroring `DerivedBindingError.code`.
    - New `ChatV2BindingError` interface (`{status, code, message}`) -- `status` is always 422 in V1 since the chat turn itself succeeds.
    - Optional `bindingError?: ChatV2BindingError` on `ChatV2Response`. The HTTP response stays 200 because the chat turn itself completed -- only the binding side effect failed; frontend (Group 9) will render the failure inline so the user can pick a different entity on the next turn.
  - [x] 6.4 Modify `gateway/src/routes/chatV2.ts` -- extend Step 5h to handle `derived-from-context`
    - On already-bound `derived-from-context` threads, synthesise `architectureBinding = {id: thread.metadata.boundArchitectureId, name: thread.metadata.boundArchitectureName}` so `composeSystemPrompt` (Group 4 plumbing) injects the `Architecture: <name> (id: <id>)` line on every subsequent turn.
    - Continue to fall through with `architectureBinding = null` for first-turn (unbound) `derived-from-context` -- Group 4 omits the line so the LLM operates in "I need to identify the entity first" mode.
    - `bound-by-system-prompt` branch unchanged (regression protected by spec #4 Group 5's `promptComposer-architecture-binding.test.ts`).
  - [x] 6.5 Modify `gateway/src/routes/chatV2.ts` -- new Step 9c `contextBinding` intercept
    - After Step 9 (response validation) and before Step 10 (message persistence), inspect `structuredResponse` for a `contextBinding` block of shape `{entityType: string, entityId: string}`.
    - Skip the intercept entirely when the active task's effective `saveTargetResolution` is anything other than `'derived-from-context'` (zero overhead for bound / clarify / undefined modes).
    - Re-binding refused in V1: when the thread is already bound (`thread.metadata.boundArchitectureId` set), log a warn and ignore the new block -- no resolver call, no `bindingError`, original binding preserved.
    - When the thread is unbound: call `resolveDerivedBinding(projectId, entityType, entityId)`. On success, spread `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` onto `thread.metadata` and `await saveThread(threadKey, thread)` so subsequent turns get the binding. On `DerivedBindingError`, populate `bindingError = {status: 422, code, message}` for the response payload (no thread mutation, no save).
    - Unexpected (non-`DerivedBindingError`) failures are mapped to `bindingError` with `code: 'lookup_failed'` and logged at error level so the frontend / user can recover without a hard 500.
  - [x] 6.6 Modify `gateway/src/routes/chatV2.ts` -- include `bindingError` on the Step 11 response
    - Spread `...(bindingError ? { bindingError } : {})` onto the `ChatV2Response` payload so frontend Group 9 can render the inline refusal banner.
    - HTTP status remains 200 -- the chat turn itself succeeded; only the binding side effect failed. The user can retry on the next turn with a different `contextBinding` block (resolver state is clean because `Thread.metadata` was not mutated on failure).
  - [x] 6.7 Ensure tests pass and TypeScript compiles
    - The 5 tests in 6.1 pass.
    - The 4 spec #4 Group 5 tests in `promptComposer-architecture-binding.test.ts` still pass (regression check: extending Step 5h to also handle `derived-from-context` did not change the `bound-by-system-prompt` branch).
    - The 5 spec #5 Group 4 tests in `promptComposer-derived-from-context-binding.test.ts` still pass.
    - The 1 spec #5 Group 5 test in `promptComposer-generate-architecture-diagram-swap-hint.test.ts` still passes.
    - The 5 spec #5 Group 2 tests in `derivedBindingResolver.test.ts` still pass.
    - The 2 spec #5 Group 3 tests in `saveTargetResolution-task-declarations.test.ts` still pass.
    - `npx tsc --noEmit` passes for the gateway package.
    - Pre-existing chatV2 failures unrelated to this group (`chatV2-xlsx-intercept.test.ts` 500s caused by an incomplete `xlsxUserJourneyParser` mock that does not stub `extractProcessActivitiesFromTranscript`; `chatV2-panel-integration.test.ts` / `chatV2-panel-context-and-filtering.test.ts` `availableFrom` fails noted in project memory) are NOT regressed -- verified by stash/pop and root-causing the xlsx 500 to a missing mock export, not Step 9c logic.

**Acceptance Criteria:**
- chatV2 with a valid `interface` `contextBinding` calls the resolver and persists `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` on `Thread.metadata`.
- chatV2 with a `contextBinding` that the resolver refuses returns a `bindingError: {status: 422, code, message}` on the response payload AND does NOT mutate `Thread.metadata`.
- chatV2 with a second `contextBinding` on an already-bound thread does NOT call the resolver again and preserves the original binding (re-binding refused in V1).
- Already-bound `derived-from-context` follow-up turns synthesise the binding from `Thread.metadata.boundArchitectureId` so `composeSystemPrompt` injects the `Architecture: <name> (id: <id>)` line every subsequent turn.
- First-turn (unbound) `derived-from-context` requests pass `null` for `architectureBinding` to `composeSystemPrompt` (Group 4 omits the line).
- The 5 tests in 6.1 pass; spec #4 Group 5 + spec #5 Group 2/3/4/5 tests still pass.
- `npx tsc --noEmit` passes for the gateway package.

**Caveats for Groups 7-10 (frontend wiring + invalidation banner + picker):**
- The chatV2 response now carries an optional `bindingError: {status: 422, code, message}` on the `ChatV2Response` payload. Group 9's invalidation banner (or a new inline error variant) needs to render this when present so the user understands why the LLM's `contextBinding` was refused.
- `Thread.metadata.boundArchitectureId` is the source of truth for the frontend invalidation banner. The chat hook layer (Group 9 wiring) needs to read it from the persisted thread JSON via the existing `GET /api/chat/v2/thread` endpoint AND compare it to `useActiveArchitectureId()` for the warning render.
- The `error?: string` (validation failure) and `bindingError?: ChatV2BindingError` channels are independent -- a single response can carry neither, one, or both. Group 9 should treat them as separate UI surfaces.
- `derived-from-context` is V1-restricted to `entityType: 'interface'` (only `architect--oas-spec`). Frontend wiring for any other persona/task should NOT emit a `contextBinding` block; it would be refused with `unsupported_binding_type` until a future spec extends the resolver.
- Re-binding is silently ignored at the gateway layer (warn-level log; no `bindingError` surfaced). Frontend should NOT expose a "rebind" UI in V1 -- the user must abandon the conversation and start a new one to switch entity. Group 9's "Abandon conversation" button copy already covers this affordance.

---

### Frontend Layer

#### Task Group 7: chatV2 Request-Side `architectureId` Threading for Bound-Mode Architect Tasks
**Dependencies:** Task Groups 3, 6

- [x] 7.0 Thread URL-active `architectureId` into chatV2 requests for bound-mode and derived-mode tasks
  - [x] 7.1 Tests written: `frontend/src/__tests__/chatV2-architectureId-threading.test.ts` (4 tests)
  - [x] 7.2 `frontend/src/api/chatV2Api.ts` updated to accept and forward `architectureId`
  - [x] 7.3 `frontend/src/hooks/useChatThread.ts` reads `useActiveArchitectureId()` and threads it through for bound + derived tasks; omits for clarify-at-save
  - [x] 7.4 `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` wiring updated
  - [x] 7.5 Tests pass

**Acceptance Criteria:**
- chatV2 requests for bound and derived tasks include `architectureId` in body
- chatV2 requests for clarify-at-save tasks omit `architectureId`
- Pre-existing tests not regressed

---

#### Task Group 8: `SaveTargetArchitecturePickerModal.tsx` for Clarify-at-Save Mode
**Dependencies:** Task Group 3 (declares which tasks use `clarify-at-save`)

- [x] 8.0 Build the picker modal that fires when an LLM in a `clarify-at-save`-mode task signals "ready to save"
  - [x] 8.1 Tests written: `frontend/src/components/Common/SaveTargetArchitecturePickerModal.test.tsx` (5 tests)
    - Test: renders all NON-archived architectures from `useArchitectureContext()` in oldest-first order; archived entries excluded.
    - Test: pre-selects `defaultArchitectureId`; confirm button label embeds the resolved architecture name; spec header + body copy verified.
    - Test: selecting a different architecture and clicking Save calls `onConfirm` with the NEW id (not the original default) and triggers `onClose` after success.
    - Test: in-flight state -- "Saving..." label, primary + secondary + close-X disabled until the `onConfirm` promise resolves; resolved success closes the modal.
    - Test: on `onConfirm` error the inline error renders, modal stays open, `onClose` NOT called, primary button re-enabled so the user can retry.
  - [x] 8.2 `frontend/src/components/Common/SaveTargetArchitecturePickerModal.tsx` -- new component
    - Props: `{ open, onClose, onConfirm: (architectureId) => Promise<void>, defaultArchitectureId?, taskName }`.
    - Modal shell mirrors `SaveBackConfirmModal.tsx` (overlay + portal-style fixed div, header with X close, body, footer with Cancel + primary).
    - Body: explanation sentence + labelled `<select>` listing `architectures.filter(a => !a.archived)` from `useArchitectureContext()`, oldest-first (the backend list contract is preserved by the filter). Pre-selected with `defaultArchitectureId` when present in the non-archived list; falls back to first non-archived architecture otherwise.
    - Confirm label dynamically reads `Save to <selected-name>` so the affordance stays explicit about where the output lands as the user changes the selection.
    - Esc-dismiss, click-outside-to-close, X close, Cancel -- all disabled while in-flight (mirror of `SaveBackConfirmModal`).
    - On `onConfirm` rejection: inline error rendered, modal stays open, primary re-enabled. On success: parent's `onClose` invoked.
  - [x] 8.3 `frontend/src/components/Common/SaveTargetArchitecturePickerModal.module.css` -- new stylesheet
    - Mirrors `SaveBackConfirmModal.module.css` (overlay/modal/header/content/footer/secondaryButton/primaryButton/errorMessage). Adds `.fieldLabel` and `.select` styles for the architecture picker.
  - [x] 8.4 Tests pass; pre-existing tests not regressed
    - All 5 tests in `SaveTargetArchitecturePickerModal.test.tsx` pass under `npx vitest run`.
    - `npx tsc --noEmit` does not introduce any new errors for the new files (verified by grep against the `Common/SaveTarget*` paths).

**Acceptance Criteria:**
- `SaveTargetArchitecturePickerModal` exists at `frontend/src/components/Common/SaveTargetArchitecturePickerModal.tsx` with the spec'd props.
- Picker reads architectures from `useArchitectureContext()`, filters out archived entries, preserves oldest-first order from the backend list contract.
- Pre-selected with `defaultArchitectureId` when present; falls back to oldest non-archived architecture otherwise.
- Confirm button label updates to reflect the currently selected architecture name; submit fires `onConfirm` with the chosen id.
- In-flight state shows "Saving..." and disables Cancel + Esc + X + primary; resolved success closes the modal; rejected error renders inline and keeps the modal open.
- The 5 tests in 8.1 pass; no TS regressions in the new files.

**Caveats for Group 9 (invalidation banner):**
- Group 9's invalidation banner is a SEPARATE surface from this picker. The banner fires for `bound-by-system-prompt` / `derived-from-context` modes when the URL-active architecture diverges from the thread's `boundArchitectureId`; this picker fires for `clarify-at-save` modes at save time. The two should not collide because the modes are mutually exclusive per task.
- Group 9 needs to render the chatV2 `bindingError` (`{status: 422, code, message}`) inline somewhere -- this picker does not handle that channel since `clarify-at-save` mode never goes through `derivedBindingResolver`. Keep the bindingError surface on the banner / chat panel layer.

**Caveats for Group 10 (chat panel wiring):**
- The picker owns its own architectures list fetch via `useArchitectureContext()`. The chat-panel caller only supplies the `defaultArchitectureId` (typically `useActiveArchitectureId()`) and the `taskName`. The caller does NOT need to pass the architectures array.
- `onConfirm(architectureId)` is the integration point. The chat panel wiring should: (a) suppress the picker entirely for non-`clarify-at-save` tasks; (b) on confirm, include the chosen `architectureId` in the save-tool payload (the gateway save handler validates it server-side); (c) treat the picker's resolved `Promise` as the save-completion signal so toast / panel-close follow naturally.
- The picker exposes `data-testid="save-target-arch-picker-modal"` (and `-message`, `-select`, `-confirm`, `-cancel`, `-close-x`, `-error`) for downstream chat-panel integration tests.
- Forward-only behavior (spec sec. "Forward-only -- no thread migration"): pre-spec threads with no `saveTargetResolution` declared on the task config will fall through to `clarify-at-save` -- the chat panel should default to firing the picker for those threads even if the task's declared mode would otherwise skip it. This is consumer logic (Group 10), not picker logic; the picker itself is mode-agnostic.

---

#### Task Group 9: `ConversationArchitectureInvalidationBanner.tsx` for Mid-Conversation Switch
**Dependencies:** Task Group 6 (defines `Thread.metadata.boundArchitectureId` source of truth)

- [x] 9.0 Build the warning banner that fires when the URL-active architecture diverges from the conversation's bound architecture for `bound-by-system-prompt` / `derived-from-context` modes
  - [x] 9.1 Tests written: `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.test.tsx` (4 tests)
    - Test: returns null when `useActiveArchitectureId()` matches `boundArchitectureId` (no divergence, no banner).
    - Test: renders the warning banner when active arch differs from bound; both architecture names appear in the message and in the swap-back button label.
    - Test: clicking "Swap back" calls `useArchitectureContext().setActiveArchitecture(boundArchitectureId)` exactly once with the bound id.
    - Test: clicking "Abandon conversation" calls the `onAbandon` prop and does NOT also fire the swap-back side effect.
  - [x] 9.2 `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.tsx` -- new component
    - Props: `{ boundArchitectureId: string, boundArchitectureName: string, onAbandon: () => void }`.
    - Reads `useActiveArchitectureId()` + `useArchitectureContext()` from `frontend/src/contexts/ArchitectureContext`. Looks up the active architecture's display name from `architectures` (falls back to the id, then to `'unknown'`, when the list does not yet include the active id -- e.g. stale URL or list still loading).
    - Self-suppresses (returns null) when `useActiveArchitectureId() === boundArchitectureId`. The chat panel (Group 10) keeps the banner mounted unconditionally for bound/derived modes; the no-divergence guard lives here so the panel does not need to duplicate the comparison.
    - Renders the spec-mandated copy: `This conversation is bound to architecture <bound-name> but you're currently viewing <active-name>. Switch back to continue, or abandon this conversation.`
    - Two action buttons: primary `Swap back to <bound-name>` (calls `setActiveArchitecture(boundArchitectureId)`) + secondary `Abandon conversation` (calls `onAbandon`).
    - Exposes `data-testid="conv-arch-invalidation-banner"` (and `-message`, `-swap-back`, `-abandon`) for downstream chat-panel integration tests.
  - [x] 9.3 `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.module.css` -- new stylesheet
    - Warning colour variant of the architecture pill from `frontend/src/components/TopBar/ArchitectureSelector.module.css`: amber `#fff8e1` background, dark-orange `#e65100` border / text. Inline `.archName` pill styling so the bound + active names pop out of the warning copy.
    - Primary swap-back button uses warning-orange (`#e65100`) so it harmonises with the banner without competing; secondary abandon button is muted white-on-`#d7ccc8` so it never reads as the default.
  - [x] 9.4 Tests pass; pre-existing tests not regressed
    - All 4 tests in `ConversationArchitectureInvalidationBanner.test.tsx` pass under `npx vitest run`.
    - No new TypeScript errors introduced for the new files.

**Acceptance Criteria:**
- `ConversationArchitectureInvalidationBanner` exists at `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.tsx` with the spec'd props.
- Banner reads bound vs active architecture id from props + `useActiveArchitectureId()`; self-suppresses on no-divergence so it can be mounted unconditionally by the chat panel for bound/derived modes.
- Banner copy follows the spec exactly: `This conversation is bound to architecture <bound-name> but you're currently viewing <active-name>. Switch back to continue, or abandon this conversation.`
- "Swap back" button calls `setActiveArchitecture(boundArchitectureId)`; "Abandon conversation" button calls `onAbandon`.
- Warning colour styling (amber surface, dark-orange border / text) mirrors the spec's intent of being unmistakeable without alarming.
- The 4 tests in 9.1 pass; no TS regressions in the new files.

**Caveats for Group 10 (chat panel wiring):**
- The banner is the SEPARATE surface from Group 8's picker. Mount this banner unconditionally for `bound-by-system-prompt` / `derived-from-context` mode tasks; the banner self-suppresses based on context. Mount Group 8's picker only when a `clarify-at-save`-mode LLM signals "ready to save" (the modes are mutually exclusive per task).
- The chat panel needs to read `Thread.metadata.boundArchitectureId` and `Thread.metadata.boundArchitectureName` from the thread JSON (via the existing `GET /api/chat/v2/thread` endpoint per Group 6 caveats) and thread them into this banner as `boundArchitectureId` + `boundArchitectureName` props. Pre-spec legacy threads with no binding fall through to `clarify-at-save` and should NOT mount this banner (no bound id to compare against).
- `onAbandon` semantics are owned by the chat panel: typically clear the thread state (`useChatThread().clearThread()` or equivalent) and re-route the user to a fresh conversation entry point. The banner is intentionally agnostic so the chat panel can decide.
- Save inputs in the chat panel should be disabled while the banner is rendered (i.e. when `Thread.metadata.boundArchitectureId !== useActiveArchitectureId()`). The banner does not control the input state itself -- the chat panel performs the same comparison and gates the input. Keeping the disable logic at the panel layer avoids prop-drilling input refs into the banner.
- The chatV2 `bindingError: {status: 422, code, message}` channel from Group 6 is INDEPENDENT of this banner -- the bindingError surfaces a derivedBindingResolver refusal (archived architecture / unsupported entity type / lookup failed) and should be rendered as an inline error in the chat message stream, NOT through this banner. The two channels can co-occur (e.g. user gets a bindingError on turn 3, then switches architecture on turn 4) but the surfaces stay separate.

---

#### Task Group 10: Chat Panel Wiring -- Banner + Picker + Save-Input Disable + bindingError Surface
**Dependencies:** Task Groups 6, 7, 8, 9

- [x] 10.0 Wire Group 8's picker, Group 9's banner, the chatV2 bindingError surface, and the save-input disable into `UnifiedChatPanel.tsx`
  - [x] 10.1 Tests written: `frontend/src/components/UnifiedChat/__tests__/saveTargetResolutionPanelWiring.test.tsx` (7 tests)
    - Test: invalidation banner mounts when bound-mode task has `boundArchitectureId` AND active arch differs from bound (banner appears with bound name in message).
    - Test: invalidation banner does NOT mount for `clarify-at-save` tasks (regardless of any stale bound metadata -- the picker is the affordance for clarify mode).
    - Test: save input is disabled when banner is active (`data-disabled="true"` and `data-input-disabled-reason="architecture-invalidation"`); enabled when active arch matches bound (no banner, no disable reason attribute).
    - Test: picker mounts on save-trigger for `clarify-at-save` tasks; the panel's wrapped `onConfirmArtifact` opens the modal instead of saving directly, and `confirmArtifact` is NOT yet called.
    - Test: picker does NOT mount for `bound-by-system-prompt` tasks; `confirmArtifact` is called directly with no override.
    - Test: picker confirm forwards the chosen `architectureId` through to `confirmArtifact(architectureId)` so the backend save payload carries the picker selection (the wire from picker -> hook -> postSaveArtifact).
    - Test: chatV2 `bindingError` payload renders as an inline system message in the message stream (the hook owns synthesising the message; the panel just renders the stream).
    - Mocking strategy: `vi.mock` `useChatThread` (mutable state per test), `ArchitectureContext` (stable architectures array reference -- the picker memo resets selection when the array identity changes), and the heavy child components (`ChatThread`, `ChatInputBar`) so we can assert on the props the panel threads through without rendering the full component tree.
  - [x] 10.2 Lift `Thread.metadata.boundArchitectureId` and `boundArchitectureName` into `useChatThread` state
    - On thread history load (`getThreadHistory` -> `Thread.metadata`): read the binding fields if present and seed hook state so the chat panel can mount the invalidation banner immediately on first render for already-bound conversations.
    - Reset to `null` on `clearThread()` (the abandon path) so a fresh thread does not inherit a stale binding.
    - Expose `boundArchitectureId` and `boundArchitectureName` on the hook return for the chat panel to consume.
  - [x] 10.3 Surface chatV2 `bindingError` as an inline system message
    - In `useChatThread.sendMessage`, after appending the assistant message, check `response.bindingError` (Group 6 wire). If present, append a `role: 'system'` message with code-specific copy:
      - `archived_architecture` -> `Cannot bind to archived architecture. Pick a different entity. (<gateway message>)`
      - `unsupported_binding_type` -> `This entity type is not supported in V1. (<gateway message>)`
      - `lookup_failed` -> `Failed to look up architecture for the provided entity. (<gateway message>)`
    - The synthesised message also carries `structuredResponse: { type: 'binding-error', code, status }` so future renderers can branch on it. Independent of the invalidation banner -- both surfaces can co-occur.
  - [x] 10.4 Extend `confirmArtifact` to accept an optional `targetArchitectureId` override
    - Threaded through to `postSaveArtifact` as a new optional `architectureId` argument.
    - `frontend/src/api/chatV2Api.ts` `postSaveArtifact` signature extended; the field is included in the request body only when supplied (`...(architectureId ? { architectureId } : {})`).
    - Bound / derived / project-level callers pass nothing; the field is omitted as before. The clarify-at-save picker is the only caller that supplies it in V1.
  - [x] 10.5 Wire `ConversationArchitectureInvalidationBanner` into `UnifiedChatPanel`
    - Mounted unconditionally for `bound-by-system-prompt` / `derived-from-context` tasks where `boundArchitectureId` is present on the thread metadata. The banner self-suppresses (returns null) when the active arch matches the bound arch (Group 9 contract). For pre-spec legacy threads with no `boundArchitectureId`, the banner is skipped entirely (forward-only behaviour per the spec).
    - `onAbandon` wires to `clearThread()` -- the chat panel owns the abandon semantics so the banner stays agnostic.
    - Save input disabled comparison (`isInvalidationActive`) is computed at the panel layer (same logic as the banner self-suppression) so the input gate stays in lockstep with the banner without prop-drilling refs into the banner.
  - [x] 10.6 Wire `SaveTargetArchitecturePickerModal` into `UnifiedChatPanel`
    - Mounted permanently with `open` toggled by panel state (`savePickerOpen`). The picker is mode-agnostic; mode-specific suppression lives in the wrapped `onConfirmArtifact`:
      - `clarify-at-save` -> open the picker, defer the save until the user confirms a target.
      - bound / derived / project-level -> call `confirmArtifact()` directly, no picker.
    - On picker confirm: call `confirmArtifact(architectureId)` so the chosen id propagates through to the save payload. On picker close (Cancel/Esc/X): just reset `savePickerOpen` -- no save side effect.
    - `defaultArchitectureId` defaults to `useActiveArchitectureId()` so the URL-active arch is pre-selected (the common case is one-click confirm). `taskName` is the active task id (for the explanation sentence in the picker body).

**Acceptance Criteria:**
- The 7 tests in 10.1 pass under `npx vitest run`.
- Banner mounts in `UnifiedChatPanel` for bound-mode / derived-mode tasks with a bound architecture id; does NOT mount for clarify-at-save tasks or pre-spec legacy threads.
- Chat input is disabled (`disabled` prop on `ChatInputBar`) whenever the banner is actively rendering (active arch != bound arch); re-enabled when active matches bound.
- Save-target picker fires when the user confirms an artifact for a clarify-at-save task; bound / derived / project-level tasks save directly with no picker.
- Picker confirm threads the chosen `architectureId` through `confirmArtifact -> postSaveArtifact` so the backend save payload carries the picker selection.
- `bindingError` from chatV2 response renders as an inline system message in the chat message stream with code-specific guidance.
- Group 8 + Group 9 + Group 7 spec tests still pass (no regression).
- `npx tsc --noEmit` introduces no new errors for the modified files (`UnifiedChatPanel.tsx`, `useChatThread.ts`, `chatV2Api.ts`).

**Caveats for Group 11 (test review + gap fill):**
- Pre-existing UnifiedChat tests (`uxPolish.test.tsx`, `panelPersistence.test.tsx`, `useChatThread.test.ts`, etc.) fail because their `vi.mock('../../contexts/ArchitectureContext')` only exports `useArchitecture` / `useArchitectureDispatch` and does NOT export `useActiveArchitectureId` / `useArchitectureContext` (introduced by Group 7's request-side wiring + Group 10's banner mount). These failures pre-date Group 10 and were already present after Group 7 landed. Group 11 may want to extend those mocks to add the missing exports, OR document them as pre-existing in the project memory failure inventory.
- The save-target picker is wired to fire on the artifact-confirm path (`onConfirmArtifact`). The current chat flow signals "ready to save" through the artifact-preview bubble; if a future flow introduces a different save trigger (e.g. an explicit save button in the chat header), the wrapper logic will need to be repeated there.
- The chatV2 `bindingError` surface is rendered through the existing message-stream pipeline (system-role message). If `MessageBubble` adds a code-specific renderer for `structuredResponse.type === 'binding-error'` in a future spec, the inline content message stays as the textual fallback for accessibility.
- Backend `save-artifact` handler does NOT yet consume the new `architectureId` field on the request body (Group 10 only wires the wire; backend consumption is out of scope). When the gateway/backend lands the consumer, the wire will already be in place from this group. Until then, the field is informational.
- The `ChatInputBar` `disabled` prop already gates the textarea + Send button. The Group 10 wrapper (`disabled={isLoading || isInvalidationActive}`) reuses the existing gate; no new prop or callback was introduced.
- Component imports use the lowercase on-disk casing of `chat/` and `common/` directories (Windows is case-insensitive but `tsc` is case-sensitive). New imports in `UnifiedChatPanel` follow this convention; future imports of these new modules from other panels must do the same.

---

#### Task Group 11: Test Review + Cross-Tier Gap Fill
**Dependencies:** Task Groups 1-10

- [x] 11.0 Verify all 7 critical safety properties have callable passing tests; add up to 10 strategic gap-fill tests; mechanically fix pre-existing UnifiedChat tests broken by Group 7's `useActiveArchitectureId` introduction
  - [x] 11.1 Verified all 7 safety properties map to passing tests
    - (a) `bound-by-system-prompt` for the 3 new architect tasks injects the `Architecture: <name>` line -- `promptComposer-derived-from-context-binding.test.ts` Test 3 (regression check on `architect--define-architecture`); `promptComposer-architecture-binding.test.ts` (spec #4 Group 5 regression suite covers the inject mechanism for any bound task).
    - (b) `derived-from-context` with valid interface binds the conversation, subsequent turns get the architecture line -- `chatV2-derived-binding-intercept.test.ts` Test 1 (binds + persists metadata) + Test 5 (follow-up turn synthesises binding from `Thread.metadata` and the system prompt contains the `Architecture:` line).
    - (c) `derived-from-context` with archived-architecture interface returns 422 `archived_architecture` -- `derivedBindingResolver.test.ts` Test "archived_architecture" (resolver) + `chatV2-derived-binding-intercept.test.ts` Test 2 (chatV2 surfaces the 422 bindingError without mutating thread metadata).
    - (d) `derived-from-context` with non-`interface` entityType returns 422 `unsupported_binding_type` -- `derivedBindingResolver.test.ts` Test "unsupported_binding_type" + `chatV2-derived-binding-intercept.test.ts` Test 3.
    - (e) `clarify-at-save` picker pre-filled with URL active architecture, lists non-archived oldest-first -- `SaveTargetArchitecturePickerModal.test.tsx` Tests 1 (oldest-first non-archived list) + 2 (pre-fill from `defaultArchitectureId`).
    - (f) Mid-conversation architecture switch shows invalidation banner and blocks save for bound/derived modes -- `ConversationArchitectureInvalidationBanner.test.tsx` Tests 1-4 (self-suppression + render + swap-back + abandon) + `saveTargetResolutionPanelWiring.test.tsx` Tests 1 + 3 (panel mounts banner, save input disabled).
    - (g) `architect--generate-architecture-diagram` system prompt contains the swap-architecture hint with the architecture name -- `promptComposer-generate-architecture-diagram-swap-hint.test.ts` Test 1.
  - [x] 11.2 Wrote 6 strategic gap-fill tests (max 10 allowed)
    - `frontend/src/__tests__/postSaveArtifact-architectureId-wire.test.ts` (2 tests): verifies the picker -> hook -> postSaveArtifact wire so the chosen `architectureId` lands in the JSON request body when supplied AND is omitted when not (paired regression for backward compat). Group 10 only asserted up to `confirmArtifact(archId)`; this fills the API-boundary gap.
    - `frontend/src/hooks/useChatThread-binding-and-metadata.test.ts` (4 tests): (a) hook synthesises code-specific inline system messages for each of the 3 `bindingError` codes (`archived_architecture`, `unsupported_binding_type`, `lookup_failed`) with a `binding-error` `structuredResponse` so future renderers can branch; (b) hook lifts `Thread.metadata.boundArchitectureId` and `boundArchitectureName` into hook state on history load so the chat panel can mount the invalidation banner immediately on first render. Group 10 mocked the hook return directly so the upstream metadata read was never asserted.
  - [x] 11.3 Mechanical update of 5 pre-existing tests broken by Group 7's `useActiveArchitectureId` introduction
    - Extended `vi.mock('../../../contexts/ArchitectureContext')` in `frontend/src/components/UnifiedChat/__tests__/uxPolish.test.tsx`, `panelPersistence.test.tsx`, `containerIntegration.test.tsx`, `unifiedChatPanel-inline-layout.test.tsx` to also stub `useActiveArchitectureId` (returns null) and `useArchitectureContext` (returns empty architectures + no-op `setActiveArchitecture`).
    - Added a brand-new `vi.mock('../contexts/ArchitectureContext')` block to `frontend/src/hooks/useChatThread.test.ts` (this file had no ArchitectureContext mock at all, so all 6 tests threw 'must be used within an ArchitectureProvider').
    - Result: `useChatThread.test.ts` 6/6 fixed (now passing); `uxPolish.test.tsx` 5 newly passing (was 14 fail / 10 pass; now 9 fail / 15 pass). The remaining failures in the other three files are pre-existing router-context (`useNavigate() may be used only in the context of a <Router> component`) and unrelated to this spec -- they predate Spec #5 entirely and are listed in the spec's out-of-scope failure inventory.
  - [x] 11.4 Ran feature-specific tests only; no full app suite
    - Gateway: 5 spec test files, 18 tests, all passing (`saveTargetResolution-task-declarations.test.ts`, `derivedBindingResolver.test.ts`, `promptComposer-derived-from-context-binding.test.ts`, `promptComposer-generate-architecture-diagram-swap-hint.test.ts`, `chatV2-derived-binding-intercept.test.ts`).
    - Frontend: 7 spec test files, 32 tests, all passing (`chatV2-architectureId-threading.test.ts`, `SaveTargetArchitecturePickerModal.test.tsx`, `ConversationArchitectureInvalidationBanner.test.tsx`, `saveTargetResolutionPanelWiring.test.tsx`, `postSaveArtifact-architectureId-wire.test.ts` [new], `useChatThread-binding-and-metadata.test.ts` [new], `useChatThread.test.ts` [mechanically fixed]).
    - Backend (`architecture-model-service`): 1 spec test file with 4 tests (`BindingLookupControllerTest.java`) -- carried green from Group 1 closure (not re-run in Group 11; pre-existing backend test compile blockers per project memory remain unchanged).

**Acceptance Criteria:**
- All 7 safety properties (a)-(g) map to at least one callable passing test (mapping documented in 11.1).
- 6 new strategic gap-fill tests added (under the 10-test cap); all passing.
- 5 pre-existing test files mechanically fixed; remaining failures in those files are pre-existing router-context issues unrelated to this spec.
- Spec test totals: 18 gateway + 32 frontend + 4 backend (carried) = 54 tests, all passing.
- Pre-existing failures explicitly out of scope (per task brief) are NOT regressed.
