# Spec Requirements: Target State Captured Decisions — Data Plane

## Initial Description

This is Spec 2 in a four-spec arc that takes the Target State sub-tab from "structural 1:1 clone of current state" (Spec 1) to "architecture-aware migration brief that feeds the PM book of work and shape-spec generation" (Spec 4).

Spec 1 shipped a deterministic Suggest that produces a target state which is a structural clone of current state with an equivalence mapping per element. The target is technology-naive — it preserves the current state's runtime, framework, persistence engine, API protocol, etc., because nothing in the data flow has captured "these things are changing for the migration."

Spec 3 will run an architect-persona conversation that asks ~50 questions across 10 concern groups (service runtime, API surface, data persistence, DTO style, frontend, cross-cutting, infrastructure, inter-service communication, testing, cut-over) and captures answers as first-class evidence. Spec 4 will update the existing PM Book of Work and Shape-Spec generation prompts to consume those decisions as facts.

**This spec — Spec 2 — is the foundational data plane both Spec 3 and Spec 4 require.** It builds the rails before the train arrives:

- A durable AMS table for captured decisions (one row per answered question, scoped architecture-wide / per-service / per-interface / per-element).
- Conversation thread persistence (the full multi-turn architect conversation as a JSON thread on disk, alongside the existing migration-conversation thread infra).
- A gateway resolver that surfaces the captured decisions as bounded, prompt-ready summary text — registered under `KNOWN_CONTEXT_KEYS`.
- An additive extension to the existing `MigrationDiscoveryContextDto` aggregation endpoint so captured decisions ride along with the migration context every downstream task already consumes.
- A small, shared utility for decorating `architecture_element_mappings.notes` with decision-code citations.

After this spec ships, the captured decisions table will exist but will be empty in any environment (nothing writes to it yet). The resolver will resolve to a "no decisions captured yet" copy for every project until Spec 3 starts writing. That's the correct end state for this spec — rails in place; train is Spec 3.

## Requirements Discussion

### Settled Decisions (carried in from raw-idea — load-bearing, not re-asked)

**D1: Captured decisions are first-class persisted evidence**, not transient state. They survive across sessions, across architectures, across project re-opens.

**D2: Conversation transcript persists alongside the decisions**, not in place of them. The transcript records reasoning chain (which standards lookups were considered, which alternatives were explored, what the architect said yes/no to in their own words). The decisions table records the extracted answers. Both matter.

**D3: Decision codes are stable, opaque strings** (`db.engine`, `api.protocol`, `service.framework`, etc. — full ~50 list defined by Spec 3). Free-form text answers attached. New decision codes can be added by Spec 3 without DDL.

**D4: Scope is required on every decision row** — one of `architecture` / `service:<id>` / `interface:<id>` / `element:<type>:<id>`. Lets the architect set defaults then refine per-element exceptions.

**D5: Standards lookup reference is optional per decision** (nullable string ref) — pre-recorded for audit (`"why JUnit 5?" → standards lookup id X says: for Java 21 / JUnit 5 is the default`).

**D6: Decisions are immutable once written.** To "change" a decision, write a new row that supersedes the previous one. Latest row per `(decision_code, scope)` wins for downstream reads. Audit trail survives because the prior row stays.

**D7: The resolver returns a bounded summary**, not raw rows. Same pattern as the existing `migration-discovery-context` resolver — it picks the right slice and renders prompt-ready text with citations.

**D8: The aggregation endpoint extension is additive** — `MigrationDiscoveryContextDto` gains a new `targetStateDecisionsSummary` block; nothing existing changes shape.

**D9: Mapping-notes decoration is a write-side concern** — when a decision writes/updates an `architecture_element_mappings` row, the decision_code goes into the notes field via a shared helper, so downstream consumers can grep for it. Helper is small and stateless.

**D10: One commit boundary** per existing project pattern.

**D11: No frontend changes** in this spec.

### Shape-Spec Clarifying Questions and Answers

