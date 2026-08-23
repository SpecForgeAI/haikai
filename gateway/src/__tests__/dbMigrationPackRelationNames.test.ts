/**
 * Schema-scoped relation-name resolution (2026-08-06).
 *
 * Sybase scopes constraint/index names per TABLE; Postgres backs PK/UNIQUE
 * constraints with indexes, which are per-SCHEMA relations (one namespace
 * shared with tables and other indexes). The generator used to reproduce
 * source names verbatim, so a copied table (`temp_deal_book`) carrying its
 * original's auto-generated `deal_book_ak1` failed the FIRST clean
 * schema-apply with `relation "deal_book_ak1" already exists` (live
 * 2026-08-06). Colliders now rename deterministically to `<table>_<name>`
 * (63-byte clamped), the renames are carried as provenance, and the
 * pack-validation gate independently refuses any pack whose relation
 * namespace still collides. FK/CHECK names stay verbatim — pg_constraint
 * scopes them per table, exactly like Sybase.
 */

import {
  emitIndexesChangeset,
  emitTableChangeset,
  foreignKeyName,
  resolveRelationNames,
  EmittableColumn,
} from '../services/dbMigrationPack/liquibase';
import { validatePackFiles } from '../services/dbMigrationPack/packValidation';
import { IrForeignKey, IrTable } from '../services/dbMigrationPack/types';

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
    name: 'deal_book_ak1',
    columns: ['ValidTo', 'HierarchyId', 'ValidFrom'],
  };
  return [
    makeTable({ tableName: 'deal_book', uniqueConstraints: [{ ...constraint }] }),
    makeTable({ tableName: 'temp_deal_book', uniqueConstraints: [{ ...constraint }] }),
  ];
}

