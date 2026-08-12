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
  prepared: string[] = [];
  async prepareTable(spec: TableLoadSpec): Promise<void> {
    this.prepared.push(`${spec.schema ?? ''}.${spec.table}`);
  }
  async loadTable(spec: TableLoadSpec, rows: unknown[][]): Promise<number> {
    const key = `${spec.schema ?? ''}.${spec.table}`;
    if (!this.prepared.includes(key)) {
      throw new Error(`loadTable called before prepareTable for ${key}`);
    }
    this.loaded[key] = rows;
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
  saveReportThrows?: string;
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
  const savedReports: Array<{
    projectId: string;
    architectureId: string;
    report: Record<string, unknown>;
  }> = [];

  const app = express();
  app.use(express.json());
  app.use(
    buildDataMigrationRunRouter({
      createDbAdapter: ((config: { dbType: string }) =>
        config.dbType === 'sybase' ? source : target) as never,
      createTargetLoader: () => loader,
      saveReport: async (projectId, architectureId, report) => {
        if (overrides.saveReportThrows) {
          throw new Error(overrides.saveReportThrows);
        }
        savedReports.push({
          projectId,
          architectureId,
          report: report as unknown as Record<string, unknown>,
        });
        return { id: `report-${savedReports.length}` };
      },
    }),
  );
  return { app, source, target, loader, savedReports };
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

  it('runs the bulk load and returns a clean report on the happy path — and persists it', async () => {
    const { app, loader, savedReports } = makeApp();
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
    // Report persistence (2026-08-12, the parity-report sibling).
    expect(res.body.report_persisted).toBe(true);
    expect(res.body.report_id).toBe('report-1');
    expect(savedReports).toHaveLength(1);
    expect(savedReports[0]).toMatchObject({ projectId: 'p1', architectureId: 'arch-1' });
    expect(savedReports[0].report).toEqual(res.body.report);
  });

  it('persists the VERBATIM per-table failure reason on an incomplete load', async () => {
    // Target count disagrees with the source (3 != 2): reconciled_mismatch
    // with the runner's reason text — that exact string must land in the
    // persisted report, so failures are read, never inferred from counts.
    const { app, savedReports } = makeApp({ target: new FakeAdapter(3, [], []) });
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
    expect(res.body.report.tables[0].status).toBe('reconciled_mismatch');
    expect(res.body.report_persisted).toBe(true);
    const persisted = savedReports[0].report as {
      tables: Array<{ status: string; reason: string | null }>;
    };
    expect(persisted.tables[0].status).toBe('reconciled_mismatch');
    expect(persisted.tables[0].reason).toBe(res.body.report.tables[0].reason);
    expect(persisted.tables[0].reason).toContain('post-load reconcile off');
  });

  it('FAIL-SOFT: a persist failure never fails a completed load', async () => {
    const { app } = makeApp({ saveReportThrows: 'AMS unreachable (simulated)' });
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
    expect(res.body.report_persisted).toBe(false);
    expect(res.body.report_id).toBeNull();
    expect(res.body.persist_error).toContain('AMS unreachable');
  });

  it('skips persistence cleanly when architecture_id is absent', async () => {
    const { app, savedReports } = makeApp();
    const res = await request(app)
      .post('/api/data-migration/run')
      .send({
        project_id: 'p1',
        source_db: DB_BLOCK('sybase'),
        target_db: DB_BLOCK('postgres'),
        manifest: MANIFEST,
      });

    expect(res.status).toBe(200);
    expect(res.body.summary.status).toBe('clean');
    expect(res.body.report_persisted).toBe(false);
    expect(res.body.report_id).toBeNull();
    expect(res.body.persist_error).toBeNull();
    expect(savedReports).toHaveLength(0);
  });
});
