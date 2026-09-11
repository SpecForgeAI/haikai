/**
 * Regression cover for the candidate persistence wiring in
 * `startDatabaseRun`.
 *
 * Pre-fix: the database orchestrator generated `physical_data_entities` and
 * `physical_data_attributes` candidates but the run-manager only logged a
 * count -- the `bulkSaveCandidates` call was left as a TODO. Result:
 * discovery runs completed with 0 viewable architecture candidates in the
 * UI even when 800+ tables were introspected.
 *
 * Fix: convert the orchestrator's lightweight payload list into
 * DiscoveryCandidate rows (UUIDs minted per-batch, parent linkage resolved
 * via the clientId map), sort parents-first, and call bulkSaveCandidates
 * in batches of 200. Per-batch errors are logged but do NOT fail the run.
 *
 * These tests fix the contract at the discovery-service boundary so the
 * regression cannot silently reappear.
 */

import type { DatabaseCandidatePayload } from '../services/databasePacks/DatabaseDiscoveryPack';

// ---------------------------------------------------------------------------
// Module mocks. We mock the two collaborators `startDatabaseRun` calls:
//   1. archModelClient -- for updateDiscoveryRun + bulkSaveCandidates.
//   2. runDatabasePackDiscovery -- the orchestrator that returns the
//      DatabaseCandidatePayload[] our run-manager must now persist.
// ---------------------------------------------------------------------------

const mockBulkSaveCandidates = jest.fn();
const mockUpdateDiscoveryRun = jest.fn();

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    bulkSaveCandidates: (...args: unknown[]) => mockBulkSaveCandidates(...args),
    updateDiscoveryRun: (...args: unknown[]) => mockUpdateDiscoveryRun(...args),
  },
  buildLibraryFindOrCreatePayload: jest.fn(),
  buildCodeUnitDependencyFindOrCreatePayload: jest.fn(),
}));

const mockRunDatabasePackDiscovery = jest.fn();
jest.mock('../services/databasePacks/databasePackOrchestrator', () => ({
  runDatabasePackDiscovery: (...args: unknown[]) =>
    mockRunDatabasePackDiscovery(...args),
}));

// Some unrelated modules pull in heavy graphs at import time. Stub the ones
// that don't matter for this test surface.
jest.mock('../services/repoAccess', () => ({
  buildTempDir: () => '/tmp/test',
  gitCloneRepoAccess: { cloneRepo: jest.fn() },
  isGitRepoUrl: () => true,
  normalizeRepoLocation: (x: unknown) => x,
  normalizeRepoSubfolder: (x: unknown) => x,
}));

import { startDatabaseRun } from '../services/runManager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTablePayload(i: number): DatabaseCandidatePayload {
  return {
    candidateType: 'physical_data_entities',
    name: `t${i}`,
    filePath: `db://sybase/dbo/t${i}`,
    clientId: `sybtab:dbo.t${i}`,
    data: {
      dbEngine: 'sybase',
      schemaName: 'dbo',
      objectName: `t${i}`,
      objectType: 'table',
      confidence: 1.0,
    },
  };
}

function makeColumnPayload(tableI: number, columnI: number): DatabaseCandidatePayload {
  return {
    candidateType: 'physical_data_attributes',
    name: `c${columnI}`,
    filePath: `db://sybase/dbo/t${tableI}#c${columnI}`,
    clientId: `sybtab:dbo.t${tableI}#c${columnI}`,
    parentCandidateClientId: `sybtab:dbo.t${tableI}`,
    data: {
      dbEngine: 'sybase',
      schemaName: 'dbo',
      tableName: `t${tableI}`,
      columnName: `c${columnI}`,
      dataType: 'varchar',
      isNullable: true,
      ordinalPosition: columnI,
      confidence: 1.0,
    },
  };
}

function makeOrchestratorResult(candidates: DatabaseCandidatePayload[]) {
  return {
    engineKey: 'sybase',
    connectedOk: true,
    shortCircuited: false,
    introspection: {
      schemas: [],
      tables: candidates.filter((c) => c.candidateType === 'physical_data_entities'),
      columns: candidates.filter((c) => c.candidateType === 'physical_data_attributes'),
      views: [],
      procedures: [],
      triggers: [],
      keysAndIndexes: [],
    },
    profile: { tables: [], skippedTables: [] },
    relationships: [],
    candidates,
    emittedFindings: [],
    warningFindings: [],
    // Oracle Nine envelope additions (2026-08-23): present-but-empty, the
    // shape every modern pack returns.
    procSources: [],
    sequenceIdioms: [],
    serverCharset: null,
    keyProbes: [],
  };
}

const baseOptions = {
  databaseConfig: {
    dbEngine: 'sybase' as const,
    host: 'h',
    port: 5000,
    databaseName: 'demo',
    profilingMode: 'standard' as const,
    maxTablesToProfile: 100,
    maxRowsPerProfileQuery: 1000,
    queryTimeoutSeconds: 30,
    allowWorkloadLogUpload: false,
  },
  databaseCredentials: { username: 'u', password: 'p' },
};

