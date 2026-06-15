/**
 * Pure unit tests for candidateEvidenceBuilder.ts +
 * codeDetectionEvidenceBuilder.ts.
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 1.1.
 *
 * Strict scope: pure module tests over the wrapper builder layer. No
 * React, no Testing Library, no API mocks, no `ArchitectureContext`.
 * The modules under test have no React, CSS, or API imports, so test
 * seams are not required.
 *
 * These tests assert composition + adapter semantics. The deeper per-
 * type field-coverage matrix (server-shape Spring Boot vs client-shape
 * vs interface bean vs sparse logical entity, etc.) lives in
 * `codeDetectionMappers.test.ts` (Spec 2) and is not duplicated here.
 *
 * Spec 7 (2026-05-11) Task Group 3.1 additions: assertions for the
 * Code Detection `confidenceImpactLabel` / `confidenceImpactReason`
 * population gate (only when `displayConfidence > baseConfidence`).
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import {
  buildCandidateEvidenceDetails,
  buildLogScansEvidenceSection,
  buildLlmReviewEvidenceSection,
} from '../candidateEvidenceBuilder';
import { buildCodeDetectionEvidenceSection } from '../codeDetectionEvidenceBuilder';
import type {
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
} from '../candidateEvidenceTypes';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeCandidate(
  candidateType: string,
  data: Record<string, unknown> = {},
  overrides: Partial<DiscoveryCandidateDto> = {}
): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: 'run-1',
    candidate_type: candidateType,
    name: 'Sample',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: ['src/main/java/Sample.java'],
    data,
    synthesized_at: '2026-05-10T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
    ...overrides,
  };
}

// Spec 7 fixture helpers
function makeMatched(
  overrides: Partial<MatchedRuntimeEvidence> = {}
): MatchedRuntimeEvidence {
  return {
    method: 'GET',
    codePathTemplate: '/owners/{ownerId}',
    normalizedLogPath: '/owners/123',
    observedUsageCount: 0,
    totalLogRequests: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    matchConfidence: 0.99,
    matchReason: 'exact match',
    ...overrides,
  };
}

function makeContext(
  byCandidateId: Map<string, { runtime: { matched: MatchedRuntimeEvidence } }>
): RuntimeEvidenceContext {
  return {
    byCandidateId,
    interfaceRollupByCandidateId: new Map(),
    logicalDataEntityRollupByCandidateId: new Map(),
    interfaceLogicalEntityRollupByCandidateId: new Map(),
  };
}

// ---------------------------------------------------------------------------
// buildCandidateEvidenceDetails — composition + identity
// ---------------------------------------------------------------------------

describe('buildCandidateEvidenceDetails', () => {
  it('returns an object containing candidateId, candidateType, and all three sections', () => {
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
      },
      { id: 'cand-42' }
    );

    const details = buildCandidateEvidenceDetails(candidate);

    expect(details.candidateId).toBe('cand-42');
    expect(details.candidateType).toBe('endpoints');
    expect(details.codeDetection).toBeDefined();
    expect(details.logScans).toBeDefined();
    expect(details.llmReview).toBeDefined();
  });

  it('carries candidate.candidate_type through unchanged for each of the four supported types', () => {
    const types = [
      'endpoints',
      'interfaces',
      'logical_data_entities',
      'interface_logical_entities',
    ];

    for (const type of types) {
      const details = buildCandidateEvidenceDetails(makeCandidate(type));
      expect(details.candidateType).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// buildLogScansEvidenceSection — exact placeholder shape
// ---------------------------------------------------------------------------

describe('buildLogScansEvidenceSection', () => {
  it('returns the EXACT placeholder shape', () => {
    const section = buildLogScansEvidenceSection(makeCandidate('endpoints'));

    expect(section).toEqual({
      title: 'Log Scans',
      status: 'not_available',
      summary: 'Log scan evidence was not found for this run.',
      fields: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildLlmReviewEvidenceSection — exact placeholder shape
// ---------------------------------------------------------------------------

describe('buildLlmReviewEvidenceSection', () => {
  it('returns the EXACT placeholder shape', () => {
    const section = buildLlmReviewEvidenceSection(makeCandidate('endpoints'));

    expect(section).toEqual({
      title: 'LLM Review',
      status: 'not_available',
      summary: 'No candidate-specific LLM review details are available yet.',
      fields: [],
    });
  });
});

// ---------------------------------------------------------------------------
// buildCodeDetectionEvidenceSection — populated case
// ---------------------------------------------------------------------------

describe('buildCodeDetectionEvidenceSection (populated)', () => {
  it('on a populated server-shape Spring Boot endpoint candidate returns status=available and populates reason/fields/detectedBy/sourceFiles from the Spec 2 mapper', () => {
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners/{ownerId}',
        controllerClassName: 'OwnerController',
        methodName: 'getOwner',
        responseType: 'OwnerDto',
      },
      { source_cluster_ids: ['src/main/java/OwnerController.java'] }
    );

    const section = buildCodeDetectionEvidenceSection(candidate);

    expect(section.title).toBe('Code Detection');
    expect(section.status).toBe('available');
    expect(section.reason).toBe(
      'Detected as a controller method exposed through framework route annotations.'
    );
    expect(section.detectedBy).toBe('Spring Boot Adapter');
    expect(section.sourceFiles).toEqual(['src/main/java/OwnerController.java']);
    // Field shape: at minimum HTTP method + Path + Controller + Handler method
    // come through verbatim from the Spec 2 mapper output.
    const labels = section.fields.map((f) => f.label);
    expect(labels).toContain('HTTP method');
    expect(labels).toContain('Path');
    expect(labels).toContain('Controller');
    expect(labels).toContain('Handler method');
    expect(labels).toContain('Response type');
  });

  it('does NOT set confidenceImpactLabel, confidenceImpactReason, or notes (deferred to Spec 7)', () => {
    const candidate = makeCandidate('endpoints', {
      _addedBy: 'spring-boot-adapter',
      httpMethod: 'GET',
      fullPath: '/owners',
      controllerClassName: 'OwnerController',
      methodName: 'list',
    });

    const section = buildCodeDetectionEvidenceSection(candidate);

    expect(section.confidenceImpactLabel).toBeUndefined();
    expect(section.confidenceImpactReason).toBeUndefined();
    expect(section.notes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildCodeDetectionEvidenceSection — sparse / not-available case
// ---------------------------------------------------------------------------

describe('buildCodeDetectionEvidenceSection (sparse)', () => {
  it('on a sparse candidate where the Spec 2 mapper sets isMostlyEmpty=true returns status=not_available', () => {
    // interface_logical_entities with no interfaceClassName / logicalEntityName
    // → Spec 2 mapper produces zero fields → isMostlyEmpty=true.
    const candidate = makeCandidate('interface_logical_entities', {});

    const section = buildCodeDetectionEvidenceSection(candidate);

    expect(section.status).toBe('not_available');
    expect(section.fields).toEqual([]);
  });

  it('still carries reason and detectedBy through even when status=not_available', () => {
    // Sparse interface_logical_entities — fields empty but reason should still
    // be the Spec 2 REASON_INTERFACE_LOGICAL constant.
    const candidate = makeCandidate('interface_logical_entities', {});

    const section = buildCodeDetectionEvidenceSection(candidate);

    expect(section.status).toBe('not_available');
    expect(section.reason).toBe(
      'Detected because interface code references this logical data entity.'
    );
    expect(section.detectedBy).toBe('deterministic code analysis');
  });
});

// ---------------------------------------------------------------------------
// buildCodeDetectionEvidenceSection — defensive default
// ---------------------------------------------------------------------------

describe('buildCodeDetectionEvidenceSection (defensive default)', () => {
  it('when the Spec 2 mapper hits its defensive default branch (unknown candidate type), status is not_available and reason is the Spec 2 default reason string', () => {
    // Unknown candidate_type → Spec 2 dispatcher's default branch returns
    // isMostlyEmpty=true with REASON_DEFAULT.
    const candidate = makeCandidate('unknown_type_not_in_allowlist', {});

    const section = buildCodeDetectionEvidenceSection(candidate);

    expect(section.status).toBe('not_available');
    expect(section.reason).toBe('Detected from deterministic code analysis.');
    expect(section.fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Composition wiring
// ---------------------------------------------------------------------------

describe('buildCandidateEvidenceDetails composition', () => {
  it('top-level composition wires the three section builders so a populated endpoint produces an available codeDetection section and not_available placeholders', () => {
    const candidate = makeCandidate('endpoints', {
      _addedBy: 'spring-boot-adapter',
      httpMethod: 'GET',
      fullPath: '/owners',
      controllerClassName: 'OwnerController',
      methodName: 'list',
    });

    const details = buildCandidateEvidenceDetails(candidate);

    expect(details.codeDetection.status).toBe('available');
    expect(details.codeDetection.title).toBe('Code Detection');

    expect(details.logScans.status).toBe('not_available');
    expect(details.logScans.title).toBe('Log Scans');
    expect(details.logScans.summary).toBe(
      'Log scan evidence was not found for this run.'
    );

    expect(details.llmReview.status).toBe('not_available');
    expect(details.llmReview.title).toBe('LLM Review');
    expect(details.llmReview.summary).toBe(
      'No candidate-specific LLM review details are available yet.'
    );
  });
});

// ---------------------------------------------------------------------------
// Spec 7 Task Group 3.1 — Code Detection impact-block population gate
// ---------------------------------------------------------------------------

describe('buildCodeDetectionEvidenceSection (Spec 7 impact block)', () => {
  it('does NOT set confidenceImpactLabel/Reason when displayConfidence === baseConfidence (no log uplift)', () => {
    // Adapter endpoint candidate WITH a runtime context that has NO entry
    // for this candidate id -> uplift is 0 -> displayConfidence ===
    // baseConfidence -> impact block must remain UNSET.
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
      },
      { id: 'cand-no-logs', confidence: 0.85 }
    );

    const ctx = makeContext(new Map()); // empty -> no uplift

    const section = buildCodeDetectionEvidenceSection(candidate, ctx);

    expect(section.confidenceImpactLabel).toBeUndefined();
    expect(section.confidenceImpactReason).toBeUndefined();
  });

  it('populates "Base confidence" + "Deterministic code adapter evidence." when displayConfidence > baseConfidence and _addedBy ends with -adapter', () => {
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
      },
      { id: 'cand-with-logs', confidence: 0.8 }
    );

    const ctx = makeContext(
      new Map([
        [
          'cand-with-logs',
          { runtime: { matched: makeMatched({ observedUsageCount: 1842 }) } },
        ],
      ])
    );

    const section = buildCodeDetectionEvidenceSection(candidate, ctx);

    expect(section.confidenceImpactLabel).toBe('Base confidence');
    expect(section.confidenceImpactReason).toBe(
      'Deterministic code adapter evidence.'
    );
  });

  it('populates "Base confidence" + "Initial LLM-derived confidence." when displayConfidence > baseConfidence and _addedBy = "llm-gap-fill"', () => {
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'llm-gap-fill',
        httpMethod: 'GET',
        fullPath: '/owners',
        controllerClassName: 'OwnerController',
        methodName: 'list',
      },
      { id: 'cand-llm-with-logs', confidence: 0.6 }
    );

    const ctx = makeContext(
      new Map([
        [
          'cand-llm-with-logs',
          { runtime: { matched: makeMatched({ observedUsageCount: 5 }) } },
        ],
      ])
    );

    const section = buildCodeDetectionEvidenceSection(candidate, ctx);

    expect(section.confidenceImpactLabel).toBe('Base confidence');
    expect(section.confidenceImpactReason).toBe(
      'Initial LLM-derived confidence.'
    );
  });
});
