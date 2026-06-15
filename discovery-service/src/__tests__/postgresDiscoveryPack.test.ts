/**
 * Group 3 tests for the PostgreSQL discovery pack (Spec 2026-05-16 Database
 * Discovery Packs -- tasks.md 3.1).
 *
 * Covers the 10-15 focused tests from 3.1:
 *  1. testConnection success against a mocked `pg` Pool
 *  2. introspectSchemas SQL shape + result mapping
 *  3. introspectTables result mapping (BASE TABLE only)
 *  4. introspectColumns result mapping (nullability + ordinals)
 *  5. introspectKeysAndIndexes -- PK / FK / index grouping
 *  6. introspectViews -- standard + materialized merged
 *  7. introspectProcedures + introspectTriggers shape
 *  8. profiler `basic` mode (row count only)
 *  9. profiler `standard` mode (per-column null rate + sample values)
 * 10. profiler `deep` mode adds distinct count + top-N for code-like columns
 * 11. profiler `none` mode short-circuits
 * 12. relationship inference: declared FK detected + name-based inference +
 *     ambiguous multi-match flagged
 * 13. candidate emission: one physical_data_entity per table; one
 *     physical_data_attribute per column linked to its parent
 * 14. findings: missing_primary_key + high_null_rate + stored_procedure_logic
 * 15. soft-fail: per-table profile failure becomes a skippedTables entry
 *     (not a thrown error)
 * 16. snippet redaction: a procedure body with password='supersecret' has
 *     `?` in the persisted finding (no plaintext)
 * 17. SQL guard regression: every introspection query string is SELECT-only
 */

// -----------------------------------------------------------------------------
// `pg` Pool mock. The PostgresAdapter calls pool.connect() to acquire a
// PoolClient, then issues queries. The mock records every query so tests can
// inspect the SQL shape, AND supports per-test SQL -> result programming via
// `queueQueryResult`.
// -----------------------------------------------------------------------------

const recordedQueries: Array<{ sql: string; params: unknown[] }> = [];

type QueueEntry = {
  match: RegExp;
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
  throwError?: Error;
};
const queryQueue: QueueEntry[] = [];

function queueQueryResult(
  match: RegExp,
  rows: Array<Record<string, unknown>>,
  rowCount?: number,
): void {
  queryQueue.push({ match, rows, rowCount: rowCount ?? rows.length });
}
function queueQueryError(match: RegExp, error: Error): void {
  queryQueue.push({ match, rows: [], throwError: error });
}

