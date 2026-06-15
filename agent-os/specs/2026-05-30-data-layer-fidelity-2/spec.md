# Specification: Data-Layer Fidelity 2 — Cross-Engine DB Capture Completeness (Sybase + Postgres)

## Goal
Close the remaining audited gaps in database-reality capture so a cross-engine (Sybase→Postgres) schema migration is lossless, capturing per-endpoint SQL text, collation, sequence current value, engine-specific default/computed-column hazards, DB-resident jobs, and fuller Postgres procedure detail — all as additive Findings + on-attribute/on-relationship JSONB metadata, never new entity types.

## User Stories
- As a migration architect, I want the actual SQL text behind each endpoint and every cross-engine hazard (collation, sequence high-water mark, non-portable defaults, computed columns, scheduled jobs) captured as evidence, so the book-of-work can reproduce the source database faithfully on Postgres.
- As a platform engineer, I want this captured verbatim and additively into existing JSONB + Findings, so no architecture entity types are minted and no schema changeset is forced.

## Specific Requirements

**A — Per-endpoint SQL TEXT capture (reuse Spec #1 data-effect path + Spec #5 retained literals)**
- Add two additive keys to the resolved `endpoint_data_effects.path_metadata_json` JSONB: `query_text` (verbatim SQL/JPQL string) and `query_kind` (`jpql` | `native` | `jdbc_template` | `mybatis`).
- Assemble these in `endpointDataEffectCandidates.ts` alongside the existing `hops` / `operation_hint` / `transactional` keys (the `toPathMetadata` builder); no new column, no changeset (free-form `jsonb Map<String,Object>` confirmed at `EndpointDataEffectEntity` lines 109-111).
- For native/dynamic SQL that resolves to an `endpoint_data_effect_unresolved` Finding, ALSO attach the verbatim SQL string to that Finding's `detail` instead of discarding it (the dynamic-persistence escape at `endpointDataEffectResolver.ts` ~L700 / unresolved emit ~L1045).
- Source the `@Query` / `@Query(nativeQuery=true)` value from `AnnotationIR.args` (already a `Record<string,string>`, `astUtils.ts` ~L219-238); source JdbcTemplate / `createNativeQuery` SQL strings from the committed `CallIR.args` (Spec #5: `extract.ts` now `args: c.args`, no longer `args: []`).
- Build the `@Query` / native / JdbcTemplate-string / MyBatis SQL capture into the EXISTING resolver/candidate path — do NOT fork a parallel scanner.

**B — Collation / case-sensitivity**
- Introspect column-level and database-level collation into the DB IR (additive optional fields on `ColumnMetadata` plus a DB-level collation carrier); verbatim string, no normalization.
- Add column collation to the `physical_data_attributes` metadata via `candidateStructuralFidelity.ts` (additive alongside `source_type` / `column_default`).
- Emit a cross-engine hazard Finding when the source collation implies case-insensitive matching (Sybase CI default) that Postgres (case-sensitive default) would not reproduce.

**C — Sequence current value**
- Introspect Postgres `last_value` / `currval` into `SequenceMetadata` (additive optional field; today carries start/increment/min/max/cycle only).
- Emit a cutover-hazard Finding (first post-cutover INSERT collides with existing PKs unless the target sequence is advanced past the high-water mark).
- Sybase current value via the existing sidecar if exposed (`sybaseSidecarClient.ts` exposes `sequences` but no current-value field today); else leave a `TODO(oracle-W3)`-style note and emit the Finding with the value marked unavailable. Do NOT modify the external sidecar.

**D — Engine-specific default-expression hazards**
- Detect engine-specific server defaults (`getdate()` / `newid()` / `suser_name()` / `host_name()` and the like) and emit a Finding flagging the non-portable default for the book-of-work.
- Keep the verbatim `column_default` string exactly as captured (no normalization, no rewrite); the hazard lives in the Finding, not in a mutation of the stored expression.

**E — Computed / generated columns**
- Capture an additive boolean-style flag on the physical attribute distinguishing a computed/generated column (`GENERATED ALWAYS AS (expr)` / Sybase computed) from a plain writable column.
- Capture the generation expression verbatim (so the column is re-declared as generated, not populated by INSERT/UPDATE).

**F — Database-resident jobs / agents**
- Introspect database scheduled jobs / agents (Sybase scheduler; Postgres equivalent where present) into rich Findings (procedural reality, NOT entity types).
- FILL the empty `emitUnsupportedFeatureFindings` stubs in BOTH packs — `postgresFindings.ts` ~L587 and `sybaseFindings.ts` ~L510 (both currently `return []`) — so genuinely-unsupported / non-portable DB-resident features land as Findings.

**G — Fuller Postgres procedure capture**
- Use `pg_get_functiondef(p.oid)` (or capture signature / arguments / return type / volatility / `SECURITY DEFINER` alongside the existing `p.prosrc` body) at `postgresIntrospection.ts` ~L818-839 so overloaded and security-context functions are recreatable.
- The body still goes to its existing Finding; the richer signature/volatility/security metadata is captured alongside it (additive `ProcedureMetadata` fields).

**H — Invariant (all of the above)**
- Everything additive: database reality → Findings + on-attribute / on-relationship JSONB metadata. NEVER a new meta-model entity TYPE (architecture ≠ reality).
- Emit every new Finding through the existing `FindingEmitter` singleton; do not introduce a parallel emit path.
- Prefer NO changeset — verify at build time; only if a first-class column is genuinely unavoidable, the next free changeset number is ≥170 (highest applied is 169, verified), and any numeric PATCH field must be a boxed type with null guards.

## Visual Design
No visual assets provided. The feature reuses the existing Candidates stream + Findings tab + candidate-details panels + the existing expandable read-only SQL viewer pattern; no new design mockups are required.

## Existing Code to Leverage

**DB introspection — EXTEND, do not fork (`postgresIntrospection.ts` / `sybaseIntrospection.ts` / `sybaseSidecarClient.ts`)**
- Postgres proc query uses `p.prosrc AS proc_src` only (L824) — extend to `pg_get_functiondef` / signature / volatility / `SECURITY DEFINER` (G).
- Add collation, sequence current value, and computed-column flag introspection here (B / C / E); Sybase reads collation + computed flag + sequence current value from the sidecar where exposed (consume only, never modify the external sidecar).

**DB IR types — EXTEND (`databasePacks/types.ts`)**
- `ColumnMetadata` carries the Spec-3 verbatim fields (`scale`/`precision`/`isIdentity`/`sequenceName`); `SequenceMetadata` carries start/increment/min/max/cycle; W3's `onDelete`/`onUpdate` + index `indexDefinition`/`indexMethod`/`isClustered`/`indexPredicate`/`columnDirections` already live on `KeyOrIndexMetadata`/`RelationshipInference`. Add column collation + computed/generated flag + generation expression to `ColumnMetadata`, current-value to `SequenceMetadata`, and the fuller signature/volatility/`SECURITY DEFINER` carrier to `ProcedureMetadata` — alongside, not touching W3.

**Structural-fidelity builders — EXTEND, shared with W3 (`candidateStructuralFidelity.ts`)**
- Engine-agnostic helpers that reshape the IR into the snake_case `physical_data_attributes` / `constraints_metadata` / `fk_columns` JSONB; already assemble `source_type`/`column_default` and the W3 keys. Add collation + computed-column flag + generation expression to the per-attribute JSONB here.

**Endpoint data-effect path — REUSE (Spec #1; `endpointDataEffectResolver.ts` / `endpointDataEffectCandidates.ts`)**
- Resolver walks controller→service→repository, exposes `UnresolvedDataEffect` (`reason`/`detail`) and the dynamic-persistence escape; candidates build `path_metadata_json` via `toPathMetadata`. Add `query_text`/`query_kind` to the resolved metadata and the verbatim SQL to the unresolved Finding — same path, no parallel scanner.

**Spec #5 retained call-arg literals — REUSE (`java/extract.ts` + `java/astUtils.ts`)**
- `CallIR.args` is now populated (`args: c.args`, no longer `args: []`) and `AnnotationIR.args` is a `Record<string,string>`. Consume both for the SQL strings — do NOT re-implement literal extraction. This is why #6 builds AFTER #5.

## Phase-2 Build Ordering & File-Overlap
This is Spec #6 of 6 — the FINAL spec of the Phase-2 "oracle perfection" program — built STRICTLY SEQUENTIALLY LAST. It is the most downstream spec and extends every prior committed spec rather than running in parallel.
- **Hard ordering — build AFTER Spec #5.** Requirement A consumes the call-argument literals Spec #5 retains. On this HEAD (`2247065`) the Java extractor already reads `args: c.args` (Spec #5 committed) and `CallIR.args: string[]` is populated; building #6 before #5 would mean the SQL literals are still dropped at the extractor.
- **With W3 (already on HEAD):** shares the DB introspection (`postgresIntrospection.ts` / `sybaseIntrospection.ts`), IR types (`types.ts`), and the structural-fidelity builder (`candidateStructuralFidelity.ts`). W3's FK-action (`on_delete`/`on_update` in `fk_columns`) and index ordering/clustering/partial-predicate detail (`definition`/`method`/`is_clustered`/`predicate`/`column_directions` in `constraints_metadata`) already live in these files — EXTEND alongside, do NOT redo.
- **With Spec #1 (data-effect graph) and Spec #5:** shares the endpoint data-effect path; this spec adds `query_text`/`query_kind` to the resolved `path_metadata_json` and attaches the verbatim SQL to the unresolved Finding — additive into the same path.
- **With Spec #3 (DB structural fidelity):** shares the DB-pack Finding builders (`databasePackFindingBuilders.ts` / `postgresFindings.ts` / `sybaseFindings.ts`) and the `FindingEmitter`; this spec adds the new cross-engine hazard Findings and fills the empty `emitUnsupportedFeatureFindings` stubs Spec #3 left as placeholders.
- **Net effect:** because #6 is built last, all shared files already carry the prior specs' committed changes; this spec's job is to EXTEND them additively — never fork a parallel implementation, never re-do W3.

## Out of Scope
- Redoing W3 — FK referential actions (`on_delete`/`on_update`) and index ordering/clustering/partial-predicate detail are ALREADY DONE on HEAD; EXTEND, do not redo.
- Normalizing engine type / expression / collation / default strings — captured VERBATIM; the Sybase→Postgres mapping is a downstream migration / shape-spec concern.
- A SQL rewriter / translator — this spec CAPTURES the SQL text and FLAGS cross-engine hazards; it does NOT translate SQL, defaults, collations, or computed expressions to the target engine.
- Non-Sybase / non-Postgres engines — only Sybase (source) and Postgres (target).
- New architecture entity types — none (architecture ≠ reality; all additive Findings + JSONB metadata).
- Modifying the external Sybase sidecar — consume what it exposes; `TODO(oracle-W3)`-style note for the rest.
- Live cross-engine fidelity validation against a real sample Sybase + Postgres schema — leans on the user's environment; NOT blocking. Done-bar is offline introspection→candidate/finding mappers + AMS model round-trips green (unit-tested).
- Forcing a Liquibase changeset — additive into existing JSONB (`endpoint_data_effects.path_metadata_json`, the `physical_data_attributes` metadata) is the default; a new changeset (floor ≥170) only if a first-class column is genuinely unavoidable.
