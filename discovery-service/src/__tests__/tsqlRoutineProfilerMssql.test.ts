/**
 * T-SQL routine profiler -- the SQL Server construct set (SQL Server 16 ->
 * PostgreSQL 18 pair programme, Spec 2, 2026-09-11, task 2.2).
 *
 * The twin of `tsqlRoutineProfiler.test.ts`, which pins the ASE side. ONE
 * profiler serves both packs, so this file only exercises what SQL Server
 * adds: the error / transaction constructs (shaping hard item 3), the
 * statement forms with no PostgreSQL one-to-one, THROW as an exit outcome,
 * the parameter modifiers (`OUTPUT` / `READONLY` / defaults / bracketed and
 * schema-qualified types), and `WITH EXECUTE AS OWNER` between the parameter
 * list and the body `AS`.
 *
 * The last of those is the subtle one: `EXECUTE AS OWNER` contains the word
 * `AS`, so a naive body-start scan cuts the header in half and loses every
 * parameter. The regression pin is the parameter list surviving.
 *
 * Offline. Bodies are read from the vendored fixtures or written inline with
 * invented vocabulary; nothing here touches a network or a database.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  CROSS_DATABASE_CONSTRUCTS,
  profileTsqlRoutine,
} from '../services/databasePacks/sybase/tsqlRoutineProfiler';
import type { LiveProcSource } from '../scl/sqlProcHarvester';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'mssql');

const BODIES: LiveProcSource[] = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, 'wwi-proc-bodies.json'), 'utf8'),
) as LiveProcSource[];

function bodyNamed(name: string): LiveProcSource {
  const found = BODIES.find((b) => b.name === name);
  if (!found) throw new Error(`fixture body not found: ${name}`);
  return found;
}

// -----------------------------------------------------------------------------
// Signature parsing
// -----------------------------------------------------------------------------

describe('profileTsqlRoutine -- SQL Server signatures', () => {
  it('parses a procedure whose header carries WITH EXECUTE AS OWNER before the body AS', () => {
    const r = profileTsqlRoutine(bodyNamed('Application.AddRoleMemberIfNonexistent'));
    expect(r.signature_parsed).toBe(true);
    expect(r.routine_kind).toBe('procedure');
    expect(r.schema_name).toBe('application');
    // Identifier case is preserved since 2026-09-12 (the EXEC target on a
    // case-sensitive server); join keys lowercase on both sides.
    expect(r.routine_name).toBe('AddRoleMemberIfNonexistent');
    expect(r.params.map((p) => p.name)).toEqual(['RoleName', 'UserName']);
    expect(r.params[0].source_type).toBe('sysname');
  });

  it('parses READONLY table-valued parameters with schema-qualified type names', () => {
    const r = profileTsqlRoutine(bodyNamed('Website.InsertCustomerOrders'));
    expect(r.signature_parsed).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual([
      'Orders',
      'OrderLines',
      'OrdersCreatedByPersonID',
      'SalespersonPersonID',
    ]);
    expect(r.params[0]).toMatchObject({
      source_type: 'website.orderlist',
      direction: 'in',
      is_readonly: true,
    });
    expect(r.params[1].is_readonly).toBe(true);
    // An ordinary parameter is NOT marked readonly -- the flag is only ever
    // set, never defaulted, so an ASE routine serialises exactly as before.
    expect(r.params[2].is_readonly).toBeUndefined();
  });

  it('parses OUTPUT + a NULL default together, and a bracketed / dotted type', () => {
    const r = profileTsqlRoutine({
      name: 'Ledger.sync_rollup',
      objType: 'P',
      text:
        'CREATE PROCEDURE [Ledger].[sync_rollup]\n' +
        '  @AsOf date = NULL,\n' +
        '  @Label [dbo].[ShortName] = N\'nightly\',\n' +
        '  @Total decimal(18,2) = 0.00 OUTPUT,\n' +
        '  @Batch Ledger.BatchList READONLY\n' +
        'AS\nBEGIN\n  SELECT 1;\nEND;',
    });
    expect(r.signature_parsed).toBe(true);
    expect(r.params[0]).toMatchObject({ source_type: 'date', default_literal: 'NULL' });
    expect(r.params[1]).toMatchObject({
      source_type: '[dbo].[shortname]',
      default_literal: "N'nightly'",
    });
    expect(r.params[2]).toMatchObject({
      source_type: 'decimal(18,2)',
      direction: 'output',
      default_literal: '0.00',
    });
    expect(r.params[3].is_readonly).toBe(true);
  });

  it('parses a WITH SCHEMABINDING inline table-valued function', () => {
    const r = profileTsqlRoutine(bodyNamed('Application.DetermineCustomerAccess'));
    expect(r.routine_kind).toBe('function');
    expect(r.signature_parsed).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual(['CityID']);
    expect(r.returns_type).toBe('TABLE');
  });

  it('parses an INSTEAD OF trigger header (table + events)', () => {
    const r = profileTsqlRoutine(bodyNamed('Ledger.trg_PostingTotals_InsteadOfInsert'));
    expect(r.routine_kind).toBe('trigger');
    expect(r.trigger_on_table).toBe('postingtotals');
    expect(r.trigger_events).toEqual(['insert']);
  });
});

// -----------------------------------------------------------------------------
// Error / transaction constructs (shaping hard item 3)
// -----------------------------------------------------------------------------

describe('profileTsqlRoutine -- error and transaction semantics', () => {
  const insertOrders = profileTsqlRoutine(bodyNamed('Website.InsertCustomerOrders'));

  it('tags try_catch, xact_abort, transaction_control, table_variable, next_value_for and tvp READONLY usage', () => {
    expect(insertOrders.profile.constructs).toEqual(
      expect.arrayContaining([
        'try_catch',
        'throw',
        'xact_abort',
        'transaction_control',
        'table_variable',
        'next_value_for',
        'set_nocount',
      ]),
    );
    expect(insertOrders.profile.set_options).toEqual(
      expect.arrayContaining(['nocount on', 'xact_abort on']),
    );
  });

  it('records a bare re-THROW as an exit outcome with nothing invented', () => {
    const sites = insertOrders.profile.raiserror_sites;
    expect(sites.length).toBeGreaterThan(0);
    expect(sites[sites.length - 1]).toEqual({
      number: null,
      severity: null,
      text_preview: null,
    });
  });

  it('records an explicit THROW with its number and message, and NEVER a severity (its third argument is the STATE)', () => {
    const r = profileTsqlRoutine({
      name: 'Ledger.guard',
      objType: 'P',
      text:
        'CREATE PROC Ledger.guard @id int AS\nBEGIN\n' +
        "  IF @id IS NULL THROW 51000, N'ledger id required', 1;\n" +
        '  SELECT 1;\nEND;',
    });
    expect(r.profile.raiserror_sites).toEqual([
      { number: 51000, severity: null, text_preview: 'ledger id required' },
    ]);
  });

  it('tags trancount and save_tran', () => {
    const r = profileTsqlRoutine({
      name: 'Ledger.nested',
      objType: 'P',
      text:
        'CREATE PROC Ledger.nested AS\nBEGIN\n' +
        '  IF @@TRANCOUNT = 0 BEGIN TRAN;\n' +
        '  SAVE TRANSACTION before_post;\n' +
        '  UPDATE Ledger.Postings SET IsVoided = 1;\n' +
        '  COMMIT;\nEND;',
    });
    expect(r.profile.constructs).toEqual(
      expect.arrayContaining(['trancount', 'save_tran', 'transaction_control']),
    );
  });

  it('tags error_continuation only when nothing handles the failure', () => {
    // Fallible statement, more statements after it, no TRY/CATCH, no @@ERROR,
    // no XACT_ABORT ON -> the batch carries on half-applied.
    const bare = profileTsqlRoutine({
      name: 'Ledger.loose',
      objType: 'P',
      text:
        'CREATE PROC Ledger.loose AS\nBEGIN\n' +
        '  UPDATE Ledger.Postings SET IsVoided = 1;\n' +
        '  INSERT INTO Ledger.Audit (note) VALUES (N\'voided\');\n' +
        '  SELECT 1;\nEND;',
    });
    expect(bare.profile.constructs).toContain('error_continuation');
    // It is a HAZARD, not a compensation verdict.
    expect(bare.profile.non_compensatable_reasons).not.toContain('error_continuation');

    // TRY/CATCH makes the flow explicit.
    expect(insertOrders.profile.constructs).not.toContain('error_continuation');

    // The classic pre-TRY/CATCH idiom counts as handling it.
    const checked = profileTsqlRoutine({
      name: 'Ledger.checked',
      objType: 'P',
      text:
        'CREATE PROC Ledger.checked AS\nBEGIN\n' +
        '  UPDATE Ledger.Postings SET IsVoided = 1;\n' +
        '  IF @@ERROR <> 0 RETURN -1;\n' +
        '  SELECT 1;\nEND;',
    });
    expect(checked.profile.constructs).not.toContain('error_continuation');

    // XACT_ABORT ON turns an error into a batch abort.
    const aborting = profileTsqlRoutine({
      name: 'Ledger.aborting',
      objType: 'P',
      text:
        'CREATE PROC Ledger.aborting AS\nBEGIN\n' +
        '  SET XACT_ABORT ON;\n' +
        '  UPDATE Ledger.Postings SET IsVoided = 1;\n' +
        '  SELECT 1;\nEND;',
    });
    expect(aborting.profile.constructs).not.toContain('error_continuation');
  });
});

// -----------------------------------------------------------------------------
// Statement forms + cross-database detection
// -----------------------------------------------------------------------------

describe('profileTsqlRoutine -- SQL Server statement forms', () => {
  it('tags merge, output_clause, apply, offset_fetch, iif, try_convert and string_agg', () => {
    const r = profileTsqlRoutine({
      name: 'Ledger.report',
      objType: 'P',
      text:
        'CREATE PROC Ledger.report @page int AS\nBEGIN\n' +
        '  MERGE Ledger.Postings AS tgt USING Ledger.Staging AS src\n' +
        '  ON tgt.PostingID = src.PostingID\n' +
        "  WHEN NOT MATCHED THEN INSERT (PostedBy) VALUES (N'sync')\n" +
        '  OUTPUT inserted.PostingID INTO Ledger.Audit;\n' +
        '  SELECT p.PostingID,\n' +
        "         IIF(p.IsVoided = 1, N'voided', N'live') AS state,\n" +
        '         TRY_CONVERT(int, p.PostedBy) AS numeric_poster,\n' +
        "         STRING_AGG(p.PostedBy, N',') AS posters\n" +
        '  FROM Ledger.Postings AS p\n' +
        '  CROSS APPLY Ledger.fn_lines(p.PostingID) AS l\n' +
        '  ORDER BY p.PostingID\n' +
        '  OFFSET @page ROWS FETCH NEXT 50 ROWS ONLY;\nEND;',
    });
    expect(r.profile.constructs).toEqual(
      expect.arrayContaining([
        'merge',
        'output_clause',
        'apply',
        'offset_fetch',
        'iif',
        'try_convert',
        'string_agg',
      ]),
    );
  });

  it('tags for_system_time, contains_freetext and xml_method', () => {
    const r = profileTsqlRoutine({
      name: 'Ledger.history',
      objType: 'P',
      text:
        'CREATE PROC Ledger.history @at datetime2 AS\nBEGIN\n' +
        '  SELECT c.CustomerID,\n' +
        "         c.PayloadDocument.value('(/posting/@ref)[1]', 'nvarchar(40)') AS ref\n" +
        '  FROM Sales.Customers FOR SYSTEM_TIME AS OF @at AS c\n' +
        "  WHERE CONTAINS(c.CustomerName, N'ledger');\nEND;",
    });
    expect(r.profile.constructs).toEqual(
      expect.arrayContaining(['for_system_time', 'contains_freetext', 'xml_method']),
    );
  });

  it('tags a PARAMETERISED sp_executesql distinctly from raw dynamic SQL', () => {
    const parameterised = profileTsqlRoutine({
      name: 'Ledger.safe_dyn',
      objType: 'P',
      text:
        'CREATE PROC Ledger.safe_dyn @id int AS\nBEGIN\n' +
        "  EXEC sp_executesql N'SELECT * FROM Ledger.Postings WHERE PostingID = @p',\n" +
        "       N'@p int', @p = @id;\nEND;",
    });
    expect(parameterised.profile.constructs).toEqual(
      expect.arrayContaining(['dynamic_sql', 'sp_executesql_params']),
    );
    const raw = profileTsqlRoutine({
      name: 'Ledger.raw_dyn',
      objType: 'P',
      text: 'CREATE PROC Ledger.raw_dyn @sql nvarchar(max) AS\nBEGIN\n  EXEC (@sql);\nEND;',
    });
    expect(raw.profile.constructs).toContain('dynamic_sql');
    expect(raw.profile.constructs).not.toContain('sp_executesql_params');
  });

  it('tags three_part_name and openquery_linked, and both are in the cross-database set', () => {
    const r = profileTsqlRoutine(bodyNamed('Ledger.SyncFromWarehouse'));
    expect(r.profile.constructs).toEqual(
      expect.arrayContaining(['three_part_name', 'openquery_linked']),
    );
    expect(CROSS_DATABASE_CONSTRUCTS).toEqual(
      expect.arrayContaining(['three_part_name', 'openquery_linked']),
    );
    for (const tag of ['three_part_name', 'openquery_linked']) {
      expect(CROSS_DATABASE_CONSTRUCTS).toContain(tag);
    }
  });

  it('counts result-producing SELECTs and ignores the assignment form', () => {
    const r = profileTsqlRoutine(bodyNamed('Ledger.SyncFromWarehouse'));
    // `SELECT @RowsCopied = @@ROWCOUNT` is an assignment, not a result set.
    const lists = r.profile.result_selects.map((s) => s.select_list_static ?? '');
    expect(lists.every((l) => !/^@RowsCopied/.test(l))).toBe(true);
    expect(r.profile.max_result_sets).toBeGreaterThanOrEqual(2);
    expect(r.profile.result_selects.some((s) => s.has_top)).toBe(true);
    expect(r.profile.result_selects.some((s) => s.has_order_by)).toBe(true);
  });
});
