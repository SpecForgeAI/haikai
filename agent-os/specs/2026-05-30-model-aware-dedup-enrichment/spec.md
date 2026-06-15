# Specification: Model-Aware Discovery — Dedup Against Existing Entities + Enrichment/Link Candidates

## Goal
Make a discovery run MODEL-AWARE: suppress duplicates of already-persisted entities, enrich existing entities (add attributes / add relationships between pre-existing entities), and reconcile DB-physical to code-logical entities via `logical_data_entity_physical_data_entities` (the mapping deferred from Spec 3) — without introducing any new entity/relationship TYPES.

## User Stories
- As a migration architect, I want a re-scan that re-discovers an already-persisted entity to NOT create a duplicate, so the model stays clean while every suppression is visible and counted.
- As a migration architect, I want later scans to ENRICH existing entities (extra attributes, new relationships, logical↔physical links) instead of dropping that evidence, so the model accretes richness across runs.
- As a migration architect, I want a scan that disagrees with an existing attribute's value to raise a reviewable Finding rather than silently overwrite my model, so "architecture ≠ reality" stays evidence I decide on.

## Specific Requirements

**Operation dimension (`create` / `enrich` / `link`)**
- Add a NEW typed `operation` column to the `discovery_candidate` table (AMS), values `create` / `enrich` / `link`, defaulting to `create`.
- `link` is DISTINCT from `enrich`: `link` = a mapping relationship between two EXISTING entities (one logical data entity ↔ one physical data entity); `enrich` = add attributes and/or relationships to ONE existing entity.
- Indexable/filterable like `candidate_type` (add a `run_id, operation` index alongside the existing `run_id, candidate_type` index).
- NOT a new entity or relationship TYPE — it is a dimension on the candidate row only.
- Surface `operation` on `DiscoveryCandidateEntity`, `DiscoveryCandidateDto`, the repository, and the frontend `DiscoveryCandidateDto` type.

**AMS schema change (changeset ≥ 166)**
- Add `operation` via a NEW Liquibase changeset file (next free number ≥ 166 off the working tree; 165 is the current highest applied), wired into `db.changelog-master.yaml`.
- Never edit an applied changeset; mirror the 165 precedent (additive column on an existing table, registered in the master).
- snake_case at the wire (no `@CamelCaseWire`); column is `operation`, nullable-or-defaulted so existing rows round-trip as `create`.

