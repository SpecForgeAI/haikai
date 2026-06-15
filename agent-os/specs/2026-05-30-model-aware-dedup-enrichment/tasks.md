# Task Breakdown: Model-Aware Discovery — Dedup Against Existing Entities + Enrichment/Link Candidates

## Overview
Total Tasks: 5 task groups

This spec makes a discovery run MODEL-AWARE. It conforms to the Architecture
Meta-Model Reference (`gateway/src/config/prompts/shared/architecture-context-explainer.md`):
the meta-model holds ARCHITECTURE only; logical and physical data layers are
DISTINCT and joined by the EXPLICIT, non-1:1 `logical_data_entity_physical_data_entities`
mapping; the `*_points` wrappers (`application_points`, `data_entity_points`,
`business_points`, `app_business_points`) are backend AUTO-MANAGED and the LLM /
save-back must NEVER create or mutate them. No new entity or relationship TYPES
are introduced — only a candidate `operation` dimension and a populated mapping.

The groups MUST be built in the listed order; each group depends on the one
before it.

> **WORKING-TREE CAUTION (applies to EVERY group below):** Issue 1 and Specs 1,
> 2, and 3 are ALREADY DONE but UNCOMMITTED in the working tree (`git status`
> shows modified + untracked files across AMS, discovery-service, mcp-server,
> gateway, and frontend). Do NOT `git checkout`, `git restore`, `git stash`, or
> otherwise revert/replace any file from HEAD — doing so silently destroys that
> uncommitted prior work. Only ADD to / EXTEND the existing files. Read-only git
> (`git status`, `git diff`) for orientation is fine.

## Task List

### AMS Schema + DTO Layer

#### Task Group 1: `operation` column + DTO surface
**Dependencies:** None

The candidate gains a typed `operation` dimension (`create` / `enrich` /
`link`, default `create`). NOT a new entity/relationship TYPE — a column on the
existing `discovery_candidate` row, indexable like `candidate_type`. snake_case
at the wire (NO `@CamelCaseWire`).