describe('resolveRelationNames', () => {
  it('the lexicographically-first table keeps its source name; the copy renames to <table>_<name>', () => {
    const resolved = resolveRelationNames(hirBookPair());
    expect(resolved.nameFor('dbo', 'deal_book', 'deal_book_ak1')).toBe('deal_book_ak1');
    expect(resolved.nameFor('dbo', 'temp_deal_book', 'deal_book_ak1')).toBe(
      'temp_deal_book_deal_book_ak1'
    );
    expect(resolved.renames).toEqual([
      {
        schemaName: 'dbo',
        tableName: 'temp_deal_book',
        kind: 'unique_constraint',
        from: 'deal_book_ak1',
        to: 'temp_deal_book_deal_book_ak1',
      },
    ]);
  });

  it('is deterministic regardless of input table order', () => {
    const forward = resolveRelationNames(hirBookPair());
    const reversed = resolveRelationNames(hirBookPair().reverse());
    expect(reversed.renames).toEqual(forward.renames);
    expect(reversed.nameFor('dbo', 'deal_book', 'deal_book_ak1')).toBe('deal_book_ak1');
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
      makeTable({ schemaName: 'dbo', tableName: 'deal_book', uniqueConstraints: [{ name: 'ak1', columns: ['a'] }] }),
      makeTable({ schemaName: 'ref', tableName: 'deal_book', uniqueConstraints: [{ name: 'ak1', columns: ['a'] }] }),
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

describe('foreignKeyName (per-table pg_constraint scope)', () => {
  function makeFk(overrides: Partial<IrForeignKey> = {}): IrForeignKey {
    return {
      relationshipId: 'rel-1',
      fromSchema: 'dbo',
      fromTable: 'orders',
      toSchema: 'dbo',
      toTable: 'customers',
      joinColumns: ['customer_id'],
      referencedColumns: ['customer_id'],
      onDelete: null,
      onUpdate: null,
      ...overrides,
    };
  }

  it('folds both schemas in — same-named parents in different schemas derive DISTINCT names', () => {
    const toDbo = foreignKeyName(makeFk());
    const toArch = foreignKeyName(makeFk({ toSchema: 'arch' }));
    expect(toDbo).toBe('fk_dbo_orders__dbo_customers__customer_id');
    expect(toArch).toBe('fk_dbo_orders__arch_customers__customer_id');
    expect(toDbo).not.toBe(toArch);
  });

  it('appends referenced columns ONLY when they differ from the join columns', () => {
    expect(foreignKeyName(makeFk())).not.toContain('__ref_');
    const variant = foreignKeyName(makeFk({ referencedColumns: ['id'] }));
    expect(variant).toBe('fk_dbo_orders__dbo_customers__customer_id__ref_id');
    expect(variant).not.toBe(foreignKeyName(makeFk()));
  });

  it('clamps long derived names to 63 bytes, keeping distinct FKs distinct', () => {
    const longA = foreignKeyName(
      makeFk({ fromTable: 'a'.repeat(40), toTable: 'b'.repeat(40) })
    );
    const longB = foreignKeyName(
      makeFk({ fromTable: 'a'.repeat(40), toTable: 'b'.repeat(40), toSchema: 'arch' })
    );
    expect(Buffer.byteLength(longA, 'utf8')).toBeLessThanOrEqual(63);
    expect(Buffer.byteLength(longB, 'utf8')).toBeLessThanOrEqual(63);
    expect(longA).not.toBe(longB);
  });
});

describe('emitters apply resolved names', () => {
  it('emitTableChangeset emits the renamed UNIQUE constraint + a RENAMED provenance comment', () => {
    const tables = hirBookPair();
    const relationNames = resolveRelationNames(tables);
    const ddl = emitTableChangeset({
      table: tables[1], // temp_deal_book
      columns: [makeColumn('ValidTo'), makeColumn('HierarchyId'), makeColumn('ValidFrom')],
      omitted: [],
      skipped: [],
      relationNames,
    });
    expect(ddl).toContain(
      'CONSTRAINT "temp_deal_book_deal_book_ak1" UNIQUE ("ValidTo", "HierarchyId", "ValidFrom")'
    );
    expect(ddl).not.toContain('CONSTRAINT "deal_book_ak1"');
    expect(ddl).toContain(
      "-- RENAMED UNIQUE constraint 'deal_book_ak1' -> 'temp_deal_book_deal_book_ak1'"
    );
  });

  it('the ORIGINAL table still emits its source name verbatim, no comment', () => {
    const tables = hirBookPair();
    const relationNames = resolveRelationNames(tables);
    const ddl = emitTableChangeset({
      table: tables[0], // deal_book
      columns: [makeColumn('ValidTo'), makeColumn('HierarchyId'), makeColumn('ValidFrom')],
      omitted: [],
      skipped: [],
      relationNames,
    });
    expect(ddl).toContain('CONSTRAINT "deal_book_ak1" UNIQUE');
    expect(ddl).not.toContain('-- RENAMED');
  });

  it('emitIndexesChangeset renames colliding index names and points the CLUSTER hint at the emitted name', () => {
    const original = makeTable({
      tableName: 'deal_book',
      indexes: [
        { name: 'deal_book_ix1', columns: ['a'], isUnique: false, isClustered: false, columnDirections: null, method: null, predicate: null },
      ],
    });
    const copy = makeTable({
      tableName: 'temp_deal_book',
      indexes: [
        { name: 'deal_book_ix1', columns: ['a'], isUnique: false, isClustered: true, columnDirections: null, method: null, predicate: null },
      ],
    });
    const relationNames = resolveRelationNames([original, copy]);
    const { content } = emitIndexesChangeset({
      tables: [original, copy],
      emittedTables: new Set(['dbo.deal_book', 'dbo.temp_deal_book']),
      relationNames,
    });
    expect(content).toContain('CREATE INDEX "deal_book_ix1" ON "dbo"."deal_book"');
    expect(content).toContain(
      'CREATE INDEX "temp_deal_book_deal_book_ix1" ON "dbo"."temp_deal_book"'
    );
    expect(content).toContain("-- RENAMED index 'deal_book_ix1' -> 'temp_deal_book_deal_book_ix1'");
    expect(content).toContain('USING "temp_deal_book_deal_book_ix1";');
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
      tableFile('deal_book', 'deal_book_ak1'),
      tableFile('temp_deal_book', 'deal_book_ak1'),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('relation name "deal_book_ak1" is declared by both');
    expect(problems[0]).toContain('already exists');
  });

  it('refuses two INDEXES sharing one name in a schema (the live 2026-08-07 temp-table shape — index-vs-index, no CONSTRAINT keyword involved)', () => {
    const indexes = {
      filePath: 'liquibase/changesets/030-indexes.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/030-indexes.sql\n' +
        '--changeset db-migration-pack:indexes context:post-load splitStatements:false\n' +
        'CREATE INDEX "deal_book_ie3" ON "dbo"."deal_book" ("a");\n' +
        'CREATE INDEX "deal_book_ie3" ON "dbo"."temp_deal_book" ("a");\n',
    };
    const problems = validatePackFiles([master, indexes]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('relation name "deal_book_ie3" is declared by both');
  });

  it('refuses an index name colliding with a constraint name', () => {
    const indexes = {
      filePath: 'liquibase/changesets/030-indexes.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/030-indexes.sql\n' +
        '--changeset db-migration-pack:indexes context:post-load splitStatements:false\n' +
        'CREATE INDEX "deal_book_ak1" ON "dbo"."other_tbl" ("x");\n',
    };
    const problems = validatePackFiles([master, tableFile('deal_book', 'deal_book_ak1'), indexes]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"deal_book_ak1"');
  });

  it('refuses an identifier over Postgres\'s 63-byte truncation limit, naming it', () => {
    const longName = 'l'.repeat(70);
    const problems = validatePackFiles([master, tableFile('deal_book', longName)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('70 bytes');
    expect(problems[0]).toContain('truncates');
    // Exactly 63 bytes is fine.
    expect(validatePackFiles([master, tableFile('deal_book', 'k'.repeat(63))])).toEqual([]);
  });

  it('refuses a duplicate constraint name on ONE table (per-table pg_constraint scope)', () => {
    const twoChecksSameName = {
      filePath: 'liquibase/changesets/010-tables/dbo.trade.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/dbo.trade.sql\n' +
        '--changeset db-migration-pack:table-dbo.trade context:structural splitStatements:false\n' +
        'CREATE TABLE "dbo"."trade" (\n' +
        '    "id" numeric(19,0),\n' +
        '    CONSTRAINT "trade_ck" CHECK (id > 0),\n' +
        '    CONSTRAINT "trade_ck" CHECK (id < 100)\n' +
        ');\n',
    };
    const problems = validatePackFiles([master, twoChecksSameName]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('constraint name "trade_ck" is declared twice');
  });

  it('refuses duplicate FK constraint names landing on one child table via ALTER TABLE', () => {
    const fks = {
      filePath: 'liquibase/changesets/020-foreign-keys.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/020-foreign-keys.sql\n' +
        '--changeset db-migration-pack:foreign-keys context:post-load splitStatements:false\n' +
        'ALTER TABLE "dbo"."orders" ADD CONSTRAINT "fk_same" FOREIGN KEY ("a") REFERENCES "dbo"."x" ("a");\n' +
        'ALTER TABLE "dbo"."orders" ADD CONSTRAINT "fk_same" FOREIGN KEY ("a") REFERENCES "ref"."x" ("a");\n',
    };
    const problems = validatePackFiles([master, fks]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"fk_same" is declared twice');
  });

  it('claims CREATE VIEW names in the relation namespace (spec-2 future-proofing)', () => {
    const view = {
      filePath: 'liquibase/changesets/050-views.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/050-views.sql\n' +
        '--changeset db-migration-pack:views context:post-load splitStatements:false\n' +
        'CREATE VIEW "dbo"."deal_book" AS SELECT 1;\n',
    };
    const problems = validatePackFiles([master, tableFile('deal_book', 'deal_book_ak1'), view]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('relation name "deal_book" is declared by both');
  });

  it('accepts distinct names, and the SAME name across different schemas', () => {
    const otherSchema = {
      filePath: 'liquibase/changesets/010-tables/ref.deal_book.sql',
      content:
        '--liquibase formatted sql logicalFilePath:liquibase/changesets/010-tables/ref.deal_book.sql\n' +
        '--changeset db-migration-pack:table-ref.deal_book context:structural splitStatements:false\n' +
        'CREATE TABLE "ref"."deal_book" (\n' +
        '    "id" numeric(19,0),\n' +
        '    CONSTRAINT "deal_book_ak1" UNIQUE ("id")\n' +
        ');\n',
    };
    const problems = validatePackFiles([
      master,
      tableFile('deal_book', 'deal_book_ak1'),
      tableFile('temp_deal_book', 'temp_deal_book_deal_book_ak1'),
      otherSchema,
    ]);
    expect(problems).toEqual([]);
  });
});
