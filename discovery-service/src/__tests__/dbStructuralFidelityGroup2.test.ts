/**
 * Group 2 tests -- DB Structural Fidelity introspection drops + candidate feed.
 *
 * Spec: 2026-05-29 DB Structural Fidelity -- tasks.md 2.1.
 *
 * Offline only -- no live DB. The Postgres path uses a mocked `pg` Pool; the
 * Sybase path uses the pure `transformSidecarIntrospection` mapper over a
 * mocked sidecar response. Focused set (within the 2-8 bound):
 *  1. Postgres introspectColumns maps numeric_scale / numeric_precision through
 *     (previously SELECTed then discarded) + identity from a serial default.
 *  2. Postgres introspectSequences maps a sequence catalog row.
 *  3. Sybase transformSidecarIntrospection extracts the column default instead
 *     of hardcoding null + maps scale/precision/identity + sequences.
 *  4. The physical-attribute candidate carries source_type / scale / precision
 *     / column_default / ordinal / is_identity (snake_case AMS DTO names).
 *  5. The physical-entity candidate carries constraints_metadata
 *     (primary_key / unique_constraints / check_constraints / indexes).
 *  6. The relationship candidate carries fk_columns
 *     (join_columns / referenced_columns) -- NO logical<->physical mapping.
 */

// -----------------------------------------------------------------------------
// `pg` Pool mock (mirrors postgresDiscoveryPack.test.ts).
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
import { SybaseDiscoveryPack } from '../services/databasePacks/sybase/SybaseDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import { buildRelationshipCandidates } from '../services/databasePacks/databasePackOrchestrator';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  RelationshipInference,
} from '../services/databasePacks/types';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sybase/sybaseSidecarClient';
import type {
  DatabaseCandidatePayload,
  DatabaseDiscoveryPackContext,
} from '../services/databasePacks/DatabaseDiscoveryPack';

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
  runId: 'run-g2',
  projectId: 'proj-g2',
  architectureId: 'arch-g2',
});

const emptyProfile = { tables: [], skippedTables: [] };

beforeEach(() => {
  recordedQueries.length = 0;
  queryQueue.length = 0;
  mockClient.query.mockClear();
  mockClient.release.mockClear();
  mockPool.connect.mockClear();
});

// -----------------------------------------------------------------------------
// 1) Postgres: numeric_scale / numeric_precision mapped through + identity.
// -----------------------------------------------------------------------------

describe('Postgres introspectColumns (Spec 2026-05-29)', () => {
  it('maps numeric_scale / numeric_precision (no longer discarded) and detects identity', async () => {
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
        is_identity: 'NO',
      },
      {
        schema_name: 'public',
        table_name: 'orders',
        column_name: 'total',
        data_type: 'numeric',
        is_nullable: 'YES',
        column_default: null,
        ordinal_position: 2,
        char_max_length: null,
        num_precision: 12,
        num_scale: 2,
        is_identity: 'NO',
      },
    ]);
    await pack.connect(ctx);
    const cols = await pack.introspectColumns(ctx);
    await pack.close();

    // total: numeric(12,2) -- scale/precision now carried, not dropped.
    const total = cols.find((c) => c.columnName === 'total')!;
    expect(total.precision).toBe(12);
    expect(total.scale).toBe(2);

    // id: serial default -> identity inferred + sequence name extracted.
    const id = cols.find((c) => c.columnName === 'id')!;
    expect(id.precision).toBe(32);
    expect(id.scale).toBe(0);
    expect(id.isIdentity).toBe(true);
    expect(id.sequenceName).toBe('orders_id_seq');
  });
});

// -----------------------------------------------------------------------------
// 2) Postgres: sequence introspection.
// -----------------------------------------------------------------------------

