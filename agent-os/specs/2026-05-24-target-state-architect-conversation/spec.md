# Specification: Target State Architect-Persona Conversation

## Goal

Land the user-facing migration-workflow value: a multi-turn LLM-driven architect-persona conversation inside the Target State sub-tab that asks the architect ~51 questions across 10 concern groups, captures every answer as a decision row through Spec 2's already-shipped data plane, surfaces standards-driven cascading defaults inline, and mutates the technology-naive cloned target produced by Spec 1 into one shaped by intentional, evidence-cited technology decisions — every mapping decoration and `mapping_type` change running inside a transactional Architecture Model Service endpoint so the resolver and aggregation DTO from Spec 2 start emitting populated output.

## User Stories

- As a migration architect, I want to walk through ~51 grouped technology questions on my freshly cloned target draft so that every decision I make is captured, scope-aware, evidence-cited, and visible to downstream Product Manager prompts.
- As a migration architect, I want standards-driven defaults pre-filled across cascaded questions (Java 21 implies JUnit 5, Spring Boot 3.4 implies Bean Validation) so that I confirm a batch rather than re-typing the obvious downstream choices, while still being able to override any individual cascade with a recorded reason.
- As a migration architect, I want to pin per-element exceptions ("default Spring Boot 3, except service X stays Spring Classic") and revise prior answers in-flight so that the captured-decision audit reflects the real shape of the migration without forcing me to start the conversation over.
- As a downstream Product Manager prompt (Spec 4), I want every architect decision delivered as a populated scope-grouped block on `MigrationDiscoveryContextDto` so that Book of Work and Shape-Spec generation cite decision codes instead of producing technology-naive output.
- As a second user opening the same target draft mid-conversation, I want a clear "retire current and start new" affordance rather than a silent collision so that the audit trail records who closed each session and why.

## Settled Decisions Carried Forward (Do Not Re-Litigate)

These 14 decisions from the raw idea, plus the 28 question answers from spec-shaper, are load-bearing inputs. They are not options:

