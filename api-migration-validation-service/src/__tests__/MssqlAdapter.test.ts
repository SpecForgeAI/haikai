/**
 * MssqlAdapter unit test (second-pair programme, Spec 3). The adapter routes
 * every JDBC operation through the db-discovery-sidecar, so the test mocks
 * the global `fetch` and inspects the URL + body of every sidecar request.
 *
 * Pins: engine + auth extras on every body; bracket quoting; COUNT_BIG;
 * TOP-based paging; type-aware cursor literals (numeric unquoted, N'…' for
 * n-types, 0x… for binary, 7-digit datetime2 preserved, uuid quoted);
 * `/call` param key is `sourceType`; guard + params refusal; clamps.
 */
import { MssqlAdapter, mssqlLiteral, quoteIdent } from '../services/db/MssqlAdapter';
import type { DbConnectionConfig } from '../types/db';

const baseConfig: DbConnectionConfig = {
  dbType: 'mssql',
  host: 'db.test',
  port: 1433,
  database: 'demo',
  schema: null,
  username: 'svc_ro',
  password: 'pwd',
  mssqlAuth: { authScheme: 'ntlm', domain: 'CORP', encrypt: true, trustServerCertificate: true, instanceName: null },
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

describe('MssqlAdapter (sidecar-backed)', () => {
  afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it('testConnection sends engine + auth extras and folds the edition into serverVersion', async () => {
    const recorded = installFetchMock([{ body: { ok: true, serverVersion: '16.0.4105.2', serverEdition: 'Developer Edition (64-bit)', driverUsed: 'mssql-jdbc' } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
    expect(result.serverVersion).toBe('16.0.4105.2 (Developer Edition (64-bit))');
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/test-connection`);
    expect(recorded[0].body).toMatchObject({
      engine: 'mssql',
      host: 'db.test',
      port: 1433,
      database: 'demo',
      username: 'svc_ro',
      password: 'pwd',
      authScheme: 'ntlm',
      domain: 'CORP',
      encrypt: true,
      trustServerCertificate: true,
      instanceName: null,
    });
  });

  it('defaults the auth extras (sql login, encrypt on, no trust) when none are configured', async () => {
    const recorded = installFetchMock([{ body: { ok: true } }]);
    const adapter = new MssqlAdapter({ ...baseConfig, mssqlAuth: null }, { sidecarBaseUrl: SIDECAR_URL });
    await adapter.testConnection();
    expect(recorded[0].body).toMatchObject({ authScheme: 'sql', domain: null, encrypt: true, trustServerCertificate: false });
  });

  it('listMetadata is fail-closed on an empty allowlist and groups columns by table', async () => {
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    expect(await adapter.listMetadata({})).toEqual([]);
    const recorded = installFetchMock([
      {
        body: {
          ok: true,
          tables: [{ schemaName: 'dbo', tableName: 'Orders' }],
          columns: [
            { schemaName: 'dbo', tableName: 'Orders', columnName: 'OrderID', dataType: 'int', isNullable: false },
            { schemaName: 'dbo', tableName: 'Orders', columnName: 'PlacedAt', dataType: 'datetime2', isNullable: true },
          ],
        },
      },
    ]);
    const meta = await adapter.listMetadata({ schemas: ['dbo'] });
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/introspect`);
    expect(recorded[0].body).toMatchObject({ engine: 'mssql', includeSchemas: ['dbo'], includeTables: null });
    expect(meta).toEqual([
      {
        schema: 'dbo',
        table: 'Orders',
        columns: [
          { schema: 'dbo', table: 'Orders', column: 'OrderID', dataType: 'int', isNullable: false },
          { schema: 'dbo', table: 'Orders', column: 'PlacedAt', dataType: 'datetime2', isNullable: true },
        ],
      },
    ]);
  });

  it('runReadonlySelect enforces the TS-layer guard and refuses params', async () => {
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(adapter.runReadonlySelect('DELETE FROM x', [], { maxRows: 10, timeoutSeconds: 5 })).rejects.toThrow();
    await expect(adapter.runReadonlySelect('SELECT 1', [1], { maxRows: 10, timeoutSeconds: 5 })).rejects.toThrow(/parameterised/);
  });

  it('runReadonlySelect forwards literal SQL with engine + clamped limits', async () => {
    const recorded = installFetchMock([{ body: { ok: true, rows: [{ a: 1 }], rowCount: 1, truncated: false } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const res = await adapter.runReadonlySelect('SELECT 1 AS a', [], { maxRows: 50_000, timeoutSeconds: 5 });
    expect(res).toEqual({ rows: [{ a: 1 }], rowCount: 1, truncated: false });
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/query`);
    expect(recorded[0].body).toMatchObject({ engine: 'mssql', sql: 'SELECT 1 AS a', maxRows: 10_000, queryTimeoutSeconds: 5 });
  });

  it('sampleValues builds SELECT DISTINCT TOP N with bracket-quoted identifiers', async () => {
    const recorded = installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await adapter.sampleValues({ schema: 'dbo', table: 'Odd]Name', column: 'Col', limits: { maxRows: 5, timeoutSeconds: 5 } });
    expect(recorded[0].body.sql).toBe('SELECT DISTINCT TOP 5 [Col] FROM [dbo].[Odd]]Name]');
  });

  it('countRows uses COUNT_BIG and throws on an unparseable count', async () => {
    installFetchMock([{ body: { ok: true, rows: [{ row_count: '12345678901' }], rowCount: 1 } }, { body: { ok: true, rows: [{ row_count: 'garbled' }], rowCount: 1 } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    expect(await adapter.countRows({ schema: 'dbo', table: 'T', limits: { maxRows: 1, timeoutSeconds: 5 } })).toBe(12345678901);
    await expect(adapter.countRows({ schema: 'dbo', table: 'T', limits: { maxRows: 1, timeoutSeconds: 5 } })).rejects.toThrow(/unparseable/);
  });

  it('fetchOrderedRows renders the keyset cursor under each column type', async () => {
    const recorded = installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await adapter.fetchOrderedRows({
      schema: 'dbo',
      table: 'T',
      orderBy: ['Id', 'Name', 'Stamp', 'Blob', 'Guid'],
      limits: { maxRows: 100, timeoutSeconds: 5 },
      after: ['9007199254740993', "O'Brien", '2026-01-31 13:05:09.1234567', '\\x00ff', 'A1B2C3D4-0000-0000-0000-000000000000'],
      orderByTypes: ['bigint', 'nvarchar(50)', 'datetime2(7)', 'varbinary(16)', 'uniqueidentifier'],
    });
    const sql = recorded[0].body.sql as string;
    expect(sql.startsWith('SELECT TOP 100 * FROM [dbo].[T] WHERE ')).toBe(true);
    expect(sql).toContain('[Id] > 9007199254740993');
    expect(sql).toContain("[Name] > N'O''Brien'");
    expect(sql).toContain("[Stamp] > '2026-01-31 13:05:09.1234567'");
    expect(sql).toContain('[Blob] > 0x00ff');
    expect(sql).toContain("[Guid] > 'A1B2C3D4-0000-0000-0000-000000000000'");
    expect(sql.endsWith('ORDER BY [Id], [Name], [Stamp], [Blob], [Guid]')).toBe(true);
  });

  it('probeKeyIntegrity issues the null-key and duplicate-key probes', async () => {
    const recorded = installFetchMock([{ body: { ok: true, rows: [], rowCount: 0 } }, { body: { ok: true, rows: [{ hit: 1 }], rowCount: 1 } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const res = await adapter.probeKeyIntegrity({ schema: 'dbo', table: 'T', keyColumns: ['A', 'B'], limits: { maxRows: 1, timeoutSeconds: 5 } });
    expect(res).toEqual({ nullKeys: false, duplicateKeys: true });
    expect(recorded[0].body.sql).toBe('SELECT TOP 1 1 AS hit FROM [dbo].[T] WHERE [A] IS NULL OR [B] IS NULL');
    expect(recorded[1].body.sql).toBe('SELECT TOP 1 1 AS hit FROM [dbo].[T] GROUP BY [A], [B] HAVING COUNT(*) > 1');
  });

  it('callRoutine sends structured params under sourceType and maps the envelope', async () => {
    const recorded = installFetchMock([
      {
        body: {
          ok: true,
          outcome: 'error',
          return_status: 1,
          output_params: { total: '3' },
          result_sets: [{ ordinal: 1, columns: [{ name: 'id', type: 'int' }], rows: [[1]], row_count: 1 }],
          messages: [{ kind: 'raiserror', number: 50001, severity: 16, state: 1, text: 'boom' }],
          error_detail: { number: 50001, sqlstate: 'S0001', severity: 16, state: 1, message: 'boom' },
          timing_ms: 12,
        },
      },
    ]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    const env = await adapter.callRoutine({
      schema_name: 'dbo',
      routine_name: 'usp_do',
      routine_kind: 'procedure',
      params: [{ name: '@n', ordinal: 1, source_type: 'int', direction: 'in', value: 5 }],
      return_status: true,
      session_set: ['set nocount on'],
      limits: { max_rows_per_result_set: 1000, max_result_sets: 5, timeout_seconds: 30 },
    } as never);
    expect(recorded[0].url).toBe(`${SIDECAR_URL}/call`);
    expect(recorded[0].body).toMatchObject({
      engine: 'mssql',
      schemaName: 'dbo',
      routineName: 'usp_do',
      params: [{ name: '@n', ordinal: 1, sourceType: 'int', direction: 'in', value: '5', isNull: false }],
      returnStatus: true,
    });
    expect(env.outcome).toBe('error');
    expect(env.return_status).toBe(1);
    expect(env.error?.number).toBe(50001);
    expect(env.messages[0].kind).toBe('raiserror');
    expect(env.session.set_options).toEqual(['set nocount on']);
    expect(env.engine).toBe('sidecar');
  });

  it('surfaces sidecar HTTP failures with the URL and status', async () => {
    installFetchMock([{ status: 502, body: { error: 'bad gateway' } }]);
    const adapter = new MssqlAdapter(baseConfig, { sidecarBaseUrl: SIDECAR_URL });
    await expect(adapter.testConnection()).rejects.toThrow(/HTTP 502/);
  });
});

describe('mssqlLiteral / quoteIdent', () => {
  it('bracket-quotes and doubles a closing bracket', () => {
    expect(quoteIdent('plain')).toBe('[plain]');
    expect(quoteIdent('we]ird')).toBe('[we]]ird]');
    expect(() => quoteIdent('')).toThrow();
  });

  it('renders numerics unquoted only when canonical, and fails loud otherwise', () => {
    expect(mssqlLiteral('42', 'bigint')).toBe('42');
    expect(mssqlLiteral('-1.50', 'decimal(10,2)')).toBe('-1.50');
    expect(mssqlLiteral(7, null)).toBe('7');
    expect(mssqlLiteral(true, 'bit')).toBe('1');
    expect(() => mssqlLiteral('1;DROP', 'int')).toThrow(/canonical numeric/);
    expect(mssqlLiteral('42', 'varchar(10)')).toBe("'42'");
  });

  it('renders national strings as N-literals and binaries as 0x literals', () => {
    expect(mssqlLiteral("O'Hara", 'nvarchar(20)')).toBe("N'O''Hara'");
    expect(mssqlLiteral('x', 'nchar(1)')).toBe("N'x'");
    expect(mssqlLiteral('\\xDEADbeef', 'varbinary(max)')).toBe('0xdeadbeef');
    expect(() => mssqlLiteral('not-hex', 'binary(8)')).toThrow(/hex/);
  });

  it('preserves 7-digit fractions on datetime2 cursors and renders Dates naively', () => {
    expect(mssqlLiteral('2026-01-31 13:05:09.1234567', 'datetime2(7)')).toBe("'2026-01-31 13:05:09.1234567'");
    const d = new Date(2026, 0, 31, 13, 5, 9, 7);
    expect(mssqlLiteral(d, 'datetime')).toBe("'2026-01-31 13:05:09.007'");
  });
});
