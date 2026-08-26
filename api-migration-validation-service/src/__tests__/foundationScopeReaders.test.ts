/**
 * Foundations Spec 3 — capture + S0 readers (2026-08-22).
 *
 * Pins the four consumption seams of the scope data plane:
 *   1. compensationMetadata: promoted PKs consumed with zero special-casing;
 *      keyPolicy + scope + the volatile set carried per table;
 *   2. effect scope: excluded/volatile tables never enter the write maps —
 *      removals recorded per operation with receipts; the preflight
 *      classifies a fully-scoped-away endpoint as a SCOPE CONFLICT (with
 *      receipts), not a missing map;
 *   3. S0 fingerprint: tolerated tables (volatile/keyless-written) split
 *      into tolerated_mismatches, never failing the verification;
 *   4. compensation bracket: keyless_multiset tables run DETECT-ONLY
 *      (count observations, no undo), keyed tables refuse as before.
 */

import { buildCompensationMetadataIndex } from '../services/compensation/compensationMetadata';
import {
  buildEffectScopeIndexFromModel,
  effectTablesFor,
} from '../services/stateDelta';
import {
  computeScopeConflictEndpoints,
  computeWriteEndpointsWithoutEffectMap,
  fingerprintSuspectsNote,
  scopeConflictFor,
} from '../services/captureCompensation';
import { verifyS0Fingerprint } from '../services/s0/fingerprint';
import { runCompensationBracket } from '../services/compensation/compensationRunner';
import type { DbAdapter } from '../services/db/DbAdapter';

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        {
          id: 'e1',
          name: 'orders',
          constraints_metadata: {
            primary_key: {
              name: 'f_2_promoted_pk',
              columns: ['OrderId', 'ValidFrom'],
              provenance: 'foundation_promoted',
              decision_ref: 'F-2',
            },
          },
        },
        {
          id: 'e2',
          name: 'event_sink',
          constraints_metadata: { key_policy: 'keyless_multiset' },
        },
        {
          id: 'e3',
          name: 'orders_bak',
          migration_scope: 'excluded',
          scope_decision_ref: 'F-1',
        },
        {
          id: 'e4',
          name: 'work_queue',
          migration_scope: 'volatile',
          scope_decision_ref: 'F-3',
        },
      ],
      physical_data_attributes: [],
      endpoints: [
        { id: 'ep1', operation_verb: 'POST', path_or_address: '/orders' },
        { id: 'ep2', operation_verb: 'POST', path_or_address: '/archive' },
      ],
    },
    relationships: {
      endpoint_data_effects: [
        { endpoint_id: 'ep1', access_mode: 'write', data_entity_point_id: 'dep_phy_e1' },
        { endpoint_id: 'ep2', access_mode: 'write', data_entity_point_id: 'dep_phy_e3' },
      ],
    },
  },
};

describe('compensationMetadata (Spec 3)', () => {
  const index = buildCompensationMetadataIndex(MODEL);

  it('a foundation-promoted PK is consumed with zero special-casing', () => {
    expect(index.byTable.get('orders')?.pkColumns).toEqual(['OrderId', 'ValidFrom']);
  });

  it('carries keyPolicy, scope and the volatile tolerance set', () => {
    expect(index.byTable.get('event_sink')?.keyPolicy).toBe('keyless_multiset');
    expect(index.byTable.get('orders_bak')?.scope).toBe('excluded');
    expect([...(index.volatileTables ?? [])]).toEqual(['work_queue']);
  });
});

describe('effect scope + preflight (Spec 3)', () => {
  const scope = buildEffectScopeIndexFromModel(MODEL as never);

  it('excluded tables never enter the write maps; removals carry receipts', () => {
    expect(effectTablesFor(scope, 'POST', '/orders')).toEqual(['orders']);
    expect(effectTablesFor(scope, 'POST', '/archive')).toEqual([]);
    expect(scopeConflictFor(scope, 'POST', '/archive')).toEqual([
      { table: 'orders_bak', scope: 'excluded', decision_ref: 'F-1' },
    ]);
  });

  it('a fully-scoped-away endpoint is a SCOPE CONFLICT, not a missing map', () => {
    const operations = [
      { method: 'POST', path: '/orders', included: true },
      { method: 'POST', path: '/archive', included: true },
    ];
    expect(computeWriteEndpointsWithoutEffectMap(operations, scope)).toEqual([]);
    expect(computeScopeConflictEndpoints(operations, scope)).toEqual([
      'POST /archive — orders_bak excluded (F-1)',
    ]);
  });
});

