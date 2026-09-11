/**
 * Sidecar write adapter wire (second-pair programme, Spec 4): every /mutate
 * body carries the engine; SQL Server bodies carry the auth extras; the
 * guard still runs before any HTTP; the Sybase alias class is the same code.
 */
import {
  SidecarCompensationWriteAdapter,
  SybaseCompensationWriteAdapter,
} from '../services/compensation/WriteAdapter';
import type { DbConnectionConfig } from '../types/db';

function installFetchMock(body: unknown): Array<{ url: string; body: Record<string, unknown> }> {
  const recorded: Array<{ url: string; body: Record<string, unknown> }> = [];
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    recorded.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as never;
  });
  return recorded;
}

afterEach(() => {
  delete (global as unknown as { fetch?: unknown }).fetch;
});

const mssql: DbConnectionConfig = {
  dbType: 'mssql', host: 'h', port: 1433, database: 'd', username: 'u', password: 'p',
  mssqlAuth: { authScheme: 'ntlm', domain: 'CORP', encrypt: true, trustServerCertificate: true, instanceName: 'INST1' },
};
const sybase: DbConnectionConfig = { dbType: 'sybase', host: 'h', port: 5000, database: 'd', username: 'u', password: 'p', charset: 'iso_1' };

test('SQL Server bodies carry engine + auth extras; DBCC reseed passes the guard non-transactionally', async () => {
  const recorded = installFetchMock({ ok: true, rowCounts: [0] });
  const adapter = new SidecarCompensationWriteAdapter(mssql, { sidecarBaseUrl: 'http://sc:8093/' });
  const res = await adapter.executeCompensationBatch(["DBCC CHECKIDENT ('[dbo].[orders]', RESEED, 41)"], { transactional: false });
  expect(res.rowCounts).toEqual([0]);
  expect(recorded[0].url).toBe('http://sc:8093/mutate');
  expect(recorded[0].body).toMatchObject({
    engine: 'mssql', host: 'h', port: 1433, database: 'd', username: 'u', password: 'p',
    authScheme: 'ntlm', domain: 'CORP', encrypt: true, trustServerCertificate: true, instanceName: 'INST1',
    mode: 'compensation', transactional: false,
  });
});

test('Sybase bodies carry engine + charset and no SQL Server extras; the alias class is the same adapter', async () => {
  const recorded = installFetchMock({ ok: true, rowCounts: [1] });
  const adapter = new SybaseCompensationWriteAdapter(sybase, { sidecarBaseUrl: 'http://sc:8093' });
  await adapter.executeRestoreBatch(['TRUNCATE TABLE orders']);
  expect(recorded[0].body).toMatchObject({ engine: 'sybase', charset: 'iso_1', mode: 'restore', transactional: true });
  expect(recorded[0].body).not.toHaveProperty('authScheme');
  expect(adapter).toBeInstanceOf(SidecarCompensationWriteAdapter);
});

test('the guard refuses a forbidden statement before any HTTP call', async () => {
  const recorded = installFetchMock({ ok: true, rowCounts: [] });
  const adapter = new SidecarCompensationWriteAdapter(mssql, { sidecarBaseUrl: 'http://sc:8093' });
  await expect(adapter.executeCompensationBatch(['DROP TABLE orders'])).rejects.toThrow();
  expect(recorded).toHaveLength(0);
});
