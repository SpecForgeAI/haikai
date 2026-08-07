/**
 * Schema-scoped relation-name resolution (2026-08-06).
 *
 * Sybase scopes constraint/index names per TABLE; Postgres backs PK/UNIQUE
 * constraints with indexes, which are per-SCHEMA relations (one namespace
 * shared with tables and other indexes). The generator used to reproduce
 * source names verbatim, so a copied table (`temp_hir_book`) carrying its
 * original's auto-generated `hir_book_ak1` failed the FIRST clean
 * schema-apply with `relation "hir_book_ak1" already exists` (live
 * 2026-08-06). Colliders now rename deterministically to `<table>_<name>`
 * (63-byte clamped), the renames are carried as provenance, and the
 * pack-validation gate independently refuses any pack whose relation
 * namespace still collides. FK/CHECK names stay verbatim — pg_constraint
 * scopes them per table, exactly like Sybase.
 */

import {
  emitIndexesChangeset,
  emitTableChangeset,
  resolveRelationNames,
  EmittableColumn,
} from '../services/dbMigrationPack/liquibase';
import { validatePackFiles } from '../services/dbMigrationPack/packValidation';
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

function makeColumn(name: string): EmittableColumn {
  return {
    columnName: name,
    postgresType: 'numeric(19,0)',
    isNullable: true,
    isIdentity: false,
    defaultExpression: null,
    generationExpression: null,
  };
}

/** The live 2026-08-06 collision pair: a table and its temp_ copy. */
function hirBookPair(): IrTable[] {
  const constraint = {
    name: 'hir_book_ak1',
    columns: ['ValidTo', 'HierarchyId', 'ValidFrom'],
  };
  return [
    makeTable({ tableName: 'hir_book', uniqueConstraints: [{ ...constraint }] }),
    makeTable({ tableName: 'temp_hir_book', uniqueConstraints: [{ ...constraint }] }),
  ];
}

