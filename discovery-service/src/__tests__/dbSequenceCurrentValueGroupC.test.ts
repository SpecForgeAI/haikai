/**
 * Group C tests -- sequence current value (high-water mark) capture +
 * cross-engine cutover-hazard Finding (Spec 2026-05-30 Data-Layer Fidelity 2).
 *
 * EXTENDS the Spec-3 / Group-B db-pack introspection + finding test patterns
 * (mirrors dbStructuralFidelityGroup2.test.ts / dbCollationGroupB.test.ts).
 * Offline only -- no live DB. The Postgres SQL->IR path is exercised through a
 * mocked `pg` Pool; the Sybase path uses the pure `transformSidecarIntrospection`
 * mapper over a synthetic sidecar response; the finding builders are fed
 * synthetic IR. Synthetic-rows-only -> isolation-safe.
 *
 * Focused set (within the 2-8 bound):
 *  1. Postgres introspectSequences maps pg_sequences.last_value through onto
 *     SequenceMetadata.currentValue (verbatim string) + a never-advanced
 *     sequence (last_value null) -> null.
 *  2. The cutover-hazard Finding is emitted carrying the VERBATIM high-water
 *     mark, and a never-advanced sequence still emits the finding marked
 *     value-available=false but with the start value reasoning.
 *  3. The Sybase path (sidecar exposes no current value) -> currentValue null +
 *     the cutover Finding marked value-unavailable (TODO(oracle-W3)).
 *  4. The current value is also carried in the existing sequence_definition
 *     Finding payload (additive, alongside start/increment/min/max/cycle).
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

import { PostgresDiscoveryPack } from '../services/databasePacks/postgres/PostgresDiscoveryPack';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import { __testOnly as postgresFindings } from '../services/databasePacks/postgres/postgresFindings';
import { __testOnly as sybaseFindings } from '../services/databasePacks/sybase/sybaseFindings';
import type {
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
  runId: 'run-c',
  projectId: 'proj-c',
  architectureId: 'arch-c',
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
// 1) Postgres pg_sequences.last_value -> SequenceMetadata.currentValue.
// -----------------------------------------------------------------------------

describe('Postgres sequence current-value introspection (Group C)', () => {
  it('maps pg_sequences.last_value through verbatim + null for a never-advanced sequence', async () => {
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
        // High-water mark: 4242 ids already handed out.
        last_value: '4242',
        owned_by_table: 'orders',
        owned_by_column: 'id',
      },
      {
        schema_name: 'public',
        sequence_name: 'fresh_seq',
        data_type: 'bigint',
        start_value: '1',
        increment: '1',
        min_value: '1',
        max_value: '9223372036854775807',
        cycle_option: 'NO',
        // Never advanced -> pg_sequences.last_value is NULL.
        last_value: null,
        owned_by_table: null,
        owned_by_column: null,
      },
    ]);

    await pack.connect(ctx);
    const seqs = await pack.introspectSequences(ctx);
    await pack.close();

    const orders = seqs.find((s) => s.sequenceName === 'orders_id_seq')!;
    expect(orders.currentValue).toBe('4242'); // verbatim string
    const fresh = seqs.find((s) => s.sequenceName === 'fresh_seq')!;
    expect(fresh.currentValue).toBeNull(); // never advanced -> null

    // Belt-and-braces: the SELECT references pg_sequences + last_value.
    const seqSql = recordedQueries.find((q) => /information_schema\.sequences/i.test(q.sql));
    expect(seqSql!.sql).toMatch(/pg_sequences/i);
    expect(seqSql!.sql).toMatch(/last_value/i);
  });
});

// -----------------------------------------------------------------------------
// 2) Cutover-hazard Finding carries the high-water mark.
// -----------------------------------------------------------------------------

describe('Sequence cutover hazard Finding (Group C)', () => {
  it('emits a cutover-hazard Finding carrying the VERBATIM current value', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      sequences: [
        {
          schemaName: 'public',
          sequenceName: 'orders_id_seq',
          dataType: 'bigint',
          startValue: '1',
          currentValue: '4242',
          ownedByTable: 'orders',
          ownedByColumn: 'id',
        },
      ],
    };
    const out = postgresFindings.emitSequenceCutoverFindings(ir);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('sequence_cutover_hazard');
    expect(out[0].category).toBe('migration_risk');
    expect(out[0].title).toContain('public.orders_id_seq');
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.currentValue).toBe('4242'); // verbatim in payload
    expect(detail.currentValueAvailable).toBe(true);
    expect(detail.startValue).toBe('1');
    expect(detail.migrationConcern).toBe('sequence_restart_collision');
    expect(String(out[0].summary)).toContain('4242');
  });

  it('still emits the cutover Finding (value-available=false) for a never-advanced sequence', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      sequences: [
        {
          schemaName: 'public',
          sequenceName: 'fresh_seq',
          startValue: '1',
          currentValue: null,
        },
      ],
    };
    const out = postgresFindings.emitSequenceCutoverFindings(ir);
    expect(out).toHaveLength(1);
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.currentValue).toBeNull();
    expect(detail.currentValueAvailable).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 3) Sybase path: sidecar exposes no current value -> null + value-unavailable.
// -----------------------------------------------------------------------------

describe('Sybase sequence current-value (Group C)', () => {
  it('defaults currentValue to null when the sidecar exposes no current value', () => {
    const resp: SidecarIntrospectionResponse = {
      ok: true,
      error: null,
      schemas: [{ schemaName: 'dbo', owner: 'sa' }],
      tables: [],
      columns: [],
      keys: [],
      views: [],
      procedures: [],
      triggers: [],
      // The current sidecar surfaces the sequence shape but NO current value.
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'invoice_seq',
          dataType: 'bigint',
          startValue: '1',
          increment: '1',
          // no currentValue field on this build
        },
      ],
    };
    const ir = transformSidecarIntrospection(resp);
    const seq = (ir.sequences ?? []).find((s) => s.sequenceName === 'invoice_seq')!;
    expect(seq.currentValue).toBeNull();
  });

  it('emits the cutover Finding marked value-unavailable on the Sybase path', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      sequences: [
        {
          schemaName: 'dbo',
          sequenceName: 'invoice_seq',
          startValue: '1',
          currentValue: null, // sidecar did not surface it (TODO(oracle-W3))
        },
      ],
    };
    const out = sybaseFindings.emitSequenceCutoverFindings(ir);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('sequence_cutover_hazard');
    const detail = out[0].detailJson as Record<string, unknown>;
    expect(detail.currentValue).toBeNull();
    expect(detail.currentValueAvailable).toBe(false);
    expect(String(out[0].summary)).toContain('value unavailable');
  });
});

// -----------------------------------------------------------------------------
// 4) The current value also rides in the existing sequence_definition Finding.
// -----------------------------------------------------------------------------

describe('sequence_definition Finding carries currentValue (Group C)', () => {
  it('adds currentValue to the existing sequence_definition payload (additive)', () => {
    const ir: IntrospectionResult = {
      ...emptyIntrospection(),
      sequences: [
        {
          schemaName: 'public',
          sequenceName: 'orders_id_seq',
          startValue: '1',
          increment: '1',
          currentValue: '4242',
          ownedByTable: 'orders',
          ownedByColumn: 'id',
        },
      ],
    };
    const out = postgresFindings.emitHiddenLogicFindings(ir);
    const seqFinding = out.find((f) => f.findingType === 'sequence_definition')!;
    expect(seqFinding).toBeTruthy();
    const detail = seqFinding.detailJson as Record<string, unknown>;
    expect(detail.currentValue).toBe('4242'); // additive, verbatim
    // Stable Spec-3 keys intact.
    expect(detail.startValue).toBe('1');
    expect(detail.increment).toBe('1');
  });
});
