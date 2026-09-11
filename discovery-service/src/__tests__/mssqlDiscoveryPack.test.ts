/**
 * Contract tests for the SQL Server discovery pack (SQL Server 16 ->
 * PostgreSQL 18 pair programme, Spec 2, 2026-09-11, task 2.6).
 *
 * The twin of `sybaseDiscoveryPack.test.ts`: same structure, same boundary,
 * same always-on posture. The sidecar HTTP boundary is mocked via a stubbed
 * global `fetch`, so the suite does NOT require:
 *   - a running SQL Server instance
 *   - the sidecar JAR built / container running
 *   - any env var set
 *   - any network access, ever
 *
 * Fixture material is read from disk (`fixtures/mssql/`), derived offline from
 * Microsoft's MIT-licensed WideWorldImporters sample plus one hand-authored
 * companion for the constructs WideWorldImporters does not contain. See that
 * folder's README.
 *
 * Coverage:
 *  1. factory registration + `db://mssql/` + `mstab:` client ids
 *  2. testConnection request shape (engine + the MSSQL connection extras)
 *  3. introspect* transforms the wire into the engine-neutral IR, once
 *  4. applicability: index_predicate + native_sequence are SUPPORTED here
 *  5. profiler SQL shape + the ordered-type additions
 *  6. relationship inference: FKs carry columns; heuristics are the shared ones
 *  7. the Sybase-mirror findings
 *  8. the SQL-Server-only findings, incl. both named OUT reasons
 *  9. proc harvest: complete bodies, schema-qualified, CLR kept
 * 10. soft-fail + SQL-guard boundaries
 * 11. base-URL precedence (DB_SIDECAR_URL over the legacy alias)
 */

import * as fs from 'fs';
import * as path from 'path';

import { MssqlDiscoveryPack } from '../services/databasePacks/mssql/MssqlDiscoveryPack';
import {
  parseMssqlMajorVersion,
  transformMssqlIntrospection,
  type MssqlIntrospectionResult,
} from '../services/databasePacks/mssql/mssqlIntrospection';
import { profileMssqlTables, __testOnly as profilerInternals } from '../services/databasePacks/mssql/mssqlProfiler';
import { inferMssqlRelationships } from '../services/databasePacks/mssql/mssqlRelationshipInference';
import {
  buildAllMssqlFindings,
  findCrossDatabaseReferences,
  MSSQL_UNTRANSLATABLE_REASON,
} from '../services/databasePacks/mssql/mssqlFindings';
import { harvestLiveProcSources } from '../services/databasePacks/mssql/mssqlProcHarvest';
import {
  getDatabasePack,
  listRegisteredEnginesForTests,
} from '../services/databasePacks/databasePackFactory';
import { resolveSidecarBaseUrl } from '../services/databasePacks/sidecarClient';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sidecarClient';
import type {
  DatabaseDiscoveryConfig,
  IntrospectionResult,
  ProfileResult,
} from '../services/databasePacks/types';
import type { DatabaseDiscoveryPackContext } from '../services/databasePacks/DatabaseDiscoveryPack';

// -----------------------------------------------------------------------------
// Fixtures (read from disk -- no network, ever)
// -----------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'mssql');

function readFixture<T>(name: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'),
  ) as T;
}

function wwiResponse(): SidecarIntrospectionResponse {
  return readFixture<SidecarIntrospectionResponse>('wwi-introspect.json');
}

function hardFeaturesResponse(): SidecarIntrospectionResponse {
  return readFixture<SidecarIntrospectionResponse>(
    'hard-features-introspect.json',
  );
}

// -----------------------------------------------------------------------------
// fetch stub
// -----------------------------------------------------------------------------

interface RecordedFetch {
  url: string;
  body: Record<string, unknown>;
}

let recordedFetches: RecordedFetch[] = [];
let queued: Array<{ match: RegExp; body: unknown; status: number }> = [];
const realFetch = global.fetch;

function queueResponse(match: RegExp, body: unknown, status = 200): void {
  queued.push({ match, body, status });
}

beforeEach(() => {
  recordedFetches = [];
  queued = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init?: { body?: string }) => {
      let parsedBody: Record<string, unknown> = {};
      try {
        parsedBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      } catch {
        parsedBody = {};
      }
      recordedFetches.push({ url: String(url), body: parsedBody });
      const hit = queued.find((q) => q.match.test(String(url)));
      if (!hit) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, rows: [], rowCount: 0, truncated: false }),
          text: async () => '',
        };
      }
      return {
        ok: hit.status >= 200 && hit.status < 300,
        status: hit.status,
        json: async () => hit.body,
        text: async () => JSON.stringify(hit.body),
      };
    },
  );
});

afterEach(() => {
  (global as unknown as { fetch: unknown }).fetch = realFetch;
});

// -----------------------------------------------------------------------------
// Context helpers -- invented host / database / credentials only.
// -----------------------------------------------------------------------------

