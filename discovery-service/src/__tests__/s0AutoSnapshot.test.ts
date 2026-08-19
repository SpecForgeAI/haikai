/**
 * Automatic S0 snapshot at DB-scan completion (CSD follow-up, 2026-08-19):
 * the scan's harvest projects into snapshot table specs (PKs, identity,
 * ambiguous multi-schema names skipped loudly), the validation-service call
 * carries the scan's own credentials + metadata, and every failure path is
 * fail-soft with a recorded reason — never a thrown scan failure.
 */

import {
  buildS0TableSpecs,
  takeS0AutoSnapshot,
} from '../services/databasePacks/s0AutoSnapshot';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
} from '../services/databasePacks/types';

const INTROSPECTION: IntrospectionResult = {
  schemas: [],
  tables: [
    { schemaName: 'dbo', tableName: 'orders' },
    { schemaName: 'dbo', tableName: 'order_lines' },
    // The same bare name in TWO schemas -> ambiguous, skipped loudly.
    { schemaName: 'dbo', tableName: 'audit' },
    { schemaName: 'ops', tableName: 'audit' },
  ] as never,
  columns: [
    { schemaName: 'dbo', tableName: 'orders', columnName: 'id', dataType: 'int', isNullable: false, isIdentity: true },
    { schemaName: 'dbo', tableName: 'orders', columnName: 'name', dataType: 'varchar', isNullable: true },
    { schemaName: 'dbo', tableName: 'order_lines', columnName: 'order_id', dataType: 'int', isNullable: false },
    { schemaName: 'dbo', tableName: 'order_lines', columnName: 'line_no', dataType: 'int', isNullable: false },
  ] as never,
  keysAndIndexes: [
    { schemaName: 'dbo', tableName: 'orders', kind: 'primary_key', columns: ['id'] },
    { schemaName: 'dbo', tableName: 'order_lines', kind: 'primary_key', columns: ['order_id', 'line_no'] },
    { schemaName: 'dbo', tableName: 'orders', kind: 'index', columns: ['name'] },
  ] as never,
  views: [],
  procedures: [],
  triggers: [],
  sequences: [],
};

const CONFIG = {
  dbEngine: 'sybase',
  host: 'db.example.internal',
  port: 5000,
  databaseName: 'legacy_db',
} as DatabaseDiscoveryConfig;

const CREDS: DatabaseDiscoveryCredentials = { username: 'writer', password: 'secret' };

describe('buildS0TableSpecs', () => {
  const { specs, ambiguous } = buildS0TableSpecs(INTROSPECTION);

  it('projects tables with PK columns + identity flags from the harvest', () => {
    const orders = specs.find((s) => s.table === 'orders');
    expect(orders?.pk_columns).toEqual(['id']);
    expect(orders?.columns).toEqual([
      { name: 'id', source_type: 'int', is_identity: true },
      { name: 'name', source_type: 'varchar', is_identity: false },
    ]);
    const lines = specs.find((s) => s.table === 'order_lines');
    expect(lines?.pk_columns).toEqual(['order_id', 'line_no']);
  });

  it('skips bare names that exist in multiple schemas, loudly', () => {
    expect(specs.some((s) => s.table === 'audit')).toBe(false);
    expect(ambiguous).toEqual(['audit']);
  });
});

describe('takeS0AutoSnapshot', () => {
  it('posts the scan credentials + table specs and reports taken', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot_id: 's0-auto-1',
        manifest: { tables: [{}, {}, {}] },
      }),
    })) as unknown as typeof fetch;

    const outcome = await takeS0AutoSnapshot({
      projectId: 'p1',
      architectureId: 'a1',
      config: CONFIG,
      credentials: CREDS,
      introspection: INTROSPECTION,
      fetchFn,
    });

    expect(outcome).toMatchObject({ status: 'taken', snapshotId: 's0-auto-1', tableCount: 3 });
    expect(outcome.detail).toContain('audit'); // the ambiguous skip is named
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('/api/s0-snapshot/run');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.source_db).toMatchObject({
      db_type: 'sybase',
      host: 'db.example.internal',
      database: 'legacy_db',
      username: 'writer',
      password: 'secret',
    });
    expect(body.tables.map((t: { table: string }) => t.table).sort()).toEqual([
      'order_lines',
      'orders',
    ]);
  });

  it('reports failed with the service reason (fail-soft, never throws)', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'S0 snapshot failed: disk full' }),
    })) as unknown as typeof fetch;
    const outcome = await takeS0AutoSnapshot({
      projectId: 'p1',
      architectureId: 'a1',
      config: CONFIG,
      credentials: CREDS,
      introspection: INTROSPECTION,
      fetchFn,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('disk full');
  });

  it('reports failed on transport errors (validation service down)', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const outcome = await takeS0AutoSnapshot({
      projectId: 'p1',
      architectureId: 'a1',
      config: CONFIG,
      credentials: CREDS,
      introspection: INTROSPECTION,
      fetchFn,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('ECONNREFUSED');
  });

  it('skips unsupported engines and empty harvests', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const other = await takeS0AutoSnapshot({
      projectId: 'p1',
      architectureId: 'a1',
      config: { ...CONFIG, dbEngine: 'oracle' as never },
      credentials: CREDS,
      introspection: INTROSPECTION,
      fetchFn,
    });
    expect(other.status).toBe('skipped');
    const empty = await takeS0AutoSnapshot({
      projectId: 'p1',
      architectureId: 'a1',
      config: CONFIG,
      credentials: CREDS,
      introspection: { ...INTROSPECTION, tables: [] },
      fetchFn,
    });
    expect(empty.status).toBe('skipped');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
