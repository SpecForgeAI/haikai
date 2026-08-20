/**
 * Task Group 5 — LLM recipe induction + held-out validation + bounded retries
 * + persistence-shape reuse.
 *
 * Pins the load-bearing behaviours from tasks.md 5.1 (the relay is ALWAYS a
 * mock; no test hits a real LLM):
 *   1. Accept by threshold: a recipe extracting method+path from >=60% of the
 *      request-like lines in a HELD-OUT block is accepted.
 *   2. Reject by threshold: <60% held-out yield is rejected.
 *   3. Retry budget: weak yield re-samples up to 2 retries; a HARD cap of 3 LLM
 *      calls per file is never exceeded (asserted on the mock relay call count).
 *   4. Fallback on "no pattern": a "no pattern" response (or exhausted retries)
 *      returns the deterministic-fallback signal.
 *   5. Recipe persistence + fingerprint reuse: a persisted recipe keyed by
 *      format-fingerprint is reused on a same-fingerprint re-run WITHOUT another
 *      LLM call.
 */

import {
  induceAndValidateRecipe,
  validateRecipeAgainstBlock,
  computeFormatFingerprint,
  fingerprintFromBlocks,
  upsertRecipeIntoStore,
  lookupReusableRecipe,
  composeRecipePrompt,
  MAX_LLM_CALLS_PER_FILE,
  HELD_OUT_ACCEPT_FRACTION,
  type LogRecipe,
  type LogRecipeRelay,
  type RecipeStore,
} from '../logRecipeInduction';
import type { SampleBlock } from '../logPreScanSampler';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

/**
 * Build a sample block from raw text. Line indices are cosmetic for these
 * tests (validation/fingerprint operate on `text`).
 */
function block(text: string, startLineIndex = 0): SampleBlock {
  const lineCount = text.split('\n').length;
  return {
    hitLineIndex: startLineIndex,
    byteOffset: startLineIndex * 80,
    startLineIndex,
    endLineIndex: startLineIndex + lineCount - 1,
    text,
    fromFallbackWindow: false,
  };
}

/** A SampleSvc-style multi-line block: a request-start line per record + body. */
function samplesvcBlock(ids: number[], startLineIndex = 0): SampleBlock {
  const text = ids
    .map(
      (id) =>
        `${id} > POST http://svc:8080/api/orders/${id}\n${id} > content-type: application/json\n${id} >\n${id} > {"item":"widget","qty":2}`,
    )
    .join('\n');
  return block(text, startLineIndex);
}

/** A recipe that correctly reads the SampleSvc shape (method+path load-bearing). */
const LEGACYAPP_RECIPE_JSON = JSON.stringify({
  recordDelimiter: { kind: 'start_regex', pattern: '^\\d+ > [A-Z]+ ' },
  fields: {
    method: { kind: 'regex', pattern: '^\\d+ > ([A-Z]+) ' },
    path: { kind: 'regex', pattern: '^\\d+ > [A-Z]+ https?://[^/]+(/\\S+)' },
    requestHeaders: { kind: 'line_regex', pattern: '^\\d+ > ([a-z-]+): (.+)$', captureKeyValue: true },
    requestBody: { kind: 'regex', pattern: '(\\{.*\\})' },
  },
});

/** A recipe that matches nothing useful (method ok, path never matches). */
const BAD_RECIPE_JSON = JSON.stringify({
  recordDelimiter: { kind: 'start_regex', pattern: '^\\d+ > [A-Z]+ ' },
  fields: {
    method: { kind: 'regex', pattern: '^\\d+ > ([A-Z]+) ' },
    // Path rule requires a literal "/NEVER_MATCHES" segment -> 0% yield.
    path: { kind: 'regex', pattern: '(/NEVER_MATCHES_[a-z]+)' },
  },
});

/** A relay mock that returns a fixed sequence of contents, counting calls. */
function makeRelay(contents: string[]): LogRecipeRelay & { calls: number } {
  let i = 0;
  return {
    calls: 0,
    async induceLogRecipe() {
      this.calls += 1;
      const content = i < contents.length ? contents[i] : contents[contents.length - 1];
      i += 1;
      return { content };
    },
  };
}

// ----------------------------------------------------------------------------
// 1 + 2: held-out validation threshold (accept >=60%, reject <60%)
// ----------------------------------------------------------------------------