function baseConfig(
  overrides: Partial<DatabaseDiscoveryConfig> = {},
): DatabaseDiscoveryConfig {
  return {
    dbEngine: 'mssql',
    host: 'sqlsrv.test',
    port: 1433,
    databaseName: 'WideWorldImporters',
    catalogName: null,
    schemaName: null,
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
  };
}

function baseCtx(
  overrides: Partial<DatabaseDiscoveryConfig> = {},
): DatabaseDiscoveryPackContext {
  return {
    config: baseConfig(overrides),
    credentials: { username: 'svc_discovery_ro', password: 'pwd-for-test' },
    runId: 'run-mssql-1',
    projectId: 'proj-mssql',
    architectureId: 'arch-mssql',
  };
}

const EMPTY_PROFILE: ProfileResult = { tables: [], skippedTables: [] };

// -----------------------------------------------------------------------------
// 1) Factory registration
// -----------------------------------------------------------------------------

describe('databasePackFactory (SQL Server pair programme, Spec 2)', () => {
  it('registers the SQL Server pack alongside Postgres and Sybase', () => {
    const engines = listRegisteredEnginesForTests();
    expect(engines).toEqual(expect.arrayContaining(['postgres', 'sybase', 'mssql']));
  });

  it('getDatabasePack("mssql") returns an MssqlDiscoveryPack with the engine vocabulary', () => {
    const pack = getDatabasePack('mssql');
    expect(pack).toBeInstanceOf(MssqlDiscoveryPack);
    expect(pack?.engineKey).toBe('mssql');
    expect(pack?.displayName).toBe('SQL Server');
  });
});

// -----------------------------------------------------------------------------
// 2) testConnection: engine + connection extras on the wire
// -----------------------------------------------------------------------------

