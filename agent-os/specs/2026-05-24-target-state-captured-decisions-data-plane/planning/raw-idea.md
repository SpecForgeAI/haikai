# Raw Idea: Target State Captured Decisions — Data Plane

## Why this spec exists

Spec 1 (`2026-05-24-target-state-subtab-deterministic-suggest`) shipped a deterministic Suggest that produces a target state which is a structural 1:1 clone of current state, with an equivalence mapping per element. That gets the user moving but the target is **technology-naive** — it preserves the current state's runtime, framework, persistence engine, API protocol, etc., because nothing in the data flow has captured "these things are changing for the migration."

The architect-persona conversation in Spec 3 will ask ~50 questions across 10 concern groups (service runtime, API surface, data persistence, DTO style, frontend, cross-cutting, infrastructure, inter-service communication, testing, cut-over) and capture the answers as **first-class evidence**. Spec 4 will update the existing PM Book of Work and Shape-Spec generation prompts to consume those decisions as facts.

Spec 2 — **this one** — is the foundational data plane both Spec 3 and Spec 4 require. It builds the rails before the train arrives:

- A durable table to store captured decisions (one row per answered question, with scope: architecture-wide / per-service / per-interface / per-element).
- Conversation thread persistence (the full multi-turn architect conversation as a JSON thread on disk, alongside the existing migration-conversation thread infra).
- A gateway resolver that surfaces the captured decisions as bounded, prompt-ready summary text — registered under `KNOWN_CONTEXT_KEYS` so any LLM task can request it.
- An extension to the existing `MigrationDiscoveryContextDto` aggregation endpoint so the captured decisions ride along with the other migration context every downstream task already consumes.
- A small, shared utility for decorating `architecture_element_mappings.notes` with decision-code citations, so mappings that get rewritten by an architect decision (e.g. mapping_type changes from `equivalent` → `replaced_by` because the service framework changed) carry the decision provenance in a queryable way.

After this spec ships, the downstream wiring exists. Specs 3 and 4 can independently target the same data plane without duplication.

## What this spec is (and isn't)

**This spec is** pure infrastructure data plane. AMS schema + entity + service + REST surface. Gateway resolver + DTO extension. A thread persistence helper. A mapping-notes decoration helper. Backend tests only.

**This spec is not**:
- The architect conversation itself (Spec 3 — multi-turn LLM task, question library, standards registry lookups, per-element exception pinning, the conversation UI inside the Target State sub-tab from Spec 1).
- The downstream PM task updates (Spec 4 — `product-manager--migration-delivery-plan` and `product-manager--migration-shape-spec-generation` consuming the new context).
- Any frontend work (Spec 3 owns the conversation UI).
- The standards registry mechanics (Spec 3 wires standards lookup into the conversation flow).
- Any LLM call from this spec.

After this spec ships, the captured decisions table will exist but will be empty in any environment (nothing writes to it yet). The resolver will resolve to "no decisions captured yet" for every project until Spec 3 starts writing. That's the correct state — the rails are in place; the train is Spec 3.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea. The shape-spec agent should treat them as given:

1. **Captured decisions are first-class persisted evidence**, not transient state. They survive across sessions, across architectures, across project re-opens.
2. **Conversation transcript persists alongside the decisions**, not in place of them. The transcript records reasoning chain (which standards lookups were considered, which alternatives were explored, what the architect said yes/no to in their own words). The decisions table records the extracted answers. Both matter.
3. **Decision codes are stable, opaque strings** (`db.engine`, `api.protocol`, `service.framework`, etc. — full 50-ish list defined by Spec 3). Free-form text answers attached. New decision codes can be added by Spec 3 without DDL.
4. **Scope is required on every decision row** — one of `architecture` / `service:<id>` / `interface:<id>` / `element:<type>:<id>`. Lets the architect set defaults then refine per-element exceptions.
5. **Standards lookup reference is optional per decision** (nullable foreign key or string ref) — pre-recorded for audit (`"why did we pick JUnit 5?" → standards lookup id X says: for Java 21 / JUnit 5 is the default`).
6. **Decisions are immutable once written**. To "change" a decision, write a new row that supersedes the previous one. The latest row per `(decision_code, scope)` wins for downstream reads. Audit trail survives because the prior row stays in the table.
7. **The resolver returns a bounded summary**, not raw rows. Same pattern as the existing `migration-discovery-context` resolver — it picks the right slice and renders prompt-ready text with citations.
8. **The aggregation endpoint extension is additive** — `MigrationDiscoveryContextDto` gains a new `targetStateDecisionsSummary` block; nothing existing changes shape.
9. **Mapping-notes decoration is a write-side concern** — when a decision writes/updates an `architecture_element_mappings` row, the decision_code goes into the notes field via a shared helper, so downstream consumers can grep for it. The helper is small and stateless.
10. **One commit boundary** per existing project pattern.
11. **No frontend changes** in this spec.