**Q1:** Where does the thread persistence helper live — AMS or gateway?
**Answer:** Gateway. Create a new sibling file `targetStateConversationStore.ts` rather than extending the existing `threadStore.ts`. Mirrors the existing migration-conversation thread I/O pattern. Spec 3 can refactor if it needs different mechanics.

**Q2:** Should the `target_state_captured_decisions` table FK to `architecture_element_mappings`?
**Answer:** No. Keep the decision row clean; reverse-discover via the mapping notes' `[decision:code]` tag (provided by the notes-decoration helper). No join table.

**Q3:** Should decisions be revisable mid-conversation, or only via a fresh supersedes row?
**Answer:** Insert-only at the data plane. No PATCH/PUT/DELETE on captured decisions — only POST and GET. The conversation UI in Spec 3 can sugar the "go back and revise" interaction however it wants; the data plane sees only inserts.

**Q4:** What's the read shape on the resolver — flat, grouped-by-code, or grouped-by-scope?
**Answer:** Grouped by scope. Architecture-wide first, then per-service / per-interface / per-element overrides. Matches how the architect thinks about the decisions and the rough resolver output sketched in the raw idea.

**Q5:** Should the resolver include the conversation transcript or just decisions?
**Answer:** Decisions only. No transcript resolver registered in this spec. The transcript is queryable separately by anything that needs it (Spec 3 owns that).

**Q6:** Mapping-notes decoration format?
**Answer:** Code-only string tag: `[decision:db.engine]` appended to the existing notes string. Stable across supersessions (always the decision_code, never the row id), greppable, human-readable, idempotent (helper never duplicates), no schema change to the mappings table.

**Q7:** Are decision codes validated against a known enum on the AMS side?
**Answer:** No. Open-ended strings. Spec 3 owns the question library and is the single writer; AMS just persists. The spec should document the typo cost ("if a typo like `db.enigne` gets through, it'll surface as 'no decisions found' downstream and the architect can re-answer").

