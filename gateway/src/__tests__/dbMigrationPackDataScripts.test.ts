/**
 * Tests for the data migration pack generator (Group 3).
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack — Task 3.1.
 *
 * Covers EXACTLY the five spec'd concerns:
 *   (a) bulk scripts per table in FK-topological order with mapping-aligned
 *       type-cast SELECT expressions and a COPY ... FROM STDIN template;
 *   (b) generated columns excluded from COPY column lists; identity columns
 *       documented with OVERRIDING SYSTEM VALUE in the header;
 *   (c) delta-key detection — identity -> insert-only, updated_at-family
 *       timestamp -> upsert, identity preferred when both exist, neither ->
 *       `delta_key` needs_decision with the three options;
 *   (d) incremental scripts parameterised by :last_high_water with delta key
 *       + strategy stated in the header;
 *   (e) the bulk manifest states the five-phase ordering and the
 *       DELETE-propagation exclusion (full-reload tables noted as the
 *       delete-catching mechanism).
 *
 * The data pack generates in the SAME pipeline run as the schema pack, so
 * these tests drive the shared pure core (`buildDbMigrationPackArtifacts`).
 */

import {
  buildDbMigrationPackArtifacts,
} from '../services/dbMigrationPackHandler';
import {
  DELETE_PROPAGATION_STATEMENT,
  detectDeltaKey,
  FIVE_PHASE_ORDERING,
} from '../services/dbMigrationPack/dataScripts';
import { IrColumn, IrTable, SourceSchemaIr } from '../services/dbMigrationPack/types';

// ---------------------------------------------------------------------------
// IR fixture builders (the data pack consumes the Group 2 IR directly)
// ---------------------------------------------------------------------------

function makeColumn(
  table: { schemaName: string; tableName: string; entityId: string },
  name: string,
  dataType: string,
  overrides: Partial<IrColumn> = {}
): IrColumn {
  return {
    schemaName: table.schemaName,
    tableName: table.tableName,
    columnName: name,
    dataType,
    maxLength: null,
    scale: null,
    precision: null,
    isNullable: true,
    isPrimaryKey: false,
    defaultExpression: null,
    ordinalPosition: 0,
    isIdentity: false,
    collation: null,
    collationCaseInsensitive: false,
    isGenerated: false,
    generationExpression: null,
    nonPortableDefault: null,
    attributeId: `attr-${table.tableName}-${name}`,
    entityId: table.entityId,
    findingIds: [],
    ...overrides,
  };
}

