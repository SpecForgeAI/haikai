/**
 * SybaseAdapter unit test. The adapter routes every JDBC operation through
 * the `sybase-discovery-sidecar` JVM HTTP service, so the test mocks the
 * global `fetch` and inspects the URL + body of every sidecar request.
 *
 * Spec follow-up (2026-05-17): replaces the previous throwing stub with a
 * real adapter that reuses the discovery-service sidecar. Same envelope
 * shapes as `sybaseSidecarClient.ts` over there.
 */

import { SybaseAdapter } from '../services/db/SybaseAdapter';
import type { DbConnectionConfig } from '../types/db';

const baseConfig: DbConnectionConfig = {
  dbType: 'sybase',
  host: 'db.test',
  port: 5000,
  database: 'demo',
  schema: null,
  username: 'svc_ro',
  password: 'pwd',
};

const SIDECAR_URL = 'http://sidecar:8093';

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

function installFetchMock(responses: Array<{ status?: number; body: unknown }>): RecordedCall[] {
  const recorded: RecordedCall[] = [];
  let i = 0;
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    const parsedBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    recorded.push({ url, body: parsedBody });
    const stub = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return {
      ok: (stub.status ?? 200) >= 200 && (stub.status ?? 200) < 300,
      status: stub.status ?? 200,
      json: async () => stub.body,
      text: async () => JSON.stringify(stub.body),
    } as never;
  });
  return recorded;
}