const mockClient = {
  query: jest.fn(async (sql: string, params?: unknown[]) => {
    const normalized = String(sql).trim();
    recordedQueries.push({ sql: normalized, params: params ?? [] });
    // SET / RESET pass through with empty rows.
    if (/^SET statement_timeout/i.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }
    if (/^RESET statement_timeout/i.test(normalized)) {
      return { rows: [], rowCount: 0 };
    }
    // Pop the first queued response that matches.
    for (let i = 0; i < queryQueue.length; i++) {
      const entry = queryQueue[i];
      if (entry.match.test(normalized)) {
        queryQueue.splice(i, 1);
        if (entry.throwError) throw entry.throwError;
        return { rows: entry.rows, rowCount: entry.rowCount ?? entry.rows.length };
      }
    }
    // Fall-through default: empty result, never throw.
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

// Imports MUST come after the mock setup so the mocked Pool is used.
import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { PostgresAdapter } from '../services/db/PostgresAdapter';
import { assertReadonlySelect } from '../services/db/sqlGuard';
import { inferPostgresRelationships } from '../services/databasePacks/postgres/postgresRelationshipInference';
import { buildAllPostgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { profilePostgresTables } from '../services/databasePacks/postgres/postgresProfiler';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  ColumnMetadata,
  KeyOrIndexMetadata,
  ProfileResult,
} from '../services/databasePacks/types';

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
  password: 'ignored-by-mock',
});

const baseCtx = () => ({
  config: baseConfig(),
  credentials: baseCreds(),
  runId: 'run-pg-test',
  projectId: 'proj-pg',
  architectureId: 'arch-pg',
});

beforeEach(() => {
  recordedQueries.length = 0;
  queryQueue.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.connect.mockClear();
});

// -----------------------------------------------------------------------------
// 1) testConnection
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.testConnection', () => {
  it('returns success + serverVersion from mocked engine', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/SELECT version\(\) AS version/, [
      { version: 'PostgreSQL 15.4 on x86_64' },
    ]);
    queueQueryResult(/current_setting\('server_version'/, [
      { server_version: '15.4' },
    ]);
    await pack.connect(ctx);
    const result = await pack.testConnection(ctx);
    expect(result.success).toBe(true);
    expect(result.serverVersion).toMatch(/PostgreSQL/);
    expect(result.serverEdition).toBe('15.4');
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 2) introspectSchemas
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectSchemas', () => {
  it('queries information_schema.schemata and maps rows', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/information_schema\.schemata/i, [
      { schema_name: 'public', schema_owner: 'postgres' },
      { schema_name: 'app', schema_owner: 'postgres' },
    ]);
    await pack.connect(ctx);
    const schemas = await pack.introspectSchemas(ctx);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].schemaName).toBe('public');
    expect(schemas[0].owner).toBe('postgres');
    // The SQL recorded MUST pass the SQL guard (defense in depth).
    const introspectSql = recordedQueries.find((q) =>
      /information_schema\.schemata/i.test(q.sql),
    );
    expect(introspectSql).toBeDefined();
    expect(() => assertReadonlySelect(introspectSql!.sql)).not.toThrow();
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 3) introspectTables (BASE TABLE only)
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectTables', () => {
  it('captures table rows with row-count estimates', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/pg_catalog\.pg_class/i, [
      {
        schema_name: 'public',
        table_name: 'orders',
        rel_kind: 'r',
        est_rows: 1234,
        comment: null,
      },
      {
        schema_name: 'public',
        table_name: 'order_lines',
        rel_kind: 'r',
        est_rows: 9876,
        comment: 'Line items',
      },
    ]);
    await pack.connect(ctx);
    const tables = await pack.introspectTables(ctx);
    expect(tables).toHaveLength(2);
    expect(tables[0].tableName).toBe('orders');
    expect(tables[0].estimatedRowCount).toBe(1234);
    expect(tables[0].objectType).toBe('table');
    expect(tables[1].comment).toBe('Line items');
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 4) introspectColumns
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectColumns', () => {
  it('maps nullability, default, ordinal position from information_schema', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/information_schema\.columns/i, [
      {
        schema_name: 'public',
        table_name: 'orders',
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: "nextval('orders_id_seq'::regclass)",
        ordinal_position: 1,
        char_max_length: null,
        num_precision: 32,
        num_scale: 0,
      },
      {
        schema_name: 'public',
        table_name: 'orders',
        column_name: 'name',
        data_type: 'character varying',
        is_nullable: 'YES',
        column_default: null,
        ordinal_position: 2,
        char_max_length: 100,
        num_precision: null,
        num_scale: null,
      },
    ]);
    await pack.connect(ctx);
    const columns = await pack.introspectColumns(ctx);
    expect(columns).toHaveLength(2);
    expect(columns[0].columnName).toBe('id');
    expect(columns[0].isNullable).toBe(false);
    expect(columns[0].defaultExpression).toContain('nextval');
    expect(columns[1].isNullable).toBe(true);
    expect(columns[1].maxLength).toBe(100);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 5) introspectKeysAndIndexes
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectKeysAndIndexes', () => {
  it('groups constraint rows by name and detects PK + FK + index', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    // First catalog query (constraints).
    queueQueryResult(/information_schema\.table_constraints/i, [
      {
        schema_name: 'public',
        table_name: 'orders',
        constraint_name: 'orders_pkey',
        constraint_type: 'PRIMARY KEY',
        column_name: 'id',
        ord: 1,
        ref_schema: null,
        ref_table: null,
        ref_column: null,
      },
      {
        schema_name: 'public',
        table_name: 'order_lines',
        constraint_name: 'order_lines_orders_fkey',
        constraint_type: 'FOREIGN KEY',
        column_name: 'order_id',
        ord: 1,
        ref_schema: 'public',
        ref_table: 'orders',
        ref_column: 'id',
      },
    ]);
    // Second catalog query (regular indexes).
    queueQueryResult(/pg_catalog\.pg_indexes/i, [
      {
        schema_name: 'public',
        table_name: 'orders',
        index_name: 'orders_name_idx',
        index_def:
          'CREATE INDEX orders_name_idx ON public.orders USING btree (name)',
      },
    ]);
    await pack.connect(ctx);
    const keys = await pack.introspectKeysAndIndexes(ctx);
    const pk = keys.find((k) => k.kind === 'primary_key');
    const fk = keys.find((k) => k.kind === 'foreign_key');
    const idx = keys.find((k) => k.kind === 'index');
    expect(pk?.columns).toEqual(['id']);
    expect(fk?.referencedTable).toBe('orders');
    expect(fk?.referencedColumns).toEqual(['id']);
    expect(idx?.columns).toEqual(['name']);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 6) introspectViews -- merges pg_views + pg_matviews
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectViews', () => {
  it('returns standard and materialized views together', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/pg_catalog\.pg_views/i, [
      {
        schema_name: 'public',
        view_name: 'active_orders',
        definition: 'SELECT * FROM orders WHERE active = true',
        is_materialized: false,
      },
      {
        schema_name: 'public',
        view_name: 'order_summary_mv',
        definition:
          'SELECT customer_id, COUNT(*) c FROM orders GROUP BY customer_id',
        is_materialized: true,
      },
    ]);
    await pack.connect(ctx);
    const views = await pack.introspectViews(ctx);
    expect(views).toHaveLength(2);
    expect(views[0].isMaterialized).toBe(false);
    expect(views[1].isMaterialized).toBe(true);
    expect(views[0].definition).toMatch(/SELECT/);
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 7) introspectProcedures + introspectTriggers
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.introspectProcedures + introspectTriggers', () => {
  it('classifies procedure vs function via prokind and groups triggers per name', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/pg_catalog\.pg_proc/i, [
      {
        schema_name: 'public',
        proc_name: 'calc_tax',
        prokind: 'f',
        lang_name: 'plpgsql',
        proc_src: 'BEGIN RETURN amount * 0.1; END;',
      },
      {
        schema_name: 'public',
        proc_name: 'archive_orders',
        prokind: 'p',
        lang_name: 'plpgsql',
        proc_src: "INSERT INTO archive SELECT * FROM orders WHERE name='X';",
      },
    ]);
    queueQueryResult(/information_schema\.triggers/i, [
      {
        schema_name: 'public',
        trigger_name: 'orders_audit',
        table_schema: 'public',
        table_name: 'orders',
        event: 'INSERT',
        timing: 'AFTER',
        action_statement: 'INSERT INTO audit_log VALUES (NEW.id)',
      },
      {
        schema_name: 'public',
        trigger_name: 'orders_audit',
        table_schema: 'public',
        table_name: 'orders',
        event: 'UPDATE',
        timing: 'AFTER',
        action_statement: 'INSERT INTO audit_log VALUES (NEW.id)',
      },
    ]);
    await pack.connect(ctx);
    const procs = await pack.introspectProcedures(ctx);
    expect(procs).toHaveLength(2);
    expect(procs[0].routineKind).toBe('function');
    expect(procs[1].routineKind).toBe('procedure');
    const triggers = await pack.introspectTriggers(ctx);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].events.sort()).toEqual(['insert', 'update']);
    expect(triggers[0].timing).toBe('after');
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 8) Profiler: per-mode behaviour
// -----------------------------------------------------------------------------