## Specific requirements (rough — let shape-spec refine)

### AMS schema (one Liquibase changeset)

- New table `target_state_captured_decisions` with columns:
  - `id` (UUID PK)
  - `project_id` (UUID NOT NULL — every decision is scoped to a project)
  - `target_architecture_id` (UUID NOT NULL — every decision is scoped to a target draft, not the current arch)
  - `decision_code` (VARCHAR NOT NULL — stable opaque code like `db.engine`)
  - `scope_kind` (VARCHAR NOT NULL — one of `architecture` / `service` / `interface` / `element`)
  - `scope_ref_type` (VARCHAR NULL — the element-type when `scope_kind='element'`, null otherwise; for `service` / `interface` we use `scope_ref_id` directly against the supertype table)
  - `scope_ref_id` (VARCHAR NULL — the target-side element id when scope is not `architecture`)
  - `answer_value` (TEXT NOT NULL — free-form, may be multi-line)
  - `answer_summary` (VARCHAR NULL — optional short label for list views, e.g. "Postgres 18")
  - `standards_lookup_ref` (VARCHAR NULL — opaque ref into the standards registry, format TBD by Spec 3)
  - `conversation_thread_id` (VARCHAR NULL — references the thread file path or id; Spec 3 wires this when it writes)
  - `conversation_turn_ref` (VARCHAR NULL — turn index within the thread, for jump-to-context)
  - `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
  - `created_by_task` (VARCHAR NOT NULL — default `"architect-persona-conversation"`; lets future tasks attribute decisions distinctly)
  - `superseded_by_id` (UUID NULL — self-FK; non-null when this decision has been replaced by a later one)
- Indexes: `(project_id, target_architecture_id)`, `(project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id)` (composite for the "latest decision per scope" read pattern), `decision_code` (cross-architecture analytics).
- No CHECK constraints on `decision_code` enum values — the spec deliberately keeps codes open-ended so Spec 3 can add new ones without DDL.
- All decimal / boolean fields boxed types per `project_primitive_double_dto_overwrite.md`.
- Liquibase changeset is the next free number after the current tail.

### AMS Java surface

- Entity `TargetStateCapturedDecisionEntity`.
- DTO `TargetStateCapturedDecisionDto` (response shape) + `CreateTargetStateCapturedDecisionRequest` (write).
- `@JsonNaming(LowerCamelCaseStrategy.class)` on the DTOs per the project pattern (companion to the Bug #2 fix).
- Repository extends `JpaRepository`; custom queries for "latest per (decision_code, scope)" and "all decisions for a target architecture grouped by decision_code".
- Service `TargetStateCapturedDecisionService` with methods:
  - `createDecision(...)` — writes the new row; if a prior row exists with the same `(project, target_architecture, decision_code, scope_kind, scope_ref_id)` triple, set its `superseded_by_id` to the new row's id atomically.
  - `listLatestDecisions(projectId, targetArchitectureId)` — returns one row per `(decision_code, scope)` triple, latest one wins, excludes superseded rows.
  - `listAllDecisions(projectId, targetArchitectureId)` — includes superseded rows for full audit.
  - `findByDecisionCode(...)` — for single-decision lookups.
- Controller path: `/api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions`.
- Endpoints:
  - `POST /captured-decisions` — create (Spec 3 calls this per answered question)
  - `GET /captured-decisions` — list latest (default) or `?includeSuperseded=true` for audit
  - `GET /captured-decisions/{decisionId}` — single row
  - `GET /captured-decisions/by-code/{decisionCode}` — latest rows for that code across all scopes (e.g. "show me every scope where `db.engine` was decided")

### Conversation thread persistence

- Thread file lives at `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json` — matches the existing thread storage pattern (per `CLAUDE.md` Architecture section).
- Spec 3 owns the conversation logic; this spec owns the **helper / contract** that Spec 3 uses to load + append turns. The contract is a small TypeScript utility in the gateway (since gateway owns thread file I/O for migration conversations today).
- Helper API (rough): `loadTargetStateConversation(projectId, targetArchitectureId)`, `appendTurn(projectId, targetArchitectureId, turn)`. Reads/writes JSON to the path above. Creates the directory if it doesn't exist.
- The helper does NOT define turn semantics (those belong to Spec 3). It just provides durable load/append.

### Gateway resolver

- New `TargetStateDecisionsContextResolver` registered at key `target-state-decisions-context` in `gateway/src/services/contextResolvers.ts`.
- Resolver resolves the active project + active architecture's target draft via existing `resolveDefaultArchitectureId(projectId)` + a lookup for the project's active target.
- Calls AMS `GET .../captured-decisions` (latest only).
- Transforms the response into prompt-ready bounded text. Shape (rough):
  ```
  ## Target State Decisions

  ### Architecture-wide
  - `db.engine` = Postgres 18 (standards: Postgres 18 default stack)
  - `service.framework` = Spring Boot 3.4 (standards: Java 21 / Spring Boot 3.4 default stack)
  - ...

  ### Per-service overrides
  - service:svc-uuid-abc (`api.protocol` = SOAP — kept for client compatibility per decision capture)
  - ...
  ```
- Bounded summary; no raw conversation transcript in the resolver output (the transcript is queryable separately by anything that needs it).
- Add `target-state-decisions-context` to `KNOWN_CONTEXT_KEYS`.

### `MigrationDiscoveryContextDto` extension

- Add a new top-level field `targetStateDecisionsSummary: TargetStateDecisionsSummaryDto` to `MigrationDiscoveryContextDto`.
- New nested DTO `TargetStateDecisionsSummaryDto` with:
  - `architectureWideDecisions: List<CapturedDecisionRefDto>` — one entry per architecture-scope decision
  - `scopedOverrides: List<CapturedDecisionRefDto>` — one entry per non-architecture-scope decision
  - `totalDecisionCount` (int)
  - `lastDecisionAt` (Instant nullable)
- `CapturedDecisionRefDto` has the durable fields: `decisionId`, `decisionCode`, `scopeKind`, `scopeRefId`, `answerSummary`, `standardsLookupRef`.
- The aggregation service includes this block alongside the existing context blocks. Empty default when no decisions exist (so existing consumers see a consistent shape even pre-Spec-3).
- Include flag on the existing aggregation request body: `includeTargetStateDecisions` (default `true`).

### Mapping-notes decoration helper

- Small utility in AMS — `ArchitectureElementMappingNotesDecorator` or similar (shape-spec to pick the name).
- Single method: `decorateWithDecision(currentNotes, decisionCode)` returns a notes string with a `[decision:db.engine]` (or similar format) tag appended idempotently — never duplicates.
- Called from any future write path that mutates a mapping in response to a decision. Spec 3 will use this; Spec 4 may use it; the existing Selective-Copy auto-map path does NOT (its mappings have no decision provenance).
- The mapping_type changes (`equivalent` → `replaced_by` / `renamed` / `split` / `merged`) are NOT automated by this spec — that's Spec 3's job. This spec just supplies the helper.

### Tests

Backend only. Moderate scope:
- AMS service tests: create-then-supersede, list-latest-excludes-superseded, list-all-includes-superseded, find-by-code, scope filter combinations.
- AMS controller tests: each endpoint path + happy path + 404 on cross-project access + JSON-naming round-trip.
- Resolver test: empty project returns "no decisions" copy; populated project returns the bounded summary; KNOWN_CONTEXT_KEYS lookup works.
- DTO extension test: aggregation endpoint returns the new block with correct empty + populated shape.
- Thread persistence helper test: load-empty-returns-default, append-then-load-round-trips, directory-auto-creates.
- Mapping-notes decoration test: empty input + decision_code → tagged string; pre-tagged input + same code → idempotent.
- No frontend tests (no frontend changes).

Cap: 2-8 tests per group per the existing pattern in other specs' `tasks.md`.

### Out of scope

- The architect-persona conversation logic (Spec 3).
- Updates to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` (Spec 4).
- Any frontend changes (Spec 3 owns the conversation UI).
- Standards registry mechanics (Spec 3 wires this in).
- Backfill of historical decisions from anywhere (none exist).
- Decision code enum validation (Spec 3 owns the question library; codes stay open-ended on the data plane).
- Automated `mapping_type` rewrites driven by decisions (Spec 3).

