# Spec Requirements: Data-Layer Fidelity 2 — Cross-Engine DB Capture Completeness (Sybase + Postgres)

## Initial Description

Part of the HAIKAI Phase-2 "oracle perfection" program (like-for-like API/DB migration tool). This is **Spec #6 of 6 — the FINAL spec** — and it closes the remaining audited gaps in database-reality capture so that a cross-engine (Sybase→Postgres) schema migration is **lossless**.

TERMINOLOGY: "oracle" = source-of-truth / specification authority (NOT Oracle Database). DB packs in scope are **Sybase** (legacy source) and **PostgreSQL** (target).

**Core principle — ARCHITECTURE ≠ REALITY.** The architecture meta-model holds **ARCHITECTURE only**. Important non-architecture reality (the runnable detail of database objects) is captured as **Findings** fed from the discovery IR, plus **additive JSONB metadata on existing attributes / relationships** — **never** as new meta-model entity types. The migration specification oracle is: the architecture meta-model (kept clean — structural truth only) PLUS Findings (the evidence/reality layer) PLUS architect / PM conversations.

A DB migration (Sybase→Postgres) is a STATIC schema transform — there is no runtime "fire the same request at both engines" oracle for a schema, so Discovery's captured database reality IS the migration source of truth. Spec 3 (`2026-05-29-db-structural-fidelity`) plus the already-merged quick-win **W3** closed the first wave of structural drops: W3 added the verbatim FK referential ACTIONS (`on_delete` / `on_update`) into the `fk_columns` JSONB, and index ordering / clustering / partial-predicate detail (`definition` / `method` / `is_clustered` / `predicate` / `column_directions`) into `constraints_metadata`. **W3 is ALREADY DONE on HEAD — this spec EXTENDS it, it does NOT redo it.**

This spec addresses the gaps that W3 did NOT cover and that still break a faithful cross-engine reproduction: per-endpoint SQL TEXT (currently discarded), collation / case-sensitivity (uncaptured), sequence current value (unread), engine-specific default-expression hazards (unflagged), computed/generated columns (indistinguishable from plain columns), database-resident scheduled jobs/agents (un-introspected — empty stubs), and fuller Postgres procedure capture (body-only today).

All decisions in this document are **FINAL and pre-approved by the user**. This is an autonomous build with NO outstanding questions.

## Requirements Discussion

### First Round Questions

> All questions below were resolved and user-approved before requirements documentation. The decisions are recorded as the authoritative, decision-complete answers; the spec was relayed as COMPLETE (autonomous build, no questions).

**Q1: Per-endpoint SQL TEXT — where does the captured query text land, and what about the SQL we currently discard on native/dynamic queries?**

**Answer:** Capture the **actual query text + its kind** per endpoint into the EXISTING `endpoint_data_effects` `path_metadata_json` JSONB via two **additive keys**: `query_text` (the verbatim SQL/JPQL string) and `query_kind` (one of: `jpql` for a `@Query` JPQL string, `native` for `@Query(nativeQuery=true)`, `jdbc_template` for a JdbcTemplate string SQL argument, `mybatis` for a MyBatis mapper SQL statement). `path_metadata_json` is a free-form `jsonb` `Map<String,Object>` on `EndpointDataEffectEntity` (verified, line 110-111) so these keys need **NO new column and NO changeset**. For the SQL we currently DISCARD — when the chain resolves to dynamic / native persistence and we emit an `endpoint_data_effect_unresolved` Finding — ALSO capture the **verbatim SQL string IN that Finding's detail** instead of throwing it away. The literal is already present in the IR; today `discovery-service/src/services/extensionPacks/languageExtractors/java/extract.ts:63` sets `args: []` with the comment "arg literals not captured for Java (arity only)", which is precisely the gap **Spec #5** closes (call-arg-literal retention) — REUSE Spec #5's retained `CallIR.args` for JdbcTemplate / `createNativeQuery` SQL strings, and read the `@Query` annotation value from `AnnotationIR.args` (already captured as a `Record<string,string>`). REUSE Spec #1's data-effect path (`endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`) — do NOT fork a parallel scanner.

