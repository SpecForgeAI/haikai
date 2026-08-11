/**
 * AMVS long-running sidecar fetch (2026-08-11 — the gateway module's sibling).
 * Pins the 6h default + SIDECAR_FETCH_TIMEOUT_MS override (call-time read,
 * defensive fallback) and that BOTH required knobs — the AbortSignal and the
 * undici dispatcher — reach global fetch (the signal alone still dies at
 * undici's 300s headers default, the truncated-keyset-load root cause).
 */
import {
  LONG_FETCH_TIMEOUT_MS,
  longFetchTimeoutMs,
  longRunningDispatcher,
  longRunningFetch,
} from '../services/longRunningFetch';

describe('longFetchTimeoutMs (sidecar)', () => {
  afterEach(() => {
    delete process.env.SIDECAR_FETCH_TIMEOUT_MS;
  });

  it('defaults to 24 hours', () => {
    delete process.env.SIDECAR_FETCH_TIMEOUT_MS;
    expect(longFetchTimeoutMs()).toBe(86_400_000);
    expect(LONG_FETCH_TIMEOUT_MS).toBe(86_400_000);
  });

  it('honours the env override at call time and falls back on garbage', () => {
    process.env.SIDECAR_FETCH_TIMEOUT_MS = '120000';
    expect(longFetchTimeoutMs()).toBe(120_000);
    process.env.SIDECAR_FETCH_TIMEOUT_MS = 'nope';
    expect(longFetchTimeoutMs()).toBe(86_400_000);
  });
});

describe('longRunningFetch (sidecar)', () => {
  it('passes BOTH the abort signal and the no-timeout dispatcher to fetch', async () => {
    const captured: Array<{ url: string; init: Record<string, unknown> }> = [];
    const realFetch = global.fetch;
    global.fetch = (async (url: string, init: Record<string, unknown>) => {
      captured.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    }) as unknown as typeof fetch;
    try {
      await longRunningFetch('http://sidecar.test/query', {
        method: 'POST',
        body: '{}',
      });
    } finally {
      global.fetch = realFetch;
    }
    expect(captured).toHaveLength(1);
    expect(captured[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(captured[0].init.dispatcher).toBeDefined();
  });

  it('caches ONE shared dispatcher and throws actionable on construction failure', () => {
    expect(longRunningDispatcher()).toBe(longRunningDispatcher());
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../services/longRunningFetch') as
        typeof import('../services/longRunningFetch');
      expect(() =>
        fresh.longRunningDispatcher(() => {
          throw new Error('MODULE_NOT_FOUND (simulated)');
        }),
      ).toThrow(/could not be constructed[\s\S]*npm install/);
    });
  });
});
