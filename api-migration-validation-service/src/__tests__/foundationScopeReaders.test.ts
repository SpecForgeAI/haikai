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