**Q8:** `scope_kind='element'` shape — when do we populate `scope_ref_type`?
**Answer:** `scope_ref_type` is populated only when `scope_kind='element'` (where we don't know the supertype table at write time without it). Null when `scope_kind` is `architecture`, `service`, or `interface` (those have their own supertype tables and `scope_ref_id` is sufficient). **Add a CHECK constraint to enforce this invariant.**

**Q9:** What's the `created_by_task` default — DB default or caller-supplied?
**Answer:** NOT NULL with no DB-level default. Callers must pass it explicitly. Spec 3 will pass `architect-persona-conversation`; future tasks pass their own task identifier.

**Q10:** Should we ship with a seed migration changeset that registers the resolver in `KNOWN_CONTEXT_KEYS`?
**Answer:** No. `KNOWN_CONTEXT_KEYS` lives in code (`gateway/src/services/contextResolvers.ts` or its registry). Code edit only, no changeset.

**Q11:** How does the gateway resolver find the active target architecture for a project?
**Answer:** If a helper endpoint like `GET /api/projects/{projectId}/active-target-architecture-id` doesn't already exist on AMS, **add it as part of this spec**. The resolver calls that endpoint, then calls the captured-decisions endpoint with the resulting `targetArchitectureId`.

**Q12:** Resolver behaviour when no active target architecture exists for the project?
**Answer:** Return a **distinct copy** — "no target architecture defined yet" — different from the "no decisions captured yet" copy returned when a target architecture exists but has no decisions on it. Downstream prompt consumers can distinguish the two states.

**Q13:** `includeTargetStateDecisions` flag placement — query param or body field?
**Answer:** Body field on the aggregation request DTO. Matches the existing pattern used by the other include-flags on the aggregation request.

**Q14:** Resolver size cap?
**Answer:** No cap in this spec. Trust Spec 3's question library to stay reasonable (~50 questions, each with a short answer summary). If size becomes a problem later, address in a follow-up spec.

**Q15:** Cross-project leak protection?
**Answer:** Yes. The service layer verifies that the loaded decision row's `project_id` and `target_architecture_id` match the values in the request path. If they don't, return 404 (not 403 — don't leak existence). Applies to GET-single and POST-supersede paths.

**Q16:** Thread file shape — does this spec define turn shape?
**Answer:** Minimal envelope only: `{ schemaVersion: 1, threadId, turns: any[] }`. Spec 3 defines the turn shape. The helper just provides durable load/append against `turns[]` without inspecting elements.

**Q17:** Thread helper module placement — extend existing or new file?
**Answer:** New file (`targetStateConversationStore.ts`), not extension of `threadStore.ts`. Same gateway location as the existing thread infra. (Same decision as Q1, restated for the writer's benefit.)

**Q18:** Test count per group?
**Answer:** All 6 test groups, 2-4 tests per group. (Within the 2-8 per-group cap the project pattern allows; staying toward the lower end to keep the commit reviewable.)

### Existing Code to Reference

**Similar features identified (named by the raw idea — spec-writer should consult these directly, not via this agent):**

- **`threadStore.ts`** (gateway) — existing thread file I/O for the migration-conversation. The new `targetStateConversationStore.ts` should mirror its load/append API shape and its `{projectParentFolder}/threads/...` path convention.
- **The existing `migration-discovery-context` resolver** (gateway, under `contextResolvers.ts` or sibling) — the new `target-state-decisions-context` resolver should follow its registration shape, its KNOWN_CONTEXT_KEYS entry style, and its "render bounded prompt-ready text with citations" output style.
- **`MigrationDiscoveryContextDto`** (AMS) — the aggregation DTO to extend additively with `targetStateDecisionsSummary`.
- **Selective-Copy DTOs** (AMS) — established the `@JsonNaming(LowerCamelCaseStrategy.class)` pattern. New DTOs in this spec follow the same pattern (companion to the Bug #2 fix called out in the raw idea).
- **`KNOWN_CONTEXT_KEYS` registry** (gateway, alongside the context resolvers file) — add the new key here, no DB changeset.

**User confirmed:** No additional code-reuse references beyond those above.

### Follow-up Questions

None. All 18 questions were resolved to the spec-shaper's recommended defaults, and no contradictions or critical gaps surfaced while consolidating the answers against the raw-idea.

## Visual Assets

No visual files found. Visuals folder does not exist for this spec. Work from prose only.

## Requirements Summary

### Functional Requirements

**AMS — Schema (one Liquibase changeset, next free number after current tail):**

- New table `target_state_captured_decisions` with columns:
  - `id` UUID PK
  - `project_id` UUID NOT NULL
  - `target_architecture_id` UUID NOT NULL
  - `decision_code` VARCHAR NOT NULL (stable opaque code; no enum validation, open-ended)
  - `scope_kind` VARCHAR NOT NULL — one of `architecture` / `service` / `interface` / `element`
  - `scope_ref_type` VARCHAR NULL — populated **only** when `scope_kind='element'`
  - `scope_ref_id` VARCHAR NULL — target-side element id when scope is not `architecture`
  - `answer_value` TEXT NOT NULL (free-form, may be multi-line)
  - `answer_summary` VARCHAR NULL (optional short label)
  - `standards_lookup_ref` VARCHAR NULL (opaque ref into standards registry, format TBD by Spec 3)
  - `conversation_thread_id` VARCHAR NULL (Spec 3 wires this)
  - `conversation_turn_ref` VARCHAR NULL (turn index within thread)
  - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
  - `created_by_task` VARCHAR NOT NULL (**no DB default — caller must pass**)
  - `superseded_by_id` UUID NULL (self-FK; non-null when row has been replaced)
- **CHECK constraint** enforcing: `scope_ref_type IS NOT NULL` iff `scope_kind = 'element'`.
- Indexes:
  - `(project_id, target_architecture_id)`
  - Composite `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` — supports the "latest decision per scope" read pattern
  - `decision_code` — supports cross-architecture analytics
- No CHECK on `decision_code` values (open-ended by design — see Q7).
- All decimal/boolean fields are boxed types per `project_primitive_double_dto_overwrite.md`.

**AMS — Java surface:**

- Entity `TargetStateCapturedDecisionEntity`.
- DTO `TargetStateCapturedDecisionDto` (response) + `CreateTargetStateCapturedDecisionRequest` (write).
- Both DTOs carry `@JsonNaming(LowerCamelCaseStrategy.class)`.
- Repository extends `JpaRepository`; custom queries for "latest per (decision_code, scope)" and "all decisions for a target architecture grouped by decision_code".
- Service `TargetStateCapturedDecisionService`:
  - `createDecision(...)` — writes new row; if a prior row exists with the same `(project, target_architecture, decision_code, scope_kind, scope_ref_id)` tuple, set its `superseded_by_id` to the new row's id **atomically** (same transaction).
  - `listLatestDecisions(projectId, targetArchitectureId)` — one row per `(decision_code, scope)`, latest wins, excludes superseded.
  - `listAllDecisions(projectId, targetArchitectureId)` — includes superseded rows for full audit.
  - `findByDecisionCode(...)` — single-decision lookups across scopes.
  - **Cross-project leak protection:** every GET-single / lookup verifies the row's `project_id` and `target_architecture_id` match the request path; 404 if mismatched (not 403, to avoid leaking existence).
- Controller path: `/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions`.
- Endpoints (**POST and GET only** — no PUT/PATCH/DELETE; decisions are insert-only at the data plane):
  - `POST /captured-decisions` — create
  - `GET /captured-decisions` — list latest (default); `?includeSuperseded=true` for audit
  - `GET /captured-decisions/{decisionId}` — single row
  - `GET /captured-decisions/by-code/{decisionCode}` — latest rows for that code across all scopes
- **If not already present**, add `GET /api/projects/{projectId}/active-target-architecture-id` to AMS so the gateway resolver can find the active target architecture for a project.

**Gateway — Conversation thread persistence:**

- New file: **`gateway/src/.../targetStateConversationStore.ts`** (new sibling to `threadStore.ts`, not an extension of it).
- Thread file path: `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json` — matches the existing thread storage pattern documented in MEMORY.md.
- Helper API (rough):
  - `loadTargetStateConversation(projectId, targetArchitectureId)` — returns `{ schemaVersion: 1, threadId, turns: [] }` if no file exists.
  - `appendTurn(projectId, targetArchitectureId, turn)` — appends to `turns[]`, creates parent directories if missing.
- **File envelope shape (minimal):** `{ schemaVersion: 1, threadId, turns: any[] }`. Spec 3 defines what a turn looks like; this helper does not inspect turn contents.

**Gateway — Resolver:**

- New `TargetStateDecisionsContextResolver` registered at key `target-state-decisions-context` in the context resolvers registry.
- Resolution flow:
  1. Resolve active project + active architecture via existing helpers.
  2. Resolve project's active target architecture id via `GET /api/projects/{projectId}/active-target-architecture-id` (add to AMS if not present).
  3. If no active target architecture: return the distinct copy `"no target architecture defined yet"`.
  4. Otherwise call AMS `GET .../captured-decisions` (latest only).
  5. If zero decisions returned: return the distinct copy `"no decisions captured yet"`.
  6. Otherwise transform into prompt-ready bounded text **grouped by scope** (architecture-wide first; then per-service / per-interface / per-element overrides), each line carrying its decision_code, answer_summary, and optional standards reference.
- **No transcript** in resolver output (Q5).
- **No size cap** in this spec (Q14).
- Register `target-state-decisions-context` in `KNOWN_CONTEXT_KEYS`.

**Gateway / AMS — `MigrationDiscoveryContextDto` extension:**

- Add top-level field `targetStateDecisionsSummary: TargetStateDecisionsSummaryDto` to `MigrationDiscoveryContextDto`.
- New nested DTO `TargetStateDecisionsSummaryDto`:
  - `architectureWideDecisions: List<CapturedDecisionRefDto>` — one entry per architecture-scope decision
  - `scopedOverrides: List<CapturedDecisionRefDto>` — one entry per non-architecture-scope decision
  - `totalDecisionCount: int`
  - `lastDecisionAt: Instant` (nullable)
- `CapturedDecisionRefDto` fields: `decisionId`, `decisionCode`, `scopeKind`, `scopeRefId`, `answerSummary`, `standardsLookupRef`. All boxed types where applicable. `@JsonNaming(LowerCamelCaseStrategy.class)`.
- Aggregation service includes this block alongside existing context blocks. **Empty default** (empty lists, count=0, lastDecisionAt=null) when no decisions exist — existing consumers see a consistent shape even pre-Spec-3.
- **Include flag** on the aggregation request DTO: `includeTargetStateDecisions` (default `true`) — **body field, not query param** (Q13).

**AMS — Mapping-notes decoration helper:**

- Small utility class (spec-writer picks the exact name — `ArchitectureElementMappingNotesDecorator` or similar).
- Single method: `decorateWithDecision(currentNotes, decisionCode)` returns a notes string with `[decision:<code>]` appended idempotently — never duplicates if the tag is already present for that code.
- **Stateless.** No DB writes from the helper itself; callers persist the returned string.
- Called from future write paths that mutate a mapping in response to a decision (Spec 3 will use this; Spec 4 may). Existing Selective-Copy auto-map path does NOT use it (its mappings have no decision provenance).
- This spec does NOT automate `mapping_type` rewrites (`equivalent` → `replaced_by` / `renamed` / `split` / `merged`) — that's Spec 3.

**Tests (backend only — 6 groups, 2-4 tests per group):**

1. **AMS service tests:** create-then-supersede sets `superseded_by_id` atomically; list-latest excludes superseded; list-all includes superseded; find-by-code; scope filter combinations.
2. **AMS controller tests:** each endpoint happy path; 404 on cross-project access (decision row's `project_id`/`target_architecture_id` don't match the path); JSON-naming round-trip via `@JsonNaming`.
3. **Resolver tests:** no-target-architecture returns the distinct "no target architecture defined yet" copy; populated project returns the bounded grouped-by-scope summary; empty target returns "no decisions captured yet"; KNOWN_CONTEXT_KEYS lookup resolves to the new resolver.
4. **DTO extension tests:** aggregation endpoint returns the new `targetStateDecisionsSummary` block with correct empty default shape and correct populated shape; existing consumers are not broken.
5. **Thread persistence helper tests:** load-empty returns the default envelope; append-then-load round-trips the appended turn; directory auto-creates when missing.
6. **Mapping-notes decoration tests:** empty input + decision_code produces tagged string; pre-tagged input + same code is idempotent (no duplicate tag); pre-tagged input + different code appends second tag.

No frontend tests (no frontend changes).

### Reusability Opportunities

- **`threadStore.ts`** sets the template for `targetStateConversationStore.ts` (path convention, load/append API style, JSON file handling).
- **The existing `migration-discovery-context` resolver** sets the template for the new `target-state-decisions-context` resolver (registration shape, KNOWN_CONTEXT_KEYS entry style, bounded-text output style).
- **Selective-Copy DTOs** set the `@JsonNaming(LowerCamelCaseStrategy.class)` pattern that all new DTOs in this spec follow.
- **Existing AMS context-aggregation flow** that already builds `MigrationDiscoveryContextDto` — extend additively rather than refactoring.

### Scope Boundaries

**In Scope:**
- Liquibase changeset for `target_state_captured_decisions` table (with CHECK constraint and indexes per spec).
- AMS entity, repository, service, controller, DTOs.
- AMS endpoints under `/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions` — POST + GETs only.
- AMS active-target-architecture-id lookup endpoint (if not already present).
- Gateway `targetStateConversationStore.ts` thread helper (new file).
- Gateway `TargetStateDecisionsContextResolver` registered in `KNOWN_CONTEXT_KEYS`.
- Additive extension of `MigrationDiscoveryContextDto` with `targetStateDecisionsSummary` and include-flag.
- AMS mapping-notes decoration helper (stateless string utility).
- Backend tests across 6 groups.
- One commit.

**Out of Scope:**
- The architect-persona conversation logic, question library, standards registry mechanics, per-element exception pinning (Spec 3).
- Conversation UI inside the Target State sub-tab (Spec 3).
- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` (Spec 4).
- Any frontend changes.
- Any LLM call from this spec.
- Backfill of historical decisions (none exist).
- Decision code enum validation (open-ended by design).
- Automated `mapping_type` rewrites driven by decisions (Spec 3 owns).
- Revisability via PATCH/PUT/DELETE on decisions (insert-only at data plane).
- Conversation transcript exposed as its own resolver (Spec 3 if needed).
- Resolver size cap.
- DB-level default for `created_by_task`.
- FK from `target_state_captured_decisions` to `architecture_element_mappings` (reverse-discovery via notes tag instead).

### Technical Considerations

**Integration points:**
- AMS Liquibase pipeline — new changeset at the next free number after the current tail. **Never edit applied changesets** per `feedback_liquibase_immutable_changesets.md`.
- AMS REST stack — new controller follows the existing `/api/projects/{projectId}/...` pattern.
- Gateway context-resolvers registry — `KNOWN_CONTEXT_KEYS` code edit, no changeset.
- Gateway thread storage — same `{projectParentFolder}/threads/...` convention documented in MEMORY.md.
- `MigrationDiscoveryContextDto` aggregation — additive only.

**Existing system constraints:**
- Per `project_primitive_double_dto_overwrite.md`: all DTO fields that participate in PATCH semantics must be boxed types with null guards. In this spec all writes are POST inserts (no PATCH), but new DTOs still use boxed types for any numeric/boolean field to stay consistent with the project pattern.
- Per `feedback_liquibase_immutable_changesets.md`: never edit applied Liquibase changesets — add new ones.
- `@JsonNaming(LowerCamelCaseStrategy.class)` on every new DTO (Bug #2 companion pattern from selective-copy DTOs).
- Atomic supersession: the `createDecision` write and the supersession of any prior matching-tuple row must happen in the same DB transaction — never leave two un-superseded rows for the same tuple.
- Cross-project leak protection: 404 not 403 on mismatched project_id / target_architecture_id, to avoid leaking row existence.

**Technology preferences stated:**
- Gateway TypeScript for the thread helper and resolver (matches existing patterns).
- AMS Java/Spring for entity / service / controller / DTOs.
- Postgres / Liquibase / JPA for persistence.

**Similar code patterns to follow:**
- `threadStore.ts` shape for `targetStateConversationStore.ts`.
- `migration-discovery-context` resolver shape for `target-state-decisions-context` resolver.
- Selective-Copy DTO `@JsonNaming` pattern for all new DTOs.

### Dependencies (already shipped — captured for traceability)

- `2026-05-24-target-state-subtab-deterministic-suggest` — target drafts exist with proper architecture_ids; this spec scopes decisions to them.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — mapping reads use the parent chain.
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern on selective-copy DTOs — companion pattern this spec follows.

### Verification (post-spec acceptance checks)

- New table exists and is empty in every environment until Spec 3 starts writing.
- AMS REST endpoints respond correctly to create / list / find calls.
- Gateway resolver returns the distinct "no target architecture defined yet" copy when no active target, and "no decisions captured yet" when target exists but no decisions, for any project (until Spec 3 writes).
- `MigrationDiscoveryContextDto` aggregation responses include the new `targetStateDecisionsSummary` block with the empty default.
- Thread persistence helper round-trips a JSON thread file under the expected path; creates the directory if missing.
- Mapping-notes decoration helper is callable and idempotent.
- All new backend tests pass.
- Existing tests still pass (the aggregation DTO extension is additive).

### Commit Boundary

One commit covering: Liquibase changeset, AMS entity + service + controller + DTOs + active-target-architecture-id lookup endpoint (if needed), gateway resolver + DTO extension + thread helper + notes-decoration helper + KNOWN_CONTEXT_KEYS registration, backend tests. No frontend. No edits to applied Liquibase changesets.