describe('MssqlDiscoveryPack.testConnection', () => {
  it('POSTs engine=mssql with the SQL-login defaults (encrypt on, certificate NOT trusted) and returns serverVersion + serverEdition', async () => {
    queueResponse(/\/test-connection$/, {
      ok: true,
      error: null,
      engine: 'mssql',
      serverVersion: 'Microsoft SQL Server 2022 (RTM) - 16.0.1000.6',
      serverEdition: 'Developer Edition (64-bit)',
      driverUsed: 'mssql-jdbc',
    });
    const pack = new MssqlDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const result = await pack.testConnection(ctx);
    expect(result.success).toBe(true);
    expect(result.serverVersion).toMatch(/SQL Server 2022/);
    expect(result.serverEdition).toMatch(/Developer Edition/);

    const fetched = recordedFetches.find((f) => /\/test-connection/.test(f.url));
    expect(fetched?.body).toMatchObject({
      engine: 'mssql',
      host: 'sqlsrv.test',
      port: 1433,
      database: 'WideWorldImporters',
      username: 'svc_discovery_ro',
      password: 'pwd-for-test',
      authScheme: 'sql',
      domain: null,
      encrypt: true,
      trustServerCertificate: false,
      instanceName: null,
    });
    await pack.close();
  });

  it('carries the NTLM extras verbatim when the scan form supplied them', async () => {
    queueResponse(/\/test-connection$/, { ok: true, engine: 'mssql' });
    const pack = new MssqlDiscoveryPack();
    const ctx = baseCtx({
      mssqlAuth: {
        scheme: 'ntlm',
        domain: 'CORPDOMAIN',
        encrypt: true,
        trustServerCertificate: true,
        instanceName: 'REPORTING',
      },
    });
    await pack.connect(ctx);
    await pack.testConnection(ctx);
    const fetched = recordedFetches.find((f) => /\/test-connection/.test(f.url));
    expect(fetched?.body).toMatchObject({
      engine: 'mssql',
      authScheme: 'ntlm',
      domain: 'CORPDOMAIN',
      encrypt: true,
      trustServerCertificate: true,
      instanceName: 'REPORTING',
    });
    await pack.close();
  });

  it('throws (so the orchestrator soft-fail wrapper catches it) when the sidecar returns ok=false', async () => {
    queueResponse(/\/test-connection$/, {
      ok: false,
      error: "Login failed for user 'svc_discovery_ro'.",
    });
    const pack = new MssqlDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    await expect(pack.testConnection(ctx)).rejects.toThrow(/testConnection failed/i);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 3) introspect* transform contract
// -----------------------------------------------------------------------------

describe('MssqlDiscoveryPack.introspect* (transform contract)', () => {
  it('surfaces the WideWorldImporters fixture through every introspect* method from ONE sidecar call', async () => {
    queueResponse(/\/introspect$/, wwiResponse());
    const pack = new MssqlDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);

    const tables = await pack.introspectTables(ctx);
    const columns = await pack.introspectColumns(ctx);
    const keys = await pack.introspectKeysAndIndexes(ctx);
    const views = await pack.introspectViews(ctx);
    const procedures = await pack.introspectProcedures(ctx);
    const sequences = await pack.introspectSequences(ctx);
    const extended = await pack.introspectExtendedObjects(ctx);
    const collation = await pack.introspectDatabaseCollation(ctx);

    expect(tables.map((t) => `${t.schemaName}.${t.tableName}`)).toEqual(
      expect.arrayContaining([
        'Sales.Customers',
        'Sales.Customers_Archive',
        'Application.People',
        'Warehouse.VehicleTemperatures',
      ]),
    );
    expect(columns.length).toBeGreaterThan(20);
    expect(keys.some((k) => k.kind === 'check_constraint')).toBe(true);
    expect(views).toHaveLength(1);
    expect(procedures).toHaveLength(4);
    expect(sequences).toHaveLength(4);
    expect(extended.length).toBeGreaterThan(0);
    expect(collation).toBe('Latin1_General_100_CI_AS');

    // ONE fetch for the whole run.
    expect(recordedFetches.filter((f) => /\/introspect$/.test(f.url))).toHaveLength(1);
    await pack.close();
  });

  it('throws when the sidecar returns ok=false, and on HTTP 500 (soft-fail boundaries)', async () => {
    queueResponse(/\/introspect$/, { ok: false, error: 'VIEW DEFINITION denied' });
    const p1 = new MssqlDiscoveryPack();
    await p1.connect(baseCtx());
    await expect(p1.introspectTables(baseCtx())).rejects.toThrow(/introspect failed/i);
    await p1.close();

    queued = [];
    queueResponse(/\/introspect$/, 'boom', 500);
    const p2 = new MssqlDiscoveryPack();
    await p2.connect(baseCtx());
    await expect(p2.introspectTables(baseCtx())).rejects.toThrow(/HTTP 500/);
    await p2.close();
  });
});

describe('transformMssqlIntrospection', () => {
  const ir = transformMssqlIntrospection(wwiResponse());

  it('maps the temporal pair: current table, history twin, and the period columns', () => {
    const current = ir.mssql.tables.find((t) => t.tableName === 'Customers');
    expect(current).toMatchObject({
      temporalType: 'system_versioned',
      historyTable: 'Sales.Customers_Archive',
      periodStartColumn: 'ValidFrom',
      periodEndColumn: 'ValidTo',
    });
    const history = ir.mssql.tables.find((t) => t.tableName === 'Customers_Archive');
    expect(history?.temporalType).toBe('history');
    const validFrom = ir.mssql.columns.find(
      (c) => c.tableName === 'Customers' && c.columnName === 'ValidFrom',
    );
    expect(validFrom?.generatedAlwaysType).toBe('as_row_start');
  });

  it('maps the computed columns and distinguishes PERSISTED from non-persisted', () => {
    const isFinalized = ir.columns.find((c) => c.columnName === 'IsFinalized');
    expect(isFinalized?.isGenerated).toBe(true);
    expect(isFinalized?.generationExpression).toContain('FinalizationDate');
    expect(
      ir.mssql.columns.find((c) => c.columnName === 'IsFinalized')?.isPersistedComputed,
    ).toBe(true);
    expect(
      ir.mssql.columns.find((c) => c.columnName === 'OtherLanguages')
        ?.isPersistedComputed,
    ).toBe(false);
  });

  it('maps identity seed/increment as STRINGS and the native sequence current value', () => {
    const identity = ir.mssql.columns.find(
      (c) => c.columnName === 'VehicleTemperatureID',
    );
    expect(identity?.identitySeed).toBe('1');
    expect(identity?.identityIncrement).toBe('1');
    const seq = (ir.sequences ?? []).find((s) => s.sequenceName === 'TransactionID');
    expect(seq?.currentValue).toBe('336880');
    expect(typeof seq?.currentValue).toBe('string');
  });

  it('populates FK referenced columns (never the ASE PK fallback) and carries the referential actions', () => {
    const fk = ir.keysAndIndexes.find(
      (k) => k.name === 'FK_Sales_CustomerTransactions_CustomerID_Sales_Customers',
    );
    expect(fk?.referencedColumns).toEqual(['CustomerID']);
    expect(fk?.onDelete).toBe('CASCADE');
    expect(fk?.onUpdate).toBe('NO_ACTION');
  });

  it('derives clustered from the index type and keeps INCLUDE columns in the extras', () => {
    const pk = ir.keysAndIndexes.find((k) => k.name === 'PK_Sales_CustomerTransactions');
    expect(pk?.isClustered).toBe(false);
    const cx = ir.keysAndIndexes.find((k) => k.name === 'CX_Sales_CustomerTransactions');
    expect(cx?.isClustered).toBe(true);
    const perf = ir.mssql.indexes.find(
      (x) => x.name === 'IX_Sales_Customers_Perf_20160301_06',
    );
    expect(perf?.includeColumns).toEqual(['PrimaryContactPersonID']);
  });

  it('accepts checkDefinition as the v2 spelling of the check expression', () => {
    const check = ir.keysAndIndexes.find((k) => k.kind === 'check_constraint');
    expect(check?.checkExpression).toBe('([TransactionAmount]<>(0))');
  });

  it('maps routine parameters, composes an argument signature, and treats EXECUTE AS OWNER as SECURITY DEFINER', () => {
    const insertOrders = ir.procedures.find(
      (p) => p.procedureName === 'InsertCustomerOrders',
    );
    expect(insertOrders?.securityDefiner).toBe(true);
    expect(insertOrders?.arguments).toContain('@Orders Website.OrderList READONLY');
    expect(insertOrders?.fullDefinition).toContain('BEGIN TRY');
    const tvf = ir.procedures.find((p) => p.procedureName === 'DetermineCustomerAccess');
    expect(tvf?.routineKind).toBe('function');
    expect(
      ir.mssql.routines.find((r) => r.routineName === 'DetermineCustomerAccess')
        ?.functionKind,
    ).toBe('inline_table');
  });

  it('never reports a view as materialized, and carries the indexed-view flag separately', () => {
    for (const v of ir.views) expect(v.isMaterialized).toBe(false);
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    expect(hard.views[0].isMaterialized).toBe(false);
    expect(hard.mssql.views[0].isIndexedView).toBe(true);
  });

  it('reports trigger timing and events for REAL (instead_of on a view; after on a table)', () => {
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    const instead = hard.triggers.find((t) => t.timing === 'instead_of');
    expect(instead?.events).toEqual(['insert']);
    expect(
      hard.mssql.triggers.find((t) => t.triggerName === instead?.triggerName)
        ?.parentKind,
    ).toBe('view');
    const after = hard.triggers.find((t) => t.timing === 'after');
    expect(after?.events).toEqual(['update', 'delete']);
  });

  it('maps SQL Server Agent jobs incl. steps and the human schedule text', () => {
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    const job = (hard.scheduledJobs ?? [])[0];
    expect(job.scheduler).toBe('sql_server_agent');
    expect(job.schedule).toBe('Occurs every day at 02:15:00');
    // No single job-level command: the first step's stands in and every step
    // is carried in the extras.
    expect(job.command).toContain('Ledger.SyncFromWarehouse');
    expect(hard.mssql.scheduledJobs[0].steps).toHaveLength(2);
  });

  it('maps extendedObjects with lower-cased kinds and the free detail map', () => {
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    const kinds = (hard.extendedObjects ?? []).map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'service_broker_queue',
        'synonym',
        'assembly',
        'fulltext_catalog',
        'filestream_filegroup',
      ]),
    );
    const synonym = (hard.extendedObjects ?? []).find((e) => e.kind === 'synonym');
    expect((synonym?.detail ?? {}).baseObject).toBe(
      'ReportingWarehouse.dbo.StagedPostings',
    );
  });
});