describe('resolveRelationNames', () => {
  it('the lexicographically-first table keeps its source name; the copy renames to <table>_<name>', () => {
    const resolved = resolveRelationNames(hirBookPair());
    expect(resolved.nameFor('dbo', 'hir_book', 'hir_book_ak1')).toBe('hir_book_ak1');
    expect(resolved.nameFor('dbo', 'temp_hir_book', 'hir_book_ak1')).toBe(
      'temp_hir_book_hir_book_ak1'
    );
    expect(resolved.renames).toEqual([
      {
        schemaName: 'dbo',
        tableName: 'temp_hir_book',
        kind: 'unique_constraint',
        from: 'hir_book_ak1',
        to: 'temp_hir_book_hir_book_ak1',
      },
    ]);
  });

  it('is deterministic regardless of input table order', () => {
    const forward = resolveRelationNames(hirBookPair());
    const reversed = resolveRelationNames(hirBookPair().reverse());
    expect(reversed.renames).toEqual(forward.renames);
    expect(reversed.nameFor('dbo', 'hir_book', 'hir_book_ak1')).toBe('hir_book_ak1');
  });

  it('non-colliding names emit verbatim with zero renames', () => {
    const resolved = resolveRelationNames([
      makeTable({
        tableName: 'orders',
        primaryKey: { name: 'orders_pk', columns: ['id'] },
        uniqueConstraints: [{ name: 'orders_ak1', columns: ['ref'] }],
        indexes: [
          { name: 'orders_ix1', columns: ['ref'], isUnique: false, isClustered: false, columnDirections: null, method: null, predicate: null },
        ],
      }),
    ]);
    expect(resolved.renames).toEqual([]);
    expect(resolved.nameFor('dbo', 'orders', 'orders_pk')).toBe('orders_pk');
  });

  it('a constraint named like a TABLE collides too (tables share the relation namespace)', () => {
    const resolved = resolveRelationNames([
      makeTable({ tableName: 'audit_log' }),
      makeTable({
        tableName: 'orders',
        uniqueConstraints: [{ name: 'audit_log', columns: ['id'] }],
      }),
    ]);
    expect(resolved.nameFor('dbo', 'orders', 'audit_log')).toBe('orders_audit_log');
  });

  it('same name in DIFFERENT schemas never renames (per-schema namespaces)', () => {
    const resolved = resolveRelationNames([
      makeTable({ schemaName: 'dbo', tableName: 'hir_book', uniqueConstraints: [{ name: 'ak1', columns: ['a'] }] }),
      makeTable({ schemaName: 'ref', tableName: 'hir_book', uniqueConstraints: [{ name: 'ak1', columns: ['a'] }] }),
    ]);
    expect(resolved.renames).toEqual([]);
  });

  it('PK and index names participate in the same namespace as unique constraints', () => {
    const resolved = resolveRelationNames([
      makeTable({ tableName: 'a_tbl', primaryKey: { name: 'shared_name', columns: ['id'] } }),
      makeTable({
        tableName: 'b_tbl',
        indexes: [
          { name: 'shared_name', columns: ['x'], isUnique: false, isClustered: false, columnDirections: null, method: null, predicate: null },
        ],
      }),
    ]);
    expect(resolved.nameFor('dbo', 'a_tbl', 'shared_name')).toBe('shared_name');
    expect(resolved.nameFor('dbo', 'b_tbl', 'shared_name')).toBe('b_tbl_shared_name');
    expect(resolved.renames[0].kind).toBe('index');
  });

  it('clamps renamed identifiers to 63 bytes with a stable hash suffix (no truncation collisions)', () => {
    const longName = 'a'.repeat(60);
    const resolved = resolveRelationNames([
      makeTable({ tableName: 'x_first_very_long_table_name', uniqueConstraints: [{ name: longName, columns: ['a'] }] }),
      makeTable({ tableName: 'y_second_very_long_table_name', uniqueConstraints: [{ name: longName, columns: ['a'] }] }),
      makeTable({ tableName: 'z_third_very_long_table_name', uniqueConstraints: [{ name: longName, columns: ['a'] }] }),
    ]);
    const emitted = [
      resolved.nameFor('dbo', 'x_first_very_long_table_name', longName),
      resolved.nameFor('dbo', 'y_second_very_long_table_name', longName),
      resolved.nameFor('dbo', 'z_third_very_long_table_name', longName),
    ];
    expect(new Set(emitted).size).toBe(3); // all distinct...
    for (const name of emitted) {
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(63); // ...and Postgres-safe
    }
  });
});

describe('emitters apply resolved names', () => {
  it('emitTableChangeset emits the renamed UNIQUE constraint + a RENAMED provenance comment', () => {
    const tables = hirBookPair();
    const relationNames = resolveRelationNames(tables);
    const ddl = emitTableChangeset({
      table: tables[1], // temp_hir_book
      columns: [makeColumn('ValidTo'), makeColumn('HierarchyId'), makeColumn('ValidFrom')],
      omitted: [],
      skipped: [],
      relationNames,
    });
    expect(ddl).toContain(
      'CONSTRAINT "temp_hir_book_hir_book_ak1" UNIQUE ("ValidTo", "HierarchyId", "ValidFrom")'
    );
    expect(ddl).not.toContain('CONSTRAINT "hir_book_ak1"');
    expect(ddl).toContain(
      "-- RENAMED UNIQUE constraint 'hir_book_ak1' -> 'temp_hir_book_hir_book_ak1'"
    );
  });

  it('the ORIGINAL table still emits its source name verbatim, no comment', () => {
    const tables = hirBookPair();
    const relationNames = resolveRelationNames(tables);
    const ddl = emitTableChangeset({
      table: tables[0], // hir_book
      columns: [makeColumn('ValidTo'), makeColumn('HierarchyId'), makeColumn('ValidFrom')],
      omitted: [],
      skipped: [],
      relationNames,
    });
    expect(ddl).toContain('CONSTRAINT "hir_book_ak1" UNIQUE');
    expect(ddl).not.toContain('-- RENAMED');
  });

  it('emitIndexesChangeset renames colliding index names and points the CLUSTER hint at the emitted name', () => {
    const original = makeTable({
      tableName: 'hir_book',
      indexes: [
        { name: 'hir_book_ix1', columns: ['a'], isUnique: false, isClustered: false, columnDirections: null, method: null, predicate: null },
      ],
    });
    const copy = makeTable({
      tableName: 'temp_hir_book',
      indexes: [
        { name: 'hir_book_ix1', columns: ['a'], isUnique: false, isClustered: true, columnDirections: null, method: null, predicate: null },
      ],
    });
    const relationNames = resolveRelationNames([original, copy]);
    const { content } = emitIndexesChangeset({
      tables: [original, copy],
      emittedTables: new Set(['dbo.hir_book', 'dbo.temp_hir_book']),
      relationNames,
    });
    expect(content).toContain('CREATE INDEX "hir_book_ix1" ON "dbo"."hir_book"');
    expect(content).toContain(
      'CREATE INDEX "temp_hir_book_hir_book_ix1" ON "dbo"."temp_hir_book"'
    );
    expect(content).toContain("-- RENAMED index 'hir_book_ix1' -> 'temp_hir_book_hir_book_ix1'");
    expect(content).toContain('USING "temp_hir_book_hir_book_ix1";');
  });
});