describe('logRecipeInduction — held-out validation threshold', () => {
  it('accepts a recipe extracting method+path from >=60% of request-like lines', async () => {
    const blocks = [samplesvcBlock([1, 2, 3], 0), samplesvcBlock([4, 5, 6], 100)];
    const relay = makeRelay([LEGACYAPP_RECIPE_JSON]);

    const result = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-1',
      sourceFilePath: '/logs/app.log',
    });

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.recipe.validationYield).toBeGreaterThanOrEqual(HELD_OUT_ACCEPT_FRACTION);
      expect(result.recipe.fields.method).toBeDefined();
      expect(result.recipe.fields.path).toBeDefined();
      expect(result.recipe.fingerprint).toMatch(/^fmt_/);
    }
    expect(relay.calls).toBe(1);
  });

  it('rejects a recipe whose held-out method+path yield is below 60%', async () => {
    const blocks = [samplesvcBlock([1, 2, 3], 0), samplesvcBlock([4, 5, 6], 100)];
    const relay = makeRelay([BAD_RECIPE_JSON]); // every attempt returns the same bad recipe

    const result = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-2',
      sourceFilePath: '/logs/app.log',
    });

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.reason).toBe('validation_failed_exhausted');
    }
  });

  it('validateRecipeAgainstBlock returns the method+path yield fraction directly', () => {
    const held = samplesvcBlock([10, 11, 12, 13, 14]); // 5 request-like lines
    const goodRecipe = JSON.parse(LEGACYAPP_RECIPE_JSON);
    const yieldGood = validateRecipeAgainstBlock(goodRecipe, held.text);
    expect(yieldGood).toBeGreaterThanOrEqual(HELD_OUT_ACCEPT_FRACTION);

    const badRecipe = JSON.parse(BAD_RECIPE_JSON);
    const yieldBad = validateRecipeAgainstBlock(badRecipe, held.text);
    expect(yieldBad).toBeLessThan(HELD_OUT_ACCEPT_FRACTION);
  });
});

// ----------------------------------------------------------------------------
// 3: bounded retry budget (max 3 LLM calls/file)
// ----------------------------------------------------------------------------

describe('logRecipeInduction — bounded retry budget', () => {
  it('re-samples on weak yield but never exceeds MAX_LLM_CALLS_PER_FILE', async () => {
    // Three blocks so the held-out rotation truly differs per attempt; every
    // attempt returns a recipe that fails validation -> retries until the cap.
    const blocks = [samplesvcBlock([1, 2], 0), samplesvcBlock([3, 4], 50), samplesvcBlock([5, 6], 100)];
    const relay = makeRelay([BAD_RECIPE_JSON, BAD_RECIPE_JSON, BAD_RECIPE_JSON, BAD_RECIPE_JSON]);

    const result = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-3',
      sourceFilePath: '/logs/app.log',
    });

    expect(MAX_LLM_CALLS_PER_FILE).toBe(3);
    expect(relay.calls).toBe(MAX_LLM_CALLS_PER_FILE);
    expect(relay.calls).toBeLessThanOrEqual(MAX_LLM_CALLS_PER_FILE);
    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.llmCallsUsed).toBe(MAX_LLM_CALLS_PER_FILE);
    }
  });

  it('accepts on a later attempt without exceeding the cap (first weak, second good)', async () => {
    const blocks = [samplesvcBlock([1, 2], 0), samplesvcBlock([3, 4], 50), samplesvcBlock([5, 6], 100)];
    const relay = makeRelay([BAD_RECIPE_JSON, LEGACYAPP_RECIPE_JSON]);

    const result = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-3b',
      sourceFilePath: '/logs/app.log',
    });

    expect(result.status).toBe('accepted');
    expect(relay.calls).toBe(2);
    expect(relay.calls).toBeLessThanOrEqual(MAX_LLM_CALLS_PER_FILE);
  });
});

// ----------------------------------------------------------------------------
// 4: fallback on "no pattern" / malformed
// ----------------------------------------------------------------------------

