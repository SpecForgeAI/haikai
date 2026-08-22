/** modelScope accessor semantics (Foundations Spec 1, 2026-08-22). */

import {
  allEntities,
  entityScope,
  excludedEntityNames,
  inScopeEntities,
  scopeDecisionRef,
  volatileEntityNames,
} from '../modelScope';

const MODEL = {
  metaModel: {
    entities: {
      physical_data_entities: [
        { id: '1', name: 'orders' },
        { id: '2', name: 'orders_bak', migration_scope: 'excluded', scope_decision_ref: 'F-1' },
        { id: '3', name: 'work_queue', migration_scope: 'volatile', scope_decision_ref: 'F-3' },
        { id: '4', name: 'ref_rates', migration_scope: 'data_only', scope_decision_ref: 'F-5' },
        { id: '5', name: 'weird', migration_scope: 'nonsense' },
      ],
    },
  },
};

describe('modelScope accessors', () => {
  it('entityScope: absent/unknown scopes default to in_scope (never block)', () => {
    expect(entityScope({ name: 'x' })).toBe('in_scope');
    expect(entityScope({ name: 'x', migration_scope: 'nonsense' })).toBe('in_scope');
    expect(entityScope({ name: 'x', migration_scope: 'excluded' })).toBe('excluded');
    expect(entityScope(null)).toBe('in_scope');
  });

  it('allEntities is scope-blind; inScopeEntities drops excluded + volatile, keeps data_only', () => {
    expect(allEntities(MODEL)).toHaveLength(5);
    expect(inScopeEntities(MODEL).map((e) => e.name)).toEqual(['orders', 'ref_rates', 'weird']);
  });

  it('volatile/excluded name sets are lower-cased; receipts read through scopeDecisionRef', () => {
    expect([...volatileEntityNames(MODEL)]).toEqual(['work_queue']);
    expect([...excludedEntityNames(MODEL)]).toEqual(['orders_bak']);
    expect(scopeDecisionRef(allEntities(MODEL)[1])).toBe('F-1');
    expect(scopeDecisionRef(allEntities(MODEL)[0])).toBeNull();
  });

  it('tolerates a missing model/collection', () => {
    expect(allEntities(null)).toEqual([]);
    expect(inScopeEntities({})).toEqual([]);
  });
});
