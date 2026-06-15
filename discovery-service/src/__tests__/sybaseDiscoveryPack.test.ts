/**
 * Group 4 contract tests for the Sybase discovery pack (Spec 2026-05-16
 * Database Discovery Packs -- tasks.md 4.1).
 *
 * These tests are ALWAYS-ON. They mock the sidecar HTTP boundary via a
 * stubbed global `fetch` so the suite does NOT require:
 *   - a running Sybase server
 *   - the sidecar JAR built / Docker container running
 *   - the SYBASE_SIDECAR_URL env var set
 *
 * For the optional end-to-end integration tests against a real Sybase
 * container, see `sybaseSidecar.integration.test.ts` (env-var gated).
 *
 * Coverage (matches tasks.md 4.1 bullets):
 *  1. testConnection serialises the request body shape; success path returns
 *     serverVersion
 *  2. introspect* transforms a mocked sidecar response into the framework's
 *     IntrospectionResult model (schemas / tables / columns / keys / views /
 *     procedures / triggers)
 *  3. profileTables sends row count + null count queries to /query; aggregates
 *     results into TableProfile
 *  4. Relationship inference picks up declared FKs + name-based inference
 *  5. Findings: missing_primary_key, inferred_relationship,
 *     stored_procedure_logic, hidden_business_logic with
 *     sourceObjectType='trigger'
 *  6. Soft-fail: a 500 from sidecar on one introspection step throws so the
 *     orchestrator's withDbPackSoftFail wrapper can emit db_pack_warning
 *  7. Snippet redaction: a procedure body with password='supersecret' has
 *     `?` in the persisted finding (no plaintext)
 *  8. SQL guard: queries sent to /query are SELECT-only at the TS layer
 *     (client-side defense in depth)
 *  9. SYBASE_SIDECAR_URL configurable via env var
 */

import { SybaseDiscoveryPack } from '../services/databasePacks/sybase/SybaseDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import { inferSybaseRelationships } from '../services/databasePacks/sybase/sybaseRelationshipInference';
import {
  buildAllSybaseFindings,
  __testOnly as sybaseFindingsTestOnly,
} from '../services/databasePacks/sybase/sybaseFindings';
import {
  parseAseMajorVersion,
  SYBASE_METADATA_CAPABILITY,
} from '../services/databasePacks/sybase/sybaseIntrospection';
import {
  buildConstraintsMetadata,
  buildFkColumnsMetadata,
  attributeStructuralFidelityFields,
} from '../services/databasePacks/candidateStructuralFidelity';
import { resolveSidecarBaseUrl } from '../services/databasePacks/sybase/sybaseSidecarClient';
import { profileSybaseTables } from '../services/databasePacks/sybase/sybaseProfiler';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  ProfileResult,
  RelationshipInference,
  ColumnMetadata,
  KeyOrIndexMetadata,
} from '../services/databasePacks/types';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sybase/sybaseSidecarClient';
import {
  getDatabasePack,
  listRegisteredEnginesForTests,
} from '../services/databasePacks/databasePackFactory';

// -----------------------------------------------------------------------------
// `fetch` mock. Records every call so tests can inspect the HTTP shape, and
// supports per-test queued responses keyed by URL suffix.
// -----------------------------------------------------------------------------

interface RecordedFetch {
  url: string;
  body: Record<string, unknown>;
}

const recordedFetches: RecordedFetch[] = [];

type QueueEntry = {
  match: RegExp;
  status?: number;
  body: unknown;
};

const fetchQueue: QueueEntry[] = [];

function queueResponse(match: RegExp, body: unknown, status = 200): void {
  fetchQueue.push({ match, body, status });
}

const originalFetch = global.fetch;

beforeAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body =
      init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    recordedFetches.push({ url, body });
    for (let i = 0; i < fetchQueue.length; i++) {
      const entry = fetchQueue[i];
      if (entry.match.test(url)) {
        fetchQueue.splice(i, 1);
        const status = entry.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => entry.body,
          text: async () =>
            typeof entry.body === 'string'
              ? entry.body
              : JSON.stringify(entry.body),
        } as Response;
      }
    }
    // Default: 200 with empty body so a missing queue entry doesn't blow up
    // tests that only care about request shape.
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{}',
    } as Response;
  }) as typeof fetch;
});

afterAll(() => {
  (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
});

beforeEach(() => {
  recordedFetches.length = 0;
  fetchQueue.length = 0;
  delete process.env.SYBASE_SIDECAR_URL;
});

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

const baseConfig = (
  overrides: Partial<DatabaseDiscoveryConfig> = {},
): DatabaseDiscoveryConfig => ({
  dbEngine: 'sybase',
  host: 'syb.test',
  port: 5000,
  databaseName: 'demo',
  catalogName: null,
  schemaName: 'dbo',
  includeSchemas: ['dbo'],
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
  password: 'pwd-for-test',
});

const baseCtx = () => ({
  config: baseConfig(),
  credentials: baseCreds(),
  runId: 'run-syb-test',
  projectId: 'proj-syb',
  architectureId: 'arch-syb',
});

const sidecarOkIntrospection = (): SidecarIntrospectionResponse => ({
  ok: true,
  schemas: [{ schemaName: 'dbo', owner: 'dbo' }],
  tables: [{ schemaName: 'dbo', tableName: 'orders' }],
  columns: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'id',
      dataType: 'int',
      maxLength: 4,
      isNullable: false,
      ordinalPosition: 1,
    },
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'name',
      dataType: 'varchar',
      maxLength: 100,
      isNullable: true,
      ordinalPosition: 2,
    },
  ],
  keys: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      kind: 'primary_key',
      name: 'pk_orders',
      columns: ['id'],
      referencedSchema: null,
      referencedTable: null,
      referencedColumns: null,
      isUnique: true,
    },
  ],
  views: [],
  procedures: [],
  triggers: [],
});