describe('S0 fingerprint tolerance (Spec 3)', () => {
  function adapterWithCounts(counts: Record<string, number>): DbAdapter {
    return {
      countRows: async ({ table }: { table: string }) => counts[table] ?? 0,
    } as unknown as DbAdapter;
  }

  const manifest = {
    tables: [
      { table: 'orders', row_count: 5, checksum: null, pk_columns: [] },
      { table: 'work_queue', row_count: 2, checksum: null, pk_columns: [] },
      { table: 'event_sink', row_count: 1, checksum: null, pk_columns: [] },
    ],
  } as never;

  it('volatile/keyless divergence lands in tolerated_mismatches; matches stays true', async () => {
    const metadata = buildCompensationMetadataIndex(MODEL);
    const adapter = adapterWithCounts({ orders: 5, work_queue: 99, event_sink: 42 });
    const tolerated = new Set(['work_queue', 'event_sink']);
    const report = await verifyS0Fingerprint(adapter, metadata, manifest, null, tolerated);
    expect(report.matches).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.tolerated_mismatches.map((m) => m.table).sort()).toEqual([
      'event_sink',
      'work_queue',
    ]);
    expect(report.tolerated_mismatches[0].note).toContain('tolerated');
  });

  it('a NON-tolerated divergence still fails', async () => {
    const metadata = buildCompensationMetadataIndex(MODEL);
    const adapter = adapterWithCounts({ orders: 6, work_queue: 2, event_sink: 1 });
    const report = await verifyS0Fingerprint(adapter, metadata, manifest, null, new Set());
    expect(report.matches).toBe(false);
    expect(report.mismatches[0]).toMatchObject({ table: 'orders', kind: 'count_mismatch' });
  });
});

describe('keyless_multiset detect-only bracket (Spec 3)', () => {
  it('fires the scenario, records count observations, refuses nothing', async () => {
    const metadata = buildCompensationMetadataIndex(MODEL);
    let count = 1;
    const readAdapter = {
      countRows: async () => count,
    } as unknown as DbAdapter;
    const writeAdapter = { executeCompensationBatch: async () => undefined };

    const run = await runCompensationBracket({
      readAdapter,
      writeAdapter: writeAdapter as never,
      engine: 'sybase',
      schema: null,
      tables: ['event_sink'],
      metadata,
      fire: async () => {
        count = 3; // the scenario wrote two rows
        return 'fired';
      },
    });

    expect(run.fired).toBe(true);
    expect(run.fireResult).toBe('fired');
    expect(run.outcome.kind).toBe('clean');
    expect(run.outcome.keylessObservations).toEqual([
      { table: 'event_sink', countBefore: 1, countAfter: 3 },
    ]);
  });

  it('a keyless table WITHOUT the policy still refuses missing_pk (fail-closed)', async () => {
    const metadata = buildCompensationMetadataIndex({
      metaModel: {
        entities: {
          physical_data_entities: [{ id: 'x', name: 'bare_heap' }],
          physical_data_attributes: [],
        },
      },
    });
    const run = await runCompensationBracket({
      readAdapter: {} as never,
      writeAdapter: { executeCompensationBatch: async () => undefined } as never,
      engine: 'sybase',
      schema: null,
      tables: ['bare_heap'],
      metadata,
      fire: async () => 'never',
    });
    expect(run.fired).toBe(false);
    expect(run.outcome.kind).toBe('refused');
  });
});

