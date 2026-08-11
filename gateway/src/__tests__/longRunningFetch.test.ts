/**
 * Long-running DB-plane fetch wiring (2026-08-10 work-machine port).
 * Pins: the 6h default + env override (read at call time, bad values fall
 * back), and that the helper hands global fetch BOTH required knobs — the
 * overall AbortSignal and the undici dispatcher (per-request timeouts
 * disabled) — since the signal alone dies at undici's 300s headers default.
 */
import {
  LONG_FETCH_TIMEOUT_MS,
  longFetchTimeoutMs,
  longRunningDispatcher,
  longRunningPostJson,
} from '../services/longRunningFetch';

describe('longFetchTimeoutMs', () => {
  afterEach(() => {
    delete process.env.DB_PLANE_FETCH_TIMEOUT_MS;
  });

  it('defaults to 24 hours', () => {
    delete process.env.DB_PLANE_FETCH_TIMEOUT_MS;
    expect(longFetchTimeoutMs()).toBe(86_400_000);
    expect(LONG_FETCH_TIMEOUT_MS).toBe(86_400_000);
  });

  it('honours the env override at CALL time and falls back on garbage', () => {
    process.env.DB_PLANE_FETCH_TIMEOUT_MS = '90000';
    expect(longFetchTimeoutMs()).toBe(90_000);
    process.env.DB_PLANE_FETCH_TIMEOUT_MS = 'not-a-number';
    expect(longFetchTimeoutMs()).toBe(86_400_000);
    process.env.DB_PLANE_FETCH_TIMEOUT_MS = '-5';
    expect(longFetchTimeoutMs()).toBe(86_400_000);
  });
});

describe('longRunningPostJson', () => {
  it('passes BOTH the abort signal and the no-timeout dispatcher to fetch', async () => {
    const captured: Array<{ url: string; init: Record<string, unknown> }> = [];
    const realFetch = global.fetch;
    global.fetch = (async (url: string, init: Record<string, unknown>) => {
      captured.push({ url, init });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    try {
      await longRunningPostJson('http://amvs.test/run', { a: 1 });
    } finally {
      global.fetch = realFetch;
    }
    expect(captured).toHaveLength(1);
    const init = captured[0].init;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // The undici dispatcher must ride along — the signal alone is not enough.
    expect(init.dispatcher).toBeDefined();
  });
});
describe('longRunningDispatcher', () => {
  it('constructs a real undici Agent and caches it (one shared dispatcher)', () => {
    const a = longRunningDispatcher();
    const b = longRunningDispatcher();
    expect(a).toBeDefined();
    expect(b).toBe(a);
  });

  it('THROWS an actionable error when the agent cannot be constructed — broken, never degraded', () => {
    // The cache is per-module; exercise the failure path via the injectable
    // builder on a fresh isolated module registry.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../services/longRunningFetch') as
        typeof import('../services/longRunningFetch');
      expect(() =>
        fresh.longRunningDispatcher(() => {
          throw new Error('MODULE_NOT_FOUND (simulated)');
        }),
      ).toThrow(/could not be constructed[\s\S]*npm install[\s\S]*MODULE_NOT_FOUND/);
    });
  });
});

