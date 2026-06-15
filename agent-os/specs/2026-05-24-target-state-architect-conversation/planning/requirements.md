# Spec Requirements: Target State Architect-Persona Conversation

## Initial Description

This is Spec 3 in a four-spec arc that lands the "functional like-for-like" migration workflow. Specs 1 and 2 are shipped:

- **Spec 1** (`2026-05-24-target-state-subtab-deterministic-suggest`) shipped the Target State sub-tab and a deterministic Suggest that produces a 1:1 structural clone of current state with equivalence mappings.
- **Spec 2** (`2026-05-24-target-state-captured-decisions-data-plane`) shipped the `target_state_captured_decisions` table, the POST endpoint to write a decision, the `targetStateConversationStore.ts` thread store helper, the `ArchitectureElementMappingNotesDecorator` for the `[decision:<code>]` tag, the `TargetStateDecisionsContextResolver`, and the `targetStateDecisionsSummary` block on `MigrationDiscoveryContextDto`.

**This spec is where the user value lands.** It is a multi-turn LLM-driven architect-persona conversation that asks the user ~51 questions across 10 concern groups (A–J) to turn the technology-naive cloned target (Spec 1 output) into one shaped by intentional, captured, evidence-cited technology decisions. Every answer writes a captured decision row through Spec 2's data plane and mutates the target meta-model in a contained way (mapping-type rewrites + notes decoration). Standards-driven cascades pre-fill downstream defaults (Java 21 → JUnit 5, Spring Boot 3.4 → Bean Validation, Postgres 18 → Flyway, etc) with per-element exception pinning. Until this spec ships, Spec 2's table stays empty in every environment, the captured-decisions resolver always returns "no decisions captured yet," and downstream PM tasks produce technology-naive output.

**Spec 4** (next, separate) updates `product-manager--migration-delivery-plan` and `product-manager--migration-shape-spec-generation` to consume the captured decisions as facts so downstream stories cite decision codes.

This is the largest of the four specs by a healthy margin and is expected to ship as multiple task groups with multiple commits.

## Settled Decisions From Raw Idea (Load-Bearing — Do Not Re-Litigate)

These 14 decisions were settled in the conversation that produced the raw idea and are treated as given:

