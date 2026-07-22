/**
 * LLM provider rate-limit handling (Spec 2026-07-22).
 *
 * Pins: the 429 classifier (conservative — only explicit day markers stop the
 * run) and the shared cool-down gate (one 429 freezes all LLM traffic).
 */
import {
  classifyRateLimit,
  LlmDailyLimitError,
  getCooldownRemainingMs,
  isCoolingDown,
  openCooldown,
  resetCooldown,
} from '../services/llmRateLimit';

describe('classifyRateLimit', () => {
  it('non-429 → null', () => {
    expect(classifyRateLimit(200, 'ok')).toBeNull();
    expect(classifyRateLimit(502, 'per day limit')).toBeNull();
  });

  it('explicit per-minute message → per_minute', () => {
    expect(
      classifyRateLimit(429, '{"error":"Per min token limit exceeded for model gpt-5.4"}'),
    ).toBe('per_minute');
  });

  it('day markers → per_day', () => {
    for (const body of [
      'Per day token limit exceeded',
      'daily quota reached',
      'tokens per day limit',
      'limit resets in 24 hours',
    ]) {
      expect(classifyRateLimit(429, body)).toBe('per_day');
    }
  });

  it('CONSERVATIVE: an ambiguous 429 defaults to per_minute (wait, never wrongly stop)', () => {
    expect(classifyRateLimit(429, 'rate limit exceeded')).toBe('per_minute');
    expect(classifyRateLimit(429, '')).toBe('per_minute');
  });

  it('does not misread "per min" as a day limit', () => {
    expect(classifyRateLimit(429, 'Per min token limit exceeded')).toBe('per_minute');
  });
});

describe('LlmDailyLimitError', () => {
  it('carries status 429 + the daily marker', () => {
    const e = new LlmDailyLimitError('daily quota');
    expect(e.status).toBe(429);
    expect(e.isDailyLimit).toBe(true);
    expect(e.name).toBe('LlmDailyLimitError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('shared cool-down gate', () => {
  beforeEach(() => resetCooldown());

  it('starts clear', () => {
    expect(isCoolingDown(1000)).toBe(false);
    expect(getCooldownRemainingMs(1000)).toBe(0);
  });

  it('openCooldown freezes for waitMs; every reader sees the same window', () => {
    openCooldown(1000, 60000);
    expect(isCoolingDown(1000)).toBe(true);
    expect(getCooldownRemainingMs(30000)).toBe(31000);
    expect(getCooldownRemainingMs(61000)).toBe(0); // window elapsed
  });

  it('extends to the latest window, never shortens (concurrent 429s)', () => {
    openCooldown(1000, 60000); // until 61000
    openCooldown(2000, 10000); // until 12000 — shorter, must not shorten
    expect(getCooldownRemainingMs(2000)).toBe(59000); // still until 61000
  });
});