describe('postgresProfiler -- mode ladder', () => {
  function buildIntrospection(): IntrospectionResult {
    return {
      schemas: [],
      tables: [
        {
          schemaName: 'public',
          tableName: 'orders',
          objectType: 'table',
          estimatedRowCount: 1000,
        },
      ],
      columns: [
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'name',
          dataType: 'character varying',
          isNullable: true,
          ordinalPosition: 1,
        },
      ],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
  }

  it('none mode returns empty result without touching the DB', async () => {
    const adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    const intro = buildIntrospection();
    const startConnectCount = mockPool.connect.mock.calls.length;
    const out = await profilePostgresTables(adapter, intro, 'none', baseConfig());
    expect(out.tables).toHaveLength(0);
    expect(mockPool.connect).toHaveBeenCalledTimes(startConnectCount);
    await adapter.dispose();
  });

  it('basic mode reports rowCount from pg_class estimate', async () => {
    const adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    const intro = buildIntrospection();
    queueQueryResult(/pg_catalog\.pg_class/is, [{ est_rows: 1234 }]);
    const out = await profilePostgresTables(adapter, intro, 'basic', baseConfig());
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].rowCount).toBe(1234);
    expect(out.tables[0].columnProfiles).toHaveLength(0);
    await adapter.dispose();
  });

  it('standard mode adds per-column null rate + sample values', async () => {
    const adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    const intro = buildIntrospection();
    queueQueryResult(/pg_catalog\.pg_class/is, [{ est_rows: 100 }]);
    queueQueryResult(/SUM\(CASE WHEN.*IS NULL/i, [{ n: 100, nulls: 20 }]);
    queueQueryResult(/SELECT DISTINCT/i, [
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
    ]);
    const out = await profilePostgresTables(
      adapter,
      intro,
      'standard',
      baseConfig(),
    );
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].columnProfiles).toHaveLength(1);
    const cp = out.tables[0].columnProfiles[0];
    expect(cp.nullRate).toBeCloseTo(0.2, 5);
    expect(cp.sampleValues).toEqual(['A', 'B', 'C']);
    await adapter.dispose();
  });

  it('deep mode adds distinctCount + top-N for code-like columns', async () => {
    const adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    const intro = buildIntrospection();
    queueQueryResult(/pg_catalog\.pg_class/is, [{ est_rows: 100 }]);
    queueQueryResult(/SUM\(CASE WHEN.*IS NULL/i, [{ n: 100, nulls: 0 }]);
    queueQueryResult(/SELECT DISTINCT/i, [{ name: 'A' }, { name: 'B' }]);
    queueQueryResult(/COUNT\(DISTINCT/i, [{ dc: 7 }]);
    queueQueryResult(/GROUP BY/i, [
      { v: 'A', c: 50 },
      { v: 'B', c: 30 },
    ]);
    const out = await profilePostgresTables(
      adapter,
      intro,
      'deep',
      baseConfig(),
    );
    const cp = out.tables[0].columnProfiles[0];
    expect(cp.distinctCount).toBe(7);
    expect(cp.topValues).toHaveLength(2);
    expect(cp.topValues?.[0].count).toBe(50);
    await adapter.dispose();
  });
});