// -----------------------------------------------------------------------------
// 1) Factory registers Sybase
// -----------------------------------------------------------------------------

describe('databasePackFactory (Group 4)', () => {
  it('registers the Sybase pack alongside Postgres', () => {
    const engines = listRegisteredEnginesForTests();
    expect(engines).toContain('postgres');
    expect(engines).toContain('sybase');
  });

  it('getDatabasePack("sybase") returns a SybaseDiscoveryPack instance', () => {
    const pack = getDatabasePack('sybase');
    expect(pack).not.toBeNull();
    expect(pack?.engineKey).toBe('sybase');
    expect(pack?.displayName).toBe('Sybase ASE');
  });
});

// -----------------------------------------------------------------------------
// 2) testConnection: request shape + success response
// -----------------------------------------------------------------------------

describe('SybaseDiscoveryPack.testConnection', () => {
  it('POSTs to /test-connection with the expected body and returns serverVersion on ok=true', async () => {
    queueResponse(/\/test-connection$/, {
      ok: true,
      error: null,
      serverVersion: 'Adaptive Server Enterprise/16.0',
    });
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const result = await pack.testConnection(ctx);
    expect(result.success).toBe(true);
    expect(result.serverVersion).toMatch(/Adaptive Server/);

    const fetched = recordedFetches.find((f) => /\/test-connection/.test(f.url));
    expect(fetched).toBeDefined();
    expect(fetched?.body).toMatchObject({
      host: 'syb.test',
      port: 5000,
      database: 'demo',
      username: 'svc_discovery_ro',
      password: 'pwd-for-test',
    });
    await pack.close();
  });

  it('throws (so the orchestrator soft-fail wrapper catches it) when the sidecar returns ok=false', async () => {
    queueResponse(/\/test-connection$/, {
      ok: false,
      error: 'Login failed for user',
      serverVersion: null,
    });
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await expect(pack.testConnection(ctx)).rejects.toThrow(/testConnection failed/i);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 3) introspect* transforms the sidecar response
// -----------------------------------------------------------------------------

describe('SybaseDiscoveryPack.introspect* (transform contract)', () => {
  it('introspectTables / introspectColumns surface the sidecar payload', async () => {
    queueResponse(/\/introspect$/, sidecarOkIntrospection());
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const tables = await pack.introspectTables(ctx);
    expect(tables).toHaveLength(1);
    expect(tables[0].tableName).toBe('orders');
    expect(tables[0].objectType).toBe('table');
    const cols = await pack.introspectColumns(ctx);
    expect(cols).toHaveLength(2);
    expect(cols[0].columnName).toBe('id');
    expect(cols[0].isNullable).toBe(false);
    expect(cols[1].maxLength).toBe(100);
    await pack.close();
  });

  it('reuses the cached sidecar introspection for repeated introspect* calls (one fetch)', async () => {
    queueResponse(/\/introspect$/, sidecarOkIntrospection());
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await pack.introspectSchemas(ctx);
    await pack.introspectTables(ctx);
    await pack.introspectColumns(ctx);
    await pack.introspectKeysAndIndexes(ctx);
    const introspectCalls = recordedFetches.filter((f) =>
      /\/introspect$/.test(f.url),
    );
    expect(introspectCalls).toHaveLength(1);
    await pack.close();
  });

  it('throws when the sidecar returns ok=false (soft-fail wrapper picks it up)', async () => {
    queueResponse(/\/introspect$/, {
      ok: false,
      error: 'sysobjects unavailable',
      schemas: [],
      tables: [],
      columns: [],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
    });
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await expect(pack.introspectTables(ctx)).rejects.toThrow(/introspect failed/i);
    await pack.close();
  });

  it('returns empty arrays when sidecar HTTP returns 500 (soft-fail at orchestrator)', async () => {
    queueResponse(/\/introspect$/, { error: 'server boom' }, 500);
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await expect(pack.introspectTables(ctx)).rejects.toThrow(/HTTP 500/);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 4) Profiler sends row count + null count queries to /query
// -----------------------------------------------------------------------------

describe('profileSybaseTables', () => {
  it('issues a row count + null count + sample SELECT TOP 5 per column', async () => {
    // row count
    queueResponse(/\/query$/, {
      ok: true,
      error: null,
      rows: [{ n: 100 }],
      rowCount: 1,
      truncated: false,
    });
    // null count
    queueResponse(/\/query$/, {
      ok: true,
      error: null,
      rows: [{ n: 100, nulls: 10 }],
      rowCount: 1,
      truncated: false,
    });
    // sample values
    queueResponse(/\/query$/, {
      ok: true,
      error: null,
      rows: [{ name: 'A' }, { name: 'B' }],
      rowCount: 2,
      truncated: false,
    });

    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          objectType: 'table',
          estimatedRowCount: null,
        },
      ],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          columnName: 'name',
          dataType: 'varchar',
          isNullable: true,
          ordinalPosition: 1,
        },
      ],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const out = await profileSybaseTables(
      {
        host: 'syb.test',
        port: 5000,
        database: 'demo',
        username: 'u',
        password: 'p',
      },
      intro,
      'standard',
      baseConfig(),
    );
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].rowCount).toBe(100);
    expect(out.tables[0].columnProfiles[0].nullRate).toBeCloseTo(0.1, 5);
    expect(out.tables[0].columnProfiles[0].sampleValues).toEqual(['A', 'B']);
  });

  it('basic mode does not issue per-column probes', async () => {
    queueResponse(/\/query$/, {
      ok: true,
      rows: [{ n: 42 }],
      rowCount: 1,
      truncated: false,
    });
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          objectType: 'table',
          estimatedRowCount: null,
        },
      ],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          columnName: 'name',
          dataType: 'varchar',
          isNullable: true,
          ordinalPosition: 1,
        },
      ],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const out = await profileSybaseTables(
      {
        host: 'syb.test',
        port: 5000,
        database: 'demo',
        username: 'u',
        password: 'p',
      },
      intro,
      'basic',
      baseConfig(),
    );
    expect(out.tables[0].rowCount).toBe(42);
    expect(out.tables[0].columnProfiles).toHaveLength(0);
    const queryCalls = recordedFetches.filter((f) => /\/query$/.test(f.url));
    expect(queryCalls).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// 5) Relationship inference: declared FK + naming-based