1. Multi-turn conversation pattern (precedent: `api-migration-validation-service/src/services/captureLoopRunner.ts`).
2. Functional like-for-like is the strong default; only the technology basis changes per decision.
3. Decision capture writes through Spec 2's `POST /api/projects/{p}/target-architectures/{t}/captured-decisions`. No new persistence layer.
4. Conversation transcript persists via Spec 2's `targetStateConversationStore.ts` — this spec defines the typed turn shape only.
5. 51 questions across 10 groups A–J (A=Service runtime, B=API surface, C=Data persistence, D=Domain/DTO style, E=Frontend, F=Cross-cutting, G=Infrastructure, H=Inter-service comms, I=Testing, J=Cut-over).
6. Cascading defaults pre-fill downstream questions; user can override individual cascades.
7. Per-element exception pinning (architecture-level default plus per-element exceptions).
8. Standards-driven, evidence-cited; every cascaded default records a `standardsLookupRef`.
9. UI lives as a new view-mode tab inside Spec 1's Target State sub-tab, peer to Table editor and Compare with current.
10. Decisions are insert-only at the data plane; revisions write a new superseding row.
11. Mapping mutations are deterministic side-effects of decisions, not LLM-driven.
12. Conversation gated on an active target architecture (resolved via Spec 2's lookup endpoint).
13. Multi-commit boundary for this spec (overrides the raw idea's one-commit guideline — see Commit Plan).
14. No backfill; only forward writes through the new conversation flow.

## Specific Requirements

### Question library config (`gateway/src/config/architect-conversation/questionLibrary.ts`)

- Strongly typed TypeScript file exporting a `QuestionLibrary` type and a `QUESTION_LIBRARY` constant containing all 51 entries (see Appendix A for the full enumerated list).
- Per-entry fields: `code`, `group` (one of `A`..`J`), `prompt` (fixed string — never paraphrased by the LLM per Q17), `discoveryContextLead?` (optional deterministic lead-in computed from discovery context at load time), `expectedAnswerShape` (`'free-text' | 'single-choice' | 'multi-choice' | 'structured'`), `choices?` (when shape is single/multi-choice), `defaultsWhenUnchanged` (the "no change from current" value), `cascades` (array of cascade entries — see below), `relevanceCondition?` (typed predicate function `(ctx: RelevanceContext) => boolean`), `allowedExceptionScopes` (array drawn from the closed `scope_ref_type` set in the next section).
- Each cascade entry shape: `{ decisionCode: string; valueByTriggerValue: Record<string, unknown>; sourceStandardId: string }` — the standards-driven seed map is inlined per Q9. No runtime call to the standards registry in v1.
- Intra-group ordering enforced (A.1 before A.2 before A.3), inter-group ordering free (per Q5). The library entries declare a stable `orderInGroup` field so the gateway can sequence within a group.
- Loader-time validation (covered in test group 1): no duplicate `code`s, every cascade's `decisionCode` references a real library entry, every `allowedExceptionScopes` value is in the closed set in the next section, every `relevanceCondition` is a function.

### Allowed `scope_ref_type` values (closed set per Q12)

The only values accepted on a captured-decision row's `scope_ref_type` field, on `allowedExceptionScopes` in the question library, and on the exception sub-dialog entity picker are:

```
'service' | 'interface' | 'endpoint' | 'physical_data_entity' |
'physical_data_attribute' | 'method' | 'class'
```

Library-loader validation and the exception sub-dialog both reject anything outside this set.

### Mapping mutation rules config (`gateway/src/config/architect-conversation/mappingMutationRules.ts`)

- TypeScript file exporting a `MappingMutationRules` type and a `MAPPING_MUTATION_RULES` constant keyed by `decisionCode`.
- Per rule: `affectedTableSets` (an array of entity-table identifiers — e.g. `service`, `interface`, `endpoint`, `physical_data_entity`, `physical_data_attribute`, `method`, `class`), `defaultMappingTypeChange` (`'none' | 'keep-equivalent' | 'replaced_by' | 'renamed' | 'merged' | 'split'`), `scopeBoundary` (always parent-not-leaf per Q15; per-element exceptions narrow to one row).
- v1 rules:
  - `db.engine`: tables = physical_data_entity, physical_data_attribute, data_entity_points; change = keep-equivalent; decorate notes.
  - `api.protocol` (SOAP → REST): tables = interface, endpoint; change = `replaced_by`; decorate notes.
  - `service.framework`: tables = service; change = keep-equivalent; decorate notes.
  - `service.language`: tables = method, class; change = keep-equivalent; decorate notes.
  - All other decision codes: notes decoration only, no `mapping_type` change.

### Gateway-native LLM orchestration loop (`gateway/src/services/architectConversation/llmLoopRunner.ts`)

- Simplified port of `api-migration-validation-service`'s `captureLoopRunner` pattern (per Q1). No runtime dependency on api-migration-validation-service.
- Hard limits per Q2: 5 LLM rounds per question, 30s per individual LLM call, 2-minute wall-clock per question. Limits enforced inside the loop and surfaced as an `error` turn on breach.
- Per-turn LLM input: the current question's fixed prompt (with `discoveryContextLead` prepended when present), the user's free-text response if any, the captured-decisions context so far (via Spec 2's resolver), and the inline cascade seed map for the question.
- LLM responsibilities: parse free-text into a structured answer matching `expectedAnswerShape`, propose the standards-driven cascades (surfaced to the user as `cascade-summary` turns for accept-batch / per-cascade override), surface ambiguity triggering another round within budget.
- LLM never directly writes decisions or mutates mappings. Every write is gateway-orchestrated after the structured answer validates.
- Mocked at the gateway LLM-client boundary (`gatewayClient.callLlmToolLoop` or the equivalent gateway-native call site) for all backend tests per Q26.

### Decision capture flow

- After structured-answer validation, the gateway writes the captured-decision row via Spec 2's `POST /api/projects/{p}/target-architectures/{t}/captured-decisions`.
- Cascade-accept-batch (per Q10): N decisions written as N sequential POSTs, all carrying the same `conversation_turn_ref` value so the transcript surface can attribute the batch to a single triggering answer.
- Edit-after-answer: any revision is a new POST (insert-only per settled decision #10) plus a conversation-level banner per Q6 listing the downstream cascaded decision codes the user may want to re-visit. No auto-replay.
- Default-when-unchanged: if the user picks "no change" for a question, the gateway writes a row with `answerValue` set to the library entry's `defaultsWhenUnchanged`. The decision is captured, not skipped.
- Standards seed-map cascade plumbing: every cascaded decision row records the library entry's `sourceStandardId` in the `standardsLookupRef` column for audit. When Spec 5 later introduces a runtime `GET /api/v1/standards/defaults-for` endpoint, the captured-decision contract is unchanged — only the library entries are swapped.

### AMS apply-mapping-mutations endpoint

- New endpoint `POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}/apply-mapping-mutations` on the Architecture Model Service.
- Runs all mapping-mutation effects for the named decision inside one `@Transactional` boundary per Q13.
- Request body carries the relevant mapping-mutation rule subset for the decision code (the gateway selects from `MAPPING_MUTATION_RULES` and forwards). Response body returns the per-table-set summary (counts of affected mappings, `mapping_type` changes applied, notes decorations applied).
- For each affected mapping row: invoke Spec 2's `ArchitectureElementMappingNotesDecorator` to append `[decision:<code>]` to notes idempotently; apply the `mapping_type` change if the rule dictates one; never touch `created_by_task` (per Q14).
- Affected-set boundary per Q15: all mappings rooted under the target architecture's parent-not-leaf scope (per the 2026-05-22 architecture-scope-via-parent-not-leaf spec). Per-element exceptions narrow to a single element row.
- Cross-project leak protection mirrors Spec 2's pattern: verify the loaded decision row's `project_id` and `target_architecture_id` match the request path; return HTTP 404 on mismatch.

### Gateway client + orchestration

- New gateway client method for the AMS apply-mapping-mutations endpoint, mirroring the existing captured-decisions proxy shape from Spec 2.
- Orchestration sequence per answered question: gateway validates the structured answer → POSTs the captured decision via Spec 2 → invokes apply-mapping-mutations with the rule subset for the decision code → appends a `mapping-mutation-summary` turn to the transcript with the per-table-set counts.

### Conversation transcript turn shape (the 13-kind union, per Q19 + Q20)

Stored via Spec 2's `targetStateConversationStore.ts` as `unknown` turns. This spec defines the typed shape; the store helper sees only the typed turn after type erasure. Full union:

```
'question' | 'answer' | 'cascade-summary' | 'cascade-accepted' |
'cascade-overridden' | 'decision-captured' | 'mapping-mutation-summary' |
'exception-pinned' | 'edit-superseded' | 'system-skip' | 'error' |
'open' | 'close'
```

Per-turn payload extras (per Q20):

- `question`: `decisionCode`, `promptText` (with any prepended `discoveryContextLead`), `roundIndex`.
- `answer`: `decisionCode`, `answerText` (free-text or structured), `roundIndex`.
- `cascade-summary`: `cascadedDecisions[]` (each entry: `decisionCode`, `proposedValue`, `sourceStandardId`).
- `cascade-accepted`: `cascadedDecisions[]` (each entry: `decisionCode`, `answerValue`, `wasOverridden: false`).
- `cascade-overridden`: `cascadedDecisions[]` (each entry: `decisionCode`, `answerValue`, `wasOverridden: true`, `overrideReason`).
- `decision-captured`: `decisionId`, `decisionCode`, `scope` (`{ kind, refType?, refId? }`), `answerValue`, `standardsLookupRef`.
- `mapping-mutation-summary`: `affectedMappings` (count), `mappingTypeChanges` (count), `notesDecorations` (count), `tableSetSummary` (per-table-set breakdown).
- `exception-pinned`: `decisionCode`, `scope` (`{ kind: 'element', refType, refId }`), `answerValue`.
- `edit-superseded`: `originalDecisionId`, `newDecisionId`, `affectedDownstreamCodes[]` (the Q6 cascade-review list).
- `system-skip`: `decisionCode`, `relevanceReason`.
- `error`: `errorKind`, `errorMessage`, `recoverableHint?`.
- `open`: `sessionId`, `openedBy`.
- `close`: `sessionId`, `closeReason` (`'completed-by-user' | 'retired-by-other-user'`), `summaryMarkdown` (per Q16 — full grouped-by-scope summary embedded inline so any later read is self-contained).

### Threading + session model

- One thread file per target draft (re-use Spec 2's shipped path verbatim per Q3). Do NOT extend Spec 2's helper signature.
- Sessions are logical segments inside `turns[]`, delimited by `open` and `close` markers.
- Thread envelope carries a `currentSession.status='open'` marker. The store helper sees only `unknown`; this spec's reader code interprets the marker.
- Second-opener concurrency (per Q4): when a second user opens a draft whose envelope shows an open session by another user, the UI offers a "retire current and start new" affordance. Retire writes a synthetic `close` turn with `closeReason: 'retired-by-other-user'`, then writes a fresh `open` turn. No optimistic locking in v1.

### Question ordering, relevance, and close gate

- Intra-group order enforced (A.1 → A.2 → A.3); inter-group order free (per Q5). Within a group the gateway refuses to surface A.2 until A.1 is answered or deferred.
- Relevance evaluation (per Q7): gateway evaluates each library entry's `relevanceCondition` predicate at conversation load AND on each captured-decision write that might unlock or lock a relevance gate. For predicates returning false: silently POST a captured-decision row with `answerValue='not_applicable'` plus append a `system-skip` turn carrying the `relevanceReason`.
- Close-conversation gate (per Q8): `A.1` (`service.language`), `B.1` (`api.protocol`), and `C.1` (`db.engine`) must be answered before the close CTA enables. All other questions may be left as `'deferred'` (real captured-decision row with `answerValue='deferred'`) or un-answered (no row at all). The summary panel visually distinguishes the two states.

### Frontend — Architect Conversation view-mode tab

- New view-mode tab inside the existing Target State sub-tab, peer to "Table editor" and "Compare with current" (per settled decision #9).
- Empty-state when no active target draft (per Q23): soft router push to the Table editor view-mode with a one-frame CSS highlight on the Suggest button. No modal, no toast.
- Active target, no conversation started: "Start conversation" button.
- Active target with a prior closed/retired session: read-only transcript of the prior session plus "Start new conversation" button (writes a new logical session inside the same thread file).
- Conversation-in-progress main pane (chat-style):
  - Left rail: LLM messages (question prompts with `discoveryContextLead` prepended, cascade summaries, mutation summaries).
  - Right rail: user responses + structured-answer chips ("accept default", "no change", free-text input).
  - Per-question "Set exception for…" button opening a sub-dialog with an entity picker filtered per Q11 by the decision code's `allowedExceptionScopes`. Sub-dialog sources its rows from existing target-architecture read endpoints.
  - Cascade-summary turn shows accept-all plus per-cascade override controls. Accept-all triggers the gateway's atomic N-row write per Q10.
  - 60-second per-turn frontend timeout (per Q18). "Thinking…" spinner while waiting. Error toast on timeout; user retries.
- Right-side summary panel (always visible during conversation):
  - Running grouped-by-scope summary of captured decisions.
  - Visual distinction between `'deferred'` rows and un-answered questions per Q8.
  - "Preview prompt-ready output" link surfacing what Spec 2's resolver would emit right now.
  - Each prior decision clickable to revise (opens the same exception sub-dialog or the answer-edit flow).
- Revise-prior-answer flow: edit triggers a new superseding POST (insert-only) plus a conversation-level banner per Q6 listing the downstream cascaded decision codes the user may want to re-visit. No auto-replay.
- Close-conversation CTA: enabled only when A.1, B.1, and C.1 are answered. Writes a `close` turn with the full grouped-by-scope `summaryMarkdown` embedded inline (per Q16).
- Compare view: no decoration added in v1 (per Q22). Compare view stays exactly as Spec 1 ships.

### Standards registry integration (degraded for v1)

- Per Q9: no runtime calls to the standards registry. Cascade defaults are inline in the question library entries' `cascades[].valueByTriggerValue` maps.
- Each cascaded decision row still records `standardsLookupRef` (set to the inline `sourceStandardId`) so the audit trail's "why we proposed JUnit 5" stays intact.
- Future "Spec 5" introduces `GET /api/v1/standards/defaults-for?targetTech=<code>` and migrates library entries from inline defaults to runtime lookups. The captured-decision contract does not change.

### Active target architecture lookup

- Per Q21: use only Spec 2's `GET /api/projects/{projectId}/active-target-architecture-id` endpoint. "Active" = whatever that endpoint returns. No fallback logic in this spec.

### Tests

- **Backend — 6 groups, 4–8 tests each (per Q26):**
  1. Question library loader + validation (no duplicate codes; every cascade `decisionCode` resolves; every `allowedExceptionScopes` value is in the Q12 closed set; every `relevanceCondition` is a function).
  2. LLM orchestration loop (5-round cap; 30s per-call timeout; 2-min wall-clock; structured-answer parsing; default-when-unchanged path; error turn on breach). Mocked at the gateway LLM-client boundary.
  3. Standards seed-map cascade pre-fill (inline values surface correctly per Q9; `sourceStandardId` recorded on every cascaded row).
  4. Decision capture (POST to Spec 2's endpoint succeeds; cascade-accept-batch writes N rows with a shared `conversation_turn_ref` per Q10; revision writes a new superseding row plus the Q6 banner payload).
  5. Mapping mutation rules + AMS apply-mapping-mutations endpoint (single `@Transactional`; `ArchitectureElementMappingNotesDecorator` invoked; `mapping_type` changes applied per rules; `created_by_task` untouched per Q14; parent-not-leaf scope per Q15; cross-project access returns 404).
  6. Conversation transcript (turn append round-trips via Spec 2's helper; session `open`/`close` markers; relevance auto-skip writes a `system-skip` turn; `edit-superseded` turn carries downstream codes; `close` turn embeds `summaryMarkdown` inline per Q16).

- **Frontend — 7 surfaces, 4–8 tests each (per Q27):**
  1. Architect Conversation tab renders in the Target State sub-tab.
  2. Empty-state when no active target — soft router push to Table editor and one-frame Suggest-button highlight per Q23.
  3. Start-conversation flow.
  4. Cascade-summary accept-batch UX (accept-all writes N rows; per-cascade override path).
  5. Per-question "Set exception" sub-dialog (entity picker filtered per Q11 by `allowedExceptionScopes`).
  6. Close-conversation flow + retire-current-session handling per Q4.
  7. Revise-prior-answer flow with the Q6 downstream-review banner.

- All LLM calls mocked at the `gatewayClient.callLlmToolLoop` (or equivalent gateway-native) boundary so per-test execution is fast and deterministic.

## Out of Scope

- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` to consume the new decisions — Spec 4.
- A runtime standards-registry defaults-for endpoint and a full standards-registry refactor — future "Spec 5".
- Compare-view per-element decision badges/decoration — future spec (per Q22).
- Architecture-element creation surfaces (Spec 1 removed Add Component / API / etc. — not re-introduced).
- Diagram authoring on the target draft — future spec.
- Branching conversations / parallel what-if drafts with alternative decision sets — future spec.
- LLM-driven mapping mutation logic — v1 uses deterministic rules config only.
- Auto-cascade-replay when an upstream decision is superseded — v1 surfaces the Q6 review banner only; auto-replay deferred.
- A `last_modified_by_task` column on mapping rows — not added (per Q14).
- SSE / streaming for LLM turns — synchronous only in v1 (per Q18).
- Optimistic locking on the thread file — UI-level prevention only (per Q4).
- End-to-end real-LLM tests — LLM mocked at the gateway client boundary (per Q26).
- Extending Spec 2's `targetStateConversationStore.ts` helper signature — re-use verbatim (per Q3).

## Existing Code to Leverage

### `gateway/src/services/targetStateConversationStore.ts` (Spec 2)

- Already-shipped thread store sibling to `threadStore.ts`. Accepts `unknown` turns at `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json`.
- This spec writes typed turns through the existing helper without extending its signature. Session boundaries (`open`/`close`) are this spec's interpretation of the turn sequence; the helper itself stays oblivious.

### `POST /api/projects/{p}/target-architectures/{t}/captured-decisions` (Spec 2)

- Existing insert-only write endpoint with atomic supersession of any prior row sharing the same `(decision_code, scope_kind, scope_ref_id)` tuple.
- This spec is the first caller. Every answered question, every cascade, every revision, every per-element exception, and every `system-skip` writes through this endpoint. No new write endpoint added by this spec.

### `ArchitectureElementMappingNotesDecorator` (Spec 2, AMS)

- Stateless helper that idempotently appends `[decision:<code>]` to a mapping notes string.
- Invoked from the new AMS apply-mapping-mutations endpoint for every affected mapping row.

### `TargetStateDecisionsContextResolver` + `MigrationDiscoveryContextDto.targetStateDecisionsSummary` (Spec 2)

- Resolver feeds the right-side summary panel's "Preview prompt-ready output" link in the UI and the close-summary generator's `summaryMarkdown` payload.
- The aggregation DTO block is the Spec 4 read surface — no change here, but populated for the first time by this spec.

### Spec 1 Target State sub-tab + `targetArchitecturesApi.ts`

- Host for the new Architect Conversation view-mode tab (peer to Table editor and Compare with current).
- Active-target lookup uses Spec 2's `GET /api/projects/{projectId}/active-target-architecture-id` via this client.

### `api-migration-validation-service/src/services/captureLoopRunner.ts`

- Pattern reference only — multi-round LLM loop with hard limits and structured-answer extraction. Not a runtime dependency; the new gateway loop is a simplified port.

### 2026-05-22 `architecture-scope-via-parent-not-leaf` spec

- Parent-chain semantic for reading affected mappings when applying mutations. The AMS endpoint's affected-set boundary follows this.

### AMS `PackageSetStandards` import infrastructure

- Background-only reference. The Q9 hardcoded seed map decision means this spec does NOT touch standards-registry storage. Future "Spec 5" will revisit.

## Implementation Notes

- **Spec 2 helper signatures are frozen** (per Q3). The transcript turn shape is this spec's interpretation of the `unknown` slot — no breaking change to `targetStateConversationStore.ts`.
- **The Q9 hardcoded seed map is deliberate** — it removes the v1 dependency on a standards-registry endpoint that does not exist yet for these 51 codes. `sourceStandardId` is still recorded per row for audit continuity, so the swap to runtime lookups (Spec 5) is a library refactor only with no captured-decision contract change.
- **The Q28 multi-commit boundary overrides the raw idea's "one commit" guideline.** Each commit listed under Commit Plan must be standalone-verifiable (compiles, tests green, the slice it ships works end-to-end at its level of completeness).
- **The Q12 `scope_ref_type` set is closed.** Library-loader validation rejects anything outside it; the exception sub-dialog entity picker filters by it. Adding a new value is a future spec change.
- **The Q19 13-kind turn union is closed for v1.** Adding a new kind is a future spec change with corresponding payload extras documented.
- **`@JsonNaming(LowerCamelCaseStrategy.class)`** on every new AMS DTO (matching the established pattern + Spec 2's DTOs).
- **Boxed numeric/boolean fields** on any new DTO (per `project_primitive_double_dto_overwrite.md`). This spec uses POST-only writes for decisions but stays consistent with the project pattern.
- **Plain-English naming** (per `feedback_no_invented_acronyms.md`): write "Architecture Model Service" rather than "AMS" in user-visible error messages and doc comments. Internal Java class names follow existing conventions.
- **Liquibase immutability** (per `feedback_liquibase_immutable_changesets.md`): this spec adds no new Liquibase changesets (no schema changes — the AMS apply-mapping-mutations endpoint reads and updates existing tables only). Confirm no changeset is needed during implementation; if any incidental schema work surfaces, add a brand-new changeset rather than editing an applied one.
- **Pre-existing test failures** (per project memory): the listed pre-existing failures are unrelated to this work and must not be touched. New tests in this spec are additive.
- **Trace the full pipeline before coding** (per `feedback_trace_before_coding.md`): walk the gateway loop → Spec 2 POST → AMS apply-mapping-mutations → transcript append end-to-end on paper before writing the orchestration code.
- **No edits to discovery-service source tree during in-flight runs** (per `feedback_no_src_edits_during_run.md`): this spec does not touch `discovery-service/src/**`; constraint does not apply.

## Commit Plan

Per Q28, this spec ships as multiple task groups with multiple commits — each standalone-verifiable. Suggested 6 commits aligned to the backend test groups and frontend surfaces:

### Commit 1 — Config artifacts only (no orchestration)

- New `gateway/src/config/architect-conversation/questionLibrary.ts` with all 51 entries enumerated per Appendix A (inline cascade seed maps per Q9, relevance predicates, `allowedExceptionScopes` per Q12).
- New `gateway/src/config/architect-conversation/mappingMutationRules.ts` with the v1 rules (db.engine, api.protocol, service.framework, service.language; notes-only for the rest).
- Backend test group 1 (library loader + validation): no duplicate codes, cascade refs resolve, scope values in the Q12 closed set, predicates well-formed.
- Standalone-verifiable: configs compile, types check, validation tests green.

### Commit 2 — Gateway-native LLM orchestration loop

- New `gateway/src/services/architectConversation/llmLoopRunner.ts` — simplified port of `captureLoopRunner` with the Q2 hard limits.
- Structured-answer parsing, default-when-unchanged path, round-budget and timeout enforcement, error-turn emission on breach.
- Backend test group 2 (LLM orchestration loop): all assertions mocked at the `gatewayClient.callLlmToolLoop` boundary per Q26.
- Standalone-verifiable: the loop runs against mocked LLM responses, enforces all limits, produces typed structured answers.

### Commit 3 — Decision capture flow + standards seed-map cascade plumbing

- Gateway orchestration code wiring the loop's structured answers to Spec 2's `POST .../captured-decisions`.
- Cascade-accept-batch logic writing N rows with a shared `conversation_turn_ref` per Q10.
- Standards seed-map cascade pre-fill: library entry's `sourceStandardId` recorded on every cascaded row.
- Backend test groups 3 (standards seed-map cascade) and 4 (decision capture, batch, revision).
- Standalone-verifiable: end-to-end "answer one question → row(s) appear in Spec 2's table with correct `standardsLookupRef`" works against a real AMS.

### Commit 4 — AMS apply-mapping-mutations endpoint + gateway client + orchestration integration

- New AMS `POST /api/projects/{p}/target-architectures/{t}/captured-decisions/{decisionId}/apply-mapping-mutations` endpoint inside one `@Transactional` per Q13.
- Gateway client method + orchestration wiring: after Spec 2 POST → invoke apply-mapping-mutations → append `mapping-mutation-summary` turn.
- Backend test group 5 (mapping mutation rules + endpoint): transactional, decorator invoked, `mapping_type` changes per rules, `created_by_task` untouched per Q14, parent-not-leaf scope per Q15, cross-project 404.
- Standalone-verifiable: a `db.engine` or `api.protocol` answer mutates the expected mappings under one transaction and decorates notes idempotently.

### Commit 5 — Frontend Architect Conversation tab + chat UI + cascade-summary + exception sub-dialog + revise-prior-answer + close flow

- New view-mode tab inside the Target State sub-tab (peer to Table editor + Compare with current).
- Empty-state with router push to Table editor and one-frame Suggest highlight per Q23.
- Start-conversation flow; chat main pane with left rail (LLM) + right rail (user); 60s per-turn timeout per Q18.
- Cascade-summary accept-batch UX with per-cascade override controls.
- Per-question "Set exception for…" sub-dialog with entity picker filtered per Q11.
- Right-side summary panel with running grouped-by-scope summary, deferred-vs-unanswered visual distinction, "Preview prompt-ready output" link, click-to-revise per prior decision.
- Revise-prior-answer flow with Q6 downstream-review banner.
- Close-conversation CTA gated on A.1 + B.1 + C.1 per Q8; writes `close` turn with inline `summaryMarkdown` per Q16.
- Retire-current-session handling per Q4.
- Backend test group 6 (conversation transcript: session markers, system-skip turns, edit-superseded turns, close summary).
- Frontend test surfaces 1–7 per Q27.
- Standalone-verifiable: user can complete a full conversation end-to-end against a real backend, see decisions populate Spec 2's resolver output, and close with a self-contained summary.

### Commit 6 — Verification

- End-to-end manual verification against the Verification Criteria in the Definition of Done.
- Any final fit-and-finish across commits 1–5 surfaced during verification.
- No new behaviour; this commit exists to bundle verification artefacts (screenshots, run logs) and to record sign-off in the spec's `verifications/` folder.

## Definition of Done

- The question library config compiles and validates (51 entries, no duplicate codes, cascades resolve, `allowedExceptionScopes` in the Q12 closed set, predicates well-formed).
- The mapping mutation rules config compiles and the v1 rules for `db.engine`, `api.protocol`, `service.framework`, `service.language` apply correctly; all other codes do notes-only decoration.
- The gateway LLM orchestration loop enforces the Q2 limits (5 rounds / 30s / 2-min) and produces typed structured answers; the LLM is mocked at the gateway client boundary for all tests.
- Every answered question writes a captured-decision row via Spec 2's POST endpoint; cascade-accept-batch writes N rows with a shared `conversation_turn_ref`; revisions write a new superseding row plus the Q6 banner payload.
- The new AMS `apply-mapping-mutations` endpoint runs inside a single `@Transactional`, invokes `ArchitectureElementMappingNotesDecorator`, applies `mapping_type` changes per the rules, never touches `created_by_task`, and respects the parent-not-leaf scope boundary.
- The Architect Conversation view-mode tab appears inside the Target State sub-tab (peer to Table editor and Compare with current); the empty-state, start, in-progress, cascade-summary, exception-sub-dialog, revise, retire-current, and close flows all work per the Specific Requirements.
- The transcript persists via Spec 2's `targetStateConversationStore.ts` with the 13-kind turn union and the per-kind payload extras from Q20; the close turn embeds the full `summaryMarkdown` inline per Q16.
- Spec 2's `TargetStateDecisionsContextResolver` starts emitting populated grouped-by-scope output instead of "no decisions captured yet" on any project where the architect has run the conversation.
- `MigrationDiscoveryContextDto.targetStateDecisionsSummary` starts emitting populated blocks for the same projects so Spec 4 can consume them as facts when it ships.
- All 6 backend test groups (4–8 tests each) and all 7 frontend test surfaces (4–8 tests each) pass; pre-existing failures from project memory are untouched.
- Each of the 6 commits in the Commit Plan was standalone-verifiable at the time of the commit; the final commit bundles verification sign-off.

## Appendix A — The 51-Question Library

Decision codes, prompts, expected answer shapes, cascade seed maps, default-when-unchanged values, and allowed exception scopes. All `cascades` entries inline `sourceStandardId` per Q9; runtime lookups are deferred to Spec 5. `Relevance` shorthand records the gateway-side predicate; `Exception scopes` lists the closed-set values the per-question exception sub-dialog accepts.

### Group A — Service runtime (6)

| # | Code | Prompt (fixed) | Answer shape | Default when unchanged | Cascades (downstream → value seed → source) | Exception scopes |
|---|------|----------------|--------------|------------------------|--------------------------------------------|------------------|
| A.1 | `service.language` | What language and major version should target services run on? | single-choice (Java 21, Java 17, Kotlin 2.0, C# 12, TypeScript/Node 20, Python 3.12, Go 1.22) | current language + version | `service.runtime` (Java 21 → JVM 21 / Kotlin 2.0 → JVM 21 / Node 20 → Node 20 LTS / Python 3.12 → CPython 3.12 / Go 1.22 → Go 1.22; `std.runtime.v1`); `testing.unit` (Java/Kotlin → JUnit 5; Node → Vitest; Python → pytest; Go → go test; `std.testing.unit.v1`); `dto.style` (Java 21 → records; Kotlin → data classes; TypeScript → interfaces; `std.dto.v1`); `build.tool` (Java → Gradle 8; Kotlin → Gradle 8; Node → npm + tsc; Python → uv; Go → go build; `std.build.v1`) | service, method, class |
| A.2 | `service.framework` | What application framework should target services use? | single-choice (Spring Boot 3.4, Quarkus 3, Micronaut 4, NestJS 10, FastAPI 0.115, Gin 1.10, ASP.NET 8) | current framework + version | `validation.framework` (Spring Boot 3 → Bean Validation 3; Quarkus → Hibernate Validator; NestJS → class-validator; FastAPI → Pydantic v2; `std.validation.v1`); `logging.framework` (Spring Boot 3 → SLF4J + Logback; Quarkus → JBoss Logging; NestJS → pino; FastAPI → structlog; `std.logging.v1`); `metrics.framework` (Spring Boot 3 → Micrometer; Quarkus → Micrometer; NestJS → prom-client; FastAPI → prometheus-client; `std.metrics.v1`) | service |
| A.3 | `service.runtime` | What runtime/JVM/container base should host the target services? | single-choice (Eclipse Temurin 21, GraalVM 21, Node 20 LTS, CPython 3.12-slim, Go 1.22 alpine, .NET 8) | current runtime | `container.baseImage` (Temurin 21 → eclipse-temurin:21-jre; Node 20 → node:20-slim; Python 3.12 → python:3.12-slim; Go → distroless/static; `std.container.base.v1`) | service |
| A.4 | `service.processModel` | What process model should each target service use? | single-choice (single-process, multi-process worker pool, async event loop) | current process model | (none) | service |
| A.5 | `service.config` | How should target services consume runtime configuration? | single-choice (env vars + 12-factor, Spring Cloud Config, Consul KV, ConfigMap-only) | current approach | `secrets.management` (12-factor → env-via-vault-injector; Spring Cloud Config → encrypted-properties; `std.secrets.v1`) | service |
| A.6 | `service.healthcheck` | What liveness/readiness/startup check contract should services expose? | single-choice (Spring Actuator, Kubernetes-style /healthz + /readyz, custom JSON contract) | current healthcheck shape | (none) | service |

### Group B — API surface (6)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| B.1 | `api.protocol` | What protocol(s) should the target expose externally? | multi-choice (REST/JSON, gRPC, GraphQL, SOAP-passthrough, AsyncAPI/Kafka) | current protocol set | `api.versioning` (REST → URL path /v1; gRPC → service.v1 package; GraphQL → field deprecation; `std.api.versioning.v1`); `api.contractFormat` (REST → OpenAPI 3.1; gRPC → proto3; GraphQL → SDL; SOAP → WSDL 1.1; `std.api.contract.v1`); `api.auth` (REST → OAuth2 + JWT; gRPC → mTLS + JWT; `std.api.auth.v1`) | interface, endpoint |
| B.2 | `api.versioning` | What versioning strategy for the target API surface? | single-choice (URL path, header-based, content-negotiation, semantic field deprecation) | current scheme | (none) | interface, endpoint |
| B.3 | `api.contractFormat` | What contract spec format owns the source of truth? | single-choice (OpenAPI 3.1, proto3, GraphQL SDL, AsyncAPI 3, WSDL 1.1) | current format | (none) | interface |
| B.4 | `api.auth` | What authentication/authorization stack should the target API surface use? | single-choice (OAuth2 + JWT, mTLS, API keys, session cookies + CSRF) | current scheme | `secrets.management` (OAuth2 → vault-injected client secrets; mTLS → cert-manager; `std.secrets.v1`) | interface, endpoint |
| B.5 | `api.errorContract` | What error response contract should endpoints emit? | single-choice (RFC 7807 Problem Details, custom JSON envelope, gRPC status, GraphQL errors[]) | current contract | (none) | endpoint |
| B.6 | `api.rateLimiting` | What rate-limiting / throttling strategy on the target API edge? | single-choice (gateway-enforced, per-service in-process, none) | current approach | (none) | interface, endpoint |

### Group C — Data persistence (6)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| C.1 | `db.engine` | What primary database engine should the target use? | single-choice (Postgres 18, MySQL 8.4, MS SQL Server 2022, Oracle 23ai, Sybase ASE 16, MongoDB 7, DynamoDB) | current engine | `db.migrations` (Postgres → Flyway 10; MySQL → Flyway 10; SQL Server → Flyway 10; Mongo → Mongock; `std.db.migrations.v1`); `db.connectionPool` (Postgres → HikariCP; SQL Server → HikariCP; Mongo → driver pool; `std.db.pool.v1`); `db.driver` (Postgres → pgjdbc; MySQL → mysql-connector-j; SQL Server → mssql-jdbc; `std.db.driver.v1`) | physical_data_entity, physical_data_attribute |
| C.2 | `db.migrations` | What schema-migration tool should manage target DDL? | single-choice (Flyway 10, Liquibase 4, Mongock, none-managed-by-app) | current tool | (none) | physical_data_entity |
| C.3 | `db.connectionPool` | What connection-pool implementation? | single-choice (HikariCP, Agroal, native driver pool, none) | current pool | (none) | service |
| C.4 | `db.transactionStrategy` | What transactional boundary strategy for target services? | single-choice (per-request, saga-orchestrated, no-transactions) | current strategy | (none) | service, method |
| C.5 | `db.readReplicaUsage` | Should the target use read replicas for read-heavy paths? | single-choice (yes-routed, yes-app-selected, no) | current usage | (none) | service, physical_data_entity |
| C.6 | `db.driver` | What database driver/adapter should target services use? | single-choice (pgjdbc, mysql-connector-j, mssql-jdbc, oracle ojdbc11, jtds, mongo-java-driver, dynamodb-enhanced) | current driver | (none) | service |

### Group D — Domain / DTO style (4)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| D.1 | `dto.style` | What DTO style should the target adopt? | single-choice (Java records, Kotlin data classes, Lombok @Value, TypeScript interfaces, Pydantic models, Go structs with tags) | current style | `validation.framework` (Java records → Bean Validation 3 on record components; Pydantic → built-in; TS interfaces → class-validator wrapper; `std.validation.v1`) | service, class |
| D.2 | `validation.framework` | What validation framework should target services use? | single-choice (Bean Validation 3, Hibernate Validator, class-validator, Pydantic v2, manual) | current framework | (none) | service, method |
| D.3 | `domain.mappingStrategy` | How should target services map between persistence entities and DTOs? | single-choice (MapStruct 1.6, manual mapper classes, ModelMapper, none-direct-entity-exposure) | current strategy | (none) | service, class |
| D.4 | `domain.errorModel` | How are domain errors propagated through the target service layer? | single-choice (typed exceptions, Result/Either, error codes on response envelope) | current model | (none) | service, method |

### Group E — Frontend (5 — relevance-gated; skipped automatically when target has no UI screens per Q7)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| E.1 | `ui.framework` | What frontend framework should the target UI use? | single-choice (React 18, Vue 3, Angular 17, Svelte 5, none-server-rendered) | current framework | `ui.buildTool` (React → Vite 5; Vue → Vite 5; Angular → Angular CLI; `std.ui.build.v1`); `ui.testing` (React → Vitest + Testing Library; Vue → Vitest + Testing Library; Angular → Karma + Jasmine; `std.ui.testing.v1`); `ui.stateManagement` (React → Redux Toolkit; Vue → Pinia; Angular → NgRx; `std.ui.state.v1`) | service |
| E.2 | `ui.buildTool` | What build tool for the target UI? | single-choice (Vite 5, Webpack 5, esbuild, Angular CLI) | current tool | (none) | service |
| E.3 | `ui.testing` | What testing stack for the target UI? | single-choice (Vitest + Testing Library, Jest + Testing Library, Karma + Jasmine, Playwright) | current stack | (none) | service |
| E.4 | `ui.stateManagement` | What client-side state management for the target UI? | single-choice (Redux Toolkit, Zustand, Pinia, NgRx, MobX, none-local-state-only) | current approach | (none) | service |
| E.5 | `ui.designSystem` | What design system / component library should the target UI use? | single-choice (MUI 6, Ant Design 5, Chakra v3, Tailwind + headless components, in-house) | current system | (none) | service |

### Group F — Cross-cutting (5)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| F.1 | `logging.framework` | What logging stack should target services use? | single-choice (SLF4J + Logback JSON, Log4j 2, pino, structlog, zap) | current stack | `logging.format` (SLF4J + Logback → JSON one-line; pino → JSON; structlog → JSON; `std.logging.format.v1`) | service |
| F.2 | `logging.format` | What log line format should target services emit? | single-choice (JSON one-line, key=value, plain text) | current format | (none) | service |
| F.3 | `metrics.framework` | What metrics emission library should target services use? | single-choice (Micrometer, prom-client, OpenTelemetry metrics, none) | current library | (none) | service |
| F.4 | `tracing.framework` | What distributed-tracing library? | single-choice (OpenTelemetry SDK, Spring Cloud Sleuth, Zipkin Brave, none) | current library | (none) | service |
| F.5 | `secrets.management` | How should target services source secrets? | single-choice (Vault injector, AWS Secrets Manager, Azure Key Vault, env vars from CI, encrypted-properties) | current source | (none) | service |

### Group G — Infrastructure (5)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| G.1 | `build.tool` | What build tool should target services use? | single-choice (Gradle 8, Maven 3.9, npm + tsc, uv, go build, dotnet 8) | current tool | (none) | service |
| G.2 | `container.runtime` | What container runtime / packaging? | single-choice (OCI image via Docker, Buildpacks, Jib, none-bare-metal) | current runtime | `container.baseImage` (cascade depends on `service.runtime` not this code; left empty here for clarity; `std.container.base.v1`) | service |
| G.3 | `container.baseImage` | What container base image family? | single-choice (eclipse-temurin:21-jre, node:20-slim, python:3.12-slim, distroless/static, ubi9-minimal) | current image | (none) | service |
| G.4 | `ci.pipeline` | What CI system should run the target build pipeline? | single-choice (GitHub Actions, GitLab CI, Jenkins, Azure DevOps Pipelines) | current CI | (none) | service |
| G.5 | `deployment.target` | What deployment target for the target services? | single-choice (Kubernetes 1.30, ECS Fargate, Cloud Run, on-prem VM, serverless functions) | current target | (none) | service |

### Group H — Inter-service communication (5)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| H.1 | `interservice.syncProtocol` | What synchronous inter-service call protocol? | single-choice (REST/JSON, gRPC, none-async-only) | current protocol | (none) | service, interface |
| H.2 | `interservice.asyncBus` | What async messaging bus? | single-choice (Kafka 3.7, RabbitMQ 3.13, AWS SQS, Azure Service Bus, none) | current bus | `interservice.messageFormat` (Kafka → Avro + Schema Registry; RabbitMQ → JSON; SQS → JSON; `std.async.format.v1`) | service |
| H.3 | `interservice.messageFormat` | What async message payload format? | single-choice (Avro + Schema Registry, JSON Schema, Protobuf, plain JSON) | current format | (none) | service, interface |
| H.4 | `interservice.discoveryMechanism` | How do target services discover each other? | single-choice (Kubernetes DNS, Consul, Eureka, hardcoded URLs from config) | current mechanism | (none) | service |
| H.5 | `interservice.retryStrategy` | What retry/backoff policy on inter-service calls? | single-choice (Resilience4j defaults, exponential w/ jitter, none-fail-fast) | current policy | (none) | service, interface |

### Group I — Testing (5)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| I.1 | `testing.unit` | What unit-test framework should target services use? | single-choice (JUnit 5, Vitest, pytest, go test, NUnit 4) | current framework | (none) | service, class |
| I.2 | `testing.integration` | What integration-test framework? | single-choice (Spring Boot Test + Testcontainers, Quarkus Test, Vitest + Testcontainers, pytest + testcontainers-python) | current framework | (none) | service |
| I.3 | `testing.e2e` | What end-to-end test framework? | single-choice (Playwright, Cypress, REST Assured, Karate, none) | current framework | (none) | service |
| I.4 | `testing.contractTesting` | What consumer-driven contract test framework? | single-choice (Pact 4, Spring Cloud Contract, none) | current approach | (none) | interface |
| I.5 | `testing.mocking` | What mocking library should unit tests use? | single-choice (Mockito 5, MockK, vi.mock, pytest-mock, gomock) | current library | (none) | service, class |

### Group J — Cut-over (4)

| # | Code | Prompt | Answer shape | Default when unchanged | Cascades | Exception scopes |
|---|------|--------|--------------|------------------------|----------|------------------|
| J.1 | `cutover.strategy` | What cut-over strategy for migrating from current to target? | single-choice (strangler fig, big-bang, blue-green, dark launch + shadow traffic) | (no current — required choice) | (none) | service, interface |
| J.2 | `cutover.dataMigration` | How does data migrate from current to target persistence? | single-choice (online dual-write + backfill, offline ETL with downtime, change-data-capture stream, none-shared-db) | (no current — required choice) | (none) | physical_data_entity |
| J.3 | `cutover.rollback` | What rollback plan if the cut-over fails? | single-choice (DNS flip back, traffic-shaped percentage rollback, restore-from-backup + replay) | (no current — required choice) | (none) | service, interface |
| J.4 | `cutover.parallelRunWindow` | How long should current and target run in parallel for verification? | single-choice (no parallel run, hours, days, weeks) | (no current — required choice) | (none) | service |

**Total: 51 questions** (A=6, B=6, C=6, D=4, E=5 relevance-gated, F=5, G=5, H=5, I=5, J=4).
