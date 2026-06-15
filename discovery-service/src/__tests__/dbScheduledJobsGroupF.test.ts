/**
 * Group F tests -- database-resident scheduled jobs / agents Findings (Spec
 * 2026-05-30 Data-Layer Fidelity 2): fills the previously-empty
 * `emitUnsupportedFeatureFindings` stubs in BOTH packs.
 *
 * EXTENDS the Spec-3 / Group-B db-pack introspection + finding test patterns
 * (mirrors dbStructuralFidelityGroup2.test.ts / dbCollationGroupB.test.ts).
 * Offline only -- the Postgres SQL->IR path uses a mocked `pg` Pool; the Sybase
 * path uses the pure `transformSidecarIntrospection` mapper over a synthetic
 * sidecar response; the finding builders are fed synthetic IR.
 * Synthetic-rows-only -> isolation-safe.
 *
 * Focused set (within the 2-8 bound):
 *  1. `emitUnsupportedFeatureFindings` (postgresFindings) now returns a
 *     `db_resident_scheduled_job` Finding for a pg_cron job input (no longer []).
 *  2. The same for `emitUnsupportedFeatureFindings` (sybaseFindings).
 *  3. Empty `scheduledJobs` -> no spurious Finding (regression) in BOTH packs.
 *  4. The Finding carries the VERBATIM schedule + command detail.
 *  5. Postgres introspectScheduledJobs probes pg_cron / pgAgent (to_regclass
 *     guard) and maps the rows; Sybase maps the sidecar jobs shape.
 */

// -----------------------------------------------------------------------------
// `pg` Pool mock (mirrors dbStructuralFidelityGroup2.test.ts).
// -----------------------------------------------------------------------------

const recordedQueries: Array<{ sql: string; params: unknown[] }> = [];

type QueueEntry = {
  match: RegExp;
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
};
const queryQueue: QueueEntry[] = [];

function queueQueryResult(
  match: RegExp,
  rows: Array<Record<string, unknown>>,
): void {
  queryQueue.push({ match, rows, rowCount: rows.length });
}

