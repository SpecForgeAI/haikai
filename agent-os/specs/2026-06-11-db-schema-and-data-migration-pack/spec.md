# Specification: Source-Grade DB Schema + Data Migration Pack (Sybase ASE → PostgreSQL) with Schema Verification

## Goal

Turn discovery's source-grade DB facts (committed physical model + schema-metadata findings + captured db.* decisions) into an executable, downloadable migration pack — deterministic Liquibase schema changelogs plus bulk/incremental data-load scripts — with a pack-scoped decision queue, DB-epic attachment, and a re-runnable verification scan that diffs the target Postgres database against the generated schema (the DB sibling of the API drift report).

## User Stories

- As a migration engineer, I want a generated Liquibase + data-script pack derived deterministically from discovery facts so that the schema migration starts from verified source-grade truth instead of LLM prose.
- As a migration engineer, I want every ambiguous mapping surfaced as an explicit decision (never guessed) and every table/column provably accounted for, so that nothing is silently dropped or mistranslated.
- As a migration engineer, I want to re-scan the target Postgres database after applying the pack and see a persisted per-object drift report history, so that I can prove the target schema matches expectation area by area.

## Specific Requirements

**AMS pack data model (text/JSONB rows; NEW Liquibase changesets only)**

- Four new tables via NEW changeset files under `architecture-model-service/src/main/resources/db/changelog/sql/` (next free numbers after `171-...`; applied changesets are immutable — never edit existing files): `db_migration_packs`, `db_migration_pack_files`, `db_migration_pack_decisions`, `db_migration_pack_drift_reports`.
- `db_migration_packs`: id, project_id, architecture_id, status (`generated` | `stale`), stale_reason, input_snapshot_hash, generated_at, work_item_id (nullable text — the user-chosen DB epic's book-of-work item id), coverage counts (translated/skipped/flagged), seed_margin, manifest_json (jsonb). One active pack per project+architecture; regeneration updates the pack in place (decisions and drift history survive by pack id).
- `db_migration_pack_files`: pack_id FK, file_path (the relative path inside the zip, e.g. `liquibase/changesets/010-tables/dbo.orders.sql`), file_kind (`liquibase_master` | `liquibase_changeset` | `bulk_load_script` | `incremental_script` | `manifest` | `readme`), content (text), sort_order. NO files on disk, NO binary store — zip assembled on demand (precedent: `migration_story_spec_generations` / `generated_migration_books_of_work`).
- `db_migration_pack_decisions` (pack-scoped, NOT `target_state_captured_decisions`): pack_id FK, decision_key (stable: object identity + question kind, so regeneration re-links resolved decisions instead of duplicating), object_ref (schema/table/column), category (`type_mapping` | `computed_column` | `collation` | `delta_key` | `other`), question, options_json, resolution_json, status (`open` | `resolved`), resolved_at.
- `db_migration_pack_drift_reports` (append-only history, audit trail): pack_id FK, scan_scope_json (area filter: schemas/tables), summary counts (match/missing/mismatch), report_json (per-object classifications), source (`in_tool` now; a free string so a future external implementation+verification service callback can append per-area runs without schema change — integration itself out of scope), created_at.
- New JPA entity/repository/service/controller per table following `MigrationStorySpecGenerationEntity` / `GeneratedMigrationBookOfWorkEntity` patterns; DTOs use the AMS default snake_case wire (no `@CamelCaseWire` — all consumers are new).
- Endpoints (snake_case): CRUD under `/api/projects/{projectId}/db-migration-packs` plus `/files`, `/decisions` (list + resolve), `/drift-reports` (list + append), and a PATCH for `work_item_id` attachment.

**Deterministic generation pipeline with the coverage guarantee (gateway, NO LLM)**

- New gateway orchestration handler (e.g. `gateway/src/services/dbMigrationPackHandler.ts` + routes in a new `gateway/src/routes/dbMigrationPack.ts`): pure deterministic code in the structural path — no LLM call anywhere in generation.
- Inputs (ALL mandatory): committed AMS physical model (`physical_data_entities` incl. `constraints_metadata` jsonb, `physical_data_attributes` incl. scale/precision/is_identity/sequence_name, relationship `fk_columns` with on_delete/on_update), persisted discovery findings, captured `db.*` decisions from `target_state_captured_decisions`, and resolved pack decisions.
- Findings are NOT optional: collation (`collation_case_sensitivity_hazard`), computed-column generation expressions, sequence high-water marks (`sequence_definition`, `sequence_cutover_hazard`), and non-portable defaults (`non_portable_default`) exist ONLY in findings — they never reach committed attributes. The generator merges findings into the schema IR by object identity before any translation.
- Pipeline stages: (1) snapshot + canonically serialize all inputs → SHA-256 `input_snapshot_hash`; (2) build source-schema IR; (3) deterministic type mapping + object translation; (4) emit Liquibase changelogs + data scripts; (5) build the coverage ledger; (6) persist manifest + files + flags atomically to AMS.
- Coverage is a CODE guarantee (philosophy mirrored from `2026-06-11-two-phase-migration-plan-generation`): every discovered table and column ends in exactly one bucket — `translated` | `skipped` (with explicit reason) | `flagged` (needs_decision) — enforced by a post-generation assertion that fails the run if any object is unaccounted for. Per-object provenance (source entity/attribute id + contributing finding ids) is recorded in the manifest.
- Stored procs / triggers / views are NOT translated: they are listed in the manifest as `requires_translation_spec_2` with their finding provenance (`stored_procedure_logic`, `trigger_logic`, `view_definition`). DB scheduled jobs (`db_resident_scheduled_job` findings) are listed the same way as manual-recreation items.
- Sybase ASE → PostgreSQL is the ONLY supported pair in v1; the generator rejects any other source/target combination (target engine read from the `db.engine` captured decision).

**Fixed deterministic Sybase ASE → PostgreSQL type-mapping table**

- Deterministic mappings (a code table, versioned `v1`): `int`→`integer`, `smallint`→`smallint`, `tinyint`→`smallint`, `bigint`→`bigint`, `unsigned int`→`bigint`, `numeric(p,s)`/`decimal(p,s)`→`numeric(p,s)` (verbatim precision/scale from the attribute), `money`→`numeric(19,4)`, `smallmoney`→`numeric(10,4)`, `float`→`double precision`, `real`→`real`, `bit`→`boolean`, `char(n)`/`nchar(n)`→`char(n)`, `varchar(n)`/`nvarchar(n)`/`univarchar(n)`/`sysname`→`varchar(n)`, `text`/`unitext`→`text`, `image`→`bytea`, `binary(n)`/`varbinary(n)`→`bytea`, `datetime`/`smalldatetime`/`bigdatetime`→`timestamptz`, `date`→`date`, `time`/`bigtime`→`time`.
- Identity columns (`is_identity` on the attribute) → `GENERATED ALWAYS AS IDENTITY`, seeded from the captured high-water mark (see sequence requirement).
- Ambiguous/unmappable types are NEVER guessed — each becomes a `type_mapping` needs_decision with concrete options: Sybase `timestamp` (rowversion semantics — `bytea` | drop | application-managed), any type not in the table, and any column whose findings flag a hazard the mapping cannot neutralize.
- Computed columns (`is_generated` + `generation_expression` from findings/IR): emit Postgres `GENERATED ALWAYS AS (expr) STORED` ONLY when the expression is expressible in Postgres syntax by deterministic token translation; otherwise a `computed_column` needs_decision carrying the verbatim Sybase expression.
- Collation: where a `collation_case_sensitivity_hazard` finding marks a column/database case-insensitive, the column becomes a `collation` needs_decision (options: `citext` | expression indexes + app discipline | accept case-sensitive change), never a silent default.
- Non-portable defaults (`non_portable_default` findings, e.g. `getdate()`): deterministically rewritten where a safe equivalent exists (`getdate()`→`now()`); otherwise flagged.

**Liquibase changelog output (formatted SQL, checksum-stable)**

- Output is Liquibase formatted SQL (NOT Flyway): one master changelog (`liquibase/db.changelog-master.xml` or yaml include list) referencing ordered changeset files.
- Granularity per the settled decision: ONE changeset per table for the structural phase (table + PK + check/unique constraints + comments); ONE consolidated changeset per cross-cutting phase — `sequences-seed` (identity restart values), `foreign-keys` (all FK constraints, post-data-load), `indexes` (all non-PK indexes, post-data-load).
- Changeset ids and `logicalFilePath` are stable functions of object identity (e.g. id `table--dbo.orders`, logicalFilePath fixed per file) so regeneration produces byte-identical changesets for unchanged objects — no checksum churn; only genuinely changed objects change.
- Ordering inside the structural phase: FK-topological order of tables (cycles broken deterministically and noted in the manifest).
- Clustered Sybase indexes → plain btree index + an explicit `-- CLUSTER` comment/note in the changeset and a manifest entry (Postgres has no maintained clustering); index column ordering/direction taken verbatim from `constraints_metadata.indexes[]`.
- Sequence/identity seeding uses the captured high-water mark (from `sequence_definition` / `sequence_cutover_hazard` findings) plus a configurable margin (pack-level setting, default stated in the manifest); a Sybase-side value-unavailable high-water becomes a needs_decision, never a silent restart-at-1.
- FK referential actions (`ON DELETE` / `ON UPDATE` from relationship `fk_columns`) are reproduced verbatim in the foreign-keys changeset.

**Data migration pack — bulk load**

- Per-table bulk load scripts in FK-topological order: a Sybase extract `SELECT` with explicit type-cast expressions aligned to the type-mapping table, paired with a Postgres `COPY ... FROM STDIN` template (the pack documents the pipe; it does not execute it).
- Phase ordering is explicit and stated in the manifest: (1) structural changesets (tables/PKs/constraints, NO FKs, NO non-PK indexes); (2) bulk load all tables; (3) apply FK constraints + non-PK indexes ONCE (the consolidated changesets); (4) reseed sequences/identities; (5) all subsequent incremental runs execute WITH FKs and indexes enforced (safer increments — settled Q4).
- A bulk-load manifest file lists table order, expected source row counts (from discovery profiling where available), and per-table cast notes.
- Generated columns are excluded from COPY column lists (Postgres computes them); identity columns are loaded with `OVERRIDING SYSTEM VALUE` semantics documented in the script header.

**Data migration pack — incremental top-up with detected delta keys**

- Per-table delta strategy from a deterministically detected delta key: a monotonic identity column → insert-only delta script; a name-heuristic timestamp column (`updated_at`, `modified_date`, `last_modified`, `last_updated`, `mod_ts` and similar, with a datetime-family type) → insert+update (upsert) delta script; identity preferred when both exist.
- Incremental scripts are parameterised by `:last_high_water` (the prior run's max key value); each script states its delta key and strategy in a header comment.
- The chosen delta key per table is a reviewable item in the pack UI (shown in the pack contents view with an override path via the decision queue).
- A table with no usable delta key → a `delta_key` needs_decision with options: full reload each increment | skip from incremental | manually specified key.
- DELETE propagation is OUT OF SCOPE for incremental v1 — stated plainly in the manifest; full-reload tables are noted as the mechanism that catches deletes.

**Refresh seeds (sequence/identity re-scan only)**

- A "Refresh seeds" action re-scans ONLY sequence/identity current values from the source Sybase database and regenerates the `sequences-seed` changeset + incremental high-water parameters — nothing else in the pack changes.
- Executes in discovery-service (the introspection home): a narrow seed-scan mode over the Sybase pack/sidecar path, reusing the existing connection + per-invocation credential flow (`secretsStore.ts` in-process bundle; credentials never persisted, purged at completion — same contract as discovery runs; `api-migration-validation-service/src/services/secretsStore.ts` is the sibling precedent).
- Frontend prompts for credentials each invocation, reusing the connection-form pattern from `StartDiscoveryRunModal.tsx` (dbSource section) and `discovery-service/src/routes/database.ts` test-connection flow.
- Writes NOTHING to the model or findings; results flow only into the regenerated pack files + manifest seed values.

**Schema verification loop (DB drift report)**

- A verification-only scan mode in discovery-service reusing `postgres/postgresIntrospection.ts` against the TARGET Postgres database: a mode flag that runs introspection and returns the normalized actual-schema snapshot to the gateway, writing NOTHING to the model — no candidates, no findings, no run rows; per-invocation credentials as above.
- The gateway computes the deterministic diff (colocated with the generation logic that defines "expected"): expected schema = the pack manifest's expected-schema JSON (emitted at generation time as part of the manifest), actual = the scan snapshot.
- Per-object classification vocabulary: `match` | `missing` (expected, absent in target) | `mismatch` (present but differing) — with a structured detail list per mismatch (property, expected, actual; e.g. column type, nullability, default, PK/FK/index composition, identity, FK action). Objects present in target but not expected are reported in an informational `unexpected_in_target` section of the report.
- Re-runnable per area: the scan accepts a scope filter (schemas/tables) and the report records its `scan_scope_json` — designed so a future external implementation+verification service callback can append per-area re-verifications to the same history (integration out of scope; do not preclude it).
- Each run appends a row to `db_migration_pack_drift_reports` (persistent history, never overwritten); the UI shows the history list and per-run detail.

**Gateway API surface and zip download**

- New routes in `gateway/src/routes/dbMigrationPack.ts` (registered in `gateway/src/routes/index.ts`): generate, regenerate (explicit only), refresh-seeds, verify (drift scan), get pack/files/manifest, list/resolve decisions, list drift reports, attach work item, download.
- Download assembles the zip on demand from AMS `db_migration_pack_files` rows (file_path → entry path) — liquibase changelogs + data scripts + manifest + readme; no filesystem artifacts at any point.
- Staleness check endpoint/logic: recompute the input snapshot hash from current inputs and compare to the stored `input_snapshot_hash`; expose `is_stale` + reason on the pack GET.
- AMS error mapping and route conventions follow `gateway/src/routes/migrationBookOfWork.ts` (round-trip status + body); `[diag-gateway]` stage-marker logs per pipeline stage.

**Frontend — pack view, decision queue, actions, epic attachment, drift history**

- Mount a new pack surface off `MigrationDeliveryPlanRoute.tsx` next to the book of work (tab or section per existing route structure), styled with the Migration Delivery Plan conventions (`MigrationBookOfWork.module.css` patterns); new API module `frontend/src/api/dbMigrationPackApi.ts` typed snake_case.
- Read-mostly pack contents view: file tree (changelogs/scripts/manifest) with content preview, coverage summary (translated / skipped / flagged counts), per-object disposition table with provenance links, per-table delta-key strategy display, and the phase-ordering statement.
- Decision queue modeled on the `Discovery/FindingsTab.tsx` list + bulk-action pattern (NOT a conversational agenda): filter by category/status, resolve individually or bulk-resolve with the same option; resolving persists to the pack-scoped decision table, marks the pack stale, and enables Regenerate.
- Actions bar: Regenerate (explicit only, enabled when stale or decisions resolved), Refresh seeds (credential prompt), Download pack (zip), Verify schema (credential prompt + optional area scope).
- Staleness banner: "stale — inputs changed since generation" when the snapshot hash mismatches or a decision was resolved; NEVER auto-regenerate.
- Epic attachment: a one-time picker in the pack UI listing book-of-work epics (no naming-convention magic); sets `work_item_id`; `MigrationBookOfWorkItemDrawer.tsx` shows a pack chip with a download action on the attached epic.
- Drift report UI modeled on `DashboardView/DriftReportTab.tsx` + `DiffFindingDetailDrawer.tsx`: run-history list, per-run summary chips (match/missing/mismatch counts), object table with classification badges, and a detail drawer showing the expected-vs-actual property diff.

## Visual Design

No visual assets provided (`planning/visuals/` is empty).

- Follow the existing Migration Delivery Plan styling (`MigrationDeliveryPlan/` components + `MigrationBookOfWork.module.css`) for the pack view, decision queue, actions, banners, and chips; follow `DriftReportTab.tsx` styling for the drift report.

## Existing Code to Leverage

**`discovery-service/src/services/databasePacks/` — introspection + credential flow**

- `postgres/postgresIntrospection.ts` is the verification-scan engine (add a verification-only mode that returns the snapshot without model writes); `sybase/` (incl. sidecar at :8093) is the refresh-seeds path.
- `types.ts` defines the exact IR the generator and diff consume: `ColumnMetadata` (scale/precision/isIdentity/sequenceName/collation/isGenerated/generationExpression), `SequenceMetadata.currentValue` (string high-water), `KeyOrIndexMetadata` (onDelete/onUpdate, isClustered, columnDirections, checkExpression), `MetadataApplicability`.
- `secretsStore.ts` per-run in-process credential bundle (never persisted, purged at terminal status) — reuse for refresh-seeds and verification invocations; `routes/database.ts` test-connection is the connection-check precedent.

**`discovery-service/src/services/findings/databasePackFindingScanners/databasePackFindingBuilders.ts` — the finding types the generator MUST read**

- `sequence_definition` / `sequence_cutover_hazard` carry high-water marks; `collation_case_sensitivity_hazard` carries case-sensitivity hazards (+ `collationImpliesCaseInsensitive` helper); `non_portable_default` (+ `detectNonPortableDefault`) carries default-expression hazards; `stored_procedure_logic` / `trigger_logic` / `view_definition` / `db_resident_scheduled_job` feed the requires-translation/manual-recreation manifest sections.
- These facts never reach committed `physical_data_attributes` — the generator merges them into its IR from persisted findings by object identity.

**AMS persistence precedents — `MigrationStorySpecGenerationEntity` / `GeneratedMigrationBookOfWorkEntity` + changesets `139`/`140`**

- Text/JSONB row storage of generated artifacts, status + staleness columns (`146-...-stale.sql`, `150-...-stale-reason.sql`), controller/service/mapper layering — replicate for the four new pack tables.
- `PhysicalDataEntityEntity.constraints_metadata` (jsonb) + `PhysicalDataAttributeEntity` structural-fidelity columns + relationship `fk_columns` are the committed-model generator inputs; new DTOs default to snake_case wire per repo convention.

**Gateway orchestration + route conventions — `migrationBookOfWorkHandler.ts` / `routes/migrationBookOfWork.ts`**

- Route registration, AMS error round-tripping, `[diag-gateway]` stage logging, and `architectureModelClient.ts` model-fetch patterns; the new handler follows the same shape but is fully deterministic (no LLM client import in the structural path).
- Coverage-guarantee philosophy reused from spec `2026-06-11-two-phase-migration-plan-generation`: enforced in code via a post-generation assertion, never by diligence.

**Frontend surfaces — `MigrationDeliveryPlanRoute.tsx`, `MigrationBookOfWorkItemDrawer.tsx`, `DashboardView/DriftReportTab.tsx` + `DiffFindingDetailDrawer.tsx`, `Discovery/FindingsTab.tsx`, `StartDiscoveryRunModal.tsx`**

- Route mounting + workspace layout; item drawer for the pack chip; drift report list/drawer pattern for the DB drift report; FindingsTab list + bulk-action pattern for the decision queue; StartDiscoveryRunModal dbSource section for the credential prompt.

## Out of Scope

- Stored proc / trigger / view T-SQL → PL/pgSQL translation (separate spec 2; manifest lists these objects as "requires translation (spec 2)").
- DELETE propagation in incremental top-ups (v1; full-reload tables catch deletes; stated in the manifest).
- Jira push of the pack zip — in-tool download only in v1.
- Mirroring pack decisions into `target_state_captured_decisions` (future idea).
- External implementation+verification service callback integration (do not preclude it — the drift-report history and `source` field are designed to receive appended runs).
- Any source/target engine pair other than Sybase ASE → PostgreSQL.
- Auto-regeneration of any kind — Regenerate is always an explicit user action.
- Executing the migration (running Liquibase, the COPY pipe, or incremental scripts) from inside the tool — the pack is generated and verified, not executed.
- Filesystem or binary artifact storage — all generated content lives as AMS text/JSONB rows.
- Any LLM involvement in the structural generation path or the schema diff.
