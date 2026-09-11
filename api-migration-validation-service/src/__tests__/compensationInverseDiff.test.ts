/**
 * Inverse-diff + literal rendering tests (Capture-State Discipline Spec 1):
 * the derived undo of observed inserts/updates/deletes, identity wrapping and
 * reseed forms, composite-PK predicates, and engine-portable literals.
 */

import {
  buildInverseStatements,
  buildReseedStatements,
  computeRowDiff,
  hasChanges,
} from '../services/compensation/inverseDiff';
import { renderLiteral } from '../services/compensation/sqlLiterals';
import type { CompensationTableMeta, TableImage } from '../services/compensation/types';
import { pkKeyOf } from '../services/compensation/tableImage';

function imageOf(
  table: string,
  pkColumns: string[],
  rows: Array<Record<string, unknown>>,
): TableImage {
  const rowsByPk = new Map<string, Record<string, unknown>>();
  for (const row of rows) rowsByPk.set(pkKeyOf(row, pkColumns), row);
  return { table, pkColumns, rowsByPk, rowCount: rowsByPk.size };
}

const ORDERS_META: CompensationTableMeta = {
  table: 'orders',
  pkColumns: ['id'],
  columns: [
    { name: 'id', sourceType: 'int', isIdentity: true },
    { name: 'name', sourceType: 'varchar', isIdentity: false },
    { name: 'total', sourceType: 'numeric', isIdentity: false },
  ],
};

describe('computeRowDiff', () => {
  it('classifies inserted / deleted / updated rows by PK', () => {
    const before = imageOf('orders', ['id'], [
      { id: 1, name: 'a', total: '10.00' },
      { id: 2, name: 'b', total: '20.00' },
    ]);
    const after = imageOf('orders', ['id'], [
      { id: 2, name: 'b2', total: '20.00' },
      { id: 3, name: 'c', total: '30.00' },
    ]);
    const diff = computeRowDiff(before, after);
    expect(diff.inserted.map((r) => r.id)).toEqual([3]);
    expect(diff.deleted.map((r) => r.id)).toEqual([1]);
    expect(diff.updated.map((u) => u.after.name)).toEqual(['b2']);
    expect(hasChanges(diff)).toBe(true);
  });

  it('reports no changes for identical images', () => {
    const rows = [{ id: 1, name: 'a', total: '10.00' }];
    const diff = computeRowDiff(imageOf('orders', ['id'], rows), imageOf('orders', ['id'], rows));
    expect(hasChanges(diff)).toBe(false);
  });
});

describe('buildInverseStatements', () => {
  it('undoes an INSERT with a PK-tuple DELETE', () => {
    const before = imageOf('orders', ['id'], []);
    const after = imageOf('orders', ['id'], [{ id: 5, name: 'new', total: '1.00' }]);
    const { statements } = buildInverseStatements(
      computeRowDiff(before, after),
      ORDERS_META,
      'sybase',
    );
    expect(statements).toEqual(['DELETE FROM orders WHERE id = 5']);
  });

  it('undoes an UPDATE by restoring EVERY non-PK column from the before-image', () => {
    const before = imageOf('orders', ['id'], [{ id: 5, name: 'old', total: '1.00' }]);
    const after = imageOf('orders', ['id'], [{ id: 5, name: 'new', total: '2.00' }]);
    const { statements } = buildInverseStatements(
      computeRowDiff(before, after),
      ORDERS_META,
      'sybase',
    );
    expect(statements).toEqual(["UPDATE orders SET name = 'old', total = 1.00 WHERE id = 5"]);
  });

  it('undoes a DELETE with an identity-wrapped re-insert on Sybase', () => {
    const before = imageOf('orders', ['id'], [{ id: 5, name: 'gone', total: '9.99' }]);
    const after = imageOf('orders', ['id'], []);
    const { statements } = buildInverseStatements(
      computeRowDiff(before, after),
      ORDERS_META,
      'sybase',
    );
    expect(statements).toEqual([
      'SET IDENTITY_INSERT orders ON',
      "INSERT INTO orders (id, name, total) VALUES (5, 'gone', 9.99)",
      'SET IDENTITY_INSERT orders OFF',
    ]);
  });

  it('re-inserts WITHOUT the identity wrap on Postgres', () => {
    const before = imageOf('orders', ['id'], [{ id: 5, name: 'gone', total: '9.99' }]);
    const after = imageOf('orders', ['id'], []);
    const { statements } = buildInverseStatements(
      computeRowDiff(before, after),
      ORDERS_META,
      'postgres',
      'public',
    );
    expect(statements).toEqual([
      'INSERT INTO "public"."orders" (id, name, total) VALUES (5, \'gone\', 9.99)',
    ]);
  });

  it('leaves identity reseed to the runner (single reseed path by design)', () => {
    const before = imageOf('orders', ['id'], [{ id: 4, name: 'kept', total: '1.00' }]);
    const after = imageOf('orders', ['id'], [
      { id: 4, name: 'kept', total: '1.00' },
      { id: 5, name: 'new', total: '2.00' },
    ]);
    const inverse = buildInverseStatements(computeRowDiff(before, after), ORDERS_META, 'sybase');
    expect(inverse.statements).toEqual(['DELETE FROM orders WHERE id = 5']);
    expect('reseedStatements' in inverse).toBe(false);
  });

  it('supports composite PK predicates with NULL-aware terms', () => {
    const meta: CompensationTableMeta = {
      table: 'order_lines',
      pkColumns: ['order_id', 'line_no'],
      columns: [
        { name: 'order_id', sourceType: 'int', isIdentity: false },
        { name: 'line_no', sourceType: 'int', isIdentity: false },
        { name: 'sku', sourceType: 'varchar', isIdentity: false },
      ],
    };
    const before = imageOf('order_lines', ['order_id', 'line_no'], []);
    const after = imageOf('order_lines', ['order_id', 'line_no'], [
      { order_id: 1, line_no: 2, sku: 'A' },
    ]);
    const { statements } = buildInverseStatements(computeRowDiff(before, after), meta, 'sybase');
    expect(statements).toEqual(['DELETE FROM order_lines WHERE order_id = 1 AND line_no = 2']);
  });
});