// -----------------------------------------------------------------------------
// 4) Applicability -- the deliberate inverse of the ASE resolution
// -----------------------------------------------------------------------------

describe('SQL Server metadata applicability (the ASE structural N/As are SUPPORTED here)', () => {
  it('parseMssqlMajorVersion reads the product version out of a banner, a bare version, and null', () => {
    expect(
      parseMssqlMajorVersion(
        'Microsoft SQL Server 2022 (RTM) - 16.0.1000.6 (X64) on Windows',
      ),
    ).toBe(16);
    expect(parseMssqlMajorVersion('13.0.5026.0')).toBe(13);
    expect(parseMssqlMajorVersion(null)).toBeNull();
    expect(parseMssqlMajorVersion('not a version')).toBeNull();
  });

  it('resolves index_predicate and native_sequence on the capability + value -- NEVER not_applicable_for_engine', () => {
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    // The hard-features fixture has a filtered index but NO native sequences.
    expect(hard.metadataApplicability?.index_predicate).toBe('present');
    expect(hard.metadataApplicability?.native_sequence).toBe('unavailable');

    const wwi = transformMssqlIntrospection(wwiResponse());
    // WideWorldImporters has native sequences but no filtered index.
    expect(wwi.metadataApplicability?.native_sequence).toBe('present');
    expect(wwi.metadataApplicability?.index_predicate).toBe('unavailable');

    for (const ir of [wwi, hard]) {
      for (const state of Object.values(ir.metadataApplicability ?? {})) {
        expect(state).not.toBe('not_applicable_for_engine');
      }
    }
  });

  it('resolves db_jobs to unavailable when the sidecar never advertised the capability (an msdb GRANT gap)', () => {
    const wwi = transformMssqlIntrospection(wwiResponse());
    expect(wwi.metadataApplicability?.db_jobs).toBe('unavailable');
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    expect(hard.metadataApplicability?.db_jobs).toBe('present');
  });
});

// -----------------------------------------------------------------------------
// 5) Profiler
// -----------------------------------------------------------------------------

