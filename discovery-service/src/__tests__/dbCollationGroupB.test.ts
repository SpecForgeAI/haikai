/**
 * Group B tests -- column / database collation capture + CI->CS cross-engine
 * hazard Finding (Spec 2026-05-30 Data-Layer Fidelity 2).
 *
 * EXTENDS the Spec-3 / W3 introspection + structural-fidelity + DB-pack-finding
 * test patterns (mirrors dbStructuralFidelityGroup2.test.ts / W3). Offline only
 * -- no live DB. The Postgres SQL->IR path is exercised through a mocked `pg`
 * Pool; the Sybase path uses the pure `transformSidecarIntrospection` mapper
 * over a synthetic sidecar response; the candidate + finding builders are fed
 * synthetic IR. Synthetic-rows-only -> isolation-safe.
 *
 * Focused set (within the 2-8 bound):
 *  1. Postgres introspectColumns maps a non-default column collation through +
 *     introspectDatabaseCollation reads the DB-level collation (verbatim).
 *  2. Sybase transformSidecarIntrospection reads column collation from the
 *     sidecar shape when present, and defaults to null when absent.
 *  3. The physical-attribute candidate carries `collation` in its
 *     `physical_data_attributes` metadata via attributeStructuralFidelityFields.
 *  4. A Sybase case-INSENSITIVE collation emits a collation_case_sensitivity
 *     _hazard Finding; a Postgres case-SENSITIVE collation (and a plain column)
 *     emit NO hazard.
 *  5. The CI heuristic recognises the cross-engine signals (and short-circuits
 *     explicit _CS_).
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
import { __testOnly as sybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import { __testOnly as postgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { collationImpliesCaseInsensitive } from '../services/findings/databasePackFindingScanners/databasePackFindingBuilders';
import type {
  ColumnMetadata,
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
  runId: 'run-b',
  projectId: 'proj-b',
  architectureId: 'arch-b',
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
// 1) Postgres column collation + DB-level collation introspected (verbatim).
// -----------------------------------------------------------------------------

describe('Postgres collation introspection (Group B)', () => {
  it('maps a non-default column collation through + reads the DB-level collation', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/information_schema\.columns/i, [
      {
        schema_name: 'public',
        table_name: 'customer',
        column_name: 'name',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
        ordinal_position: 1,
        char_max_length: null,
        num_precision: null,
        num_scale: null,
        is_identity: 'NO',
        collation_name: 'en_US.utf8',
        is_generated: 'NEVER',
        generation_expression: null,
      },
      {
        schema_name: 'public',
        table_name: 'customer',
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: null,
        ordinal_position: 2,
        char_max_length: null,
        num_precision: 32,
        num_scale: 0,
        is_identity: 'NO',
        // A non-collatable type reports no collation -> null on the IR.
        collation_name: null,
        is_generated: 'NEVER',
        generation_expression: null,
      },
    ]);
    queueQueryResult(/pg_catalog\.pg_database/i, [{ db_collation: 'en_US.utf8' }]);

    await pack.connect(ctx);
    const cols = await pack.introspectColumns(ctx);
    const dbCollation = await pack.introspectDatabaseCollation(ctx);
    await pack.close();

    const name = cols.find((c) => c.columnName === 'name')!;
    expect(name.collation).toBe('en_US.utf8'); // verbatim
    const id = cols.find((c) => c.columnName === 'id')!;
    expect(id.collation).toBeNull(); // non-collatable type -> null

    expect(dbCollation).toBe('en_US.utf8');

    // Belt-and-braces: the SELECT actually references collation_name + datcollate.
    const colSql = recordedQueries.find((q) => /information_schema\.columns/i.test(q.sql));
    expect(colSql!.sql).toMatch(/collation_name/i);
    const dbSql = recordedQueries.find((q) => /pg_catalog\.pg_database/i.test(q.sql));
    expect(dbSql!.sql).toMatch(/datcollate/i);
  });
});

// -----------------------------------------------------------------------------
// 2) Sybase collation read from the sidecar shape (+ absent-value path).
// -----------------------------------------------------------------------------

describe('Sybase collation mapping (Group B)', () => {
  it('reads column collation from the sidecar when present and defaults to null when absent', () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [{ schemaName: 'dbo', owner: 'sa' }],
      tables: [{ schemaName: 'dbo', tableName: 'customer' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'customer',
          columnName: 'name',
          dataType: 'varchar',
          maxLength: 100,
          isNullable: true,
          ordinalPosition: 1,
          // Sidecar surfaces a case-insensitive sort order on this build.
          collation: 'utf8_ci_ai',
        },
        {
          schemaName: 'dbo',
          tableName: 'customer',
          columnName: 'id',
          dataType: 'int',
          maxLength: 0,
          isNullable: false,
          ordinalPosition: 2,
          // No collation surfaced -> null.
        },
      ],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
    };
    const ir = transformSidecarIntrospection(resp);
    const name = ir.columns.find((c) => c.columnName === 'name')!;
    expect(name.collation).toBe('utf8_ci_ai'); // verbatim
    const id = ir.columns.find((c) => c.columnName === 'id')!;
    expect(id.collation).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 3) Collation appears in the physical-attribute metadata via the builder.
// -----------------------------------------------------------------------------

describe('attributeStructuralFidelityFields collation (Group B)', () => {
  it('threads collation onto the physical_data_attributes payload (verbatim)', () => {
    const col: ColumnMetadata = {
      schemaName: 'public',
      tableName: 'customer',
      columnName: 'name',
      dataType: 'text',
      isNullable: true,
      ordinalPosition: 1,
      collation: 'en_US.utf8',
    };
    const fields = attributeStructuralFidelityFields(col);
    expect(fields.collation).toBe('en_US.utf8');
    // A plain column (no collation) carries collation: null (no key leak issues).
    const plain = attributeStructuralFidelityFields({
      schemaName: 'public',
      tableName: 'customer',
      columnName: 'id',
      dataType: 'integer',
      isNullable: false,
      ordinalPosition: 2,
    });
    expect(plain.collation).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 4) CI->CS cross-engine hazard Finding emitted (Sybase CI) / NOT emitted
//    (Postgres CS + plain column).
// -----------------------------------------------------------------------------

describe('Collation CI->CS hazard Finding (Group B)', () => {
  it('emits a hazard for a Sybase case-insensitive collation, none for plain/CS columns', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      databaseCollation: 'utf8_ci_ai',
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'customer',
          columnName: 'name',
          dataType: 'varchar',
          isNullable: true,
          ordinalPosition: 1,
          collation: 'utf8_ci_ai', // case-insensitive -> hazard
        },
        {
          schemaName: 'dbo',
          tableName: 'customer',
          columnName: 'id',
          dataType: 'int',
          isNullable: false,
          ordinalPosition: 2,
          collation: null, // plain -> no hazard
        },
      ],
    };
    const out = sybaseFindings.emitCollationHazardFindings(ir);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('collation_case_sensitivity_hazard');
    expect(out[0].category).toBe('migration_risk');
    expect(out[0].title).toContain('dbo.customer.name');
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.collation).toBe('utf8_ci_ai'); // verbatim in payload
    expect(detail.migrationConcern).toBe('case_insensitive_to_case_sensitive');
  });

  it('emits NO hazard on the Postgres path for a case-SENSITIVE collation', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      databaseCollation: 'en_US.utf8',
      columns: [
        {
          schemaName: 'public',
          tableName: 'customer',
          columnName: 'name',
          dataType: 'text',
          isNullable: true,
          ordinalPosition: 1,
          collation: 'en_US.utf8', // case-sensitive default -> no hazard
        },
      ],
    };
    const out = postgresFindings.emitCollationHazardFindings(ir);
    expect(out).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// 5) The CI heuristic recognises the cross-engine signals.
// -----------------------------------------------------------------------------

describe('collationImpliesCaseInsensitive heuristic (Group B)', () => {
  it('flags CI markers and short-circuits explicit CS / unknown', () => {
    expect(collationImpliesCaseInsensitive('utf8_ci_ai')).toBe(true);
    expect(collationImpliesCaseInsensitive('SQL_Latin1_General_CP1_CI_AS')).toBe(true);
    expect(collationImpliesCaseInsensitive('nocase')).toBe(true);
    expect(collationImpliesCaseInsensitive('und-u-ks-level1')).toBe(true);
    // Explicit case-sensitive markers short-circuit.
    expect(collationImpliesCaseInsensitive('SQL_Latin1_General_CP1_CS_AS')).toBe(false);
    expect(collationImpliesCaseInsensitive('en_US.utf8')).toBe(false);
    expect(collationImpliesCaseInsensitive('C')).toBe(false);
    expect(collationImpliesCaseInsensitive(null)).toBe(false);
    expect(collationImpliesCaseInsensitive(undefined)).toBe(false);
  });
});
