/**
 * Group 6 cross-stack gap-fill tests for Database Discovery Packs.
 *
 * Spec: 2026-05-16 Database Discovery Packs (Sybase + PostgreSQL) -- Task
 * Group 6.
 *
 * Existing per-engine candidate-emission tests live in:
 *   - postgresDiscoveryPack.test.ts: "emits one physical_data_entity per
 *     table and one physical_data_attribute per column"
 *   - sybaseDiscoveryPack.test.ts: covers introspect / profile / findings
 *     but does NOT cover emitCandidates (gap).
 *
 * This file closes two gaps explicitly called out for Group 6:
 *
 *   (a) Cross-engine candidate shape consistency: the Postgres, Sybase and
 *       (SQL Server pair programme, Spec 2, 2026-09-11) SQL Server packs MUST
 *       emit the same {@code DatabaseCandidatePayload} shape for an equivalent
 *       introspection input. Only {@code data.dbEngine}, the {@code db://}
 *       URI prefix and the client-id prefix differ.
 *
 *   (b) Regression: the runManager dispatch branch on
 *       {@code options.discoveryKind === 'database'} flips correctly.
 *       The dispatch fires {@code startDatabaseRun} which has a documented
 *       guard error that we can observe via the mocked archModelClient.
 *
 * Hard cap: 3 tests in this file (gateway + frontend already used 2+2; total
 * stays at 7 across all Group 6 files, well under the 10-test cap).
 */

// -----------------------------------------------------------------------------
// Hoisted mocks (Jest pattern: jest.mock calls are hoisted, so any imports
// pulled in by the file under test resolve to the mocked module).
// -----------------------------------------------------------------------------

jest.mock('../services/archModelClient', () => {
  return {
    archModelClient: {
      createDiscoveryRun: jest.fn(),
      updateDiscoveryRun: jest.fn().mockResolvedValue(undefined),
      getDiscoveryRun: jest.fn(),
      getDiscoveryConfig: jest.fn(),
      bulkSaveEvidence: jest.fn(),
      getEvidenceByRun: jest.fn().mockResolvedValue([]),
      bulkSaveRelationships: jest.fn(),
      getRelationshipsByRun: jest.fn().mockResolvedValue([]),
      bulkSaveCandidates: jest.fn(),
      getCandidatesByRun: jest.fn().mockResolvedValue([]),
      bulkSaveDecisionTasks: jest.fn(),
      bulkSaveClusters: jest.fn(),
      getClustersByRun: jest.fn().mockResolvedValue([]),
      deleteClustersByRunId: jest.fn().mockResolvedValue(0),
      deleteCandidatesByRunId: jest.fn().mockResolvedValue(0),
      resetDefaultArchitectureCache: jest.fn(),
    },
  };
});

// Lightweight mocks for ancillary modules touched by startRun's early branch.
jest.mock('dotenv', () => ({ config: jest.fn() }));

import {
  PostgresDiscoveryPack,
} from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { SybaseDiscoveryPack } from '../services/databasePacks/sybase/SybaseDiscoveryPack';
import { MssqlDiscoveryPack } from '../services/databasePacks/mssql/MssqlDiscoveryPack';
import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPackContext,
} from '../services/databasePacks/DatabaseDiscoveryPack';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  DatabaseEngine,
  IntrospectionResult,
  ProfileResult,
} from '../services/databasePacks/types';
import { DEFAULT_PORT_BY_ENGINE } from '../services/databasePacks/types';

// -----------------------------------------------------------------------------
// (a) Cross-engine candidate shape consistency
// -----------------------------------------------------------------------------

function sharedIntrospection(): IntrospectionResult {
  return {
    schemas: [],
    tables: [
      {
        schemaName: 'public',
        tableName: 'users',
        objectType: 'table',
        estimatedRowCount: 42,
        comment: null,
      },
    ],
    columns: [
      {
        schemaName: 'public',
        tableName: 'users',
        columnName: 'id',
        dataType: 'integer',
        isNullable: false,
        ordinalPosition: 1,
      },
      {
        schemaName: 'public',
        tableName: 'users',
        columnName: 'email',
        dataType: 'varchar',
        isNullable: true,
        ordinalPosition: 2,
        maxLength: 255,
      },
    ],
    keysAndIndexes: [
      {
        schemaName: 'public',
        tableName: 'users',
        kind: 'primary_key',
        name: 'users_pkey',
        columns: ['id'],
      },
    ],
    views: [],
    procedures: [],
    triggers: [],
  };
}

