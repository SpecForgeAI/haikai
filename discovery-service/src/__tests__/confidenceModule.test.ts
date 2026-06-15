/**
 * Tests for the centralized confidence module.
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 2.
 *
 * These tests cover the guarantees other pipeline modules rely on:
 *  - Default midpoints per tag family.
 *  - Env-override precedence.
 *  - Preservation of explicit adapter / LLM confidence values (clamp only
 *    when outside the tag's valid range).
 *  - Unknown tag handling (neutral 0.5 + single warn per process).
 */

import {
  CONFIDENCE_DEFAULTS,
  CONFIDENCE_RANGES,
  getConfidenceForTag,
  __resetConfidenceWarningsForTests,
} from '../services/confidence';

describe('confidence module', () => {
  const ENV_KEYS = [
    'CONFIDENCE_ADAPTER',
    'CONFIDENCE_LLM_GAP_FILL',
    'CONFIDENCE_LLM_IR_GUIDED',
    'CONFIDENCE_LLM_SOLO',
  ] as const;

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    __resetConfidenceWarningsForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('returns the midpoint defaults for each tag family', () => {
    // Framework-adapter tags match by "-adapter" suffix.
    expect(getConfidenceForTag('spring-classic-adapter')).toBe(
      CONFIDENCE_DEFAULTS.adapter,
    );
    expect(getConfidenceForTag('django-adapter')).toBe(0.9);

    expect(getConfidenceForTag('llm-gap-fill')).toBe(0.75);
    expect(getConfidenceForTag('llm-ir-guided')).toBe(0.6);
    expect(getConfidenceForTag('llm-solo')).toBe(0.4);
  });

  it('preserves an adapter-emitted confidence when inside the adapter range', () => {
    // Adapters often emit values in [0.85, 0.95]; we must not overwrite.
    expect(getConfidenceForTag('spring-classic-adapter', 0.88)).toBe(0.88);
    expect(getConfidenceForTag('flask-adapter', 0.95)).toBe(0.95);
  });

  it('clamps explicit currentValue values outside the tag range', () => {
    // adapter range is [0.85, 0.95].
    expect(getConfidenceForTag('spring-classic-adapter', 0.5)).toBe(0.85);
    expect(getConfidenceForTag('spring-classic-adapter', 0.99)).toBe(0.95);

    // llm-gap-fill range is [0.7, 0.8].
    expect(getConfidenceForTag('llm-gap-fill', 0.2)).toBe(0.7);
    expect(getConfidenceForTag('llm-gap-fill', 0.9)).toBe(0.8);

    // Explicit LLM-emitted confidence inside range is preserved.
    expect(getConfidenceForTag('llm-ir-guided', 0.55)).toBe(0.55);
  });

  it('applies env overrides when CONFIDENCE_* env vars are set and valid', () => {
    process.env.CONFIDENCE_ADAPTER = '0.92';
    process.env.CONFIDENCE_LLM_GAP_FILL = '0.77';
    process.env.CONFIDENCE_LLM_IR_GUIDED = '0.65';
    process.env.CONFIDENCE_LLM_SOLO = '0.35';

    expect(getConfidenceForTag('django-adapter')).toBe(0.92);
    expect(getConfidenceForTag('llm-gap-fill')).toBe(0.77);
    expect(getConfidenceForTag('llm-ir-guided')).toBe(0.65);
    expect(getConfidenceForTag('llm-solo')).toBe(0.35);
  });

  it('falls back to the compile-time default when env override is invalid', () => {
    process.env.CONFIDENCE_LLM_SOLO = 'not-a-number';
    expect(getConfidenceForTag('llm-solo')).toBe(CONFIDENCE_DEFAULTS['llm-solo']);

    process.env.CONFIDENCE_LLM_SOLO = '1.5'; // out of [0, 1]
    expect(getConfidenceForTag('llm-solo')).toBe(CONFIDENCE_DEFAULTS['llm-solo']);
  });

  it('returns neutral 0.5 and warns exactly once per unknown tag', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(getConfidenceForTag('mystery-source')).toBe(0.5);
    expect(getConfidenceForTag('mystery-source')).toBe(0.5);
    expect(getConfidenceForTag('mystery-source')).toBe(0.5);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('mystery-source');

    // A different unknown tag emits its own warn.
    getConfidenceForTag('other-unknown');
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('exposes tag ranges that align with midpoint defaults', () => {
    // Guard against future tweaks to one constant without the other.
    for (const key of ['adapter', 'llm-gap-fill', 'llm-ir-guided', 'llm-solo'] as const) {
      const [min, max] = CONFIDENCE_RANGES[key];
      const mid = CONFIDENCE_DEFAULTS[key];
      expect(mid).toBeGreaterThanOrEqual(min);
      expect(mid).toBeLessThanOrEqual(max);
    }
  });
});
