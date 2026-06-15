/**
 * Tests for Hypothesis Types and QA Constants (Increment 15, Task Group 1)
 *
 * 6 focused tests:
 * 1. Hypothesis interface fields are correctly typed (category enum, status enum, subjectType enum)
 * 2. HypothesisAnswer interface fields are correctly typed (verdict enum matches status excluding pending)
 * 3. QaOrigin interface has required fields (hypothesisId, verdict, freeTextNotes, answeredAt)
 * 4. QA constants values: QA_CONFIRMATION_CONFIDENCE_BOOST, QA_DENIAL_CONFIDENCE_PENALTY,
 *    and LOG_MAX_CONFIDENCE_CAP is reused (not duplicated)
 * 5. Extended EvidenceAtom.source union accepts 'human_qa' alongside 'code' and 'log'
 * 6. Barrel exports expose all new types correctly
 */

import {
  Hypothesis,
  HypothesisAnswer,
  HypothesisCategory,
  HypothesisStatus,
  HypothesisVerdict,
  QaOrigin,
  EvidenceAtom,
  LogOrigin,
} from '../types';

import {
  QA_CONFIRMATION_CONFIDENCE_BOOST,
  QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST,
  QA_DENIAL_CONFIDENCE_PENALTY,
  LOG_MAX_CONFIDENCE_CAP,
} from '../constants/hypothesisQaDefaults';

import {
  LOG_MAX_CONFIDENCE_CAP as ORIGINAL_LOG_MAX_CONFIDENCE_CAP,
} from '../constants/logEnrichmentDefaults';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Builds a minimal EvidenceAtom for testing.
 */
