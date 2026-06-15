/**
 * Friendly labels for Discovery Finding `finding_type` strings.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings -- Task Group 7.
 *
 * The Findings tab and detail drawer render the raw `finding_type` string
 * coming back from the architecture-model-service. Raw strings are usable
 * but cryptic ("`raw_sql_detected`", "`spring_xml_bean_wiring`"). This
 * module ships:
 *
 *  - {@link FINDING_TYPE_LABELS}: a hand-curated `Record<string, string>` of
 *    the ~19 finding types this spec adds plus the predecessor types
 *    already shown in the filter dropdowns.
 *  - {@link labelForFindingType}: returns the friendly label for a known
 *    type, OR a title-cased fallback derived from the raw string so unknown
 *    types still render legibly (no missing-label warnings, no crash).
 *
 * Existing filter logic (category / type / severity / status) is unaffected
 * -- this module is display-only. The filter dropdowns continue to pass the
 * RAW `finding_type` string to the API; only the visible label changes.
 */

/**
 * Hand-curated friendly labels keyed by raw `finding_type` string.
 *
 * Additions belong here whenever a new finding_type is introduced. The
 * resolver helper {@link labelForFindingType} falls back gracefully when
 * a type is missing from this map, so forgetting to add an entry is not
 * a crash -- but it IS a hint that the new type should be documented.
 */