**Q2: Collation / case-sensitivity — where does it land?**

**Answer:** Introspect **column-level and database-level collation** into the DB IR (additive optional field on the column metadata + a DB-level collation carrier), and add the column collation to the **physical-attribute metadata** (additive alongside the existing `source_type` / structural capture on `physical_data_attributes`). ALSO emit a **cross-engine hazard Finding** when the source collation implies case-insensitive matching (Sybase CI default) that Postgres (case-sensitive by default) would NOT reproduce — i.e. `WHERE name='smith'` diverges silently across engines. Verbatim collation string, no normalization.

**Q3: Sequence current value — where does it land, and what about Sybase?**

**Answer:** Introspect the sequence **current value** — Postgres `last_value` / `currval` — into the existing `SequenceMetadata` IR carrier (additive optional field; today it has start/increment/min/max/cycle ONLY, verified) and emit a **cutover-hazard Finding** (the first post-cutover INSERT would collide with existing PKs unless the target sequence is advanced past the current high-water mark). For **Sybase**, read the current value **via the existing sidecar if it exposes it** (`sybaseSidecarClient.ts`); if the sidecar does not expose it, leave a `TODO(oracle-W3)`-style note and emit the Finding with the value marked unavailable — **DO NOT modify the external Sybase sidecar** (consume what it exposes, TODO the rest).

**Q4: Engine-specific default expressions — flag or rewrite?**

