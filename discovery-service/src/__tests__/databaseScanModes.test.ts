/**
 * Model-write-free database scan modes — focused tests.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 4 (Task 4.1, discovery-service half).
 *
 * Covers ONLY:
 *   1. The verification-only scan returns the normalized actual-schema
 *      snapshot and performs ZERO model writes — no candidates, no findings,
 *      no run rows (the archModelClient / findingEmitter / orchestrator write
 *      paths are asserted never-invoked, and the pack's own candidate/finding
 *      emitters are never called).
 *   2. The refresh-seeds scan returns ONLY sequence/identity current values
 *      and likewise writes nothing to the model.
 *   3. Credentials flow through the per-invocation secretsStore bundle and
 *      are PURGED at completion (the bundle is empty after the request, and
 *      the pack received the credentials only via the in-memory context).
 */

// ---------------------------------------------------------------------------
// Mocks — every model-write path is mocked so any invocation is detectable.
// ---------------------------------------------------------------------------

jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    createDiscoveryRun: jest.fn(),
    updateDiscoveryRun: jest.fn(),
    bulkSaveCandidates: jest.fn(),
    bulkSaveEvidence: jest.fn(),
    bulkSaveRelationships: jest.fn(),
    bulkSaveClusters: jest.fn(),
    bulkSaveDecisionTasks: jest.fn(),
  },
}));

jest.mock('../services/findings/FindingEmitter', () => {
  const actual = jest.requireActual('../services/findings/FindingEmitter');
  return {
    ...actual,
    findingEmitter: {
      emitFinding: jest.fn(),
      emitFindings: jest.fn(),
    },
  };
});

jest.mock('../services/databasePacks/databasePackOrchestrator', () => ({
  runDatabasePackDiscovery: jest.fn(),
  capFindingsPerType: jest.fn(),
  buildRelationshipCandidates: jest.fn(),
}));

const mockGetDatabasePack = jest.fn();
jest.mock('../services/databasePacks/databasePackFactory', () => ({
  getDatabasePack: (...args: unknown[]) => mockGetDatabasePack(...args),
}));

import express from 'express';
import request from 'supertest';
import { databaseRouter } from '../routes/database';
import { archModelClient } from '../services/archModelClient';
import { findingEmitter } from '../services/findings/FindingEmitter';
import { runDatabasePackDiscovery } from '../services/databasePacks/databasePackOrchestrator';
import {
  resetAllForTests,
  sizeForTests,
} from '../services/databasePacks/secretsStore';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/discovery/db', databaseRouter);
  return app;
}

/** Assert ZERO model writes happened across every mocked write path. */
function expectZeroModelWrites(): void {
  for (const fn of Object.values(
    archModelClient as unknown as Record<string, jest.Mock>
  )) {
    expect(fn).not.toHaveBeenCalled();
  }
  expect(
    (findingEmitter as unknown as { emitFinding: jest.Mock }).emitFinding
  ).not.toHaveBeenCalled();
  expect(
    (findingEmitter as unknown as { emitFindings: jest.Mock }).emitFindings
  ).not.toHaveBeenCalled();
  expect(runDatabasePackDiscovery).not.toHaveBeenCalled();
}

const SNAPSHOT = {
  scanMode: 'verification_only' as const,
  engine: 'postgres' as const,
  schemas: [{ schemaName: 'dbo', owner: null }],
  tables: [
    { schemaName: 'dbo', tableName: 'orders', objectType: 'table', estimatedRowCount: 10 },
  ],
  columns: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'order_id',
      dataType: 'integer',
      isNullable: false,
      ordinalPosition: 1,
      isIdentity: true,
    },
  ],
  keysAndIndexes: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      kind: 'primary_key' as const,
      name: 'pk_orders',
      columns: ['order_id'],
      isUnique: true,
    },
  ],
  sequences: [],
};

interface FakePack {
  engineKey: string;
  displayName: string;
  connect: jest.Mock;
  close: jest.Mock;
  runVerificationOnlyScan?: jest.Mock;
  introspectSequences?: jest.Mock;
  introspectColumns: jest.Mock;
  emitCandidates: jest.Mock;
  emitFindings: jest.Mock;
}

function fakePostgresPack(): FakePack {
  return {
    engineKey: 'postgres',
    displayName: 'PostgreSQL',
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    runVerificationOnlyScan: jest.fn().mockResolvedValue(SNAPSHOT),
    introspectColumns: jest.fn().mockResolvedValue([]),
    emitCandidates: jest.fn(),
    emitFindings: jest.fn(),
  };
}

