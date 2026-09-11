# SPEC 6 — Translation dialect (items 3 + 7) + code-tier classifier

Design of record: shaping §5 items 3 and 7; §3 ruling 3. Size: L. Depends on: S4, S5. Wave E.

## Goal
The stored-proc translation workbench translates SQL Server T-SSQL routines, functions and
triggers to PL/pgSQL with pair-neutral prompts driven by ruleset guidance, preserves error /
transaction semantics like-for-like, and the code-tier classifier recognises SQL-Server-only
constructs.

## Tasks
- 6.1 Pair-neutral prompts (`translations.ts`): `KIND_INSTRUCTIONS` become templates that take
  `{ sourceDisplay, targetDisplay, guidanceHeading, catalogRefusal, untranslatable }` from the
  ruleset (`translation_profile` block added to BOTH rulesets: `source_display`, `catalog_refusal`
  (Sybase: `sysobjects, syscolumns, …`; MSSQL: `sys.*, INFORMATION_SCHEMA.*, OBJECT_ID(),
  OBJECT_NAME()`), `scheduler_name` (Sybase Job Scheduler / SQL Server Agent),
  `untranslatable_constructs` (Sybase list as today; MSSQL: `xp_cmdshell`, `sp_send_dbmail`,
  `sp_OA*`, CLR calls, `OPENQUERY`/`OPENROWSET`/linked servers (named cross_database_reference),
  Service Broker verbs `SEND/RECEIVE/BEGIN DIALOG`, `WAITFOR`, `sp_getapplock`), `token_conversions`
  (getdate→now(), sysdatetime→now(), sysutcdatetime→…, newid→gen_random_uuid(), newsequentialid
  (flag), suser_sname/original_login→current_user, db_name→current_database(), app_name→…,
  @@spid→pg_backend_pid(), @@servername (flag), scope_identity→lastval()/RETURNING guidance,
  ident_current→currval(pg_get_serial_sequence()), @@rowcount→GET DIAGNOSTICS, @@error→EXCEPTION,
  @@trancount→(see TXN rule), error_number()/error_message()/error_line()/error_procedure()→
  SQLSTATE/SQLERRM/GET STACKED DIAGNOSTICS, isnull→coalesce, iif→CASE, try_convert→
  BEGIN/EXCEPTION wrapper or regex-guarded cast, string_agg→string_agg (ORDER BY WITHIN GROUP→
  inside), format→to_char, datefromparts→make_date, eomonth→(date_trunc+interval), dateadd/
  datediff/datepart→interval arithmetic/extract, charindex→position/strpos, stuff→overlay,
  patindex→regex, len→length (rtrim semantics!), replicate→repeat, `+` concat→`||`, `TOP n`→
  `LIMIT n`, `OFFSET…FETCH`→`OFFSET…LIMIT`, `APPLY`→`LATERAL`, `MERGE`→`MERGE` (PG 15+, WHEN NOT
  MATCHED BY SOURCE → PG 17+), `OUTPUT`→`RETURNING` (OUTPUT INTO → CTE), table variables → temp
  tables, `sp_executesql @stmt, @params, …`→`EXECUTE … USING`, `NEXT VALUE FOR`→`nextval()`,
  `#temp`→`CREATE TEMP TABLE … ON COMMIT DROP`, `SELECT … INTO #t`→`CREATE TEMP TABLE AS`,
  `WITH (NOLOCK)`→drop, `HOLDLOCK/UPDLOCK`→`FOR UPDATE`, `RAISERROR(msg, sev, state)`→`RAISE`
  per ERR rule, `THROW n, msg, state`→`RAISE EXCEPTION USING ERRCODE='P0001', DETAIL='{"source_error":n}'`,
  `PRINT`→`RAISE NOTICE`, `SET NOCOUNT`→drop, `RETURN n`→return_status carriage,
  `EXEC proc @p = @v OUTPUT`→`CALL … ` with INOUT per ABI rule, `CAST(x AS datetime2)`, `CONVERT
  (…, style)`→`to_char` style table (101,103,112,120,121,126,127)). The translator and judge system
  prompts read `sourceDisplay` — the strings "Sybase ASE" leave `translations.ts`.
- 6.2 Item 3 — error/transaction semantics: `MSPG.PROC.TXN.001` + `MSPG.PROC.ERR.001` carry the
  convention: (a) TRY/CATCH → `BEGIN … EXCEPTION WHEN OTHERS THEN …` with `GET STACKED DIAGNOSTICS`
  mapping for ERROR_* functions; (b) THROW re-raise → `RAISE;`; (c) `XACT_ABORT ON` → whole-block
  abort = PG default, no extra work; `XACT_ABORT OFF` + `error_continuation` construct →
  per-statement `BEGIN … EXCEPTION WHEN OTHERS THEN <record @@ERROR-equivalent into a local>
  END` sub-blocks ONLY around statements the profile marks fallible-and-continued, each with a
  `-- MSPG.PROC.TXN.001 continue-after-error` comment; (d) nested `BEGIN TRAN`/`COMMIT` with
  `@@TRANCOUNT` → savepoints (`SAVE TRAN` → `SAVEPOINT`, `ROLLBACK TRAN name` → `ROLLBACK TO
  SAVEPOINT`), outermost `COMMIT` inside a PROCEDURE → allowed (PG 11+ procedures), inside a
  FUNCTION → raise `P0002` per the existing inner_rollback convention; (e) `@@TRANCOUNT` reads
  → a local depth counter maintained by the emitted sub-blocks. `routineInvocationDescriptor.ts`
  gains `error_sites` for THROW; `evidenceLadder` renders the error-mid-routine scenarios (S4)
  first when present. The judge prompt gets a `continue_after_error_expected: true|false` fact
  from the profile so it does not "fix" the source behaviour.
- 6.3 Item 7 — triggers: new translation kind handling for `trigger` with MSSQL profile:
  `inserted`/`deleted` → `CREATE TRIGGER … AFTER INSERT OR UPDATE OR DELETE ON t REFERENCING
  NEW TABLE AS inserted OLD TABLE AS deleted FOR EACH STATEMENT EXECUTE FUNCTION f()`; separate
  events when the body branches on `UPDATE(col)`/`COLUMNS_UPDATED()` → `TG_OP` + a per-column
  compare over the transition tables; INSTEAD OF on VIEW → `INSTEAD OF … FOR EACH ROW` with
  `NEW`/`OLD` and a manifest note `instead_of_row_level`; INSTEAD OF on TABLE → decision
  `instead_of_table_trigger` (`before_trigger_emulation` default | `rewrite_in_app`); ordering
  (`ExecIsFirst*/Last*`) → trigger names prefixed `a_`/`z_` (PG fires alphabetically) + note;
  disabled triggers → `ALTER TABLE … DISABLE TRIGGER`; recursive/nested-trigger DB options detected
  → decision `trigger_recursion` when any trigger writes its own table. Trigger judge family:
  state_delta compares transition-table effects (already keyed rows).
- 6.4 Untranslatable named reasons: routines/objects with `cross_database_reference`,
  `indexed_view`, `openquery_linked` → pipeline_state `needs_manual` is NOT used; instead
  `disposition: 'rewrite_in_app'` proposal + `untranslatable_reason` column (AMS changeset 233
  on `db_migration_pack_translations`: `untranslatable_reason varchar(64) NULL`) shown in the
  workbench with the reason label. Same column carries `clr_object` / `service_broker_object`.
- 6.5 Code-tier (`discovery-service/.../sqlDialectClassifier.ts` + springClassic
  `sqlDialectFindings.ts`): add SQL-Server-only families (`offset_fetch`, `try_convert`,
  `string_agg`, `iif`, `apply`, `merge`, `output_clause`, `throw`, `try_catch`, `sysdatetime`,
  `sysutcdatetime`, `datetimeoffset`, `scope_identity`, `bracket_identifier` (signal only,
  severity info), `nolock_hint` (exists), `sequence_next_value`); construct `note` strings become
  pair-neutral ("T-SQL …") with engine-specific seeds moving into each ruleset's `construct_refs`;
  `sqlDialectFindings.ts:102` "Sybase→PostgreSQL" → "<source>→PostgreSQL" from the scan engine
  (the finding builder receives `engineKey`); `riskyDependencyRules.ts` add EOL rows for
  `com.microsoft.sqlserver:mssql-jdbc` < 12 (medium) and `net.sourceforge.jtds:jtds` (medium,
  unmaintained since 2013); `mavenFindingScanner.test.ts` mssql-jdbc case; `effectCandidateEmitter`
  comments neutralised (behaviour unchanged) + `OUTPUT INSERTED.*` write-form recognised.
- 6.6 Tests: `dbMigrationPackTranslationsMssql.test.ts` (prompt text from the MSSQL ruleset; no
  "Sybase" in an MSSQL prompt; no "SQL Server" in a Sybase prompt), TXN/ERR convention pins over
  WWI TRY/CATCH proc fixtures (deterministic pre-pass output), trigger emission pins (statement-level
  transition tables, INSTEAD OF view), untranslatable reason surfaced, classifier twins, existing
  `dbMigrationPackTranslationLifecycle` green.

## Verification
gateway + discovery jest/tsc; AMS `mvn -q package -DskipTests` compiles + changeset 233 persistence
test; frontend `TranslationReviewer`/workbench vitest for the reason label (S7 finishes labels).

## Done when
An MSSQL routine with TRY/CATCH + THROW + nested transactions + an OUTPUT clause translates through
the deterministic pre-pass + prompt with the conventions above cited, and a statement-level trigger
over `inserted`/`deleted` emits a transition-table trigger.
