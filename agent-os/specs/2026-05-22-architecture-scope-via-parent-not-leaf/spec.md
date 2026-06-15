# Specification: Architecture-Scope Reads via Parent Chain, Not Leaf `architecture_id` Column

## Goal

Make every "what's in this architecture?" read path in `architecture-model-service` agree with the canonical `ModelService.loadModelByProjectIdAndArchitectureId` surface by deriving each entity's architecture-scope from its parent (`model_files.architecture_id` joined via `model_file_id`, or the equivalent `sequence_diagram_id` / `fragment_id` chains documented in changeset `097-architecture-id-auto-derive-trigger.sql`), instead of trusting the denormalised leaf `architecture_id` column on each entity table. The leaf column stays in place as a write-time optimisation but stops being authoritative for read paths.

## Problem statement (why this spec exists)

Two AMS surfaces ask the same question — *"what entity rows belong to architecture X?"* — and return different answers for the same project + architecture:

- **Architecture & Design view** (`/api/projects/{p}/model` route → `ModelService.loadModelByProjectIdAndArchitectureId` → `loadModelByFileId(modelFile.id)`) walks each entity table via `findByModelFileId(...)`. Scope is decided by the model file the entity belongs to.
- **Selective Copy inventory + commit** (`ArchitectureElementInventoryService.readInstances` and `ArchitectureSelectiveCopyService.locateInSource` + every other in-scope-table walk) issues `SELECT ... FROM <table> WHERE architecture_id = ?`, filtering by the **leaf** `architecture_id` column on each entity row.

The leaf column was introduced as a denormalisation (changeset 089 added the column, 090 backfilled it from `model_files.architecture_id`, 091 added `NOT NULL` + FK, 097 added a `BEFORE INSERT` trigger to auto-derive it from the parent for tables whose JPA entities never gained the field). There is **no `UPDATE` trigger and no FK CASCADE-rewrite** keeping the leaf in sync if the parent's `architecture_id` is later changed or if any legacy / external path writes the leaf directly. The leaf can drift from the parent.

Observed in production: a user's Current State architecture shows logical / physical data entities in the Architecture & Design view (parent path resolves correctly via `model_file_id`) but shows them as empty in the Selective Copy "Create Target Baseline" picker (leaf column has drifted away from the parent's value, so `WHERE architecture_id = ?` excludes them). Application-domain rows in the same architecture do appear because they were written more recently and the leaf is still in sync.

This is a code bug, not a data integrity bug. The fix is to make every read path use the canonical parent chain.

## User Stories

- As a migration architect running "Create Target Baseline" from my current-state architecture, I want the picker to show **every** element the Architecture & Design view shows for that same architecture so I can rely on the picker as a faithful representation of what will be copied.
- As an engineer who later changes how the architecture-id discriminator is propagated (or who drops the leaf column entirely), I want the read paths to not silently break when the leaf column is out of sync because they read from the parent — the canonical source of truth.
- As a tester, I want a deterministic integration test that proves inventory + selective copy still find entity rows whose leaf `architecture_id` is deliberately wrong, so any regression in the read path is caught before it ships.

## Specific Requirements

### Architecture-scope resolver (new, shared)

- New helper class `ArchitectureScopeResolver` in `architecture-model-service/src/main/java/com/example/architecturemodel/service/`.
- Centralises the parent-derivation rules currently encoded in changeset `097-architecture-id-auto-derive-trigger.sql` (53 tables via `model_file_id → model_files.architecture_id`, 4 tables via `sequence_diagram_id → sequence_diagrams.architecture_id`, 1 table via `fragment_id → sequence_fragments.architecture_id`). The three chains are the only valid derivations; any table not in any chain is rejected at startup with a clear error so silent under-coverage cannot happen.
- Public API: `String buildScopedSelectClause(String table, String selectColumns)` returns the parameterised `SELECT … FROM <table> t JOIN <parent> p ON p.id = t.<fk_col> WHERE p.architecture_id = ?` clause. Callers supply the column list and the architecture-id UUID binding. The resolver picks the right parent join for the supplied table.
- Per-table parent map is a hard-coded `Map<String, ParentLink>` in the resolver — derived from the trigger spec verbatim so a future addition of a new in-scope table is a single map entry update.
- The resolver throws `IllegalArgumentException("No architecture-scope parent registered for table: " + table)` if the caller asks for a table not in the map. This is a programmer-error guard rail — tests in the inventory + selective-copy suites exercise every in-scope table at startup.

### Inventory service rewrite