- [x] 1.0 Complete AMS schema + DTO layer
  - [x] 1.1 Write 2-8 focused tests for the `operation` field
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a candidate persisted without `operation` round-trips as
      `create` (default), (b) a candidate persisted with `enrich` / `link`
      round-trips that value, (c) the DTO serializes the field as snake_case
      `operation` (NOT camelCase)
    - Extend the existing `DiscoveryCandidateControllerTest` /
      `DiscoveryCandidateReviewFieldsTest` style; do NOT write a new exhaustive suite
  - [x] 1.2 Add a NEW Liquibase changeset file `166-discovery-candidate-operation.sql`
    - Path: `architecture-model-service/src/main/resources/db/changelog/sql/166-discovery-candidate-operation.sql`
    - `166` is the next free number — `165-relationship-fk-columns.sql` is the
      current highest in the working tree
    - Mirror `165`'s additive-column style: a header comment explaining the
      column, then `ALTER TABLE discovery_candidate ADD COLUMN operation VARCHAR(...) NOT NULL DEFAULT 'create';`
      so existing rows round-trip as `create`
    - Add the matching index in the same changeset:
      `CREATE INDEX idx_discovery_candidate_run_id_operation ON discovery_candidate (run_id, operation);`
      (parallels the existing `idx_discovery_candidate_run_id_type`)
    - NEVER edit an applied changeset (160-165 are applied / immutable)
  - [x] 1.3 Register `166` in `db.changelog-master.yaml`
    - Append a new `changeSet` block (id `166-discovery-candidate-operation`,
      author matching the file's neighbours) AFTER the `165` block at the end of
      the file
    - Use the established guard pattern from the `164`/`165` blocks:
      `preConditions` with `onFail: MARK_RAN`, `onError: HALT`, and
      `not: columnExists` (tableName `discovery_candidate`, columnName `operation`)
      so re-runs are safe; `sqlFile` with `relativeToChangelogFile: false`,
      `splitStatements: true`, `stripComments: true`
  - [x] 1.4 Add `operation` to `DiscoveryCandidateEntity`
    - File: `.../model/entity/DiscoveryCandidateEntity.java`
    - New `@Column(name = "operation")` String field, `@Builder.Default private String operation = "create";`
    - Add `@Index(name = "idx_discovery_candidate_run_id_operation", columnList = "run_id, operation")`
      to the `@Table(indexes = {...})` list (mirrors the `run_id, candidate_type` index)
  - [x] 1.5 Add `operation` to `DiscoveryCandidateDto`
    - File: `.../model/dto/DiscoveryCandidateDto.java`
    - New record component `@JsonProperty("operation") String operation` (snake_case
      wire, NO `@CamelCaseWire`); update the Javadoc `@param` block
    - Verify the entity<->DTO mapping in `DiscoveryCandidateService` carries
      `operation` both directions (read + bulk-insert/update); default null on
      write coerces to `create` via the entity default
  - [x] 1.6 Confirm the repository needs no schema change but supports the filter
    - File: `.../repository/entity/DiscoveryCandidateRepository.java`
    - The column is indexed for `run_id, operation`; add a finder ONLY if an
      existing call site needs operation-filtered reads (otherwise leave as-is —
      do not speculatively add methods)
  - [x] 1.7 **Caution:** do NOT restore/checkout any file from HEAD — the
        discovery-candidate entity/DTO/service already carry uncommitted prior-spec
        fields (e.g. review fields, `log_enrichment`); only ADD the `operation`
        field alongside them
  - [x] 1.8 Mark Task Group 1 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 1.1 (AMS module test for the candidate
      DTO/entity), and confirm Liquibase validates (the `not: columnExists` guard
      makes the changeset idempotent)
    - Do NOT run the entire AMS test suite at this stage
    - **Verification note:** offline AMS unit test green is the done-bar; a live
      DB apply of `166` leans on the user's running environment

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass; existing rows round-trip as `create`
- `166` changeset + master registration follow the `165` precedent exactly (NEW
  changeset, guarded, snake_case, no `@CamelCaseWire`)
- `operation` surfaces on the entity, DTO, and (read+write) service mapping;
  indexed `run_id, operation`
- No applied changeset edited; no prior-spec field reverted

### Discovery-Service: Model-As-Input

#### Task Group 2: Load existing model + inject a lean existing-entity index
**Dependencies:** Task Group 1

The run loads the existing (project, architecture) model and injects a LEAN
compact index (per entity: id, type, name, parent / table-name hint only — NOT
full attribute lists or descriptions) into the prompt as a "these already exist
— don't restate; propose enrichments/links instead" nudge. The LLM is ONLY
nudged; it never does the load-bearing matching.

> **Do NOT edit `discovery-service/src/**` while a discovery run is in flight**
> (tsx watch auto-reload kills the run). Make these edits only when no run is active.

- [x] 2.0 Complete model-as-input
  - [x] 2.1 Write 2-8 focused tests for the lean index build + injection
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) the lean index includes the scanned service's subtree +
      ALL data entities and carries id/type/name/parent-hint per entry (NOT full
      attributes/descriptions), (b) whole-model is used when under the size cap,
      (c) when the model is too large to inject in full, a Finding is emitted and
      the run proceeds with the slice, (d) the composed prompt contains the
      "these already exist" section when the model is non-empty
    - Use the existing `archModelClient` / prompt-composer test patterns in
      `discovery-service/src/__tests__`; mock `archModelClient` model-load
  - [x] 2.2 Load the existing (project, architecture) model in the pipeline
    - Files: `discovery-service/src/services/discoveryV3Pipeline.ts` and/or
      `discovery-service/src/services/llmFileAnalysisStep.ts` (the latter already
      imports `archModelClient`)
    - Use `archModelClient` (architecture-scoped — it already threads
      `projectId` + `architectureId`) to GET the existing full model at the
      prompt-composition point; tolerate an empty/absent model (first run) by
      proceeding with no existing-entity section
  - [x] 2.3 Build the LEAN compact existing-entity index
    - New helper (e.g. alongside the prompts module) that maps the loaded model
      to `{ id, type, name, parentOrTableHint }` per entity ONLY — explicitly
      drop attribute lists, descriptions, and relationship payloads
    - Scope: relevant-slice FIRST = the scanned service's subtree PLUS ALL data
      entities (logical + physical), because logical↔physical reconcile is
      cross-cutting; whole-model if the serialized index is under a size cap
    - If the full index exceeds the cap, narrow to the relevant slice and emit a
      Finding via `FindingEmitter` noting the model was too large to inject whole
  - [x] 2.4 Inject the index into the prompt
    - Files: `discovery-service/src/services/prompts/composer.ts` +
      `discovery-service/src/services/prompts/injection.ts`
    - Add a new "existing entities — these already exist; do NOT restate; propose
      `enrich`/`link` candidates that reference them BY NAME" section, rendered
      via the existing `renderInjection` / `renderIrInjection` pattern in
      `composePrompt`
    - Explicitly instruct the LLM it must NEVER emit `*_points` wrappers and must
      reference existing entities by NAME (no ids); the section is a nudge only
  - [x] 2.5 Extend the dedup framing conceptually (no load-bearing logic here)
    - File: `discovery-service/src/services/prompts/dedup.ts`
    - Extend the within-run dedup framing to mention dedup-AGAINST-existing as a
      concept so the LLM avoids restating known entities; keep the authoritative
      match in CODE at save-back (Group 4) — do NOT move matching into the prompt
  - [x] 2.6 **Caution:** do NOT restore/checkout any file from HEAD — the
        pipeline, `llmFileAnalysisStep.ts`, and the `prompts/*` files carry
        uncommitted prior-spec changes (`git status` lists them modified); only
        ADD the model-load + existing-entity section
  - [x] 2.7 Mark Task Group 2 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire discovery-service suite at this stage
    - **Verification note:** offline unit test green is the done-bar; a live run
      that actually composes the prompt against a populated model leans on the
      user's environment

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass
- The existing model is loaded via `archModelClient`; first-run/empty-model is
  tolerated
