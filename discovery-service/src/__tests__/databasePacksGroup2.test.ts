/**
 * Group 2 framework tests for Database Discovery Packs.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2 / tasks.md 2.1.
 *
 * Covers the focused 6-10 tests called out in 2.1:
 *  - sqlGuard SELECT-only enforcement (non-SELECT rejected)
 *  - sqlGuard multi-statement rejection
 *  - sqlGuard timeout + row-limit injection (ensureLimit)
 *  - DatabaseDiscoveryPack factory contract (engine dispatch + null safety)
 *  - Orchestrator soft-fail-per-stage on introspection
 *  - Orchestrator respects MAX_FINDINGS_PER_TYPE_PER_RUN
 *  - secretsStore store/get/purge round-trip + never-serialized contract
 *  - toRedactedConfig strips username + password, keeps host + databaseName
 *  - Per-builder shape check on the scaffold (FindingEmitInput conformance)
 *  - evidence_gap with gapType='db_*' round-trips through builder
 */

import { assertReadonlySelect, ensureLimit, SqlGuardError } from '../services/db/sqlGuard';
import { createDbAdapter } from '../services/db/dbAdapterFactory';
import {
  getDatabasePack,
  registerDatabasePack,
  resetDatabasePackRegistryForTests,
  listRegisteredEnginesForTests,
} from '../services/databasePacks/databasePackFactory';
import {
  getForRun,
  purgeForRun,
  resetAllForTests as resetSecretsForTests,
  sizeForTests as secretsSize,
  storeForRun,
} from '../services/databasePacks/secretsStore';
import {
  toRedactedConfig,
  type DatabaseDiscoveryConfig,
  type DatabaseDiscoveryCredentials,
} from '../services/databasePacks/types';
import {
  runDatabasePackDiscovery,
  capFindingsPerType,
} from '../services/databasePacks/databasePackOrchestrator';
import type {
  DatabaseDiscoveryPack,
  DatabaseDiscoveryPackContext,
} from '../services/databasePacks/DatabaseDiscoveryPack';
import {
  buildMissingPrimaryKeyFinding,
  buildNoForeignKeysDeclaredFinding,
  buildInferredRelationshipFinding,
  buildHighNullRateFinding,
  buildDbMigrationRiskFinding,
  buildStoredProcedureLogicFinding,
  buildHiddenBusinessLogicFinding,
  buildDbEvidenceGapFinding,
  buildDbPackWarningFinding,
  MAX_FINDINGS_PER_TYPE_PER_RUN,
} from '../services/findings/databasePackFindingScanners';
import type { FindingEmitInput } from '../services/findings/FindingEmitter';

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

const baseConfig = (
  overrides: Partial<DatabaseDiscoveryConfig> = {},
): DatabaseDiscoveryConfig => ({
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
  profilingMode: 'standard',
  maxTablesToProfile: 100,
  maxRowsPerProfileQuery: 1000,
  queryTimeoutSeconds: 30,
  allowWorkloadLogUpload: false,
  readOnlyConfirmed: true,
  username: 'svc_discovery_ro',
  ...overrides,
});

const baseCreds = (): DatabaseDiscoveryCredentials => ({
  username: 'svc_discovery_ro',
  password: 'super-secret-password-DO-NOT-PERSIST',
});

const baseRunContext = () => ({
  runId: 'run-db-2-1',
  projectId: 'proj-db-2-1',
  architectureId: 'arch-db-2-1',
});

/**
 * Build a minimal in-memory pack for orchestrator tests. Each method is a
 * spy so tests can control success vs throw and inspect call ordering.
 */
type FakePack = DatabaseDiscoveryPack & {
  calls: string[];
  throwOn: Set<string>;
};