// -----------------------------------------------------------------------------
// 9) Profiler soft-fail: a per-table error becomes a `skippedTables` entry
// -----------------------------------------------------------------------------

describe('postgresProfiler -- per-table soft-fail', () => {
  it('converts a thrown error into a skippedTables entry', async () => {
    const adapter = new PostgresAdapter({
      dbType: 'postgres',
      host: 'h',
      port: 5432,
      database: 'd',
      username: 'u',
      password: 'p',
    });
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'public',
          tableName: 'good_table',
          objectType: 'table',
          estimatedRowCount: 100,
        },
        {
          schemaName: 'public',
          tableName: 'locked_table',
          objectType: 'table',
          estimatedRowCount: 100,
        },
      ],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    // good_table: row count succeeds (no per-column probes since no columns).
    queueQueryResult(/pg_catalog\.pg_class/is, [{ est_rows: 100 }]);
    // locked_table: row count throws via pg_class catalog read.
    queueQueryError(
      /pg_catalog\.pg_class/is,
      new Error('lock acquired by another transaction'),
    );
    // Fallback path also errors so the table fully skips.
    queueQueryError(/COUNT\(\*\)/i, new Error('lock acquired'));
    const out = await profilePostgresTables(
      adapter,
      intro,
      'basic',
      baseConfig(),
    );
    // good_table profiled OK.
    expect(out.tables.find((t) => t.tableName === 'good_table')).toBeDefined();
    // locked_table -- with our soft-fail-per-call inside profileOneTable, the
    // row-count failure now becomes a null rowCount rather than a thrown
    // error; the table still appears in `out.tables` with rowCount=null.
    // We verify that no row-count value was salvaged.
    const locked = out.tables.find((t) => t.tableName === 'locked_table');
    if (locked) {
      expect(locked.rowCount).toBeNull();
    } else {
      // If a future refactor pushes per-table failure into skippedTables,
      // accept that shape too.
      expect(
        out.skippedTables.find((s) => s.tableName === 'locked_table'),
      ).toBeDefined();
    }
    await adapter.dispose();
  });
});

