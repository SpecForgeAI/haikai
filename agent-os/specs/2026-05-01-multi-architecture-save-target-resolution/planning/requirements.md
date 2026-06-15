# Spec #5 Requirements — LLM Persona/Task Save-Target Resolution

**Spec folder:** `agent-os/specs/2026-05-01-multi-architecture-save-target-resolution/`
**Design note:** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessors (shipped):**
- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/`
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/`
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/`
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/` — Group 5 already added `saveTargetResolution` field to `PersonaDefinition` + `TaskDefinition` and implemented `bound-by-system-prompt` mode with system-prompt injection in `composeSystemPrompt`. **This spec extends to non-Discovery tasks AND adds the two new modes.**
**Raw idea:** `planning/raw-idea.md`

---

## Context

This spec implements **save-target resolution for the 6 non-Discovery architect+UX tasks** that write architecture-scoped meta-model data. Three modes total — one already shipped (bound-by-system-prompt), two new.

Per the design note's locked-in-this-conversation analysis (see `planning/raw-idea.md`), all PM/TE/Assistant tasks save project-level data (mission, roadmap, backlog, tech-stack docs, test-strategy) and are not architecture-scoped — out of scope.

---

## Resolved Decisions

### 1. Three save-target modes — one already shipped, two new

| Mode | Mechanism | Status |
|---|---|---|
| **bound-by-system-prompt** | architectureId determined before conversation starts; injected into system prompt at thread open via `composeSystemPrompt` | Shipped in spec #4 Group 5; this spec extends to non-Discovery tasks |
| **derived-from-context** *(NEW)* | architectureId not known at conversation start; LLM identifies target entity early in conversation → backend looks up `entity.architectureId` → binds the conversation → from then on behaves like bound | New in this spec |
| **clarify-at-save** *(NEW)* | architectureId not chosen until save moment; structured picker UI pops up, pre-filled with URL active architecture, user picks final target | New in this spec |

### 2. Mode-to-task assignments (locked)

| Task | Persona | Mode | Architecture source |
|---|---|---|---|
| `architect--define-architecture` | Architect | **bound-by-system-prompt** | URL active architecture at thread open |
| `architect--detailed-data-model` | Architect | **bound-by-system-prompt** | URL active architecture at thread open |
| `architect--generate-architecture-diagram` | Architect | **bound-by-system-prompt** | URL active architecture at thread open. **System prompt explicitly tells LLM to say *"we are generating a diagram from architecture **[name]** — swap architecture if you want to generate from a different one."*** |
| `architect--oas-spec` | Architect | **derived-from-context** | Looked up from the **interface** entity the LLM identifies early in the conversation |
| `ux-designer--users-interactions` | UX Designer | **clarify-at-save** | URL active (default), user can override at save picker |
| `ux-designer--ui-domain` | UX Designer | **clarify-at-save** | URL active (default), user can override at save picker |

### 3. `derived-from-context` V1 scope — interfaces only

The new `derivedBindingResolver` in V1 accepts only `entityType: 'interface'` and returns 422 (`{code: "unsupported_binding_type"}`) for any other type. Reasoning: only `architect--oas-spec` uses this mode, and OAS specs only target interfaces. Future tasks needing derived binding will add their own entity types as needed (YAGNI).

### 4. Locked behavioural rules