- `ArchitectureElementInventoryService.readInstances(String table, UUID architectureId)` (file: `architecture-model-service/.../service/ArchitectureElementInventoryService.java`, current lines 289-323).
- Replace the existing `WHERE architecture_id = ?` query with the resolver's parent-scoped query.
- Tables WITHOUT a parent chain (rare — none in the current six-domain in-scope list — but guard with a fallback path that defers to the leaf column for safety, logging a WARN with the table name so future additions get caught).
- Preserve all existing behaviour: display-name fallback for tables without a `name` column, idempotent on missing tables / columns (`BadSqlGrammarException` swallow), UUID binding type for native PG.
- No DTO changes — the response shape stays identical. Only the query path is rewritten.

### Selective copy service rewrite

- `ArchitectureSelectiveCopyService.locateInSource(...)` and every other `WHERE architecture_id = ?` in this file (15 grep hits across the preflight walk, conflict detection, verbatim insert / overwrite / duplicate paths, and the integrity-check sweeps that recompute counts).
- All sites switch to the resolver's parent-scoped query. The leaf column is no longer read for routing or matching decisions.
- The **write** path (the verbatim insert of the new rows into the target architecture) continues to set the leaf `architecture_id` to the target architecture id explicitly, so newly-copied rows always start with a correct leaf value. This keeps the trigger's invariant intact for new data without depending on it for reads.
- Existing functional behaviour (auto-include cascade, skip / overwrite / duplicate resolutions, transactional rollback, `auto_map` mapping inserts) is unchanged. Only the SQL `WHERE` clauses change.

### Decommission + unmapped-current-elements + mapping-suggest

- `TargetArchitectureDecommissionService`, `UnmappedCurrentElementsService`, `MappingSuggestService` — audit each for any `WHERE architecture_id = ?` query against in-scope element tables.
- Every such query routes through the new resolver. If a service only reads from `architecture_element_mappings` or `architecture` itself (which are direct project / architecture rows, not derived-from-parent), leave it alone.

### Out-of-scope tables that stay on the leaf path

Some tables legitimately use the leaf `architecture_id` because they are themselves the "parent" or have no parent chain:
- `architecture`, `architecture_tags` — the architecture itself.
- `model_files` — the parent of the 53 `model_file_id`-chained tables. Its `architecture_id` column IS the canonical value; no derivation needed.
- `sequence_diagrams` — the parent for the 4-table chain. Same reasoning.
- `sequence_fragments` — the parent for the 1-table chain. Same.
- `temporary_diagrams` — has its own `architecture_id` direct, no parent chain.
- `discovery_runs`, `discovery_candidates`, `discovery_evidences`, `discovery_relationships`, `discovery_findings`, `discovery_finding_links`, `discovery_decision_tasks`, `discovery_clusters` — discovery has its own one-run-to-one-architecture invariant, immutable provenance, and is explicitly NOT part of the selective-copy / inventory in-scope list (per `ArchitectureElementInventoryService` class docstring, "Excluded scopes (safety property (g))"). Out of scope for this spec.

### Frontend changes

None expected. The inventory + commit response shapes are unchanged. The wizard's "Create Target Baseline" flow becomes accurate without any UI change.

### Tests

- **`ArchitectureScopeResolverTest`** (new) — startup-time assertion that every in-scope table from the existing `IN_SCOPE_TABLES_IN_ORDER` registry in `ArchitectureSelectiveCopyService` has a matching parent entry in the resolver, with no missing tables and no extras.
- **`ArchitectureElementInventoryServiceLeafDriftTest`** (new integration test) — seed two architectures in one project, insert one logical_data_entity whose `model_file_id` points at architecture A but whose leaf `architecture_id` column is deliberately set to architecture B's id. Assert that the inventory call for architecture A still surfaces the row (because the parent chain resolves correctly), and the inventory call for architecture B does NOT surface it. Same test for one physical_data_entity, one logical_data_attribute, and one physical_data_attribute so all four data-entity tables are exercised. Optionally add the same shape for one application-domain table (`applications`) to prove the resolver works uniformly across domains.
- **`ArchitectureSelectiveCopyLeafDriftTest`** (new integration test) — same drift setup, then run preflight + commit from A to a new target. Assert the drifted row IS copied (preflight surfaces it, commit walks it). Today's behaviour would skip it because the leaf is wrong.
- Existing `ArchitectureSelectiveCopyIntegrationTest` and `ArchitectureSelectiveCopyAutoMapIntegrationTest` keep passing untouched — they construct entities via the JPA repository, which fires the BEFORE INSERT trigger, so their leaf columns are always correct and they exercise the happy path equally well under either implementation.
- An end-to-end HTTP test (using `MockMvc` or `TestRestTemplate`) is intentionally **out of scope for this spec** — the recently-fixed Jackson `SNAKE_CASE` issue (companion fix on `SelectiveCopy*Request` / `Response` DTOs annotated with `@JsonNaming(LowerCamelCaseStrategy.class)`) is the responsibility of a separate audit; this spec assumes those annotations are in place.

## Out of Scope