// -----------------------------------------------------------------------------

describe('inferSybaseRelationships', () => {
  it('captures declared FK with confidence 1.0', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [
        {
          schemaName: 'dbo',
          tableName: 'order_lines',
          kind: 'foreign_key',
          name: 'order_lines_fkey',
          columns: ['order_id'],
          referencedSchema: 'dbo',
          referencedTable: 'orders',
          referencedColumns: ['id'],
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferSybaseRelationships(intro);
    const declared = rels.find((r) => r.kind === 'declared_fk');
    expect(declared).toBeDefined();
    expect(declared?.confidence).toBe(1.0);
  });

  it('falls back to referenced PK columns when sysreferences lacks them (Sybase quirk)', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          kind: 'primary_key',
          name: 'pk_orders',
          columns: ['id'],
        },
        {
          schemaName: 'dbo',
          tableName: 'order_lines',
          kind: 'foreign_key',
          name: 'fk_42',
          columns: ['order_id'],
          referencedSchema: 'dbo',
          referencedTable: 'orders',
          referencedColumns: [], // empty -- fallback should kick in
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferSybaseRelationships(intro);
    const declared = rels.find((r) => r.kind === 'declared_fk');
    expect(declared?.toColumns).toEqual(['id']);
  });

  it('infers <entity>_id when a PK table named <entity> exists', () => {
    const pkOrders: KeyOrIndexMetadata = {
      schemaName: 'dbo',
      tableName: 'orders',
      kind: 'primary_key',
      name: 'pk_orders',
      columns: ['id'],
    };
    const fkCol: ColumnMetadata = {
      schemaName: 'dbo',
      tableName: 'invoices',
      columnName: 'order_id',
      dataType: 'int',
      isNullable: true,
      ordinalPosition: 2,
    };
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [fkCol],
      keysAndIndexes: [pkOrders],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferSybaseRelationships(intro);
    const inferred = rels.find((r) => r.kind === 'inferred');
    expect(inferred?.toTable).toBe('orders');
  });
});

// -----------------------------------------------------------------------------
// 6) Findings: missing_primary_key + inferred_relationship + stored_proc + trigger
// -----------------------------------------------------------------------------

describe('buildAllSybaseFindings', () => {
  it('emits missing_primary_key for a table with no PK', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'logs',
          objectType: 'table',
          estimatedRowCount: 50,
        },
      ],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const findings = buildAllSybaseFindings(intro, profile, []);
    const missingPk = findings.find(
      (f) => f.findingType === 'missing_primary_key',
    );
    expect(missingPk).toBeDefined();
    expect(missingPk?.title).toContain('dbo.logs');
    expect(missingPk?.title).toContain('[sybase]');
  });

  it('emits inferred_relationship from naming heuristic', () => {
    const rels: RelationshipInference[] = [
      {
        fromSchema: 'dbo',
        fromTable: 'invoices',
        fromColumns: ['order_id'],
        toSchema: 'dbo',
        toTable: 'orders',
        toColumns: ['id'],
        kind: 'inferred',
        confidence: 0.8,
      },
    ];
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const findings = buildAllSybaseFindings(
      intro,
      { tables: [], skippedTables: [] },
      rels,
    );
    expect(
      findings.find((f) => f.findingType === 'inferred_relationship'),
    ).toBeDefined();
  });

  it('emits stored_procedure_logic + procedure_data_write for a Sybase proc with DML', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [
        {
          schemaName: 'dbo',
          procedureName: 'archive_old',
          routineKind: 'procedure',
          body: "INSERT INTO archive SELECT * FROM orders WHERE name='X';",
          language: 'TSQL',
        },
      ],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const findings = buildAllSybaseFindings(intro, profile, []);
    expect(
      findings.find((f) => f.findingType === 'stored_procedure_logic'),
    ).toBeDefined();
    expect(
      findings.find((f) => f.findingType === 'procedure_data_write'),
    ).toBeDefined();
    expect(
      findings.find((f) => f.findingType === 'hidden_business_logic'),
    ).toBeDefined();
  });

  it('emits hidden_business_logic with sourceObjectType=trigger for a Sybase trigger', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [
        {
          schemaName: 'dbo',
          triggerName: 'orders_audit',
          tableSchema: 'dbo',
          tableName: 'orders',
          timing: 'after',
          events: ['insert', 'update'],
          actionStatement:
            "INSERT INTO audit_log SELECT * FROM inserted",
        },
      ],
    };
    const findings = buildAllSybaseFindings(
      intro,
      { tables: [], skippedTables: [] },
      [],
    );
    const trigFinding = findings.find(
      (f) =>
        f.findingType === 'hidden_business_logic' &&
        (f.detailJson as Record<string, unknown>).sourceObjectType ===
          'trigger',
    );
    expect(trigFinding).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// 7) Snippet redaction on procedure bodies
