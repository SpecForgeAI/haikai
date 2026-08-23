/**
 * Data-echo attribution (Residual 1, 2026-07-20).
 *
 * Pins the deterministic partition contract: breaks on endpoints whose
 * committed data effects reference a FROZEN divergent table classify
 * `possible_data_echo`; everything else — including endpoints with NO
 * data-effect metadata — keeps FULL oracle authority (`unexplained`).
 */
import {
  extractOverrideDivergentTables,
  buildEchoClassifier,
  EchoFacts,
} from '../services/migrationReconciliationEchoClassifier';

describe('extractOverrideDivergentTables', () => {
  it('returns null for a clean-context run (no override entry)', () => {
    expect(extractOverrideDivergentTables(null)).toBeNull();
    expect(extractOverrideDivergentTables([])).toBeNull();
    expect(
      extractOverrideDivergentTables([{ type: 'something_else' }]),
    ).toBeNull();
  });

  it('returns the LATEST override entry’s frozen tables', () => {
    const result = extractOverrideDivergentTables([
      { type: 'data_parity_override', at: 't1', divergent_tables: ['dbo.old'] },
      {
        type: 'data_parity_override',
        at: 't2',
        divergent_tables: ['dbo.orders', 'dbo.deal_book'],
      },
    ]);
    expect(result).toEqual({ at: 't2', tables: ['dbo.orders', 'dbo.deal_book'] });
  });
});

describe('buildEchoClassifier', () => {
  const facts: EchoFacts = {
    endpoints: [
      { id: 'ep-orders', verb: 'GET', path: '/orders/{id}' },
      { id: 'ep-health', verb: 'GET', path: '/health' },
      { id: 'ep-nometa', verb: 'POST', path: '/books' },
    ],
    effects: [
      // Qualified reference in the entity-point ref.
      { endpointId: 'ep-orders', material: 'dep_phy_dbo.orders {"query_text":"SELECT * FROM dbo.orders"}' },
      // No effects at all for ep-health; ep-nometa has an effect that does
      // NOT mention any divergent table.
      { endpointId: 'ep-nometa', material: 'dep_log_catalogue {"table":"dbo.catalogue"}' },
    ],
  };

  it('endpoint whose effects reference a divergent table → possible_data_echo with the tables named', () => {
    const classify = buildEchoClassifier(facts, ['dbo.orders']);
    // Template match: the concrete replayed path resolves the {id} template.
    expect(classify('GET', '/orders/42')).toEqual({
      classification: 'possible_data_echo',
      tables: ['dbo.orders'],
    });
  });

  it('bare-name matching: a divergent table matches unqualified references too', () => {
    const bareFacts: EchoFacts = {
      endpoints: [{ id: 'e1', verb: 'GET', path: '/x' }],
      effects: [{ endpointId: 'e1', material: '{"query":"select * from ORDERS"}' }],
    };
    const classify = buildEchoClassifier(bareFacts, ['dbo.orders']);
    expect(classify('GET', '/x').classification).toBe('possible_data_echo');
  });

  it('CONSERVATIVE: no effects / no table hit / unknown endpoint → unexplained (full oracle authority)', () => {
    const classify = buildEchoClassifier(facts, ['dbo.orders']);
    expect(classify('GET', '/health').classification).toBe('unexplained');
    expect(classify('POST', '/books').classification).toBe('unexplained');
    expect(classify('DELETE', '/unknown').classification).toBe('unexplained');
    expect(classify(null, null).classification).toBe('unexplained');
  });

  it('empty divergent set (nothing frozen) → everything unexplained', () => {
    const classify = buildEchoClassifier(facts, []);
    expect(classify('GET', '/orders/42').classification).toBe('unexplained');
  });
});
