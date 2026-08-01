/**
 * Check-constraint expression portability (2026-08-01).
 *
 * The table-changeset emitter used to copy Sybase check expressions VERBATIM
 * into the PostgreSQL DDL, so any T-SQL built-in (getdate(), datalength(),
 * isdate(), string `+` concatenation ...) failed at schema-apply time.
 * Checks now go through `translateCheckExpression` -- the same conservative
 * token-walker discipline as computed columns: portable expressions emit
 * (with deterministic renames like getdate()->now(), len()->length());
 * non-portable ones are SKIPPED with a loud comment carrying the verbatim
 * source. Index column directions are guarded to ASC/DESC the same way.
 */

import { translateCheckExpression } from '../services/dbMigrationPack/typeMapping';
import {
  emitTableChangeset,
  emitIndexesChangeset,
  EmittableColumn,
} from '../services/dbMigrationPack/liquibase';
import { IrTable } from '../services/dbMigrationPack/types';

function makeTable(overrides: Partial<IrTable> = {}): IrTable {
  return {
    schemaName: 'dbo',
    tableName: 'trade',
    entityId: 'pde-1',
    physicalType: 'Table',
    objectType: 'table',
    columns: [],
    primaryKey: null,
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    estimatedRowCount: null,
    findingIds: [],
    ...overrides,
  };
}

function makeColumn(name: string, type = 'numeric(19,0)'): EmittableColumn {
  return {
    columnName: name,
    postgresType: type,
    isNullable: true,
    isIdentity: false,
    defaultExpression: null,
    generationExpression: null,
  };
}

describe('translateCheckExpression', () => {
  it('passes a plain comparison through unchanged', () => {
    const r = translateCheckExpression('qty > 0');
    expect(r).toEqual({ kind: 'translated', expression: 'qty > 0', changed: false });
  });

  it('keeps IN lists (keyword before paren is NOT a function call)', () => {
    const r = translateCheckExpression("status in ('A','B')");
    expect(r.kind).toBe('translated');
    if (r.kind === 'translated') {
      expect(r.expression).toBe("status in ('A', 'B')");
      expect(r.changed).toBe(false);
    }
  });

  it('rewrites getdate() to now()', () => {
    const r = translateCheckExpression('start_dt <= getdate()');
    expect(r).toEqual({
      kind: 'translated',
      expression: 'start_dt <= now()',
      changed: true,
    });
  });

  it('rewrites len() to length()', () => {
    const r = translateCheckExpression('len(code) = 8');
    expect(r).toEqual({ kind: 'translated', expression: 'length(code) = 8', changed: true });
  });

  it('allows numeric arithmetic with +', () => {
    const r = translateCheckExpression('a + b > 0');
    expect(r.kind).toBe('translated');
  });

  it('flags string + concatenation as non-portable', () => {
    const r = translateCheckExpression("first_name + last_name <> ''");
    expect(r.kind).toBe('non_portable');
  });

  it('flags unknown T-SQL built-ins as non-portable', () => {
    expect(translateCheckExpression('datalength(code) > 0').kind).toBe('non_portable');
    expect(translateCheckExpression('isdate(d) = 1').kind).toBe('non_portable');
    expect(translateCheckExpression("convert(varchar, x) = 'y'").kind).toBe('non_portable');
  });

  it('flags BETWEEN and boolean keywords as portable', () => {
    const r = translateCheckExpression('qty between 1 and 100 or qty is null');
    expect(r.kind).toBe('translated');
    if (r.kind === 'translated') {
      expect(r.expression).toBe('qty between 1 and 100 or qty is null');
    }
  });
});

describe('emitTableChangeset check-constraint handling', () => {
  const table = makeTable({
    checkConstraints: [
      { name: 'trade_qty_ck', expression: 'qty > 0' },
      { name: 'trade_dt_ck', expression: 'start_dt <= getdate()' },
      { name: 'trade_code_ck', expression: 'datalength(code) > 0' },
    ],
  });
  const ddl = emitTableChangeset({
    table,
    columns: [makeColumn('qty'), makeColumn('start_dt', 'timestamp'), makeColumn('code', 'text')],
    omitted: [],
    skipped: [],
  });

  it('emits portable checks verbatim', () => {
    expect(ddl).toContain('CONSTRAINT "trade_qty_ck" CHECK (qty > 0)');
  });

  it('emits rewritable checks with the deterministic rewrite + a note', () => {
    expect(ddl).toContain('CONSTRAINT "trade_dt_ck" CHECK (start_dt <= now())');
    expect(ddl).toContain('-- CHECK dbo.trade.trade_dt_ck: expression rewritten deterministically');
    // The T-SQL original survives only in the note comment, never as DDL.
    expect(ddl).not.toContain('CHECK (start_dt <= getdate())');
  });

  it('SKIPS non-portable checks with a loud comment carrying the verbatim source', () => {
    expect(ddl).not.toContain('CONSTRAINT "trade_code_ck"');
    expect(ddl).toContain(
      "-- SKIPPED CHECK dbo.trade.trade_code_ck: non-portable expression (function 'datalength')."
    );
    expect(ddl).toContain('Source (Sybase, verbatim): CHECK (datalength(code) > 0).');
  });
});

describe('emitIndexesChangeset direction guard', () => {
  it('normalises ASC/DESC and drops non-portable directives with a note', () => {
    const table = makeTable({
      indexes: [
        {
          name: 'trade_ix',
          columns: ['a', 'b', 'c'],
          isUnique: false,
          isClustered: false,
          columnDirections: ['asc', 'DBMS:HASH', 'DESC'],
          method: null,
          predicate: null,
        },
      ],
    });
    const { content } = emitIndexesChangeset({
      tables: [table],
      emittedTables: new Set(['dbo.trade']),
    });
    expect(content).toContain('CREATE INDEX "trade_ix" ON "dbo"."trade" ("a" ASC, "b", "c" DESC);');
    expect(content).toContain(
      "-- NOTE: index trade_ix: dropped non-portable column direction(s) 'DBMS:HASH' on b."
    );
  });
});