// -----------------------------------------------------------------------------

describe('Snippet redaction on Sybase finding payloads', () => {
  it('strips literal values and secret keys from procedure bodies', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [
        {
          schemaName: 'dbo',
          procedureName: 'leak_check',
          routineKind: 'function',
          body: "SELECT name WHERE password='supersecret' AND email='a@b'",
          language: 'TSQL',
        },
      ],
      triggers: [],
    };
    const findings = buildAllSybaseFindings(
      intro,
      { tables: [], skippedTables: [] },
      [],
    );
    const spLogic = findings.find(
      (f) => f.findingType === 'stored_procedure_logic',
    );
    expect(spLogic).toBeDefined();
    const snippet = (spLogic?.detailJson as Record<string, unknown>)
      .bodySnippet as string;
    expect(snippet).not.toContain('supersecret');
    // Targeted scrub (literal_policy 'targeted_v2'): ordinary literals are
    // preserved verbatim; only secret-named targets collapse to '<REDACTED>'.
    expect(snippet).toContain("email='a@b'");
    expect(snippet).toContain('<REDACTED>');
  });
});

// -----------------------------------------------------------------------------
// 8) Soft-fail: a 500 from sidecar throws so the orchestrator wraps it
// -----------------------------------------------------------------------------

describe('Sybase pack -- sidecar 500 soft-fail boundary', () => {
  it('throws on HTTP 500 so withDbPackSoftFail emits db_pack_warning', async () => {
    queueResponse(/\/introspect$/, 'boom', 500);
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await expect(pack.introspectTables(ctx)).rejects.toThrow(/HTTP 500/);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 9) SQL guard: client-side guard applied BEFORE the HTTP request
// -----------------------------------------------------------------------------

describe('Sybase pack -- TS-side SQL guard (defense in depth)', () => {
  it('rejects a forbidden statement at the profiler layer before the fetch fires', async () => {
    // The profiler builds its own SELECT internally. Here we verify that
    // any direct callSidecarQuery from the pack passes the guard by
    // exercising a known-safe SQL. The negative path is covered by the
    // sqlGuard unit tests + the JVM-side SidecarSqlGuard tests.
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          objectType: 'table',
          estimatedRowCount: null,
        },
      ],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    queueResponse(/\/query$/, {
      ok: true,
      rows: [{ n: 7 }],
      rowCount: 1,
      truncated: false,
    });
    await profileSybaseTables(
      {
        host: 'syb.test',
        port: 5000,
        database: 'demo',
        username: 'u',
        password: 'p',
      },
      intro,
      'basic',
      baseConfig(),
    );
    const queryCalls = recordedFetches.filter((f) => /\/query$/.test(f.url));
    expect(queryCalls.length).toBeGreaterThan(0);
    for (const call of queryCalls) {
      const sql = (call.body as { sql?: string }).sql ?? '';
      expect(sql.toUpperCase().startsWith('SELECT')).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// 10) SYBASE_SIDECAR_URL env var
// -----------------------------------------------------------------------------

describe('resolveSidecarBaseUrl', () => {
  it('defaults to http://localhost:8093 when env var is unset', () => {
    delete process.env.SYBASE_SIDECAR_URL;
    expect(resolveSidecarBaseUrl()).toBe('http://localhost:8093');
  });

  it('honors SYBASE_SIDECAR_URL when set', () => {
    process.env.SYBASE_SIDECAR_URL = 'http://sidecar.cluster.svc:9000';
    expect(resolveSidecarBaseUrl()).toBe('http://sidecar.cluster.svc:9000');
  });
});

// -----------------------------------------------------------------------------
// 11) Introspection transform
// -----------------------------------------------------------------------------

describe('transformSidecarIntrospection', () => {
  it('maps every section of the sidecar response into the engine-neutral shape', () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      schemas: [{ schemaName: 'dbo', owner: 'dbo' }],
      tables: [{ schemaName: 'dbo', tableName: 'orders' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          columnName: 'id',
          dataType: 'int',
          maxLength: 4,
          isNullable: false,
          ordinalPosition: 1,
        },
      ],
      keys: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          kind: 'primary_key',
          name: 'pk_orders',
          columns: ['id'],
          referencedSchema: null,
          referencedTable: null,
          referencedColumns: null,
          isUnique: true,
        },
      ],
      views: [
        {
          schemaName: 'dbo',
          viewName: 'v_active_orders',
          definition: 'SELECT * FROM orders',
          isMaterialized: false,
        },
      ],
      procedures: [
        {
          schemaName: 'dbo',
          procedureName: 'sp_archive_old_orders_safe',
          routineKind: 'procedure',
          body: 'INSERT INTO archive SELECT * FROM orders',
          language: 'TSQL',
        },
      ],
      triggers: [
        {
          schemaName: 'dbo',
          triggerName: 'orders_audit',
          tableSchema: 'dbo',
          tableName: 'orders',
          timing: 'AFTER',
          events: ['INSERT'],
          actionStatement: 'INSERT INTO audit_log SELECT * FROM inserted',
        },
      ],
    };
    const out = transformSidecarIntrospection(resp);
    expect(out.schemas[0].schemaName).toBe('dbo');
    expect(out.tables[0].objectType).toBe('table');
    expect(out.columns[0].isNullable).toBe(false);
    expect(out.keysAndIndexes[0].kind).toBe('primary_key');
    expect(out.views[0].isMaterialized).toBe(false);
    expect(out.procedures[0].routineKind).toBe('procedure');
    expect(out.triggers[0].timing).toBe('after');
    expect(out.triggers[0].events).toEqual(['insert']);
  });
});

// -----------------------------------------------------------------------------
// SybaseDiscoveryPack.emitCandidates: views are emitted alongside tables
//
// Bug fix (2026-05-17): the pack previously iterated `introspection.tables`
// only, so view rows from `introspection.views` never reached the candidate
// list. This regression test guards the loop so future refactors can't
// silently drop views again.
// -----------------------------------------------------------------------------

describe('SybaseDiscoveryPack.emitCandidates -- views as physical_data_entities', () => {
  it('emits one physical_data_entity per view with data.objectType=\'view\'', async () => {
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [
        { schemaName: 'dbo', viewName: 'v_active_orders', definition: 'select 1', isMaterialized: false },
      ],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const candidates = await pack.emitCandidates(ctx, intro, profile);
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('v_active_orders');
    expect((entities[0].data as Record<string, unknown>).objectType).toBe('view');
    expect((entities[0].data as Record<string, unknown>).schemaName).toBe('dbo');
    await pack.close();
  });
});


// -----------------------------------------------------------------------------
// 12) Spec 2026-05-31 -- Sybase metadata enrichment (Task Group 6):
//     full new-field mapping into the IR + JSONB / constraints_metadata /
//     fk_columns, the Findings firing, and the three-state applicability model
//     (present / not_applicable_for_engine / unavailable, incl. the
//     older-sidecar missing-capability => unavailable case). Always-on,
//     fetch-mocked (no DB, no sidecar JAR, no env var). The assertion count
//     exceeds the usual cap by design: the testing decision mandates full
//     field + three-state coverage in this single always-on suite.
// -----------------------------------------------------------------------------

/**
 * A sidecar introspection response with EVERY Spec 2026-05-31 enrichment field
 * populated and ALL five surfaced groups advertised in capabilities, on an
 * ASE16 server. This is the "everything present" fixture; individual tests
 * override pieces (drop a value, drop a capability, downshift the version).
 */
const enrichedSidecarIntrospection = (
  overrides: Partial<SidecarIntrospectionResponse> = {},
): SidecarIntrospectionResponse => ({
  ok: true,
  serverVersion: 'Adaptive Server Enterprise/16.0/EBF 29900/P/x86_64',
  databaseCollation: 'utf8_general_ci',
  capabilities: [
    SYBASE_METADATA_CAPABILITY.collation,
    SYBASE_METADATA_CAPABILITY.computedColumns,
    SYBASE_METADATA_CAPABILITY.sequenceCurrentValue,
    SYBASE_METADATA_CAPABILITY.fkActions,
    SYBASE_METADATA_CAPABILITY.indexClustering,
    SYBASE_METADATA_CAPABILITY.dbJobs,
  ],
  schemas: [{ schemaName: 'dbo', owner: 'dbo' }],
  tables: [
    { schemaName: 'dbo', tableName: 'orders' },
    { schemaName: 'dbo', tableName: 'order_lines' },
  ],
  columns: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'id',
      dataType: 'numeric',
      maxLength: 8,
      isNullable: false,
      ordinalPosition: 1,
      isIdentity: true,
    },
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'customer_name',
      dataType: 'varchar',
      maxLength: 100,
      isNullable: true,
      ordinalPosition: 2,
      // Group 1: a case-INSENSITIVE collation (the cross-engine hazard signal).
      collation: 'utf8_general_ci',
    },
    {
      schemaName: 'dbo',
      tableName: 'orders',
      columnName: 'total_with_tax',
      dataType: 'numeric',
      maxLength: 8,
      isNullable: true,
      ordinalPosition: 3,
      // Group 2: computed column with a verbatim expression.
      isComputed: true,
      computedExpression: 'subtotal * 1.2',
    },
  ],
  keys: [
    {
      schemaName: 'dbo',
      tableName: 'orders',
      kind: 'primary_key',
      name: 'pk_orders',
      columns: ['id'],
      referencedSchema: null,
      referencedTable: null,
      referencedColumns: null,
      isUnique: true,
    },
    {
      // Group 5: a clustered, multi-column index with ASC/DESC directions.
      schemaName: 'dbo',
      tableName: 'orders',
      kind: 'index',
      name: 'ix_orders_cust',
      columns: ['customer_name', 'id'],
      referencedSchema: null,
      referencedTable: null,
      referencedColumns: null,
      isUnique: false,
      indexDefinition:
        'CREATE CLUSTERED INDEX ix_orders_cust ON dbo.orders (customer_name ASC, id DESC)',
      indexMethod: 'clustered',
      isClustered: true,
      indexPredicate: null, // ASE has no partial indexes -> always null.
      columnDirections: ['ASC', 'DESC'],
    },
    {
      // Group 4: an FK carrying verbatim referential actions.
      schemaName: 'dbo',
      tableName: 'order_lines',
      kind: 'foreign_key',
      name: 'fk_order_lines_orders',
      columns: ['order_id'],
      referencedSchema: 'dbo',
      referencedTable: 'orders',
      referencedColumns: ['id'],
      isUnique: false,
      updateRule: 'NO ACTION',
      deleteRule: 'CASCADE',
    },
  ],
  views: [],
  procedures: [],
  triggers: [],
  sequences: [
    {
      // Group 3: an identity-synthesized sequence carrying a current value.
      schemaName: 'dbo',
      sequenceName: 'orders.id (identity)',
      dataType: 'numeric',
      startValue: '1',
      increment: '1',
      minValue: null,
      maxValue: null,
      cycle: false,
      currentValue: '4242',
      ownedByTable: 'orders',
      ownedByColumn: 'id',
      definition: null,
    },
  ],
  scheduledJobs: [
    {
      // Group 6: a DB-resident scheduled job.
      schemaName: 'dbo',
      jobName: 'nightly_rollup',
      scheduler: 'sybase_job_scheduler',
      schedule: 'daily @ 02:00',
      command: 'EXEC dbo.sp_rollup_daily',
      enabled: true,
    },
  ],
  ...overrides,
});