function fakeSybasePack(): FakePack {
  return {
    engineKey: 'sybase',
    displayName: 'Sybase ASE',
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    introspectSequences: jest.fn().mockResolvedValue([
      {
        schemaName: 'dbo',
        sequenceName: 'orders_seq',
        currentValue: '50230',
        startValue: '1',
        ownedByTable: 'orders',
        ownedByColumn: 'order_id',
      },
    ]),
    introspectColumns: jest.fn().mockResolvedValue([
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'order_id',
        dataType: 'int',
        isNullable: false,
        ordinalPosition: 1,
        isIdentity: true,
        sequenceName: 'orders_seq',
      },
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'note',
        dataType: 'varchar',
        isNullable: true,
        ordinalPosition: 2,
        isIdentity: false,
      },
    ]),
    emitCandidates: jest.fn(),
    emitFindings: jest.fn(),
  };
}

function fakeMssqlPack(): FakePack {
  return {
    engineKey: 'mssql',
    displayName: 'SQL Server',
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    introspectSequences: jest.fn().mockResolvedValue([
      {
        schemaName: 'Sequences',
        sequenceName: 'CustomerID',
        currentValue: '1062',
        startValue: '1110',
        ownedByTable: null,
        ownedByColumn: null,
      },
    ]),
    introspectColumns: jest.fn().mockResolvedValue([
      {
        schemaName: 'Warehouse',
        tableName: 'VehicleTemperatures',
        columnName: 'VehicleTemperatureID',
        dataType: 'bigint',
        isNullable: false,
        ordinalPosition: 1,
        isIdentity: true,
      },
      {
        schemaName: 'Sales',
        tableName: 'Customers',
        columnName: 'CustomerName',
        dataType: 'nvarchar',
        isNullable: false,
        ordinalPosition: 2,
        isIdentity: false,
      },
    ]),
    emitCandidates: jest.fn(),
    emitFindings: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAllForTests();
});

describe('POST /discovery/db/verification-scan (Task 4.2)', () => {
  it('returns the normalized actual-schema snapshot and performs ZERO model writes', async () => {
    const pack = fakePostgresPack();
    mockGetDatabasePack.mockReturnValue(pack);

    const res = await request(createTestApp())
      .post('/discovery/db/verification-scan')
      .send({
        host: 'target-pg',
        port: 5432,
        databaseName: 'orders_db',
        username: 'verifier',
        password: 's3cret',
        scope: { schemas: ['dbo'], tables: ['dbo.orders'] },
      });

    expect(res.status).toBe(200);
    expect(res.body.scan_mode).toBe('verification_only');
    expect(res.body.snapshot.tables).toEqual(SNAPSHOT.tables);
    expect(res.body.snapshot.columns).toEqual(SNAPSHOT.columns);
    expect(res.body.snapshot.keysAndIndexes).toEqual(SNAPSHOT.keysAndIndexes);
    expect(res.body.scope).toEqual({ schemas: ['dbo'], tables: ['dbo.orders'] });

    // The scope filter reached the introspection config.
    const ctx = pack.runVerificationOnlyScan!.mock.calls[0][0];
    expect(ctx.config.includeSchemas).toEqual(['dbo']);
    expect(ctx.config.includeTables).toEqual(['orders']);
    expect(ctx.config.profilingMode).toBe('none');

    // ZERO model writes: no candidates, no findings, no run rows — neither
    // through the shared clients nor through the pack's own emitters.
    expectZeroModelWrites();
    expect(pack.emitCandidates).not.toHaveBeenCalled();
    expect(pack.emitFindings).not.toHaveBeenCalled();
  });
});

