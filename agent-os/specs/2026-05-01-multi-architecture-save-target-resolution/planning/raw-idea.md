This is spec #5 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing.

**Predecessors (shipped):**
- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — plumbing.
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — URL routing + selector.
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` — CRUD + tags.
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/` — Discovery integration. **Group 5 of spec #4 already added `saveTargetResolution` field to `PersonaDefinition` + `TaskDefinition` and implemented `bound-by-system-prompt` mode with system-prompt injection in `composeSystemPrompt`.** This spec extends to non-Discovery tasks AND adds the two new modes.

This spec implements **save-target resolution for the 6 non-Discovery architect+UX tasks that write architecture-scoped meta-model data**. Three modes total — one already shipped (bound), two are new.

**Three save-target modes:**

| Mode | Mechanism | Tasks |
|---|---|---|
| **bound-by-system-prompt** | architectureId = URL active at thread open; injected into system prompt; cannot change mid-conversation | `architect--define-architecture`, `architect--detailed-data-model`, `architect--generate-architecture-diagram` (Discovery 2 already shipped) |
| **derived-from-context** *(new)* | LLM identifies target entity early in conversation → backend looks up `entity.architectureId` → binds conversation → from then on behaves like bound | `architect--oas-spec` |
| **clarify-at-save** *(new)* | Structured picker UI pops up at save moment, pre-filled with URL active, user picks final target | `ux-designer--users-interactions`, `ux-designer--ui-domain` |

**Locked behavioural rules:**
- **Mid-conversation architecture switch invalidates the conversation** for bound + derived modes. UI shows warning/block. User must swap architecture back or abandon and restart.
- **Re-binding within derived-from-context is not allowed in V1.** Once LLM has identified the entity and bound the conversation, architectureId is fixed.
- **Archived architecture refuses entry.** If derived-from-context entity lookup yields an archived architecture → reject; user must pick different entity.
- **`architect--generate-architecture-diagram` system prompt** explicitly tells the LLM to say *"we are generating a diagram from architecture **[name]** — swap architecture if you want to generate from a different one."*

**No changes to:**
- PM, TE, Assistant tasks (project-level only).
- Advisory architect tasks (`architect--service-breakdown`, `architect--tech-standards`) — to be revisited after this multi-arch work.
- `architect--define-tech-stack` (project-level doc, TECH-STACK.md).
- Already-shipped Discovery tasks (`architect--discovery-framing`, `architect--discovery-qa`).

**Implementation pieces:**

1. **Frontend save-picker modal** for `clarify-at-save` mode (mirror `SaveBackConfirmModal.tsx` from spec #4). Pre-filled with URL active architecture. Lists all non-archived. Pops up at save moment.
2. **Frontend invalidation banner/block** when mid-conversation architecture switch occurs for bound/derived tasks. Compares the conversation's bound `architectureId` vs URL's active id; if different, blocks save and shows banner.
3. **Frontend chatV2 request body** sends URL-active architectureId for bound non-Discovery tasks (already wired for Discovery via spec #4).
4. **Backend `composeSystemPrompt`** extends to handle `derived-from-context` — accepts an "I'm not bound yet" early state where the architectureId line is omitted until binding occurs.
5. **Backend chatV2 response handler** intercepts a `contextBinding` block from the LLM (entity type + id); calls a new `derivedBindingResolver` that looks up `architecture-model-service` for the entity's architectureId; **refuses if archived**; persists binding on the thread.
6. **Backend declares `saveTargetResolution`** on the 6 task JSON files: `architect--define-architecture.json`, `architect--detailed-data-model.json`, `architect--generate-architecture-diagram.json` (all `bound-by-system-prompt`); `architect--oas-spec.json` (`derived-from-context`); `ux-designer--users-interactions.json`, `ux-designer--ui-domain.json` (both `clarify-at-save`).
7. **Backend `architect--generate-architecture-diagram` task prompt** updated with the swap-architecture hint.
8. **Tests** for: bound-mode picker UX, derived-from-context bind/refuse-archived, mid-conversation invalidation, clarify-at-save picker, and the swap-architecture hint.

**Key constraints:**
- Functionally additive — must not regress spec #4's bound-by-system-prompt for Discovery, or any other existing behaviour.
- The `derived-from-context` mechanism must work for entity types that map to a single architecture (interfaces have one architecture; entities have one; etc.).
- Threads stay project-scoped (per spec #1's locked decision); the bound architectureId is a per-thread runtime attribute, not a thread-storage scoping change.
- No edits to applied Liquibase changesets (per project memory).
