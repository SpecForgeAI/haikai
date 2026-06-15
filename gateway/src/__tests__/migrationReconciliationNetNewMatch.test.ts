/**
 * Unit tests for the pure net_new match logic (Spec 2026-06-14 / D6, Group 3).
 *
 * Exercises the lookup builder + the key normalisation + the outcome
 * classification (auto_recognised / ambiguous / no_match) in isolation from the
 * reconcile driver.
 */

import {
  operationKey,
  buildNetNewOperationLookup,
  matchTargetOnlyOperation,
  ReconcileBookOfWorkItem,
} from '../services/migrationReconciliationNetNewMatch';

function item(over: Partial<ReconcileBookOfWorkItem> & { id: string }): ReconcileBookOfWorkItem {
  return {
    title: `Item ${over.id}`,
    workItemId: `wi-${over.id}`,
    provenance: 'net_new',
    kind: 'api',
    netNewOperations: [],
    ...over,
  };
}

describe('operationKey', () => {
  it('trims + upper-cases the method and trims the path', () => {
    expect(operationKey('  post ', '  /accounts ')).toBe('POST /accounts');
  });
  it('returns null when both halves are empty', () => {
    expect(operationKey('', '')).toBeNull();
    expect(operationKey(null, undefined)).toBeNull();
  });
});

describe('buildNetNewOperationLookup', () => {
  it('only indexes net_new + api items', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', provenance: 'net_new', kind: 'api', netNewOperations: ['POST /accounts'] }),
      item({ id: 'b', provenance: 'carry_over', kind: 'api', netNewOperations: ['POST /carry'] }),
      item({ id: 'c', provenance: 'net_new', kind: 'operational', netNewOperations: ['POST /op'] }),
    ]);
    expect(lookup.byKey.has('POST /accounts')).toBe(true);
    expect(lookup.byKey.has('POST /carry')).toBe(false);
    expect(lookup.byKey.has('POST /op')).toBe(false);
  });

  it('tolerates missing/empty operation lists', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', netNewOperations: null }),
      item({ id: 'b', netNewOperations: [] }),
    ]);
    expect(lookup.byKey.size).toBe(0);
  });
});

describe('matchTargetOnlyOperation', () => {
  it('auto_recognised on a unique exact-key owner', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', workItemId: 'wi-a', netNewOperations: ['POST /accounts'] }),
    ]);
    const r = matchTargetOnlyOperation('POST', '/accounts', lookup);
    expect(r.outcome).toBe('auto_recognised');
    if (r.outcome === 'auto_recognised') {
      expect(r.owner.workItemId).toBe('wi-a');
      expect(r.key).toBe('POST /accounts');
    }
  });

  it('ambiguous (multiple_owners) when two net_new items own the same key', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', workItemId: 'wi-a', netNewOperations: ['POST /accounts'] }),
      item({ id: 'b', workItemId: 'wi-b', netNewOperations: ['POST /accounts'] }),
    ]);
    const r = matchTargetOnlyOperation('POST', '/accounts', lookup);
    expect(r.outcome).toBe('ambiguous');
    if (r.outcome === 'ambiguous') {
      expect(r.reason).toBe('multiple_owners');
      expect(r.owners.map((o) => o.workItemId)).toEqual(['wi-a', 'wi-b']);
    }
  });

  it('ambiguous (method_mismatch) on a same-path/different-method near-miss', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', netNewOperations: ['POST /accounts'] }),
    ]);
    const r = matchTargetOnlyOperation('GET', '/accounts', lookup);
    expect(r.outcome).toBe('ambiguous');
    if (r.outcome === 'ambiguous') expect(r.reason).toBe('method_mismatch');
  });

  it('no_match when nothing references the path', () => {
    const lookup = buildNetNewOperationLookup([
      item({ id: 'a', netNewOperations: ['POST /accounts'] }),
    ]);
    expect(matchTargetOnlyOperation('POST', '/widgets', lookup).outcome).toBe('no_match');
  });
});
