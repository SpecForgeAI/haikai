/**
 * DB-plane data-migration runner dispatch (Spec W / Y live seam).
 *
 * Pins: the pack-manifest + bulk-manifest gathering, the complete-run dispatch
 * to the AMVS data-migration route, the FAIL-SOFT skip when creds/pack are
 * missing, and the never-throws contract.
 */
import { createDataMigrationTrigger } from '../services/migrationDataRunnerDispatch';
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

const targetDb = { dbType: 'postgres' as const, host: 'th', port: 5432, database: 'td', username: 'tu', password: 'tp' };
const sourceDb = { dbType: 'sybase' as const, host: 'sh', port: 5000, database: 'sd', username: 'su', password: 'sp' };

function packView() {
  return {
    manifest: {
      expected_schema: { tables: [{ schemaName: 'dbo', tableName: 'orders' }] },
      bulk_load: { table_order: ['dbo.orders'], expected_row_counts: { 'dbo.orders': 5 } },
    },
  };
}

describe('createDataMigrationTrigger', () => {
  it('dispatches the AMVS bulk load with the pack manifest + bulk manifest', async () => {
    const runDataMigration = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 'clean', rowsLoaded: 5 });
    const trigger = createDataMigrationTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      fetchPackView: jest.fn().mockResolvedValue(packView()) as never,
      runDataMigration,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));

    expect(runDataMigration).toHaveBeenCalledTimes(1);
    expect(runDataMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        architectureId: 'arch-1',
        sourceDb,
        targetDb,
        manifest: expect.objectContaining({ expected_schema: expect.anything() }),
        bulkManifest: {
          table_order: ['dbo.orders'],
          expected_source_row_counts: { 'dbo.orders': 5 },
        },
      }),
    );
  });

  it('FAIL-SOFT skips (no dispatch) when the target DB creds are missing', async () => {
    const runDataMigration = jest.fn();
    const trigger = createDataMigrationTrigger({
      getTargetDb: () => undefined, // not registered
      getSourceDb: () => sourceDb,
      fetchPackView: jest.fn().mockResolvedValue(packView()) as never,
      runDataMigration,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));
    expect(runDataMigration).not.toHaveBeenCalled();
  });

  it('FAIL-SOFT skips when no pack manifest exists', async () => {
    const runDataMigration = jest.fn();
    const trigger = createDataMigrationTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      fetchPackView: jest.fn().mockResolvedValue(null) as never,
      runDataMigration,
    });

    await trigger(scope, 'run-1', depsWithBook('arch-1'));
    expect(runDataMigration).not.toHaveBeenCalled();
  });

  it('never throws — an AMS read failure is swallowed', async () => {
    const runDataMigration = jest.fn();
    const badDeps = {
      getMigrationExecutionRun: jest.fn().mockRejectedValue(new Error('ams down')),
      fetchBookOfWork: jest.fn(),
    } as unknown as MigrationDriverDeps;
    const trigger = createDataMigrationTrigger({
      getTargetDb: () => targetDb,
      getSourceDb: () => sourceDb,
      fetchPackView: jest.fn().mockResolvedValue(packView()) as never,
      runDataMigration,
    });

    await expect(trigger(scope, 'run-1', badDeps)).resolves.toBeUndefined();
    expect(runDataMigration).not.toHaveBeenCalled();
  });
});
