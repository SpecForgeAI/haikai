/**
 * SQL-Server-only T-SQL constructs in the dialect classifier (second-pair
 * programme, Spec 6 §6.5). Pins:
 *   - each SQL-Server-only construct classifies the SQL as `tsql` and reports
 *     its construct name;
 *   - construct names line up with the SQL Server ruleset's construct_refs
 *     (seeds/guidance keyed by the same vocabulary);
 *   - ANSI `MERGE INTO … USING` stays `ansi` (portable to PostgreSQL 15+);
 *   - construct notes never name a specific source engine (pair-neutral text).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { classifySqlDialect } from '../services/findings/sqlDialectClassifier';

function constructsOf(sql: string): string[] {
  return classifySqlDialect(sql).non_portable_constructs.map((c) => c.construct);
}

describe('SQL-Server-only constructs', () => {
  const cases: Array<[string, string]> = [
    ['try_catch', 'BEGIN TRY INSERT INTO t (a) VALUES (1) END TRY BEGIN CATCH SELECT ERROR_NUMBER() END CATCH'],
    ['throw', "INSERT INTO t (a) VALUES (1); IF @@ROWCOUNT = 0 THROW 50001, 'none', 1"],
    ['xact_abort', 'SET XACT_ABORT ON; DELETE FROM t WHERE id = 1'],
    ['merge', 'MERGE t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a'],
    ['merge', 'MERGE TOP (10) INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE'],
    ['output_clause', 'INSERT INTO t (a) OUTPUT INSERTED.id VALUES (1)'],
    ['offset_fetch', 'SELECT a FROM t ORDER BY a OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY'],
    ['apply', 'SELECT * FROM t CROSS APPLY dbo.f(t.id) x'],
    ['iif', 'SELECT IIF(a > 1, 1, 0) FROM t'],
    ['try_convert', "SELECT TRY_CONVERT(int, a) FROM t"],
    ['try_convert', "SELECT TRY_CAST(a AS int) FROM t"],
    ['string_agg', "SELECT STRING_AGG(name, ',') WITHIN GROUP (ORDER BY name) FROM t"],
    ['sp_executesql_params', "EXEC sp_executesql @stmt, N'@p int', @p = 1"],
    ['next_value_for', 'INSERT INTO t (id) VALUES (NEXT VALUE FOR dbo.seq_t)'],
    ['scope_identity', 'INSERT INTO t (a) VALUES (1); SELECT SCOPE_IDENTITY()'],
    ['for_system_time', "SELECT * FROM t FOR SYSTEM_TIME AS OF '2026-01-01'"],
    ['contains_freetext', "SELECT * FROM t WHERE CONTAINS(body, 'blue AND sky')"],
    ['xml_method', "SELECT x.value('(/r/a)[1]', 'int') FROM t"],
    ['datetimeoffset_fn', "SELECT SWITCHOFFSET(created, '+00:00') FROM t"],
    ['format_fn', "SELECT FORMAT(amount, 'N2') FROM t"],
    ['bracket_identifier', 'SELECT [Order Id] FROM [dbo].[Orders]'],
    ['sysutcdatetime', 'SELECT SYSUTCDATETIME() FROM t'],
  ];

  for (const [construct, sql] of cases) {
    it(`${construct}: classifies as tsql and reports the construct`, () => {
      const result = classifySqlDialect(sql);
      expect(result.dialect).toBe('tsql');
      expect(result.non_portable_constructs.map((c) => c.construct)).toContain(construct);
    });
  }

  it('ANSI MERGE INTO … USING stays ansi (portable to PostgreSQL 15+)', () => {
    expect(classifySqlDialect('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a').dialect).toBe('ansi');
  });

  it('plain ANSI SQL is untouched by the new families', () => {
    expect(constructsOf('SELECT a, b FROM t WHERE id = 1 ORDER BY a')).toEqual([]);
    expect(classifySqlDialect('SELECT a FROM t').dialect).toBe('ansi');
  });

  it('construct notes are pair-neutral (no source engine named)', () => {
    const all = cases.map(([, sql]) => classifySqlDialect(sql).non_portable_constructs).flat();
    for (const c of all) {
      expect(c.note).not.toMatch(/sybase|sql server/i);
    }
  });

  it('the SQL Server ruleset seeds every classifier construct it references', () => {
    const rulesetPath = join(__dirname, '..', '..', '..', 'migration-pairs', 'sqlserver16-postgres18.rules.json');
    if (!existsSync(rulesetPath)) {
      console.warn('migration-pairs not checked out next to discovery-service; skipping');
      return;
    }
    const ruleset = JSON.parse(readFileSync(rulesetPath, 'utf8')) as { construct_refs: Array<{ construct: string }> };
    const seeded = new Set(ruleset.construct_refs.map((r) => r.construct));
    for (const construct of ['try_catch', 'throw', 'xact_abort', 'merge', 'output_clause', 'offset_fetch', 'apply', 'iif', 'try_convert', 'string_agg', 'sp_executesql_params', 'next_value_for', 'scope_identity', 'for_system_time', 'contains_freetext', 'xml_method']) {
      expect(seeded.has(construct)).toBe(true);
    }
  });
});
