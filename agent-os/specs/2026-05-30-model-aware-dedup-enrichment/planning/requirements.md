# Spec Requirements: Model-Aware Discovery — Dedup Against Existing Entities + Enrichment/Update Candidates

## Initial Description

> **Issue 2 — Model-aware discovery: dedup against existing entities + enrichment/update candidates**
>
> Part of the HAIKAI discovery richness program (like-for-like API/DB migration tool). North star: memory `project_migration_ultimate_goal`. Specs 1-3 built + Issue 1 fixed; this is the model-aware spec.
>
> **READ FIRST (fundamental):** the Architecture Meta-Model Reference `gateway/src/config/prompts/shared/architecture-context-explainer.md`. Ground everything in it. Rules: meta-model holds ARCHITECTURE only; logical vs physical are DISTINCT layers joined by EXPLICIT non-1:1 mapping relationships (`logical_data_entity_physical_data_entities`); polymorphic `*_points` wrappers are backend AUTO-MANAGED (never create directly). See memories `feedback_read_meta_model`, `project_architecture_vs_reality`.
>
> ### Problem / goal
> A discovery run is MODEL-BLIND: it never loads the existing architecture model, dedup is within-run only, save-back is create-or-skip (name match → reuse, NEVER update — extra attributes/relationships on a re-discovered entity are dropped). So a code scan re-discovering a DB-scan's entity DUPLICATES it; attributes/relationships found later can't ENRICH an existing entity. Make discovery MODEL-AWARE: feed the existing (project, architecture) model in as input so a run can (a) SUPPRESS duplicates of already-persisted entities, (b) ENRICH existing entities (add attributes; add relationships between pre-existing entities), and (c) RECONCILE DB-physical entities with code-discovered logical entities (the `logical_data_entity_physical_data_entities` mapping DEFERRED from Spec 3). Built on Spec 1's shared normalized-name + confidence identity primitive.
>
> ### Key framing / decisions to carry (some open)
> 1. Reuse Spec 1's identity/matching primitive (`resolveEntityToPointId`, normalized-name + confidence ladder exact=1.0 / normalized=0.7 / none=0.0, in `candidateSaveBackService.ts`) as the cross-run matcher.
> 2. Introduce a candidate OPERATION dimension (create / enrich-attribute / add-relationship / link-logical-physical) — NOT new entity/relationship TYPES. An "enrich" candidate references an EXISTING entity (by resolved id) and adds attributes/relationships to it.
> 3. MODEL-AS-INPUT: the run loads the existing (project, architecture) model so the LLM + dedup step see pre-existing entities. Today the pipeline never reads the model (`discoveryV3Pipeline.ts`/`llmFileAnalysisStep.ts` see only the run's own files; `prompts/composer.ts` has no existing-model section) — inject it.
> 4. DEDUP against existing entities (not just within-run): re-discovered entity matching an existing one at high confidence → SUPPRESSED (no duplicate); below threshold → low-confidence REVIEWABLE candidate (never silently dropped).
> 5. CONFLICTS: a scan finding a DIFFERENT value for an EXISTING attribute → do NOT silently overwrite; surface as a FINDING (architecture ≠ reality: conflict is evidence; user/architect decides). Model is enriched (added to), not mutated underneath the user.
> 6. Logical↔physical RECONCILIATION (deferred from Spec 3): match DB-physical to code-logical via the primitive; populate `logical_data_entity_physical_data_entities`; exact→auto-link, normalized→reviewable, none→nothing; NEVER synthesize 1:1.
> 7. SAVE-BACK: extend `candidateSaveBackService` from create-or-skip to support enrich/link operations (add child attributes/relationships to an existing entity; never blanket-overwrite an existing entity's fields).
> 8. UI: enrichment/link candidates flow through the EXISTING Candidates review stream, clearly marked "enrich existing entity X" / "link X↔Y" vs "create new". Reuse the candidate-details pattern.
>
> ### Repo conventions / constraints
> AMS snake_case; NEW Liquibase changeset files only if a schema change is needed (the `operation` dimension may need a candidate field — next ≥166 in the working tree); no `discovery-service/src/**` edits during an in-flight run; LLM via the gateway relay. Relevant code: `discoveryV3Pipeline.ts` + `llmFileAnalysisStep.ts` (model-as-input injection point); `prompts/composer.ts` + `prompts/injection.ts` (existing-model section); `prompts/dedup.ts` + the pipeline Stage-4 dedup (dedup-against-existing); `mcp-server/src/services/candidateSaveBackService.ts` (create-or-skip → enrich/link + identity primitive); AMS discovery-candidate + relationship + attribute entities; `MigrationDiscoveryContextService`; frontend candidate-details + Candidates stream.

> **Note on file location:** the raw idea lives at the spec root (`agent-os/specs/2026-05-30-model-aware-dedup-enrichment/raw-idea.md`), not under `planning/`. Content captured verbatim above.

## Core Framing (settled)

Make discovery **MODEL-AWARE**:
- **Suppress** duplicates of existing (already-persisted) entities.
- **Enrich** existing entities (add attributes / add relationships).
- **Reconcile** DB-physical ↔ code-logical entities (the `logical_data_entity_physical_data_entities` mapping deferred from Spec 3).

Conforms to the meta-model:
- **NO new entity/relationship TYPES** — only a new candidate **OPERATION** dimension.
- **Never touch** the auto-managed `*_points` wrappers (the LLM must never create these).
- Logical and physical layers **stay distinct**.
- **Never synthesize a 1:1** logical↔physical mapping.

Reuses **Spec 1's identity primitive** (`resolveEntityToPointId`; confidence ladder exact = 1.0 / normalized = 0.7 / none = 0.0; 0.75 gate).

## Requirements Discussion

### First Round Questions
_All eight questions were resolved with the user prior to this research step. The questions and their user-approved answers are recorded below._

**Q1 — v1 scope cut:**
**Answer:** MUST-HAVE = (a) suppress duplicates of existing entities, (b) add a relationship between two pre-existing entities, (c) logical↔physical reconciliation. **INCLUDE add-attributes-to-an-existing-entity in v1** — it shares the enrich machinery and is near-free once add-relationship exists. OUT OF SCOPE = changing an existing attribute's VALUE (→ Finding, never an update). If add-attributes slips, emit it as a reviewable enrich candidate (visible, won't auto-apply) — never suppress.

**Q2 — Operation model:**
**Answer:** A NEW typed `operation` column on the discovery-candidate with values `create` / `enrich` / `link`, added via a NEW Liquibase changeset (next free ≥ 166 off the working tree), indexable/filterable like `candidate_type`. `link` is DISTINCT from `enrich`: a `link` (logical↔physical) creates a mapping relationship between two EXISTING entities; `enrich` adds attributes/relationships to ONE existing entity.

**Q3 — Review rendering:**
**Answer:** An OPERATION BADGE + target name in the candidate row ("Enrich existing `Owner`" / "Link `Owner`↔`owners`" / default "Create new"), interleaved in the EXISTING Candidates stream. The details panel shows the resolved target entity + exactly what is being added. No separate section.

**Q4 — Auto-suppress behaviour (NO silent drops — Issue 1 lesson):**
**Answer:** Reuse the confidence ladder. Auto-suppress a re-discovered duplicate ONLY at EXACT (1.0) match, and make it VISIBLE — record a run-summary count + the suppressed set ("N re-discovered entities suppressed as duplicates of existing model entities"), never silent. Normalized (0.7) → a reviewable low-confidence "possible duplicate" candidate. None → normal create.

**Q5 — Model-as-input (the architectural crux):**
**Answer:** Do the load-bearing dedup-against-existing + the logical↔physical link DETERMINISTICALLY AT SAVE-BACK (the full model is already loaded in `candidateSaveBackService`; `matchByNormalizedName` runs in CODE — deterministic, testable, zero tokens). Inject ONLY a LEAN compact index of existing entities (id, type, name, parent/table-name hint — NOT full attribute lists/descriptions) into the LLM prompt as a "these already exist — don't restate; propose enrichments/links instead" hint, so the LLM can PROPOSE enrich/link candidates referencing existing entities by name. Scope the index: relevant-slice first (the scanned service's subtree + ALL data entities, since reconcile is cross-cutting), whole-if-under-cap, and emit a Finding if the model is too large to inject in full. Net: matching in code; the LLM is only nudged.

**Q6 — Conflicts (different value for an existing attribute):**
**Answer:** NEVER overwrite. Emit a Finding linked to the `architecture_element`, default severity `low` ("architecture ≠ reality" is evidence, not a defect).

**Q7 — Cross-run identity:**
**Answer:** The enrich/link candidate carries the target's NAME + confidence and is resolved LATE at save-back (matches the existing deferred-relationship resolution; the model can change between run and approval). If the target is GONE at save-back → emit a Finding ("intended to enrich/link X; X no longer exists"), never a silent drop.

**Q8 — Out of scope:**
**Answer:** Attribute-value changes (→ Finding); creating brand-new relationship TYPES; anything touching the auto-managed `*_points` wrappers (the LLM must never create these). NOTE: a new child under an existing parent (e.g. a new endpoint on a pre-existing interface) is NOT a new "enrich" operation — it is a `create` candidate whose parent FK resolves to the existing entity (already handled by create + dedup), so it needs no special handling.

### Existing Code to Reference

**Similar Features / code to reuse:**
- **Identity primitive + create-or-skip + deferred-relationship passes:** `mcp-server/src/services/candidateSaveBackService.ts` (`resolveEntityToPointId`, `matchByNormalizedName`; confidence ladder exact = 1.0 / normalized = 0.7 / none = 0.0, 0.75 gate). This is the cross-run matcher and the save-back extension point.
- **Model load into the run:** `discovery-service/src/services/discoveryV3Pipeline.ts` and `discovery-service/src/services/llmFileAnalysisStep.ts` (model-as-input injection point), using `archModelClient` to load the existing (project, architecture) model.
- **Lean existing-entity index injection into the prompt:** `prompts/composer.ts` + `prompts/injection.ts` (add an existing-model / "these already exist" section).
- **Within-run dedup logic to extend to dedup-against-existing:** `prompts/dedup.ts` + the pipeline Stage-4 dedup.
- **Conflict + suppression + target-gone findings:** `FindingEmitter.ts`.
- **Discovery context service:** `MigrationDiscoveryContextService`.
- **Frontend:** existing candidate-details pattern + the Candidates review stream (for the operation badge + target name + details-panel target rendering).
- **AMS entities:** discovery-candidate + relationship + attribute entities (new `operation` column lands on the discovery-candidate).

### Follow-up Questions
None — all eight shaping questions were resolved and user-approved before this step.

## Visual Assets

### Files Provided:
No visual assets provided. (Confirmed: none supplied. The work is backend-heavy and reuses the existing Candidates stream plus a per-row operation badge.)

### Visual Insights:
N/A — no visuals to analyse.

## Requirements Summary

### Functional Requirements

**Model-aware dedup (suppress duplicates of existing entities):**
- Match a re-discovered entity against the existing persisted model using the reused identity primitive.
- EXACT (1.0) match → auto-suppress the duplicate, but VISIBLY: record a run-summary count + the suppressed set ("N re-discovered entities suppressed as duplicates of existing model entities"). Never a silent drop.
- NORMALIZED (0.7) match → reviewable low-confidence "possible duplicate" candidate.
- NONE → normal `create` candidate.
- Load-bearing matching is DETERMINISTIC and runs in CODE at save-back (`candidateSaveBackService`), not in the LLM.

**Enrich existing entities (add attributes / relationships):**
- `enrich` candidate references ONE existing entity (by NAME + confidence, resolved late at save-back) and adds attributes and/or relationships to it.
- Includes **add-attributes-to-an-existing-entity** in v1 (shares enrich machinery).
- Includes **add-a-relationship-between-two-pre-existing-entities** in v1.
- Save-back extends create-or-skip to apply enrich operations WITHOUT blanket-overwriting any existing entity field.
- If add-attributes can't auto-apply, it surfaces as a visible reviewable enrich candidate — never suppressed.

**Logical↔physical reconciliation (`link`):**
- `link` is DISTINCT from `enrich`: it creates a mapping relationship between two EXISTING entities (a logical data entity and a physical data entity).
- Match DB-physical to code-logical via the identity primitive; populate `logical_data_entity_physical_data_entities`.
- EXACT → auto-link; NORMALIZED → reviewable; NONE → nothing. NEVER synthesize a 1:1 mapping.
- Reconcile is cross-cutting, so ALL data entities are in scope for the existing-entity index (not just the scanned subtree).

**Operation dimension:**
- NEW typed `operation` column on the discovery-candidate: `create` / `enrich` / `link`. Indexable/filterable like `candidate_type`.
- NOT new entity/relationship TYPES.

**LLM model-as-input (lean nudge only):**
- Inject a LEAN compact index of existing entities (id, type, name, parent/table-name hint — NOT full attribute lists/descriptions) into the prompt as a "these already exist — don't restate; propose enrichments/links instead" hint.
- Index scope: relevant-slice first (scanned service's subtree + ALL data entities), whole-if-under-cap; emit a Finding if the model is too large to inject in full.
- The LLM PROPOSES enrich/link candidates referencing existing entities by name; the LLM never does the load-bearing matching.

**Conflicts:**
- A scan finding a DIFFERENT value for an EXISTING attribute → NEVER overwrite; emit a Finding linked to the `architecture_element`, default severity `low`.

**Cross-run identity / target resolution:**
- enrich/link candidates carry the target's NAME + confidence; resolved LATE at save-back (model can change between run and approval).
- Target GONE at save-back → emit a Finding ("intended to enrich/link X; X no longer exists"), never a silent drop.

**Review rendering (frontend):**
- Operation BADGE + target name in the candidate row ("Enrich existing `Owner`" / "Link `Owner`↔`owners`" / default "Create new"), interleaved in the EXISTING Candidates stream.
- Details panel shows the resolved target entity + exactly what is being added. No separate section.

### Reusability Opportunities
- `candidateSaveBackService.ts` — identity primitive, create-or-skip, deferred-relationship passes (extend for enrich/link + deterministic dedup-suppress + logical↔physical link + late name-resolution).
- `discoveryV3Pipeline.ts` / `llmFileAnalysisStep.ts` + `archModelClient` — model load.
- `prompts/composer.ts` / `prompts/injection.ts` — lean existing-entity index injection.
- `prompts/dedup.ts` + pipeline Stage-4 dedup — extend within-run dedup to dedup-against-existing.
- `FindingEmitter.ts` — conflict, suppression-summary, and target-gone findings.
- `MigrationDiscoveryContextService` — discovery context.
- Frontend candidate-details pattern + Candidates stream — operation badge, target name, details-panel target rendering.
- AMS discovery-candidate + relationship + attribute entities — new `operation` column on the discovery-candidate.

### Scope Boundaries

**In Scope (v1):**
- Suppress duplicates of existing entities (visible auto-suppress at exact match; reviewable possible-duplicate at normalized).
- Add a relationship between two pre-existing entities (`enrich`).
- Add attributes to an existing entity (`enrich`).
- Logical↔physical reconciliation (`link`) populating `logical_data_entity_physical_data_entities`.
- New `operation` column (`create`/`enrich`/`link`) on the discovery-candidate via a new Liquibase changeset (≥ 166).
- Lean existing-entity index injected into the LLM prompt; deterministic matching in code at save-back.
- Conflict, suppression-summary, and target-gone Findings.
- Operation badge + target name in the Candidates stream + details-panel target rendering.

**Out of Scope:**
- Changing an EXISTING attribute's VALUE → emit a Finding; never an in-place update.
- Creating brand-new relationship TYPES.
- Anything touching the auto-managed `*_points` wrappers (the LLM must never create these).
- A new child under an existing parent is NOT treated as `enrich` — it is a `create` candidate whose parent FK resolves to the existing entity (already handled by create + dedup); no special handling.
- Synthesizing a 1:1 logical↔physical mapping.

### Technical Considerations

**Layering (build order):**
1. **AMS** — new `operation` column on the discovery-candidate + new Liquibase changeset (≥ 166).
2. **discovery-service** — load the existing model via `archModelClient`; inject the LEAN existing-entity index into the prompt in `composer.ts` / `injection.ts`; emit `create`/`enrich`/`link` candidates.
3. **MCP save-back** (`candidateSaveBackService`) — deterministic dedup-suppress at exact match + logical↔physical link reconciliation + late name-resolution of enrich/link targets; conflicts → Findings; target-gone → Finding; extend create-or-skip to enrich/link operations WITHOUT blanket-overwriting existing entity fields.
4. **frontend** — operation badge + target name in the Candidates stream + details panel.

**Constraints:**
- AMS speaks snake_case at the wire.
- NEW Liquibase changeset files only (next free ≥ 166 off the working tree); never edit applied changesets.
- No `discovery-service/src/**` edits during an in-flight run (tsx watch auto-reload kills runs).
- LLM access is via the gateway relay.
- Never create `*_points` wrappers.
- Never synthesize a 1:1 logical↔physical mapping.
- Conforms to the Architecture Meta-Model Reference (`gateway/src/config/prompts/shared/architecture-context-explainer.md`): meta-model holds ARCHITECTURE only; logical and physical are distinct layers joined by an explicit non-1:1 mapping relationship.

**Design principle (Issue 1 lesson):** NO silent drops anywhere — suppressions are counted and surfaced; below-threshold matches become reviewable candidates; missing targets and conflicts become Findings.