function makeFakePack(opts: {
  engineKey?: 'postgres' | 'sybase';
  throwOn?: string[];
  emitFindings?: FindingEmitInput[];
} = {}): FakePack {
  const engineKey: 'postgres' | 'sybase' = opts.engineKey ?? 'postgres';
  const throwOn = new Set(opts.throwOn ?? []);
  const calls: string[] = [];
  const tap = async <T>(name: string, value: T): Promise<T> => {
    calls.push(name);
    if (throwOn.has(name)) {
      throw new Error(`fake-pack-fail: ${name}`);
    }
    return value;
  };

  return {
    engineKey,
    displayName: `Fake-${engineKey}`,
    calls,
    throwOn,
    async connect(_ctx) {
      await tap('connect', undefined);
    },
    async testConnection(_ctx) {
      return tap('testConnection', { success: true as const, serverVersion: 'fake-1.0' });
    },
    async introspectSchemas(_ctx) {
      return tap('introspectSchemas', []);
    },
    async introspectTables(_ctx) {
      return tap('introspectTables', []);
    },
    async introspectColumns(_ctx) {
      return tap('introspectColumns', []);
    },
    async introspectKeysAndIndexes(_ctx) {
      return tap('introspectKeysAndIndexes', []);
    },
    async introspectViews(_ctx) {
      return tap('introspectViews', []);
    },
    async introspectProcedures(_ctx) {
      return tap('introspectProcedures', []);
    },
    async introspectTriggers(_ctx) {
      return tap('introspectTriggers', []);
    },
    async profileTables(_ctx, _intro, _mode) {
      return tap('profileTables', { tables: [], skippedTables: [] });
    },
    async inferRelationships(_ctx, _intro, _profile) {
      return tap('inferRelationships', []);
    },
    async ingestWorkloadLogs(_ctx) {
      await tap('ingestWorkloadLogs', undefined);
    },
    async emitCandidates(_ctx, _intro, _profile) {
      return tap('emitCandidates', []);
    },
    async emitFindings(_ctx, _intro, _profile, _rel) {
      return tap('emitFindings', opts.emitFindings ?? []);
    },
    async close() {
      await tap('close', undefined);
    },
  };
}

// -----------------------------------------------------------------------------
// 1) sqlGuard -- SELECT-only enforcement
// -----------------------------------------------------------------------------