- Dropping the leaf `architecture_id` column. Many other paths still read it (JPA queries, raw-SQL utilities elsewhere in AMS, the discovery candidate save-back, frontend reads via DTOs that pass the field through). Removal is a larger migration with its own risks; defer to a follow-up spec.
- Backfilling current bad data (the user's drifted leaf rows). The fix is to stop reading the leaf — the user does not need a `UPDATE` migration. If a future spec drops the leaf column or adds an integrity-check job, it can include the backfill at that point.
- Discovery-table architecture-scoping (`discovery_runs.architecture_id` etc.). Those tables have their own one-run-to-one-architecture invariant and are not part of the inventory / selective-copy surface.
- Frontend API client + gateway proxy changes. The wire shape stays the same.
- Migrating the resolver's per-table parent map into a database-driven registry. The map duplicates information already encoded in changeset 097's trigger family; a future spec could DRY this out, but a hard-coded map is fine for v1.
- Adding an `UPDATE` trigger to keep the leaf in sync. Solves a different problem (write-side denormalisation maintenance) and is not needed once the read paths stop trusting the leaf.

## Existing Code to Leverage

### `ModelService.loadModelByFileId` (canonical pattern)
- `architecture-model-service/.../service/ModelService.java:905-...`
- Already walks every in-scope entity table via `findByModelFileId(modelFile.id)`. This is the ground truth the inventory + selective-copy services need to match.

### Changeset `097-architecture-id-auto-derive-trigger.sql`
- `architecture-model-service/src/main/resources/db/changelog/sql/097-architecture-id-auto-derive-trigger.sql`
- Documents the three parent-derivation chains in prose AND in trigger SQL. The new `ArchitectureScopeResolver`'s hard-coded map mirrors this changeset verbatim — if a future changeset extends the trigger to new tables, the same change goes into the resolver.

### `ArchitectureElementInventoryService` (existing structure)
- The `TABLES_BY_DOMAIN`, `DOMAIN_ORDER`, `DISPLAY_NAME_FALLBACK_TABLES` registries stay as-is.
- Only the inner SQL of `readInstances` changes. Class-level docstring updates to reflect the new query path.

### `ArchitectureSelectiveCopyService.IN_SCOPE_TABLES_IN_ORDER`
- The list of in-scope tables stays the canonical source of which tables the walk visits.
- The resolver's parent map must be a superset of this list (every in-scope table needs a parent entry).

### Project-memory notes
- `project_appshell_model_cache.md` — irrelevant for AMS-side work; flagged here only so anyone editing the frontend later knows the cache rules don't need to change.
- `feedback_liquibase_immutable_changesets.md` — applies if anyone tries to alter changeset 097 in this spec. Don't. Add a new changeset only if you must, but this spec deliberately does NOT touch the schema.
- `feedback_trace_before_coding.md` — the implementer should map every `WHERE architecture_id = ?` in the two services (~16 grep hits) before changing any one of them, since the substitution must be uniform.

## Implementation Notes

- The substitution is mechanical — every `WHERE architecture_id = ?` against an in-scope table is replaced by `… JOIN <parent> p ON p.id = t.<fk_col> WHERE p.architecture_id = ?` via the resolver. UUID binding semantics stay identical (PG strict-mode requires UUID, not String, binding — preserve the existing `jdbcTemplate.queryForList(sql, architectureId)` pattern).
- Tables that lack a `model_file_id` column (or the relevant parent fk column) fall back to the leaf column with a WARN log line. None of the current in-scope tables fall into this case; the fallback is defensive guard for future additions.
- Liquibase tail stays where it is — no schema changes in this spec.
- The companion `@JsonNaming(LowerCamelCaseStrategy.class)` annotation work on `SelectiveCopy*Request` / `Response` + `ArchitectureElementMappingDto` + the two mapping `Create` / `Update` request DTOs is **prerequisite to this spec landing usefully** but lives outside it (already applied separately).
- Pre-existing test failures listed in `CLAUDE.md` (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`) are unrelated to this work — do not touch them.

## Commit Boundary

One commit:
- New `ArchitectureScopeResolver` + unit test.
- `ArchitectureElementInventoryService` rewrite + new leaf-drift integration test.
- `ArchitectureSelectiveCopyService` rewrite (all `WHERE architecture_id = ?` sites) + new leaf-drift integration test.
- `TargetArchitectureDecommissionService` / `UnmappedCurrentElementsService` / `MappingSuggestService` audit + any necessary substitutions.
- Existing integration tests pass unchanged.

## Definition of Done

- The user from the bug report can run "Create Target Baseline" from their Current State architecture and see logical data entities, physical data entities, logical attributes, physical attributes in the picker tree alongside applications, interfaces, endpoints.
- The new leaf-drift tests are red on `master`, green on this branch.
- All existing AMS tests still pass.
- A grep for `WHERE architecture_id` across `ArchitectureElementInventoryService` and `ArchitectureSelectiveCopyService` returns zero hits (every read goes through the resolver).