describe('SybaseAdapter (sidecar-backed)', () => {
  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('testConnection POSTs /test-connection with creds and surfaces serverVersion + driverUsed', async () => {
    const recorded = installFetchMock([
      { body: { ok: true, serverVersion: 'ASE/16.0', driverUsed: 'jconnect' } },
    ]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
    expect(result.serverVersion).toBe('ASE/16.0');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/test-connection`);
    expect(recorded[0].body).toMatchObject({
      host: 'db.test',
      port: 5000,
      database: 'demo',
      username: 'svc_ro',
      password: 'pwd',
    });
    // Adapter intentionally doesn't pass a driver field; sidecar defaults
    // to 'auto'. Asserting absence guards against accidental hard-pinning.
    expect(recorded[0].body.driver).toBeUndefined();
  });

  it('testConnection throws when the sidecar reports ok=false', async () => {
    installFetchMock([{ body: { ok: false, error: 'Login failed' } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(adapter.testConnection()).rejects.toThrow(/Login failed/);
  });

  it('listMetadata returns [] when the allowlist is empty (fail-closed)', async () => {
    installFetchMock([{ body: { ok: true } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const meta = await adapter.listMetadata({ schemas: [], tables: [] });
    expect(meta).toEqual([]);
    // Empty allowlist must NOT hit the sidecar.
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
  });

  it('listMetadata groups sidecar columns by (schema, table) and forwards filters', async () => {
    const recorded = installFetchMock([
      {
        body: {
          ok: true,
          tables: [{ schemaName: 'dbo', tableName: 'orders' }],
          columns: [
            {
              schemaName: 'dbo', tableName: 'orders',
              columnName: 'id', dataType: 'int', isNullable: false,
            },
            {
              schemaName: 'dbo', tableName: 'orders',
              columnName: 'note', dataType: 'varchar', isNullable: true,
            },
          ],
        },
      },
    ]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const meta = await adapter.listMetadata({ schemas: ['dbo'], tables: null });
    expect(meta).toHaveLength(1);
    expect(meta[0].schema).toBe('dbo');
    expect(meta[0].table).toBe('orders');
    expect(meta[0].columns).toHaveLength(2);
    expect(meta[0].columns[0]).toMatchObject({ column: 'id', isNullable: false });
    expect(meta[0].columns[1]).toMatchObject({ column: 'note', isNullable: true });
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/introspect`);
    expect(recorded[0].body.includeSchemas).toEqual(['dbo']);
    expect(recorded[0].body.includeTables).toBeNull();
  });

  it('runReadonlySelect rejects non-SELECT SQL at the TS layer (defence in depth)', async () => {
    installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(
      adapter.runReadonlySelect('DELETE FROM orders', [], { maxRows: 10, timeoutSeconds: 5 }),
    ).rejects.toThrow();
    // The guard must short-circuit BEFORE the HTTP call.
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled();
  });

  it('runReadonlySelect throws when params are non-empty (v1 limit)', async () => {
    installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(
      adapter.runReadonlySelect('SELECT 1', ['x'], { maxRows: 10, timeoutSeconds: 5 }),
    ).rejects.toThrow(/parameterised/);
  });

  it('runReadonlySelect forwards SQL + clamped limits to /query and maps the response', async () => {
    const recorded = installFetchMock([
      { body: { ok: true, rows: [{ id: 1 }], rowCount: 1, truncated: false } },
    ]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const res = await adapter.runReadonlySelect(
      'SELECT id FROM dbo.orders',
      [],
      { maxRows: 100, timeoutSeconds: 30 },
    );
    expect(res.rowCount).toBe(1);
    expect(res.truncated).toBe(false);
    expect(res.rows).toEqual([{ id: 1 }]);
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/query`);
    expect(recorded[0].body).toMatchObject({
      sql: 'SELECT id FROM dbo.orders',
      maxRows: 100,
      queryTimeoutSeconds: 30,
    });
  });

  it('sampleValues constructs a quoted SELECT DISTINCT TOP N and uses the readonly path', async () => {
    const recorded = installFetchMock([
      { body: { ok: true, rows: [{ status: 'A' }], rowCount: 1 } },
    ]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await adapter.sampleValues({
      schema: 'dbo',
      table: 'orders',
      column: 'status',
      limits: { maxRows: 25, timeoutSeconds: 10 },
    });
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/query`);
    expect(recorded[0].body.sql).toBe(
      'SELECT DISTINCT TOP 25 "status" FROM "dbo"."orders"',
    );
  });

  it('renders a NUMERIC-typed cursor value UNQUOTED (2026-08-12 — the VARCHAR->BIGINT read failure)', async () => {
    // The sidecar wire carries bigint/numeric as STRINGS (JSON.parse
    // precision); quoting one back at ASE against its numeric column is
    // "Implicit conversion from 'VARCHAR' to 'BIGINT' is not allowed" —
    // the live audit_trail_info keyset failure at 1.2M rows.
    const recorded = installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await adapter.fetchOrderedRows({
      schema: 'dbo',
      table: 'audit_trail_info',
      orderBy: ['Uuid'],
      limits: { maxRows: 500, timeoutSeconds: 30 },
      after: ['1202209'],
      orderByTypes: ['bigint'],
    });
    expect(recorded[0].body.sql).toContain('"Uuid" > 1202209');
    expect(recorded[0].body.sql).not.toContain("'1202209'");
  });

  it('keeps quotes on string-typed cursor values and REFUSES a non-canonical numeric (fail loud)', async () => {
    const recorded = installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    // A varchar column holding digit strings keeps its quotes — type-driven,
    // never shape-guessed.
    await adapter.fetchOrderedRows({
      schema: 'dbo',
      table: 't',
      orderBy: ['code'],
      limits: { maxRows: 10, timeoutSeconds: 5 },
      after: ['1202209'],
      orderByTypes: ['varchar(20)'],
    });
    expect(recorded[0].body.sql).toContain(`"code" > '1202209'`);
    // A numeric column whose cursor value is not a canonical numeric string
    // is corrupt — refuse to render it into SQL at all.
    await expect(
      adapter.fetchOrderedRows({
        schema: 'dbo',
        table: 't',
        orderBy: ['n'],
        limits: { maxRows: 10, timeoutSeconds: 5 },
        after: ['12; DROP TABLE x'],
        orderByTypes: ['bigint'],
      }),
    ).rejects.toThrow(/not a canonical numeric/);
  });

  it('probeKeyIntegrity runs the NULL-key and duplicate-key probes and maps the hits (2026-08-12)', async () => {
    const recorded = installFetchMock([
      { body: { ok: true, rows: [], rowCount: 0 } }, // no NULL keys
      { body: { ok: true, rows: [{ hit: 1 }], rowCount: 1 } }, // duplicates exist
    ]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const probe = await adapter.probeKeyIntegrity({
      schema: 'dbo',
      table: 'org_registry',
      keyColumns: ['HierarchyId', 'ValidFrom'],
      limits: { maxRows: 1, timeoutSeconds: 30 },
    });
    expect(probe).toEqual({ nullKeys: false, duplicateKeys: true });
    expect(recorded[0].body.sql).toBe(
      'SELECT TOP 1 1 AS hit FROM "dbo"."org_registry" ' +
        'WHERE "HierarchyId" IS NULL OR "ValidFrom" IS NULL',
    );
    expect(recorded[1].body.sql).toBe(
      'SELECT TOP 1 1 AS hit FROM "dbo"."org_registry" ' +
        'GROUP BY "HierarchyId", "ValidFrom" HAVING COUNT(*) > 1',
    );
  });

  it('dispose is a stateless no-op', async () => {
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  // ---- countRows honesty (gold standard 2026-08-07) ------------------------

  it('countRows parses a numeric-string count (the sidecar wire renders bigints as strings)', async () => {
    installFetchMock([{ body: { ok: true, rows: [{ row_count: '12345' }], rowCount: 1 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(
      adapter.countRows({ schema: 'dbo', table: 'orders', limits: { maxRows: 5, timeoutSeconds: 5 } }),
    ).resolves.toBe(12345);
  });

  it('countRows THROWS on an unparseable count — a garbled count must never read as 0', async () => {
    installFetchMock([{ body: { ok: true, rows: [{ row_count: 'garble' }], rowCount: 1 } }]);
    const adapter = new SybaseAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(
      adapter.countRows({ schema: 'dbo', table: 'orders', limits: { maxRows: 5, timeoutSeconds: 5 } }),
    ).rejects.toThrow(/unparseable count/);
  });
});