**Answer:** **Flag only — never rewrite.** Detect engine-specific server defaults (`getdate()` / `newid()` / `suser_name()` / `host_name()` and the like) and emit a **Finding flagging the non-portable default** for the book-of-work (these have no identical Postgres equivalent). KEEP the verbatim default string exactly as captured (Spec 3's no-normalization rule — the `column_default` value stays verbatim on the attribute; the hazard lives in the Finding, not as a mutation of the stored expression).

**Q5: Computed / generated columns — how distinguished?**

**Answer:** Capture an **additive boolean-style flag on the physical attribute** distinguishing a computed/generated column (`GENERATED ALWAYS AS (expr)` / Sybase computed column) from a plain writable column, PLUS the **generation expression captured verbatim**. Without this, generated columns are recreated as plain writable columns (wrong: they must be re-declared as generated, not populated by INSERT/UPDATE).

**Q6: Database-resident jobs / agents — entities or findings?**

**Answer:** **Findings — procedural reality, NOT entity types.** Introspect database scheduled jobs / agents (the Sybase scheduler; the Postgres equivalent where present) into **rich Findings**. Concretely, **fill the empty `emitUnsupportedFeatureFindings` stubs** in BOTH packs — `databasePacks/postgres/postgresFindings.ts:587` and `databasePacks/sybase/sybaseFindings.ts:510` both currently `return []` (verified) — so the genuinely-unsupported / non-portable database-resident features land as Findings for the book-of-work.

**Q7: Postgres procedure capture — body-only or fuller?**

**Answer:** **Fuller.** Postgres procedure capture today uses `p.prosrc AS proc_src` (body only — verified at `postgresIntrospection.ts:824`). Use `pg_get_functiondef(p.oid)` (or capture **signature / arguments / return type / volatility / `SECURITY DEFINER`** alongside `prosrc`) so overloaded and security-context functions are recreatable. The body still goes to its existing Finding; the richer signature/volatility/security metadata is captured alongside it.

**Q8: New entity types?**

**Answer:** **NONE.** Everything is additive — database reality lands as Findings PLUS on-attribute / on-relationship JSONB metadata. **NEVER a new meta-model entity TYPE** (architecture ≠ reality). This is the same invariant Spec 3 established.

### Existing Code to Reference

**Similar Features Identified:**

- **Spec 3 DB introspection (EXTEND, do not fork)** — Postgres: `discovery-service/src/services/databasePacks/postgres/postgresIntrospection.ts` (column / sequence / procedure introspection — add collation, sequence current value, computed-column flag, and `pg_get_functiondef`-based fuller proc capture here). Sybase: `discovery-service/src/services/databasePacks/sybase/sybaseIntrospection.ts` + `discovery-service/src/services/databasePacks/sybase/sybaseSidecarClient.ts` (collation, computed-column flag, sequence current value where the sidecar exposes it — consume only, never modify the external sidecar).
- **DB IR types (EXTEND)** — `discovery-service/src/services/databasePacks/types.ts`. Add additive optional fields: column collation + computed/generated flag + generation expression on the column metadata; `last_value` / current-value on `SequenceMetadata` (today start/increment/min/max/cycle only); fuller proc signature/volatility/`SECURITY DEFINER` carrier on the procedure metadata. W3 already added the FK `on_delete`/`on_update` and index clustering/predicate/`column_directions` fields here (verified, lines ~368-558) — EXTEND alongside, do not touch.
- **Structural-fidelity builders (EXTEND, shared with W3)** — `discovery-service/src/services/databasePacks/candidateStructuralFidelity.ts`. This is where the verbatim attribute metadata (`source_type`, `column_default`, …) and the W3 `fk_columns` / `constraints_metadata` keys are assembled. Add collation + computed-column flag + generation expression to the per-attribute JSONB here.
- **DB-pack Finding builders (EXTEND)** — `discovery-service/src/services/findings/databasePackFindingScanners/databasePackFindingBuilders.ts`, plus the per-engine `databasePacks/postgres/postgresFindings.ts` and `databasePacks/sybase/sybaseFindings.ts`. Add the new cross-engine hazard Findings (collation CI→CS, sequence cutover, non-portable default) and FILL the empty `emitUnsupportedFeatureFindings` stubs (jobs/agents). Emit through the existing `FindingEmitter` singleton (`findings/FindingEmitter.ts`) — do not introduce a parallel emit path.
- **Endpoint→SQL-text capture (Spec #1 data-effect path; REUSE)** — `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver.ts` (the controller→service→repository walk; the `UnresolvedDataEffect` shape and the dynamic-persistence escape detection around lines 610-980) and `endpointDataEffectCandidates.ts` (where the resolved effects become candidates carrying `path_metadata_json`). Add `query_text` / `query_kind` to the resolved `path_metadata_json`, and attach the verbatim SQL string to the unresolved Finding instead of discarding it.
- **Spec #5 call-arg-literal extractor (REUSE its retained args)** — `discovery-service/src/services/extensionPacks/languageExtractors/java/extract.ts` (line 63 today: `args: []` — Spec #5 changes this to retain literal args) and `discovery-service/src/services/extensionPacks/languageExtractors/java/astUtils.ts` (annotation args already captured as `Record<string,string>` at line ~180 — the `@Query` value is here). Consume the retained `CallIR.args` (JdbcTemplate / `createNativeQuery` SQL strings) and `AnnotationIR.args` (`@Query` value) — do NOT re-implement literal extraction.
- **AMS landing surfaces (additive into EXISTING JSONB — prefer NO changeset)** — `EndpointDataEffectEntity` (`path_metadata_json` is `jsonb` `Map<String,Object>`, verified line 110-111 — the additive `query_text`/`query_kind` keys need no schema change) + its DTO/mapper (`EndpointDataEffectDto`, `EndpointDataEffectMapper`); `PhysicalDataAttributeEntity` (collation + computed flag + generation expression land on the existing physical-attribute metadata; verified this entity carries the Spec-3 `source_type`/`column_default`/`is_identity` structural fields) + its DTO/mapper. Findings persist through the existing discovery-findings path.
- **Oracle feed** — `MigrationDiscoveryContextService` → book-of-work / shape-spec. All the new Findings reach the migration oracle through this existing feed.
- **Frontend** — candidate-details panels + `FindingsTab` (`frontend/src/components/Discovery/`). Render the new SQL-text / collation / computed-column flags in the existing candidate-details surfaces; reuse the existing expandable read-only viewer pattern for the SQL text.

### Follow-up Questions

No follow-up questions. All decisions were resolved and user-approved before requirements documentation; the spec was relayed as COMPLETE (autonomous build, no questions).

## Visual Assets

### Files Provided:

No visual assets provided. (Bash check of `planning/visuals/` returned no image files — the directory was created empty.)

### Visual Insights:

None. The feature reuses the existing Candidates stream + Findings tab + candidate-details panels + the existing expandable read-only SQL viewer pattern; no new design mockups are required.

## Requirements Summary

### Functional Requirements

**A — Per-endpoint SQL TEXT capture (reuse Spec #1 data-effect path + Spec #5 retained literals):**

- Add additive keys `query_text` (verbatim SQL/JPQL) and `query_kind` (`jpql` / `native` / `jdbc_template` / `mybatis`) to the resolved `endpoint_data_effects.path_metadata_json` JSONB. No new column, no changeset (free-form `jsonb` map confirmed).
- For native / dynamic SQL that resolves to an `endpoint_data_effect_unresolved` Finding, ALSO capture the verbatim SQL string IN that Finding's detail instead of discarding it.
- Source the `@Query` value from `AnnotationIR.args`; source JdbcTemplate / `createNativeQuery` SQL strings from Spec #5's retained `CallIR.args` (Java extractor `args: []` → retained literals). Build a `@Query` / native-query / JdbcTemplate-string / MyBatis SQL capture (the scanner that does NOT exist today — verified no `@Query`/`nativeQuery` SQL scanner anywhere in discovery services).

**B — Collation / case-sensitivity:**

- Introspect column-level and database-level collation into the DB IR (additive optional fields; verbatim string, no normalization).
- Add column collation to the `physical_data_attributes` metadata (additive alongside `source_type`).
- Emit a cross-engine hazard Finding when source collation implies case-insensitive matching (Sybase CI) that Postgres (CS default) would not reproduce.

**C — Sequence current value:**

- Introspect Postgres `last_value` / `currval` into `SequenceMetadata` (additive optional field; today start/increment/min/max/cycle only).
- Emit a cutover-hazard Finding (first post-cutover INSERT would collide with existing PKs).
- Sybase current value via the existing sidecar if exposed; else `TODO(oracle-W3)`-style note + Finding marked value-unavailable. Do NOT modify the external sidecar.

**D — Engine-specific default-expression hazards:**

- Detect engine-specific server defaults (`getdate()` / `newid()` / `suser_name()` / `host_name()` etc.) and emit a Finding flagging the non-portable default for the book-of-work.
- Keep the verbatim `column_default` string exactly as captured (no normalization, no rewrite).

**E — Computed / generated columns:**

- Capture an additive flag on the physical attribute distinguishing a computed/generated column (`GENERATED ALWAYS AS (expr)` / Sybase computed) from a plain writable column.
- Capture the generation expression verbatim.

**F — Database-resident jobs / agents:**

- Introspect database scheduled jobs / agents (Sybase scheduler; Postgres equivalent where present) into rich Findings.
- Fill the empty `emitUnsupportedFeatureFindings` stubs in BOTH packs (`postgresFindings.ts:587` and `sybaseFindings.ts:510` both `return []` today) so genuinely-unsupported / non-portable database-resident features land as Findings.

**G — Fuller Postgres procedure capture:**

- Use `pg_get_functiondef(p.oid)` (or capture signature / arguments / return type / volatility / `SECURITY DEFINER` alongside the existing `prosrc` body) so overloaded and security-context functions are recreatable. Body still goes to its existing Finding; the richer metadata is captured alongside.

**H — Invariant (all of the above):**

- Everything additive: database reality → Findings + on-attribute / on-relationship JSONB metadata. NEVER a new meta-model entity TYPE.

### Reusability Opportunities

- EXTEND Spec #3's introspection (`postgresIntrospection.ts` / `sybaseIntrospection.ts` / `sybaseSidecarClient.ts`), IR types (`types.ts`), and structural-fidelity builders (`candidateStructuralFidelity.ts`) — do NOT fork them. W3's FK-action / index-detail additions already live in these files; extend alongside.
- REUSE Spec #1's data-effect path (`endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`) for the SQL-text capture — additive `path_metadata_json` keys + attach-to-unresolved-Finding; no parallel scanner.
- REUSE Spec #5's retained call-arg literals (`java/extract.ts` `args` + `java/astUtils.ts` annotation args) for the SQL strings — no re-implemented literal extraction. **This is why the build must come AFTER #5.**
- REUSE the existing `FindingEmitter` singleton and the DB-pack Finding builders (`databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts`) for every new Finding — including filling the existing empty `emitUnsupportedFeatureFindings` stubs.
- Additive into EXISTING AMS JSONB (`endpoint_data_effects.path_metadata_json`, the `physical_data_attributes` metadata) — prefer NO changeset. Extend the matching DTOs/mappers.
- REUSE `MigrationDiscoveryContextService` as the oracle feed; the existing Candidates stream + `FindingsTab` + candidate-details panels + expandable read-only viewer for the frontend.

### Scope Boundaries

**In Scope:**

- A: per-endpoint SQL TEXT capture (`query_text` / `query_kind` on `path_metadata_json`; verbatim SQL on the unresolved Finding; the `@Query` / native / JdbcTemplate / MyBatis capture).
- B: collation / case-sensitivity into the IR + physical-attribute metadata + cross-engine hazard Finding.
- C: sequence current value into `SequenceMetadata` + cutover-hazard Finding (Sybase via sidecar if exposed; else TODO + Finding).
- D: engine-specific default-expression hazard Findings (verbatim string kept).
- E: computed/generated column flag + verbatim generation expression on the physical attribute.
- F: database-resident jobs/agents → Findings (fill the empty `emitUnsupportedFeatureFindings` stubs in both packs).
- G: fuller Postgres procedure capture (`pg_get_functiondef` / signature / args / return / volatility / `SECURITY DEFINER`).
- Validation: offline introspection→candidate/finding mappers + AMS model round-trips, unit-tested.

**Out of Scope:**

- **Redoing W3** — FK referential actions (`on_delete`/`on_update` in `fk_columns`) and index ordering/clustering/partial-predicate detail (`definition`/`method`/`is_clustered`/`predicate`/`column_directions` in `constraints_metadata`) are ALREADY DONE on HEAD. EXTEND, do not redo.
- **Normalizing engine type / expression strings** — captured VERBATIM. The Sybase→Postgres type/expression mapping is a downstream migration / shape-spec concern.
- **A SQL rewriter / translator** — this spec CAPTURES the SQL text and FLAGS the cross-engine hazards; it does NOT translate SQL, defaults, collations, or computed expressions to the target engine.
- **Non-Sybase / non-Postgres engines** — only Sybase (source) and Postgres (target).
- **New architecture entity types** — none (architecture ≠ reality; all additive Findings + JSONB metadata).
- **Modifying the external Sybase sidecar** — consume what it exposes; TODO the rest.
- Live fidelity validation against a real sample Sybase + Postgres schema — leans on the user's environment; NOT blocking this spec.

### Technical Considerations

- **AMS wire format**: snake_case by default (per repo CLAUDE.md); the additive `path_metadata_json` keys and physical-attribute metadata follow the existing entities' conventions. Prefer **NO changeset** — `endpoint_data_effects.path_metadata_json` is a free-form `jsonb` `Map<String,Object>` (verified) and the collation / computed-column / generation-expression data lands in the existing `physical_data_attributes` metadata. **VERIFY at build time** whether any of this truly needs a first-class column; only if one is genuinely required, the next free changeset number is **≥168** (highest applied is 167 — verified). Any new numeric field that participates in PATCH must be a **boxed type** (Double/Long/Boolean) with null guards (primitive-PATCH-wipe hazard).
- **Liquibase**: NEW changeset files ONLY, never edit applied ones; floor **≥168** if (and only if) a new column proves unavoidable.
- **Discovery runtime**: NO `discovery-service/src/**` edits during an in-flight run (tsx watch auto-reload kills runs).
- **Findings emission**: all new Findings via the existing `FindingEmitter` singleton; fill (do not bypass) the existing `emitUnsupportedFeatureFindings` stubs.
- **Verbatim capture**: every engine string (collation, default expression, generation expression, SQL text, proc definition) stored exactly as read — no normalization.
- **Sidecar boundary**: read-only consumption of the external Sybase sidecar; `TODO(oracle-W3)`-style note where it does not expose a needed value.
- **Blast radius / ripple**: the SQL-text keys touch the endpoint-data-effect DTO/mapper + the frontend candidate-details rendering; the collation / computed-column / generation-expression fields touch the physical-attribute IR → structural-fidelity builder → AMS physical-attribute metadata DTO/mapper → frontend candidate-details. An introspection-only change would leave the candidate metadata, DTOs, and candidate-details panels silently lagging — thread each new field through all layers or explicitly scope it out.
- **Done-bar**: offline introspection→candidate/finding mappers + AMS model round-trips green (unit-tested). Live cross-engine fidelity validation leans on the user's environment and is NOT blocking.

## Phase-2 Build Ordering & File-Overlap

This is **Spec #6 of 6 — the FINAL spec** of the HAIKAI Phase-2 "oracle perfection" program, built **STRICTLY SEQUENTIALLY LAST**. It is the most downstream spec and is designed to extend every prior committed spec rather than run in parallel with any of them.

**Hard ordering dependency — build AFTER Spec #5:**
- The per-endpoint SQL-text capture (Requirement A) consumes the call-argument literals that **Spec #5** retains. Today the Java extractor sets `args: []` (`languageExtractors/java/extract.ts:63`, "arg literals not captured for Java (arity only)") — Spec #5 changes this to retain literal args. This spec reads the retained `CallIR.args` (JdbcTemplate / `createNativeQuery` SQL strings) and the already-captured `AnnotationIR.args` (`@Query` value, in `languageExtractors/java/astUtils.ts`). Building this spec before #5 would mean the SQL literals are still dropped at the extractor. **Therefore: build #6 AFTER #5 lands.**

**Shared-file overlap (extend prior committed work, never fork):**
- **With W3 (already on HEAD):** shares the DB introspection (`postgresIntrospection.ts` / `sybaseIntrospection.ts`), the IR types (`types.ts`), and the structural-fidelity builder (`candidateStructuralFidelity.ts`). W3's FK-action and index-detail additions already live in these files; this spec adds collation / computed-column flag / generation expression / sequence current value alongside them. **Extend — do not redo W3.**
- **With Spec #1 (data-effect graph) and Spec #5:** shares the endpoint data-effect path (`endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`). This spec adds `query_text` / `query_kind` to the resolved `path_metadata_json` and attaches the verbatim SQL to the unresolved Finding — additive into the same path, not a parallel scanner.
- **With Spec #3 (DB structural fidelity):** shares the DB-pack Finding builders (`databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts`) and the `FindingEmitter`. This spec adds the new cross-engine hazard Findings and fills the empty `emitUnsupportedFeatureFindings` stubs Spec #3 left as placeholders.

**Net effect:** because #6 is built last, all of these shared files already carry the prior specs' committed changes when this spec begins; this spec's job is to EXTEND them additively — never to fork a parallel implementation and never to re-do W3's already-merged FK-action / index-detail work.