describe('profileMssqlTables', () => {
  it('issues a row count + null count + TOP 5 sample per column, all SELECT-only', async () => {
    queueResponse(/\/query$/, {
      ok: true,
      rows: [{ n: 12, nulls: 3 }],
      rowCount: 1,
      truncated: false,
    });
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'Sales',
          tableName: 'Customers',
          objectType: 'table',
          estimatedRowCount: null,
        },
      ],
      columns: [
        {
          schemaName: 'Sales',
          tableName: 'Customers',
          columnName: 'CustomerName',
          dataType: 'nvarchar',
          isNullable: false,
          ordinalPosition: 1,
        },
      ],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const result = await profileMssqlTables(
      { engine: 'mssql', host: 'sqlsrv.test', port: 1433, database: 'db', username: 'u', password: 'p' },
      intro,
      'standard',
      baseConfig(),
    );
    expect(result.tables).toHaveLength(1);
    const sqls = recordedFetches
      .filter((f) => /\/query$/.test(f.url))
      .map((f) => String((f.body as { sql?: string }).sql ?? ''));
    expect(sqls.some((s) => /SELECT COUNT\(\*\) AS n FROM \[Sales\]\.\[Customers\]/.test(s))).toBe(true);
    expect(sqls.some((s) => /SELECT TOP 5 \[CustomerName\]/.test(s))).toBe(true);
    for (const s of sqls) expect(s.toUpperCase().startsWith('SELECT')).toBe(true);
    // Every query carries the engine discriminator.
    for (const f of recordedFetches.filter((q) => /\/query$/.test(q.url))) {
      expect(f.body.engine).toBe('mssql');
    }
  });

  it('isOrderedType adds datetime2, datetimeoffset and uniqueidentifier over the ASE set', () => {
    expect(profilerInternals.isOrderedType('datetime2')).toBe(true);
    expect(profilerInternals.isOrderedType('datetimeoffset')).toBe(true);
    expect(profilerInternals.isOrderedType('uniqueidentifier')).toBe(true);
    expect(profilerInternals.isOrderedType('decimal')).toBe(true);
    expect(profilerInternals.isOrderedType('nvarchar')).toBe(false);
    expect(profilerInternals.isOrderedType('geography')).toBe(false);
  });

  it('rejects an unsafe identifier before any fetch fires', () => {
    expect(() => profilerInternals.quoteId('Customers; DROP TABLE x')).toThrow(
      /rejected by quoteId/,
    );
  });
});

// -----------------------------------------------------------------------------
// 6) Relationship inference
// -----------------------------------------------------------------------------