describe('quiet-window guardrail + audit sink (Oracle Nine item 5)', () => {
  it('drift on an unclassified table refuses; volatile/audit-sink/keyless drift is tolerated', async () => {
    const { runQuietWindowCheck } = await import('../services/captureCompensation');
    const metadata = buildCompensationMetadataIndex({
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: 'e1', name: 'orders' },
            { id: 'e2', name: 'work_queue', migration_scope: 'volatile' },
            {
              id: 'e3',
              name: 'audit_trail_info',
              constraints_metadata: { audit_sink: true },
            },
          ],
          physical_data_attributes: [],
        },
      },
    });
    let call = 0;
    const counts: Record<string, number[]> = {
      orders: [10, 12],
      work_queue: [5, 9],
      audit_trail_info: [100, 140],
    };
    const adapter = {
      countRows: async ({ table }: { table: string }) => counts[table][call > 2 ? 1 : ((call++, call > 3 ? 1 : 0))],
    } as never;
    // simpler deterministic adapter: first sweep returns index 0, second index 1
    let sweep = 0;
    const adapter2 = {
      countRows: async ({ table }: { table: string }) => counts[table][sweep],
    } as never;
    const result = await runQuietWindowCheck({
      adapter: adapter2,
      metadata,
      schema: null,
      gapSeconds: 1,
      sleep: async () => {
        sweep = 1;
      },
    });
    void adapter;
    expect(result.quiet).toBe(false);
    expect(result.drifted).toEqual([{ table: 'orders', before: 10, after: 12 }]);
    expect(result.toleratedDrift.sort()).toEqual(['audit_trail_info', 'work_queue']);
  });

  it('audit-sink tables join the end-of-job tolerated set', () => {
    const metadata = buildCompensationMetadataIndex({
      metaModel: {
        entities: {
          physical_data_entities: [
            { id: 'e1', name: 'audit_trail_info', constraints_metadata: { audit_sink: true } },
          ],
          physical_data_attributes: [],
        },
      },
    });
    expect([...(metadata.auditSinkTables ?? [])]).toEqual(['audit_trail_info']);
  });

  it('sequence-generator tables ride the index and the quiet/end-of-job tolerance (Kiro C1, 2026-08-25)', () => {
    // Oracle Nine item 2 materializes the foundations sequence-generator
    // decision onto constraints_metadata; the tolerance classes read it —
    // the sequence table has a PK, so the keyless rule never covered it
    // and every create falsely halted the end-of-job fingerprint.
    const metadata = buildCompensationMetadataIndex({
      metaModel: {
        entities: {
          physical_data_entities: [
            {
              id: 'e1',
              name: 'seq_registry',
              constraints_metadata: {
                sequence_generator: { strategy: 'native_sequences', name_column: 'SeqName' },
              },
            },
            { id: 'e2', name: 'deal_book' },
          ],
          physical_data_attributes: [],
        },
      },
    });
    expect([...(metadata.sequenceGeneratorTables ?? [])]).toEqual(['seq_registry']);
  });
});

describe('fingerprint mismatch suspect attribution (2026-08-26)', () => {
  // A favourite-style read-then-write op whose write edge the mining missed:
  // the committed model holds filter_tag as READ on the toggle op and WRITE
  // on the plain create op.
  const model = {
    metaModel: {
      entities: {
        physical_data_entities: [
          { id: 'e1', name: 'filter_tag' },
          { id: 'e2', name: 'screen_filter' },
        ],
        endpoints: [
          { id: 'ep1', operation_verb: 'POST', path_or_address: '/filters/markFavourite' },
          { id: 'ep2', operation_verb: 'POST', path_or_address: '/filters' },
        ],
      },
      relationships: {
        endpoint_data_effects: [
          { endpoint_id: 'ep1', access_mode: 'read', data_entity_point_id: 'dep_phy_e1' },
          { endpoint_id: 'ep1', access_mode: 'write', data_entity_point_id: 'dep_phy_e2' },
          { endpoint_id: 'ep2', access_mode: 'write', data_entity_point_id: 'dep_phy_e1' },
        ],
      },
    },
  };

  it('the builder keeps read-mode TABLES per operation (not just the read-mapped flag)', () => {
    const scope = buildEffectScopeIndexFromModel(model as never);
    expect(scope.readTablesByOperationKey?.get('POST /filters/markFavourite')).toEqual([
      'filter_tag',
    ]);
    // Write edges are untouched by the new map.
    expect(effectTablesFor(scope, 'POST', '/filters/markFavourite')).toEqual(['screen_filter']);
    expect(effectTablesFor(scope, 'POST', '/filters')).toEqual(['filter_tag']);
  });

  it('a diverged table names the ops that hold it as READ — the missed-write suspects', () => {
    const scope = buildEffectScopeIndexFromModel(model as never);
    const note = fingerprintSuspectsNote([{ table: 'filter_tag' }], scope);
    expect(note).toContain('POST /filters/markFavourite');
    expect(note).toContain('missed write edge');
    // The op that WRITE-maps the table is not a suspect (its bracket imaged
    // and verified the revert); only read-holders are named.
    expect(note).not.toContain('POST /filters:');
  });

  it('stays silent with no scope or when nothing read-maps the diverged table', () => {
    const scope = buildEffectScopeIndexFromModel(model as never);
    expect(fingerprintSuspectsNote([{ table: 'filter_tag' }], undefined)).toBe('');
    expect(fingerprintSuspectsNote([{ table: 'org_registry' }], scope)).toBe('');
    expect(fingerprintSuspectsNote([], scope)).toBe('');
  });
});
