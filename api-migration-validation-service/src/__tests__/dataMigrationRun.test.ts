/**
 * Data-migration run route (Spec Y / W runner dispatch).
 *
 * Verifies the route wiring — validation, load-plan build, and a happy-path
 * bulk load through injected fake adapters + loader (no live DB). The runner
 * itself is covered by dataMigrationRunner.test.ts.
 */
import express from 'express';
import request from 'supertest';
import { buildDataMigrationRunRouter } from '../routes/dataMigrationRun';
import {
  DbAdapter,
  DbAllowlist,
  DbQueryLimits,
  DbReadResult,
  DbTableMetadata,
} from '../services/db/DbAdapter';
import { TargetLoader } from '../services/dataMigration/targetLoader';
import { TableLoadSpec } from '../services/dataMigration/types';

class FakeAdapter implements DbAdapter {
  constructor(
    private count: number,
    private columns: { column: string; dataType: string }[],
    private rows: Record<string, unknown>[],
  ) {}
  async testConnection(): Promise<{ success: true }> {
    return { success: true };
  }
  async listMetadata(allowlist: DbAllowlist): Promise<DbTableMetadata[]> {
    const table = allowlist.tables?.[0] ?? '';
    const schema = allowlist.schemas?.[0] ?? '';
    return [
      {
        schema,
        table,
        columns: this.columns.map((c) => ({
          schema,
          table,
          column: c.column,
          dataType: c.dataType,
          isNullable: true,
        })),
      },
    ];
  }
  async runReadonlySelect(): Promise<DbReadResult> {
    throw new Error('not used');
  }
  async sampleValues(): Promise<DbReadResult> {
    throw new Error('not used');
  }
  async countRows(): Promise<number> {
    return this.count;
  }
  async fetchOrderedRows(args: {
    schema?: string | null;
    table: string;
    orderBy: string[];
    limits: DbQueryLimits;
  }): Promise<DbReadResult> {
    void args;
    return { rows: this.rows, rowCount: this.rows.length, truncated: false };
  }
  async dispose(): Promise<void> {
    /* no-op */
  }
}

class FakeLoader implements TargetLoader {
  loaded: Record<string, unknown[][]> = {};
  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    this.loaded[`${spec.schema ?? ''}.${spec.table}`] = rows;
    return rows.length;
  }
  async dispose(): Promise<void> {
    /* no-op */
  }
}

const MANIFEST = {
  expected_schema: {
    tables: [{ schemaName: 'dbo', tableName: 'flags' }],
    columns: [
      { schemaName: 'dbo', tableName: 'flags', columnName: 'id', dataType: 'int' },
      { schemaName: 'dbo', tableName: 'flags', columnName: 'active', dataType: 'bit' },
    ],
    keysAndIndexes: [
      { schemaName: 'dbo', tableName: 'flags', kind: 'primary_key', columns: ['id'] },
    ],
  },
};

const DB_BLOCK = (dbType: 'sybase' | 'postgres') => ({
  db_type: dbType,
  host: 'h',
  port: dbType === 'sybase' ? 5000 : 5432,
  database: 'd',
  username: 'u',
  password: 'p',
});

function makeApp(overrides: {
  source?: FakeAdapter;
  target?: FakeAdapter;
  loader?: FakeLoader;
} = {}) {
  const source =
    overrides.source ??
    new FakeAdapter(
      2,
      [
        { column: 'id', dataType: 'int' },
        { column: 'active', dataType: 'bit' },
      ],
      [
        { id: 1, active: 1 },
        { id: 2, active: 0 },
      ],
    );
  const target = overrides.target ?? new FakeAdapter(2, [], []);
  const loader = overrides.loader ?? new FakeLoader();

  const app = express();
  app.use(express.json());
  app.use(
    buildDataMigrationRunRouter({
      createDbAdapter: ((config: { dbType: string }) =>
        config.dbType === 'sybase' ? source : target) as never,
      createTargetLoader: () => loader,
    }),
  );
  return { app, source, target, loader };
}

describe('POST /api/data-migration/run', () => {
  it('400s when source_db is missing', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/data-migration/run')
      .send({ project_id: 'p1', target_db: DB_BLOCK('postgres'), manifest: MANIFEST });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source_db/);
  });

  it('422s when the manifest yields no load plan', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/data-migration/run')
      .send({
        project_id: 'p1',
        source_db: DB_BLOCK('sybase'),
        target_db: DB_BLOCK('postgres'),
        manifest: { nope: true },
      });
    expect(res.status).toBe(422);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('runs the bulk load and returns a clean report on the happy path', async () => {
    const { app, loader } = makeApp();
    const res = await request(app)
      .post('/api/data-migration/run')
      .send({
        project_id: 'p1',
        architecture_id: 'arch-1',
        source_db: DB_BLOCK('sybase'),
        target_db: DB_BLOCK('postgres'),
        manifest: MANIFEST,
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.status).toBe('clean');
    expect(res.body.report.tables[0].status).toBe('loaded');
    // bit -> boolean forward transform applied on the loaded rows.
    expect(loader.loaded['dbo.flags']).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});
