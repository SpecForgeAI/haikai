# Specification: LLM Persona/Task Save-Target Resolution (Spec #5)

## Goal
Extend `saveTargetResolution` from spec #4's Discovery-only `bound-by-system-prompt` foundation to all six remaining architect + UX architecture-scoped tasks across three modes — `bound-by-system-prompt` (extended), `derived-from-context` (new, interfaces-only V1), and `clarify-at-save` (new, picker modal at save time) — so every architecture-scoped write lands in the correct architecture without surprise.

## User Stories
- As an architect, I want a conversation that produces a diagram or detailed model to be locked to my URL-active architecture from the first message so that I never accidentally write target-state output into the current-state architecture.
- As an architect drafting an OAS spec for an interface, I want the conversation to figure out the target architecture from the interface I'm working on so that I don't have to pick it twice (once when I named the interface, again at save).
- As a UX designer about to save a user-interaction or UI-domain artefact, I want a picker modal at the save moment pre-filled with my URL-active architecture so that I can override it without restarting the conversation.

## Specific Requirements

**Three save-target resolution modes (one shipped, two new)**
- `bound-by-system-prompt` (shipped, spec #4): `architectureId` resolved at thread open from URL active architecture; `composeSystemPrompt` injects `Architecture: <name> (id: <id>)` line; LLM treats it as authoritative.
- `derived-from-context` (NEW): `architectureId` not known at thread open; LLM identifies a target entity early in conversation via a `contextBinding` block; backend resolver looks up `entity.architectureId` and binds the conversation; from then on behaves like bound.
- `clarify-at-save` (NEW): `architectureId` not chosen until the LLM signals "ready to save"; frontend picker modal pops up pre-filled with URL active, lists all non-archived architectures, user confirms final target.

**Mode-to-task assignments (locked)**
- `architect--define-architecture` → `bound-by-system-prompt`.
- `architect--detailed-data-model` → `bound-by-system-prompt`.
- `architect--generate-architecture-diagram` → `bound-by-system-prompt`; system prompt additionally instructs the LLM to surface `"we are generating a diagram from architecture <name> — swap architecture if you want to generate from a different one."`.
- `architect--oas-spec` → `derived-from-context` (entity type: `interface`).
- `ux-designer--users-interactions` → `clarify-at-save`.
- `ux-designer--ui-domain` → `clarify-at-save`.
- Each task's JSON declaration in `gateway/src/config/tasks/` carries the matching `saveTargetResolution` value; task-level value wins over persona-level (existing rule from spec #4 Group 5).

**`derived-from-context` V1 scope — interfaces only**
- New `derivedBindingResolver` accepts only `entityType: 'interface'`; any other type returns 422 `{code: "unsupported_binding_type"}`.
- Rationale: only `architect--oas-spec` uses this mode in V1 and OAS specs only target interfaces (YAGNI for other entity types).
- Backend `composeSystemPrompt` omits the architecture line when the task's effective resolution is `derived-from-context` AND no binding has been established for the thread yet (the LLM operates in "I need to identify the entity first" mode); after the resolver fires successfully, subsequent turns inject the architecture line as for bound mode.
- LLM-emitted block shape: `{ contextBinding: { entityType: "interface", entityId: "<uuid>" } }` intercepted by the chatV2 response handler; resolver then persists `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` on the thread metadata.

**Mid-conversation architecture switch invalidates bound + derived conversations**
- Frontend invalidation banner mounted near the chat input compares thread metadata `boundArchitectureId` with `useActiveArchitectureId()`; when they differ AND the active task's effective resolution is `bound-by-system-prompt` or `derived-from-context`, the banner renders.
- Banner copy: `This conversation is bound to architecture <bound-name> but you're currently viewing <active-name>. Switch back to continue, or abandon this conversation.`
- Two action buttons: `Swap back to <bound-name>` (calls `setActiveArchitecture(bound-id)`) and `Abandon conversation` (clears the thread state).
- Save inputs/buttons disabled while the banner is active; thread state is preserved so the user can swap architecture back to resume.

**Re-binding within `derived-from-context` not allowed in V1**
- Once the resolver has bound the conversation, the `boundArchitectureId` is fixed for the conversation's lifetime.
- Subsequent `contextBinding` blocks from the LLM for a different entity are ignored at the chatV2 handler layer (no second resolver call).
- To work on a different interface in a different architecture, the user starts a new conversation. (V2 may revisit re-binding flexibility.)

**Archived architecture refuses entry**
- If `derivedBindingResolver` lookup yields an entity in an archived architecture, resolver returns 422 `{code: "archived_architecture", message: "Cannot bind to archived architecture: <name>"}`.
- The chatV2 handler surfaces the 422 to the LLM as a tool-failure-style message; the LLM communicates the refusal to the user; user must pick a different entity.
- Thread is not bound (no metadata persisted); user may try again with a different `contextBinding` block.

**`clarify-at-save` picker modal**
- New component (e.g. `frontend/src/components/Common/SaveTargetArchitecturePickerModal.tsx`) mirroring `SaveBackConfirmModal.tsx` shell from spec #4: portal overlay, header, body with select, footer with Cancel + primary confirm; click-outside-to-close, Esc-dismiss, primary disabled while in flight.
- Pre-filled with URL active architecture from `useActiveArchitectureId()`; lists all `architectures.filter(a => !a.archived)` from `ArchitectureContext`, oldest first (matches spec #1 / spec #2 ordering rule).
- Fires when the LLM signals "ready to save" via the existing save-tool invocation point for `clarify-at-save`-mode tasks; on confirm, the chosen `architectureId` is included in the save payload.

**`architect--generate-architecture-diagram` swap-architecture hint**
- Task prompt file (`gateway/src/config/prompts/architect.generate-architecture-diagram.task.md`) extended in its opening paragraph with the swap hint instruction so the LLM proactively says: `"we are generating a diagram from architecture <name> — swap architecture if you want to generate from a different one."`
- Architecture name comes from the bound-mode injected `Architecture: <name>` line (substitution mechanism is implementer's call: either `{architectureName}` template substitution at composition time, or LLM literally reads and parrots the injected line).

**Forward-only — no thread migration**
- Existing in-flight conversations (started before this spec) carry no `boundArchitectureId` in metadata.
- Such conversations behave as `clarify-at-save` for any architecture-scoped save regardless of the task's declared mode (the picker fires at save time).
- New conversations opened against the affected tasks after this spec ships use the declared mode immediately.
- This matches spec #4 Group 5's same forward-only pattern (no migration of LLM thread storage).

**Backend wiring — resolver + handler + lookup endpoint**
- New `gateway/src/services/derivedBindingResolver.ts` module: `resolve(projectId, entityType, entityId) → {architectureId, architectureName, archived}` (V1 interface-only; 422 otherwise).
- Resolver delegates to a new `architectureModelClient.lookupInterfaceArchitecture(projectId, interfaceId)` helper.
- New `architecture-model-service` endpoint (extend `ModelInterfacesController` or add a `BindingLookupController`): `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding` returning `{architectureId, architectureName, archived}` or 404 on missing interface.
- chatV2 response handler in `gateway/src/routes/chatV2.ts` intercepts the `contextBinding` block, calls the resolver, persists `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` to `Thread.metadata`, and surfaces 422 errors back to the LLM.

**Frontend wiring — request body, banner, picker**
- `frontend/src/api/chatV2Api.ts` (or call sites of architect tasks) populates `request.architectureId` from URL active when the active task's effective resolution is `bound-by-system-prompt` (extending spec #4's Discovery-only wiring to the three new architect tasks).
- New invalidation banner component (e.g. `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.tsx`) wired into the chat panel; reads thread metadata + `useActiveArchitectureId()`; renders only when bound/derived mode AND ids differ.
- New picker modal component wired into the save flow for `clarify-at-save` tasks; fires at the existing save-tool invocation point.

**Test strategy**
- Vitest tests (frontend): bound-mode injects architecture line for the 3 architect tasks; clarify-at-save picker pre-fills with URL active and lists non-archived; mid-conversation switch shows banner and disables save inputs for bound/derived modes.
- Vitest/Jest tests (gateway): `derivedBindingResolver` happy path with valid interface; 422 for non-`interface` `entityType`; 422 for archived architecture; chatV2 handler intercepts `contextBinding` and persists to thread metadata; `composeSystemPrompt` omits architecture line for `derived-from-context` until bound, injects after bound; `architect--generate-architecture-diagram` system prompt contains swap-architecture hint with the architecture name.
- Backend integration tests (`architecture-model-service`): new lookup endpoint returns 200 with binding payload, 404 on missing interface, includes `archived` flag for archived architectures.

## Existing Code to Leverage

**Spec #4 Group 5's `composeSystemPrompt` `bound-by-system-prompt` plumbing (`gateway/src/services/promptComposer.ts`)**
- Already handles task-level vs persona-level `saveTargetResolution` with task-level wins; injects `Architecture: <name> (id: <id>)` line.
- Extend in place to handle `derived-from-context` (omit until bound; inject after); do not duplicate the resolution logic.
- `ArchitectureBinding` context type (lines 25-29) is the contract for the inject; reuse for both bound and derived modes.

**Spec #4 Group 5's task JSON declarations (`architect--discovery-framing.json`, `architect--discovery-qa.json`)**
- Both already carry `"saveTargetResolution": "bound-by-system-prompt"` at the top level.
- Mirror the same field-level addition on the six task JSONs in scope here.
- Type `PersonaDefinition.saveTargetResolution` and `TaskDefinition.saveTargetResolution` in `gateway/src/types/chatV2.ts` already exist; extend the union to include `'derived-from-context'`.

**Spec #4 Group 5's chatV2 `request.architectureId` plumbing (`gateway/src/routes/chatV2.ts` ~line 3849)**
- Existing branch already resolves architecture binding for `bound-by-system-prompt`.
- Add a sibling branch for `derived-from-context`: intercept `contextBinding`, call resolver, persist to thread metadata, then re-enter bound-mode injection on subsequent turns.

**Spec #4's `SaveBackConfirmModal.tsx` (`frontend/src/components/Discovery/SaveBackConfirmModal.tsx`)**
- Modal shell: portal overlay, header, body, footer with Cancel + primary confirm; Esc-dismiss; click-outside-to-close; primary disabled while in flight.
- New `SaveTargetArchitecturePickerModal` mirrors this shell exactly, swapping the body for an oldest-first non-archived `<select>` pre-filled with the URL active id.

**Spec #2's `ArchitectureContext` + `useActiveArchitectureId()` + `ArchitectureSelector` pill styling**
- Picker reads `architectures` and `useActiveArchitectureId()` from context — same pattern as spec #4's `ArchitectureRunTargetPicker`.
- Invalidation banner reuses pill/chip styling (warning colour variant) for the bound-name display.
- `setActiveArchitecture(id)` is the existing API the banner's `Swap back` button calls.

**`Thread.metadata` field (existing `metadata?: Record<string, unknown>` on threads)**
- No storage layout change: bound architecture fields live alongside other thread metadata; thread storage path stays `{projectParentFolder}/threads/{type}/thread.json` per project memory.
- Add typed shape `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}` in `gateway/src/types/chatV2.ts` for the binding fields.

## Out of Scope
- PM, TE, and Assistant tasks (project-level writes only — mission, roadmap, backlog, tech-stack docs, test-strategy — never architecture-scoped).
- Advisory architect tasks (`architect--service-breakdown`, `architect--tech-standards`) — to be revisited after this multi-arch initiative completes.
- `architect--define-tech-stack` (saves project-level `TECH-STACK.md`, not architecture-scoped).
- Already-shipped Discovery tasks (`architect--discovery-framing`, `architect--discovery-qa`) — bound-by-system-prompt already wired in spec #4 Group 5; this spec must not regress them.
- Other entity types for `derived-from-context` (service, entity, application, app_component) — V1 is interfaces only; future tasks will add their own types.
- Re-binding flexibility within `derived-from-context` once a thread is bound — V2 feature.
- Archived-entity unarchive flow (no UI yet, deferred from spec #3).
- Comparison / diffing UI between architectures — deferred to spec #6 / #7 / future.
- Full clone (duplicate architecture A into new B) → spec #6.
- Selective cross-architecture copy → spec #7.
- Migration of in-flight (pre-spec) LLM threads to declare a bound architecture — forward-only by design (those threads behave as `clarify-at-save` until the user starts a new conversation).