describe('Postgres introspectSequences (Spec 2026-05-29)', () => {
  it('maps a sequence catalog row with owned-by linkage', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    queueQueryResult(/information_schema\.sequences/i, [
      {
        schema_name: 'public',
        sequence_name: 'orders_id_seq',
        data_type: 'bigint',
        start_value: '1',
        increment: '1',
        min_value: '1',
        max_value: '9223372036854775807',
        cycle_option: 'NO',
        owned_by_table: 'orders',
        owned_by_column: 'id',
      },
    ]);
    await pack.connect(ctx);
    const seqs = await pack.introspectSequences(ctx);
    await pack.close();

    expect(seqs).toHaveLength(1);
    expect(seqs[0].sequenceName).toBe('orders_id_seq');
    expect(seqs[0].dataType).toBe('bigint');
    expect(seqs[0].increment).toBe('1');
    expect(seqs[0].cycle).toBe(false);
    expect(seqs[0].ownedByTable).toBe('orders');
    expect(seqs[0].ownedByColumn).toBe('id');
  });
});

// -----------------------------------------------------------------------------
// 3) Sybase: column default extracted (not hardcoded null) + scale/precision/
//    identity + sequences.
// -----------------------------------------------------------------------------

describe('Sybase transformSidecarIntrospection (Spec 2026-05-29)', () => {
  it('extracts the column default instead of hardcoding null + maps fidelity fields + sequences', () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [{ schemaName: 'dbo', owner: 'sa' }],
      tables: [{ schemaName: 'dbo', tableName: 'invoice' }],
      columns: [
        {
          schemaName: 'dbo',
          tableName: 'invoice',
          columnName: 'amount',
          dataType: 'numeric',
          maxLength: 0,
          isNullable: false,
          ordinalPosition: 1,
          defaultExpression: '((0))',
          scale: 4,
          precision: 18,
          isIdentity: false,
        },
        {
          schemaName: 'dbo',
          tableName: 'invoice',
          columnName: 'id',
          dataType: 'int',
          maxLength: 0,
          isNullable: false,
          ordinalPosition: 2,
          isIdentity: true,
        },
      ],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'invoice_seq',
          dataType: 'bigint',
          startValue: '100',
          increment: '1',
        },
      ],
    };

    const ir = transformSidecarIntrospection(resp);

    const amount = ir.columns.find((c) => c.columnName === 'amount')!;
    // Previously this was hardcoded `defaultExpression: null`.
    expect(amount.defaultExpression).toBe('((0))');
    expect(amount.precision).toBe(18);
    expect(amount.scale).toBe(4);

    const id = ir.columns.find((c) => c.columnName === 'id')!;
    expect(id.isIdentity).toBe(true);

    expect(ir.sequences).toBeDefined();
    expect(ir.sequences).toHaveLength(1);
    expect(ir.sequences![0].sequenceName).toBe('invoice_seq');
    expect(ir.sequences![0].startValue).toBe('100');
  });
});

// -----------------------------------------------------------------------------
// 4 + 5) Candidate feed: attribute fidelity fields + entity constraints_metadata.
// -----------------------------------------------------------------------------

