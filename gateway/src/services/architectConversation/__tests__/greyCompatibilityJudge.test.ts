/**
 * Tests — Grey-area compatibility LLM-judge (code-pre-filter-then-LLM, fail-open)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 3.
 *
 * Per tasks.md §3.1 — 2-8 focused tests covering:
 *   - Happy path is NEVER an LLM call (deterministic matrix resolves everything).
 *   - A genuinely grey candidate => the injected ArchitectLlmClient IS called
 *     and its keep/hide verdict is honoured.
 *   - Fail-open: judge throws / returns malformed => the FULL residue is kept.
 *   - Every adjudication logs input + keep/hide output (asserted via logger spy).
 *
 * The LLM is mocked at the `callSingleShot` boundary; the deterministic matrix
 * + branch-lists are the REAL Task Group 2 data.
 */

import type {
  ArchitectLlmClient,
  CallSingleShotResponse,
  SingleShotPrompt,
} from '../architectLlmClient';
import {
  GreyCompatibilityJudgeDeps,
  adjudicateGreyQuestion,
  defaultGreyCompatibilityJudgeDeps,
} from '../greyCompatibilityJudge';
import { logger } from '../../logger';

jest.mock('../../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(
  singleShotImpl: (prompt: SingleShotPrompt) => Promise<CallSingleShotResponse>,
): { deps: GreyCompatibilityJudgeDeps; calls: SingleShotPrompt[] } {
  const calls: SingleShotPrompt[] = [];
  const llmClient: ArchitectLlmClient = {
    callLlmToolLoop: async () => {
      throw new Error('callLlmToolLoop must not be used by the grey judge');
    },
    callSingleShot: async (prompt) => {
      calls.push(prompt);
      return singleShotImpl(prompt);
    },
  };
  return { deps: { llmClient }, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1 — Happy path is NEVER an LLM call.
// ---------------------------------------------------------------------------

describe('adjudicateGreyQuestion — deterministic happy path', () => {
  it('does NOT invoke the LLM when the deterministic matrix resolves every candidate', async () => {
    // logging.framework under Python: every candidate is clear-cut
    // (structlog keep; SLF4J/pino/zap/Log4j hide) per the real matrix.
    const { deps, calls } = makeDeps(async () => {
      throw new Error('LLM must not be called on the deterministic happy path');
    });

    const result = await adjudicateGreyQuestion(
      {
        questionCode: 'logging.framework',
        candidates: ['SLF4J + Logback JSON', 'Log4j 2', 'pino', 'structlog', 'zap'],
        foundationalAnswers: { 'service.language': 'Python 3.12' },
      },
      deps,
    );

    expect(calls).toHaveLength(0);
    expect(result.llmInvoked).toBe(false);
    expect(result.kept).toEqual(['structlog']);
    expect(result.hidden).toEqual(
      expect.arrayContaining(['SLF4J + Logback JSON', 'Log4j 2', 'pino', 'zap']),
    );
    // Every verdict came from the deterministic matrix.
    expect(result.verdicts.every((v) => v.source === 'deterministic')).toBe(true);
  });

  it('logs every deterministic adjudication (input + keep/hide outcome)', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error('LLM must not be called');
    });

    await adjudicateGreyQuestion(
      {
        questionCode: 'logging.framework',
        candidates: ['structlog', 'pino'],
        foundationalAnswers: { 'service.language': 'Python 3.12' },
      },
      deps,
    );

    // structlog kept, pino hidden — both logged with code + candidate + verdict.
    expect(logger.debug).toHaveBeenCalledWith(
      'grey-judge: deterministic verdict',
      expect.objectContaining({
        questionCode: 'logging.framework',
        candidate: 'structlog',
        verdict: 'keep',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'grey-judge: deterministic verdict',
      expect.objectContaining({
        questionCode: 'logging.framework',
        candidate: 'pino',
        verdict: 'hide',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Genuinely grey residue => LLM IS called and honoured.
// ---------------------------------------------------------------------------

describe('adjudicateGreyQuestion — grey residue escalates to the LLM', () => {
  it('invokes the injected LLM for an undecided candidate and honours its keep/hide verdict', async () => {
    // ui.designSystem under a non-React framework: MUI / Chakra / Ant Design are
    // `undecided` per the real matrix (genuinely grey), so they reach the LLM.
    const { deps, calls } = makeDeps(async () => ({
      content: JSON.stringify({
        verdicts: [
          { candidate: 'MUI 6', verdict: 'hide' },
          { candidate: 'Chakra v3', verdict: 'keep' },
          { candidate: 'Ant Design 5', verdict: 'hide' },
        ],
      }),
    }));

    const result = await adjudicateGreyQuestion(
      {
        questionCode: 'ui.designSystem',
        candidates: [
          'MUI 6',
          'Ant Design 5',
          'Chakra v3',
          'Tailwind + headless components',
          'in-house',
        ],
        foundationalAnswers: { 'ui.framework': 'Angular 17' },
      },
      deps,
    );

    expect(calls).toHaveLength(1);
    expect(result.llmInvoked).toBe(true);
    // Tailwind + in-house are deterministic keeps; the LLM decided the rest.
    expect(result.kept).toEqual(
      expect.arrayContaining([
        'Chakra v3',
        'Tailwind + headless components',
        'in-house',
      ]),
    );
    expect(result.hidden).toEqual(
      expect.arrayContaining(['MUI 6', 'Ant Design 5']),
    );
    // The honoured residue verdicts are tagged llm-judge.
    const mui = result.verdicts.find((v) => v.candidate === 'MUI 6');
    expect(mui).toEqual({ candidate: 'MUI 6', verdict: 'hide', source: 'llm-judge' });

    // The grey adjudication is logged with input + outcome.
    expect(logger.debug).toHaveBeenCalledWith(
      'grey-judge: llm verdict',
      expect.objectContaining({
        questionCode: 'ui.designSystem',
        candidate: 'MUI 6',
        verdict: 'hide',
        source: 'llm-judge',
      }),
    );
  });

  it('only sends the undecided residue to the LLM, never the deterministic keeps', async () => {
    const { deps, calls } = makeDeps(async () => ({
      content: JSON.stringify({ verdicts: [{ candidate: 'MUI 6', verdict: 'keep' }] }),
    }));

    await adjudicateGreyQuestion(
      {
        questionCode: 'ui.designSystem',
        candidates: ['MUI 6', 'Tailwind + headless components', 'in-house'],
        foundationalAnswers: { 'ui.framework': 'Vue 3' },
      },
      deps,
    );

    // The prompt body lists ONLY the residue (MUI 6), not the deterministic keeps.
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain('MUI 6');
    expect(calls[0].user).not.toContain('Tailwind + headless components');
    expect(calls[0].user).not.toContain('in-house');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Fail-open on any LLM failure/malformation.
// ---------------------------------------------------------------------------

describe('adjudicateGreyQuestion — fail-open', () => {
  it('keeps the FULL residue when the LLM throws', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error('provider unavailable');
    });

    const result = await adjudicateGreyQuestion(
      {
        questionCode: 'ui.designSystem',
        candidates: ['MUI 6', 'Ant Design 5', 'Chakra v3'],
        foundationalAnswers: { 'ui.framework': 'Angular 17' },
      },
      deps,
    );

    expect(result.llmInvoked).toBe(true);
    // Every candidate offered (fail-open) — nothing hidden.
    expect(result.hidden).toEqual([]);
    expect(result.kept).toEqual(
      expect.arrayContaining(['MUI 6', 'Ant Design 5', 'Chakra v3']),
    );
    expect(result.failOpenReason).toMatch(/failed open/i);
    expect(result.verdicts.filter((v) => v.source === 'fail-open')).toHaveLength(3);
    // The fail-open is logged with the reason.
    expect(logger.warn).toHaveBeenCalledWith(
      'grey-judge: failing open for grey residue',
      expect.objectContaining({ questionCode: 'ui.designSystem' }),
    );
  });

  it('keeps a residue candidate the LLM omitted from a malformed/partial response', async () => {
    // Malformed payload (not the expected shape) => parse returns null => fail-open.
    const { deps } = makeDeps(async () => ({ content: 'not json at all {' }));

    const result = await adjudicateGreyQuestion(
      {
        questionCode: 'ui.designSystem',
        candidates: ['MUI 6', 'Chakra v3'],
        foundationalAnswers: { 'ui.framework': 'Angular 17' },
      },
      deps,
    );

    expect(result.hidden).toEqual([]);
    expect(result.kept).toEqual(expect.arrayContaining(['MUI 6', 'Chakra v3']));
    expect(result.failOpenReason).toMatch(/malformed/i);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Default deps never silently call an unconfigured LLM.
// ---------------------------------------------------------------------------

describe('defaultGreyCompatibilityJudgeDeps', () => {
  it('does not touch the throwing default LLM on the deterministic happy path', async () => {
    // No deps passed => default deps used. Every candidate is clear-cut, so the
    // throwing default LLM is never reached.
    const result = await adjudicateGreyQuestion({
      questionCode: 'interservice.retryStrategy',
      candidates: ['Resilience4j defaults', 'exponential w/ jitter', 'none-fail-fast'],
      foundationalAnswers: { 'service.language': 'Go 1.22' },
    });

    expect(result.llmInvoked).toBe(false);
    // Resilience4j is JVM-only => hidden under Go; the rest kept.
    expect(result.hidden).toEqual(['Resilience4j defaults']);
    expect(result.kept).toEqual(
      expect.arrayContaining(['exponential w/ jitter', 'none-fail-fast']),
    );
  });

  it('the default deps LLM throws if ever invoked (guards accidental happy-path calls)', async () => {
    await expect(
      defaultGreyCompatibilityJudgeDeps.llmClient.callSingleShot({
        system: 's',
        user: 'u',
      }),
    ).rejects.toThrow(/no real ArchitectLlmClient/);
  });
});
