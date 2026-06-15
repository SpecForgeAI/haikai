# Specification: D3 (Keystone) — Internal-behaviour implementation-ready spec generation (+ modernisation)

## Goal
Close the verified "dead zone" so a non-API D2 `discovery_capability` (or a behaviour-bearing `operational_artifact` finding) becomes a genuinely implementation-ready, Migrate-able spec, by adding a 7th migration spec-context type (`operational_capability`) and reusing the already-built migration spec generator + implement-state writer untouched, targeting the captured modern equivalent while preserving the behavioural contract.

## User Stories
- As a migration architect, I want an approved batch/monitoring/FTP/deployment/housekeeping capability to generate a modernised implementation-ready spec (scope, AC, effect-asserting test pack) so that internal work is dispatchable by the existing Migrate flow, not stuck at `insufficient_context`.
- As a developer, I want the generated capability spec to target the captured modern equivalent (Autosys → captured orchestrator, Argon/TIBCO → captured messaging, Sybase → Postgres, Geneos → captured observability) while preserving the same schedule/data/message/snapshot outcomes, so I implement modern tech without re-deciding the contract.

## Specific Requirements

**7th context type `operational_capability` (D1, D9)**
- Add `operational_capability` to gateway `MIGRATION_SPEC_CONTEXT_TYPES` (`migrationSpecContextClient.ts:59`); `SHAPE_SPEC_CONTEXT_TYPES` derives from it (handler `:181`) so it is requested automatically.
- Add `CTX_OPERATIONAL_CAPABILITY` constant + extend AMS `KNOWN_CONTEXT_TYPES` (`MigrationSpecContextResolver.java:99`) + a new `switch` block (`:212`) that populates an `operational_capability` block instead of api/data for a capability story.
- Single name used whether the source is a D2 capability or a finding fallback.
- No parallel generator: the two-pass loop, confidence/no-fabrication, implement-state writer, and persistence are reused untouched; the resolver only adds the new block and the prompt gains two clauses.