const mockClient = {
  query: jest.fn(async (sql: string, params?: unknown[]) => {
    const normalized = String(sql).trim();
    recordedQueries.push({ sql: normalized, params: params ?? [] });
    if (/^SET statement_timeout/i.test(normalized)) return { rows: [], rowCount: 0 };
    if (/^RESET statement_timeout/i.test(normalized)) return { rows: [], rowCount: 0 };
    for (let i = 0; i < queryQueue.length; i++) {
      const entry = queryQueue[i];
      if (entry.match.test(normalized)) {
        queryQueue.splice(i, 1);
        return { rows: entry.rows, rowCount: entry.rowCount ?? entry.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  }),
  release: jest.fn(),
};

const mockPool = {
  connect: jest.fn(async () => mockClient),
  end: jest.fn(async () => undefined),
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}));

import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import { __testOnly as postgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { __testOnly as sybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
} from '../services/databasePacks/types';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sybase/sybaseSidecarClient';
import type { DatabaseDiscoveryPackContext } from '../services/databasePacks/DatabaseDiscoveryPack';

const baseConfig = (): DatabaseDiscoveryConfig => ({
  dbEngine: 'postgres',
  host: 'db.test',
  port: 5432,
  databaseName: 'demo',
  catalogName: null,
  schemaName: 'public',
  includeSchemas: null,
  excludeSchemas: null,
  includeTables: null,
  excludeTables: null,
  profilingMode: 'none',
  maxTablesToProfile: 100,
  maxRowsPerProfileQuery: 1000,
  queryTimeoutSeconds: 30,
  allowWorkloadLogUpload: false,
  readOnlyConfirmed: true,
  username: 'svc_ro',
});

const baseCtx = (): DatabaseDiscoveryPackContext => ({
  config: baseConfig(),
  credentials: { username: 'svc_ro', password: 'x' } as DatabaseDiscoveryCredentials,
  runId: 'run-f',
  projectId: 'proj-f',
  architectureId: 'arch-f',
});

const emptyIntrospection = (): IntrospectionResult => ({
  schemas: [],
  tables: [],
  columns: [],
  keysAndIndexes: [],
  views: [],
  procedures: [],
  triggers: [],
  sequences: [],
});

beforeEach(() => {
  recordedQueries.length = 0;
  queryQueue.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.connect.mockClear();
});

// -----------------------------------------------------------------------------
// 1) + 4) postgresFindings.emitUnsupportedFeatureFindings returns a job Finding
//          carrying verbatim schedule + command.
// -----------------------------------------------------------------------------

describe('emitUnsupportedFeatureFindings -- Postgres (Group F)', () => {
  it('returns a db_resident_scheduled_job Finding for a pg_cron job (no longer [])', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      scheduledJobs: [
        {
          schemaName: 'cron',
          jobName: 'nightly_rollup',
          scheduler: 'pg_cron',
          schedule: '0 3 * * *',
          command: "CALL refresh_rollups()",
          enabled: true,
        },
      ],
    };
    const out = postgresFindings.emitUnsupportedFeatureFindings(ir);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('db_resident_scheduled_job');
    expect(out[0].category).toBe('migration_risk');
    expect(out[0].title).toContain('nightly_rollup');
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.scheduler).toBe('pg_cron');
    expect(detail.schedule).toBe('0 3 * * *'); // verbatim
    expect(String(detail.command)).toContain('refresh_rollups'); // verbatim (redacted body)
    expect(detail.enabled).toBe(true);
    expect(detail.migrationConcern).toBe('db_resident_scheduled_job');
  });

  it('returns NO Finding when scheduledJobs is empty (regression)', () => {
    const out = postgresFindings.emitUnsupportedFeatureFindings(emptyIntrospection());
    expect(out).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 2) + 3) sybaseFindings.emitUnsupportedFeatureFindings returns a job Finding /
//          nothing for empty input.
// -----------------------------------------------------------------------------

describe('emitUnsupportedFeatureFindings -- Sybase (Group F)', () => {
  it('returns a db_resident_scheduled_job Finding for a Sybase scheduler job (no longer [])', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      scheduledJobs: [
        {
          schemaName: 'dbo',
          jobName: 'purge_audit',
          scheduler: 'sybase_job_scheduler',
          schedule: 'daily 02:00',
          command: 'exec sp_purge_audit',
          enabled: true,
        },
      ],
    };
    const out = sybaseFindings.emitUnsupportedFeatureFindings(ir);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('db_resident_scheduled_job');
    expect((out[0].detailJson as Record<string, unknown>).engineKey).toBe('sybase');
    expect(out[0].title).toContain('purge_audit');
  });

  it('returns NO Finding when scheduledJobs is empty (regression)', () => {
    const out = sybaseFindings.emitUnsupportedFeatureFindings(emptyIntrospection());
    expect(out).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 5) Postgres introspectScheduledJobs probes pg_cron / pgAgent.
// -----------------------------------------------------------------------------

describe('Postgres introspectScheduledJobs (Group F)', () => {
  it('maps a pg_cron job row through + probes via to_regclass', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/cron\.job/i, [
      {
        job_name: 'nightly_rollup',
        schedule: '0 3 * * *',
        command: 'CALL refresh_rollups()',
        active: true,
      },
    ]);
    // pgAgent not installed -> no rows (default mock return).

    await pack.connect(ctx);
    const jobs = await pack.introspectScheduledJobs(ctx);
    await pack.close();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobName).toBe('nightly_rollup');
    expect(jobs[0].scheduler).toBe('pg_cron');
    expect(jobs[0].schedule).toBe('0 3 * * *'); // verbatim
    expect(jobs[0].enabled).toBe(true);

    // Belt-and-braces: the cron SELECT is guarded by to_regclass.
    const cronSql = recordedQueries.find((q) => /cron\.job/i.test(q.sql));
    expect(cronSql!.sql).toMatch(/to_regclass/i);
    // And the pgAgent probe was issued too.
    const pgaSql = recordedQueries.find((q) => /pgagent\.pga_job/i.test(q.sql));
    expect(pgaSql).toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// Sybase sidecar -> IR mapping (and the absent path).
// -----------------------------------------------------------------------------

describe('Sybase scheduled-jobs mapping (Group F)', () => {
  it('reads scheduler jobs from the sidecar when present and defaults to [] when absent', () => {
    const withJobs: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [],
      tables: [],
      columns: [],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
      scheduledJobs: [
        {
          schemaName: 'dbo',
          jobName: 'purge_audit',
          schedule: 'daily 02:00',
          command: 'exec sp_purge_audit',
          enabled: true,
        },
      ],
    };
    const ir = transformSidecarIntrospection(withJobs);
    expect(ir.scheduledJobs).toHaveLength(1);
    expect(ir.scheduledJobs![0].jobName).toBe('purge_audit');
    // scheduler defaulted to the Sybase label when the sidecar omits it.
    expect(ir.scheduledJobs![0].scheduler).toBe('sybase_job_scheduler');

    // Absent path: current sidecar build projects no jobs array -> [].
    const noJobs: SidecarIntrospectionResponse = {
      ...withJobs,
      scheduledJobs: undefined,
    };
    const ir2 = transformSidecarIntrospection(noJobs);
    expect(ir2.scheduledJobs).toEqual([]);
  });
});