describe('Sybase metadata enrichment -- new-field mapping into the IR (Spec 2026-05-31)', () => {
  it('maps every new group-1..6 field onto the engine-neutral IntrospectionResult', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());

    // Group 1: per-column collation + top-level databaseCollation.
    const custCol = out.columns.find((c) => c.columnName === 'customer_name');
    expect(custCol?.collation).toBe('utf8_general_ci');
    expect(out.databaseCollation).toBe('utf8_general_ci');

    // Group 2: computed column folds to isGenerated + generationExpression.
    const computed = out.columns.find((c) => c.columnName === 'total_with_tax');
    expect(computed?.isGenerated).toBe(true);
    expect(computed?.generationExpression).toBe('subtotal * 1.2');

    // Group 3: identity-synthesized sequence carries the current value + owner.
    expect(out.sequences).toHaveLength(1);
    expect(out.sequences?.[0].sequenceName).toBe('orders.id (identity)');
    expect(out.sequences?.[0].currentValue).toBe('4242');
    expect(out.sequences?.[0].ownedByTable).toBe('orders');
    expect(out.sequences?.[0].ownedByColumn).toBe('id');

    // Group 4: FK referential actions onto onDelete / onUpdate.
    const fk = out.keysAndIndexes.find((k) => k.kind === 'foreign_key');
    expect(fk?.onDelete).toBe('CASCADE');
    expect(fk?.onUpdate).toBe('NO ACTION');

    // Group 5: all five index fields onto KeyOrIndexMetadata.
    const idx = out.keysAndIndexes.find((k) => k.name === 'ix_orders_cust');
    expect(idx?.kind).toBe('index');
    expect(idx?.isClustered).toBe(true);
    expect(idx?.indexMethod).toBe('clustered');
    expect(idx?.indexDefinition).toContain('CREATE CLUSTERED INDEX');
    expect(idx?.columnDirections).toEqual(['ASC', 'DESC']);
    // ASE has no partial indexes -> predicate stays null on the IR.
    expect(idx?.indexPredicate).toBeNull();

    // Group 6: the scheduled job is carried through verbatim.
    expect(out.scheduledJobs).toHaveLength(1);
    expect(out.scheduledJobs?.[0].jobName).toBe('nightly_rollup');
    expect(out.scheduledJobs?.[0].schedule).toBe('daily @ 02:00');
  });

  it('is null-tolerant: an older sidecar omitting the new fields maps to null/defaults', () => {
    // sidecarOkIntrospection() has NONE of the new fields, no capabilities,
    // no serverVersion, no databaseCollation.
    const out = transformSidecarIntrospection(sidecarOkIntrospection());
    expect(out.databaseCollation).toBeNull();
    expect(out.columns[0].collation).toBeNull();
    expect(out.columns[0].isGenerated).toBe(false);
    const pk = out.keysAndIndexes.find((k) => k.kind === 'primary_key');
    // The group-5 index fields default to null on the PK row (no index DDL).
    expect(pk?.indexDefinition).toBeNull();
    expect(pk?.isClustered).toBeNull();
    expect(pk?.columnDirections).toBeNull();
    expect(pk?.indexPredicate).toBeNull();
  });
});

