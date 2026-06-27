/**
 * Tests — Runtime choice filter (hide-incompatible + "Other (advanced)" +
 * answer-driven skip-moot + seed/filter reconciliation)
 * Spec 2026-06-24-target-conversation-tech-stack-constraints, Task Group 4.
 *
 * Per tasks.md §4.1 — 2-8 focused tests covering:
 *   - Incompatible choices are HIDDEN (Java 21 => service.framework excludes
 *     FastAPI), not merely warned.
 *   - `Other (advanced)` is ALWAYS appended to a filtered question.
 *   - Skip-moot: a question moot given prior answers is auto-skipped
 *     (api.contractFormat moot when no protocol chosen), reusing the
 *     not-applicable / system-skip reason shape.
 *   - Seed/filter coexistence: a cascades-seeded default that is a member of the
 *     filtered set is preserved; one filtered out falls back to the
 *     recommended/first-compatible choice (and the fallback is logged).
 *
 * The deterministic branch-lists + matrix are the REAL Task Group 2 data; the
 * grey LLM-judge boundary is mocked where exercised.
 */

import type { ArchitectLlmClient } from '../architectLlmClient';
import type { GreyCompatibilityJudgeDeps } from '../greyCompatibilityJudge';
import {
  OTHER_ADVANCED_CHOICE,
  evaluateAnswerDrivenRelevance,
  filterChoices,
  isOtherAdvanced,
  reconcileSeed,
} from '../choiceFilter';
import {
  QUESTION_LIBRARY,
  type QuestionLibraryEntry,
  type RelevanceContext,
} from '../../../config/architect-conversation/questionLibrary';
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

function entryByCode(code: string): QuestionLibraryEntry {
  const e = QUESTION_LIBRARY.find((x) => x.code === code);
  if (!e) throw new Error(`missing test fixture: ${code}`);
  return e;
}

/** Deps whose LLM throws — proves the deterministic/hard path never awaits it. */
const NO_LLM_DEPS: GreyCompatibilityJudgeDeps = {
  llmClient: {
    callLlmToolLoop: async () => {
      throw new Error('callLlmToolLoop must not be used');
    },
    callSingleShot: async () => {
      throw new Error('LLM must not be called on the hard-dependent path');
    },
  } as ArchitectLlmClient,
};