- The injected index is LEAN (id/type/name/parent-hint only), scoped
  relevant-slice-first + ALL data entities, whole-if-under-cap, Finding if too large
- The prompt's existing-entity section nudges enrich/link-by-name and forbids
  `*_points`; matching is NOT done in the prompt
- No prior-spec file reverted

### Discovery-Service: Emit create / enrich / link Candidates

#### Task Group 3: Set `operation` on emitted candidates
**Dependencies:** Task Group 2

The LLM proposes `enrich` / `link` candidates referencing existing entities by
NAME + confidence; the candidate emission sets the `operation` field. The target
is resolved LATE at save-back (Group 4), not as a hard id here. Dedup here stays
informational; the load-bearing dedup is deterministic at save-back.

> **Do NOT edit `discovery-service/src/**` while a run is in flight.**

- [x] 3.0 Complete create/enrich/link candidate emission
  - [x] 3.1 Write 2-8 focused tests for operation tagging on emitted candidates
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a normal candidate emits `operation: 'create'` (default),
      (b) an enrich proposal emits `operation: 'enrich'` carrying the target
      entity NAME + confidence in its `data` payload, (c) a logical↔physical link
      proposal emits `operation: 'link'` carrying BOTH target NAMES + confidence,
      (d) emitted enrich/link candidates carry NO resolved id and NO `*_points`
      reference
  - [x] 3.2 Set `operation` on emitted candidates
    - In the candidate-synthesis / emission path (the stage that builds candidate
      rows for save), thread the `operation` value through onto each candidate so
      it lands on the AMS `operation` column added in Group 1
    - Default `create`; set `enrich` / `link` from the LLM-proposed shape
  - [x] 3.3 Carry the target NAME(s) + confidence on enrich/link candidates
    - `enrich`: the candidate `data` carries the single target entity NAME +
      confidence and the attributes/relationship(s) to add to it
    - `link`: the candidate `data` carries the logical entity NAME and the
      physical entity NAME + confidence (the two existing endpoints of the
      mapping) — NEVER a resolved id and NEVER a `*_points` wrapper
    - Resolution to ids happens LATE at save-back (Group 4), mirroring the
      existing deferred-relationship pass
  - [x] 3.4 Keep within-run dedup informational only
    - The pipeline Stage-4 within-run dedup may flag likely-existing matches for
      context, but it MUST NOT drop candidates on that basis — the authoritative
      dedup-against-existing (suppress / reviewable / create) is the deterministic
      save-back step in Group 4. No silent drops here.
  - [x] 3.5 **Caution:** do NOT restore/checkout any file from HEAD — the
        emission path carries uncommitted prior-spec changes; only ADD the
        operation/target-name threading
  - [x] 3.6 Mark Task Group 3 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire discovery-service suite at this stage
    - **Verification note:** offline unit test green is the done-bar; live
      emission against a real LLM proposal leans on the user's environment

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass
- Candidates carry the correct `operation` (`create` default; `enrich` / `link`
  when proposed)