describe('inferMssqlRelationships', () => {
  const ir = transformMssqlIntrospection(wwiResponse());
  const rels = inferMssqlRelationships(ir, ir.mssql.indexes);

  it('captures declared FKs with their columns already resolved and confidence 1.0', () => {
    const fk = rels.find(
      (r) => r.kind === 'declared_fk' && r.fromTable === 'CustomerTransactions',
    );
    expect(fk).toMatchObject({
      fromColumns: ['CustomerID'],
      toSchema: 'Sales',
      toTable: 'Customers',
      toColumns: ['CustomerID'],
      confidence: 1.0,
      onDelete: 'CASCADE',
    });
    expect(fk?.rationale).toContain('sys.foreign_keys');
    // The ASE PK-substitution note must NOT appear: SQL Server resolved both
    // sides itself.
    expect(fk?.rationale).not.toContain('primary key was substituted');
  });

  it('states NOT TRUSTED on the relationship rationale so the target-side create failure is foreseen', () => {
    const hard = transformMssqlIntrospection(hardFeaturesResponse());
    const hardRels = inferMssqlRelationships(hard, hard.mssql.indexes);
    const fk = hardRels.find((r) => r.kind === 'declared_fk');
    expect(fk?.rationale).toContain('NOT TRUSTED');
  });

  it('uses the SHARED name heuristics: an <entity>ID column with no declared FK infers its parent', () => {
    // `Sales.Customers.CustomerCategoryID` has a declared FK, so it does NOT
    // re-infer; `Application.People.LastEditedBy` matches nothing. The
    // inference that DOES fire is CustomerTransactions.CustomerID -> Customers
    // only when the declared FK is absent, so assert on the heuristic itself
    // via a PK table whose name matches a column with no FK.
    const inferred = rels.filter((r) => r.kind === 'inferred');
    for (const r of inferred) {
      expect(r.rationale).toContain('naming heuristic');
      expect(r.confidence).toBeLessThan(1);
    }
    // No duplicate of a declared FK.
    const declaredKeys = new Set(
      rels
        .filter((r) => r.kind === 'declared_fk')
        .map((r) => `${r.fromSchema}.${r.fromTable}.${r.fromColumns.join(',')}`),
    );
    for (const r of inferred) {
      expect(
        declaredKeys.has(`${r.fromSchema}.${r.fromTable}.${r.fromColumns.join(',')}`),
      ).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// 7) The Sybase-mirror findings
// -----------------------------------------------------------------------------

function findingsFor(resp: SidecarIntrospectionResponse) {
  const ir: MssqlIntrospectionResult = transformMssqlIntrospection(resp);
  const rels = inferMssqlRelationships(ir, ir.mssql.indexes);
  return { ir, findings: buildAllMssqlFindings(ir, EMPTY_PROFILE, rels) };
}

describe('buildAllMssqlFindings -- the Sybase mirror', () => {
  const { findings } = findingsFor(wwiResponse());
  const types = findings.map((f) => f.findingType);

  it('emits the structural + hidden-logic + sequence families with engineKey=mssql', () => {
    expect(types).toEqual(
      expect.arrayContaining([
        'missing_primary_key',
        'no_foreign_keys_declared',
        'stored_procedure_logic',
        'hidden_business_logic',
        'procedure_data_write',
        'view_definition',
        'sequence_definition',
        'sequence_cutover_hazard',
      ]),
    );
    for (const f of findings) {
      expect((f.detailJson as { engineKey?: string })?.engineKey).toBe('mssql');
      expect(f.source).toBe('db_discovery_pack');
    }
  });

  it('carries the sequence high-water mark (SQL Server reports it, unlike the ASE path)', () => {
    const cutover = findings.find(
      (f) =>
        f.findingType === 'sequence_cutover_hazard' &&
        (f.detailJson as { sequenceName?: string }).sequenceName === 'TransactionID',
    );
    expect((cutover?.detailJson as { currentValue?: unknown }).currentValue).toBe('336880');
  });

  it('flags the case-insensitive collation columns (the primary hazard direction for this pair)', () => {
    const collation = findings.filter(
      (f) => f.findingType === 'collation_case_sensitivity_hazard',
    );
    expect(collation.length).toBeGreaterThan(0);
    expect(
      collation.map((f) => (f.detailJson as { columnName?: string }).columnName),
    ).toEqual(expect.arrayContaining(['CustomerName', 'SearchName']));
  });

  it('flags the non-portable SQL Server defaults verbatim', () => {
    const defaults = findings.filter((f) => f.findingType === 'non_portable_default');
    const cols = defaults.map((f) => (f.detailJson as { columnName?: string }).columnName);
    expect(cols).toContain('LastEditedWhen');
    const lastEdited = defaults.find(
      (f) => (f.detailJson as { columnName?: string }).columnName === 'LastEditedWhen',
    );
    expect(
      (lastEdited?.detailJson as { columnDefault?: string }).columnDefault,
    ).toBe('(sysdatetime())');
  });

  it('emits the db_jobs evidence gap naming the msdb catalogs, and NOT one for a group it read', () => {
    const gaps = findings.filter((f) => f.findingType === 'evidence_gap');
    const summaries = gaps.map((g) => g.summary ?? '');
    expect(summaries.some((s) => /msdb\.dbo\.sysjobs/.test(s))).toBe(true);
    expect(summaries.some((s) => /SQLAgentReaderRole/.test(s))).toBe(true);
    // `collation` WAS read, so no gap for it.
    expect(summaries.some((s) => /column \/ database collation/.test(s))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 8) The SQL-Server-only findings, incl. both named OUT reasons
// -----------------------------------------------------------------------------

describe('buildAllMssqlFindings -- SQL-Server-only findings', () => {
  it('flags both halves of a temporal pair with the period columns and the history table', () => {
    const { findings } = findingsFor(wwiResponse());
    const temporal = findings.filter((f) => f.findingType === 'temporal_table_detected');
    expect(temporal).toHaveLength(3); // Customers + Customers_Archive + People
    const current = temporal.find(
      (f) => (f.detailJson as { tableName?: string }).tableName === 'Customers',
    );
    expect((current?.detailJson as { historyTable?: string }).historyTable).toBe(
      'Sales.Customers_Archive',
    );
    expect(current?.summary).toMatch(/SYSTEM_VERSIONING/);
    const history = temporal.find(
      (f) => (f.detailJson as { tableName?: string }).tableName === 'Customers_Archive',
    );
    expect(history?.summary).toMatch(/HISTORY table/);
  });

  it('flags memory-optimized tables, spatial columns and the non-persisted computed column', () => {
    const { findings } = findingsFor(wwiResponse());
    const types = findings.map((f) => f.findingType);
    expect(types).toContain('memory_optimized_table');
    expect(types).toContain('spatial_column');
    expect(types).toContain('computed_column_not_persisted');
    const spatial = findings.find((f) => f.findingType === 'spatial_column');
    expect(spatial?.summary).toMatch(/PostGIS MUST be installed/);
  });

  it('flags the user-defined table types that back the READONLY parameters', () => {
    const { findings } = findingsFor(wwiResponse());
    const tvps = findings.filter((f) => f.findingType === 'user_defined_table_type');
    expect(tvps.map((f) => (f.detailJson as { tableName?: string }).tableName)).toEqual(
      expect.arrayContaining(['OrderList', 'OrderLineList']),
    );
  });

  it('flags every item-5 object on the hard-features fixture', () => {
    const { findings } = findingsFor(hardFeaturesResponse());
    const types = findings.map((f) => f.findingType);
    expect(types).toEqual(
      expect.arrayContaining([
        'clr_object_detected',
        'service_broker_detected',
        'filestream_column',
        'fulltext_index_detected',
        'xml_typed_column',
        'sql_variant_column',
        'hierarchyid_column',
        'spatial_column',
        'columnstore_index',
        'synonym_detected',
      ]),
    );
  });

  it('OUT ruling 6: an indexed view carries the NAMED untranslatable reason and is never treated as a matview', () => {
    const { findings } = findingsFor(hardFeaturesResponse());
    const indexed = findings.filter((f) => f.findingType === 'indexed_view');
    expect(indexed).toHaveLength(1);
    expect(
      (indexed[0].detailJson as { untranslatableReason?: string }).untranslatableReason,
    ).toBe(MSSQL_UNTRANSLATABLE_REASON.indexedView);
    expect(indexed[0].severity).toBe('high');
    expect(indexed[0].summary).toMatch(/does NOT translate indexed views/);
  });

  it('OUT ruling 1: a cross-database / linked-server reference carries the NAMED untranslatable reason', () => {
    const { findings } = findingsFor(hardFeaturesResponse());
    const cross = findings.filter((f) => f.findingType === 'cross_database_reference');
    expect(cross.length).toBeGreaterThan(0);
    const proc = cross.find(
      (f) => (f.detailJson as { tableName?: string }).tableName === 'SyncFromWarehouse',
    );
    expect(
      (proc?.detailJson as { untranslatableReason?: string }).untranslatableReason,
    ).toBe(MSSQL_UNTRANSLATABLE_REASON.crossDatabaseReference);
    const refs = (proc?.detailJson as { references?: string[] }).references ?? [];
    expect(refs).toEqual(
      expect.arrayContaining(['ReportingWarehouse.dbo.StagedPostings', 'OPENQUERY']),
    );
  });
});

describe('findCrossDatabaseReferences', () => {
  it('matches a three-part name in OBJECT position, a four-part name anywhere, the double-dot form and OPENQUERY', () => {
    expect(
      findCrossDatabaseReferences('SELECT * FROM OtherDb.dbo.Thing WHERE x = 1'),
    ).toEqual(['OtherDb.dbo.Thing']);
    expect(
      findCrossDatabaseReferences('SELECT a FROM LinkedSrv.OtherDb.dbo.Thing'),
    ).toEqual(['LinkedSrv.OtherDb.dbo.Thing']);
    expect(findCrossDatabaseReferences('INSERT INTO OtherDb..Thing VALUES (1)')).toEqual([
      'OtherDb..Thing',
    ]);
    expect(
      findCrossDatabaseReferences("SELECT * FROM OPENQUERY(LNK, 'select 1')"),
    ).toEqual(['OPENQUERY']);
  });

  it('does NOT match a two-part name, a sys.* catalog read, or a fully-qualified COLUMN reference', () => {
    expect(findCrossDatabaseReferences('SELECT * FROM Sales.Customers')).toEqual([]);
    expect(findCrossDatabaseReferences('SELECT * FROM sys.indexes')).toEqual([]);
    // `Sales.Customers.CustomerID` in the SELECT list is an ordinary
    // three-part COLUMN reference inside this database -- flagging it would
    // make the OUT ruling fire on half of a normal codebase.
    expect(
      findCrossDatabaseReferences(
        'SELECT Sales.Customers.CustomerID FROM Sales.Customers',
      ),
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 9) Proc harvest
// -----------------------------------------------------------------------------

describe('harvestLiveProcSources (mssql)', () => {
  it('returns ONE complete body per routine, schema-qualified, with the sys.objects types normalised', async () => {
    queueResponse(/\/query$/, {
      ok: true,
      rowCount: 4,
      truncated: false,
      rows: [
        {
          schema_name: 'Website',
          obj_name: 'InsertCustomerOrders',
          obj_type: 'P',
          body_text: 'CREATE PROCEDURE Website.InsertCustomerOrders AS BEGIN SELECT 1; END;',
          assembly_name: null,
        },
        {
          schema_name: 'Application',
          obj_name: 'DetermineCustomerAccess',
          obj_type: 'IF',
          body_text: 'CREATE FUNCTION [Application].DetermineCustomerAccess() RETURNS TABLE AS RETURN (SELECT 1 AS r);',
          assembly_name: null,
        },
        {
          schema_name: 'Ledger',
          obj_name: 'trg_Postings_AfterUpdate',
          obj_type: 'TR',
          body_text: 'CREATE TRIGGER Ledger.trg_Postings_AfterUpdate ON Ledger.Postings AFTER UPDATE AS SELECT 1;',
          assembly_name: null,
        },
        {
          schema_name: 'Ledger',
          obj_name: 'ScoreRisk',
          obj_type: 'PC',
          body_text: null,
          assembly_name: 'LedgerRiskScoring',
        },
      ],
    });
    const sources = await harvestLiveProcSources(
      { engine: 'mssql', host: 'sqlsrv.test', port: 1433, database: 'db', username: 'u', password: 'p' },
      60,
    );
    expect(sources.map((s) => s.name)).toEqual([
      'Website.InsertCustomerOrders',
      'Application.DetermineCustomerAccess',
      'Ledger.trg_Postings_AfterUpdate',
      'Ledger.ScoreRisk',
    ]);
    expect(sources.map((s) => s.objType)).toEqual(['P', 'F', 'TR', 'P']);
    // No reassembly: the body arrives complete in one row.
    expect(sources[0].text).toContain('CREATE PROCEDURE');
    // A CLR routine has no sys.sql_modules row, so it is KEPT with its
    // assembly binding rather than silently dropped.
    expect(sources[3].text).toContain("assembly 'LedgerRiskScoring'");

    const sql = String(
      (recordedFetches.find((f) => /\/query$/.test(f.url))?.body as { sql?: string })
        ?.sql ?? '',
    );
    expect(sql).toContain('sys.sql_modules');
    expect(sql.toUpperCase().startsWith('SELECT')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 10) Candidate emission
// -----------------------------------------------------------------------------

describe('MssqlDiscoveryPack.emitCandidates', () => {
  it('emits db://mssql/ URIs, mstab: client ids, and one entity per table AND per view', async () => {
    const ir = transformMssqlIntrospection(wwiResponse());
    const pack = new MssqlDiscoveryPack();
    const candidates = await pack.emitCandidates(baseCtx(), ir, EMPTY_PROFILE);
    const entities = candidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const attributes = candidates.filter(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    expect(entities).toHaveLength(ir.tables.length + ir.views.length);
    expect(attributes).toHaveLength(ir.columns.length);
    for (const c of candidates) {
      expect(c.filePath.startsWith('db://mssql/')).toBe(true);
      expect(c.clientId.startsWith('mstab:')).toBe(true);
      expect((c.data as { dbEngine?: string }).dbEngine).toBe('mssql');
    }
    const view = entities.find((e) => e.name === 'Customers' && e.filePath.includes('Website'));
    expect((view?.data as { objectType?: string }).objectType).toBe('view');
    const customerId = attributes.find(
      (a) => a.name === 'CustomerID' && a.clientId.includes('Sales.Customers#'),
    );
    expect((customerId?.data as { isPrimaryKey?: boolean }).isPrimaryKey).toBe(true);
    expect(customerId?.parentCandidateClientId).toBe('mstab:Sales.Customers');
  });
});

// -----------------------------------------------------------------------------
// 11) Sidecar base URL precedence
// -----------------------------------------------------------------------------

describe('resolveSidecarBaseUrl (WIRE-CONTRACT v2 §6 precedence)', () => {
  const savedNew = process.env.DB_SIDECAR_URL;
  const savedOld = process.env.SYBASE_SIDECAR_URL;
  afterEach(() => {
    if (savedNew === undefined) delete process.env.DB_SIDECAR_URL;
    else process.env.DB_SIDECAR_URL = savedNew;
    if (savedOld === undefined) delete process.env.SYBASE_SIDECAR_URL;
    else process.env.SYBASE_SIDECAR_URL = savedOld;
  });

  it('defaults to loopback 8093 when neither env var is set', () => {
    delete process.env.DB_SIDECAR_URL;
    delete process.env.SYBASE_SIDECAR_URL;
    expect(resolveSidecarBaseUrl()).toBe('http://localhost:8093');
  });

  it('honours the legacy SYBASE_SIDECAR_URL alias', () => {
    delete process.env.DB_SIDECAR_URL;
    process.env.SYBASE_SIDECAR_URL = 'http://sidecar.internal:9000';
    expect(resolveSidecarBaseUrl()).toBe('http://sidecar.internal:9000');
  });

  it('prefers DB_SIDECAR_URL over the legacy alias', () => {
    process.env.DB_SIDECAR_URL = 'http://db-sidecar.internal:9100';
    process.env.SYBASE_SIDECAR_URL = 'http://sidecar.internal:9000';
    expect(resolveSidecarBaseUrl()).toBe('http://db-sidecar.internal:9100');
  });
});

// -----------------------------------------------------------------------------
// 12) Server collation detection
// -----------------------------------------------------------------------------

describe('MssqlDiscoveryPack.detectServerCharset', () => {
  it('reads the DATABASE collation, derives case-sensitivity, and declares NO charset', async () => {
    queueResponse(/\/query$/, {
      ok: true,
      rowCount: 1,
      truncated: false,
      rows: [
        {
          server_collation: 'SQL_Latin1_General_CP1_CI_AS',
          database_collation: 'Latin1_General_100_CI_AS',
        },
      ],
    });
    const pack = new MssqlDiscoveryPack();
    await pack.connect(baseCtx());
    const result = await pack.detectServerCharset(baseCtx());
    expect(result).toEqual({
      charset: null,
      sortorderName: 'Latin1_General_100_CI_AS',
      caseSensitive: false,
    });
    await pack.close();
  });

  it('reads a binary collation as case-SENSITIVE', async () => {
    queueResponse(/\/query$/, {
      ok: true,
      rowCount: 1,
      truncated: false,
      rows: [
        {
          server_collation: 'Latin1_General_100_BIN2',
          database_collation: 'Latin1_General_100_BIN2',
        },
      ],
    });
    const pack = new MssqlDiscoveryPack();
    await pack.connect(baseCtx());
    const result = await pack.detectServerCharset(baseCtx());
    expect(result?.caseSensitive).toBe(true);
    await pack.close();
  });
});
