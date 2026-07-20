/**
 * Coverage Closure Pass A — deterministic candidate generation (CC2, Spec
 * 2026-07-20).
 *
 * Pins the pure contract: path-param endpoints get session-pool candidates
 * FIRST then DB-mined ones; no-path-param endpoints get none (deferred to Pass
 * B); candidates are deduped, bounded, and URL-encoded.
 */
import {
  pathParamNames,
  buildPassACandidates,
  tablesToSample,
  MAX_CANDIDATES_PER_ENDPOINT,
  PassAInputs,
} from '../services/captureClosurePassA';

function inputs(partial: Partial<PassAInputs>): PassAInputs {
  return {
    uncovered: partial.uncovered ?? [],
    sessionIdPool: partial.sessionIdPool ?? [],
    tablesByOperationId: partial.tablesByOperationId ?? new Map(),
    dbValuesByTable: partial.dbValuesByTable ?? new Map(),
  };
}

describe('pathParamNames', () => {
  it('extracts ordered unique {param} names', () => {
    expect(pathParamNames('/orders/{id}')).toEqual(['id']);
    expect(pathParamNames('/p/{pid}/c/{cid}')).toEqual(['pid', 'cid']);
    expect(pathParamNames('/health')).toEqual([]);
  });
});

describe('buildPassACandidates', () => {
  it('single path param: session pool first, then DB-mined, deduped', () => {
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op1', method: 'GET', path: '/orders/{id}' }],
        sessionIdPool: ['42', '7'],
        tablesByOperationId: new Map([['op1', ['dbo.orders']]]),
        dbValuesByTable: new Map([['dbo.orders', ['42', '99']]]), // 42 dups the pool
      }),
    );
    expect(cands.map((c) => `${c.path}:${c.source}`)).toEqual([
      '/orders/42:session_pool',
      '/orders/7:session_pool',
      '/orders/99:db_mined', // 42 already emitted from the pool → deduped
    ]);
  });

  it('no path param → no candidates (deferred to Pass B)', () => {
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op2', method: 'POST', path: '/orders' }],
        sessionIdPool: ['1', '2'],
      }),
    );
    expect(cands).toEqual([]);
  });

  it('URL-encodes substituted values', () => {
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op3', method: 'GET', path: '/items/{id}' }],
        sessionIdPool: ['a b/c'],
      }),
    );
    expect(cands[0].path).toBe('/items/a%20b%2Fc');
  });

  it('multi-param: diagonal (same value across params) comes first', () => {
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op4', method: 'GET', path: '/p/{pid}/c/{cid}' }],
        sessionIdPool: ['1', '2'],
      }),
    );
    expect(cands[0].path).toBe('/p/1/c/1');
    expect(cands[1].path).toBe('/p/2/c/2');
    // then bounded cross product (e.g. /p/1/c/2)
    expect(cands.some((c) => c.path === '/p/1/c/2')).toBe(true);
  });

  it('caps candidates per endpoint', () => {
    const pool = Array.from({ length: 100 }, (_, i) => String(i));
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op5', method: 'GET', path: '/x/{id}' }],
        sessionIdPool: pool,
      }),
    );
    expect(cands.length).toBeLessThanOrEqual(MAX_CANDIDATES_PER_ENDPOINT);
  });

  it('empty / whitespace pool values are ignored', () => {
    const cands = buildPassACandidates(
      inputs({
        uncovered: [{ operation_id: 'op6', method: 'GET', path: '/x/{id}' }],
        sessionIdPool: ['', '5'],
      }),
    );
    expect(cands.map((c) => c.path)).toEqual(['/x/5']);
  });
});

describe('tablesToSample', () => {
  it('collects tables only for path-param endpoints, deduped', () => {
    const tables = tablesToSample(
      [
        { operation_id: 'op1', method: 'GET', path: '/orders/{id}' },
        { operation_id: 'op2', method: 'POST', path: '/orders' }, // no param → skipped
        { operation_id: 'op3', method: 'GET', path: '/books/{id}' },
      ],
      new Map([
        ['op1', ['dbo.orders']],
        ['op2', ['dbo.orders']],
        ['op3', ['dbo.orders', 'dbo.books']],
      ]),
    );
    expect(tables.sort()).toEqual(['dbo.books', 'dbo.orders']);
  });
});