export const FINDING_TYPE_LABELS: Record<string, string> = {
  // -- Java pack (Wave A, Commit 1) --
  raw_sql_detected: 'Raw SQL detected',
  hardcoded_endpoint_or_url: 'Hardcoded endpoint or URL',
  legacy_java_api_usage: 'Legacy Java API usage',

  // -- Spring Classic pack (Wave B, Commit 2) --
  spring_xml_bean_wiring: 'Spring XML bean wiring',
  legacy_transaction_configuration: 'Legacy transaction configuration',
  security_filter_or_interceptor_detected: 'Security filter/interceptor detected',
  scheduled_or_batch_job_detected: 'Scheduled or batch job detected',
  stored_procedure_or_jdbc_usage: 'Stored procedure/JDBC usage',
  spring_classic_migration_risk: 'Spring Classic migration risk',

  // -- Wave B Group 4 (Source D extension) --
  // The Source D extension uses the existing runtime-source vocabulary
  // (NOT a new Spring-specific type). Group 4's no-usage emission ended
  // up labelled `unused_code_endpoint` rather than the originally
  // proposed `endpoint_code_runtime_mismatch`; match what was actually
  // emitted by the predecessor commit.
  unused_code_endpoint: 'Unused code endpoint',

  // -- Endpoint->Data-Effect Call Graph (Spec 2026-05-29, Task Group 3.5 /
  //    surfaced by Task Group 4.4) --
  // Emitted by springClassicFindingScanner when an inbound HTTP endpoint
  // touches data that could not be statically resolved to a single data
  // entity (multiple impls / dynamic dispatch / JdbcTemplate / native SQL /
  // EntityManager / reflection / too-deep). Surfaces in the existing
  // FindingsTab / FindingDetailDrawer with no further frontend change.
  endpoint_data_effect_unresolved: 'Unresolved endpoint data effect',

  // -- Oracle Integrity & Determinism (Spec 2026-05-30, Spec #3) -- Task Group 6 --
  // Two evidence-gap sentinels registered in the discovery-service
  // `emissionSources.ts` `EvidenceGapType` union (next to W4's
  // `scanner_failed` and `low_confidence_candidate`) and surfaced through
  // the existing Findings machinery with NO new component:
  //   - `non_deterministic_endpoint` (Task Group 4): emitted by the new
  //     deterministic Spring/Spring-Classic scanner for endpoints whose
  //     handler reaches @Scheduled / @Cacheable / @Async / @Profile-gated
  //     beans, session state, or clock / random -- i.e. the endpoint is NOT
  //     a pure function of its inputs, so the runtime harness must not treat
  //     legitimate variance as a behavioural diff.
  //   - `possible_entity_collision` (Task Group 5): emitted by the MCP
  //     save-back false-merge guard when a NORMALIZED (non-exact) name match
  //     drives a binding (e.g. `Order` vs `Orders`), so a fuzzy match is
  //     surfaced for review rather than silently first-match-bound.
  // Both labels resolve via `labelForFindingType`, which `FindingsTab` and
  // `FindingDetailDrawer` already call; adding them here is the entire
  // frontend rendering change (no bespoke widget).
  non_deterministic_endpoint: 'Non-deterministic endpoint',
  possible_entity_collision: 'Possible entity collision',

  // -- Outbound Integration Graph (Spec 2026-05-30, Spec #5) -- Task Group 6 --
  // Emitted by the new `outboundIntegrationCandidates` finding builder (via
  // `springClassicFindingScanner`) for a PURELY-EXTERNAL outbound target -- an
  // HTTP URL / topic / queue / store / file / SDK endpoint the service calls
  // out to with NO discovered in-model counterpart (`category: migration_risk`).
  // The verbatim target + payload-type hint + integration kind ride on the
  // finding `detail_json`; the companion `data_movements` candidate is the
  // model surface. Surfaces in the existing FindingsTab / FindingDetailDrawer
  // via `labelForFindingType` (the entire frontend rendering change -- no
  // bespoke widget).
  external_integration_dependency: 'External integration dependency',

  // -- Data-Layer Fidelity 2 (Spec 2026-05-30, Spec #6) -- Task Groups B/C/D/F --
  // The cross-engine (Sybase -> Postgres) DB-capture hazard finding types this
  // spec adds, emitted through the existing `FindingEmitter` by the DB-pack
  // finding builders (`databasePackFindingBuilders.ts` / `postgresFindings.ts`
  // / `sybaseFindings.ts`). All four are procedural / migration reality routed
  // to Findings (NEVER new entity types). They resolve via `labelForFindingType`,
  // which `FindingsTab` and `FindingDetailDrawer` already call; adding these
  // labels is the entire frontend rendering change (no bespoke widget):
  //   - `collation_case_sensitivity_hazard` (Group B): a source Sybase
  //     case-insensitive collation that Postgres's case-sensitive default would
  //     NOT reproduce (silent `WHERE name='smith'` divergence).
  //   - `non_portable_default` (Group D): an engine-specific server default
  //     (`getdate()` / `newid()` / `suser_name()` / `host_name()` ...) flagged
  //     for the book-of-work -- the verbatim `column_default` is unchanged.
  //   - `db_resident_scheduled_job` (Group F): a database-resident scheduled
  //     job / agent (Sybase scheduler / Postgres equivalent) -- procedural
  //     reality that does not port directly.
  //   - `sequence_cutover_hazard` (Group C): the first post-cutover INSERT
  //     would collide with existing PKs unless the target sequence is advanced
  //     past the captured high-water mark.
  collation_case_sensitivity_hazard: 'Collation case-sensitivity hazard',
  non_portable_default: 'Non-portable column default',
  db_resident_scheduled_job: 'Database-resident scheduled job',
  sequence_cutover_hazard: 'Sequence cutover hazard',

  // -- Maven pack (Wave C, Commit 3) --
  java_version_detected: 'Java version detected',
  spring_version_detected: 'Spring version detected',
  risky_dependency: 'Risky dependency',
  database_driver_detected: 'Database driver detected',
  maven_build_plugin_risk: 'Maven build/plugin risk',
  dependency_version_conflict: 'Dependency version conflict',
  test_build_gap: 'Test/build gap',

  // -- Database Discovery Packs (Spec 2026-05-16, Task Group 5) --
  // The ~28 net-new DB finding types after the three D6 consolidations
  // (db_migration_risk / evidence_gap / hidden_business_logic). The labels
  // below cover structural, profiling, data-quality, hidden-logic, and
  // helper-hint categories.
  missing_primary_key: 'Missing primary key',
  no_foreign_keys_declared: 'No foreign keys declared',
  inferred_relationship: 'Inferred relationship',
  unenforced_relationship: 'Unenforced relationship',
  ambiguous_relationship: 'Ambiguous relationship',
  large_table: 'Large table',
  empty_table: 'Empty table',
  sparse_column: 'Sparse column',
  high_null_rate: 'High null rate',
  unexpected_nulls: 'Unexpected nulls',
  duplicate_business_key: 'Duplicate business key',
  orphaned_reference: 'Orphaned reference',
  unexpected_code_values: 'Unexpected code values',
  sentinel_value_detected: 'Sentinel value detected',
  invalid_date_value: 'Invalid date value',
  inconsistent_reference_data: 'Inconsistent reference data',
  migration_data_quality_risk: 'Migration data quality risk',
  stored_procedure_logic: 'Stored procedure logic',
  procedure_data_write: 'Procedure data write',
  procedure_dependency: 'Procedure dependency',
  trigger_side_effect: 'Trigger side-effect',
  hidden_business_logic: 'Hidden business logic',
  db_migration_risk: 'DB migration risk',
  sample_data_hint: 'Sample data hint',
  reconciliation_hint: 'Reconciliation hint',
  api_test_data_candidate: 'API test data candidate',
  unsupported_db_feature: 'Unsupported DB feature',
  db_pack_warning: 'DB pack warning',
};

/**
 * Title-case a snake_case / hyphen-case string for use as a fallback
 * label. Splits on `_` and `-`, capitalises each word, and joins with
 * a space. Empty / non-string input returns an empty string.
 */
function titleCaseFromSnake(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .split(/[_\-]+/)
    .filter((piece) => piece.length > 0)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Return the friendly label for a `finding_type`. Known types come from
 * {@link FINDING_TYPE_LABELS}; unknown types are title-cased on the fly
 * so the UI never renders a raw `snake_case_type` to the user.
 */
export function labelForFindingType(type: string | null | undefined): string {
  if (type == null) return '';
  const trimmed = String(type).trim();
  if (trimmed.length === 0) return '';
  const known = FINDING_TYPE_LABELS[trimmed];
  if (known) return known;
  return titleCaseFromSnake(trimmed);
}
