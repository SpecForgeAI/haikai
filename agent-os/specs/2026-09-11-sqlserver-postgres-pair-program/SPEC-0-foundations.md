# SPEC 0 — Foundations: engine vocabulary, pair-per-project, rules-library unification, guard

Design of record: `agent-os/planning/2026-09-11-sqlserver-postgres-pair-shaping.md` (§3 rulings, §4 vocabulary).
Size: M. Depends on: —. Wave A (alone). NO SQL Server behaviour lands here; every seam opens.

## Goal
After S0 the codebase has a third engine value `mssql` in every vocabulary, the pair ruleset is
resolved per source engine (env pin = override only), the three `migrationPairRules.ts` copies are
byte-identical (AMVS content canonical + the new resolver), and the engine-name guard also polices
`mssql` / `sql server`. The Sybase pair behaves exactly as before.

## Tasks

### 0.1 Engine vocabulary (widen the unions; add `mssql`)
- discovery: `databasePacks/types.ts:27` `DatabaseEngine = 'postgres' | 'sybase' | 'mssql'` + export
  `DATABASE_ENGINES` const + `DEFAULT_PORT_BY_ENGINE = { postgres: 5432, sybase: 5000, mssql: 1433 }`
  + `isDatabaseEngine(x)`. `DatabaseDiscoveryPack.ts:112` `engineKey: DatabaseEngine`.
  `db/DbAdapter.ts:35` `DbType` = same union. `databasePackFindingBuilders.ts:45`
  `DbFindingEngineKey = DatabaseEngine | 'unknown'`. `softFail.ts:39` param type → `DbFindingEngineKey`.
  `databasePackFactory.ts:59` unknown-key check → `isDatabaseEngine` (registry still postgres+sybase
  until S2; `getDatabasePack('mssql')` returns null + warn "pack lands in S2"). `routes/database.ts:83`
  validator → `isDatabaseEngine`, message lists `DATABASE_ENGINES`; `:45` default port via map.
  `routes/databaseScanModes.ts:71-76` `scanConfig(body, engine: DatabaseEngine)` + port map (the two
  hardcoded engines in verification/refresh-seeds stay until S2). `s0AutoSnapshot.ts:102` gate →
  `isDatabaseEngine`. `db/dbAdapterFactory.ts` add `case 'mssql'` throwing "MssqlAdapter lands in S3"
  (keeps exhaustiveness). `types.ts:134,168,207` `sybaseDriver` unchanged.
- AMVS: `types/db.ts:10` `DbType = 'postgres' | 'sybase' | 'mssql'` + `DB_TYPES` + `isDbType(x)`.
  `compensation/types.ts:153` `CompensationEngine = DbType`. `captureCompensation.ts:66,111` and
  `routes/s0Snapshot.ts:93,264`: engine = `config.dbType` (drop the `=== 'postgres' ? : 'sybase'`
  ternaries; write adapter factory: postgres → PG adapter, else the sidecar write adapter).
  Route validators → `isDbType` with a message listing `DB_TYPES`: `dataParityRun.ts:82`,
  `dataMigrationRun.ts:99,113`, `procParityRun.ts:48,58`, `logReplayRun.ts:59`, `s0Snapshot.ts:66`,
  `captureSessionActions.ts:3151`, `targetCaptureSessionActions.ts:510-514`,
  `captureSessionOrchestrator.ts:1697,1717`, `procCapture/types.ts:65` (`dbType: DbType`).
  `db/dbAdapterFactory.ts` add `case 'mssql'` throwing "MssqlAdapter lands in S3".
- gateway: `dbMigrationPack/dbCredentialBlock.ts:12` `SUPPORTED_DB_ENGINES = ['postgres','sybase','mssql']`.
  `migrationTargetCredentialsStore.ts:57` `dbType: SupportedDbEngine` (import type).
  `migrationManualReconcileTriggers.ts:208-224` → use `parseDbCredentialBlock` / `dbBlockShapeError`
  (delete the duplicate vocabulary). `migrationReconciliationValidationClient.ts:391` → `SupportedDbEngine`.
  `dbSchemaHarvest.ts:86,202,213`: request gains `dbEngine?: SupportedDbEngine` (default `'sybase'`
  for back-compat; route accepts `db_engine`); `sybaseDriver` sent only when engine is sybase.
  `dbMigrationPack/inputs.ts:319-353`: `assertSupportedEnginePair` returns
  `{ sourceEngine, targetEngine, pairId, ruleset }` using `resolvePairRuleset`; a pack-code const
  `GENERATOR_SUPPORTED_SOURCE_ENGINES = ['sybase']` (S5 adds `mssql`) gates generation with the
  message "the pack generator does not support <engine> yet" — the `UnsupportedEnginePairError`
  text (`types.ts:638`) becomes generic ("no ruleset for <src> -> <tgt>" / "generator support").
  `sourceEngine` in the IR/manifest becomes the ENGINE KEY (`'sybase'`, not `'sybase_ase'`) +
  new manifest fields `source_engine_display`, `target_engine_display`, `pair_id`,
  `ruleset_version` (handler `:1026,:1107`). Update the 8 test fixtures that pin `sybase_ase`
  (gateway ×7, frontend ×1) and any title pins in `migrationDbPackPlanner.test.ts`.