describe('logRecipeInduction — fallback signals', () => {
  it('returns the deterministic-fallback signal on an explicit "no pattern" reply', async () => {
    const blocks = [samplesvcBlock([1, 2, 3], 0), samplesvcBlock([4, 5, 6], 100)];
    const relay = makeRelay(['no pattern']);

    const result = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-4',
      sourceFilePath: '/logs/app.log',
    });

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.reason).toBe('no_pattern');
    }
    // "no pattern" is definitive -> only one call spent (no needless retries).
    expect(relay.calls).toBe(1);
  });

  it('returns a fallback signal when there are no samples to induce from', async () => {
    const relay = makeRelay([LEGACYAPP_RECIPE_JSON]);
    const result = await induceAndValidateRecipe({
      blocks: [],
      relay,
      runId: 'run-4b',
      sourceFilePath: '/logs/app.log',
    });
    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.reason).toBe('no_samples');
    }
    expect(relay.calls).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// 5: persistence shape + fingerprint reuse (no further LLM call)
// ----------------------------------------------------------------------------

describe('logRecipeInduction — persistence shape + fingerprint reuse', () => {
  it('computes a stable fingerprint for same-format inputs and a different one otherwise', () => {
    // Same format, different ids -> identical fingerprint (digits collapsed).
    const a = computeFormatFingerprint(['7 > POST http://svc:8080/api/orders/7']);
    const b = computeFormatFingerprint(['99 > POST http://svc:8080/api/orders/99']);
    expect(a).toBe(b);

    // Genuinely different shape -> different fingerprint.
    const c = computeFormatFingerprint(['GET /api/users 200']);
    expect(c).not.toBe(a);
  });

  it('reuses a persisted recipe by fingerprint on a same-fingerprint re-run WITHOUT another LLM call', async () => {
    const blocks = [samplesvcBlock([1, 2, 3], 0), samplesvcBlock([4, 5, 6], 100)];
    const relay = makeRelay([LEGACYAPP_RECIPE_JSON]);

    // First run: induce + persist into an in-memory steps_payload recipe store.
    const first = await induceAndValidateRecipe({
      blocks,
      relay,
      runId: 'run-5',
      sourceFilePath: '/logs/app.log',
    });
    expect(first.status).toBe('accepted');
    if (first.status !== 'accepted') return;
    expect(relay.calls).toBe(1);

    let store: RecipeStore = upsertRecipeIntoStore(undefined, first.recipe);

    // Re-run on byte-identical-format blocks: the orchestrator (TG7) would
    // compute the fingerprint and look it up BEFORE calling the relay. Prove
    // the lookup hits so no second LLM call is needed.
    const reRunBlocks = [samplesvcBlock([7, 8, 9], 0), samplesvcBlock([10, 11, 12], 100)];
    const fingerprint = fingerprintFromBlocks(reRunBlocks);
    expect(fingerprint).toBe(first.recipe.fingerprint);

    const reused = lookupReusableRecipe(store, fingerprint, `file:/logs/app.log`);
    expect(reused).not.toBeNull();
    expect(reused?.fingerprint).toBe(first.recipe.fingerprint);

    // The relay was used exactly once across both runs (reuse skipped the LLM).
    expect(relay.calls).toBe(1);
  });

  it('upsert stores the recipe under BOTH fingerprint and per-source-file keys; lookup falls back to the file key', () => {
    const recipe: LogRecipe = {
      recordDelimiter: { kind: 'single_line' },
      fields: {
        method: { kind: 'regex', pattern: '([A-Z]+)' },
        path: { kind: 'regex', pattern: '(/\\S+)' },
      },
      fingerprint: 'fmt_deadbeef',
      sourceFileKey: 'file:/logs/app.log',
      validationYield: 0.9,
      llmCallsUsed: 1,
      origin: 'llm_induction',
    };
    const store = upsertRecipeIntoStore(undefined, recipe);
    expect(store['fmt_deadbeef']).toBe(recipe);
    expect(store['file:/logs/app.log']).toBe(recipe);

    // Fingerprint miss but file-key hit.
    expect(lookupReusableRecipe(store, 'fmt_other', 'file:/logs/app.log')).toBe(recipe);
    // Total miss.
    expect(lookupReusableRecipe(store, 'fmt_other', 'file:/other.log')).toBeNull();
  });

  it('composeRecipePrompt embeds ONLY block.text (the sampler-redacted content)', () => {
    const b = block('123 > POST http://svc/api/orders\n123 > {"x":1}');
    const prompt = composeRecipePrompt([b]);
    expect(prompt).toContain('123 > POST http://svc/api/orders');
    // The prompt instructs strict-JSON + the "no pattern" sentinel contract.
    expect(prompt).toContain('no pattern');
    expect(prompt).toContain('recordDelimiter');
  });
});