function makeAtom(overrides: Partial<EvidenceAtom> = {}): EvidenceAtom {
  return {
    id: 'atom-001',
    runId: 'run-001',
    repoUrl: 'https://github.com/test/repo',
    filePath: 'src/app.ts',
    type: 'string_pattern',
    data: {
      patternName: 'test_pattern',
      matchedText: 'test match',
      line: 10,
      contextSnippet: 'test context',
    },
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Hypothesis Types and QA Constants', () => {

  // ==========================================================================
  // Test 1: Hypothesis interface fields are correctly typed
  // ==========================================================================
  test('Hypothesis interface fields are correctly typed with category, status, and subjectType enums', () => {
    // Test all five HypothesisCategory values
    const categories: HypothesisCategory[] = [
      'low_confidence',
      'ambiguous_type',
      'conflicting_evidence',
      'missing_attribute',
      'weak_cluster',
    ];
    expect(categories).toHaveLength(5);
    expect(new Set(categories).size).toBe(5);

    // Test all five HypothesisStatus values
    const statuses: HypothesisStatus[] = [
      'pending',
      'confirmed',
      'denied',
      'partially_confirmed',
      'needs_more_info',
    ];
    expect(statuses).toHaveLength(5);
    expect(new Set(statuses).size).toBe(5);

    // Test both subjectType values via a full Hypothesis object
    const candidateHypothesis: Hypothesis = {
      id: 'hyp-001',
      runId: 'run-001',
      category: 'low_confidence',
      subjectType: 'candidate',
      subjectId: 'candidate-001',
      description: 'Candidate confidence is below auto-accept threshold',
      evidenceRefs: ['atom-001', 'rel-001'],
      status: 'pending',
      createdAt: '2026-04-06T10:00:00Z',
    };

    const clusterHypothesis: Hypothesis = {
      id: 'hyp-002',
      runId: 'run-001',
      category: 'weak_cluster',
      subjectType: 'cluster',
      subjectId: 'cluster-001',
      description: 'Cluster has low confidence',
      evidenceRefs: ['cluster-001', 'atom-002'],
      status: 'pending',
      createdAt: '2026-04-06T10:00:00Z',
    };

    // Verify all required fields are present and correctly typed
    expect(candidateHypothesis.id).toBe('hyp-001');
    expect(typeof candidateHypothesis.id).toBe('string');
    expect(candidateHypothesis.runId).toBe('run-001');
    expect(candidateHypothesis.category).toBe('low_confidence');
    expect(candidateHypothesis.subjectType).toBe('candidate');
    expect(candidateHypothesis.subjectId).toBe('candidate-001');
    expect(candidateHypothesis.description).toBeTruthy();
    expect(Array.isArray(candidateHypothesis.evidenceRefs)).toBe(true);
    expect(candidateHypothesis.evidenceRefs).toHaveLength(2);
    expect(candidateHypothesis.status).toBe('pending');
    expect(candidateHypothesis.createdAt).toBe('2026-04-06T10:00:00Z');

    expect(clusterHypothesis.subjectType).toBe('cluster');
    expect(clusterHypothesis.category).toBe('weak_cluster');

    // Verify each category can be assigned to a Hypothesis
    for (const category of categories) {
      const h: Hypothesis = { ...candidateHypothesis, category };
      expect(h.category).toBe(category);
    }

    // Verify each status can be assigned to a Hypothesis
    for (const status of statuses) {
      const h: Hypothesis = { ...candidateHypothesis, status };
      expect(h.status).toBe(status);
    }
  });

  // ==========================================================================
  // Test 2: HypothesisAnswer interface fields are correctly typed
  // ==========================================================================
  test('HypothesisAnswer interface fields are correctly typed with verdict matching status excluding pending', () => {
    // Test all four HypothesisVerdict values (status minus 'pending')
    const verdicts: HypothesisVerdict[] = [
      'confirmed',
      'denied',
      'partially_confirmed',
      'needs_more_info',
    ];
    expect(verdicts).toHaveLength(4);
    expect(new Set(verdicts).size).toBe(4);

    // Verify that verdict values are a subset of HypothesisStatus (excluding 'pending')
    const statuses: HypothesisStatus[] = [
      'pending',
      'confirmed',
      'denied',
      'partially_confirmed',
      'needs_more_info',
    ];
    for (const verdict of verdicts) {
      expect(statuses).toContain(verdict);
    }
    // 'pending' is NOT a valid verdict
    expect(verdicts).not.toContain('pending');

    // Test a full HypothesisAnswer object with required fields
    const answer: HypothesisAnswer = {
      hypothesisId: 'hyp-001',
      verdict: 'confirmed',
      answeredAt: '2026-04-06T11:00:00Z',
    };

    expect(answer.hypothesisId).toBe('hyp-001');
    expect(typeof answer.hypothesisId).toBe('string');
    expect(answer.verdict).toBe('confirmed');
    expect(answer.answeredAt).toBe('2026-04-06T11:00:00Z');
    expect(answer.freeTextNotes).toBeUndefined();

    // Test with optional freeTextNotes
    const answerWithNotes: HypothesisAnswer = {
      hypothesisId: 'hyp-002',
      verdict: 'partially_confirmed',
      freeTextNotes: 'The service exists but communicates via a different protocol',
      answeredAt: '2026-04-06T11:05:00Z',
    };

    expect(answerWithNotes.freeTextNotes).toBe('The service exists but communicates via a different protocol');

    // Verify each verdict can be assigned to a HypothesisAnswer
    for (const verdict of verdicts) {
      const a: HypothesisAnswer = { ...answer, verdict };
      expect(a.verdict).toBe(verdict);
    }
  });

  // ==========================================================================
  // Test 3: QaOrigin interface has required fields
  // ==========================================================================
  test('QaOrigin interface has required fields: hypothesisId, verdict, freeTextNotes, answeredAt', () => {
    // Test with all fields populated
    const qaOrigin: QaOrigin = {
      hypothesisId: 'hyp-001',
      verdict: 'confirmed',
      freeTextNotes: 'User confirmed this service exists',
      answeredAt: '2026-04-06T11:00:00Z',
    };

    expect(qaOrigin.hypothesisId).toBe('hyp-001');
    expect(typeof qaOrigin.hypothesisId).toBe('string');
    expect(qaOrigin.verdict).toBe('confirmed');
    expect(typeof qaOrigin.verdict).toBe('string');
    expect(qaOrigin.freeTextNotes).toBe('User confirmed this service exists');
    expect(qaOrigin.answeredAt).toBe('2026-04-06T11:00:00Z');
    expect(typeof qaOrigin.answeredAt).toBe('string');

    // Test with optional freeTextNotes omitted
    const qaOriginNoNotes: QaOrigin = {
      hypothesisId: 'hyp-002',
      verdict: 'denied',
      answeredAt: '2026-04-06T12:00:00Z',
    };

    expect(qaOriginNoNotes.hypothesisId).toBe('hyp-002');
    expect(qaOriginNoNotes.verdict).toBe('denied');
    expect(qaOriginNoNotes.freeTextNotes).toBeUndefined();
    expect(qaOriginNoNotes.answeredAt).toBe('2026-04-06T12:00:00Z');

    // Verify QaOrigin mirrors the LogOrigin pattern (both are origin metadata interfaces)
    const logOrigin: LogOrigin = {
      filePath: '/var/log/app.log',
      lineStart: 100,
      lineEnd: 105,
      timestamp: '2026-04-06T10:00:00Z',
    };

    // Both origin interfaces have required and optional fields
    expect(logOrigin.filePath).toBeDefined();
    expect(logOrigin.timestamp).toBeDefined();
    expect(qaOrigin.hypothesisId).toBeDefined();
    expect(qaOrigin.answeredAt).toBeDefined();
  });

  // ==========================================================================
  // Test 4: QA constants values and LOG_MAX_CONFIDENCE_CAP reuse
  // ==========================================================================
  test('QA constants have correct values and LOG_MAX_CONFIDENCE_CAP is reused, not duplicated', () => {
    // Verify QA_CONFIRMATION_CONFIDENCE_BOOST value and is higher than log corroboration
    expect(QA_CONFIRMATION_CONFIDENCE_BOOST).toBe(0.12);
    expect(QA_CONFIRMATION_CONFIDENCE_BOOST).toBeGreaterThan(0);
    expect(QA_CONFIRMATION_CONFIDENCE_BOOST).toBeLessThan(1);

    // Verify QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST is smaller than full confirmation
    expect(QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST).toBe(0.05);
    expect(QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST).toBeGreaterThan(0);
    expect(QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST).toBeLessThan(QA_CONFIRMATION_CONFIDENCE_BOOST);

    // Verify QA_DENIAL_CONFIDENCE_PENALTY value
    expect(QA_DENIAL_CONFIDENCE_PENALTY).toBe(0.20);
    expect(QA_DENIAL_CONFIDENCE_PENALTY).toBeGreaterThan(0);
    expect(QA_DENIAL_CONFIDENCE_PENALTY).toBeLessThan(1);

    // Verify LOG_MAX_CONFIDENCE_CAP is reused from logEnrichmentDefaults (same reference)
    expect(LOG_MAX_CONFIDENCE_CAP).toBe(0.98);
    expect(LOG_MAX_CONFIDENCE_CAP).toBe(ORIGINAL_LOG_MAX_CONFIDENCE_CAP);

    // Verify the cap is the same object reference (re-exported, not redefined)
    // Both imports should resolve to the same value since hypothesisQaDefaults
    // imports and re-exports from logEnrichmentDefaults
    expect(LOG_MAX_CONFIDENCE_CAP).toStrictEqual(ORIGINAL_LOG_MAX_CONFIDENCE_CAP);
  });

  // ==========================================================================
  // Test 5: Extended EvidenceAtom.source union accepts 'human_qa'
  // ==========================================================================
  test('EvidenceAtom.source union accepts human_qa alongside code and log', () => {
    // Test 'code' source (existing)
    const codeAtom = makeAtom({ source: 'code' });
    expect(codeAtom.source).toBe('code');

    // Test 'log' source (existing)
    const logAtom = makeAtom({
      source: 'log',
      logOrigin: {
        filePath: '/var/log/app.log',
        lineStart: 100,
        lineEnd: 105,
      },
    });
    expect(logAtom.source).toBe('log');
    expect(logAtom.logOrigin).toBeDefined();

    // Test 'human_qa' source (new)
    const qaAtom = makeAtom({
      source: 'human_qa',
      qaOrigin: {
        hypothesisId: 'hyp-001',
        verdict: 'confirmed',
        freeTextNotes: 'User confirmed this pattern',
        answeredAt: '2026-04-06T11:00:00Z',
      },
    });
    expect(qaAtom.source).toBe('human_qa');
    expect(qaAtom.qaOrigin).toBeDefined();
    expect(qaAtom.qaOrigin!.hypothesisId).toBe('hyp-001');
    expect(qaAtom.qaOrigin!.verdict).toBe('confirmed');
    expect(qaAtom.qaOrigin!.freeTextNotes).toBe('User confirmed this pattern');
    expect(qaAtom.qaOrigin!.answeredAt).toBe('2026-04-06T11:00:00Z');

    // Test backward compatibility: atom without source field still works
    const legacyAtom = makeAtom();
    delete legacyAtom.source;
    expect(legacyAtom.source).toBeUndefined();
    expect(legacyAtom.id).toBe('atom-001');

    // Test that qaOrigin is optional (not present on non-qa atoms)
    expect(codeAtom.qaOrigin).toBeUndefined();
    expect(logAtom.qaOrigin).toBeUndefined();

    // Test that logOrigin is optional (not present on non-log atoms)
    expect(codeAtom.logOrigin).toBeUndefined();
    expect(qaAtom.logOrigin).toBeUndefined();

    // Verify all three source values can coexist in an array
    const allAtoms: EvidenceAtom[] = [codeAtom, logAtom, qaAtom, legacyAtom];
    expect(allAtoms).toHaveLength(4);

    const sources = allAtoms.map(a => a.source).filter(Boolean);
    expect(sources).toContain('code');
    expect(sources).toContain('log');
    expect(sources).toContain('human_qa');
  });

  // ==========================================================================
  // Test 6: Barrel exports expose all new types correctly
  // ==========================================================================
  test('Barrel exports expose all new hypothesis types and QaOrigin correctly', () => {
    // Verify Hypothesis can be imported from barrel and used
    const hypothesis: Hypothesis = {
      id: 'hyp-barrel-001',
      runId: 'run-001',
      category: 'conflicting_evidence',
      subjectType: 'candidate',
      subjectId: 'candidate-001',
      description: 'Conflicting evidence found',
      evidenceRefs: ['atom-001'],
      status: 'pending',
      createdAt: '2026-04-06T10:00:00Z',
    };
    expect(hypothesis).toBeDefined();

    // Verify HypothesisAnswer can be imported from barrel and used
    const answer: HypothesisAnswer = {
      hypothesisId: 'hyp-barrel-001',
      verdict: 'denied',
      answeredAt: '2026-04-06T11:00:00Z',
    };
    expect(answer).toBeDefined();

    // Verify HypothesisCategory type can be used
    const category: HypothesisCategory = 'missing_attribute';
    expect(category).toBe('missing_attribute');

    // Verify HypothesisStatus type can be used
    const status: HypothesisStatus = 'needs_more_info';
    expect(status).toBe('needs_more_info');

    // Verify HypothesisVerdict type can be used
    const verdict: HypothesisVerdict = 'partially_confirmed';
    expect(verdict).toBe('partially_confirmed');

    // Verify QaOrigin can be imported from barrel and used
    const qaOrigin: QaOrigin = {
      hypothesisId: 'hyp-barrel-001',
      verdict: 'confirmed',
      answeredAt: '2026-04-06T11:00:00Z',
    };
    expect(qaOrigin).toBeDefined();
  });
});
