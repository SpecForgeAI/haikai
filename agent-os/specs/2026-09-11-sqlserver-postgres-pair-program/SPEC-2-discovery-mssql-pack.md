# SPEC 2 — Discovery `mssql` pack + scan UI

Design of record: shaping §2, §4, §5. Size: L. Depends on: S1. Wave C (parallel with S3).

## Goal
`discovery-service` scans a SQL Server database through the sidecar exactly as it scans Sybase:
introspection → profiling → charset/collation → proc harvest → routine profile → sequence idioms →
relationships → candidates → findings → S0 pin → routine catalog save. Cross-engine conformance
holds for three engines.

## Tasks
- 2.1 `services/databasePacks/mssql/`: `MssqlDiscoveryPack.ts` (engineKey `mssql`, display
  "SQL Server", `db://mssql/…`, clientId prefix `mstab:`), `mssqlIntrospection.ts` (sidecar wire →
  IR; capability applicability: `index_predicate` SUPPORTED, `native_sequence` SUPPORTED (2012+),
  collation per column, computed persisted flag, defaults, check constraints, identity seed/increment,
  trigger timing `after|instead_of` from the catalog, events from `sys.trigger_events`, view
  `isMaterialized=false` + `indexed_view` flag, extended objects → `ExtendedObjectMetadata[]`),
  `mssqlProfiler.ts` (reuse the Sybase profiler SQL — valid verbatim; `isOrderedType` adds
  `datetime2`, `datetimeoffset`, `uniqueidentifier`), `mssqlFindings.ts` (mirror the Sybase
  emitters; `METADATA_GROUP_GAP_DETAIL` names `sys.*` sources; new findings:
  `temporal_table_detected`, `clr_object_detected`, `service_broker_detected`,
  `filestream_column`, `fulltext_index_detected`, `xml_typed_column`, `sql_variant_column`,
  `hierarchyid_column`, `spatial_column`, `cross_database_reference` (named OUT reason),
  `indexed_view` (named OUT reason), `columnstore_index`, `memory_optimized_table`,
  `synonym_detected`, `user_defined_table_type`), `mssqlRelationshipInference.ts` (declared FKs
  now carry columns; name heuristics shared → move `deriveCandidateParentName` + `nameBasedInferences`
  to a shared `relationshipHeuristics.ts` used by both packs), `mssqlProcHarvest.ts` (bodies come
  complete from `sys.sql_modules`; functions + CLR bodies too), sidecar client: generalise
  `sybaseSidecarClient.ts` → `sidecarClient.ts` with `engine` on every call (Sybase pack passes
  `'sybase'`; keep the old module as a thin re-export for its tests).
- 2.2 T-SQL routine profiler (`tsqlRoutineProfiler.ts`): constructs `try_catch`, `throw`,
  `xact_abort` (SET XACT_ABORT ON/OFF), `trancount` (@@TRANCOUNT), `save_tran`, `merge`,
  `output_clause`, `table_variable`, `tvp_param` (READONLY), `offset_fetch`, `apply`, `iif`,
  `try_convert`, `string_agg`, `sp_executesql_params`, `next_value_for`, `for_system_time`,
  `contains_freetext`, `xml_method`, `openquery_linked` (→ cross_database), `three_part_name`
  (→ cross_database), `error_continuation` (a fallible DML/DDL statement followed by further
  statements with no enclosing TRY/CATCH and no `@@ERROR` check). Parameter parsing handles
  `OUTPUT`/`OUT`, `READONLY`, defaults, `[bracketed]` names. Result/return/raiserror finders extended
  for THROW. Tests mirror `tsqlRoutineProfiler.test.ts`.
- 2.3 Registry + routes: `databasePackFactory.ts` registers `mssql`; `dbAdapterFactory.ts` `mssql`
  arm → sidecar-backed adapter? NO: discovery's Sybase path bypasses `DbAdapter`; do the same
  (throw stays, documented). `routes/databaseScanModes.ts`: refresh-seeds accepts `dbEngine`
  (sybase|mssql) instead of hardcoding; verification-only stays postgres. `s0AutoSnapshot.ts`
  posts `db_type: 'mssql'`. `softFail`/orchestrator engine keys flow unchanged.
- 2.4 Frontend scan entry: `StartDiscoveryRunModal.tsx` engine option "SQL Server" (value `mssql`),
  port 1433 default, MSSQL connection extras (auth scheme sql|ntlm, domain, encrypt,
  trust server certificate, instance name) rendered only for `mssql`; `discoveryApi.ts`
  `DiscoveryDatabaseConnectionConfig` gains `mssqlAuth?: { scheme, domain?, encrypt, trustServerCertificate, instanceName? }`;
  discovery `types.ts` + `routes/database.ts` + orchestrator pass it to the sidecar client;
  `toRedactedConfig` includes it minus secrets. `coreTechPersistenceCheck.ts` moves SQL Server to
  `SUPPORTED_DATABASES` (update the test at :56). `findingTypeLabels.ts` labels for the new findings.
- 2.5 Fixtures: vendor `discovery-service/src/__tests__/fixtures/mssql/wwi-*.json` — sidecar-shaped
  introspection responses derived OFFLINE from the WideWorldImporters SSDT DDL (tables incl. a
  temporal pair, sequences, computed columns, filtered index, FK with actions, INSTEAD OF trigger,
  a TRY/CATCH proc, a TVF) + proc bodies. No network in tests.
- 2.6 Tests: `mssqlDiscoveryPack.test.ts` (twin of the Sybase pack test), `databasePacksCrossEngineGroup6`
  gains `mssql` in the identical-shape + interface-conformance pins, groups B–G twins where the
  MSSQL behaviour differs (collation `_CI_` hazard; computed persisted; identity `last_value`
  available; scheduled jobs from msdb; defaults flagged), `startDatabaseRunCandidatePersistence`
  with an mssql payload.

## Verification
discovery `npx jest --silent` + `tsc --noEmit`; frontend vitest for `StartDiscoveryRunModal*` +
`coreTechPersistenceCheck`.

## Done when
A SQL Server scan produces candidates/findings/routines/S0 pin identical in shape to a Sybase scan,
with the SQL-Server-only findings listed above; Sybase pack tests untouched.