1. **Multi-turn conversation pattern**, not one-shot LLM call. Closest precedent: `api-migration-validation-service/src/services/captureLoopRunner.ts`.
2. **Functional like-for-like is the strong default.** The conversation never proposes a non-equivalent target. Interfaces, endpoints, data entity shapes, HTTP contracts, physical data structures all preserved by default; only the technology basis changes per decision.
3. **Decision capture writes through Spec 2's data plane.** No new persistence layer. One POST per answer to `POST /api/projects/{p}/target-architectures/{t}/captured-decisions`.
4. **Conversation transcript persists via Spec 2's `targetStateConversationStore.ts`.** This spec defines the turn shape; the helper already exists and accepts `unknown` turns.
5. **~51 questions across 10 concern groups (A–J)**: A=Service runtime, B=API surface, C=Data persistence, D=Domain/DTO style, E=Frontend (only when UI present), F=Cross-cutting, G=Infrastructure, H=Inter-service communication, I=Testing, J=Cut-over.
6. **Cascading defaults.** Answering one question pre-fills standards-driven defaults for downstream questions. User can override individual cascaded defaults.
7. **Per-element exception pinning.** Architect sets defaults at the architecture level, then refines per-service / per-interface / per-element where exceptions exist (e.g. "default Spring Boot 3, except service X stays Spring Classic for compatibility").
8. **Standards-driven, evidence-cited.** Every cascaded default carries a `standardsLookupRef` so the audit trail records the basis. User overrides record a free-form reason captured on the decision row.
9. **UI lives in the Target State sub-tab** introduced by Spec 1. New "Architect Conversation" view-mode tab inside that sub-tab (peer to "Table editor" + "Compare with current").
10. **Decisions are insert-only at the data plane** (per Spec 2's contract). The UI can offer "go back and revise" interactions, but every revision writes a new superseding row.
11. **Mapping mutations happen as side-effects of decisions.** The decoration helper from Spec 2 tags notes with `[decision:<code>]`; some decisions also change `mapping_type` (e.g. SOAP → REST changes interface mappings from `equivalent` to `replaced_by`).
12. **Conversation gated on having an active target architecture.** If no target draft exists, the UI prompts the user to run Suggest first (Spec 1).
13. **One commit boundary per project pattern** — but see Q28 below: this spec splits into multiple task groups with multiple commits, each standalone-verifiable.
14. **No backfill** — only forward writes through the new conversation flow.

## Requirements Discussion

### First Round Questions and Answers

The user accepted all 28 spec-shaper recommendations as defaults, with three explicit confirmations (Q9 = option (a) hardcoded seed map; Q14 = accept; Q22 = accept). All recommendations below are the agreed positions.

**Q1 — LLM orchestration pattern**
**Answer:** Port `captureLoopRunner` as a simplified gateway-native variant. Multi-round loop with hard limits, but no `api-migration-validation-service` coupling. The new gateway helper is keyed to architect-conversation needs only.

**Q2 — Per-question round budget**
**Answer:** 5 LLM rounds per question, 30s per individual LLM call, 2-minute wall-clock per question. (Tightened from the raw idea's "3 rounds / 5 min" sketch.)

**Q3 — Threading model**
**Answer:** One thread file per target draft (re-use Spec 2's shipped path verbatim — do NOT extend Spec 2's helper). Sessions are logical segments inside the existing `turns[]` array, delimited by `open` and `close` turn markers. The store helper sees only `unknown` turns; session boundaries are this spec's interpretation of the turn sequence.

**Q4 — Concurrency (second user opens same target)**
**Answer:** Thread envelope carries a `currentSession.status='open'` marker. When a second user opens a draft whose envelope shows an open session, the UI offers a "retire current and start new" affordance. Choosing retire writes a synthetic `close` turn with `reason: 'retired-by-other-user'`, then opens a fresh session. v1 has no optimistic locking; UI prevention is sufficient.

**Q5 — Question ordering**
**Answer:** Enforce intra-group order (A.1 before A.2 before A.3…) but free inter-group order (user picks which group to tackle first, can jump between groups). Within a group the user follows the sequence.

**Q6 — Edit-after-answer cascade effect**
**Answer:** v1 surfaces a conversation-level banner: "you revised X — review downstream: [list of cascaded decision codes that consumed X]". Does NOT auto-rewrite the downstream cascaded answers. User manually re-visits and re-answers any cascaded decisions they want updated. Auto-cascade-replay deferred to a future spec.

**Q7 — Skip / relevance evaluation**
**Answer:** Gateway-side evaluation at conversation load (and on each captured-decision write that might unlock/lock a relevance gate). Auto-writes `not_applicable` silently for questions whose `relevanceCondition` evaluates false, plus an explanatory `system-skip` turn in the transcript. Relevance is expressed as a TypeScript predicate keyed by decision code (no expression language).

**Q8 — Close-conversation gate**
**Answer:** A.1 (`service.language`), B.1 (`api.protocol`), and C.1 (`db.engine`) are required to close. All other questions can be left as either:
- `'deferred'` (real captured-decision row written with `answer_value='deferred'`) — visible in summary as "deferred"
- Un-answered (no row at all) — visible in summary as "not yet considered"
The summary panel distinguishes the two states visually.

**Q9 — Standards data gap (HARDCODED SEED MAP — explicit user pick)**
**Answer:** **Option (a) — hardcoded seed map embedded directly in the question library config entries.** Each question entry's `cascades` field literally contains the standards-driven default values inline. No new standards-registry endpoint. `sourceStandardId` is still recorded on each cascaded decision row for audit, but the lookup that produced it is a static map this spec owns, not a runtime query against the standards registry.

A proper read endpoint (`GET /api/v1/standards/defaults-for?targetTech=<code>`) becomes a **future "Spec 5"** explicitly named here. When Spec 5 ships, the question library entries swap inline defaults for runtime lookups without changing the captured-decision contract.

**Q10 — Cascade UX granularity**
**Answer:** N rows written atomically on "accept all" — all sharing the same `conversation_turn_ref` so the transcript surface can show "these 5 decisions were cascaded from your answer to A.1". User can still individually override any one cascade before accepting the batch.

**Q11 — Exception sub-dialog entity picker**
**Answer:** Sourced from existing target-architecture read endpoints, filtered to the entity kinds the decision code permits (e.g. `service.framework` exception scope = service-only picker; `db.engine` exception = physical_data_entity-only picker).

**Q12 — `scope_ref_type` allowed values**
**Answer:** Document the closed set in spec.md: `service`, `interface`, `endpoint`, `physical_data_entity`, `physical_data_attribute`, `method`, `class`.

**Q13 — Mutation transactionality**
**Answer:** New AMS endpoint `POST /api/projects/{p}/target-architectures/{t}/captured-decisions/{decisionId}/apply-mapping-mutations` runs all mutation-rule effects inside a single `@Transactional` boundary on the AMS side. Gateway orchestrates: first writes the captured decision via Spec 2's POST, then invokes the new apply-mapping-mutations endpoint for that decision.

**Q14 — `created_by_task` retention (explicit user pick)**
**Answer:** Leave `created_by_task` alone on existing mapping rows (so the audit answer to "who first created this mapping row" stays as `target-state-suggest`). Do NOT add a new `last_modified_by_task` column for v1. The decoration via `[decision:<code>]` tag in notes is sufficient evidence that the architect conversation touched the row.

**Q15 — Affected-set boundary**
**Answer:** All mappings rooted under the target architecture's parent-not-leaf scope (per the 2026-05-22 architecture-scope-via-parent-not-leaf spec). Per-element exceptions narrow to a single element.

**Q16 — Summary doc content**
**Answer:** Markdown of the full grouped-by-scope summary embedded in the final `close` turn payload (self-contained — no re-query of the resolver needed at read time). The summary captures the conversation's terminal state.

**Q17 — Prompt ownership**
**Answer:** Fixed prompt strings in the question library. No LLM paraphrasing of the prompt itself. Each library entry has an optional `discoveryContextLead` field — a pre-built lead-in string the gateway prepends to the prompt (e.g. "Your current state uses Java 8 across 4 services. ..."). The lead-in is computed deterministically from discovery context at conversation-load time, not by the LLM.

**Q18 — Streaming vs polling**
**Answer:** Synchronous request/response per turn. 60-second per-turn frontend timeout. "Thinking…" spinner while waiting. Error toast on timeout (user can retry the turn). No SSE / streaming infrastructure in v1.

**Q19 — Extra turn kinds**
**Answer:** Add the following to the turn `kind` union (on top of the raw idea's set): `cascade-accepted`, `cascade-overridden`, `exception-pinned`, `edit-superseded`, `system-skip`, `error`. Full union:
```
'question' | 'answer' | 'cascade-summary' | 'cascade-accepted' |
'cascade-overridden' | 'decision-captured' | 'mapping-mutation-summary' |
'exception-pinned' | 'edit-superseded' | 'system-skip' | 'error' |
'open' | 'close'
```

**Q20 — Turn payload extras**
**Answer:**
- `decision-captured` turn payload carries: `decisionId`, `decisionCode`, `scope` (kind/refType/refId), `answerValue`, `standardsLookupRef`.
- `mapping-mutation-summary` turn payload carries: counts (`affectedMappings`, `mappingTypeChanges`, `notesDecorations`) plus a `tableSetSummary` (per-table-set breakdown).
- `cascade-summary` turn payload carries the proposed cascade list (each item: `decisionCode`, `proposedValue`, `sourceStandardId`).
- `cascade-accepted` / `cascade-overridden` payloads carry the `cascadedDecisions[]` list (each item: `decisionCode`, `answerValue`, `wasOverridden`, `overrideReason?`).

**Q21 — Active target lookup**
**Answer:** Use **only** Spec 2's `GET /api/projects/{projectId}/active-target-architecture-id` endpoint. "Active" = whatever that endpoint returns. No additional lookup logic in this spec.

**Q22 — Compare-view decision decoration (explicit user pick)**
**Answer:** **NO decoration in v1.** The Compare view stays exactly as Spec 1 ships. A future spec can layer per-element decision badges into the Compare view if the product calls for it.

**Q23 — Empty-state link (no active target draft)**
**Answer:** Soft router push to the Table editor view-mode with a one-frame highlight on the Suggest button (CSS animation: brief flash to draw the eye). No modal, no toast.

**Q24 — Question library file format**
**Answer:** TypeScript file at `gateway/src/config/architect-conversation/questionLibrary.ts`. Strongly typed (exports a `QuestionLibrary` type) so the loader gets compile-time validation. Not JSON — TypeScript so the relevance predicates and inline cascade defaults can be expressed as typed code.

**Q25 — Mapping mutation rules file format**
**Answer:** TypeScript file at `gateway/src/config/architect-conversation/mappingMutationRules.ts`. Same rationale as Q24.

**Q26 — Backend test breakdown**
**Answer:** 6 test groups, 4–8 tests each. LLM mocked at the `gatewayClient.callLlmToolLoop` (or equivalent gateway-native LLM boundary) so per-test execution is fast and deterministic. Groups roughly:
1. Question library loader + validation
2. LLM orchestration loop (limits, parsing, defaults)
3. Standards seed-map cascade pre-fill
4. Decision capture (POST to Spec 2's endpoint)
5. Mapping mutation rules + AMS apply-mapping-mutations endpoint
6. Conversation transcript turn append + close-with-summary

**Q27 — Frontend test breakdown**
**Answer:** 7 surfaces, 4–8 tests each:
1. Architect Conversation tab renders in Target State sub-tab
2. Empty-state when no active target (Q23 router push)
3. Start-conversation flow
4. Cascade-summary accept-batch UX
5. Per-question "set exception" sub-dialog
6. Close-conversation flow + retire-current handling (Q4)
7. Revise-prior-answer flow (with the Q6 banner)

**Q28 — Commit boundary (overrides raw idea's "one commit")**
**Answer:** Multiple task groups, multiple commits — one commit per task group, each standalone-verifiable. The raw idea's settled-decision #13 ("one commit per project pattern") is superseded for this spec because of its size. The spec.md must include an explicit **Commit Plan** section enumerating the expected commits (recommendation: align commits with the 6 backend test groups + the 7 frontend test surfaces, grouped into 4–6 commits that each ship working slices).

### Existing Code to Reference

**Similar Features Identified** (all already named in the raw idea + spec-shaper audit; no new references added by the user):

- **Spec 2 thread store**: `gateway/src/store/targetStateConversationStore.ts` — this spec writes turns through this helper without extending it. The helper accepts `unknown` turns; this spec defines the typed turn shape but stores them as the helper expects.
- **Spec 2 mapping notes decorator**: `ArchitectureElementMappingNotesDecorator` (on the AMS side) — used by the apply-mapping-mutations endpoint to tag notes with `[decision:<code>]`.
- **Spec 2 captured-decisions endpoint**: `POST /api/projects/{p}/target-architectures/{t}/captured-decisions` — every answered question writes through this. No new write endpoint for decisions in this spec.
- **Spec 2 resolver**: `TargetStateDecisionsContextResolver` — read by the UI's "preview prompt-ready output" link and by the close-summary generator.
- **Spec 2 aggregation block**: `MigrationDiscoveryContextDto.targetStateDecisionsSummary` — surfaces conversation results to downstream PM tasks (Spec 4 consumes this).
- **Spec 1 Target State sub-tab + API client**: the existing Target State sub-tab from Spec 1 + `targetArchitecturesApi.ts` — the new Architect Conversation view-mode tab lives inside that sub-tab as a peer to "Table editor" and "Compare with current".
- **LLM-loop precedent**: `api-migration-validation-service/src/services/captureLoopRunner.ts` — pattern reference only. The gateway gets its own simplified port (Q1), not a runtime dependency on api-migration-validation-service.
- **AMS PackageSetStandards import infrastructure**: background-only reference. The hardcoded seed map decision (Q9) means this spec does NOT touch standards-registry storage. Future "Spec 5" will revisit.

### Visual Assets

#### Files Provided
Bash check of `planning/visuals/` returned no files. The user explicitly confirmed "no visuals."

No visual assets provided.

#### Visual Insights
N/A — work from prose only.

## Requirements Summary

### Functional Requirements

#### F1. Question Library (config artifact)
- One TypeScript file `gateway/src/config/architect-conversation/questionLibrary.ts` exporting a strongly typed `QuestionLibrary`.
- ~51 entries, one per decision code, organised across groups A–J:
  - **A — Service runtime** (e.g. `service.language`, `service.framework`, `service.runtime`)
  - **B — API surface** (e.g. `api.protocol`, `api.versioning`, `api.auth`)
  - **C — Data persistence** (e.g. `db.engine`, `db.migrations`, `db.connection-pool`)
  - **D — Domain / DTO style** (e.g. `dto.style`, `validation.framework`)
  - **E — Frontend** (skipped automatically when no UI present)
  - **F — Cross-cutting** (logging, metrics, tracing)
  - **G — Infrastructure** (build tool, container runtime, CI)
  - **H — Inter-service communication**
  - **I — Testing** (unit, integration, e2e frameworks)
  - **J — Cut-over** (cut-over strategy, rollback)
- Per-entry fields:
  - `code` (e.g. `service.language`)
  - `group` (one of A–J)
  - `prompt` (fixed string — no LLM paraphrasing per Q17)
  - `discoveryContextLead?` (optional pre-built lead-in computed from discovery context at conversation load)
  - `expectedAnswerShape` (`free-text` | `single-choice` | `multi-choice` | `structured`)
  - `choices?` (when shape is `single-choice` / `multi-choice`)
  - `defaultsWhenUnchanged` (the "no change from current" value)
  - `cascades` — **inline hardcoded standards seed map per Q9** — each cascade entry contains:
    - `decisionCode` (the downstream code this answer pre-fills)
    - `valueByTriggerValue` (a map from this question's answer to the proposed downstream value)
    - `sourceStandardId` (literal string recorded for audit; the standards-registry pointer that Spec 5 will eventually look up dynamically)
  - `relevanceCondition?` (TypeScript predicate function, evaluated server-side per Q7)
  - `allowedExceptionScopes` (which `scope_ref_type` values can pin an exception for this code — drawn from the Q12 closed set)
- **Recommendation to spec-writer:** inline the full 51-question list in spec.md (or as an appendix in the same file). Do not split into a separate document.
- Loader-time validation tests (per Q26 backend test group 1): no duplicate codes, every cascade references a real downstream code, every relevance predicate references a real entity kind, every `allowedExceptionScopes` value is in the Q12 closed set.

#### F2. Mapping Mutation Rules (config artifact)
- One TypeScript file `gateway/src/config/architect-conversation/mappingMutationRules.ts`.
- Per decision code: which entity tables' mappings are affected, what default `mapping_type` change to apply (`none` | keep `equivalent` | switch to `replaced_by` | `renamed` | `merged` | `split`), and what scope it applies at.
- v1 rules (cover the obvious cases, exactly as in the raw idea):
  - `db.engine` change → physical_data_entity, physical_data_attribute, data_entity_points: keep `equivalent`, decorate notes
  - `api.protocol` change (SOAP → REST) → interface, endpoint: switch to `replaced_by`, decorate notes
  - `service.framework` change → service: keep `equivalent`, decorate notes
  - `service.language` change → method, class: keep `equivalent`, decorate notes
  - All others: notes decoration only, no `mapping_type` change
- Rules are deliberately simple in v1; Spec 4 and beyond may refine.

#### F3. LLM Orchestration (gateway-native loop)
- Port of `captureLoopRunner` pattern into the gateway. Lives somewhere like `gateway/src/services/architectConversation/llmLoopRunner.ts` (spec-writer to confirm path).
- Per Q2 limits: 5 rounds per question, 30s per LLM call, 2-minute wall-clock per question.
- Per turn the LLM receives:
  - The current question's fixed prompt (per Q17)
  - The user's free-text response (if any)
  - The captured-decisions context so far (via Spec 2's resolver)
  - The inline cascade seed map for this question (per Q9 — already in the library entry, just passed to LLM as context)
- LLM responsibilities:
  - Parse user free-text into a structured answer matching `expectedAnswerShape`
  - Propose the standards-driven cascades (which the gateway then surfaces to the user for accept-batch / individual override)
  - Surface ambiguity when user response is unclear (triggers another round, within the budget)
- LLM does NOT directly write decisions or mutate mappings — every write is gateway-orchestrated after structured-answer validation.
- LLM mocked at the gateway LLM-client boundary for tests (per Q26).

#### F4. Decision Capture
- After the gateway validates a structured answer (whether user-supplied, default-when-unchanged, or cascaded), it writes a captured-decision row via Spec 2's `POST /api/projects/{p}/target-architectures/{t}/captured-decisions`.
- For cascade-accept-batch (Q10): N decisions written atomically — all sharing the same `conversation_turn_ref` value so the transcript surface can show "these 5 decisions cascaded from your answer to A.1".
- Edit-after-answer: any revision writes a new superseding row (insert-only per settled decision #10). Plus the conversation-level banner per Q6 listing downstream cascaded decisions to review.

#### F5. Mapping Mutation Orchestration
- New AMS endpoint per Q13: `POST /api/projects/{p}/target-architectures/{t}/captured-decisions/{decisionId}/apply-mapping-mutations`.
- Runs all mapping-mutation effects for that decision inside a single `@Transactional` boundary on the AMS side.
- Reads the mapping-mutation-rules config from the gateway request body (gateway passes the relevant rule subset for the decision code).
- For each affected mapping row:
  - Decorate notes via Spec 2's `ArchitectureElementMappingNotesDecorator` with the `[decision:<code>]` tag.
  - If the rule dictates a `mapping_type` change, apply it.
  - **Do NOT touch `created_by_task`** (per Q14).
- Affected-set boundary per Q15: all mappings rooted under the target architecture's parent-not-leaf scope. Per-element exceptions narrow to single element.
- Gateway orchestration: writes captured decision (F4) → invokes apply-mapping-mutations endpoint (F5) → appends `mapping-mutation-summary` turn (F6).

#### F6. Conversation Transcript Turn Shape
- Stored via Spec 2's `targetStateConversationStore.ts` as `unknown` turns in the `turns[]` array — this spec defines the typed shape.
- Turn kinds (per Q19):
  ```
  'question' | 'answer' | 'cascade-summary' | 'cascade-accepted' |
  'cascade-overridden' | 'decision-captured' | 'mapping-mutation-summary' |
  'exception-pinned' | 'edit-superseded' | 'system-skip' | 'error' |
  'open' | 'close'
  ```
- Per Q20 payload extras:
  - `decision-captured`: `decisionId`, `decisionCode`, `scope`, `answerValue`, `standardsLookupRef`
  - `mapping-mutation-summary`: `affectedMappings`, `mappingTypeChanges`, `notesDecorations`, `tableSetSummary`
  - `cascade-summary`: `cascadedDecisions[]` (each: `decisionCode`, `proposedValue`, `sourceStandardId`)
  - `cascade-accepted` / `cascade-overridden`: `cascadedDecisions[]` (each: `decisionCode`, `answerValue`, `wasOverridden`, `overrideReason?`)
  - `exception-pinned`: `decisionCode`, `scope` (with `refType` + `refId`), `answerValue`
  - `edit-superseded`: `originalDecisionId`, `newDecisionId`, `affectedDownstreamCodes[]` (the cascade-review list per Q6)
  - `system-skip`: `decisionCode`, `relevanceReason`
  - `error`: `errorKind`, `errorMessage`, `recoverableHint?`
  - `open`: `sessionId`, `openedBy`
  - `close`: `sessionId`, `closeReason` (`'completed-by-user'` | `'retired-by-other-user'`), `summaryMarkdown` (per Q16 — full grouped-by-scope markdown embedded inline)

#### F7. Threading + Session Model
- Per Q3: one thread file per target draft, exactly Spec 2's shipped path. Do NOT extend Spec 2's helper signature.
- Sessions are logical segments inside `turns[]`, delimited by `open` and `close` turn markers.
- Per Q4: thread envelope carries `currentSession.status='open'` marker (this spec interprets it; Spec 2's helper just stores `unknown`).
- Second-opener concurrency:
  - If envelope shows open session AND opener is a different user → UI offers "retire current and start new" affordance
  - On retire → write synthetic `close` turn with `reason: 'retired-by-other-user'`, then open new session
  - No optimistic locking in v1

#### F8. Question Ordering + Skip Semantics
- Per Q5: intra-group order enforced (A.1 → A.2 → A.3), inter-group order free.
- Per Q7: at conversation load, gateway evaluates each question's `relevanceCondition` predicate.
  - For each question whose predicate returns false: silently auto-write a captured-decision row with `answer_value='not_applicable'` + append `system-skip` turn.
  - Re-evaluate on each captured-decision write that might unlock or lock a gate.
- Per Q8: close-conversation gate = A.1 (`service.language`) + B.1 (`api.protocol`) + C.1 (`db.engine`) must be answered. Other questions can be:
  - `'deferred'` (real row written, `answer_value='deferred'`) — distinct visual treatment in summary
  - Un-answered (no row at all) — distinct visual treatment in summary

#### F9. UI — Architect Conversation View-Mode Tab
- New view-mode tab inside the Target State sub-tab (peer to "Table editor" + "Compare with current"). Per settled decision #9.
- **Empty-state (no active target draft):** soft router push to Table editor view-mode with one-frame highlight on the Suggest button (per Q23). No modal/toast.
- **Active target, no conversation started:** "Start conversation" button.
- **Active target, retired/closed prior session:** show the prior closed transcript read-only + "Start new conversation" button (writes a new logical session inside the same thread file).
- **Conversation in progress (main pane — chat-style):**
  - Left rail: LLM messages (question prompts with `discoveryContextLead` prepended, cascade summaries, mutation summaries)
  - Right rail: user responses + structured-answer chips ("accept default", "no change", free-text input)
  - Per-question affordance: "Set exception for…" button that opens a sub-dialog (entity picker filtered per Q11 by the decision code's `allowedExceptionScopes`)
  - Cascade-summary turn shows accept-all + per-cascade override controls; on accept-all the gateway writes the N rows atomically (per Q10)
  - Per-turn 60-second frontend timeout (per Q18); "Thinking…" spinner; error toast on timeout; user can retry
- **Right-side summary panel (always visible during conversation):**
  - Running grouped-by-scope summary of captured decisions
  - Visual distinction for `'deferred'` rows vs un-answered (per Q8)
  - "Preview prompt-ready output" link → shows what Spec 2's resolver would emit right now
  - Each prior decision is clickable to revise (opens the same exception sub-dialog or the answer-edit flow)
- **Revise-prior-answer flow:** edit triggers a new superseding row (insert-only) + the conversation-level banner per Q6 listing downstream cascaded decisions to review.
- **Close-conversation CTA:** only enabled when A.1 + B.1 + C.1 are answered (per Q8). Writes a `close` turn with `summaryMarkdown` embedded inline (per Q16).
- **Second-opener concurrency:** "conversation in progress by [user] — wait, or retire and start new" affordance per F7.

#### F10. Standards Registry Integration (degraded for v1)
- **Per Q9: no runtime standards-registry calls in v1.** Cascade defaults are inline in the question library entries (`cascades[].valueByTriggerValue`).
- Each cascaded decision row still records `standards_lookup_ref` (set to the inline `sourceStandardId`) for audit continuity.
- **Future "Spec 5" (referenced inline in spec.md):** introduces `GET /api/v1/standards/defaults-for?targetTech=<code>` and migrates the question library entries from inline to runtime lookups. The captured-decision contract does not change.

#### F11. Active Target Architecture Lookup
- Per Q21: use **only** Spec 2's `GET /api/projects/{projectId}/active-target-architecture-id` endpoint to determine the active target. "Active" = whatever that endpoint returns. No fallback logic.

#### F12. Compare View (out of scope for v1 decoration)
- Per Q22: NO decoration in v1. Compare view stays exactly as Spec 1 ships. Future spec can layer per-element decision badges.

### Reusability Opportunities

(Verbatim from the "Existing Code to Reference" section above.)

- `gateway/src/store/targetStateConversationStore.ts` — write turns through, don't extend
- `ArchitectureElementMappingNotesDecorator` (AMS) — used by the new apply-mapping-mutations endpoint
- `POST /api/projects/{p}/target-architectures/{t}/captured-decisions` (Spec 2) — every decision write
- `TargetStateDecisionsContextResolver` (Spec 2) — UI preview link + close-summary generator
- `MigrationDiscoveryContextDto.targetStateDecisionsSummary` (Spec 2) — Spec 4 read surface (no change needed here)
- Spec 1 Target State sub-tab + `targetArchitecturesApi.ts` — host for the new view-mode tab
- `api-migration-validation-service/src/services/captureLoopRunner.ts` — pattern reference only (not a runtime dep)
- AMS PackageSetStandards import infrastructure — background-only reference; the Q9 hardcoded seed map decision means this spec does NOT touch standards storage. Spec 5 will revisit.
- `GET /api/projects/{projectId}/active-target-architecture-id` (Spec 2) — the only active-target lookup used here

### Scope Boundaries

#### In Scope
- Question library config (TypeScript file, ~51 entries with inline cascade seed map per Q9)
- Mapping mutation rules config (TypeScript file)
- Gateway-native LLM orchestration loop (port of `captureLoopRunner` pattern, simplified)
- Gateway proxy + orchestration logic for: question lifecycle, cascade evaluation, decision capture, mapping-mutation invocation, transcript writes
- New AMS endpoint `POST /api/projects/{p}/target-architectures/{t}/captured-decisions/{decisionId}/apply-mapping-mutations` (single `@Transactional` per decision)
- Frontend "Architect Conversation" view-mode tab inside the Target State sub-tab (per the 7 UI surfaces in F9)
- Per-question "Set exception for…" sub-dialog (entity picker filtered per Q11)
- Right-side summary panel with "preview prompt-ready output" link
- Close-conversation flow + inline `summaryMarkdown` in the `close` turn (per Q16)
- Retire-current-session affordance for concurrent users (per Q4)
- Revise-prior-answer flow + conversation-level downstream-review banner (per Q6)
- Turn shape definitions + 13 turn kinds with typed payloads (F6)
- Question-relevance predicates + auto-skip with `system-skip` turns (per Q7)
- Close-conversation gate enforcing A.1 + B.1 + C.1 (per Q8)
- Backend tests: 6 groups × 4–8 tests each (per Q26)
- Frontend tests: 7 surfaces × 4–8 tests each (per Q27)

#### Out of Scope
- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` → **Spec 4**
- Standards-registry data itself / runtime defaults-for endpoint → **future "Spec 5"** (referenced inline in spec.md)
- Architecture-element creation surfaces (Spec 1 removed Add Component / API / etc — not re-introduced)
- Diagram authoring on target → future spec
- Branching conversations (parallel "what-if" target drafts with alternative decisions) → future spec
- LLM-driven mapping mutation logic — v1 uses deterministic rules config (per F2)
- Auto-cascade-replay when an upstream decision is superseded — v1 surfaces the review banner only (per Q6); auto-replay is a future spec
- Compare-view decision decoration → future spec (per Q22)
- A `last_modified_by_task` column on mapping rows → not added (per Q14)
- SSE/streaming for LLM turns → synchronous only in v1 (per Q18)
- Optimistic locking on the thread file → UI prevention only in v1 (per Q4)
- End-to-end real-LLM tests — LLM mocked at the gateway client boundary (per Q26)

### Technical Considerations

#### Architecture + Integration Points
- **Gateway (Express/TypeScript):** owns the question library config, the mapping-mutation rules config, the LLM orchestration loop, conversation lifecycle endpoints, decision-write orchestration, and the proxy to the new AMS apply-mapping-mutations endpoint.
- **AMS (Java/Spring Boot):** owns the new `POST .../apply-mapping-mutations` endpoint (single `@Transactional`). Re-uses Spec 2's `ArchitectureElementMappingNotesDecorator`.
- **Frontend (React/TypeScript):** new view-mode tab inside the existing Target State sub-tab. Uses Spec 1's `targetArchitecturesApi.ts` for active-target lookup + Spec 2's captured-decisions read endpoints for the summary panel.
- **Spec 2 thread store:** `targetStateConversationStore.ts` used as-is. This spec's typed turn shape is interpreted in the architect-conversation code, not in the store helper.

#### Hardcoded Standards Seed Map (Q9 — critical)
- The question library entries themselves carry the standards-driven defaults inline (`cascades[].valueByTriggerValue` + `sourceStandardId`). No runtime call to the standards registry in v1.
- This is a deliberate scoping choice: it removes the v1 dependency on a standards-registry endpoint that doesn't yet exist for these 51 codes.
- `sourceStandardId` is still recorded on every cascaded decision row so the audit trail's "why we proposed JUnit 5" stays intact.
- When the future "Spec 5" lands the dynamic `GET /api/v1/standards/defaults-for` endpoint, the question library entries swap inline defaults for runtime lookups. The captured-decision contract is unchanged — this is a library refactor only.

#### Existing Patterns to Follow
- `@JsonNaming(LowerCamelCaseStrategy.class)` on any new DTOs (per raw idea dependencies + established AMS pattern).
- The 2026-05-22 `architecture-scope-via-parent-not-leaf` spec's parent-chain semantic for reading affected mappings (per Q15).
- `captureLoopRunner` pattern from `api-migration-validation-service` for the LLM loop, simplified for gateway-native use (per Q1).

#### Constraints
- Decisions are insert-only at the data plane (settled decision #10). All revisions = new superseding row.
- No backfill — only forward writes through this conversation flow (settled decision #14).
- `created_by_task` on mapping rows stays as the original (`target-state-suggest`); no new `last_modified_by_task` column (per Q14).
- One thread file per target draft (per Q3 — Spec 2's path verbatim).

#### Commit Plan (per Q28 — spec.md must enumerate)
- The raw idea's "one commit boundary" is **superseded for this spec** because of its size.
- Spec.md must include a **Commit Plan** section enumerating expected commits, each standalone-verifiable.
- Suggested grouping (spec-writer to refine):
  1. Question library config + loader/validation tests + mapping mutation rules config (no behaviour yet)
  2. AMS apply-mapping-mutations endpoint + AMS tests
  3. Gateway LLM orchestration loop + decision-capture orchestration + cascade evaluation + backend tests
  4. Gateway transcript turn writes + close-summary generation + backend tests
  5. Frontend Architect Conversation tab shell + empty-state + start-conversation flow
  6. Frontend in-conversation surfaces (cascade UX, exception sub-dialog, summary panel, revise flow, retire-current handling, close flow)
- Each commit must verify standalone (compile + tests green + the slice it ships works end-to-end at its level of completeness).

#### Test Coverage Plan
- **Backend (6 groups × 4–8 tests):**
  1. Question library loader + validation (no dup codes, cascade refs resolve, predicates well-formed, allowedExceptionScopes in Q12 closed set)
  2. LLM orchestration loop (5 rounds, 30s call, 2-min wall-clock; structured-answer parsing; default-when-unchanged path; mocked at gateway LLM-client boundary)
  3. Standards seed-map cascade pre-fill (inline values surface correctly per Q9; `sourceStandardId` recorded)
  4. Decision capture (POST to Spec 2's endpoint; cascade-accept-batch writes N rows atomically with shared `conversation_turn_ref` per Q10)
  5. Mapping mutation rules + AMS apply-mapping-mutations endpoint (transactional, decorator invoked, `mapping_type` changes per rules, `created_by_task` untouched per Q14, parent-not-leaf scope per Q15)
  6. Conversation transcript (turn append via Spec 2 helper; session open/close markers; relevance auto-skip writes `system-skip` turn; edit-superseded turn; close-with-inline-summary per Q16)
- **Frontend (7 surfaces × 4–8 tests):**
  1. Architect Conversation tab renders in Target State sub-tab
  2. Empty-state (router push to Table editor + one-frame highlight on Suggest per Q23)
  3. Start-conversation flow
  4. Cascade-summary accept-batch UX (accept-all, per-cascade override)
  5. Per-question "Set exception" sub-dialog (entity picker filtered per Q11)
  6. Close-conversation flow + retire-current handling (per Q4)
  7. Revise-prior-answer flow (with Q6 downstream-review banner)

### Verification Criteria (from Raw Idea)

After this spec ships:
- A user with a target draft (from Spec 1) can open the Architect Conversation tab in the Target State sub-tab.
- They walk through (intra-group order; free inter-group order) the ~51 questions across A–J, with inline standards-driven cascading defaults pre-filled.
- Every answered question writes a captured-decision row (Spec 2's table), updates the conversation transcript (Spec 2's thread store), and mutates affected mapping rows per the rules config (decorating notes via Spec 2's helper, switching `mapping_type` where rules dictate).
- Per-element exception pinning works: architect can set "default Spring Boot 3, except service X stays Spring Classic" — both decision rows exist with appropriate scope.
- Spec 2's resolver starts producing populated grouped-by-scope output instead of "no decisions captured yet."
- The aggregation endpoint starts emitting populated `targetStateDecisionsSummary` blocks.
- Spec 4 (next, separate) can immediately consume the decisions in PM-task prompts because Spec 2's contract is unchanged.
- Close-conversation produces an inline markdown summary embedded in the `close` turn (per Q16) — self-contained read at any later time.

## Notes for the Spec-Writer

1. **Inline the full 51-question library in spec.md.** Do not split into a separate document. Spec 4 and downstream consumers should be able to grep the spec for any decision code.
2. **Q9's "hardcoded seed map" decision is significant.** Make sure spec.md explains clearly that the question library entries themselves carry the cascade defaults inline (in `cascades[].valueByTriggerValue`), not via a runtime lookup. Cross-reference "future Spec 5" explicitly so a future reader knows the swap is anticipated.
3. **Spec.md must include a Commit Plan section enumerating the expected commits** (per Q28). The suggested 6-commit grouping above is a starting point; refine based on the task-list pass.
4. **Spec.md should decompose into multiple task groups** matching the commit boundaries — each task group standalone-verifiable.
5. **The 14 settled decisions are load-bearing** — quote them at the top of spec.md so a future reader doesn't re-litigate.
6. **All 28 question answers are positions, not options.** Do not re-open them as alternatives in spec.md.
7. **Document the closed `scope_ref_type` set** explicitly in spec.md (per Q12): `service`, `interface`, `endpoint`, `physical_data_entity`, `physical_data_attribute`, `method`, `class`.
8. **Document the full 13-kind turn union** explicitly in spec.md (per Q19) with each kind's typed payload (per Q20).
