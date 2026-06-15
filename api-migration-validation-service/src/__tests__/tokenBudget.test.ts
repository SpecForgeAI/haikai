/**
 * Tests for the Phase 2 token-budget helper.
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 * -- Task Group 2 (AMVS env vars + token-cap helper).
 *
 * The helper module reads the four env-driven caps at import time via
 * `../config`. Tests that override caps therefore go through
 * `jest.isolateModules()` so each scenario sees a freshly-imported
 * `tokenBudget` (and `config`) with the desired env snapshot.
 */

const CAP_ENV_KEYS = [
  'AMVS_LLM_EXTRACT_CALL_TOKEN_CAP',
  'AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP',
  'AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP',
  'AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP',
] as const;

describe('tokenBudget helper', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of CAP_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of CAP_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('happy path: a call under the cap returns allow=true with remaining budget', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      const result = tokenBudget.recordAndCheck('session-A', 'extract', 5000);

      expect(result.allow).toBe(true);
      // Default extract per-call cap = 20000, per-session cap = 100000.
      // After 5000 used, remaining = min(20000-5000, 100000-5000) = 15000.
      expect(result.remainingBudget).toBe(15000);
      expect(tokenBudget.getUsedTokens('session-A', 'extract')).toBe(5000);
    });
  });

  it('single call equal to the per-call cap returns allow=true with remainingBudget=0', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      // Default extract per-call cap = 20000. A single call of exactly 20000
      // sits AT the cap (not over it) so it must be allowed.
      const result = tokenBudget.recordAndCheck('session-B', 'extract', 20000);

      expect(result.allow).toBe(true);
      expect(result.remainingBudget).toBe(0);
      expect(tokenBudget.getUsedTokens('session-B', 'extract')).toBe(20000);
    });
  });

  it('single call over the per-call cap returns allow=truncate with maxAllowedTokens set to the cap', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      // Default extract per-call cap = 20000.
      const result = tokenBudget.recordAndCheck('session-C', 'extract', 30000);

      expect(result.allow).toBe('truncate');
      expect(result.maxAllowedTokens).toBe(20000);
      expect(typeof result.warning).toBe('string');
      expect(result.warning).toContain('truncate');
      expect(result.warning).toContain('extract');
      // The ledger records only what we actually allowed (the truncated amount).
      expect(tokenBudget.getUsedTokens('session-C', 'extract')).toBe(20000);
    });
  });

  it('session cap exhaustion across multiple calls truncates subsequent calls to zero', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      // Default payload per-call cap = 8000, per-session cap = 50000.
      // Burn through 50000 / 8000 = 6.25 calls — six 8000-token calls cover
      // 48000, then a seventh 8000-token call has only 2000 of session
      // headroom left.
      for (let i = 0; i < 6; i++) {
        const r = tokenBudget.recordAndCheck('session-D', 'payload', 8000);
        expect(r.allow).toBe(true);
      }
      expect(tokenBudget.getUsedTokens('session-D', 'payload')).toBe(48000);

      // 7th call: requested=8000, but only 2000 left in the session.
      const seventh = tokenBudget.recordAndCheck('session-D', 'payload', 8000);
      expect(seventh.allow).toBe('truncate');
      expect(seventh.maxAllowedTokens).toBe(2000);
      expect(tokenBudget.getUsedTokens('session-D', 'payload')).toBe(50000);

      // 8th call: session is at the cap; further calls truncate to zero.
      const eighth = tokenBudget.recordAndCheck('session-D', 'payload', 8000);
      expect(eighth.allow).toBe('truncate');
      expect(eighth.maxAllowedTokens).toBe(0);
      expect(eighth.warning).toContain('session');
      expect(tokenBudget.getUsedTokens('session-D', 'payload')).toBe(50000);
    });
  });

  it('env var overrides are respected', () => {
    process.env.AMVS_LLM_EXTRACT_CALL_TOKEN_CAP = '1000';
    process.env.AMVS_LLM_EXTRACT_SESSION_TOKEN_CAP = '3000';
    process.env.AMVS_PAYLOAD_CTX_CALL_TOKEN_CAP = '200';
    process.env.AMVS_PAYLOAD_CTX_SESSION_TOKEN_CAP = '500';

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      // Extract: overridden per-call cap = 1000.
      const r1 = tokenBudget.recordAndCheck('session-E', 'extract', 1500);
      expect(r1.allow).toBe('truncate');
      expect(r1.maxAllowedTokens).toBe(1000);

      // Payload: overridden per-call cap = 200, per-session cap = 500.
      const r2 = tokenBudget.recordAndCheck('session-E', 'payload', 150);
      expect(r2.allow).toBe(true);
      // remaining = min(200 - 150, 500 - 150) = 50.
      expect(r2.remainingBudget).toBe(50);

      // A second payload call of 200 would push usage to 350 — still under
      // the 500 session cap and exactly at the 200 per-call cap.
      const r3 = tokenBudget.recordAndCheck('session-E', 'payload', 200);
      expect(r3.allow).toBe(true);
      // remaining = min(200 - 200, 500 - 350) = 0.
      expect(r3.remainingBudget).toBe(0);
    });
  });

  it('per-session isolation: two sessionIds do not share budget', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const tokenBudget = require('../services/tokenBudget');

      // Burn the entire extract session cap (100000) on session-X.
      // Use the per-call cap (20000) five times to hit the session cap
      // exactly.
      for (let i = 0; i < 5; i++) {
        const r = tokenBudget.recordAndCheck('session-X', 'extract', 20000);
        expect(r.allow).toBe(true);
      }
      expect(tokenBudget.getUsedTokens('session-X', 'extract')).toBe(100000);

      // session-X is now exhausted: the next call truncates.
      const exhausted = tokenBudget.recordAndCheck('session-X', 'extract', 1000);
      expect(exhausted.allow).toBe('truncate');
      expect(exhausted.maxAllowedTokens).toBe(0);

      // session-Y starts fresh: a 1000-token call on session-Y is allowed.
      const fresh = tokenBudget.recordAndCheck('session-Y', 'extract', 1000);
      expect(fresh.allow).toBe(true);
      expect(fresh.remainingBudget).toBe(19000); // min(20000-1000, 100000-1000)
      expect(tokenBudget.getUsedTokens('session-Y', 'extract')).toBe(1000);
      // session-X ledger is unchanged.
      expect(tokenBudget.getUsedTokens('session-X', 'extract')).toBe(100000);
    });
  });
});