## Dependencies

- `2026-05-24-target-state-subtab-deterministic-suggest` — already shipped (and committed). Target drafts now exist and have proper architecture_ids; the captured decisions table can FK / scope to them.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — already shipped. Mapping reads use the parent chain.
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern on selective-copy DTOs — already shipped. New DTOs in this spec follow the same pattern.

## Open questions for shape-spec to clarify

1. **Where does the thread persistence helper live — AMS or gateway?** The existing migration-conversation thread infra lives in the gateway (file I/O against `{projectParentFolder}/threads/...`). Putting the new helper there keeps thread I/O consistent. But Spec 3's architect conversation is multi-turn LLM with tool-calls — closer to `api-migration-validation-service`'s loop pattern than to the existing migration-conversation. Maybe a new home? **My instinct:** gateway, mirror the existing migration-conversation thread helper exactly. Spec 3 can refactor if it needs different mechanics.

2. **Should the captured_decisions table FK to `architecture_element_mappings`?** When a decision rewrites a mapping, should the decision row link to the mapping(s) it changed? Two options:
   - **(a)** Yes — add `affected_mapping_ids: List<UUID>` (or a join table). Lets the decision row name its side-effects.
   - **(b)** No — keep the decision row clean; reverse-discover via the mapping notes' `[decision:code]` tag.
   - **My instinct:** (b). The notes-decoration helper already provides the link. Adding a join table complicates the schema for a read pattern (which mappings did this decision change?) that may rarely be exercised.

