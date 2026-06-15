/**
 * Group E tests -- computed / generated column flag + verbatim generation
 * expression capture (Spec 2026-05-30 Data-Layer Fidelity 2).
 *
 * EXTENDS the Spec-3 / W3 introspection + structural-fidelity test patterns
 * (mirrors dbStructuralFidelityGroup2.test.ts). Offline only -- no live DB. The
 * Postgres SQL->IR path uses a mocked `pg` Pool; the Sybase path uses the pure
 * `transformSidecarIntrospection` mapper over a synthetic sidecar response; the
 * candidate builder is fed synthetic IR. Synthetic-rows-only -> isolation-safe.
 *
 * Focused set (within the 2-8 bound):
 *  1. Postgres `GENERATED ALWAYS AS (expr) STORED` -> isGenerated=true +
 *     generationExpression captured verbatim on the IR.
 *  2. A plain writable Postgres column -> isGenerated=false + null expression.
 *  3. The flag + expression appear in the physical_data_attributes metadata via
 *     attributeStructuralFidelityFields (and a plain column does NOT set them).
 *  4. Sybase computed-column path: the sidecar's isComputed/computedExpression
 *     are read when present; a plain column defaults to false/null.
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

import { attributeStructuralFidelityFields } from '../services/databasePacks/candidateStructuralFidelity';
import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import type {
  ColumnMetadata,
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
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
  runId: 'run-e',
  projectId: 'proj-e',
  architectureId: 'arch-e',
});

beforeEach(() => {
  recordedQueries.length = 0;
  queryQueue.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.connect.mockClear();
});

// -----------------------------------------------------------------------------
// 1) + 2) Postgres GENERATED column flagged + verbatim expr; plain column not.
// -----------------------------------------------------------------------------

describe('Postgres computed/generated column introspection (Group E)', () => {
  it('flags a GENERATED ALWAYS AS column + captures the expression verbatim; plain column not flagged', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/information_schema\.columns/i, [
      {
        schema_name: 'public',
        table_name: 'order_line',
        column_name: 'line_total',
        data_type: 'numeric',
        is_nullable: 'YES',
        column_default: null,
        ordinal_position: 3,
        char_max_length: null,
        num_precision: 12,
        num_scale: 2,
        is_identity: 'NO',
        collation_name: null,
        is_generated: 'ALWAYS',
        generation_expression: '(price * quantity)',
      },
      {
        schema_name: 'public',
        table_name: 'order_line',
        column_name: 'price',
        data_type: 'numeric',
        is_nullable: 'NO',
        column_default: null,
        ordinal_position: 1,
        char_max_length: null,
        num_precision: 12,
        num_scale: 2,
        is_identity: 'NO',
        collation_name: null,
        is_generated: 'NEVER',
        generation_expression: null,
      },
    ]);

    await pack.connect(ctx);
    const cols = await pack.introspectColumns(ctx);
    await pack.close();

    const generated = cols.find((c) => c.columnName === 'line_total')!;
    expect(generated.isGenerated).toBe(true);
    expect(generated.generationExpression).toBe('(price * quantity)'); // verbatim

    const plain = cols.find((c) => c.columnName === 'price')!;
    expect(plain.isGenerated).toBe(false);
    expect(plain.generationExpression).toBeNull();

    // Belt-and-braces: the SELECT references is_generated + generation_expression.
    const colSql = recordedQueries.find((q) => /information_schema\.columns/i.test(q.sql));
    expect(colSql!.sql).toMatch(/is_generated/i);
    expect(colSql!.sql).toMatch(/generation_expression/i);
  });
});

// -----------------------------------------------------------------------------
// 3) Flag + expression appear in the physical_data_attributes metadata.
// -----------------------------------------------------------------------------

describe('attributeStructuralFidelityFields computed flag (Group E)', () => {
  it('threads is_generated + generation_expression onto the payload (verbatim); plain column is false/null', () => {
    const generated: ColumnMetadata = {
      schemaName: 'public',
      tableName: 'order_line',
      columnName: 'line_total',
      dataType: 'numeric',
      isNullable: true,
      ordinalPosition: 3,
      isGenerated: true,
      generationExpression: '(price * quantity)',
    };
    const fields = attributeStructuralFidelityFields(generated);
    expect(fields.is_generated).toBe(true);
    expect(fields.generation_expression).toBe('(price * quantity)');

    const plain = attributeStructuralFidelityFields({
      schemaName: 'public',
      tableName: 'order_line',
      columnName: 'price',
      dataType: 'numeric',
      isNullable: false,
      ordinalPosition: 1,
    });
    expect(plain.is_generated).toBe(false);
    expect(plain.generation_expression).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 4) Sybase computed-column path (sidecar flag + expression when present).
// -----------------------------------------------------------------------------

describe('Sybase computed-column mapping (Group E)', () => {
  it('reads the sidecar computed flag + expression when present, defaults to false/null when absent', () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [{ schemaName: 'dbo', owner: 'sa' }],
      tables: [{ schemaName: 'dbo', tableName: 'order_line' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'order_line',
          columnName: 'line_total',
          dataType: 'numeric',
          maxLength: 0,
          isNullable: true,
          ordinalPosition: 3,
          isComputed: true,
          computedExpression: 'price * quantity',
        },
        {
          schemaName: 'dbo',
          tableName: 'order_line',
          columnName: 'price',
          dataType: 'numeric',
          maxLength: 0,
          isNullable: false,
          ordinalPosition: 1,
          // No computed info surfaced -> false/null.
        },
      ],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const ir = transformSidecarIntrospection(resp);
    const computed = ir.columns.find((c) => c.columnName === 'line_total')!;
    expect(computed.isGenerated).toBe(true);
    expect(computed.generationExpression).toBe('price * quantity'); // verbatim

    const plain = ir.columns.find((c) => c.columnName === 'price')!;
    expect(plain.isGenerated).toBe(false);
    expect(plain.generationExpression).toBeNull();
  });
});