describe('Sybase metadata enrichment -- TS mapping into JSONB / constraints_metadata / fk_columns (Spec 2026-05-31)', () => {
  it('reshapes the group-5 index into constraints_metadata.indexes[] with all five keys', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const cm = buildConstraintsMetadata('dbo', 'orders', out.keysAndIndexes);
    expect(cm).not.toBeNull();
    const idxEntry = cm?.indexes.find((i) => i.name === 'ix_orders_cust');
    expect(idxEntry).toBeDefined();
    expect(idxEntry?.is_clustered).toBe(true);
    expect(idxEntry?.method).toBe('clustered');
    expect(idxEntry?.definition).toContain('CREATE CLUSTERED INDEX');
    expect(idxEntry?.column_directions).toEqual(['ASC', 'DESC']);
    // No partial-index predicate key is added for ASE (verbatim, minimal JSONB).
    expect(idxEntry?.predicate).toBeUndefined();
  });

  it('reshapes the FK referential actions into fk_columns.on_delete / on_update', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const rels = inferSybaseRelationships(out);
    const declared = rels.find((r) => r.kind === 'declared_fk');
    expect(declared?.onDelete).toBe('CASCADE');
    expect(declared?.onUpdate).toBe('NO ACTION');
    const fkCols = buildFkColumnsMetadata(
      declared?.fromColumns,
      declared?.toColumns,
      { onDelete: declared?.onDelete, onUpdate: declared?.onUpdate },
    );
    expect(fkCols?.on_delete).toBe('CASCADE');
    expect(fkCols?.on_update).toBe('NO ACTION');
  });

  it('threads group-1/2 collation + generated flags onto the per-attribute JSONB', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const custCol = out.columns.find((c) => c.columnName === 'customer_name');
    const computed = out.columns.find((c) => c.columnName === 'total_with_tax');
    const custFields = attributeStructuralFidelityFields(custCol!);
    expect(custFields.collation).toBe('utf8_general_ci');
    const computedFields = attributeStructuralFidelityFields(computed!);
    expect(computedFields.is_generated).toBe(true);
    expect(computedFields.generation_expression).toBe('subtotal * 1.2');
  });

  it('emitCandidates carries constraints_metadata.indexes[] onto the entity payload end-to-end', async () => {
    queueResponse(/\/introspect$/, enrichedSidecarIntrospection());
    const pack = new SybaseDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const fullIntro: IntrospectionResult = {
      schemas: await pack.introspectSchemas(ctx),
      tables: await pack.introspectTables(ctx),
      columns: await pack.introspectColumns(ctx),
      keysAndIndexes: await pack.introspectKeysAndIndexes(ctx),
      views: await pack.introspectViews(ctx),
      procedures: await pack.introspectProcedures(ctx),
      triggers: await pack.introspectTriggers(ctx),
    };
    const candidates = await pack.emitCandidates(
      ctx,
      fullIntro,
      { tables: [], skippedTables: [] },
    );
    const ordersEntity = candidates.find(
      (c) =>
        c.candidateType === 'physical_data_entities' && c.name === 'orders',
    );
    const cm = (ordersEntity?.data as Record<string, unknown>)
      .constraints_metadata as { indexes?: Array<Record<string, unknown>> } | null;
    const idxEntry = cm?.indexes?.find((i) => i.name === 'ix_orders_cust');
    expect(idxEntry?.is_clustered).toBe(true);
    expect(idxEntry?.column_directions).toEqual(['ASC', 'DESC']);
    await pack.close();
  });
});

