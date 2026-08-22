/**
 * Foundations Spec 4 — target-side scope readers (2026-08-22).
 *
 * Pins the pack choke point: excluded/volatile entities (and their
 * attributes) never reach target generation and the receipt carries the
 * decision refs; and the surrogate rung: a foundation keyless_multiset
 * table takes a surrogate identity PK even WITHOUT the pack-level
 * surrogate decision (the foundations review already decided it).
 */

import {
  applyScopeToModelBundle,
  applySurrogatePkDecision,
  type CommittedPhysicalModel,
} from '../services/dbMigrationPack/inputs';
import type { IrTable } from '../services/dbMigrationPack/types';

function bundle(): CommittedPhysicalModel {
  return {
    physicalDataEntities: [
      { id: 'e1', name: 'dbo.orders' },
      { id: 'e2', name: 'dbo.orders_bak', migration_scope: 'excluded', scope_decision_ref: 'F-1' },
      { id: 'e3', name: 'dbo.work_queue', migration_scope: 'volatile', scope_decision_ref: 'F-3' },
      { id: 'e4', name: 'dbo.ref_rates', migration_scope: 'data_only', scope_decision_ref: 'F-5' },
    ],
    physicalDataAttributes: [
      { id: 'a1', name: 'id', physical_entity_id: 'e1' },
      { id: 'a2', name: 'id', physical_entity_id: 'e2' },
      { id: 'a3', name: 'k', physical_entity_id: 'e3' },
      { id: 'a4', name: 'rate', physical_entity_id: 'e4' },
    ],
    dataEntityPoints: [],
    dataEntityRelationships: [],
  };
}

describe('applyScopeToModelBundle (Spec 4)', () => {
  it('drops excluded+volatile entities AND their attributes; data_only stays; receipt carries refs', () => {
    const out = applyScopeToModelBundle(bundle());
    expect(out.physicalDataEntities.map((e) => e.name)).toEqual(['dbo.orders', 'dbo.ref_rates']);
    expect(out.physicalDataAttributes.map((a) => a.id)).toEqual(['a1', 'a4']);
    expect(out.scopeReceipt).toEqual({
      total_entities: 4,
      in_scope: 1,
      data_only: 1,
      excluded: [{ name: 'dbo.orders_bak', decision_ref: 'F-1' }],
      volatile: [{ name: 'dbo.work_queue', decision_ref: 'F-3' }],
    });
  });
});

describe('surrogate for foundation keyless policy (Spec 4)', () => {
  function irTable(partial: Partial<IrTable>): IrTable {
    return {
      schemaName: 'dbo',
      tableName: 't',
      entityId: 'e',
      physicalType: 'Table',
      objectType: 'table',
      columns: [],
      primaryKey: null,
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      estimatedRowCount: null,
      findingIds: [],
      ...partial,
    } as IrTable;
  }

  it('a keyless_multiset table gains the surrogate PK WITHOUT the global pack decision', () => {
    const policy = irTable({ tableName: 'event_sink', keyPolicy: 'keyless_multiset' });
    const plainNoPk = irTable({ tableName: 'bare_heap' });
    const result = applySurrogatePkDecision([policy, plainNoPk], {});
    expect(result.added).toEqual(['dbo.event_sink']);
    expect(policy.primaryKey).toMatchObject({ isSurrogate: true });
    // No global decision: a plain no-PK table without the policy is untouched.
    expect(plainNoPk.primaryKey).toBeNull();
  });

  it('the global decision still surrogates every no-PK table (unchanged)', () => {
    const a = irTable({ tableName: 'bare_heap' });
    const result = applySurrogatePkDecision([a], {
      'surrogate_pk--tables_without_pk': { option: 'add_surrogate_identity_pk' },
    });
    expect(result.added).toEqual(['dbo.bare_heap']);
    expect(a.primaryKey).toMatchObject({ isSurrogate: true });
  });
});