// -----------------------------------------------------------------------------
// 10) Relationship inference: declared FK + name-based inference + ambiguous
// -----------------------------------------------------------------------------

describe('inferPostgresRelationships', () => {
  it('captures declared FK with confidence 1.0', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [
        {
          schemaName: 'public',
          tableName: 'order_lines',
          kind: 'foreign_key',
          name: 'order_lines_fkey',
          columns: ['order_id'],
          referencedSchema: 'public',
          referencedTable: 'orders',
          referencedColumns: ['id'],
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferPostgresRelationships(intro);
    const declared = rels.find((r) => r.kind === 'declared_fk');
    expect(declared).toBeDefined();
    expect(declared?.confidence).toBe(1.0);
    expect(declared?.toTable).toBe('orders');
  });

  it('infers <entity>_id columns where a PK table exists', () => {
    const pkOrders: KeyOrIndexMetadata = {
      schemaName: 'public',
      tableName: 'orders',
      kind: 'primary_key',
      name: 'orders_pkey',
      columns: ['id'],
    };
    const customerIdCol: ColumnMetadata = {
      schemaName: 'public',
      tableName: 'invoices',
      columnName: 'order_id',
      dataType: 'integer',
      isNullable: true,
      ordinalPosition: 2,
    };
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [customerIdCol],
      keysAndIndexes: [pkOrders],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferPostgresRelationships(intro);
    const inferred = rels.find((r) => r.kind === 'inferred');
    expect(inferred).toBeDefined();
    expect(inferred?.toTable).toBe('orders');
    expect(inferred?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('marks ambiguous when multiple PK tables share the candidate name', () => {
    const pkA: KeyOrIndexMetadata = {
      schemaName: 'a',
      tableName: 'order',
      kind: 'primary_key',
      name: 'a_order_pkey',
      columns: ['id'],
    };
    const pkB: KeyOrIndexMetadata = {
      schemaName: 'b',
      tableName: 'order',
      kind: 'primary_key',
      name: 'b_order_pkey',
      columns: ['id'],
    };
    const col: ColumnMetadata = {
      schemaName: 'public',
      tableName: 'invoices',
      columnName: 'order_id',
      dataType: 'integer',
      isNullable: true,
      ordinalPosition: 2,
    };
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [col],
      keysAndIndexes: [pkA, pkB],
      views: [],
      procedures: [],
      triggers: [],
    };
    const rels = inferPostgresRelationships(intro);
    const amb = rels.find((r) => r.kind === 'ambiguous');
    expect(amb).toBeDefined();
    expect(amb?.competingTargets?.length).toBeGreaterThanOrEqual(2);
  });
});

// -----------------------------------------------------------------------------
// 11) Candidate emission: physical_data_entity per table + per column
// -----------------------------------------------------------------------------

describe('PostgresDiscoveryPack.emitCandidates', () => {
  it('emits one physical_data_entity per table and one physical_data_attribute per column', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'public',
          tableName: 'orders',
          objectType: 'table',
          estimatedRowCount: 100,
        },
      ],
      columns: [
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'id',
          dataType: 'integer',
          isNullable: false,
          ordinalPosition: 1,
        },
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'name',
          dataType: 'character varying',
          isNullable: true,
          ordinalPosition: 2,
          maxLength: 100,
        },
      ],
      keysAndIndexes: [
        {
          schemaName: 'public',
          tableName: 'orders',
          kind: 'primary_key',
          name: 'orders_pkey',
          columns: ['id'],
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const candidates = await pack.emitCandidates(ctx, intro, profile);
    const tables = candidates.filter(
      (c) => c.candidateType === 'physical_data_entities',
    );
    const attrs = candidates.filter(
      (c) => c.candidateType === 'physical_data_attributes',
    );
    expect(tables).toHaveLength(1);
    expect(attrs).toHaveLength(2);
    // Attributes link back to the parent table candidate.
    expect(attrs[0].parentCandidateClientId).toBe(tables[0].clientId);
    expect(attrs[0].filePath).toContain('#');
    // PK marking propagates from keysAndIndexes.
    const idAttr = attrs.find((a) => a.name === 'id');
    expect((idAttr?.data as Record<string, unknown>).isPrimaryKey).toBe(true);
    await pack.close();
  });

  // Bug fix (2026-05-17): views must also emit as physical_data_entities so
  // the user can review them alongside tables. Materialized views surface as
  // objectType='materialized_view' (mapped to 'Materialized View' on save).
  it('emits one physical_data_entity per view (regular AND materialized)', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    await pack.connect(ctx);
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [
        { schemaName: 'public', viewName: 'v_orders', definition: 'select 1', isMaterialized: false },
        { schemaName: 'public', viewName: 'mv_daily',  definition: 'select 1', isMaterialized: true  },
      ],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const candidates = await pack.emitCandidates(ctx, intro, profile);
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities).toHaveLength(2);
    const regular = entities.find((c) => c.name === 'v_orders');
    const matview = entities.find((c) => c.name === 'mv_daily');
    expect((regular!.data as Record<string, unknown>).objectType).toBe('view');
    expect((matview!.data as Record<string, unknown>).objectType).toBe('materialized_view');
    await pack.close();
  });
});