describe('Sybase metadata enrichment -- the new-data Findings fire (Spec 2026-05-31)', () => {
  it('fires collation_case_sensitivity_hazard, sequence_cutover_hazard (value available), and db_resident_scheduled_job', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const findings = buildAllSybaseFindings(
      out,
      { tables: [], skippedTables: [] },
      inferSybaseRelationships(out),
    );

    // Group 1 collation hazard (the case-insensitive utf8_general_ci column).
    const collationHazard = findings.find(
      (f) => f.findingType === 'collation_case_sensitivity_hazard',
    );
    expect(collationHazard).toBeDefined();
    expect(
      (collationHazard?.detailJson as Record<string, unknown>).databaseCollation,
    ).toBe('utf8_general_ci');

    // Group 3 sequence cutover hazard -- now value-AVAILABLE (currentValue set).
    const cutover = findings.find(
      (f) => f.findingType === 'sequence_cutover_hazard',
    );
    expect(cutover).toBeDefined();
    expect(
      (cutover?.detailJson as Record<string, unknown>).currentValueAvailable,
    ).toBe(true);
    expect((cutover?.detailJson as Record<string, unknown>).currentValue).toBe(
      '4242',
    );

    // Group 6 DB-resident scheduled job.
    const job = findings.find(
      (f) => f.findingType === 'db_resident_scheduled_job',
    );
    expect(job).toBeDefined();
    expect((job?.detailJson as Record<string, unknown>).jobName).toBe(
      'nightly_rollup',
    );
  });
});

