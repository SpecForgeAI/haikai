# SPEC 4 — State discipline on SQL Server (compensation, S0, proc capture)

Design of record: shaping §2 verified facts, §5 item 3 (capture side). Size: M. Depends on: S3.
Wave D (parallel with S5).

## Goal
Compensation brackets, S0 snapshot/restore and stored-proc behaviour capture work against SQL
Server with the same guarantees as against Sybase: byte-parity undo, identity reseed, fingerprint-
verified restore, fail-closed refusals.

## Tasks
- 4.1 Compensation (`services/compensation/`): `inverseDiff.ts` `qualify()` → per-engine quoting
  (`[schema].[table]` for mssql; Sybase branch unchanged); `needsIdentityWrap` for `sybase` AND
  `mssql` (`SET IDENTITY_INSERT` identical); `buildReseedStatements` mssql →
  `DBCC CHECKIDENT ('[schema].[table]', RESEED, <max>)` (empty table: `RESEED, 0` then the
  documented "next insert = seed" note — for SQL Server the next value after RESEED n is n+1 except
  on a never-inserted table, so the runner records `identity_reseed_note`); `compensationSqlGuard.ts`
  `ALLOWED_PREFIXES` add the DBCC form; `sqlLiterals.ts` `renderLiteral` mssql: booleans `1/0`,
  `N'…'` for n-typed columns (needs `sourceType`), `0x…` for binary, datetime2 7-digit literal;
  `NUMERIC_TYPE_FRAGMENTS` shared. `WriteAdapter.ts` `SybaseCompensationWriteAdapter` →
  `SidecarCompensationWriteAdapter(engine)` posting `engine` + `mssqlAuth` extras; `transactional:false`
  path used for DBCC (SQL Server allows DBCC CHECKIDENT inside a transaction, but keep the same
  posture for symmetry and log it).
- 4.2 S0 (`services/s0/restoreRunner.ts`): mssql → `TRUNCATE TABLE` only when the table is NOT
  FK-referenced (from the metadata's FK map); otherwise `DELETE FROM [t]` + reseed; `qualifyForEngine`
  mssql bracket form; identity wrap for mssql; restore grammar admits `DELETE FROM <t>` bare (no
  WHERE) ONLY in restore mode (both guard layers). Manifest `source_db_type: mssql`.
  `snapshotRunner`/`fingerprint` unchanged (adapter reads).
- 4.3 Proc capture (`services/procCapture/`): `routineScenarioSeeds.ts` `defaultValueForType`
  gains `nvarchar/nchar/ntext`, `datetime2`, `datetimeoffset`, `date`, `time`, `uniqueidentifier`,
  `rowversion`, `xml`, `sql_variant`, `varbinary(max)`, `bigint`, `decimal(p,s)`; `seededFamilies`
  adds `try_catch` / `throw` / `xact_abort` / `error_continuation` → an "error mid-routine" family
  (constraint violation seeded on the first fallible write, then observe whether later statements
  ran); `enumerateExitOutcomes` counts THROW sites. `/call` wire: `sybaseType` → `sourceType` on
  the sidecar `CallParam` (accept both names for one release; AMVS sends `sourceType`).
  `procCaptureOrchestrator.ts` session set via `sessionProfileRule` (S0) — MSSQL list from the
  ruleset. `procParityComparator.ts` prefix via `procRulePrefix` (S0). `MssqlAdapter.callRoutine`
  = same envelope mapping as Sybase (shared `sidecarCallEnvelope.ts`).
- 4.4 Routes: `s0Snapshot.ts`, `targetCaptureSessionActions.ts`, `captureSessionActions.ts`,
  `procParityRun.ts`, `logReplayRun.ts` carry `mssqlAuth`; `writeAdapterFor` by engine.
- 4.5 Tests: `compensationInverseDiff` mssql twins (bracket qualify, DBCC reseed, N-literals),
  `compensationGuard` DBCC admitted / `sp_chgattribute` still admitted, `s0Snapshot` mssql restore
  (FK-referenced parent → DELETE path; unreferenced → TRUNCATE), `procCapture` mssql session set +
  error-mid-routine family, `SybaseAdapter`/`MssqlAdapter` call wire key.

## Verification
AMVS `npx jest --silent` + `tsc --noEmit`; sidecar `mvn -q test` (guard grammar twins from S1
cover DBCC; add the bare-DELETE restore form there too).

## Done when
A SQL Server capture session with compensation runs the full bracket + reseed + restore path in
tests with the same verdict vocabulary as Sybase.