3. **Should decisions be revisable mid-conversation, or only via a fresh "supersedes" row?** The "immutable, supersede via new row" semantic is settled (decision 6 above). But within a single conversation, can the user edit their answer to question Q1 after they've already moved past it? **My instinct:** yes, but the implementation is "write a new row that supersedes the previous one" — no in-place UPDATE. The conversation UI in Spec 3 can sugar the "go back and revise" interaction however it wants; the data plane sees only inserts.

4. **What's the read shape on the resolver — flat or grouped?** Three candidates:
   - **(a)** Flat list of "decision X = answer Y at scope Z"
   - **(b)** Grouped by `decision_code` ("here's everything we decided about db.engine across all scopes")
   - **(c)** Grouped by scope ("here's the architecture-wide defaults, then per-service overrides")
   - **My instinct:** (c), matches how the user thinks about the decisions and matches the rough resolver output in the requirements above.

5. **Should the resolver include the conversation transcript or just decisions?** Transcript can be large (50+ turns × prompt + response). **My instinct:** decisions only in the resolver. The transcript is a separate context key (or downstream consumers fetch it directly if they need it). Bounded summary is the resolver's job.

6. **Mapping-notes decoration format**: my rough proposal is `[decision:db.engine]` appended to the existing notes string. Alternatives: `decision_id` as UUID, JSON-encoded tag, separate `mapping_decisions` join table. **My instinct:** simple string tag `[decision:code]` — greppable, human-readable, idempotent, no schema change to the mappings table.

7. **Are decision codes validated against a known enum on the AMS side?** **My instinct:** no — open-ended strings. Spec 3 owns the question library and is the single writer; AMS just persists. If a typo gets through (`db.enigne`), it'll surface as a "no decisions found" downstream and the architect can re-answer.

8. **`scope_kind='element'` shape**: when an architect pins a decision to a specific data entity or endpoint, do we store the supertype table name in `scope_ref_type` and the element id in `scope_ref_id`? **My instinct:** yes, exactly that. `scope_ref_type` is null when `scope_kind` is `architecture`, `service`, or `interface` (those have their own supertype tables and `scope_ref_id` is sufficient). `scope_ref_type` is populated when `scope_kind='element'` (where we don't know the table at write time without it).

9. **What's the `created_by_task` value for decisions written by the architect conversation in Spec 3?** **My instinct:** `architect-persona-conversation`. Spec 3 owns the exact string; the column is open-ended.

10. **Should we ship with a seed migration changeset that registers the resolver in `KNOWN_CONTEXT_KEYS`?** That registry lives in code, not DB. **My instinct:** no, it's a code edit in `gateway/src/services/contextResolvers.ts` — same file the existing resolvers register in. No changeset needed.

## Verification

After this spec:
- The new table exists and is empty in every environment until Spec 3 starts writing.
- AMS REST endpoints respond correctly to create / list / find calls.
- The gateway resolver resolves to "no decisions captured yet" for any project (until Spec 3 writes).
- `MigrationDiscoveryContextDto` aggregation responses include the new `targetStateDecisionsSummary` block with the empty default.
- The thread persistence helper round-trips a JSON thread file under the right path.
- The mapping-notes decoration helper is callable and idempotent.
- All new backend tests pass.
- Existing tests still pass (the aggregation DTO extension is additive — existing consumers see no breaking shape change).

## Commit boundary

One commit covering: Liquibase changeset, AMS entity + service + controller + DTOs, gateway resolver + DTO extension + thread helper + notes-decoration helper, backend tests. No frontend, no changesets to applied Liquibase files.
