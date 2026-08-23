import { buildLoadPlan } from '../services/dataMigration/buildLoadPlan';

const mainManifest = {
  expected_schema: {
    tables: [
      { schemaName: 'dbo', tableName: 'orders' },
      { schemaName: 'dbo', tableName: 'customers' },
    ],
    columns: [
      { schemaName: 'dbo', tableName: 'orders', columnName: 'order_id', dataType: 'bigint', isIdentity: true },
      { schemaName: 'dbo', tableName: 'orders', columnName: 'customer_id', dataType: 'bigint' },
      { schemaName: 'dbo', tableName: 'orders', columnName: 'total_incl', dataType: 'numeric', isGenerated: true },
      { schemaName: 'dbo', tableName: 'customers', columnName: 'customer_id', dataType: 'bigint', isIdentity: true },
      { schemaName: 'dbo', tableName: 'customers', columnName: 'name', dataType: 'varchar' },
    ],
    keysAndIndexes: [
      { schemaName: 'dbo', tableName: 'orders', kind: 'primary_key', columns: ['order_id'] },
      { schemaName: 'dbo', tableName: 'customers', kind: 'primary_key', columns: ['customer_id'] },
    ],
  },
};

const bulkManifest = {
  table_order: ['dbo.customers', 'dbo.orders'], // FK parent (customers) first
  expected_source_row_counts: { 'dbo.customers': 10, 'dbo.orders': 25 },
};

describe('buildLoadPlan (Spec Y)', () => {
  it('excludes generated columns, captures identity + PK order, follows table_order', () => {
    const plan = buildLoadPlan(mainManifest, bulkManifest);
    expect(plan.issues).toEqual([]);
    expect(plan.tables.map((t) => `${t.schema}.${t.table}`)).toEqual(['dbo.customers', 'dbo.orders']);

    const orders = plan.tables.find((t) => t.table === 'orders')!;
    expect(orders.loadColumns).toEqual(['order_id', 'customer_id']); // total_incl (generated) excluded
    expect(orders.identityColumns).toEqual(['order_id']);
    expect(orders.orderBy).toEqual(['order_id']);
    expect(orders.expectedSourceRowCount).toBe(25);
  });

  it('falls back to expected_schema order + null counts without a bulk manifest', () => {
    const plan = buildLoadPlan(mainManifest);
    expect(plan.tables.map((t) => t.table)).toEqual(['orders', 'customers']);
    expect(plan.tables[0].expectedSourceRowCount).toBeNull();
  });

  it('returns an empty plan + an issue on a malformed manifest', () => {
    const plan = buildLoadPlan({ nope: true });
    expect(plan.tables).toEqual([]);
    expect(plan.issues.length).toBeGreaterThan(0);
  });
  it('surrogate PK (2026-08-08): the target-only column never loads, never orders, never counts as identity', () => {
    const surrogateManifest = {
      expected_schema: {
        tables: [{ schemaName: 'dbo', tableName: 'heap1' }],
        columns: [
          { schemaName: 'dbo', tableName: 'heap1', columnName: 'payload', dataType: 'varchar' },
          { schemaName: 'dbo', tableName: 'heap1', columnName: 'amount', dataType: 'numeric' },
          // Target-only surrogate: bulk load must behave as if it did not exist.
          { schemaName: 'dbo', tableName: 'heap1', columnName: 'id', dataType: 'bigint', isIdentity: true, isSurrogate: true },
        ],
        keysAndIndexes: [
          { schemaName: 'dbo', tableName: 'heap1', kind: 'primary_key', columns: ['id'], isSurrogate: true },
        ],
      },
    };
    const plan = buildLoadPlan(surrogateManifest);
    expect(plan.issues).toEqual([]);
    const heap = plan.tables[0];
    // Insert list = source columns only (a SELECT naming `id` would fail at
    // the source, and GENERATED ALWAYS rejects explicit values anyway).
    expect(heap.loadColumns).toEqual(['payload', 'amount']);
    expect(heap.identityColumns).toEqual([]);
    // The surrogate PK cannot order the source read: keyless fallback
    // ordering over the real columns, orderKeyIsPrimaryKey stays false.
    expect(heap.orderKeyIsPrimaryKey).toBe(false);
    expect(heap.orderBy).toEqual(['payload', 'amount']);
  });

  it('DEMOTED natural key (2026-08-12): a declared non-PK index beats the all-columns fallback as the order key', () => {
    // The surrogate demote_tables remedy leaves the natural key as a
    // NON-UNIQUE index — it matches a real source index (fast keyset seeks)
    // and boundary-trimmed pagination handles its duplicates.
    const demotedManifest = {
      expected_schema: {
        tables: [{ schemaName: 'dbo', tableName: 'org_registry' }],
        columns: [
          { schemaName: 'dbo', tableName: 'org_registry', columnName: 'HierarchyId', dataType: 'int' },
          { schemaName: 'dbo', tableName: 'org_registry', columnName: 'ValidFrom', dataType: 'datetime' },
          { schemaName: 'dbo', tableName: 'org_registry', columnName: 'payload', dataType: 'varchar' },
          { schemaName: 'dbo', tableName: 'org_registry', columnName: 'id', dataType: 'bigint', isIdentity: true, isSurrogate: true },
        ],
        keysAndIndexes: [
          { schemaName: 'dbo', tableName: 'org_registry', kind: 'primary_key', columns: ['id'], isSurrogate: true },
          { schemaName: 'dbo', tableName: 'org_registry', kind: 'index', columns: ['HierarchyId', 'ValidFrom'] },
        ],
      },
    };
    const plan = buildLoadPlan(demotedManifest);
    const table = plan.tables[0];
    expect(table.orderKeyIsPrimaryKey).toBe(false);
    expect(table.orderBy).toEqual(['HierarchyId', 'ValidFrom']);
    expect(table.loadColumns).toEqual(['HierarchyId', 'ValidFrom', 'payload']);
  });
});

