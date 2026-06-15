/**
 * Tests for the gap-fill LLM-output cache.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 3.
 *
 * Pins:
 *   1. identical (normalized-prompt, model, temperature) -> same key;
 *   2. a changed prompt / model / temperature is a cache MISS (different key);
 *   3. the `temperature: 0` (W2) value PARTICIPATES in the key;
 *   4. comment/whitespace-only prompt changes do NOT bust the key (normalized);
 *   5. END-TO-END through `runLlmGapFill`: a second file with a byte-identical
 *      composed prompt is served from cache -- the relay mock is NOT invoked
 *      again (no LLM call on a hit) and the prior response is reused.
 *
 * Eviction / TTL / concurrency are explicitly OUT of scope (per the spec).
 */

// Mock the gateway client BEFORE importing the module under test so the relay
// is a jest mock we can assert call-counts against.
jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    gapFill: jest.fn(),
  },
  GapFillGatewayError: class GapFillGatewayError extends Error {
    public readonly filePath: string;
    public readonly status: number | null;
    constructor(message: string, filePath: string, status: number | null) {
      super(message);
      this.name = 'GapFillGatewayError';
      this.filePath = filePath;
      this.status = status;
    }
  },
}));

import { gatewayClient } from '../services/gatewayClient';
import { runLlmGapFill, GapFillStepInput } from '../services/llmGapFillStep';
import {
  GapFillResponseCache,
  computeGapFillCacheKey,
  GAP_FILL_RELAY_TEMPERATURE,
  readGapFillCacheModel,
} from '../services/gapFillResponseCache';

const gapFillMock = gatewayClient.gapFill as jest.Mock;

beforeEach(() => {
  gapFillMock.mockReset();
  delete process.env.GAP_FILL_SKIP_THRESHOLD;
  delete process.env.GAP_FILL_CONCURRENCY;
  delete process.env.GAP_FILL_MAX_FAILURE_RATE;
  delete process.env.GAP_FILL_SKIP_SIGNALS;
  delete process.env.GAP_FILL_CACHE_MODEL;
});

// ============================================================================
// Key construction
// ============================================================================
describe('computeGapFillCacheKey — key construction', () => {
  const base = { prompt: 'analyze this file X', model: 'model-a', temperature: 0 };

  it('identical (prompt, model, temperature) -> identical key', () => {
    expect(computeGapFillCacheKey(base)).toBe(computeGapFillCacheKey({ ...base }));
  });

  it('a changed PROMPT is a different key (MISS)', () => {
    expect(computeGapFillCacheKey({ ...base, prompt: 'analyze this OTHER file' })).not.toBe(
      computeGapFillCacheKey(base),
    );
  });

  it('a changed MODEL is a different key (MISS)', () => {
    expect(computeGapFillCacheKey({ ...base, model: 'model-b' })).not.toBe(
      computeGapFillCacheKey(base),
    );
  });

  it('TEMPERATURE participates in the key — a different temperature is a MISS', () => {
    // The W2 temperature is 0; prove a non-zero temperature yields a different key.
    expect(computeGapFillCacheKey({ ...base, temperature: 0.7 })).not.toBe(
      computeGapFillCacheKey({ ...base, temperature: GAP_FILL_RELAY_TEMPERATURE }),
    );
    // And W2's 0 is the value the cache uses by default.
    expect(GAP_FILL_RELAY_TEMPERATURE).toBe(0);
  });

  it('comment/whitespace-only prompt changes do NOT bust the key (normalized)', () => {
    const a = 'analyze   this // a comment\n file';
    const b = 'analyze this /* block */ file';
    expect(
      computeGapFillCacheKey({ prompt: a, model: 'm', temperature: 0 }),
    ).toBe(computeGapFillCacheKey({ prompt: b, model: 'm', temperature: 0 }));
  });
});

// ============================================================================
// Cache instance get/set + hit/miss accounting
// ============================================================================
describe('GapFillResponseCache — get/set + hit/miss counters', () => {
  it('a second get on a stored key is a HIT returning the prior response', () => {
    const cache = new GapFillResponseCache();
    const key = cache.keyFor('p', readGapFillCacheModel(), GAP_FILL_RELAY_TEMPERATURE);
    expect(cache.get(key)).toBeUndefined(); // MISS
    cache.set(key, { content: '[{"reused":true}]' });
    const hit = cache.get(key); // HIT
    expect(hit?.content).toBe('[{"reused":true}]');
    expect(cache.hitCount).toBe(1);
    expect(cache.missCount).toBe(1);
  });
});

// ============================================================================
// End-to-end through runLlmGapFill: hit reuses, NO second relay call
// ============================================================================
describe('runLlmGapFill — cache hit reuses prior response with no relay call', () => {
  function fileWithPrompt(filePath: string): GapFillStepInput['files'][number] {
    // Tier C unclassifiable file with empty pack output -> always PROCEEDs (not
    // skipped). Identical sourceCode/tier/language/pack across two files yields a
    // byte-identical composed prompt (the composer is prompt-path deterministic),
    // so the SECOND file's relay call is served from the cache.
    return {
      filePath,
      sourceCode: 'class Example { void doThing() {} }',
      tier: 'C',
      language: null,
      frameworkPackId: null,
      packCandidates: [],
      ir: null,
    };
  }

  it('two files with a byte-identical prompt call the relay ONCE; the second is a cache hit', async () => {
    gapFillMock.mockResolvedValue({
      content: JSON.stringify([
        { type: 'service', name: 'CachedService', filePath: 'a.ts', confidence: 0.8 },
      ]),
    });

    // Force concurrency 1 so the two files run sequentially -- the first
    // populates the cache before the second runs (the test asserts the no-LLM
    // reuse path, not concurrent racing, which is out of scope).
    process.env.GAP_FILL_CONCURRENCY = '1';

    const input: GapFillStepInput = {
      runId: 'run-cache-1',
      files: [fileWithPrompt('a.ts'), fileWithPrompt('a.ts')],
    };

    const out = await runLlmGapFill(input);

    // The relay was called exactly ONCE -- the second file was a cache hit.
    expect(gapFillMock).toHaveBeenCalledTimes(1);
    // The stage still completed and produced candidates (the reused response was
    // parsed for the cached file too).
    expect(out.stageStatus).toBe('completed');
    expect(out.failures).toHaveLength(0);
  });

  it('a DIFFERENT prompt is a cache miss -> the relay is called for each', async () => {
    gapFillMock.mockResolvedValue({
      content: JSON.stringify([
        { type: 'service', name: 'S', filePath: 'x.ts', confidence: 0.8 },
      ]),
    });
    process.env.GAP_FILL_CONCURRENCY = '1';

    const fileA = fileWithPrompt('a.ts');
    const fileB = { ...fileWithPrompt('b.ts'), sourceCode: 'class Different { void other() {} }' };

    await runLlmGapFill({ runId: 'run-cache-2', files: [fileA, fileB] });

    // Distinct prompts -> two relay calls (no reuse).
    expect(gapFillMock).toHaveBeenCalledTimes(2);
  });
});