- enrich/link candidates carry target NAME(s) + confidence, no resolved id, no
  `*_points`
- Within-run dedup remains informational; no silent drops
- No prior-spec file reverted

### MCP Save-Back: The Deterministic Core

#### Task Group 4: Dedup-suppress, enrich-apply, logical↔physical link, late resolution, conflict/target-gone Findings
**Dependencies:** Task Group 3

This is the load-bearing group. ALL matching is deterministic, in CODE, zero
tokens, reusing the existing identity primitive in
`mcp-server/src/services/candidateSaveBackService.ts`
(`resolveEntityToPointId` / `resolveEntityPoint` / `resolveEndpoint` /
`matchByNormalizedName` / `normalizeNameForMatch`; exact = 1.0, normalized = 0.7,
none = 0.0; `CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75`,
`NAME_MATCH_NORMALIZED_CONFIDENCE = 0.7`). Reuse the deferred-relationship pass
pattern (the `interface_logical_entities` deferred pass) and the
`dep_log_<id>` / `dep_phy_<id>` deterministic data-entity-point id pattern.
NEVER create or mutate `*_points` wrappers (auto-managed). NO silent drops
anywhere (Issue 1 lesson).

- [x] 4.0 Complete the deterministic save-back core
  - [x] 4.1 Write 2-8 focused tests for the save-back behaviours
    - Limit to 2-8 highly focused tests maximum
    - Cover only the crux paths: (a) EXACT (1.0) match of a re-discovered entity
      → AUTO-SUPPRESS, no duplicate minted, and the suppressed count/set is
      recorded in the run summary, (b) NORMALIZED (0.7) match → a reviewable
      low-confidence "possible duplicate" candidate (below the 0.75 gate, NOT
      auto-applied), (c) an `enrich` adds an attribute/relationship to the
      resolved existing entity WITHOUT overwriting any existing field, (d) a
      `link` populates `logical_data_entity_physical_data_entities` on EXACT match
      and does NOT synthesize a 1:1 when there is no match, (e) an enrich/link
      whose target is GONE at save-back → a Finding (not a silent drop), (f) a
      conflicting value for an existing attribute → a Finding linked to
      `architecture_element`, severity `low`, with NO overwrite
    - Extend the existing `mcp-server/src/__tests__/saveDiscoveryCandidatesRoute.test.ts`
      style / save-back tests
  - [x] 4.2 Dedup-against-existing (suppress at exact, reviewable at normalized)
    - In `candidateSaveBackService` (the full model is already GET-merge-PUT'd
      here), match each incoming `create` candidate's name against the existing
      persisted entities using the reused primitive
    - EXACT (1.0) → AUTO-SUPPRESS: do NOT mint a second entity; record the
      suppression (see 4.6)
    - NORMALIZED (0.7) → keep as a reviewable low-confidence "possible duplicate"
      candidate (below the 0.75 gate, surfaces for review, never auto-applied)
    - NONE → normal `create` (unchanged path)
  - [x] 4.3 Apply `enrich` (add attributes / relationships; never blanket-overwrite)
    - Resolve the enrich candidate's target NAME to an existing entity LATE here
      (deferred, mirroring the `interface_logical_entities` deferred pass)
    - On resolve: ADD the candidate's child attributes and/or relationship(s) to
      that existing entity, merging INTO the GET-loaded model WITHOUT
      blanket-overwriting any existing field of the entity
    - If the enrich cannot auto-apply (e.g. below gate), surface it as a visible
      reviewable candidate — NEVER suppress it
  - [x] 4.4 Logical↔physical reconciliation (`link`) — populate the mapping
    - This is the Spec 3 gap: `logical_data_entity_physical_data_entities` is
      currently scaffolded as an empty array in the model scaffold and never
      written
    - Resolve the `link` candidate's logical NAME and physical NAME via the
      primitive; reuse the `dep_log_<logicalId>` / `dep_phy_<physicalId>`
      deterministic point-id pattern for the mapping endpoints (the endpoints are
      `data_entity_points`, which stay backend-auto-managed — do NOT create them)
    - EXACT → auto-write the mapping row into
      `logical_data_entity_physical_data_entities`; NORMALIZED → reviewable `link`
      candidate; NONE → write nothing. NEVER synthesize a 1:1 mapping.
  - [x] 4.5 Late name-resolution of enrich/link targets (target-gone → Finding)
    - Run enrich/link target resolution in the deferred pass (after entities are
      minted), exactly like the existing deferred-relationship resolution, since
      the model can change between run and approval
    - If the enrich/link target is GONE at save-back → emit a Finding via
      `FindingEmitter` ("intended to enrich/link X; X no longer exists") — NEVER a
      silent drop
  - [x] 4.6 Visible auto-suppress run summary (NO silent drops)
    - Record a run-summary count + the suppressed set ("N re-discovered entities
      suppressed as duplicates of existing model entities"); surface it the same
      way other run-summary signals are surfaced
    - Auto-suppress occurs ONLY at EXACT match; everything below the gate becomes
      a reviewable candidate, and missing targets / conflicts become Findings
  - [x] 4.7 Conflict on an existing attribute → Finding (never overwrite)
    - When an incoming candidate carries a DIFFERENT value for an attribute that
      already exists on the resolved entity → do NOT overwrite; emit a Finding via
      `FindingEmitter` linked to the `architecture_element`, default severity
      `low` ("architecture ≠ reality" is evidence, not a defect)
  - [x] 4.8 Guardrails: never touch `*_points`; reuse, do not fork, the primitive
    - Confirm no path creates/modifies `application_points`, `data_entity_points`,
      `business_points`, or `app_business_points` directly
    - Reuse the EXISTING `resolveEntityToPointId` / `resolveEntityPoint` /
      `matchByNormalizedName` and threshold constants — do NOT introduce a second
      copy of the matcher
  - [x] 4.9 **Caution:** do NOT restore/checkout `candidateSaveBackService.ts` or
        its tests from HEAD — they carry the uncommitted Spec 1 identity primitive
        and prior deferred passes; only EXTEND them
  - [x] 4.10 Mark Task Group 4 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire mcp-server suite at this stage
    - **Verification note:** offline unit test green is the done-bar (this group
      is deterministic and fully unit-testable); a live save-back against a real
      model leans on the user's environment

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass
- EXACT match auto-suppresses with a VISIBLE counted suppressed set; NORMALIZED →
  reviewable; NONE → create
- `enrich` adds attributes/relationships without blanket-overwriting; below-gate
  enrich stays a reviewable candidate
- `link` populates `logical_data_entity_physical_data_entities` on exact match;
  never synthesizes a 1:1; endpoints reuse `dep_log_`/`dep_phy_`
- Target-gone and attribute-conflict each become a Finding (severity `low`,
  linked to `architecture_element` for conflicts); NO silent drops anywhere
- No `*_points` wrapper created/modified; the identity primitive is reused, not forked
- No prior-spec file reverted

### Frontend: Operation Badge + Target in the Candidates Stream

#### Task Group 5: Operation badge, target name, and details-panel rendering
**Dependencies:** Task Group 4

The operation surfaces in the EXISTING Candidates review stream — an operation
BADGE + resolved target name in the row, and the resolved target + exactly
what's added in the details panel. NO separate section.

- [x] 5.0 Complete the frontend surface
  - [x] 5.1 Write 2-8 focused tests for the badge + details rendering
    - Limit to 2-8 highly focused tests maximum
    - Cover only: (a) a `create` row shows the default "Create new" treatment,
      (b) an `enrich` row shows an operation badge + target name ("Enrich existing
      `Owner`"), (c) a `link` row shows "Link `Owner`↔`owners`", (d) the details
      panel renders the resolved target entity + exactly what is being added for
      an enrich/link candidate
    - Extend the existing `DiscoveryCandidateTable` /
      `candidateDetailsPanel.test.tsx` test patterns (Vitest)
  - [x] 5.2 Add `operation` to the frontend `DiscoveryCandidateDto` type
    - File: `frontend/src/api/discoveryApi.ts`
    - Add an `operation` field (snake_case wire `operation`, values
      `'create' | 'enrich' | 'link'`) to the type; default-tolerate absence as
      `create` for older rows
  - [x] 5.3 Render the operation badge + target name in the row
    - File: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - Reuse the existing per-row badge pattern (alongside `TierBadge` /
      `DiscoveryMethodChip`): "Enrich existing `<target>`" / "Link
      `<logical>`↔`<physical>`" / default "Create new"
    - Read the resolved target name(s) from the candidate `data` payload; keep the
      rows interleaved in the existing stream — NO separate section
  - [x] 5.4 Render the resolved target + what-is-added in the details panel
    - File: `frontend/src/components/DashboardView/CandidateDetailsPanel.tsx`
      (+ `candidateDetailsSupport.ts` if a mapper helper is the existing pattern)
    - For `enrich`: show the resolved target entity + the attributes/relationships
      being added; for `link`: show both endpoints of the
      logical↔physical mapping. Reuse the existing free-form `data`-JSONB
      rendering dispatch — do NOT add a new panel type
  - [x] 5.5 **Caution:** do NOT restore/checkout the frontend candidate
        table/details/API files from HEAD — `FindingsTab.*` and other frontend
        files are uncommitted in the working tree; only ADD the operation
        badge/target rendering
  - [x] 5.6 Mark Task Group 5 sub-tasks `- [x]` and run ONLY this group's tests
    - Run ONLY the 2-8 tests written in 5.1
    - Do NOT run the entire frontend suite at this stage
    - **Verification note:** offline Vitest green is the done-bar; the live
      end-to-end render leans on the user's environment

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass
- Rows show the correct operation badge + target name, interleaved in the
  existing Candidates stream (NO separate section)
- The details panel shows the resolved target + exactly what is added for
  enrich/link; create is unchanged
- `operation` is on the frontend DTO type, snake_case, absence-tolerant
- No prior-spec file reverted

## Execution Order

Strict, layer-by-layer (each group depends on the previous):
1. AMS Schema + DTO (`operation` column + changeset `166`) — Task Group 1
2. Discovery-Service: model-as-input (load model + inject lean index) — Task Group 2
3. Discovery-Service: emit create/enrich/link candidates — Task Group 3
4. MCP Save-Back: deterministic dedup-suppress + enrich-apply + logical↔physical
   link + late resolution + conflict/target-gone Findings — Task Group 4
5. Frontend: operation badge + target in the Candidates stream — Task Group 5

## Cross-Cutting Constraints (every group)

- **Do NOT revert uncommitted prior work.** Issue 1 and Specs 1/2/3 are
  UNCOMMITTED in the working tree. Never `git checkout` / `restore` / `stash` a
  file from HEAD; only ADD to / EXTEND existing files.
- **AMS speaks snake_case.** New `operation` column/field gets NO `@CamelCaseWire`.
- **NEW Liquibase changesets only.** `166` is the next free number; never edit an
  applied changeset (160-165).
- **No `discovery-service/src/**` edits during an in-flight run** (tsx watch
  auto-reload kills runs) — applies to Groups 2 and 3.
- **LLM access is via the gateway relay**, never direct.
- **Never create/modify the auto-managed `*_points` wrappers**; never synthesize a
  1:1 logical↔physical mapping; logical and physical layers stay distinct.
- **NO new entity or relationship TYPES** — only the `operation` dimension and the
  populated `logical_data_entity_physical_data_entities` mapping.
- **NO silent drops anywhere** (Issue 1 lesson): suppressions are counted and
  surfaced; below-gate matches become reviewable candidates; missing targets and
  conflicts become Findings.
- **Verification done-bar = offline unit tests green** per group; live
  end-to-end leans on the user's own running environment.