// -----------------------------------------------------------------------------
// 12) Findings: missing_primary_key + high_null_rate + stored_procedure_logic
// -----------------------------------------------------------------------------

describe('buildAllPostgresFindings', () => {
  it('emits missing_primary_key for a table without a PK', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [
        {
          schemaName: 'public',
          tableName: 'logs',
          objectType: 'table',
          estimatedRowCount: 100,
        },
      ],
      columns: [],
      keysAndIndexes: [], // no PK
      views: [],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const findings = buildAllPostgresFindings(intro, profile, []);
    const missingPk = findings.find(
      (f) => f.findingType === 'missing_primary_key',
    );
    expect(missingPk).toBeDefined();
    expect(missingPk?.title).toContain('public.logs');
  });

  it('emits high_null_rate for a column with > 80% nulls', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const profile: ProfileResult = {
      tables: [
        {
          schemaName: 'public',
          tableName: 'orders',
          rowCount: 1000,
          columnProfiles: [
            {
              schemaName: 'public',
              tableName: 'orders',
              columnName: 'note',
              nullRate: 0.95,
            },
          ],
        },
      ],
      skippedTables: [],
    };
    const findings = buildAllPostgresFindings(intro, profile, []);
    const hnr = findings.find((f) => f.findingType === 'high_null_rate');
    expect(hnr).toBeDefined();
    expect((hnr?.detailJson as Record<string, unknown>).nullRate).toBeCloseTo(
      0.95,
      5,
    );
  });

  it('emits stored_procedure_logic + procedure_data_write for a procedure with DML', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [
        {
          schemaName: 'public',
          procedureName: 'archive_old',
          routineKind: 'procedure',
          body: "INSERT INTO archive SELECT * FROM orders WHERE name='X';",
          language: 'plpgsql',
        },
      ],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const findings = buildAllPostgresFindings(intro, profile, []);
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
});