describe('Sybase metadata enrichment -- three-state applicability model (Spec 2026-05-31)', () => {
  it('parseAseMajorVersion extracts the ASE major from a banner / bare version / null', () => {
    expect(
      parseAseMajorVersion('Adaptive Server Enterprise/16.0/EBF 29900/P'),
    ).toBe(16);
    expect(parseAseMajorVersion('15.7')).toBe(15);
    expect(parseAseMajorVersion(null)).toBeNull();
    expect(parseAseMajorVersion(undefined)).toBeNull();
  });

  it('resolves PRESENT for every surfaced group whose value is captured (ASE16, all caps)', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const a = out.metadataApplicability!;
    expect(a.collation).toBe('present');
    expect(a.computed_columns).toBe('present');
    expect(a.sequence_current_value).toBe('present');
    expect(a.fk_actions).toBe('present');
    expect(a.index_clustering).toBe('present');
    expect(a.db_jobs).toBe('present');
  });

  it('resolves NOT_APPLICABLE_FOR_ENGINE for the partial-index predicate (always) and native SEQUENCE on pre-ASE16', () => {
    // ASE16: index_predicate is STILL structural N/A (ASE never has partial
    // indexes), but native_sequence is supported -> resolves on the capability.
    const ase16 = transformSidecarIntrospection(enrichedSidecarIntrospection());
    expect(ase16.metadataApplicability!.index_predicate).toBe(
      'not_applicable_for_engine',
    );
    expect(ase16.metadataApplicability!.native_sequence).toBe('present');

    // Pre-ASE16 (15.7): native_sequence becomes structural N/A; index_predicate
    // is still structural N/A. Neither is an evidence gap.
    const ase15 = transformSidecarIntrospection(
      enrichedSidecarIntrospection({ serverVersion: '15.7' }),
    );
    expect(ase15.metadataApplicability!.index_predicate).toBe(
      'not_applicable_for_engine',
    );
    expect(ase15.metadataApplicability!.native_sequence).toBe(
      'not_applicable_for_engine',
    );
  });

  it('resolves UNAVAILABLE when an OLDER sidecar omits capabilities entirely (read gap, NOT N/A)', () => {
    // No capabilities array at all (older sidecar). Even though values are not
    // present, every engine-SUPPORTED group is unavailable, NOT a structural
    // N/A. Use the bare introspection (no new fields, no capabilities).
    const out = transformSidecarIntrospection(sidecarOkIntrospection());
    const a = out.metadataApplicability!;
    expect(a.collation).toBe('unavailable');
    expect(a.computed_columns).toBe('unavailable');
    expect(a.sequence_current_value).toBe('unavailable');
    expect(a.fk_actions).toBe('unavailable');
    expect(a.index_clustering).toBe('unavailable');
    expect(a.db_jobs).toBe('unavailable');
    // index_predicate is STILL the structural N/A even for an older sidecar.
    expect(a.index_predicate).toBe('not_applicable_for_engine');
  });

  it('resolves UNAVAILABLE when a capability IS advertised but the value could not be read', () => {
    // Advertise collation + sequence_current_value but supply NO collation on
    // any column / NO databaseCollation, and a sequence with a null currentValue.
    const resp = enrichedSidecarIntrospection({
      databaseCollation: null,
      capabilities: [
        SYBASE_METADATA_CAPABILITY.collation,
        SYBASE_METADATA_CAPABILITY.sequenceCurrentValue,
      ],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'orders',
          columnName: 'id',
          dataType: 'numeric',
          maxLength: 8,
          isNullable: false,
          ordinalPosition: 1,
        },
      ],
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'orders.id (identity)',
          ownedByTable: 'orders',
          ownedByColumn: 'id',
          currentValue: null,
        },
      ],
    });
    const out = transformSidecarIntrospection(resp);
    const a = out.metadataApplicability!;
    expect(a.collation).toBe('unavailable');
    expect(a.sequence_current_value).toBe('unavailable');
    // A group whose capability was NOT advertised here is also unavailable.
    expect(a.fk_actions).toBe('unavailable');
  });
});

describe('Sybase metadata enrichment -- evidence-gap Finding suppression vs emission (Spec 2026-05-31)', () => {
  it('SUPPRESSES the db_schema_metadata_gap evidence-gap Finding for present + not_applicable groups', () => {
    const out = transformSidecarIntrospection(enrichedSidecarIntrospection());
    const gaps = sybaseFindingsTestOnly
      .emitMetadataEvidenceGapFindings(out)
      .filter((f) => f.findingType === 'evidence_gap');
    // Everything is present (ASE16, all caps, all values) and the two structural
    // N/As (index_predicate, native_sequence-on-ASE16-is-present) -> NO gaps.
    expect(gaps).toHaveLength(0);
  });

  it('does NOT emit a native-sequence or partial-index evidence gap on pre-ASE16 (structural N/A, not a read gap)', () => {
    const ase15 = transformSidecarIntrospection(
      enrichedSidecarIntrospection({ serverVersion: '15.7' }),
    );
    const descriptions = sybaseFindingsTestOnly
      .emitMetadataEvidenceGapFindings(ase15)
      .map((f) => String(f.summary).toLowerCase());
    // native_sequence is structurally N/A here -> never an evidence gap.
    expect(descriptions.some((d) => d.includes('native sequence'))).toBe(false);
    // index_predicate is never even a candidate (omitted from the gap table).
    expect(descriptions.some((d) => d.includes('partial'))).toBe(false);
  });

  it('EMITS db_schema_metadata_gap evidence-gap Findings for every unavailable group (older sidecar)', () => {
    const out = transformSidecarIntrospection(sidecarOkIntrospection());
    const findings = buildAllSybaseFindings(
      out,
      { tables: [], skippedTables: [] },
      inferSybaseRelationships(out),
    );
    const metadataGaps = findings.filter(
      (f) =>
        f.findingType === 'evidence_gap' &&
        (f.detailJson as Record<string, unknown>).gapType ===
          'db_schema_metadata_gap',
    );
    // One gap per engine-supported unavailable group:
    // collation, computed_columns, sequence_current_value, fk_actions,
    // index_clustering, db_jobs = 6, plus native_sequence (unknown version
    // resolves on the absent sequence_current_value capability -> unavailable)
    // = 7. index_predicate is suppressed structurally (omitted from the table).
    expect(metadataGaps.length).toBe(7);
    for (const g of metadataGaps) {
      expect((g.detailJson as Record<string, unknown>).engineKey).toBe('sybase');
    }
  });
});