describe('validatePackFiles relation-namespace backstop', () => {
  const master = {
    filePath: 'liquibase/db.changelog-master.xml',
    content:
      '<?xml version="1.0" encoding="UTF-8"?>\n<databaseChangeLog\n' +
      '    xmlns="http://www.liquibase.org/xml/ns/dbchangelog">\n</databaseChangeLog>\n',
  };

  function tableFile(table: string, constraint: string): { filePath: string; content: string } {
    return {
      filePath: `liquibase/changesets/010-tables/dbo.${table}.sql`,
      content:
        `--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/dbo.${table}.sql\n` +
        `--changeset db-migration-pack:table-dbo.${table} context:structural splitStatements:false\n` +
        `CREATE TABLE "dbo"."${table}" (\n` +
        `    "id" numeric(19,0),\n` +
        `    CONSTRAINT "${constraint}" UNIQUE ("id")\n` +
        `);\n`,
    };
  }

  it('refuses a pack where two tables declare the same UNIQUE constraint name in one schema', () => {
    const problems = validatePackFiles([
      master,
      tableFile('hir_book', 'hir_book_ak1'),
      tableFile('temp_hir_book', 'hir_book_ak1'),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('relation name "hir_book_ak1" is declared by both');
    expect(problems[0]).toContain('already exists');
  });

  it('refuses an index name colliding with a constraint name', () => {
    const indexes = {
      filePath: 'liquibase/changesets/030-indexes.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/030-indexes.sql\n' +
        '--changeset db-migration-pack:indexes context:post-load splitStatements:false\n' +
        'CREATE INDEX "hir_book_ak1" ON "dbo"."other_tbl" ("x");\n',
    };
    const problems = validatePackFiles([master, tableFile('hir_book', 'hir_book_ak1'), indexes]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"hir_book_ak1"');
  });

  it('accepts distinct names, and the SAME name across different schemas', () => {
    const otherSchema = {
      filePath: 'liquibase/changesets/010-tables/ref.hir_book.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/ref.hir_book.sql\n' +
        '--changeset db-migration-pack:table-ref.hir_book context:structural splitStatements:false\n' +
        'CREATE TABLE "ref"."hir_book" (\n' +
        '    "id" numeric(19,0),\n' +
        '    CONSTRAINT "hir_book_ak1" UNIQUE ("id")\n' +
        ');\n',
    };
    const problems = validatePackFiles([
      master,
      tableFile('hir_book', 'hir_book_ak1'),
      tableFile('temp_hir_book', 'temp_hir_book_hir_book_ak1'),
      otherSchema,
    ]);
    expect(problems).toEqual([]);
  });
});