function makeTable(
  schemaName: string,
  tableName: string,
  columnSpecs: Array<{ name: string; dataType: string; overrides?: Partial<IrColumn> }>,
  overrides: Partial<IrTable> = {}
): IrTable {
  const ref = { schemaName, tableName, entityId: `entity-${tableName}` };
  const table: IrTable = {
    schemaName,
    tableName,
    entityId: ref.entityId,
    physicalType: 'table',
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
  table.columns = columnSpecs.map((c, i) =>
    makeColumn(ref, c.name, c.dataType, { ordinalPosition: i + 1, ...(c.overrides ?? {}) })
  );
  return table;
}

function makeIr(tables: IrTable[], overrides: Partial<SourceSchemaIr> = {}): SourceSchemaIr {
  return {
    sourceEngine: 'sybase_ase',
    targetEngine: 'postgresql',
    tables,
    foreignKeys: [],
    sequences: [],
    untranslated: [],
    dbDecisions: [{ decisionCode: 'db.engine', answerValue: 'PostgreSQL' }],
    resolvedDecisions: {},
    ...overrides,
  };
}

function fileByPath(files: Array<{ filePath: string; content: string }>, path: string): string {
  const f = files.find((x) => x.filePath === path);
  if (!f) {
    throw new Error(`expected file ${path} not generated; got ${files.map((x) => x.filePath).join(', ')}`);
  }
  return f.content;
}

describe('dbMigrationPack data scripts (Group 3)', () => {
  // (a) -----------------------------------------------------------------
  it('emits per-table bulk scripts in FK-topological order with mapping-aligned casts and a COPY FROM STDIN template', () => {
    const customers = makeTable('dbo', 'customers', [
      { name: 'customer_id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'balance', dataType: 'money', overrides: { isNullable: false } },
      { name: 'created_at', dataType: 'datetime' },
    ], {
      primaryKey: { name: 'pk_customers', columns: ['customer_id'] },
      estimatedRowCount: 1200,
    });
    const orders = makeTable('dbo', 'orders', [
      { name: 'order_id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'customer_id', dataType: 'int', overrides: { isNullable: false } },
    ], { primaryKey: { name: 'pk_orders', columns: ['order_id'] } });

    const ir = makeIr([orders, customers], {
      // orders -> customers FK, so customers MUST load first even though the
      // tables array lists orders first.
      foreignKeys: [
        {
          relationshipId: 'rel-1',
          fromSchema: 'dbo',
          fromTable: 'orders',
          toSchema: 'dbo',
          toTable: 'customers',
          joinColumns: ['customer_id'],
          referencedColumns: ['customer_id'],
          onDelete: 'CASCADE',
          onUpdate: null,
        },
      ],
      // High-water findings so the identity seeds don't raise decisions here.
      sequences: [
        { schemaName: 'dbo', sequenceName: 's1', currentValue: '10', currentValueAvailable: true, startValue: null, ownedByTable: 'customers', ownedByColumn: 'customer_id', findingIds: [] },
        { schemaName: 'dbo', sequenceName: 's2', currentValue: '20', currentValueAvailable: true, startValue: null, ownedByTable: 'orders', ownedByColumn: 'order_id', findingIds: [] },
      ],
    });
    const artifacts = buildDbMigrationPackArtifacts(ir);

    // FK-topological: customers is bulk position 001, orders 002.
    const customersBulk = fileByPath(artifacts.files, 'data/bulk/001-dbo.customers.sql');
    const ordersBulk = fileByPath(artifacts.files, 'data/bulk/002-dbo.orders.sql');
    expect(artifacts.manifest.bulk_load.table_order).toEqual(['dbo.customers', 'dbo.orders']);
    expect(artifacts.manifest.bulk_load.expected_row_counts['dbo.customers']).toBe(1200);

    // Mapping-aligned cast expressions in the Sybase extract.
    expect(customersBulk).toContain('convert(numeric(19,4), balance) AS balance');
    expect(customersBulk).toContain('convert(char(23), created_at, 23) AS created_at');
    // The Postgres COPY template (quoted identifiers, source case preserved).
    expect(customersBulk).toContain(
      'COPY "dbo"."customers" ("customer_id", "balance", "created_at") FROM STDIN WITH (FORMAT csv, NULL \'\\N\');'
    );
    expect(ordersBulk).toContain('FROM dbo.orders;');
  });

  // (b) -----------------------------------------------------------------
  it('excludes generated columns from COPY column lists and documents identity loading with OVERRIDING SYSTEM VALUE in the header', () => {
    const items = makeTable('dbo', 'order_items', [
      { name: 'item_id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'price', dataType: 'numeric', overrides: { precision: 10, scale: 2 } },
      { name: 'qty', dataType: 'int' },
      {
        name: 'total',
        dataType: 'numeric',
        overrides: { precision: 19, scale: 2, isGenerated: true, generationExpression: 'price * qty' },
      },
    ], { primaryKey: { name: 'pk_order_items', columns: ['item_id'] } });

    const ir = makeIr([items], {
      sequences: [
        { schemaName: 'dbo', sequenceName: 's', currentValue: '99', currentValueAvailable: true, startValue: null, ownedByTable: 'order_items', ownedByColumn: 'item_id', findingIds: [] },
      ],
    });
    const artifacts = buildDbMigrationPackArtifacts(ir);
    const bulk = fileByPath(artifacts.files, 'data/bulk/001-dbo.order_items.sql');

    // Generated column excluded from the COPY column list (Postgres computes it).
    expect(bulk).toContain('COPY "dbo"."order_items" ("item_id", "price", "qty") FROM STDIN');
    expect(bulk).not.toContain('COPY dbo.order_items (item_id, price, qty, total)');
    expect(bulk).toContain('Generated columns (total): EXCLUDED from the COPY column list');

    // Identity documented with OVERRIDING SYSTEM VALUE semantics in the header.
    expect(bulk).toContain('Identity columns (item_id)');
    expect(bulk).toContain('OVERRIDING SYSTEM VALUE');

    // And the DDL emitted the generated column (so the exclusion is real).
    const ddl = fileByPath(artifacts.files, 'liquibase/changesets/010-tables/dbo.order_items.sql');
    expect(ddl).toContain('"total" numeric(19,2) GENERATED ALWAYS AS (price * qty) STORED');
  });

  // (c) -----------------------------------------------------------------
  it('detects delta keys deterministically: identity -> insert-only, updated_at-family timestamp -> upsert, identity preferred, neither -> delta_key decision', () => {
    const withIdentity = makeTable('dbo', 't_identity', [
      { name: 'id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'name', dataType: 'varchar(20)' },
    ]);
    const withTimestamp = makeTable('dbo', 't_ts', [
      { name: 'id', dataType: 'int', overrides: { isNullable: false } },
      { name: 'updated_at', dataType: 'datetime' },
    ], { primaryKey: { name: 'pk_t_ts', columns: ['id'] } });
    const withBoth = makeTable('dbo', 't_both', [
      { name: 'id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'last_modified', dataType: 'datetime' },
    ]);
    const withNeither = makeTable('dbo', 't_none', [
      { name: 'code', dataType: 'varchar(10)' },
      { name: 'label', dataType: 'varchar(50)' },
    ]);

    expect(detectDeltaKey(withIdentity)).toEqual({
      strategy: 'insert_only',
      deltaKey: 'id',
      source: 'identity_column',
    });
    expect(detectDeltaKey(withTimestamp)).toEqual({
      strategy: 'insert_update',
      deltaKey: 'updated_at',
      source: 'timestamp_name_heuristic',
    });
    // Identity preferred when both exist.
    expect(detectDeltaKey(withBoth)).toEqual({
      strategy: 'insert_only',
      deltaKey: 'id',
      source: 'identity_column',
    });
    expect(detectDeltaKey(withNeither)).toEqual({
      strategy: 'needs_decision',
      deltaKey: null,
      source: 'none',
    });

    // A name-match column with a NON-datetime type is NOT a delta key.
    const nameOnly = makeTable('dbo', 't_name_only', [
      { name: 'updated_at', dataType: 'varchar(30)' },
    ]);
    expect(detectDeltaKey(nameOnly).strategy).toBe('needs_decision');

    // End-to-end: the keyless table raises the delta_key decision with the
    // exact three options, and the manifest records every strategy.
    const ir = makeIr([withTimestamp, withNeither]);
    const artifacts = buildDbMigrationPackArtifacts(ir);
    const decision = artifacts.decisions.find((d) => d.decisionKey === 'delta_key--dbo.t_none');
    expect(decision).toBeDefined();
    expect(decision!.category).toBe('delta_key');
    expect(decision!.options).toEqual([
      'full_reload_each_increment',
      'skip_from_incremental',
      'manually_specified_key',
    ]);
    expect(artifacts.manifest.delta_strategies).toContainEqual({
      table: 'dbo.t_ts',
      strategy: 'insert_update',
      deltaKey: 'updated_at',
      source: 'timestamp_name_heuristic',
    });
    expect(artifacts.manifest.delta_strategies).toContainEqual({
      table: 'dbo.t_none',
      strategy: 'needs_decision',
      deltaKey: null,
      source: 'none',
    });
    // No incremental script for the undecided table.
    expect(artifacts.files.some((f) => f.filePath === 'data/incremental/dbo.t_none.sql')).toBe(false);
  });

  // (d) -----------------------------------------------------------------
  it('parameterises incremental scripts by :last_high_water and states delta key + strategy in the header', () => {
    const orders = makeTable('dbo', 'orders', [
      { name: 'order_id', dataType: 'int', overrides: { isIdentity: true, isNullable: false } },
      { name: 'amount', dataType: 'money' },
    ], { primaryKey: { name: 'pk_orders', columns: ['order_id'] } });
    const audit = makeTable('dbo', 'audit_log', [
      { name: 'entry_id', dataType: 'int', overrides: { isNullable: false } },
      { name: 'updated_at', dataType: 'datetime' },
    ], { primaryKey: { name: 'pk_audit_log', columns: ['entry_id'] } });

    const ir = makeIr([orders, audit], {
      sequences: [
        { schemaName: 'dbo', sequenceName: 's', currentValue: '500', currentValueAvailable: true, startValue: null, ownedByTable: 'orders', ownedByColumn: 'order_id', findingIds: [] },
      ],
    });
    const artifacts = buildDbMigrationPackArtifacts(ir);

    // Insert-only (identity delta key).
    const ordersInc = fileByPath(artifacts.files, 'data/incremental/dbo.orders.sql');
    expect(ordersInc).toContain('-- Delta key: order_id | strategy: insert_only | chosen by: identity_column');
    expect(ordersInc).toContain('WHERE order_id > :last_high_water');
    expect(ordersInc).toContain('OVERRIDING SYSTEM VALUE');
    expect(ordersInc).toContain('Phase 5 of 5: increments execute WITH foreign keys and indexes enforced');

    // Insert+update (timestamp-name delta key) — an upsert on the PK.
    const auditInc = fileByPath(artifacts.files, 'data/incremental/dbo.audit_log.sql');
    expect(auditInc).toContain('-- Delta key: updated_at | strategy: insert_update | chosen by: timestamp_name_heuristic');
    expect(auditInc).toContain('WHERE updated_at > :last_high_water');
    expect(auditInc).toContain('ON CONFLICT ("entry_id") DO UPDATE SET');
    expect(auditInc).toContain('"updated_at" = EXCLUDED."updated_at"');
  });

  // (e) -----------------------------------------------------------------
  it('states the five-phase ordering and the DELETE-propagation exclusion in the bulk manifest (full reload = the delete-catching mechanism)', () => {
    const t = makeTable('dbo', 'plain', [{ name: 'code', dataType: 'varchar(10)' }]);
    const ir = makeIr([t], {
      // A resolved delta_key decision: full reload each increment.
      resolvedDecisions: {
        'delta_key--dbo.plain': { option: 'full_reload_each_increment' },
      },
    });
    const artifacts = buildDbMigrationPackArtifacts(ir);
    const manifest = JSON.parse(
      fileByPath(artifacts.files, 'data/bulk-load-manifest.json')
    ) as { phase_ordering: string[]; delete_propagation: string; table_order: string[] };

    expect(manifest.phase_ordering).toEqual(FIVE_PHASE_ORDERING);
    expect(manifest.phase_ordering).toHaveLength(5);
    expect(manifest.phase_ordering[0]).toContain('NO foreign keys, NO non-PK indexes');
    expect(manifest.phase_ordering[2]).toContain('apply foreign keys + non-PK indexes ONCE');
    expect(manifest.phase_ordering[4]).toContain('WITH foreign keys and indexes enforced');
    expect(manifest.delete_propagation).toBe(DELETE_PROPAGATION_STATEMENT);
    expect(manifest.delete_propagation).toContain('OUT OF SCOPE');
    expect(manifest.delete_propagation).toContain('full reload');
    expect(manifest.table_order).toEqual(['dbo.plain']);

    // The resolved full-reload table emits a full-reload increment (the
    // delete-catching mechanism) and the manifest records the strategy.
    expect(artifacts.manifest.delta_strategies).toContainEqual({
      table: 'dbo.plain',
      strategy: 'full_reload',
      deltaKey: null,
      source: 'resolved_decision',
    });
    const inc = fileByPath(artifacts.files, 'data/incremental/dbo.plain.sql');
    expect(inc).toContain('Full reload each increment (this is the delete-catching mechanism');
    // The pack-level manifest mirrors the same statements for the UI.
    expect(artifacts.manifest.phase_ordering).toEqual(FIVE_PHASE_ORDERING);
    expect(artifacts.manifest.delete_propagation).toBe(DELETE_PROPAGATION_STATEMENT);
  });
});
