/**
 * Oracle-W3 tests -- capture FK referential ACTIONS (ON DELETE / ON UPDATE)
 * and index ORDERING / CLUSTERING / partial-predicate metadata that were
 * already in the catalog but previously discarded.
 *
 * Additive into the EXISTING free-form JSONB blobs `fk_columns`
 * (logical_data_entity_relationships) and `constraints_metadata.indexes[]`
 * (physical_data_entities). NO AMS schema change, NO Liquibase changeset --
 * the keys land in JSONB columns that already exist (Spec 3).
 *
 * Offline only -- no live DB. The builders are fed synthetic introspection IR;
 * the Postgres SQL->IR path is exercised through a mocked `pg` Pool (mirrors
 * dbStructuralFidelityGroup2.test.ts) to prove the query now selects the
 * referential rules + parses `indexdef`.
 *
 * Focused set (within the 2-6 bound):
 *  1. FK with ON DELETE CASCADE -> fk_columns.on_delete === 'CASCADE'
 *     (+ on_update captured).
 *  2. Default NO ACTION FK round-trips its action.
 *  3. A DESC / partial (WHERE deleted_at IS NULL) / clustered index ->
 *     the new keys appear in the constraints_metadata index entry.
 *  4. A plain unique index still round-trips {name,columns,is_unique}
 *     unchanged (regression guard).
 *  5. End-to-end Postgres SQL->IR: the FK query selects update_rule/delete_rule
 *     and the index `indexdef` is parsed (method / predicate / direction).
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

import {
  buildConstraintsMetadata,
  buildFkColumnsMetadata,
  type ConstraintsIndexEntry,
} from '../services/databasePacks/candidateStructuralFidelity';
import {
  buildRelationshipCandidates,
} from '../services/databasePacks/databasePackOrchestrator';
import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { parsePostgresIndexDef } from '../services/databasePacks/postgres/postgresIntrospection';
import type {
  DatabaseDiscoveryConfig,
  DatabaseDiscoveryCredentials,
  IntrospectionResult,
  KeyOrIndexMetadata,
  RelationshipInference,
} from '../services/databasePacks/types';
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
  runId: 'run-w3',
  projectId: 'proj-w3',
  architectureId: 'arch-w3',
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
// 1) FK with ON DELETE CASCADE -> fk_columns.on_delete; on_update captured.
// -----------------------------------------------------------------------------

describe('Oracle-W3 FK referential actions -> fk_columns', () => {
  it('captures ON DELETE CASCADE (and ON UPDATE) on the relationship fk_columns', () => {
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
        onDelete: 'CASCADE',
        onUpdate: 'RESTRICT',
      },
    ];

    const out = buildRelationshipCandidates(
      relationships,
      emptyIntrospection(),
      'postgres',
    );
    expect(out).toHaveLength(1);
    const fk = out[0].data.fk_columns as Record<string, unknown>;
    expect(fk).toEqual({
      join_columns: ['order_id'],
      referenced_columns: ['id'],
      on_delete: 'CASCADE',
      on_update: 'RESTRICT',
    });
  });

  it('builder adds on_delete / on_update verbatim and omits them when absent', () => {
    // With actions.
    const withActions = buildFkColumnsMetadata(['a'], ['b'], {
      onDelete: 'SET NULL',
      onUpdate: 'NO ACTION',
    });
    expect(withActions).toEqual({
      join_columns: ['a'],
      referenced_columns: ['b'],
      on_delete: 'SET NULL',
      on_update: 'NO ACTION',
    });

    // No actions arg -> stable {join_columns, referenced_columns} shape, no
    // extra keys (back-compat for inferred relationships / Sybase).
    const withoutActions = buildFkColumnsMetadata(['a'], ['b']);
    expect(withoutActions).toEqual({
      join_columns: ['a'],
      referenced_columns: ['b'],
    });
    expect(Object.prototype.hasOwnProperty.call(withoutActions, 'on_delete')).toBe(
      false,
    );
  });
});

// -----------------------------------------------------------------------------
// 2) Default NO ACTION FK round-trips its action.
// -----------------------------------------------------------------------------

describe('Oracle-W3 default NO ACTION FK', () => {
  it('round-trips a NO ACTION on_delete / on_update', () => {
    const relationships: RelationshipInference[] = [
      {
        fromSchema: 'public',
        fromTable: 'invoice',
        fromColumns: ['customer_id'],
        toSchema: 'public',
        toTable: 'customer',
        toColumns: ['id'],
        kind: 'declared_fk',
        confidence: 1.0,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ];
    const out = buildRelationshipCandidates(
      relationships,
      emptyIntrospection(),
      'postgres',
    );
    const fk = out[0].data.fk_columns as Record<string, unknown>;
    expect(fk.on_delete).toBe('NO ACTION');
    expect(fk.on_update).toBe('NO ACTION');
  });
});

// -----------------------------------------------------------------------------
// 3) DESC / partial / clustered index -> new keys in constraints_metadata.
// -----------------------------------------------------------------------------

describe('Oracle-W3 index ordering / clustering / predicate -> constraints_metadata', () => {
  it('threads definition / method / direction / predicate / clustered onto the index entry', () => {
    const keys: KeyOrIndexMetadata[] = [
      {
        schemaName: 'public',
        tableName: 'events',
        kind: 'index',
        name: 'events_ts_desc_idx',
        columns: ['created_at'],
        columnDirections: ['DESC'],
        isUnique: false,
        isClustered: true,
        indexMethod: 'btree',
        indexPredicate: 'deleted_at IS NULL',
        indexDefinition:
          'CREATE INDEX events_ts_desc_idx ON public.events USING btree ' +
          '(created_at DESC) WHERE deleted_at IS NULL',
      },
    ];

    const cm = buildConstraintsMetadata('public', 'events', keys);
    expect(cm).toBeTruthy();
    expect(cm!.indexes).toHaveLength(1);
    const idx = cm!.indexes[0] as ConstraintsIndexEntry;
    // Stable Spec-3 keys still present + unchanged.
    expect(idx.name).toBe('events_ts_desc_idx');
    expect(idx.columns).toEqual(['created_at']);
    expect(idx.is_unique).toBe(false);
    // New Oracle-W3 additive keys present + verbatim.
    expect(idx.column_directions).toEqual(['DESC']);
    expect(idx.method).toBe('btree');
    expect(idx.predicate).toBe('deleted_at IS NULL');
    expect(idx.is_clustered).toBe(true);
    expect(idx.definition).toContain('WHERE deleted_at IS NULL');
  });
});

// -----------------------------------------------------------------------------
// 4) Plain unique index round-trips {name,columns,is_unique} unchanged.
// -----------------------------------------------------------------------------

describe('Oracle-W3 regression guard: plain index entry shape unchanged', () => {
  it('a plain index with no ordering metadata keeps exactly {name,columns,is_unique}', () => {
    const keys: KeyOrIndexMetadata[] = [
      {
        schemaName: 'public',
        tableName: 'orders',
        kind: 'index',
        name: 'orders_total_idx',
        columns: ['total'],
        isUnique: true,
      },
    ];
    const cm = buildConstraintsMetadata('public', 'orders', keys);
    expect(cm!.indexes).toEqual([
      { name: 'orders_total_idx', columns: ['total'], is_unique: true },
    ]);
    // No additive keys leak in when the engine reported none.
    const idx = cm!.indexes[0];
    expect(Object.keys(idx).sort()).toEqual(['columns', 'is_unique', 'name']);
  });
});

// -----------------------------------------------------------------------------
// 5) End-to-end Postgres SQL -> IR: rules selected; indexdef parsed.
// -----------------------------------------------------------------------------

describe('Oracle-W3 Postgres introspection SQL -> IR', () => {
  it('selects update_rule/delete_rule and parses index ordering / predicate / method', async () => {
    const pack = new PostgresDiscoveryPack();
    const ctx = baseCtx();

    // Constraint query: one FK row carrying delete_rule/update_rule.
    queueQueryResult(/information_schema\.table_constraints[\s\S]*key_column_usage/i, [
      {
        schema_name: 'public',
        table_name: 'order_lines',
        constraint_name: 'order_lines_order_id_fkey',
        constraint_type: 'FOREIGN KEY',
        column_name: 'order_id',
        ord: 1,
        ref_schema: 'public',
        ref_table: 'orders',
        ref_column: 'id',
        update_rule: 'NO ACTION',
        delete_rule: 'CASCADE',
      },
    ]);
    // Check-constraint query: none.
    queueQueryResult(/information_schema\.check_constraints/i, []);
    // Index query: a DESC partial index on a btree.
    queueQueryResult(/pg_catalog\.pg_indexes/i, [
      {
        schema_name: 'public',
        table_name: 'events',
        index_name: 'events_ts_desc_idx',
        index_def:
          'CREATE INDEX events_ts_desc_idx ON public.events USING btree ' +
          '(created_at DESC) WHERE (deleted_at IS NULL)',
        is_clustered: false,
      },
    ]);

    await pack.connect(ctx);
    const keys = await pack.introspectKeysAndIndexes(ctx);
    await pack.close();

    // The FK row carries the verbatim referential actions.
    const fk = keys.find((k) => k.kind === 'foreign_key')!;
    expect(fk.onDelete).toBe('CASCADE');
    expect(fk.onUpdate).toBe('NO ACTION');

    // The index row carries parsed ordering / predicate / method + raw def.
    const idx = keys.find((k) => k.kind === 'index')!;
    expect(idx.columns).toEqual(['created_at']); // bare column, direction split out
    expect(idx.columnDirections).toEqual(['DESC']);
    expect(idx.indexMethod).toBe('btree');
    expect(idx.indexPredicate).toBe('(deleted_at IS NULL)');
    expect(idx.indexDefinition).toContain('USING btree');

    // Belt-and-braces: the emitted FK SELECT actually references the rule cols.
    const fkSql = recordedQueries.find((q) =>
      /referential_constraints/i.test(q.sql),
    );
    expect(fkSql).toBeTruthy();
    expect(fkSql!.sql).toMatch(/delete_rule/i);
    expect(fkSql!.sql).toMatch(/update_rule/i);
  });
});

// -----------------------------------------------------------------------------
// Direct unit coverage for the indexdef parser (edge shapes).
// -----------------------------------------------------------------------------

describe('Oracle-W3 parsePostgresIndexDef', () => {
  it('parses a multi-column mixed-direction unique index', () => {
    const p = parsePostgresIndexDef(
      'CREATE UNIQUE INDEX uq ON public.t USING btree (a ASC, b DESC NULLS LAST)',
    );
    expect(p.isUnique).toBe(true);
    expect(p.method).toBe('btree');
    expect(p.columns).toEqual(['a', 'b']);
    expect(p.columnDirections).toEqual(['ASC', 'DESC NULLS LAST']);
    expect(p.predicate).toBeNull();
  });

  it('parses a plain index with no direction (directions are blank strings)', () => {
    const p = parsePostgresIndexDef(
      'CREATE INDEX t_total_idx ON public.t USING btree (total)',
    );
    expect(p.columns).toEqual(['total']);
    expect(p.columnDirections).toEqual(['']);
    expect(p.method).toBe('btree');
    expect(p.predicate).toBeNull();
  });

  it('extracts a partial-index predicate verbatim', () => {
    const p = parsePostgresIndexDef(
      'CREATE INDEX t_live_idx ON public.t USING btree (id) WHERE (deleted_at IS NULL)',
    );
    expect(p.predicate).toBe('(deleted_at IS NULL)');
    expect(p.columns).toEqual(['id']);
  });
});
