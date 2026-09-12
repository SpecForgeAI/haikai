/**
 * Workbench target reconcile (2026-09-12): the DB plane's data-parity engine
 * run on demand after Build target, before any Stage 1 run.
 */

jest.mock('../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import {
  runTargetReconcile,
  targetReconcileRegistry,
  lastTargetReconcile,
} from '../services/dbMigrationPack/targetReconcile';

const db = { dbType: 'postgres' as const, host: 'h', port: 5432, database: 'd', username: 'u', password: 'p' };
const args = { projectId: 'p1', architectureId: 'a1', packId: 'k1', sourceDb: { ...db, dbType: 'sybase' as const, port: 5000 }, targetDb: db };

beforeEach(() => {
  targetReconcileRegistry.clear();
  lastTargetReconcile.clear();
});

describe('runTargetReconcile', () => {
  it('resolves the table scope from the pack manifest, runs the parity engine, records the persisted report', async () => {
    const resolveTables = jest.fn().mockResolvedValue([
      { schema: 'dbo', table: 'orders', primaryKey: ['id'] },
      { schema: 'dbo', table: 'books', primaryKey: null },
    ]);
    const runReconcile = jest.fn().mockImplementation(async () => {
      // While the engine runs the registry shows the comparing phase.
      expect(targetReconcileRegistry.get('k1')).toMatchObject({ phase: 'comparing 2 table(s)', tables: 2 });
      return { ok: true, reportPersisted: true, status: 'divergent', reportId: 'rep-1' };
    });
    const out = await runTargetReconcile(args, { resolveTables, runReconcile, now: () => new Date('2026-09-12T10:00:00Z') });
    expect(out).toMatchObject({ status: 'succeeded', reportId: 'rep-1', parityStatus: 'divergent', tables: 2, error: null });
    expect(runReconcile.mock.calls[0][0]).toMatchObject({ projectId: 'p1', architectureId: 'a1', tables: [{ table: 'orders', primaryKey: ['id'] }, { table: 'books' }] });
    expect(runReconcile.mock.calls[0][0].sourceDb.dbType).toBe('sybase');
    expect(targetReconcileRegistry.has('k1')).toBe(false);
    expect(lastTargetReconcile.get('k1')?.reportId).toBe('rep-1');
  });

  it('fails honestly when the manifest resolves no tables, when the engine refuses, and when the report could not be persisted', async () => {
    const none = await runTargetReconcile(args, { resolveTables: jest.fn().mockResolvedValue([]), runReconcile: jest.fn() });
    expect(none.status).toBe('failed');
    expect(none.error).toContain('resolves no tables');

    const refused = await runTargetReconcile(args, {
      resolveTables: jest.fn().mockResolvedValue([{ schema: null, table: 't', primaryKey: null }]),
      runReconcile: jest.fn().mockResolvedValue({ ok: false, reportPersisted: false, status: null, reportId: null, error: 'target login failed' }),
    });
    expect(refused).toMatchObject({ status: 'failed', error: 'target login failed', tables: 1 });

    const unpersisted = await runTargetReconcile(args, {
      resolveTables: jest.fn().mockResolvedValue([{ schema: null, table: 't', primaryKey: null }]),
      runReconcile: jest.fn().mockResolvedValue({ ok: true, reportPersisted: false, status: 'clean', reportId: null }),
    });
    expect(unpersisted.status).toBe('succeeded');
    expect(unpersisted.parityStatus).toBe('clean');
    expect(unpersisted.error).toContain('could not be persisted');

    const crashed = await runTargetReconcile(args, {
      resolveTables: jest.fn().mockRejectedValue(new Error('AMS down')),
      runReconcile: jest.fn(),
    });
    expect(crashed).toMatchObject({ status: 'failed', error: 'AMS down' });
    expect(targetReconcileRegistry.has('k1')).toBe(false);
  });
});