**Resolver block assembly — capability (preferred) + finding (fallback) (D3, D4)**
- Resolve the capability FIRST by `source_capability_id` (read from the WorkItem's book-of-work blob), then FALL BACK to assembling from a behaviour-bearing `operational_artifact` finding.
- Assemble the block from the capability's `detail_json` exactly as D2 persists it: JIL-DAG topology snapshot, `invocations[]` edges (JIL→shell→Java→DB), members + kinds (from `discovery_capability_member`), schedule/trigger metadata, inputs/outputs, side-effects, external systems, plus `name`/`kind`/`summary` + the aggregated `behaviourBearing` hint.
- Emit block-level `missingInputs[]` when the capability has no members or no behaviour signal; aggregate into the DTO top-level `missingInputs[]` like the existing six blocks.
- AMS snake_case default (D2 entity carries no `@CamelCaseWire`); any PATCH-mutable numeric stays boxed.

**`append-capability-story` AMS endpoint — per-capability trigger (D2, D10)**
- New endpoint modelled on the built `append-test-item` (same controller/service): in ONE `@Transactional` boundary, mint a `type='story'` WorkItem via `itemSaver.persistOne(...)` AND append the `book_of_work_json.items[]` blob (stamping `workItemId` + `saveState='saved'`), mirroring `GeneratedMigrationBookOfWorkService.appendTestItem`.
- Stamp `source_capability_id` ONTO the blob item (no DDL); it rides `book_of_work_json` exactly as `append-test-item` stamps `workItemId`.
- The existing `selectEligibleStories` (handler `:1103`) picks it up UNCHANGED — it already requires `type==='story'` + a non-null `workItemId` (`:1115`).
- Explicit per-capability trigger only; batch / gate-driven invocation for un-covered capabilities is deferred to D4.

**Modernisation clause — reuse existing target-tech machinery (D5)**
- NO per-capability tech picker. Reuse the prompt's existing Target State Decisions Context (`:101`) + Target Tech Stack Context (`:115`) blocks as-is (architect close-step `target-tech-stack-<id>.md`).
- Add a short "operational capability" modernisation clause to `product-manager.migration-shape-spec-generation.task.md`: target the captured modern equivalent (Autosys → captured orchestrator, Argon/TIBCO → captured messaging, Sybase → Postgres, Geneos → captured observability) while PRESERVING the behavioural contract (same schedule semantics; same data/message/snapshot outcomes). The WHAT is fixed; the HOW is modern.
- Modern choices ride the EXISTING free-text Target State Decisions channel (e.g. "use Airflow for batch orchestration"). NO new tech-category vocabulary.
- No relevant captured decision → emit the EXISTING `MISSING_DECISION_CONTEXT` / `NO_CAPTURED_DECISIONS` warning + downgrade; NEVER invent a modern target.

**Effect-asserting test pack clause (D7, D8)**
- Reuse the existing `structured_tests_json` shape `{ title, description, type: 'unit' | 'functional' }` (`STRUCTURED_TEST_TYPE_VALUES`, validator `:128`) — NO schema change.
- Add an "operational capability" clause to the prompt's STRUCTURED TEST PACK section (`:79`) steering toward EFFECT assertions: run the pipeline → assert DB tables / downstream message / snapshot outcome, INSTEAD of HTTP request/response.
- Heavier integration/E2E effect tests stay with the holistic mechanism + later D6.
- `coveredEndpointIds` is empty `[]` for every capability/finding story — validator already allows empty (`:371`); prompt already mandates `[]` for non-endpoint stories (`:96`). No-op confirmation.

**Confidence handling — short-circuit + downgrade (D6)**
- Capability with ZERO members OR no behaviour-bearing signal → short-circuit to `insufficient_context` with NO LLM call (e.g. `missingInputs` `capability_members` / `capability_behaviour`), mirroring the existing pre-LLM context-blocker path.
- Capability with members + spine but a MISSING target-tech decision → `generated_with_warnings` (downgraded), NOT blocked.

**Uniform kind handling (D15)**
- Handle ALL `operational_capability` kinds uniformly — `batch_pipeline`, `monitoring`, `deployment`, `ftp_ingestion`, `housekeeping`. The context block + prompt are kind-agnostic; the kind only informs the modern-tech mapping. No kind-specific deferral.

**No new UI (D11)**
- An `operational_capability` story flows into the SAME Specs / Implementation review tiles (scope / AC / test-pack); the implement-state writer hydrates the screen identically. The modern target is visible inside the generated spec body. No "modern target" chip/label in D3.

## Visual Design
No visual assets provided (`planning/visuals/` is empty — declined). The generated capability spec surfaces in the existing Specs / Implementation review tiles unchanged.

## Existing Code to Leverage

**`gateway/src/services/migrationShapeSpecGenerationHandler.ts`**
- `selectEligibleStories` (`:1103`) already gates on `type==='story'` + non-null `workItemId` (`:1115`) — consumes the new capability story with NO change.
- `SHAPE_SPEC_CONTEXT_TYPES` (`:181`) spreads `MIGRATION_SPEC_CONTEXT_TYPES`, so adding the 7th type requests it automatically; two-pass loop, confidence/no-fab, persistence reused untouched.

**`migrationSpecContextClient.ts` (`:59`) + `MigrationSpecContextResolver.java` (`:99`/`:212`)**
- The 6-type whitelist (`MIGRATION_SPEC_CONTEXT_TYPES` / `KNOWN_CONTEXT_TYPES` / `CTX_*` / `switch`) is the explicit extension point; each existing block (service/api/soap/data/infrastructure/test_pack) follows the same build-block + aggregate-`missingInputs` pattern the new block replicates.

**The built `append-test-item` AMS endpoint (`GeneratedMigrationBookOfWorkService.appendTestItem`, `:783`)**
- Mints a WorkItem + appends the `book_of_work_json.items[]` blob in ONE transaction via `itemSaver.persistOne`, stamping `workItemId` + `saveState='saved'`. `append-capability-story` mirrors this exactly, additionally stamping `source_capability_id` onto the blob (no DDL).

**`migrationImplementReadyState.ts` + `specGenerationResponseValidator.ts`**
- `buildPersistedImplementStateLiteral` / `buildPlannerResponseFromGenerated` / `buildTestPlannerResponseFromTests` / `defaultPutImplementState` write `implement-state.json` (hydrates the Implement screen) — reused untouched. The validator already accepts empty `coveredEndpointIds` (`:371`), `unit`/`functional` test types (`:128`), and the `/agent-os:shape-spec` `SPEC_TEXT_REQUIRED_PREFIX` (`:119`).

**D2's `discovery_capability` entity + `DiscoveryCapabilityController` (changeset 184, built)**
- Provides the context source the resolver reads: `name`, `kind`, `summary`, boxed `confidence`, and `detail_json` (JIL-DAG topology, `invocations[]`, schedule/trigger, external systems, `behaviourBearing` hint); members + outbound links live in `discovery_capability_member`. Reuses changesets 181 (`migration_story_spec_generations` with `structured_tests_json` / `covered_endpoint_ids`) + 184 — NO new changeset.

## Out of Scope
- The completeness gate (D4 — every capability cited-or-dismissed before Migrate); any promotion of `source_capability_id` to a column is D4's changeset.
- Net_new items + provenance (D5).
- Reconcile-time verification / `target_only` routing (D6).
- Batch / gate-driven capability-story invocation + wiring into the "Generate all" button (deferred to D4).
- Any new tech-category vocabulary (dedicated orchestrator / FTP / monitoring category set) — possible later enhancement only.
- A per-capability tech picker — modernisation reuses the existing per-project/element target-tech machinery as-is.
- A "modern target" chip/label in the UI — deferrable nice-to-have.
- A new Liquibase changeset (none needed; provenance rides the `book_of_work_json` blob).
- A parallel generator — ONE generator only (`migrationShapeSpecGenerationHandler` stays the single path).
