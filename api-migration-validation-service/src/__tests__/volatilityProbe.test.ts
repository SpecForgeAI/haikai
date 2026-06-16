/**
 * volatilityProbe unit tests.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 2 sub-task 2.1.
 *
 * Test inventory (focused, spec-required behaviours):
 *   1. Deterministic across k replays -> empty `paths`, `probed`, `k = 3`.
 *   2. A single varying leaf -> that JSON-Pointer path is recorded.
 *   3. An unordered array -> the array path is flagged order-insensitive
 *      (`array_paths`).
 *   4. Mutating scenario (mutatingConfirmed) -> `not_probed`, k=0, NO replay
 *      calls made.
 *   5. Mutating by HTTP method (POST) -> `not_probed`, NO replay calls.
 *   6. Budget exceeded mid-probe -> `probed_partial` with the completed-repeat
 *      count (< k).
 *   7. Non-JSON body -> `non_json` (distinguishable from a never-probed null).
 */

import { runVolatilityProbe } from '../services/volatilityProbe';
import type { ProbeRequestShape } from '../services/volatilityProbe';
import type { SessionHttpExecutor } from '../services/httpExecutor';

const GET_REQUEST: ProbeRequestShape = {
  method: 'GET',
  path: '/widgets/1',
  query: { detail: 'full' },
  headers: { accept: 'application/json' },
};

/**
 * Build a stub executor that returns the supplied response bodies in order
 * (one per `request()` call). Tracks the call count so a test can assert that
 * NO replay was made for a mutating scenario.
 */
function stubExecutor(bodies: unknown[]): {
  executor: SessionHttpExecutor;
  calls: () => number;
} {
  let i = 0;
  let callCount = 0;
  const executor: SessionHttpExecutor = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: (async () => {
      callCount += 1;
      const body = bodies[Math.min(i, bodies.length - 1)];
      i += 1;
      return { status: 200, data: body, headers: {} } as never;
    }) as never,
    setAuth: () => undefined,
    dispose: () => undefined,
  };
  return { executor, calls: () => callCount };
}

// No-op sleep so spacing never slows the test wall-clock.
const noSleep = async (): Promise<void> => undefined;

describe('runVolatilityProbe', () => {
  test('1. deterministic across k replays -> empty paths, probed, k=3', async () => {
    const body = { id: 1, name: 'alice', tags: ['a', 'b'] };
    const { executor, calls } = stubExecutor([body, body, body]);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      repeats: 3,
      spacingMs: 0,
      sleep: noSleep,
    });

    expect(env.volatility_source).toBe('probed');
    expect(env.k).toBe(3);
    expect(env.paths).toEqual([]);
    expect(env.array_paths).toBeUndefined();
    expect(calls()).toBe(3);
  });

  test('2. a single varying leaf -> that JSON-Pointer path is recorded', async () => {
    const bodies = [
      { id: 1, serverTime: '2026-06-16T10:00:00Z', name: 'alice' },
      { id: 1, serverTime: '2026-06-16T10:00:01Z', name: 'alice' },
      { id: 1, serverTime: '2026-06-16T10:00:02Z', name: 'alice' },
    ];
    const { executor } = stubExecutor(bodies);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      repeats: 3,
      spacingMs: 0,
      sleep: noSleep,
    });

    expect(env.volatility_source).toBe('probed');
    expect(env.k).toBe(3);
    expect(env.paths).toEqual(['/serverTime']);
  });

  test('3. an unordered array -> the array path is flagged order-insensitive', async () => {
    const bodies = [
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      { items: [{ v: 3 }, { v: 1 }, { v: 2 }] },
      { items: [{ v: 2 }, { v: 3 }, { v: 1 }] },
    ];
    const { executor } = stubExecutor(bodies);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      repeats: 3,
      spacingMs: 0,
      sleep: noSleep,
    });

    expect(env.volatility_source).toBe('probed');
    expect(env.array_paths).toContain('/items');
  });

  test('4. mutating scenario (mutatingConfirmed) -> not_probed, k=0, NO replay calls', async () => {
    const { executor, calls } = stubExecutor([{ ok: true }]);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      mutatingConfirmed: true,
      spacingMs: 0,
      sleep: noSleep,
    });

    expect(env.volatility_source).toBe('not_probed');
    expect(env.k).toBe(0);
    expect(env.paths).toEqual([]);
    expect(calls()).toBe(0);
  });

  test('5. mutating by HTTP method (POST) -> not_probed, NO replay calls', async () => {
    const { executor, calls } = stubExecutor([{ ok: true }]);

    const env = await runVolatilityProbe(
      { ...GET_REQUEST, method: 'POST' },
      { executor, spacingMs: 0, sleep: noSleep },
    );

    expect(env.volatility_source).toBe('not_probed');
    expect(calls()).toBe(0);
  });

  test('6. budget exceeded mid-probe -> probed_partial with completed-repeat count', async () => {
    // Two distinct bodies; the third replay is budgeted out. The clock jumps
    // past the budget once 2 replays have run.
    const bodies = [
      { id: 1, n: 'a' },
      { id: 1, n: 'b' },
      { id: 1, n: 'c' },
    ];
    const { executor, calls } = stubExecutor(bodies);

    // Fake clock: start at 0, +1ms per tick. The budget check fires before
    // replay 3. We make the 3rd budget check exceed the 5ms budget.
    let t = 0;
    // now() call order: startedAt, then per replay-after-first two checks
    // (pre-spacing + post-spacing). startedAt=0, a1.c1=1, a1.c2=2, a2.c1=100
    // -> 100 >= 5ms budget aborts before the 3rd replay (k=2).
    const ticks = [0, 1, 2, 100, 200, 300, 400, 500];
    const now = () => (t < ticks.length ? ticks[t++] : 999);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      repeats: 3,
      budgetMs: 5,
      spacingMs: 0,
      sleep: noSleep,
      now,
    });

    expect(env.volatility_source).toBe('probed_partial');
    expect(env.k).toBeLessThan(3);
    expect(env.k).toBeGreaterThanOrEqual(2);
    expect(calls()).toBeLessThan(3);
    // The varying leaf measured across the completed replays is still recorded.
    expect(env.paths).toEqual(['/n']);
  });

  test('7. non-JSON body -> non_json (distinguishable from null)', async () => {
    const { executor } = stubExecutor(['<html>not json</html>']);

    const env = await runVolatilityProbe(GET_REQUEST, {
      executor,
      repeats: 3,
      spacingMs: 0,
      sleep: noSleep,
    });

    expect(env.volatility_source).toBe('non_json');
    expect(env.paths).toEqual([]);
  });
});
