/**
 * Foundations program Spec 0 — capture resilience (2026-08-22).
 *
 * Pins the two pure primitives behind the run-resilience fixes:
 *   - the auth-expiry streak transition (consecutive all-401 scenarios trip
 *     `paused_auth_expired`; intended-auth scenarios and zero-capture
 *     scenarios carry no signal; any non-401 resets);
 *   - the S0 fingerprint mismatch detail line NAMING the diverged tables
 *     (top 10 + tail) instead of a bare count.
 */

import {
  AUTH_EXPIRY_STREAK_THRESHOLD,
  nextAuthExpiryStreak,
} from '../services/captureSessionOrchestrator';
import { fingerprintMismatchDetail } from '../services/captureCompensation';

describe('nextAuthExpiryStreak', () => {
  it('advances on an all-401 scenario and trips at the threshold', () => {
    let streak = 0;
    streak = nextAuthExpiryStreak(streak, 'success', [401]);
    streak = nextAuthExpiryStreak(streak, 'not_found', [401, 401]);
    streak = nextAuthExpiryStreak(streak, 'success', [401]);
    expect(streak).toBe(3);
    expect(streak >= AUTH_EXPIRY_STREAK_THRESHOLD).toBe(true);
  });

  it('any non-401 capture resets the streak', () => {
    expect(nextAuthExpiryStreak(2, 'success', [401, 200])).toBe(0);
    expect(nextAuthExpiryStreak(2, 'success', [404])).toBe(0);
  });

  it('intended-auth scenarios legitimately 401 and leave the streak unchanged', () => {
    expect(nextAuthExpiryStreak(2, 'auth', [401])).toBe(2);
  });

  it('zero-capture scenarios (refused/skipped pre-HTTP) carry no signal', () => {
    expect(nextAuthExpiryStreak(2, 'success', [])).toBe(2);
  });

  it('null statuses (no HTTP status recorded) never count as 401', () => {
    expect(nextAuthExpiryStreak(2, 'success', [null])).toBe(0);
  });
});

describe('fingerprintMismatchDetail', () => {
  it('names the diverged tables with row deltas', () => {
    const detail = fingerprintMismatchDetail([
      { table: 'session_tokens', kind: 'count_mismatch', expected: 10, actual: 322 },
      { table: 'audit_log', kind: 'checksum_mismatch', expected: 'aa', actual: 'bb' },
    ]);
    expect(detail).toContain('2 table(s) diverged from S0');
    expect(detail).toContain('session_tokens rows 10->322');
    expect(detail).toContain('audit_log checksum_mismatch');
    expect(detail).toContain('restore via POST /api/s0-snapshot/restore');
  });

  it('caps at 10 named tables with an honest +N tail', () => {
    const mismatches = Array.from({ length: 26 }, (_, i) => ({
      table: `t_${i}`,
      kind: 'count_mismatch',
      expected: 1,
      actual: 2,
    }));
    const detail = fingerprintMismatchDetail(mismatches);
    expect(detail).toContain('26 table(s) diverged');
    expect(detail).toContain('t_9');
    expect(detail).not.toContain('t_10 ');
    expect(detail).toContain('; +16 more');
  });
});
