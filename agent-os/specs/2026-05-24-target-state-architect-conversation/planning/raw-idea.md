# Raw Idea: Target State Architect-Persona Conversation

## Why this spec exists

Spec 1 shipped the deterministic Suggest that produces a structural 1:1 clone of current state with equivalence mappings. Spec 2 shipped the captured-decisions data plane that lets any future task write decisions and any future LLM prompt read them. **This spec is where the user value lands** — a multi-turn LLM-driven architect-persona conversation that asks the user the ~50 questions across 10 concern groups that turn a technology-naive cloned target into one shaped by intentional, captured, evidence-cited technology decisions.

After this spec ships, the migration workflow looks like this end-to-end:

1. User runs Suggest (Spec 1) — gets a 1:1 cloned target with equivalence mappings.
2. User opens the Target State sub-tab (Spec 1) and starts the **architect conversation** (this spec).
3. Conversation pre-fills "no change from current" defaults across all ~50 questions, then walks the user through the headline groups (service runtime, API surface, data persistence) and surfaces the rest as a structured checklist.
4. Every answered question writes a captured decision (Spec 2's table) AND mutates the target meta-model in a contained way (rewrites mapping rows, decorates mapping notes with the `[decision:<code>]` tag, possibly upserts target-side rows when technology change requires architectural shape changes).
5. Standards registry lookups surface defaults for the chosen target stack (Java 21 → JUnit 5, Spring Boot 3.4 → Bean Validation, Postgres 18 → Flyway, etc).
6. Conversation closes with a "Target State Decisions" summary attached to the target draft.
7. Spec 4 (next) updates the PM book-of-work + shape-spec prompts to consume those decisions as facts, so downstream stories cite decision codes.

Without this spec, Spec 2's table stays empty in every environment. The captured-decisions resolver always returns "no decisions captured yet." Downstream PM tasks produce technology-naive output. The user's "functional like-for-like migration" stays partially specified — functional yes, but with no captured story of what's changing on the implementation side.

## What this spec is (and isn't)

**This spec is:**
- A multi-turn LLM-driven conversation task running inside the gateway, modelled on the existing `api-migration-validation-service` tool-call loop pattern (closest precedent).
- A **question library** of ~50 decision codes across 10 concern groups (A–J), each with prompt text, default-when-unchanged logic, and a `standards_lookup_ref` mechanism.
- A **decision capture** flow that writes one `target_state_captured_decisions` row per answered question via Spec 2's POST endpoint.
- A **conversation transcript** persisted via Spec 2's `targetStateConversationStore.ts` (turn-shape now defined here).
- A **mapping mutation** flow that, when a decision changes the technology basis for any mapped element, rewrites the `architecture_element_mappings` rows (mapping_type / notes) and decorates the notes via Spec 2's `ArchitectureElementMappingNotesDecorator`.
- A **standards registry integration** that looks up downstream defaults given a chosen target tech (e.g. picking Java 21 implies certain defaults for testing / logging / DTO style / build tool).
- A **per-element exception pinning** model (set default for the architecture, then refine per-service / per-interface / per-element).
- A **UI** inside the Target State sub-tab (from Spec 1) — chat-like multi-turn surface with structured prompts the user answers.

**This spec is not:**
- The captured-decisions data plane itself (Spec 2 — already shipped).
- The Target State sub-tab navigation (Spec 1 — already shipped).
- The downstream PM-task updates that consume captured decisions (Spec 4 — separate).
- The deterministic Suggest flow (Spec 1).
- The standards registry data ITSELF — this spec consumes the existing standards-generation surface (`/api/v1/standards/global` and `/api/v1/standards/product` per `gateway/src/server.ts`); if the data isn't there yet, this spec scopes a minimal seed of the standards needed for the 50 questions and defers a full standards-registry refactor.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea. The shape-spec agent should treat them as given:

1. **Multi-turn conversation pattern**, not one-shot LLM call. Closest precedent: `api-migration-validation-service`'s tool-call loop.
2. **Functional like-for-like is the strong default**. The conversation never proposes a non-equivalent target. Interfaces, endpoints, data entity shapes, HTTP contracts, physical data structures all preserved by default; only the technology basis changes per decision.
3. **Decision capture writes through Spec 2's data plane**. No new persistence layer. One POST per answer to `POST /api/projects/{p}/target-architectures/{t}/captured-decisions`.
4. **Conversation transcript persists via Spec 2's `targetStateConversationStore.ts`**. This spec defines the turn shape; the helper already exists and accepts `unknown` turns.
5. **~50 questions across 10 concern groups (A–J)**: A=Service runtime, B=API surface, C=Data persistence, D=Domain/DTO style, E=Frontend (only when UI present), F=Cross-cutting, G=Infrastructure, H=Inter-service communication, I=Testing, J=Cut-over.
6. **Cascading defaults**. Answering one question pre-fills standards-driven defaults for downstream questions (Java 21 → JUnit 5 / SLF4J+JSON / records / Bean Validation / etc). User can override individual cascaded defaults.
7. **Per-element exception pinning**. The architect sets defaults at the architecture level then refines per-service / per-interface / per-element where exceptions exist (e.g. "default Spring Boot 3, except service X stays Spring Classic for compatibility").
8. **Standards-driven, evidence-cited**. Every cascaded default carries the standards_lookup_ref so the audit trail records "we chose JUnit 5 because the standards for Java 21 default to it." User overrides record a free-form reason that becomes part of the decision row.
9. **UI lives in the Target State sub-tab** introduced by Spec 1. New "Architect Conversation" view-mode tab inside that sub-tab (peer to "Table editor" + "Compare with current").
10. **Decisions are insert-only at the data plane** (per Spec 2's contract). The conversation UI can offer "go back and revise" interactions, but the implementation writes a new superseding row each time.
11. **Mapping mutations happen as side-effects of decisions**. The decoration helper from Spec 2 is used to tag the notes; some decisions also change `mapping_type` (e.g. SOAP → REST changes interface mappings from `equivalent` to `replaced_by`).
12. **Conversation gated on having an active target architecture**. If no target draft exists, the UI prompts the user to run Suggest first (Spec 1).
13. **One commit boundary** per project pattern.
14. **No backfill** — only forward writes through the new conversation flow.

## Specific requirements (rough — let shape-spec refine)

### Question library

A new gateway-side configuration data structure that defines all 51 questions:

- One entry per decision code (`service.language`, `service.framework`, `db.engine`, etc.).
- Each entry has: `code`, `group` (A–J), `prompt` (the question text shown to the user), `expectedAnswerShape` (free-text / single-choice / multi-choice / structured), `defaultsWhenUnchanged` (what to write if the user picks "no change"), `cascades` (list of downstream decision codes this answer pre-fills), `standardsLookupQuery` (how to query the standards registry for cascaded defaults).
- Located in `gateway/src/config/architect-conversation/question-library.json` or similar — config-driven so Spec 4 doesn't need to touch this spec's code.
- The full list of ~51 questions from the planning conversation should be enumerated (raw idea owns the full list; spec.md links / inlines).

### Cascading defaults mechanism

- After each user-confirmed answer, the gateway evaluates the entry's `cascades` array.
- For each cascaded decision code, the gateway queries the standards registry given the user's just-answered value (e.g. given `service.language = Java 21`, query for the Java-21-standard defaults across testing / logging / DTOs / build).
- Cascaded defaults are NOT auto-written. They're surfaced to the user in the next turn as "based on Java 21, here are the recommended defaults — accept all / review individually / change <X>".
- User can accept-batch, accept-individual, or override any cascaded default.
- Each cascaded answer (accepted or overridden) still writes its own captured decision row via Spec 2's POST endpoint, with the `standards_lookup_ref` populated.

### Per-element exception pinning

- Most decisions start at `scope_kind='architecture'`.
- The conversation UI offers a "set exception for specific [service/interface/element]" affordance per answered question.
- Exception writes a NEW decision row at `scope_kind='service'` / `'interface'` / `'element'` with `scope_ref_id` (and `scope_ref_type` for element).
- Downstream readers (Spec 4's PM tasks, the resolver from Spec 2) follow the "latest per (decision_code, scope) wins" semantic Spec 2 already implements.

### Mapping mutations

- After every architecture-wide or scoped decision is captured, the gateway calls a new orchestration helper that:
  1. Identifies which `architecture_element_mappings` rows are affected (e.g. `db.engine` change → every mapping on physical_data_entity / physical_data_attribute tables; `service.framework` change → every mapping on services; `api.protocol` change → every mapping on interfaces / endpoints).
  2. For each affected mapping: if the technology change is purely substitutive (same logical shape, different implementation), keep `mapping_type='equivalent'` but decorate notes with `[decision:<code>]` via Spec 2's helper. If the technology change is architectural (SOAP → REST changes the contract shape), change `mapping_type='replaced_by'` and decorate notes.
  3. Bulk-applies the mutations under a single transaction per decision.
- A configuration map (`decision_code` → `affected_table_set` → `default_mapping_type_change`) lives alongside the question library. Spec 3 defines the v1 rules; future specs can add nuance.

### Conversation transcript turn shape

- This spec defines the turn shape that Spec 2's `targetStateConversationStore.ts` (which accepts `unknown`) now actually persists. Rough shape:
  ```typescript
  interface ArchitectTurn {
    turnIndex: number;
    timestamp: string;
    actor: 'user' | 'llm' | 'system';
    kind: 'question' | 'answer' | 'cascade-summary' | 'decision-captured' | 'mapping-mutation-summary' | 'open' | 'close';
    payload: {
      decisionCode?: string;
      scope?: { kind: string; refType?: string; refId?: string };
      promptText?: string;
      answerText?: string;
      standardsLookupRef?: string;
      mutationSummary?: { affectedMappings: number; mappingTypeChanges: number };
      // ... etc
    };
  }
  ```
- Stored as `turns[]` inside the envelope Spec 2 already defines.

### LLM orchestration

- Multi-turn loop pattern based on `api-migration-validation-service`'s `captureLoopRunner`.
- Per-turn limits: bounded LLM call rounds per question (default: 3 rounds), per-call timeout (default: 30s), per-question wall clock (default: 5 min).
- LLM receives: the current question, the user's free-text response (if any), the captured-decisions context so far (via Spec 2's resolver), and the standards registry result for cascaded defaults.
- LLM responsibilities: parse the user's free-text into a structured answer matching `expectedAnswerShape`, propose the standards-driven cascades, surface ambiguity if the user's response is unclear.
- LLM does NOT directly write decisions — every write goes through the gateway orchestration, after the structured answer is validated.
- LLM does NOT decide mapping mutations — that's the deterministic rules from the configuration map.

### UI surface (frontend)

- New "Architect Conversation" view-mode tab inside the Target State sub-tab (peer to "Table editor" + "Compare with current").
- When no active target draft → empty-state "Run Suggest first" copy with a link to the Suggest button on the Table editor tab.
- When an active target exists but no conversation started → "Start conversation" button.
- When a conversation is in progress → chat-style scrollable transcript on the main pane:
  - Left: LLM messages (question prompts, cascade summaries, mutation summaries).
  - Right: User responses + structured-answer chips ("accept default", "no change", free-text input).
  - Per-question affordance: "set exception for…" button that opens a sub-dialog to scope a decision to a specific service / interface / element.
- Right-side panel (always visible during conversation): running summary of captured decisions grouped by scope, with the conversation transcript counter and a "preview prompt-ready output" link that shows what the Spec 2 resolver would emit.
- Conversation completion: a "close conversation" CTA that triggers the close turn + writes a summary doc.
- Re-opening a closed conversation: shows the full transcript read-only with a "start new conversation" affordance (writes a new thread; old thread retained for audit).

### Standards registry consumption

- Audit existing surfaces: `gateway/src/routes/standardsGenerate.ts` and `gateway/src/routes/projectStandards.ts` (via `gateway/src/server.ts`).
- If the registry already exposes a "given target tech X, what are the standard defaults?" query, use it.
- If not, this spec adds a minimal **query endpoint** the architect conversation needs:
  - `GET /api/v1/standards/defaults-for?targetTech=<code>` returning a list of `{decisionCode, defaultValue, sourceStandardId}` for cascade pre-fill.
- The full standards-registry refactor (if needed) is deferred — this spec ships just enough to wire the 51 questions' cascades.

### Mapping mutation rules configuration

- Located alongside the question library — `gateway/src/config/architect-conversation/mapping-mutation-rules.json`.
- Per decision code: which entity tables' mappings are affected, what's the default `mapping_type` change (none / equivalent / replaced_by / renamed / merged / split), what scope it applies at.
- v1 rules cover the obvious cases:
  - `db.engine` change → physical_data_entity / physical_data_attribute / data_entity_points mappings: keep equivalent, decorate notes
  - `api.protocol` change (SOAP→REST) → interface / endpoint mappings: replaced_by, decorate notes
  - `service.framework` change → service mappings: keep equivalent, decorate notes
  - `service.language` change → method / class mappings: keep equivalent, decorate notes
  - All others: notes decoration only, no mapping_type change
- The rules are deliberately simple in v1; Spec 4 and beyond may refine.

### Tests

- **Backend (gateway) — moderate scope, 4-8 tests per group:**
  - Question library loader + validation tests (every code has required fields, no duplicate codes, cascades reference real codes).
  - LLM orchestration: per-question round limit, timeout enforcement, structured-answer parse, default-when-unchanged path.
  - Standards lookup integration: cascade pre-fill with mocked standards registry.
  - Decision capture: every answered question writes one captured-decision row (POST to Spec 2's endpoint).
  - Mapping mutation: rules-config-driven, transactional, citation tag via Spec 2's helper.
  - Conversation transcript: turn append round-trips via Spec 2's helper; close turn writes summary.
- **Frontend — moderate scope, 4-8 tests per surface:**
  - Architect Conversation tab renders in Target State sub-tab.
  - Empty-state when no active target.
  - Start-conversation flow.
  - Cascade-summary accept-batch UX.
  - Per-question "set exception" sub-dialog.
  - Close-conversation flow.
- No end-to-end real-LLM tests (mock the LLM client per the existing pattern).

### Out of scope

- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` (Spec 4).
- The standards-registry data itself, beyond what's needed to seed cascades for the 51 questions. A full standards-registry refactor is its own future spec.
- Architecture-element creation surfaces (Spec 1 removed Add Component / API / etc; not re-introduced).
- Diagram authoring on target (future spec).
- Branching conversations (parallel "what-if" target drafts driven by alternative decision sets) — future spec.
- LLM-driven mapping mutation logic — v1 uses deterministic rules config.
- Re-running cascades when an upstream decision is superseded (e.g. user changes `service.language` from Java 21 to Java 17 after already locking JUnit 5) — v1 leaves the prior cascaded answers untouched and the conversation prompts the user to review affected downstream decisions manually. Auto-cascade-replay is a future spec.

## Dependencies

- `2026-05-24-target-state-subtab-deterministic-suggest` (Spec 1) — shipped + committed. Target State sub-tab exists; Suggest produces the target draft this conversation refines.
- `2026-05-24-target-state-captured-decisions-data-plane` (Spec 2) — shipped + committed. Captured-decisions table, POST endpoint, thread store helper, mapping-notes decoration helper, resolver, aggregation DTO extension — all the rails this spec writes through.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — shipped. Mapping reads use parent chain; relevant when mutation rules read affected mappings.
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern on DTOs — established; new DTOs follow.

## Open questions for shape-spec to clarify

1. **LLM orchestration: which existing pattern to mirror?** The closest precedents are (a) `api-migration-validation-service`'s `captureLoopRunner` (multi-turn loop with tool calls, hard limits, scenario-bounded) and (b) the existing `chatV2` PM-task handlers (single-turn, structured response, no loop). My instinct: (a) — the architect conversation has natural multi-round shape per question (parse user input → propose cascades → confirm answer). But (a) is heavier infrastructure to set up; (b) may be enough if we constrain "each question is one round, no follow-up loop." Which one fits the product better?

2. **Question ordering — strict sequence or jump-around?** Strict order (A1 → A2 → A3 → … J4) is simpler to implement but tedious for the user. Jump-around (user picks which group to tackle first; resumes wherever) is friendlier but requires UI state for partially-answered groups. My instinct: jump-around with a "start with the headline groups (A, B, C)" suggestion banner.

3. **Edit-after-answer support — first-class or "start a new conversation" only?** Spec 2's data plane supports supersession via insert. But the conversation UI needs to surface "go back to question X and revise" — does that mean every prior answer is editable inline, or only by starting a fresh conversation that re-asks everything? My instinct: in-place edit allowed per question, writes a new superseding decision row each time, and the LLM is prompted to re-evaluate the cascades for the changed answer.

4. **Standards registry — does the data exist for all 51 questions?** Audit `/api/v1/standards/global` and `/api/v1/standards/product` to find out what's there. If gaps exist, this spec needs to either (a) ship the standards seeds for the 51 codes inline, or (b) gracefully degrade (cascade with no standards_lookup_ref, user just gets "no recommended default — enter your own" prompts). My instinct: (b) for v1, with a follow-up spec to seed the standards properly.

5. **Per-element exception UI — sub-dialog or always-inline?** A per-question "set exception" button opening a sub-dialog (pick a service from a dropdown, fire) is one UX. An "exceptions" section under each captured architecture-wide decision that lets the user add per-element overrides post-hoc is another. My instinct: sub-dialog at the moment of answering, plus the right-side summary panel lets the user click any prior decision to revise it (which opens the same sub-dialog).

6. **Mapping mutation transactionality — per decision or batched?** Each captured decision can affect 0–N mapping rows. Should each decision's mapping mutations happen in its own transaction (smaller blast radius, but multiple rapid decisions = multiple commits) or batched at "close conversation" (one big commit but mutations don't reflect until close)? My instinct: per-decision transaction — keeps the conversation reactive and downstream resolver outputs always consistent.

7. **What happens to the existing mappings created by Spec 1's deterministic Suggest?** Suggest writes `mapping_type='equivalent', status='confirmed', confidence=1.0, created_by_task='target-state-suggest'`. When the architect conversation rewrites those (e.g. SOAP → REST changes interfaces to `replaced_by`), do we leave `created_by_task='target-state-suggest'` or rewrite it to `created_by_task='architect-persona-conversation'`? My instinct: leave `created_by_task` as the original (audit of who first created the row) and append a new note via the decoration helper.

8. **Conversation summary doc location — where does the close turn write it?** Options: (a) plain markdown attached to the target draft via the existing artifacts pattern, (b) a column on the architecture row, (c) a dedicated `target_state_conversation_summaries` table, (d) just persist as a special final turn in the conversation thread. My instinct: (d) — keeps everything in one place; downstream consumers read via the same thread store helper.

9. **Are the question prompts the LLM's responsibility or this spec's responsibility?** The LLM could rephrase / contextualize ("based on your project's discovery findings, here's why `db.engine` matters"). But that risks drift between users and reproducibility. My instinct: prompts are fixed strings in the question library (this spec owns them), LLM only does parsing of user input and cascade proposal — not prompt generation.

10. **UI streaming or polling?** Multi-turn LLM responses can be long. Streaming (SSE) feels responsive; polling is simpler. The existing PM tasks use single-turn synchronous calls — no streaming infrastructure to mirror. My instinct: synchronous for v1 (each turn is a request/response), surface a "thinking…" spinner. Add streaming later if the wait gets annoying.

11. **Concurrent users on the same target draft?** Spec 2's thread store has no file lock (acceptable since single-writer). What's the architect-conversation contract? My instinct: single-writer per target draft. UI shows a "conversation in progress — wait or start new (will retire current)" warning if a second user opens the same draft. v1 doesn't need optimistic locking.

12. **Question-skip semantics — "no change from current" vs "skip and revisit later"?** Some questions may not apply (e.g. Group E frontend questions for a backend-only project). The library should mark which groups are conditionally relevant. My instinct: each question entry has a `relevanceCondition` (e.g. "skip Group E if no `ui_screens` rows in target arch"); skipped questions get a captured decision row with `answer_value='not_applicable'` so the audit trail shows it was considered.

13. **What's the close-conversation gate — must all questions be answered?** No (per #12 — some are skippable), but at minimum the headline groups (A.1 service.language, B.1 api.protocol, C.1 db.engine) should be answered. My instinct: yes, close-conversation requires those 3 minimum + lets the user close even with other groups un-answered. Un-answered questions surface as `decision_code` rows with `answer_value='deferred'` so downstream consumers see the gap explicitly.

14. **Threading model — one conversation thread per target draft, or one per "session"?** Spec 2's helper takes `targetArchitectureId` — one thread per target. If the user closes and re-opens, do we append to the same thread or start a fresh one? My instinct: one thread per `(target draft, conversation session)`, where a session opens on "start conversation" and closes on "close conversation". The thread file path could be `threads/target-state-conversation/<targetArchId>/<sessionId>.json` — adjusts Spec 2's path convention slightly. Worth checking what Spec 2 actually ships before assuming.

## Verification

After this spec:
- A user with a target draft (from Spec 1) can open the new Architect Conversation tab in the Target State sub-tab.
- They walk through (in any order) the 51 questions across groups A–J, with cascading defaults pre-filled from the standards registry.
- Every answered question writes a captured decision row (Spec 2's table), updates the conversation transcript (Spec 2's thread store), and mutates affected mapping rows per the rules config (decorating notes via Spec 2's helper, and changing `mapping_type` where the rules dictate).
- Per-element exception pinning works: the architect can set "default Spring Boot 3, except service X stays Spring Classic" and both decision rows exist with appropriate scope.
- The Spec 2 resolver starts producing populated grouped-by-scope output instead of "no decisions captured yet."
- The aggregation endpoint starts emitting populated `targetStateDecisionsSummary` blocks.
- Spec 4 (next, separate) can immediately consume the decisions in its PM-task prompts because Spec 2's contract is unchanged.

## Commit boundary

One commit covering: question library config, mapping-mutation rules config, gateway LLM orchestration handler + tool registry, standards registry query integration (with the new defaults-for endpoint if needed), conversation transcript turn shape, mapping mutation helper, AMS endpoint (if any new ones beyond Spec 2's surface), gateway proxy routes (if new ones needed for the conversation lifecycle), frontend Architect Conversation view-mode tab in the Target State sub-tab + sub-dialogs, backend tests, frontend tests.

This is the largest of the four specs by a healthy margin. Worth a careful task-list pass to split into incremental task groups that each verify standalone before the next.