- frontend: new `src/api/dbEngines.ts`: `DbEngineKey = 'postgres' | 'sybase' | 'mssql'`,
  `DB_ENGINE_LABEL`, `DB_ENGINE_DEFAULT_PORT`, `isDbEngineKey`. Replace the unions at
  `discoveryApi.ts:1717`, `dbMigrationPackApi.ts:1635`, `migrationDeliveryDashboardApi.ts:1567`,
  `migrationProgressReportApi.ts:208`, `procBehaviourApi.ts:321`, `s0SnapshotApi.ts:32`,
  `StartCaptureSessionWizard.tsx:127` (`'none' | DbEngineKey`), `S0RestorePanel.tsx:37`,
  `StartProcCaptureSessionWizard.tsx:47`, `DbMigrationPackTargetBuildModal.tsx:107`,
  `RunReconciliationModal.tsx:58,67,151`. UI option lists are NOT extended here (S2 scan modal,
  S7 the rest) — types only.

### 0.2 Pair-per-project resolution (`migrationPairRules.ts`, canonical = AMVS)
- Add to the AMVS copy: `listPairRulesets(): MigrationPairRuleset[]` (every `*.rules.json` in the
  dir, validated, cached; explicit `MIGRATION_PAIR_RULESET_PATH` counts as one),
  `resolvePairRuleset({ sourceEngine, targetEngine = 'postgres', sourceVersion? })` (case-insensitive
  engine match on `source.engine`/`target.engine`; exact `source.version` preferred, else highest
  numeric version; null when none), `loadPairRulesetById(pairId)`, `pairRulesetForSource(sourceEngine,
  sourceVersion?)` = env pin (`loadPairRuleset()` when `MIGRATION_PAIR`/`_PATH` set) else resolve.
  `loadPairRuleset()` unchanged semantics; when >1 file and no pin it returns null AND
  `console.warn` once naming `pairRulesetForSource`. Add `procRulePrefix(ruleset)` =
  `ruleset.rules_prefix ?? <pair_id-derived>` and `sessionProfileRule(ruleset)` (first active rule
  with `session_profile`). Ruleset shape gains optional `rules_prefix: string`.
- `migration-pairs/sybase15-postgres18.rules.json`: add `"rules_prefix": "SYBPG."` (no other change).
- AMVS callers: `dataParityRun.ts:173`, `dataMigrationRun.ts:208,373`, `runDataMigrationCli.ts:64`
  → `pairRulesetForSource(sourceConfig.dbType)`; `procCaptureOrchestrator.ts:138` → resolve from
  `cfg.dbType` + `sessionProfileRule`; `procParityRunner.ts:71` → resolve from the SOURCE db type the
  parity run carries (the request's source block); `procParityComparator.ts:361` → `procRulePrefix`.
  Boot header (`index.ts:66-75`): `migration_pairs: [...ids]`, `pinned_pair`.
- gateway callers: `migrationCodeSpecCarriage.ts:71` heading → `resolvePairRuleset({sourceEngine})`
  at call time using the discovery context's `sourceEngines[0]` when available, else the first
  listed ruleset's heading (still a generic fallback); `translations.ts:1349`,
  `translationEmission.ts:549`, `procWorkbench.ts:102,171`, `dbMigrationPackWorkbench.ts:167`,
  `migrationProcParityReconcile.ts:43,115` → `loadPairRulesetById(manifest.pair_id)` with a
  fallback to `resolvePairRuleset({ sourceEngine: manifest.source_engine })`. Boot header as AMVS.
- discovery: boot header as AMVS (no other consumer).
- Copy the AMVS file byte-identically to gateway + discovery. New gateway test
  `migrationPairRulesCopies.test.ts` walks up to the repo root and asserts the three files are
  identical (skips with a clear message if a sibling service dir is absent).

### 0.3 Engine-name guard
- `gateway/src/__tests__/engineNameGuard.test.ts:22` `ENGINE_TOKEN = /sybase|postgres|t-?sql|mssql|sql\s?server/i`.
  Re-run; for any allowlisted file whose count rises, MOVE the knowledge (never raise). Add
  `services/migrationProgressSummary.ts` and `services/migrationManualReconcileTriggers.ts` to the
  allowlist with their exact post-S0 counts and reasons.

### 0.4 Tests
- Extend `migrationPairRules.test.ts` (gateway + AMVS mirror): resolve by source engine (two temp
  rulesets, version preference), by id, env pin wins, multi-file no-pin → null + warn, prefix/session
  helpers. Route validator tests: `mssql` accepted by shape (adapter throw surfaces as a clean 4xx/5xx
  message, never a crash). Existing suites updated for `source_engine: 'sybase'`.

## Verification (pinned commands)
- gateway: `npx jest --silent` (only the 3 pre-existing reds allowed) + `npx tsc --noEmit`.
- AMVS: `npx jest --silent` (only the 3 pre-existing reds) + `npx tsc --noEmit`.
- discovery: `npx jest --silent` + `npx tsc --noEmit`.
- frontend: `npx tsc --noEmit -p tsconfig.json` on touched files only (baseline is red) + vitest for
  touched suites.

## Done when
Sybase pair unchanged end to end; `mssql` accepted as a vocabulary value everywhere; ruleset resolves
per source engine; three library copies identical; guard extended; BUILD-LOG row written.