describe('buildReseedStatements', () => {
  it('renders the Sybase identity_burn_max form', () => {
    expect(buildReseedStatements(ORDERS_META, 'id', 'sybase', null, 41)).toEqual([
      "EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '41'",
    ]);
  });
  it('renders the Postgres setval form, empty-table aware', () => {
    expect(buildReseedStatements(ORDERS_META, 'id', 'postgres', 'public', 41)).toEqual([
      "SELECT setval(pg_get_serial_sequence('public.orders', 'id'), 41, true)",
    ]);
    expect(buildReseedStatements(ORDERS_META, 'id', 'postgres', 'public', 0)).toEqual([
      "SELECT setval(pg_get_serial_sequence('public.orders', 'id'), 1, false)",
    ]);
  });
});

describe('renderLiteral', () => {
  it('renders NULL, numbers, booleans per engine, and quote-doubled strings', () => {
    expect(renderLiteral(null, 'sybase')).toBe('NULL');
    expect(renderLiteral(42, 'sybase')).toBe('42');
    expect(renderLiteral(true, 'sybase')).toBe('1');
    expect(renderLiteral(true, 'postgres')).toBe('TRUE');
    expect(renderLiteral("it's", 'sybase')).toBe("'it''s'");
  });

  it('emits numeric-typed string values RAW (sidecar wire carries numerics as strings)', () => {
    expect(renderLiteral('12345678901234567890', 'sybase', 'bigint')).toBe(
      '12345678901234567890',
    );
    expect(renderLiteral('10.50', 'sybase', 'numeric')).toBe('10.50');
    // ...but a NON-numeric string against a numeric hint stays quoted.
    expect(renderLiteral('n/a', 'sybase', 'numeric')).toBe("'n/a'");
    // ...and numeric-looking strings against text columns stay quoted.
    expect(renderLiteral('12345', 'sybase', 'varchar')).toBe("'12345'");
  });
});

describe('SQL Server engine (second-pair programme, Spec 4)', () => {
  it('renders the DBCC CHECKIDENT reseed form over bracket-qualified names', () => {
    expect(buildReseedStatements(ORDERS_META, 'id', 'mssql', 'dbo', 41)).toEqual([
      "DBCC CHECKIDENT ('[dbo].[orders]', RESEED, 41)",
    ]);
    expect(buildReseedStatements(ORDERS_META, 'id', 'mssql', null, 0)).toEqual([
      "DBCC CHECKIDENT ('[orders]', RESEED, 0)",
    ]);
  });

  it('renderLiteral: bit as 1/0, N-literals for national types, 0x for binary wire values', () => {
    expect(renderLiteral(true, 'mssql')).toBe('1');
    expect(renderLiteral("O'Hara", 'mssql', 'nvarchar(50)')).toBe("N'O''Hara'");
    expect(renderLiteral('plain', 'mssql', 'varchar(50)')).toBe("'plain'");
    expect(renderLiteral('\\xDEADbeef', 'mssql', 'varbinary(max)')).toBe('0xdeadbeef');
    expect(renderLiteral('42', 'mssql', 'bigint')).toBe('42');
  });
});
