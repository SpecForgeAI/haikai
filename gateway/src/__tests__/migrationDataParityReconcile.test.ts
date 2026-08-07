/**
 * DB-plane data-parity reconcile trigger (Spec W live seam).
 *
 * Pins: the pack-manifest table resolution, the complete-run dispatch to the
 * AMVS route, the FAIL-SOFT skip when creds/tables are missing, and the
 * never-throws contract.
 */
import {
  createDataParityReconcileTrigger,
  defaultResolveDataParityTables,
  runDataParityReconcileViaAmvs,
} from '../services/migrationDataParityReconcile';
import { MigrateScope, MigrationDriverDeps } from '../services/migrationExecutionDriver';

const scope: MigrateScope = {
  projectId: 'p1',
  bookId: 'book-1',
  company: 'acme',
  project: 'order-mig',
};

function depsWithBook(architectureId: string | null): MigrationDriverDeps {
  return {
    getMigrationExecutionRun: jest.fn().mockResolvedValue({ id: 'run-1', book_of_work_id: 'book-1' }),
    fetchBookOfWork: jest.fn().mockResolvedValue({ current_architecture_id: architectureId }),
  } as unknown as MigrationDriverDeps;
}

const targetDb = {
  dbType: 'postgres' as const,
  host: 'th',
  port: 5432,
  database: 'td',
  username: 'tu',
  password: 'tp',
};
const sourceDb = {
  dbType: 'sybase' as const,
  host: 'sh',
  port: 5000,
  database: 'sd',
  username: 'su',
  password: 'sp',
};

describe('defaultResolveDataParityTables', () => {
  it('maps the pack manifest table_order into {schema, table}', async () => {
    const fetchPackView = jest.fn().mockResolvedValue({
      manifest: { bulk_load: { table_order: ['dbo.customers', 'dbo.orders'] } },
    });
    const tables = await defaultResolveDataParityTables('p1', 'arch-1', fetchPackView as never);
    expect(tables).toEqual([
      { schema: 'dbo', table: 'customers' },
      { schema: 'dbo', table: 'orders' },
    ]);
  });

  it('returns [] when no pack exists', async () => {
    const tables = await defaultResolveDataParityTables(
      'p1',
      'arch-1',
      jest.fn().mockResolvedValue(null) as never,
    );
    expect(tables).toEqual([]);
  });

  it('attaches each table\'s PRIMARY KEY from expected_schema (keyed-join threading, 2026-08-07)', async () => {
    const fetchPackView = jest.fn().mockResolvedValue({
      manifest: {
        bulk_load: { table_order: ['dbo.customers', 'dbo.orders'] },
        expected_schema: {
          keysAndIndexes: [
            { kind: 'primary_key', schemaName: 'dbo', tableName: 'orders', columns: ['order_id'] },
            { kind: 'index', schemaName: 'dbo', tableName: 'orders', columns: ['amount'] },
            // customers has NO pk entry — stays keyless.
          ],
        },
      },
    });
    const tables = await defaultResolveDataParityTables('p1', 'arch-1', fetchPackView as never);
    expect(tables).toEqual([
      { schema: 'dbo', table: 'customers' },
      { schema: 'dbo', table: 'orders', primaryKey: ['order_id'] },
    ]);
  });
});

describe('runDataParityReconcileViaAmvs wire body', () => {
  it('serialises primaryKey as order_by + key_is_unique; keyless tables omit both', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ report_persisted: true, report: { summary: { status: 'clean' } } }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as never;
    try {
      await runDataParityReconcileViaAmvs({
        projectId: 'p1',
        architectureId: 'arch-1',
        sourceDb,
        targetDb,
        tables: [
          { schema: 'dbo', table: 'orders', primaryKey: ['order_id'] },
          { schema: 'dbo', table: 'notes' },
        ],
      });
    } finally {
      global.fetch = originalFetch;
    }
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.tables).toEqual([
      { schema: 'dbo', table: 'orders', order_by: ['order_id'], key_is_unique: true },
      { schema: 'dbo', table: 'notes' },
    ]);
  });
});

describe('createDataParityReconcileTrigger', () => {
  it('dispatches the AMVS reconcile when creds + tables are all present', async () => {
    const runReconcile = jest
      .fn()
      .mockResolvedValue({ ok: true, reportPersisted: true, status: 'clean', reportId: 'rep-1' });
    const trigger = createDataParityReconcileTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      resolveTables: async () => [{ schema: 'dbo', table: 'orders' }],
      runReconcile,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));

    expect(runReconcile).toHaveBeenCalledTimes(1);
    expect(runReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        architectureId: 'arch-1',
        sourceDb,
        targetDb,
        tables: [{ schema: 'dbo', table: 'orders' }],
      }),
    );
  });

  it('FAIL-SOFT skips (no dispatch) when the source DB creds are missing', async () => {
    const runReconcile = jest.fn();
    const trigger = createDataParityReconcileTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => undefined, // not registered
      resolveTables: async () => [{ schema: 'dbo', table: 'orders' }],
      runReconcile,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));
    expect(runReconcile).not.toHaveBeenCalled();
  });

  it('FAIL-SOFT skips when the pack yields no tables', async () => {
    const runReconcile = jest.fn();
    const trigger = createDataParityReconcileTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      resolveTables: async () => [],
      runReconcile,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));
    expect(runReconcile).not.toHaveBeenCalled();
  });

  it('never throws — an AMS read failure is swallowed', async () => {
    const runReconcile = jest.fn();
    const badDeps = {
      getMigrationExecutionRun: jest.fn().mockRejectedValue(new Error('ams down')),
      fetchBookOfWork: jest.fn(),
    } as unknown as MigrationDriverDeps;
    const trigger = createDataParityReconcileTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      resolveTables: async () => [{ schema: 'dbo', table: 'orders' }],
      runReconcile,
    });

    await expect(trigger(scope, 'run-1', badDeps)).resolves.toBeUndefined();
    expect(runReconcile).not.toHaveBeenCalled();
  });
});