describe('sqlGuard.assertReadonlySelect', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('accepts a simple SELECT', () => {
    expect(() => assertReadonlySelect('SELECT * FROM users')).not.toThrow();
    expect(() => assertReadonlySelect('  select id, name from t  ')).not.toThrow();
    expect(() =>
      assertReadonlySelect('WITH x AS (SELECT 1) SELECT * FROM x'),
    ).not.toThrow();
  });

  it('rejects every forbidden DML / DDL / EXEC keyword', () => {
    const cases = [
      'INSERT INTO users(id) VALUES(1)',
      'UPDATE users SET name=$1',
      'DELETE FROM users WHERE id=1',
      'DROP TABLE users',
      'ALTER TABLE users ADD COLUMN x int',
      'TRUNCATE TABLE users',
      'CREATE TABLE foo(id int)',
      'MERGE INTO users USING t ON ...',
      'EXEC sp_help',
      'CALL my_proc()',
      'GRANT SELECT ON users TO ro',
      'REVOKE ALL ON users FROM ro',
    ];
    for (const sql of cases) {
      let thrown: unknown = null;
      try {
        assertReadonlySelect(sql);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SqlGuardError);
      expect((thrown as SqlGuardError).reason).toBe('forbidden_keyword');
    }
  });

  it('rejects multi-statement payloads', () => {
    let thrown: unknown = null;
    try {
      assertReadonlySelect('SELECT 1; SELECT 2');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SqlGuardError);
    expect((thrown as SqlGuardError).reason).toBe('multi_statement');
  });

  it('allows a trailing single semicolon', () => {
    expect(() => assertReadonlySelect('SELECT 1;')).not.toThrow();
    expect(() => assertReadonlySelect('SELECT 1;   ')).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 2) sqlGuard -- row-limit injection (timeout is engine-side; row limit is
//    statically observable here)
// -----------------------------------------------------------------------------

describe('sqlGuard.ensureLimit (row-limit + timeout enforcement)', () => {
  it('injects LIMIT n when SQL has none', () => {
    const out = ensureLimit('SELECT * FROM users', 250);
    expect(out.injected).toBe(true);
    expect(out.sql).toMatch(/LIMIT 250$/);
  });

  it('leaves SQL alone when LIMIT already present', () => {
    const out = ensureLimit('SELECT * FROM users LIMIT 5', 250);
    expect(out.injected).toBe(false);
    expect(out.sql).toBe('SELECT * FROM users LIMIT 5');
  });

  it('strips trailing semicolon before appending LIMIT', () => {
    const out = ensureLimit('SELECT * FROM users;', 100);
    expect(out.injected).toBe(true);
    expect(out.sql).toBe('SELECT * FROM users LIMIT 100');
  });
});

// -----------------------------------------------------------------------------
// 3) DbAdapter factory -- Group 2 scaffold throws on every engine
// -----------------------------------------------------------------------------

describe('dbAdapterFactory (Group 2 + Group 3 wiring)', () => {
  it('returns a PostgresAdapter instance for postgres (Group 3 wired)', () => {
    const adapter = createDbAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    // Adapter shape check -- the concrete class is internal but the contract
    // is the DbAdapter surface. We probe one method to confirm the wiring.
    expect(adapter).toBeDefined();
    expect(typeof adapter.testConnection).toBe('function');
    expect(typeof adapter.dispose).toBe('function');
    // Cleanup pool created by constructor so the test doesn't leak.
    void adapter.dispose();
  });
  it('throws-by-design for sybase until Group 4 wires the arm', () => {
    expect(() =>
      createDbAdapter({
        dbType: 'sybase',
        host: 'h',
        port: 5000,
        database: 'd',
        username: 'u',
        password: 'p',
      }),
    ).toThrow(/Group 4/);
  });
});

// -----------------------------------------------------------------------------
// 4) databasePackFactory -- engine dispatch + null safety
// -----------------------------------------------------------------------------

describe('databasePackFactory', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resetDatabasePackRegistryForTests();
  });
  afterEach(() => {
    warnSpy.mockRestore();
    resetDatabasePackRegistryForTests();
  });

  it('returns null with a warning for unknown engine keys', () => {
    const got = getDatabasePack('oracle');
    expect(got).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null with a warning when known engine has no pack registered yet', () => {
    const got = getDatabasePack('postgres');
    expect(got).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('resolves to the registered pack constructor', () => {
    class StubPack implements DatabaseDiscoveryPack {
      readonly engineKey = 'postgres' as const;
      readonly displayName = 'Stub';
      async connect(_c: DatabaseDiscoveryPackContext) {}
      async testConnection(_c: DatabaseDiscoveryPackContext) {
        return { success: true as const };
      }
      async introspectSchemas(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectTables(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectColumns(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectKeysAndIndexes(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectViews(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectProcedures(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async introspectTriggers(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async profileTables(_c: DatabaseDiscoveryPackContext) {
        return { tables: [], skippedTables: [] };
      }
      async inferRelationships(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async ingestWorkloadLogs(_c: DatabaseDiscoveryPackContext) {}
      async emitCandidates(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async emitFindings(_c: DatabaseDiscoveryPackContext) {
        return [];
      }
      async close() {}
    }

    registerDatabasePack('postgres', StubPack);
    const got = getDatabasePack('postgres');
    expect(got).toBeInstanceOf(StubPack);
    expect(listRegisteredEnginesForTests()).toEqual(['postgres']);
  });
});

// -----------------------------------------------------------------------------
// 5) Orchestrator -- soft-fail on introspection
// -----------------------------------------------------------------------------

describe('runDatabasePackDiscovery (soft-fail semantics)', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resetSecretsForTests();
  });
  afterEach(() => {
    warnSpy.mockRestore();
    resetSecretsForTests();
  });

  it('soft-fails on a single introspect step and still finishes the run', async () => {
    const pack = makeFakePack({ throwOn: ['introspectTables'] });
    const recordedFindings: FindingEmitInput[][] = [];
    const recordedRunContext: Array<{ runId: string }> = [];
    const result = await runDatabasePackDiscovery(
      {
        config: baseConfig(),
        credentials: baseCreds(),
        runContext: baseRunContext(),
      },
      {
        packOverride: pack,
        findingEmitterOverride: {
          emitFindings: async (rc, inputs) => {
            recordedRunContext.push(rc);
            recordedFindings.push(inputs);
            return [];
          },
        },
      },
    );

    // close() ran in finally even though introspectTables threw.
    expect(pack.calls).toContain('close');
    // Connection succeeded, run did not short-circuit
    expect(result.connectedOk).toBe(true);
    expect(result.shortCircuited).toBe(false);
    // A db_pack_warning finding was raised for the failed stage.
    const allEmitted = recordedFindings.flat();
    const warningFinding = allEmitted.find(
      (f) => f.findingType === 'db_pack_warning',
    );
    expect(warningFinding).toBeDefined();
    expect(warningFinding?.title).toContain('introspectTables');
    // The remaining introspect calls still ran.
    expect(pack.calls).toContain('introspectColumns');
    expect(pack.calls).toContain('inferRelationships');
  });

  it('short-circuits cleanly when no pack is registered (engineKey unknown)', async () => {
    resetDatabasePackRegistryForTests();
    const recorded: FindingEmitInput[][] = [];
    const result = await runDatabasePackDiscovery(
      {
        config: baseConfig({ dbEngine: 'postgres' }),
        credentials: baseCreds(),
        runContext: baseRunContext(),
      },
      {
        findingEmitterOverride: {
          emitFindings: async (_rc, inputs) => {
            recorded.push(inputs);
            return [];
          },
        },
      },
    );
    expect(result.shortCircuited).toBe(true);
    expect(result.connectedOk).toBe(false);
    const allEmitted = recorded.flat();
    expect(
      allEmitted.find((f) => f.findingType === 'db_pack_warning'),
    ).toBeDefined();
  });

  it('respects MAX_FINDINGS_PER_TYPE_PER_RUN cap', async () => {
    // Build a pack that emits 75 high_null_rate findings -- more than the cap.
    const overflow: FindingEmitInput[] = [];
    for (let i = 0; i < 75; i++) {
      overflow.push(
        buildHighNullRateFinding({
          engineKey: 'postgres',
          schemaName: 'public',
          tableName: `t${i}`,
          columnName: 'col',
          nullRate: 0.95,
        }),
      );
    }
    const pack = makeFakePack({ emitFindings: overflow });
    const recordedFindings: FindingEmitInput[][] = [];
    await runDatabasePackDiscovery(
      {
        config: baseConfig(),
        credentials: baseCreds(),
        runContext: baseRunContext(),
      },
      {
        packOverride: pack,
        findingEmitterOverride: {
          emitFindings: async (_rc, inputs) => {
            recordedFindings.push(inputs);
            return [];
          },
        },
      },
    );
    const flat = recordedFindings.flat();
    const highNullRateCount = flat.filter(
      (f) => f.findingType === 'high_null_rate',
    ).length;
    expect(highNullRateCount).toBe(MAX_FINDINGS_PER_TYPE_PER_RUN);
  });

  it('rejects deep profiling without explicit confirmation', async () => {
    const pack = makeFakePack();
    const recorded: FindingEmitInput[][] = [];
    await runDatabasePackDiscovery(
      {
        config: baseConfig({
          profilingMode: 'deep',
          deepProfilingConfirmed: false,
        }),
        credentials: baseCreds(),
        runContext: baseRunContext(),
      },
      {
        packOverride: pack,
        findingEmitterOverride: {
          emitFindings: async (_rc, inputs) => {
            recorded.push(inputs);
            return [];
          },
        },
      },
    );
    // profileTables should NOT have been called.
    expect(pack.calls).not.toContain('profileTables');
    // An evidence_gap finding should be in the emitted set.
    const flat = recorded.flat();
    const gap = flat.find(
      (f) =>
        f.findingType === 'evidence_gap' &&
        (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
          'db_profile_skipped',
    );
    expect(gap).toBeDefined();
  });

  it('purges the secret bundle on terminal status', async () => {
    const pack = makeFakePack();
    const runId = 'run-secret-lifecycle';
    await runDatabasePackDiscovery(
      {
        config: baseConfig(),
        credentials: baseCreds(),
        runContext: { runId, projectId: 'p', architectureId: 'a' },
      },
      { packOverride: pack },
    );
    // The orchestrator must have purged the bundle by the time it returns.
    expect(getForRun(runId)).toBeNull();
    expect(secretsSize()).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// 6) secretsStore -- round-trip + never-serialized contract
// -----------------------------------------------------------------------------

describe('secretsStore', () => {
  beforeEach(() => {
    resetSecretsForTests();
  });
  afterEach(() => {
    resetSecretsForTests();
  });

  it('round-trip: store / get / purge', () => {
    storeForRun('R1', { username: 'u', password: 'p' });
    expect(getForRun('R1')).toEqual({ username: 'u', password: 'p' });
    purgeForRun('R1');
    expect(getForRun('R1')).toBeNull();
  });

  it('purge is idempotent on a missing runId', () => {
    expect(() => purgeForRun('never-stored')).not.toThrow();
  });

  it('throws when re-storing the same runId without purge', () => {
    storeForRun('R2', { username: 'u', password: 'p' });
    expect(() => storeForRun('R2', { username: 'u', password: 'p2' })).toThrow(
      /already present/,
    );
  });

  it('JSON.stringify of the (private) Map snapshot does not expose plaintext password', () => {
    // The store is module-private; the contract is that no caller of the
    // module's public surface can extract the bundle as JSON. Verify by
    // confirming the module exports do NOT include the Map or a stringify
    // helper. This is a defense-in-depth grep-style test.
    const moduleExports = require('../services/databasePacks/secretsStore');
    expect(Object.keys(moduleExports).sort()).toEqual([
      'getForRun',
      'purgeForRun',
      'resetAllForTests',
      'sizeForTests',
      'storeForRun',
    ]);
    // getForRun returns a fresh copy (caller-mutation should not affect the store).
    storeForRun('R3', { username: 'u', password: 'P3-secret' });
    const snap = getForRun('R3')!;
    snap.password = 'mutated-by-caller';
    const reread = getForRun('R3')!;
    expect(reread.password).toBe('P3-secret');
  });
});

// -----------------------------------------------------------------------------
// 7) toRedactedConfig -- strips secrets, keeps display-safe metadata
// -----------------------------------------------------------------------------

describe('toRedactedConfig', () => {
  it('strips username, never includes password, keeps host + databaseName', () => {
    const cfg = baseConfig({ username: 'svc_ro_account' });
    const redacted = toRedactedConfig(cfg, /*hasWorkloadLog*/ false);
    // Cast to Record so we can iterate keys.
    const keys = Object.keys(redacted);
    expect(keys).not.toContain('username');
    expect(keys).not.toContain('password');
    // Negative-assertion field is present + literal false.
    expect(redacted.containsCredentials).toBe(false);
    // Display-safe fields kept.
    expect(redacted.host).toBe('db.test');
    expect(redacted.databaseName).toBe('demo');
    expect(redacted.engine).toBe('postgres');
    expect(redacted.profilingMode).toBe('standard');
    expect(redacted.workloadLogProvided).toBe(false);
  });

  it('JSON.stringify of the redacted config never contains the password string', () => {
    const cfg = baseConfig();
    cfg.username = 'super-secret-user';
    // Even though username is on the config in-memory, the redacted form
    // does not carry it.
    const json = JSON.stringify(toRedactedConfig(cfg, false));
    expect(json).not.toContain('super-secret-user');
    expect(json).not.toContain('password');
  });

  // SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11): the
  // SQL Server connection extras survive into the persisted snapshot MINUS
  // every secret. The auth scheme, TLS posture, named instance and Windows
  // domain are audit-relevant connection facts; the credentials still are not.
  it('keeps the mssql connection extras minus secrets, and nulls them for other engines', () => {
    const cfg = baseConfig({
      dbEngine: 'mssql',
      port: 1433,
      username: 'svc_ro_account',
      mssqlAuth: {
        scheme: 'ntlm',
        domain: 'CORPDOMAIN',
        encrypt: true,
        trustServerCertificate: true,
        instanceName: 'REPORTING',
      },
    });
    const redacted = toRedactedConfig(cfg, false);
    expect(redacted.engine).toBe('mssql');
    expect(redacted.mssqlAuth).toEqual({
      scheme: 'ntlm',
      domain: 'CORPDOMAIN',
      encrypt: true,
      trustServerCertificate: true,
      instanceName: 'REPORTING',
    });
    // Still no credentials anywhere in the persisted shape.
    const json = JSON.stringify(redacted);
    expect(json).not.toContain('svc_ro_account');
    expect(json).not.toContain('password');
    expect(redacted.containsCredentials).toBe(false);
    // The Sybase-only driver is nulled for a non-Sybase engine, as before.
    expect(redacted.sybaseDriver).toBeNull();

    // A config with no extras nulls the block rather than inventing defaults.
    expect(toRedactedConfig(baseConfig(), false).mssqlAuth).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 8) Finding builders -- shape conformance + evidence_gap discriminator
// -----------------------------------------------------------------------------

describe('database-pack finding builders', () => {
  const COMMON_PROPS: Array<keyof FindingEmitInput> = [
    'findingType',
    'category',
    'severity',
    'title',
  ];

  function assertEmitInputShape(f: FindingEmitInput, expectType: string): void {
    for (const k of COMMON_PROPS) {
      expect(f[k]).toBeDefined();
    }
    expect(f.findingType).toBe(expectType);
    expect(typeof f.title).toBe('string');
    expect(f.title.length).toBeGreaterThan(0);
    expect(f.source).toBe('db_discovery_pack');
    expect(typeof f.createdByStage).toBe('string');
  }

  it('buildMissingPrimaryKeyFinding returns the correct shape', () => {
    const f = buildMissingPrimaryKeyFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      tableName: 'orders',
    });
    assertEmitInputShape(f, 'missing_primary_key');
    expect(f.category).toBe('schema_quality');
    expect(f.severity).toBe('high');
    expect(f.title).toContain('public.orders');
    expect(f.title).toContain('[postgres]');
  });

  it('buildNoForeignKeysDeclaredFinding returns the correct shape', () => {
    const f = buildNoForeignKeysDeclaredFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      tableName: 'logs',
    });
    assertEmitInputShape(f, 'no_foreign_keys_declared');
  });

  it('buildInferredRelationshipFinding includes from + to identity in title', () => {
    const f = buildInferredRelationshipFinding({
      engineKey: 'sybase',
      fromSchema: 'dbo',
      fromTable: 'order_lines',
      fromColumns: ['order_id'],
      toSchema: 'dbo',
      toTable: 'orders',
      toColumns: ['id'],
      confidence: 0.6,
    });
    assertEmitInputShape(f, 'inferred_relationship');
    expect(f.title).toContain('order_lines');
    expect(f.title).toContain('orders');
    expect(f.confidence).toBe(0.6);
  });

  it('buildHighNullRateFinding ladders severity by null rate', () => {
    const low = buildHighNullRateFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      tableName: 'orders',
      columnName: 'tracking_code',
      nullRate: 0.5,
    });
    expect(low.severity).toBe('low');
    const high = buildHighNullRateFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      tableName: 'orders',
      columnName: 'tracking_code',
      nullRate: 0.95,
    });
    expect(high.severity).toBe('medium');
  });

  it('buildDbMigrationRiskFinding carries riskCategory in payload (D6 consolidation #1)', () => {
    const f = buildDbMigrationRiskFinding({
      engineKey: 'postgres',
      riskCategory: 'complex_view_logic',
      objectName: 'public.report_v_orders',
      objectKind: 'view',
      rationale: 'View aggregates 12 joins + 3 window funcs',
      severity: 'high',
    });
    assertEmitInputShape(f, 'db_migration_risk');
    expect(f.severity).toBe('high');
    expect((f.detailJson as Record<string, unknown>).riskCategory).toBe(
      'complex_view_logic',
    );
  });

  it('buildStoredProcedureLogicFinding pre-redacts body via the TARGETED full-body scrub (Spec 2026-06-11 TG1)', () => {
    const f = buildStoredProcedureLogicFinding({
      engineKey: 'postgres',
      schemaName: 'public',
      procedureName: 'calc_tax',
      routineKind: 'function',
      // Body contains a secret-named assignment AND an ordinary literal. The
      // targeted full-body scrub redacts the former and PRESERVES the latter
      // (the old blanket collapse is gone on the full-body path).
      bodySnippet: "password='supersecret' AND name = 'Alice'",
    });
    assertEmitInputShape(f, 'stored_procedure_logic');
    const d = f.detailJson as Record<string, unknown>;
    const snippet = d.bodySnippet as string;
    expect(snippet).not.toContain('supersecret');
    expect(snippet).toContain('Alice');
    // The redaction-policy marker + fidelity flags ride the finding detail so
    // downstream seeding can detect legacy bodies by the marker's ABSENCE.
    expect(d.literal_policy).toBe('targeted_v2');
    expect(d.redacted).toBe(true);
    expect(d.truncated).toBe(false);
  });

  it('buildHiddenBusinessLogicFinding carries sourceObjectType in payload (D6 consolidation #3)', () => {
    const f = buildHiddenBusinessLogicFinding({
      engineKey: 'sybase',
      sourceObjectType: 'trigger',
      schemaName: 'dbo',
      objectName: 'trg_audit_orders',
      bodySnippet: 'INSERT INTO audit_log ...',
    });
    assertEmitInputShape(f, 'hidden_business_logic');
    expect((f.detailJson as Record<string, unknown>).sourceObjectType).toBe(
      'trigger',
    );
  });

  it('buildDbEvidenceGapFinding uses finding_type=evidence_gap with gapType=db_* (D6 consolidation #2)', () => {
    const f = buildDbEvidenceGapFinding({
      engineKey: 'postgres',
      gapType: 'db_unreadable_object',
      objectName: 'public.locked_table',
      gapDescription: 'Table acquired exclusive lock for >30s; skipped.',
    });
    // CRITICAL: finding_type stays 'evidence_gap' (same as the code-pack
    // builder) so the Findings tab groups them together.
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    // Discriminator is in the payload.
    expect((f.detailJson as Record<string, unknown>).gapType).toBe(
      'db_unreadable_object',
    );
  });

  it('buildDbPackWarningFinding produces the soft-fail shape', () => {
    const f = buildDbPackWarningFinding({
      engineKey: 'postgres',
      stage: 'introspectViews',
      errorMessage: 'connection reset by peer',
    });
    assertEmitInputShape(f, 'db_pack_warning');
    expect(f.severity).toBe('low');
    expect(f.category).toBe('pack_warning');
  });
});

// -----------------------------------------------------------------------------
// 9) capFindingsPerType -- direct unit test on the cap helper
// -----------------------------------------------------------------------------

describe('capFindingsPerType', () => {
  it('caps per finding type independently', () => {
    const inputs: FindingEmitInput[] = [];
    for (let i = 0; i < 10; i++) {
      inputs.push(
        buildHighNullRateFinding({
          engineKey: 'postgres',
          schemaName: 's',
          tableName: 't',
          columnName: `c${i}`,
          nullRate: 0.9,
        }),
      );
    }
    for (let i = 0; i < 10; i++) {
      inputs.push(
        buildMissingPrimaryKeyFinding({
          engineKey: 'postgres',
          schemaName: 's',
          tableName: `t${i}`,
        }),
      );
    }
    const capped = capFindingsPerType(inputs, 3);
    expect(capped.filter((f) => f.findingType === 'high_null_rate').length).toBe(
      3,
    );
    expect(
      capped.filter((f) => f.findingType === 'missing_primary_key').length,
    ).toBe(3);
  });
});
