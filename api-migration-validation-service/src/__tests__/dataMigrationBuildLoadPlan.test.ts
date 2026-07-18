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
});
