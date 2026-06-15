/**
 * Tests for Log Corroboration Confidence Boost (Increment 14, Task Group 5)
 *
 * 3 focused tests (originally 4; test 3 removed because it used
 * triageCandidateProposals from the removed candidateTriageEngine):
 * 1. A relationship with at least one `source: "log"` contributing atom
 *    gets confidence boosted by LOG_CORROBORATION_CONFIDENCE_BOOST
 * 2. Confidence is capped at LOG_MAX_CONFIDENCE_CAP (does not exceed 0.98)
 * 3. logEnrichment metadata is computed correctly for candidates with log atoms
 *    (enriched: true, logAtomCount, signalSummary)
 */

import { triageCandidates } from '../services/triageEngine';
import {
  computeLogEnrichmentForCandidate,
  buildLookupMaps,
} from '../services/logEnrichmentMetadata';
import {
  CandidateRelationship,
  EvidenceAtom,
  EvidenceCluster,
  ImportsRelationshipData,
} from '../types';
import {
  LOG_CORROBORATION_CONFIDENCE_BOOST,
  LOG_MAX_CONFIDENCE_CAP,
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
      patternName: 'endpoint_usage_log',
      matchedText: 'GET /api/users',
      line: 10,
      contextSnippet: 'GET /api/users',
    },
    extractedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Builds a minimal CandidateRelationship for testing.
 */
function makeRelationship(overrides: Partial<CandidateRelationship> = {}): CandidateRelationship {
  const defaultData: ImportsRelationshipData = {
    importStatement: "import { foo } from './module'",
    line: 1,
    isDefault: false,
  };
  return {
    sourceAtomId: 'atom-001',
    targetAtomId: 'atom-002',
    relationshipType: 'imports',
    confidence: 0.85,
    data: defaultData,
    ruleId: 'imports-by-pattern',
    ...overrides,
  };
}

/**
 * Builds a minimal EvidenceCluster for testing.
 */