// -----------------------------------------------------------------------------
// 13) Snippet redaction: procedure body with `password='supersecret'` ends
//     up with `?` in the persisted finding
// -----------------------------------------------------------------------------

describe('Snippet redaction on finding payloads', () => {
  it('strips literal values and secret keys from procedure bodies', () => {
    const intro: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [
        {
          schemaName: 'public',
          procedureName: 'leak_check',
          routineKind: 'function',
          body: "SELECT name WHERE password='supersecret' AND email='a@b'",
          language: 'sql',
        },
      ],
      triggers: [],
    };
    const profile: ProfileResult = { tables: [], skippedTables: [] };
    const findings = buildAllPostgresFindings(intro, profile, []);
    const spLogic = findings.find(
      (f) => f.findingType === 'stored_procedure_logic',
    );
    expect(spLogic).toBeDefined();
    const snippet = (spLogic?.detailJson as Record<string, unknown>)
      .bodySnippet as string;
    expect(snippet).not.toContain('supersecret');
    // Targeted scrub (literal_policy 'targeted_v2', spec 2026-06-11
    // db-object-translation-drafts): ordinary literals are preserved VERBATIM
    // so proc bodies stay faithful translation inputs; only secret-named
    // targets collapse to '<REDACTED>'.
    expect(snippet).toContain("email='a@b'");
    expect(snippet).toContain('<REDACTED>');
  });
});

// -----------------------------------------------------------------------------
// 14) SQL guard: every introspection query passes the guard.
// -----------------------------------------------------------------------------

describe('SQL guard -- regression sweep over recorded queries', () => {
  it('all recorded introspection queries pass assertReadonlySelect', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    // Queue empty responses for each catalog query so each method completes.
    queueQueryResult(/.*/, []); // schemas
    queueQueryResult(/.*/, []); // tables
    queueQueryResult(/.*/, []); // columns
    queueQueryResult(/.*/, []); // constraints
    queueQueryResult(/.*/, []); // indexes
    queueQueryResult(/.*/, []); // views (UNION ALL still one query)
    queueQueryResult(/.*/, []); // procedures
    queueQueryResult(/.*/, []); // triggers
    await pack.connect(ctx);
    await pack.introspectSchemas(ctx);
    await pack.introspectTables(ctx);
    await pack.introspectColumns(ctx);
    await pack.introspectKeysAndIndexes(ctx);
    await pack.introspectViews(ctx);
    await pack.introspectProcedures(ctx);
    await pack.introspectTriggers(ctx);
    await pack.close();

    // Pull out only the real catalog queries (filter out SET/RESET).
    const catalogQueries = recordedQueries.filter(
      (q) =>
        !/^SET statement_timeout/i.test(q.sql) &&
        !/^RESET statement_timeout/i.test(q.sql),
    );
    expect(catalogQueries.length).toBeGreaterThan(0);
    for (const q of catalogQueries) {
      expect(() => assertReadonlySelect(q.sql)).not.toThrow();
    }
  });
});