- **Mid-conversation architecture switch invalidates the conversation** for `bound-by-system-prompt` and `derived-from-context` modes. UI shows a clear warning banner ("This conversation is bound to architecture **<bound-name>** but you're currently viewing **<active-name>**. Switch back to continue, or abandon this conversation."). Save actions are **blocked** while invalidated. The thread is preserved — user can swap architecture back to resume.
- **Re-binding within `derived-from-context` is not allowed in V1.** Once the LLM has identified the entity and the conversation is bound, the architectureId is fixed for the conversation's life. To work on a different entity in a different architecture, start a new conversation.
- **Archived architecture refuses entry.** If `derivedBindingResolver` lookup yields an entity in an archived architecture → resolver returns 422 (`{code: "archived_architecture"}`). The LLM surfaces the refusal to the user; user must pick a different entity.
- **`clarify-at-save` save picker** is a structured modal pre-filled with URL active architecture, listing all non-archived architectures (oldest first per spec #1's ordering rule). Mirror `frontend/src/components/Discovery/SaveBackConfirmModal.tsx`.

### 5. Out of scope (deferred or n/a)

- **PM, TE, Assistant tasks** — all project-level, no architecture-scoped writes.
- **Advisory architect tasks** (`architect--service-breakdown`, `architect--tech-standards`) — to be revisited after this multi-arch work completes.
- **`architect--define-tech-stack`** — saves project-level TECH-STACK.md doc.
- **Already-shipped Discovery tasks** (`architect--discovery-framing`, `architect--discovery-qa`) — bound-by-system-prompt already wired in spec #4.
- **Other entity types for `derived-from-context`** (service, entity, application, app_component) — V1 is interfaces only.
- **Re-binding flexibility within `derived-from-context`** — V2 feature.
- **Archived-entity unarchive flow** — no UI yet (deferred from spec #3).
- **Comparison / clone / selective copy** → specs #6/#7.

---

## Implementation Decisions (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 6 | **Frontend save-picker modal** for `clarify-at-save`: new component `frontend/src/components/Common/SaveTargetArchitecturePickerModal.tsx` (or co-located with the chat panel — implementer's call). Mirrors `SaveBackConfirmModal.tsx` shell exactly. Pre-filled with URL active architecture; lists all non-archived; user confirms. The picker fires when a `clarify-at-save`-mode task's LLM signals "ready to save" (existing save-tool invocation point). | Reuse spec #4's pattern. |
| 7 | **Frontend invalidation banner**: new component `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.tsx` (or co-located). Mounted near the chat input. Reads thread's bound `architectureId` from thread metadata + `useActiveArchitectureId()`. When they differ AND mode is `bound`/`derived`, renders a warning banner with two buttons: "Swap back to <bound-name>" (calls `setActiveArchitecture(bound-name)`) and "Abandon conversation" (clears the thread). Save inputs disabled while banner active. | Standard React pattern. |
| 8 | **Frontend chatV2 request body** sends URL-active `architectureId` when the active task's effective `saveTargetResolution` is `bound-by-system-prompt`. The `request.architectureId` field is already declared on `ChatV2Request` (added in spec #4 Group 5) — extend the call sites of the architect tasks beyond Discovery to populate it. | Reuse spec #4's plumbing. |
| 9 | **Backend `composeSystemPrompt`** extends to handle `derived-from-context`: when task's effective resolution is `derived-from-context` AND no binding has been established for this thread yet, the architecture line is omitted (the LLM operates in "I need to identify the entity first" mode). When the binding has been established (resolver fired previously), the architecture line is injected as for bound mode. | Single function handles all three modes. |
| 10 | **Backend chatV2 response handler** intercepts a `contextBinding` block from the LLM's structured response. Block shape: `{ contextBinding: { entityType: "interface", entityId: "<uuid>" } }`. Handler calls `derivedBindingResolver.resolve(projectId, entityType, entityId)` → returns `{architectureId, architectureName, archived}`. If `archived === true` → returns 422 `{code: "archived_architecture", message: "Cannot bind to archived architecture: <name>"}`. If `architectureId` resolves cleanly → persist binding on thread metadata as `{boundArchitectureId, boundArchitectureName, boundEntityType, boundEntityId}`. | Atomic resolution + binding. |
| 11 | **Backend `derivedBindingResolver`**: new module at `gateway/src/services/derivedBindingResolver.ts`. V1 accepts only `entityType === 'interface'`; for any other type returns 422 `{code: "unsupported_binding_type"}`. Calls `architectureModelClient.lookupInterfaceArchitecture(projectId, interfaceId)` (new helper). | Narrow V1; YAGNI for other types. |
| 12 | **Backend `architectureModelClient.ts`** extension: new helper `lookupInterfaceArchitecture(projectId, interfaceId): Promise<{architectureId, architectureName, archived}>`. Implementation: hit a new architecture-model-service endpoint `GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding` (or similar — name TBD by implementer). Returns the architecture id + name + archived flag. | Single-purpose helper. |
| 13 | **Backend `architecture-model-service` endpoint** for interface→architecture lookup: extend `ModelInterfacesController` (already global per spec #1's controller bucketing) OR add a new `BindingLookupController` if `ModelInterfacesController` is the wrong home. Returns `{architectureId, architectureName, archived}` for the given interface, or 404 if interface not found. | Standard controller addition. |
| 14 | **Thread metadata persistence**: bound `architectureId` (and supporting fields) live on `Thread.metadata` (existing `metadata?: Record<string, unknown>` field). Thread storage layout unchanged (still `{projectParentFolder}/threads/{type}/thread.json` per project memory). | Forward-only; no thread migration needed. |
| 15 | **Task JSON declarations**: declare `saveTargetResolution` on each of the 6 task files. `architect--define-architecture.json`, `architect--detailed-data-model.json`, `architect--generate-architecture-diagram.json` → `bound-by-system-prompt`. `architect--oas-spec.json` → `derived-from-context`. `ux-designer--users-interactions.json`, `ux-designer--ui-domain.json` → `clarify-at-save`. | Per-task config (per spec #4's pattern). |
| 16 | **`architect--generate-architecture-diagram` task prompt**: extend the prompt file (`gateway/src/config/prompts/architect.generate-architecture-diagram.task.md` or similar) with the swap-architecture hint in its opening paragraph. The hint uses the architecture name placeholder that the bound mode injection will fill in (`{architectureName}` substituted at composition time, OR have the LLM literally read the injected `Architecture: <name>` line and parrot it). | Implementer's call on substitution mechanism. |
| 17 | **Forward-only — no thread migration**. Existing in-flight conversations (started before this spec) have no `boundArchitectureId` in metadata. They behave as if `clarify-at-save` regardless of task — the picker fires on save. (This avoids a migration step for in-flight work.) Documented in the spec's "Migration" section. | Forward-only matches spec #4 Group 5's same pattern. |
| 18 | **Test strategy:** Vitest tests covering: (a) bound mode for the 3 architect tasks injects the architecture line; (b) derived-from-context with valid interface binds and injects on subsequent turn; (c) derived-from-context with archived-architecture interface returns 422; (d) derived-from-context with non-`interface` entityType returns 422; (e) clarify-at-save picker pre-fills with URL active and lists non-archived; (f) mid-conversation architecture switch shows invalidation banner and blocks save for bound/derived modes; (g) `architect--generate-architecture-diagram` system prompt contains swap-architecture hint with the architecture name. Backend integration tests for the new lookup endpoint and resolver. | Standard. |

---

## Critical Files (anticipated)

**Backend (`architecture-model-service`):**
- `src/main/java/com/example/architecturemodel/controller/ModelInterfacesController.java` (or new `BindingLookupController`) — modify/new — interface→architecture lookup endpoint.
- `src/main/java/com/example/architecturemodel/service/...` — service method to look up interface and return `{architectureId, architectureName, archived}`.
- New tests for the lookup endpoint.

**Backend (`gateway`):**
- `gateway/src/services/derivedBindingResolver.ts` (new) — V1 supports `entityType: 'interface'` only.
- `gateway/src/services/architectureModelClient.ts` (modify) — add `lookupInterfaceArchitecture(projectId, interfaceId)` helper.
- `gateway/src/services/promptComposer.ts` (modify) — handle `derived-from-context` mode (omit line until binding; inject after binding).
- `gateway/src/routes/chatV2.ts` (modify) — intercept `contextBinding` block from LLM response; call resolver; persist binding to thread metadata; surface 422 errors.
- `gateway/src/types/chatV2.ts` (modify) — `Thread.metadata` typing for binding fields (`boundArchitectureId`, `boundArchitectureName`, `boundEntityType`, `boundEntityId`).
- `gateway/src/config/tasks/architect--define-architecture.json` (modify) — add `"saveTargetResolution": "bound-by-system-prompt"`.
- `gateway/src/config/tasks/architect--detailed-data-model.json` (modify) — same.
- `gateway/src/config/tasks/architect--generate-architecture-diagram.json` (modify) — same.
- `gateway/src/config/tasks/architect--oas-spec.json` (modify) — `"saveTargetResolution": "derived-from-context"`.
- `gateway/src/config/tasks/ux-designer--users-interactions.json` (modify) — `"saveTargetResolution": "clarify-at-save"`.
- `gateway/src/config/tasks/ux-designer--ui-domain.json` (modify) — same.
- `gateway/src/config/prompts/architect.generate-architecture-diagram.task.md` (modify) — add swap-architecture hint.
- New tests in `gateway/src/__tests__/` for resolver, prompt composer, chatV2 binding intercept.

**Frontend:**
- `frontend/src/components/Common/SaveTargetArchitecturePickerModal.tsx` (new) — clarify-at-save picker. Mirror `SaveBackConfirmModal.tsx`.
- `frontend/src/components/Common/SaveTargetArchitecturePickerModal.module.css` (new).
- `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.tsx` (new) — invalidation banner for bound/derived modes.
- `frontend/src/components/Chat/ConversationArchitectureInvalidationBanner.module.css` (new).
- `frontend/src/components/<chat panel>/...` (modify) — wire the picker into save flow for clarify-at-save tasks; wire the banner into the chat panel for bound/derived tasks.
- `frontend/src/api/chatV2Api.ts` (or wherever chatV2 requests are sent — modify) — populate `architectureId` from URL active when active task is `bound-by-system-prompt`.
- New Vitest tests under `frontend/src/__tests__/` for picker, banner, and chat-panel wiring.

---

## Visual Assets

None provided. Modal mirrors `SaveBackConfirmModal.tsx` (spec #4); invalidation banner mirrors `ArchitectureSelector.tsx` pill styling with a warning colour variant.