function makeCluster(overrides: Partial<EvidenceCluster> = {}): EvidenceCluster {
  return {
    id: 'cluster-001',
    runId: 'run-001',
    clusterType: 'service_boundary',
    confidence: 0.7,
    members: [
      { memberType: 'atom', memberId: 'atom-001' },
      { memberType: 'atom', memberId: 'atom-002' },
    ],
    data: {},
    formedAt: new Date().toISOString(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Log Corroboration Confidence Boost', () => {

  // ==========================================================================
  // Test 1: A relationship with at least one source: "log" contributing atom
  //          gets confidence boosted by LOG_CORROBORATION_CONFIDENCE_BOOST
  // ==========================================================================
  test('relationship with log-sourced contributing atom gets confidence boosted', () => {
    const logAtom = makeAtom({ id: 'atom-log-001', source: 'log' });
    const codeAtom = makeAtom({ id: 'atom-code-001', source: 'code' });

    const relationship = makeRelationship({
      sourceAtomId: 'atom-log-001',
      targetAtomId: 'atom-code-001',
      confidence: 0.85,
    });

    const atoms = [logAtom, codeAtom];
    const result = triageCandidates([relationship], atoms);

    // The relationship should be in the accepted bucket (0.85 >= 0.8 threshold)
    expect(result.accepted).toHaveLength(1);

    // Confidence should be boosted by LOG_CORROBORATION_CONFIDENCE_BOOST (0.10)
    // 0.85 + 0.10 = 0.95
    expect(result.accepted[0].confidence).toBeCloseTo(0.85 + LOG_CORROBORATION_CONFIDENCE_BOOST, 10);
    expect(result.accepted[0].confidence).toBeCloseTo(0.95, 10);
  });

  // ==========================================================================
  // Test 2: Confidence is capped at LOG_MAX_CONFIDENCE_CAP (0.98)
  // ==========================================================================
  test('confidence is capped at LOG_MAX_CONFIDENCE_CAP and does not exceed 0.98', () => {
    const logAtom = makeAtom({ id: 'atom-log-001', source: 'log' });
    const codeAtom = makeAtom({ id: 'atom-code-001' });

    // Relationship with very high confidence (0.95)
    // After boost: 0.95 + 0.10 = 1.05 -- should be capped at 0.98
    const relationship = makeRelationship({
      sourceAtomId: 'atom-log-001',
      targetAtomId: 'atom-code-001',
      confidence: 0.95,
    });

    const atoms = [logAtom, codeAtom];
    const result = triageCandidates([relationship], atoms);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].confidence).toBe(LOG_MAX_CONFIDENCE_CAP);
    expect(result.accepted[0].confidence).toBe(0.98);
    // Explicitly verify it does NOT exceed the cap
    expect(result.accepted[0].confidence).toBeLessThanOrEqual(LOG_MAX_CONFIDENCE_CAP);
  });

  // ==========================================================================
  // Test 3: logEnrichment metadata is computed correctly for candidates
  //          with log atoms (enriched: true, logAtomCount, signalSummary)
  // ==========================================================================
  test('logEnrichment metadata is computed correctly for candidates with log atoms', () => {
    // Create log atoms from different extractors
    const endpointAtom1 = makeAtom({
      id: 'log-atom-001',
      source: 'log',
      data: {
        patternName: 'endpoint_usage_log',
        matchedText: 'GET /api/users',
        line: 10,
        contextSnippet: 'GET /api/users',
      },
    });
    const endpointAtom2 = makeAtom({
      id: 'log-atom-002',
      source: 'log',
      data: {
        patternName: 'endpoint_usage_log',
        matchedText: 'POST /api/orders',
        line: 20,
        contextSnippet: 'POST /api/orders',
      },
    });
    const endpointAtom3 = makeAtom({
      id: 'log-atom-003',
      source: 'log',
      data: {
        patternName: 'endpoint_usage_log',
        matchedText: 'DELETE /api/users/1',
        line: 30,
        contextSnippet: 'DELETE /api/users/1',
      },
    });
    const errorAtom1 = makeAtom({
      id: 'log-atom-004',
      source: 'log',
      data: {
        patternName: 'error_trace_log',
        matchedText: 'NullPointerException',
        line: 50,
        contextSnippet: 'Caused by: NullPointerException',
      },
    });
    const errorAtom2 = makeAtom({
      id: 'log-atom-005',
      source: 'log',
      data: {
        patternName: 'error_trace_log',
        matchedText: 'IOException',
        line: 60,
        contextSnippet: 'Caused by: IOException',
      },
    });
    const codeAtom = makeAtom({
      id: 'code-atom-001',
      source: 'code',
      data: {
        patternName: 'api_endpoint',
        matchedText: '/api/users',
        line: 5,
        contextSnippet: 'app.get("/api/users")',
      },
    });

    const cluster = makeCluster({
      id: 'cluster-001',
      members: [
        { memberType: 'atom', memberId: 'log-atom-001' },
        { memberType: 'atom', memberId: 'log-atom-002' },
        { memberType: 'atom', memberId: 'log-atom-003' },
        { memberType: 'atom', memberId: 'log-atom-004' },
        { memberType: 'atom', memberId: 'log-atom-005' },
        { memberType: 'atom', memberId: 'code-atom-001' },
      ],
    });

    const allAtoms = [endpointAtom1, endpointAtom2, endpointAtom3, errorAtom1, errorAtom2, codeAtom];
    const { clusterMap, atomMap } = buildLookupMaps([cluster], allAtoms);

    // Compute logEnrichment for a candidate referencing cluster-001
    const metadata = computeLogEnrichmentForCandidate(['cluster-001'], clusterMap, atomMap);

    expect(metadata.enriched).toBe(true);
    expect(metadata.logAtomCount).toBe(5); // 3 endpoint + 2 error log atoms
    expect(metadata.signalSummary).toContain('3 endpoint hits observed');
    expect(metadata.signalSummary).toContain('2 error traces matched');

    // Also verify the no-log-atoms case
    const clusterCodeOnly = makeCluster({
      id: 'cluster-code',
      members: [
        { memberType: 'atom', memberId: 'code-atom-001' },
      ],
    });

    const { clusterMap: codeClusterMap, atomMap: codeAtomMap } = buildLookupMaps(
      [clusterCodeOnly],
      [codeAtom]
    );

    const noLogMetadata = computeLogEnrichmentForCandidate(
      ['cluster-code'],
      codeClusterMap,
      codeAtomMap
    );

    expect(noLogMetadata.enriched).toBe(false);
    expect(noLogMetadata.logAtomCount).toBe(0);
    expect(noLogMetadata.signalSummary).toBe('');
  });
});