describe('startDatabaseRun candidate persistence (Spec 2026-05-16 follow-up fix)', () => {
  beforeEach(() => {
    mockBulkSaveCandidates.mockReset();
    mockUpdateDiscoveryRun.mockReset();
    mockRunDatabasePackDiscovery.mockReset();
    mockBulkSaveCandidates.mockResolvedValue(undefined);
    mockUpdateDiscoveryRun.mockResolvedValue(undefined);
  });

  it('persists all candidates in one batch when count <= 200', async () => {
    const payloads: DatabaseCandidatePayload[] = [
      makeTablePayload(1),
      makeColumnPayload(1, 1),
      makeColumnPayload(1, 2),
    ];
    mockRunDatabasePackDiscovery.mockResolvedValue(makeOrchestratorResult(payloads));

    await startDatabaseRun('proj', 'run', 'arch', baseOptions as never);

    expect(mockBulkSaveCandidates).toHaveBeenCalledTimes(1);
    const [proj, run, batch] = mockBulkSaveCandidates.mock.calls[0];
    expect(proj).toBe('proj');
    expect(run).toBe('run');
    expect(batch).toHaveLength(3);
    // Every emitted DiscoveryCandidate carries the runId we passed.
    for (const c of batch) {
      expect(c.runId).toBe('run');
      expect(c.status).toBe('proposed');
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
    }
    // Final updateDiscoveryRun call should report candidatesPersisted=3.
    const finalUpdate = mockUpdateDiscoveryRun.mock.calls.find(
      (call) => (call[2] as { status?: string })?.status === 'COMPLETED',
    );
    expect(finalUpdate).toBeDefined();
    const stepsPayload = (finalUpdate![2] as { steps_payload?: { database?: Record<string, unknown> } })
      .steps_payload;
    expect(stepsPayload?.database?.candidatesPersisted).toBe(3);
  });

  it('splits into ceil(N/200) batches when count exceeds 200', async () => {
    // 1 parent table per "table" + 1 column each. 200 tables + 200 columns = 400 candidates.
    const payloads: DatabaseCandidatePayload[] = [];
    for (let i = 0; i < 200; i++) {
      payloads.push(makeTablePayload(i));
      payloads.push(makeColumnPayload(i, 1));
    }
    mockRunDatabasePackDiscovery.mockResolvedValue(makeOrchestratorResult(payloads));

    await startDatabaseRun('proj', 'run', 'arch', baseOptions as never);

    expect(mockBulkSaveCandidates).toHaveBeenCalledTimes(2);
    const batchSizes = mockBulkSaveCandidates.mock.calls.map((c) => (c[2] as unknown[]).length);
    expect(batchSizes).toEqual([200, 200]);

    // parents-first sort guarantees: every batch's children point at a
    // parentCandidateId that appears either earlier in this batch OR in a
    // prior batch. The set of all parent UUIDs persisted up to and
    // including each batch must cover every child's parentCandidateId.
    const seenIds = new Set<string>();
    for (const call of mockBulkSaveCandidates.mock.calls) {
      const batch = call[2] as Array<{ id: string; parentCandidateId?: string }>;
      for (const row of batch) {
        if (row.parentCandidateId) {
          expect(seenIds.has(row.parentCandidateId)).toBe(true);
        }
        seenIds.add(row.id);
      }
    }
  });

  it('logs a batch failure but continues with subsequent batches (soft-fail)', async () => {
    const payloads: DatabaseCandidatePayload[] = [];
    for (let i = 0; i < 250; i++) {
      payloads.push(makeTablePayload(i));
    }
    mockRunDatabasePackDiscovery.mockResolvedValue(makeOrchestratorResult(payloads));

    // First batch (200) throws; second batch (50) succeeds.
    mockBulkSaveCandidates
      .mockRejectedValueOnce(new Error('AMS transient error'))
      .mockResolvedValueOnce(undefined);

    await startDatabaseRun('proj', 'run', 'arch', baseOptions as never);

    expect(mockBulkSaveCandidates).toHaveBeenCalledTimes(2);

    // The run still reaches COMPLETED (the orchestrator's introspection
    // succeeded; partial persistence is non-fatal).
    const finalUpdate = mockUpdateDiscoveryRun.mock.calls.find(
      (call) => (call[2] as { status?: string })?.status === 'COMPLETED',
    );
    expect(finalUpdate).toBeDefined();
    const stepsPayload = (finalUpdate![2] as { steps_payload?: { database?: Record<string, unknown> } })
      .steps_payload;
    // Only the second batch's 50 rows were persisted.
    expect(stepsPayload?.database?.candidatesPersisted).toBe(50);
    expect(stepsPayload?.database?.candidateCount).toBe(250);
  });

  it('resolves child parentCandidateId to the parent table candidate UUID within the same conversion', async () => {
    const payloads: DatabaseCandidatePayload[] = [
      makeTablePayload(7),
      makeColumnPayload(7, 1),
      makeColumnPayload(7, 2),
    ];
    mockRunDatabasePackDiscovery.mockResolvedValue(makeOrchestratorResult(payloads));

    await startDatabaseRun('proj', 'run', 'arch', baseOptions as never);

    const batch = mockBulkSaveCandidates.mock.calls[0][2] as Array<{
      candidateType: string;
      name: string;
      id: string;
      parentCandidateId?: string;
    }>;
    const table = batch.find((c) => c.candidateType === 'physical_data_entities');
    const cols = batch.filter((c) => c.candidateType === 'physical_data_attributes');
    expect(table).toBeDefined();
    expect(cols).toHaveLength(2);
    for (const col of cols) {
      expect(col.parentCandidateId).toBe(table!.id);
    }
  });

  // ---------------------------------------------------------------------------
  // SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11): the
  // persistence path is engine-NEUTRAL. It must carry an `mssql` payload --
  // `db://mssql/` URIs, `mstab:` client ids, `data.dbEngine = 'mssql'` --
  // through unchanged, with the parent linkage resolved exactly as for Sybase.
  // ---------------------------------------------------------------------------

  it('persists an mssql payload with its engine vocabulary and parent linkage intact', async () => {
    const table: DatabaseCandidatePayload = {
      candidateType: 'physical_data_entities',
      name: 'Customers',
      filePath: 'db://mssql/Sales/Customers',
      clientId: 'mstab:Sales.Customers',
      data: {
        dbEngine: 'mssql',
        databaseName: 'WideWorldImporters',
        schemaName: 'Sales',
        objectName: 'Customers',
        objectType: 'table',
        confidence: 1.0,
      },
    };
    const column: DatabaseCandidatePayload = {
      candidateType: 'physical_data_attributes',
      name: 'CustomerName',
      filePath: 'db://mssql/Sales/Customers#CustomerName',
      clientId: 'mstab:Sales.Customers#CustomerName',
      parentCandidateClientId: 'mstab:Sales.Customers',
      data: {
        dbEngine: 'mssql',
        databaseName: 'WideWorldImporters',
        schemaName: 'Sales',
        tableName: 'Customers',
        columnName: 'CustomerName',
        dataType: 'nvarchar',
        maxLength: 100,
        isNullable: false,
        ordinalPosition: 2,
        collation: 'Latin1_General_CI_AS',
        confidence: 1.0,
      },
    };
    const result = makeOrchestratorResult([table, column]);
    result.engineKey = 'mssql';
    mockRunDatabasePackDiscovery.mockResolvedValue(result);

    await startDatabaseRun('proj', 'run', 'arch', {
      ...baseOptions,
      databaseConfig: {
        ...baseOptions.databaseConfig,
        dbEngine: 'mssql' as const,
        port: 1433,
        databaseName: 'WideWorldImporters',
        mssqlAuth: {
          scheme: 'ntlm' as const,
          domain: 'CORPDOMAIN',
          encrypt: true,
          trustServerCertificate: false,
          instanceName: null,
        },
      },
    } as never);

    expect(mockBulkSaveCandidates).toHaveBeenCalledTimes(1);
    const batch = mockBulkSaveCandidates.mock.calls[0][2] as Array<{
      candidateType: string;
      name: string;
      id: string;
      runId: string;
      status: string;
      sourceClusterIds?: string[];
      parentCandidateId?: string;
      data?: Record<string, unknown>;
    }>;
    expect(batch).toHaveLength(2);
    const persistedTable = batch.find(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const persistedColumn = batch.find(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    // `sourceClusterIds` is the persisted carrier for the pack's synthetic
    // `db://` URI (see the conversion in runManager).
    expect(persistedTable?.sourceClusterIds).toEqual(['db://mssql/Sales/Customers']);
    expect((persistedTable?.data ?? {}).dbEngine).toBe('mssql');
    expect((persistedColumn?.data ?? {}).collation).toBe('Latin1_General_CI_AS');
    expect(persistedColumn?.parentCandidateId).toBe(persistedTable!.id);
    for (const c of batch) {
      expect(c.runId).toBe('run');
      expect(c.status).toBe('proposed');
    }

    const finalUpdate = mockUpdateDiscoveryRun.mock.calls.find(
      (call) => (call[2] as { status?: string })?.status === 'COMPLETED',
    );
    expect(finalUpdate).toBeDefined();
    const stepsPayload = (
      finalUpdate![2] as { steps_payload?: { database?: Record<string, unknown> } }
    ).steps_payload;
    expect(stepsPayload?.database?.candidatesPersisted).toBe(2);
    // The run's own record of which engine it scanned.
    expect(stepsPayload?.database?.engineKey).toBe('mssql');
  });
});