const ALL_TIERS_PRESENT: RelevanceContext = {
  hasUiTier: true,
  hasServiceTier: true,
  hasPersistenceTier: true,
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1 — Incompatible choices are HIDDEN (LOCKED Java-21 worked example).
// ---------------------------------------------------------------------------

describe('filterChoices — hide-incompatible (hard-dependent)', () => {
  it('Java 21 narrows service.framework to JVM-only and HIDES FastAPI/NestJS/Gin/ASP.NET', async () => {
    const result = await filterChoices(
      {
        entry: entryByCode('service.framework'),
        foundationalAnswers: { 'service.language': 'Java 21' },
      },
      NO_LLM_DEPS,
    );

    // FastAPI (and the other non-JVM frameworks) are removed from the offered set.
    expect(result.offered).not.toContain('FastAPI');
    expect(result.offered).not.toContain('NestJS');
    expect(result.offered).not.toContain('Gin');
    expect(result.offered).not.toContain('ASP.NET');
    expect(result.hidden).toEqual(
      expect.arrayContaining(['FastAPI', 'NestJS', 'Gin', 'ASP.NET']),
    );
    // The JVM frameworks survive.
    expect(result.offered).toEqual(
      expect.arrayContaining(['Spring Boot', 'Quarkus', 'Micronaut']),
    );
    expect(result.filtered).toBe(true);
    expect(result.llmInvoked).toBe(false);

    // Every hidden choice is logged (no silent drops).
    expect(logger.debug).toHaveBeenCalledWith(
      'choice-filter: hid incompatible choice',
      expect.objectContaining({
        questionCode: 'service.framework',
        value: 'FastAPI',
      }),
    );
  });

  it('an unrecognised foundational answer offers the FULL set, fail-open (no sentinel)', async () => {
    const result = await filterChoices(
      {
        entry: entryByCode('service.framework'),
        foundationalAnswers: { 'service.language': 'COBOL 85 (Other)' },
      },
      NO_LLM_DEPS,
    );
    expect(result.filtered).toBe(false);
    expect(result.hidden).toEqual([]);
    expect(result.offered).not.toContain(OTHER_ADVANCED_CHOICE);
    expect(result.offered).toContain('FastAPI');
  });

  it('independent questions are never filtered and get no escape hatch', async () => {
    const result = await filterChoices(
      {
        entry: entryByCode('cutover.strategy'),
        foundationalAnswers: { 'service.language': 'Java 21' },
      },
      NO_LLM_DEPS,
    );
    expect(result.filtered).toBe(false);
    expect(result.offered).not.toContain(OTHER_ADVANCED_CHOICE);
    expect(result.offered).toEqual([...entryByCode('cutover.strategy').choices!]);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — "Other (advanced)" is ALWAYS appended to a filtered question.
// ---------------------------------------------------------------------------

describe('filterChoices — "Other (advanced)" escape hatch', () => {
  it('appends the escape hatch sentinel whenever the set was narrowed', async () => {
    const result = await filterChoices(
      {
        entry: entryByCode('service.framework'),
        foundationalAnswers: { 'service.language': 'TypeScript/Node 20' },
      },
      NO_LLM_DEPS,
    );
    // Node => only NestJS survives; the sentinel is appended as the last option.
    expect(result.filtered).toBe(true);
    expect(result.offered[result.offered.length - 1]).toBe(OTHER_ADVANCED_CHOICE);
    expect(isOtherAdvanced(result.offered[result.offered.length - 1])).toBe(true);
    expect(result.offered).toContain('NestJS');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Answer-driven skip-moot.
// ---------------------------------------------------------------------------

describe('evaluateAnswerDrivenRelevance — answer-driven moot-skip', () => {
  it('skips api.contractFormat when no api.protocol was chosen (moot), reusing the not-applicable reason', () => {
    const outcome = evaluateAnswerDrivenRelevance(
      entryByCode('api.contractFormat'),
      ALL_TIERS_PRESENT,
      {
        /* no api.protocol answer */
      },
    );
    expect(outcome.relevant).toBe(false);
    if (!outcome.relevant) {
      expect(outcome.cause).toBe('answer-moot');
      expect(outcome.reason).toContain('api.contractFormat');
      expect(outcome.reason).toMatch(/auto-skipped/);
    }
    expect(logger.debug).toHaveBeenCalledWith(
      'choice-filter: question moot given prior answers; auto-skipping',
      expect.objectContaining({ questionCode: 'api.contractFormat' }),
    );
  });

  it('asks api.contractFormat normally once a protocol IS chosen', () => {
    const outcome = evaluateAnswerDrivenRelevance(
      entryByCode('api.contractFormat'),
      ALL_TIERS_PRESENT,
      { 'api.protocol': ['REST/JSON'] },
    );
    expect(outcome.relevant).toBe(true);
  });

  it('preserves the existing tier-gated skip (additive): UI-tier absent still skips a Group E question', () => {
    const outcome = evaluateAnswerDrivenRelevance(
      entryByCode('ui.buildTool'),
      { ...ALL_TIERS_PRESENT, hasUiTier: false },
      {},
    );
    expect(outcome.relevant).toBe(false);
    if (!outcome.relevant) {
      expect(outcome.cause).toBe('tier');
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Seed <-> filter reconciliation (coexistence).
// ---------------------------------------------------------------------------

describe('reconcileSeed — seed/filter coexistence', () => {
  it('preserves a seeded default that is a member of the filtered set', () => {
    const r = reconcileSeed({
      questionCode: 'service.framework',
      seedValue: 'Spring Boot 3.4',
      filteredChoices: ['Spring Boot 3.4', 'Quarkus 3', 'Micronaut 4', OTHER_ADVANCED_CHOICE],
    });
    expect(r.value).toBe('Spring Boot 3.4');
    expect(r.preserved).toBe(true);
    expect(r.substituted).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('falls back to the recommended/first-compatible choice when the seed was filtered out, and logs it', () => {
    const r = reconcileSeed({
      questionCode: 'service.framework',
      // Seed proposes FastAPI but the architect chose Java 21 => FastAPI hidden.
      seedValue: 'FastAPI 0.115',
      filteredChoices: ['Spring Boot 3.4', 'Quarkus 3', 'Micronaut 4', OTHER_ADVANCED_CHOICE],
      recommended: 'Quarkus 3',
    });
    // Recommended is a member => it wins; the sentinel is never auto-selected.
    expect(r.value).toBe('Quarkus 3');
    expect(r.preserved).toBe(false);
    expect(r.substituted).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'choice-filter: cascades seed filtered out; substituting fallback',
      expect.objectContaining({
        questionCode: 'service.framework',
        originalSeed: 'FastAPI 0.115',
        substituted: 'Quarkus 3',
      }),
    );
  });

  it('falls back to the FIRST compatible choice when no recommended is supplied', () => {
    const r = reconcileSeed({
      questionCode: 'service.framework',
      seedValue: 'FastAPI 0.115',
      filteredChoices: ['Spring Boot 3.4', 'Quarkus 3', OTHER_ADVANCED_CHOICE],
    });
    expect(r.value).toBe('Spring Boot 3.4');
    expect(r.substituted).toBe(true);
  });
});
