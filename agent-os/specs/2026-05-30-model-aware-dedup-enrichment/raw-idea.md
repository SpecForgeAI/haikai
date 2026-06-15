# Issue 2 — Model-aware discovery: dedup against existing entities + enrichment/update candidates

Part of the HAIKAI discovery richness program (like-for-like API/DB migration tool). North star: memory `project_migration_ultimate_goal`. Specs 1-3 built + Issue 1 fixed; this is the model-aware spec.

**READ FIRST (fundamental):** the Architecture Meta-Model Reference `gateway/src/config/prompts/shared/architecture-context-explainer.md`. Ground everything in it. Rules: meta-model holds ARCHITECTURE only; logical vs physical are DISTINCT layers joined by EXPLICIT non-1:1 mapping relationships (`logical_data_entity_physical_data_entities`); polymorphic `*_points` wrappers are backend AUTO-MANAGED (never create directly). See memories `feedback_read_meta_model`, `project_architecture_vs_reality`.

## Problem / goal
A discovery run is MODEL-BLIND: it never loads the existing architecture model, dedup is within-run only, save-back is create-or-skip (name match → reuse, NEVER update — extra attributes/relationships on a re-discovered entity are dropped). So a code scan re-discovering a DB-scan's entity DUPLICATES it; attributes/relationships found later can't ENRICH an existing entity. Make discovery MODEL-AWARE: feed the existing (project, architecture) model in as input so a run can (a) SUPPRESS duplicates of already-persisted entities, (b) ENRICH existing entities (add attributes; add relationships between pre-existing entities), and (c) RECONCILE DB-physical entities with code-discovered logical entities (the `logical_data_entity_physical_data_entities` mapping DEFERRED from Spec 3). Built on Spec 1's shared normalized-name + confidence identity primitive.

## Key framing / decisions to carry (some open)
1. Reuse Spec 1's identity/matching primitive (`resolveEntityToPointId`, normalized-name + confidence ladder exact=1.0 / normalized=0.7 / none=0.0, in `candidateSaveBackService.ts`) as the cross-run matcher.
2. Introduce a candidate OPERATION dimension (create / enrich-attribute / add-relationship / link-logical-physical) — NOT new entity/relationship TYPES. An "enrich" candidate references an EXISTING entity (by resolved id) and adds attributes/relationships to it.
3. MODEL-AS-INPUT: the run loads the existing (project, architecture) model so the LLM + dedup step see pre-existing entities. Today the pipeline never reads the model (`discoveryV3Pipeline.ts`/`llmFileAnalysisStep.ts` see only the run's own files; `prompts/composer.ts` has no existing-model section) — inject it.
4. DEDUP against existing entities (not just within-run): re-discovered entity matching an existing one at high confidence → SUPPRESSED (no duplicate); below threshold → low-confidence REVIEWABLE candidate (never silently dropped).
5. CONFLICTS: a scan finding a DIFFERENT value for an EXISTING attribute → do NOT silently overwrite; surface as a FINDING (architecture ≠ reality: conflict is evidence; user/architect decides). Model is enriched (added to), not mutated underneath the user.
6. Logical↔physical RECONCILIATION (deferred from Spec 3): match DB-physical to code-logical via the primitive; populate `logical_data_entity_physical_data_entities`; exact→auto-link, normalized→reviewable, none→nothing; NEVER synthesize 1:1.
7. SAVE-BACK: extend `candidateSaveBackService` from create-or-skip to support enrich/link operations (add child attributes/relationships to an existing entity; never blanket-overwrite an existing entity's fields).
8. UI: enrichment/link candidates flow through the EXISTING Candidates review stream, clearly marked "enrich existing entity X" / "link X↔Y" vs "create new". Reuse the candidate-details pattern.

## Open shaping questions (resolve with user — do NOT auto-decide)
- v1 scope cut: must-have = suppress duplicates + add-relationship between existing entities + logical↔physical reconciliation; nice-to-have = add-attributes to existing entity; out-of-scope = changing an existing attribute's VALUE (→ finding, not update)?
- Operation model: candidate `operation` field (create/enrich/link) vs separate candidate types; how it renders in review.
- Matching threshold + when to ask the user (exact=1.0 auto / normalized=0.7 reviewable; auto only at high confidence).
- Model-as-input scope: inject the WHOLE architecture's entities or scope to the service being scanned? Token/size budget (the main cost/scaling risk).
- Confirm conflict handling: different attribute value → finding, never overwrite.
- Cross-run identity: how an enrich/link candidate references the existing entity (resolved `dep_log_`/`dep_phy_` point-id vs name+confidence resolved at save-back).

## Repo conventions / constraints
AMS snake_case; NEW Liquibase changeset files only if a schema change is needed (the `operation` dimension may need a candidate field — next ≥166 in the working tree); no `discovery-service/src/**` edits during an in-flight run; LLM via the gateway relay. Relevant code: `discoveryV3Pipeline.ts` + `llmFileAnalysisStep.ts` (model-as-input injection point); `prompts/composer.ts` + `prompts/injection.ts` (existing-model section); `prompts/dedup.ts` + the pipeline Stage-4 dedup (dedup-against-existing); `mcp-server/src/services/candidateSaveBackService.ts` (create-or-skip → enrich/link + identity primitive); AMS discovery-candidate + relationship + attribute entities; `MigrationDiscoveryContextService`; frontend candidate-details + Candidates stream.