describe('emitCandidates structural fidelity feed (Spec 2026-05-29)', () => {
  function findEntity(
    candidates: DatabaseCandidatePayload[],
    name: string,
  ): DatabaseCandidatePayload {
    return candidates.find(
      (c) => c.candidateType === 'physical_data_entities' && c.name === name,
    )!;
  }
  function findAttr(
    candidates: DatabaseCandidatePayload[],
    name: string,
  ): DatabaseCandidatePayload {
    return candidates.find(
      (c) => c.candidateType === 'physical_data_attributes' && c.name === name,
    )!;
  }

  it('threads scale/precision/default/ordinal/identity onto the attribute candidate and constraints_metadata onto the entity', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();
    const introspection: IntrospectionResult = {
      schemas: [{ schemaName: 'public' }],
      tables: [
        { schemaName: 'public', tableName: 'orders', objectType: 'table' },
      ],
      columns: [
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'id',
          dataType: 'integer',
          isNullable: false,
          ordinalPosition: 1,
          defaultExpression: "nextval('orders_id_seq'::regclass)",
          scale: 0,
          precision: 32,
          isIdentity: true,
          sequenceName: 'orders_id_seq',
        },
        {
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'total',
          dataType: 'numeric',
          isNullable: true,
          ordinalPosition: 2,
          defaultExpression: null,
          scale: 2,
          precision: 12,
          isIdentity: false,
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
        {
          schemaName: 'public',
          tableName: 'orders',
          kind: 'unique_constraint',
          name: 'orders_total_uq',
          columns: ['total'],
        },
        {
          schemaName: 'public',
          tableName: 'orders',
          kind: 'check_constraint',
          name: 'orders_total_pos',
          columns: [],
          checkExpression: 'total >= 0',
        },
        {
          schemaName: 'public',
          tableName: 'orders',
          kind: 'index',
          name: 'orders_total_idx',
          columns: ['total'],
          isUnique: false,
        },
      ],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    const candidates = await pack.emitCandidates(ctx, introspection, emptyProfile);

    // --- Attribute candidate carries the new snake_case AMS DTO fields. ---
    const idAttr = findAttr(candidates, 'id');
    expect(idAttr.data.source_type).toBe('integer'); // verbatim, no normalization
    expect(idAttr.data.scale).toBe(0);
    expect(idAttr.data.precision).toBe(32);
    expect(idAttr.data.column_default).toContain('nextval');
    expect(idAttr.data.ordinal).toBe(1);
    expect(idAttr.data.is_identity).toBe(true);

    const totalAttr = findAttr(candidates, 'total');
    expect(totalAttr.data.source_type).toBe('numeric');
    expect(totalAttr.data.scale).toBe(2);
    expect(totalAttr.data.precision).toBe(12);
    expect(totalAttr.data.is_identity).toBe(false);

    // --- Entity candidate carries constraints_metadata in the exact shape. ---
    const entity = findEntity(candidates, 'orders');
    const cm = entity.data.constraints_metadata as Record<string, unknown>;
    expect(cm).toBeTruthy();
    expect(cm.primary_key).toEqual({ name: 'orders_pkey', columns: ['id'] });
    expect(cm.unique_constraints).toEqual([
      { name: 'orders_total_uq', columns: ['total'] },
    ]);
    expect(cm.check_constraints).toEqual([
      { name: 'orders_total_pos', expression: 'total >= 0' },
    ]);
    expect(cm.indexes).toEqual([
      { name: 'orders_total_idx', columns: ['total'], is_unique: false },
    ]);

    // INVARIANT: a DB-only scan produces only physical entities + attributes
    // -- NO logical entities and NO logical<->physical mapping candidate types.
    const emittedTypes = new Set(candidates.map((c) => c.candidateType));
    expect(emittedTypes.has('physical_data_entities')).toBe(true);
    expect(emittedTypes.has('physical_data_attributes')).toBe(true);
    for (const t of emittedTypes) {
      expect(t).not.toMatch(/logical/);
    }
  });
});

// -----------------------------------------------------------------------------
// 6) Relationship candidate carries fk_columns (no logical<->physical mapping).
// -----------------------------------------------------------------------------

describe('buildRelationshipCandidates fk_columns (Spec 2026-05-29)', () => {
  it('threads join_columns + referenced_columns onto the relationship candidate', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'public',
        fromTable: 'order_lines',
        fromColumns: ['order_id'],
        toSchema: 'public',
        toTable: 'orders',
        toColumns: ['id'],
        kind: 'declared_fk',
        confidence: 1.0,
      },
    ];
    const introspection: IntrospectionResult = {
      schemas: [],
      tables: [],
      columns: [],
      keysAndIndexes: [],
      views: [],
      procedures: [],
      triggers: [],
      sequences: [],
    };

    const out = buildRelationshipCandidates(relationships, introspection, 'postgres');
    expect(out).toHaveLength(1);
    const rel = out[0];
    expect(rel.candidateType).toBe('logical_data_entity_relationships');
    expect(rel.data.fk_columns).toEqual({
      join_columns: ['order_id'],
      referenced_columns: ['id'],
    });
    // It is a RELATIONSHIP, not a logical<->physical mapping row.
    expect(rel.data.sourceEntity).toBe('order_lines');
    expect(rel.data.targetEntity).toBe('orders');
  });
});