describe('POST /discovery/db/refresh-seeds-scan (Task 4.3)', () => {
  it('returns ONLY sequence/identity current values and writes nothing to the model', async () => {
    const pack = fakeSybasePack();
    mockGetDatabasePack.mockReturnValue(pack);

    const res = await request(createTestApp())
      .post('/discovery/db/refresh-seeds-scan')
      .send({
        host: 'sybase-src',
        port: 5000,
        databaseName: 'legacy_db',
        username: 'reader',
        password: 'pw',
      });

    expect(res.status).toBe(200);
    expect(res.body.scan_mode).toBe('refresh_seeds');
    expect(res.body.sequences).toEqual([
      expect.objectContaining({ sequenceName: 'orders_seq', currentValue: '50230' }),
    ]);
    // ONLY identity columns are returned (the non-identity column is not).
    expect(res.body.identity_columns).toEqual([
      {
        schemaName: 'dbo',
        tableName: 'orders',
        columnName: 'order_id',
        sequenceName: 'orders_seq',
      },
    ]);
    // Nothing beyond the snapshot keys is in the response (no candidates /
    // findings payloads of any kind).
    expect(Object.keys(res.body).sort()).toEqual([
      'engine',
      'identity_columns',
      'scan_mode',
      'sequences',
      'success',
    ]);

    expectZeroModelWrites();
    expect(pack.emitCandidates).not.toHaveBeenCalled();
    expect(pack.emitFindings).not.toHaveBeenCalled();
    // No `dbEngine` in the body => `sybase`, the back-compat default every
    // caller written before SQL Server became a source engine sends.
    expect(mockGetDatabasePack).toHaveBeenCalledWith('sybase');
    expect(res.body.engine).toBe('sybase');
  });

  // SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11): the
  // refresh-seeds scan reads the migration SOURCE, so it takes the source
  // engine from the request instead of hardcoding one. VERIFICATION-ONLY is
  // deliberately NOT widened: it reads the TARGET, which is PostgreSQL for
  // every supported pair.
  it('routes to the mssql pack when the body asks for it, and echoes the engine back', async () => {
    const pack = fakeMssqlPack();
    mockGetDatabasePack.mockReturnValue(pack);

    const res = await request(createTestApp())
      .post('/discovery/db/refresh-seeds-scan')
      .send({
        dbEngine: 'mssql',
        host: 'sqlsrv-src',
        port: 1433,
        databaseName: 'WideWorldImporters',
        username: 'reader',
        password: 'pw',
        mssqlAuth: {
          scheme: 'ntlm',
          domain: 'CORPDOMAIN',
          encrypt: true,
          trustServerCertificate: false,
        },
      });

    expect(res.status).toBe(200);
    expect(mockGetDatabasePack).toHaveBeenCalledWith('mssql');
    expect(res.body.engine).toBe('mssql');
    expect(res.body.scan_mode).toBe('refresh_seeds');
    expect(res.body.sequences).toEqual([
      expect.objectContaining({ sequenceName: 'CustomerID', currentValue: '1062' }),
    ]);
    expect(res.body.identity_columns).toEqual([
      {
        schemaName: 'Warehouse',
        tableName: 'VehicleTemperatures',
        columnName: 'VehicleTemperatureID',
        sequenceName: null,
      },
    ]);
    // The connection extras reach the pack through the run config.
    const ctx = pack.connect.mock.calls[0][0] as {
      config: { dbEngine: string; mssqlAuth?: { scheme?: string; domain?: string } };
    };
    expect(ctx.config.dbEngine).toBe('mssql');
    expect(ctx.config.mssqlAuth).toMatchObject({
      scheme: 'ntlm',
      domain: 'CORPDOMAIN',
    });
    expectZeroModelWrites();
  });

  it('rejects a TARGET engine (postgres) with a 400 naming the accepted source engines', async () => {
    const res = await request(createTestApp())
      .post('/discovery/db/refresh-seeds-scan')
      .send({
        dbEngine: 'postgres',
        host: 'pg-target',
        port: 5432,
        databaseName: 'target_db',
        username: 'reader',
        password: 'pw',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/"sybase", "mssql"/);
    expect(res.body.error.message).toMatch(/SOURCE/);
    expect(mockGetDatabasePack).not.toHaveBeenCalled();
    expectZeroModelWrites();
  });
});

describe('per-invocation credentials (secretsStore contract)', () => {
  it('passes credentials through the in-memory bundle and purges them at completion — for both scan modes and on failure', async () => {
    const pgPack = fakePostgresPack();
    mockGetDatabasePack.mockReturnValue(pgPack);
    const app = createTestApp();

    await request(app).post('/discovery/db/verification-scan').send({
      host: 'target-pg',
      port: 5432,
      databaseName: 'orders_db',
      username: 'verifier',
      password: 's3cret',
    });
    // The pack received the credentials ONLY via the in-memory context...
    expect(pgPack.connect.mock.calls[0][0].credentials).toEqual({
      username: 'verifier',
      password: 's3cret',
    });
    // ...and the bundle is empty after completion (purged in finally).
    expect(sizeForTests()).toBe(0);

    // Refresh-seeds: same purge contract, including a FAILING scan.
    const syPack = fakeSybasePack();
    syPack.introspectSequences!.mockRejectedValueOnce(new Error('sidecar down'));
    mockGetDatabasePack.mockReturnValue(syPack);
    const failed = await request(app).post('/discovery/db/refresh-seeds-scan').send({
      host: 'sybase-src',
      port: 5000,
      databaseName: 'legacy_db',
      username: 'reader',
      password: 'pw',
    });
    expect(failed.status).toBe(400);
    expect(sizeForTests()).toBe(0);
    expectZeroModelWrites();
  });
});