**Model-as-input: lean existing-entity index (LLM nudge only)**
- Load the existing (project, architecture) model in the run via `archModelClient` at the prompt-composition point (`llmFileAnalysisStep.ts` already imports `archModelClient`).
- Inject only a LEAN compact index (per entity: id, type, name, parent/table-name hint — NOT full attribute lists or descriptions) into the prompt via `composer.ts` / `injection.ts` as a new "these already exist — don't restate; propose enrichments/links instead" section.
- Index scope: relevant-slice first (the scanned service's subtree + ALL data entities, since reconcile is cross-cutting), whole-model if under a size cap; if too large to inject in full, emit a Finding and proceed with the slice.
- The LLM only PROPOSES `enrich`/`link` candidates referencing existing entities by NAME; it NEVER does the load-bearing matching and NEVER emits `*_points` wrappers.

**Deterministic dedup-against-existing at save-back (the crux)**
- The load-bearing matching runs in CODE at save-back in `candidateSaveBackService`, reusing the identity primitive (`matchByNormalizedName` / `resolveEntityToPointId`; exact = 1.0, normalized = 0.7, none = 0.0; 0.75 gate) — deterministic, testable, zero tokens.
- EXACT (1.0) match against an already-persisted entity → AUTO-SUPPRESS the duplicate (no second entity minted).
- NORMALIZED (0.7) match → a reviewable low-confidence "possible duplicate" candidate (below the 0.75 gate so it surfaces for review, never auto-applied).
- NONE → normal `create`.

**Visible auto-suppress (NO silent drops — Issue 1 lesson)**
- Auto-suppress occurs ONLY at exact match, and is VISIBLE: record a run-summary count and the suppressed set ("N re-discovered entities suppressed as duplicates of existing model entities").
- Never silently drop a candidate anywhere; below-gate matches become reviewable candidates and missing targets/conflicts become Findings.

**Enrich existing entities (add attributes / add relationships)**
- An `enrich` candidate carries the target entity's NAME + confidence; the target id is resolved LATE at save-back (the model can change between run and approval — mirrors the existing deferred-relationship pass).
- Save-back extends create-or-skip to APPLY enrich operations: add child attributes and/or relationships to the resolved existing entity WITHOUT blanket-overwriting any existing field of that entity.
- v1 INCLUDES add-attributes-to-an-existing-entity (shares the enrich machinery) AND add-a-relationship-between-two-pre-existing-entities.
- If an enrich can't auto-apply, it surfaces as a visible reviewable candidate — never suppressed.

**Logical↔physical reconciliation (`link`)**
- Match a DB-physical entity to a code-logical entity via the identity primitive and populate `logical_data_entity_physical_data_entities` (currently scaffolded as an empty array in save-back and never written — this is the Spec 3 gap).
- EXACT → auto-link; NORMALIZED → reviewable `link` candidate; NONE → nothing. NEVER synthesize a 1:1 mapping.
- Reuse the existing data-entity-point resolution (the `resolveEntityPoint` / `dep_log_<id>` / `dep_phy_<id>` deterministic-id pattern already in save-back); endpoints of the mapping are `data_entity_points`, which stay backend-auto-managed.

**Conflicts and missing targets → Findings (never overwrite, never drop)**
- A scan finding a DIFFERENT value for an EXISTING attribute → NEVER overwrite; emit a Finding via `FindingEmitter` linked to the `architecture_element`, default severity `low`.
- An `enrich`/`link` whose target is GONE at save-back → emit a Finding ("intended to enrich/link X; X no longer exists"), never a silent drop.

**Build layering (strict order)**
- AMS (`operation` column + changeset ≥ 166) → discovery-service (load model via `archModelClient`; inject lean index in `composer.ts`/`injection.ts`; emit `create`/`enrich`/`link` candidates; extend `prompts/dedup.ts` framing) → MCP save-back (`candidateSaveBackService`: deterministic dedup-suppress at exact + logical↔physical link + late name-resolution of enrich/link targets; conflicts/target-gone → Findings; enrich/link WITHOUT blanket-overwrite) → frontend (operation badge + target in the Candidates stream + details panel).

**Constraints**
- AMS speaks snake_case; NEW Liquibase changeset files only (≥ 166), never edit applied changesets.
- No `discovery-service/src/**` edits during an in-flight run (tsx watch auto-reload kills runs).
- LLM access is via the gateway relay, never direct.
- Never create/modify the auto-managed `*_points` wrappers; never synthesize a 1:1 logical↔physical mapping; logical and physical layers stay distinct.

## Existing Code to Leverage

**`mcp-server/src/services/candidateSaveBackService.ts`**
- Owns the identity primitive (`matchByNormalizedName`, `normalizeNameForMatch`, `resolveEntityPoint`, `resolveEndpoint`, `resolveEntityToPointId`; `CANDIDATE_AUTO_ACCEPT_THRESHOLD = 0.75`, `NAME_MATCH_NORMALIZED_CONFIDENCE = 0.7`) — reuse as the cross-run matcher.
- Already GET-merge-PUTs the FULL model (model scaffold includes the empty `logical_data_entity_physical_data_entities` array at the relationships layer) and runs deferred passes (e.g. `interface_logical_entities` after entities are minted) — the extension point for dedup-suppress, enrich apply, the logical↔physical link, and late target name-resolution.
- Has the `dep_log_<logicalEntityId>` / `dep_phy_<physicalEntityId>` deterministic data-entity-point id pattern to reuse for the `link` mapping endpoints.

**`discovery-service/src/services/discoveryV3Pipeline.ts`, `llmFileAnalysisStep.ts`, `archModelClient.ts`**
- The pipeline + LLM-analysis step are the model-as-input injection point; `llmFileAnalysisStep.ts` already imports `archModelClient`. Load the existing (project, architecture) model here and pass the lean index into prompt composition.

**`discovery-service/src/services/prompts/composer.ts`, `injection.ts`, `dedup.ts`**
- `composePrompt` + the `renderInjection`/`renderIrInjection` pattern are where a new "existing entities" section is rendered. `dedup.ts` + the pipeline Stage-4 dedup is the within-run dedup to extend conceptually to dedup-against-existing (the authoritative match still runs in code at save-back).

**`discovery-service/src/services/findings/FindingEmitter.ts`**
- `emitFinding`/`emitFindings` with `FindingEmitInput` (`severity`, link targets including `architecture_element`, dedupe keying) — reuse for conflict, suppression-summary, and target-gone Findings.

**Frontend `DashboardView/DiscoveryCandidateTable.tsx` + `CandidateDetailsPanel.tsx` + `DiscoveryCandidateDto`**
- The table already renders per-row badges (`TierBadge`, `DiscoveryMethodChip`) and reads `candidate_type` / `review_status` / `candidate.data` — add an operation badge + target name here. `CandidateDetailsPanel` dispatches by `candidate_type` and reads the free-form `data` JSONB — add the resolved-target + what-is-added rendering there. No separate section.

## Out of Scope
- Changing an EXISTING attribute's VALUE in place → emit a Finding; never an in-place update.
- Creating brand-new relationship TYPES.
- Anything touching the auto-managed `*_points` wrappers (`application_points`, `data_entity_points`, `business_points`, `app_business_points`) — the LLM must never create these.
- Synthesizing a 1:1 logical↔physical mapping.
- A new child under an existing parent (e.g. a new endpoint on a pre-existing interface) is NOT an `enrich` op — it is a `create` candidate whose parent FK resolves to the existing entity (already handled by create + dedup); no special handling.
- Doing the load-bearing dedup/match inside the LLM (the LLM is only nudged by the lean index; matching is deterministic in code at save-back).
- Live end-to-end verification beyond the user's own environment (done-bar is offline unit tests green).