function makeConfig(engine: DatabaseEngine): DatabaseDiscoveryConfig {
  return {
    dbEngine: engine,
    host: 'db.test',
    port: DEFAULT_PORT_BY_ENGINE[engine],
    databaseName: 'demo',
    catalogName: null,
    schemaName: 'public',
    includeSchemas: null,
    excludeSchemas: null,
    includeTables: null,
    excludeTables: null,
    profilingMode: 'standard',
    maxTablesToProfile: 100,
    maxRowsPerProfileQuery: 1000,
    queryTimeoutSeconds: 30,
    allowWorkloadLogUpload: false,
    readOnlyConfirmed: true,
    username: 'svc_discovery_ro',
  };
}

function makeCreds(): DatabaseDiscoveryCredentials {
  return { username: 'svc_discovery_ro', password: 'ignored-mock' };
}

function makeCtx(engine: DatabaseEngine): DatabaseDiscoveryPackContext {
  return {
    config: makeConfig(engine),
    credentials: makeCreds(),
    runId: `run-${engine}-cross`,
    projectId: 'proj-cross',
    architectureId: 'arch-cross',
  };
}

describe('Cross-engine DatabaseCandidatePayload shape (Spec 2026-05-16, Group 6 gap-fill)', () => {
  it('Postgres, Sybase and SQL Server emitCandidates produce identical shapes for the same introspection input (only data.dbEngine differs)', async () => {
    const intro = sharedIntrospection();
    const emptyProfile: ProfileResult = { tables: [], skippedTables: [] };

    // emitCandidates is a pure introspection->payload transformer on all three
    // packs (no I/O), so we can skip connect() and the underlying pool /
    // sidecar entirely.
    const pgPack = new PostgresDiscoveryPack();
    const pgCandidates = await pgPack.emitCandidates(
      makeCtx('postgres'),
      intro,
      emptyProfile,
    );
    const sybPack = new SybaseDiscoveryPack();
    const sybCandidates = await sybPack.emitCandidates(
      makeCtx('sybase'),
      intro,
      emptyProfile,
    );
    const msPack = new MssqlDiscoveryPack();
    const msCandidates = await msPack.emitCandidates(
      makeCtx('mssql'),
      intro,
      emptyProfile,
    );

    expect(pgCandidates.length).toBe(sybCandidates.length);
    expect(pgCandidates.length).toBe(msCandidates.length);
    const pgTables = pgCandidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const pgAttrs = pgCandidates.filter(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    const sybTables = sybCandidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const sybAttrs = sybCandidates.filter(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    const msTables = msCandidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const msAttrs = msCandidates.filter(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    expect(pgTables.length).toBe(1);
    expect(sybTables.length).toBe(1);
    expect(msTables.length).toBe(1);
    expect(pgAttrs.length).toBe(2);
    expect(sybAttrs.length).toBe(2);
    expect(msAttrs.length).toBe(2);

    // Same top-level key set on the candidate envelope.
    const topKeys = (c: DatabaseCandidatePayload) => Object.keys(c).sort();
    expect(topKeys(pgTables[0])).toEqual(topKeys(sybTables[0]));
    expect(topKeys(pgTables[0])).toEqual(topKeys(msTables[0]));
    // Same `data` key set (only the values differ for the engine name).
    const dataKeys = (c: DatabaseCandidatePayload) => Object.keys(c.data).sort();
    expect(dataKeys(pgTables[0])).toEqual(dataKeys(sybTables[0]));
    expect(dataKeys(pgTables[0])).toEqual(dataKeys(msTables[0]));
    expect(dataKeys(pgAttrs[0])).toEqual(dataKeys(sybAttrs[0]));
    expect(dataKeys(pgAttrs[0])).toEqual(dataKeys(msAttrs[0]));

    expect(pgTables[0].name).toBe(sybTables[0].name);
    expect(pgTables[0].name).toBe(msTables[0].name);
    expect(pgAttrs[0].parentCandidateClientId).toBe(pgTables[0].clientId);
    expect(sybAttrs[0].parentCandidateClientId).toBe(sybTables[0].clientId);
    expect(msAttrs[0].parentCandidateClientId).toBe(msTables[0].clientId);
    expect(pgAttrs[0].filePath.startsWith('db://postgres/')).toBe(true);
    expect(sybAttrs[0].filePath.startsWith('db://sybase/')).toBe(true);
    expect(msAttrs[0].filePath.startsWith('db://mssql/')).toBe(true);
    // The client-id prefix is per engine so a project that scanned two source
    // databases never collides two same-named tables into one candidate.
    expect(sybTables[0].clientId.startsWith('sybtab:')).toBe(true);
    expect(msTables[0].clientId.startsWith('mstab:')).toBe(true);

    const pgIdAttr = pgAttrs.find((a) => a.name === 'id')!;
    const sybIdAttr = sybAttrs.find((a) => a.name === 'id')!;
    const msIdAttr = msAttrs.find((a) => a.name === 'id')!;
    expect((pgIdAttr.data as Record<string, unknown>).isPrimaryKey).toBe(true);
    expect((sybIdAttr.data as Record<string, unknown>).isPrimaryKey).toBe(true);
    expect((msIdAttr.data as Record<string, unknown>).isPrimaryKey).toBe(true);

    expect((pgTables[0].data as Record<string, unknown>).dbEngine).toBe('postgres');
    expect((sybTables[0].data as Record<string, unknown>).dbEngine).toBe('sybase');
    expect((msTables[0].data as Record<string, unknown>).dbEngine).toBe('mssql');
  });

  it('All three packs expose the same DatabaseDiscoveryPack method surface (interface conformance)', () => {
    const pgPack = new PostgresDiscoveryPack();
    const sybPack = new SybaseDiscoveryPack();
    const msPack = new MssqlDiscoveryPack();

    expect(pgPack.engineKey).toBe('postgres');
    expect(sybPack.engineKey).toBe('sybase');
    expect(msPack.engineKey).toBe('mssql');
    expect(msPack.displayName).toBe('SQL Server');

    const requiredMethods: ReadonlyArray<keyof typeof pgPack> = [
      'connect',
      'testConnection',
      'introspectSchemas',
      'introspectTables',
      'introspectColumns',
      'introspectKeysAndIndexes',
      'introspectViews',
      'introspectProcedures',
      'introspectTriggers',
      'profileTables',
      'inferRelationships',
      'ingestWorkloadLogs',
      'emitCandidates',
      'emitFindings',
      'close',
    ];
    for (const m of requiredMethods) {
      expect(typeof (pgPack as unknown as Record<string, unknown>)[m]).toBe('function');
      expect(typeof (sybPack as unknown as Record<string, unknown>)[m]).toBe('function');
      expect(typeof (msPack as unknown as Record<string, unknown>)[m]).toBe('function');
    }

    // Optional capabilities the two T-SQL packs BOTH implement, so the
    // orchestrator's optional-method branches behave identically on either
    // source engine. (The Postgres pack is the verification-only TARGET pack
    // and deliberately implements a different optional subset.)
    const sharedTsqlCapabilities: ReadonlyArray<string> = [
      'introspectSequences',
      'introspectScheduledJobs',
      'detectServerCharset',
      'harvestProcSources',
      'profileRoutine',
      'probeKeyCandidate',
      'probeSequenceRows',
    ];
    for (const m of sharedTsqlCapabilities) {
      expect(typeof (sybPack as unknown as Record<string, unknown>)[m]).toBe('function');
      expect(typeof (msPack as unknown as Record<string, unknown>)[m]).toBe('function');
    }

    // Two optional capabilities ONLY the SQL Server pack declares, both for
    // the same reason -- the engine reports something ASE's catalog does not:
    //   - `introspectExtendedObjects`: ASE has no queues, table types,
    //     synonyms or assemblies to report, so Sybase leaves the array
    //     undefined and the orchestrator carries nothing.
    //   - `introspectDatabaseCollation`: the SQL Server catalog walk already
    //     returns the database collation, so the pack can serve it without a
    //     second round trip. The Sybase sidecar exposes no such method, so
    //     that pack does not declare it (its collation reaches the IR through
    //     the introspection transform instead).
    for (const m of ['introspectExtendedObjects', 'introspectDatabaseCollation']) {
      expect(typeof (msPack as unknown as Record<string, unknown>)[m]).toBe('function');
      expect((sybPack as unknown as Record<string, unknown>)[m]).toBeUndefined();
    }
  });
});

// -----------------------------------------------------------------------------
// (b) Regression: runManager dispatch on discoveryKind='database' actually
//     calls startDatabaseRun (observable via the documented guard-error path
//     when databaseConfig is missing). When discoveryKind is absent / 'code',
//     the guard-error is NOT seen because the code pipeline takes over.
//
//     This is the cross-spec regression net: it pins both the new dispatch
//     branch (kind='database' -> startDatabaseRun) AND the back-compat
//     property that legacy callers without `discoveryKind` keep flowing
//     through the existing path.
// -----------------------------------------------------------------------------

describe('runManager startRun dispatch on discoveryKind (Spec 2026-05-16, Group 6 regression net)', () => {
  // Import startRun lazily so the jest.mock above is in place.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startRun } = require('../services/runManager') as typeof import('../services/runManager');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { archModelClient } = require('../services/archModelClient') as {
    archModelClient: {
      updateDiscoveryRun: jest.Mock;
    };
  };

  const PROJ = 'proj-dispatch';
  const RUN = 'run-dispatch';
  const ARCH = 'arch-dispatch';
  const GUARD_ERROR =
    'startDatabaseRun: options.databaseConfig and options.databaseCredentials are required.';

  beforeEach(() => {
    archModelClient.updateDiscoveryRun.mockClear();
    archModelClient.updateDiscoveryRun.mockResolvedValue(undefined);
  });

  it('discoveryKind="database" without config fires startDatabaseRun guard (proves dispatch fires); discoveryKind=undefined does NOT trigger the database-branch guard (back-compat preserved)', async () => {
    // --- Branch 1: discoveryKind='database', missing databaseConfig. The
    // startDatabaseRun guard records FAILED with the sentinel error message.
    await startRun(PROJ, RUN, ARCH, undefined, {
      discoveryKind: 'database',
    });

    const updates = archModelClient.updateDiscoveryRun.mock.calls;
    const failedCall = updates.find((call) => {
      const payload = call[2] as { status?: string; error_message?: string };
      return payload?.status === 'FAILED' && payload?.error_message === GUARD_ERROR;
    });
    expect(failedCall).toBeDefined();
    // Database branch attempted ONE update call (the guard); code-pipeline
    // path would have made multiple step-progress calls before failing.
    expect(updates.length).toBe(1);

    // --- Branch 2: discoveryKind undefined. The code-pipeline path is
    // taken (it will eventually fail because everything downstream is
    // mocked / empty, but importantly the database-branch GUARD_ERROR
    // never appears).
    archModelClient.updateDiscoveryRun.mockClear();
    // Don't await the code-pipeline run (it has deep mock requirements).
    // Instead, kick it off and immediately inspect the FIRST update call,
    // which on the code path is the step-start metadata write (status
    // 'RUNNING'), not the database-branch FAILED record.
    const promise = startRun(PROJ, RUN, ARCH).catch(() => {
      // The code pipeline will fail at some later step due to thin mocks.
      // That's fine; we only need the FIRST update call to prove the
      // dispatch did NOT take the database branch.
    });
    // Wait for the first updateDiscoveryRun call -- the code pipeline
    // issues it during its initial step transition, before any deep deps
    // are invoked.
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (archModelClient.updateDiscoveryRun.mock.calls.length > 0) {
          resolve();
          return;
        }
        if (Date.now() - start > 2000) {
          resolve();
          return;
        }
        setTimeout(tick, 10);
      };
      tick();
    });
    await promise;

    const codeBranchUpdates = archModelClient.updateDiscoveryRun.mock.calls;
    // Whatever the code path did, NONE of its update payloads carry the
    // database-branch sentinel error -- proof the dispatch branched
    // correctly.
    const wasDatabaseBranch = codeBranchUpdates.some((call) => {
      const payload = call[2] as { error_message?: string };
      return payload?.error_message === GUARD_ERROR;
    });
    expect(wasDatabaseBranch).toBe(false);
  });
});
