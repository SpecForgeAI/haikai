/**
 * Tests for the per-source FindingEmitInput builders + the evidence-gap
 * scanner. These verify the SHAPE of each v1 emission (Sources A, B, C,
 * D, E, F, H) and assert that Source G (`unsupported_pattern`) is NOT
 * emitted anywhere in v1 (D4 -- deferred).
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 5.
 */

import {
  buildLowConfidenceCandidateFinding,
  buildUnresolvedDecisionTaskFinding,
  buildCandidateConflictFinding,
  buildUnmatchedRuntimeEndpointFinding,
  buildRuntimeUsageObservationFinding,
  buildUnusedCodeEndpointFinding,
  buildAmbiguousRelationshipFinding,
  buildEvidenceGapFinding,
  buildDeferredSurfacePresentFinding,
} from '../services/findings/emissionSources';
import { scanForEvidenceGaps } from '../services/findings/evidenceGapScanner';
import type { DiscoveryCandidate } from '../types/candidate';

// -----------------------------------------------------------------------------
// Source A: low_confidence_candidate
// -----------------------------------------------------------------------------
describe('Source A: low_confidence_candidate', () => {
  it('emits finding_type=low_confidence_candidate / category=ambiguity with candidate link', () => {
    const finding = buildLowConfidenceCandidateFinding({
      candidateId: 'C-1',
      candidateName: 'OrderService',
      candidateType: 'service',
      confidence: 0.42,
    });
    expect(finding.findingType).toBe('low_confidence_candidate');
    expect(finding.category).toBe('ambiguity');
    // [AMBIGUOUS_THRESHOLD=0.4, AUTO=0.8): 0.42 -> 'medium'
    expect(finding.severity).toBe('medium');
    expect(finding.confidence).toBe(0.42);
    expect(finding.source).toBe('pipeline_triage');
    expect(finding.createdByStage).toBe('discoveryV3Pipeline.postMerge.lowConfidence');
    const candidateLink = finding.links?.find((l) => l.targetType === 'discovery_candidate');
    expect(candidateLink?.targetId).toBe('C-1');
  });

  it("yields 'low' severity when confidence is below AMBIGUOUS_THRESHOLD", () => {
    const f = buildLowConfidenceCandidateFinding({
      candidateId: 'C-2',
      candidateName: 'OrderService',
      candidateType: 'service',
      confidence: 0.2,
    });
    expect(f.severity).toBe('low');
  });

  it('includes derived_from evidence links when provided', () => {
    const f = buildLowConfidenceCandidateFinding({
      candidateId: 'C-3',
      candidateName: 'Foo',
      candidateType: 'service',
      confidence: 0.5,
      supportingEvidenceIds: ['E-1', 'E-2'],
    });
    const ev = f.links?.filter((l) => l.targetType === 'discovery_evidence');
    expect(ev?.map((l) => l.targetId)).toEqual(['E-1', 'E-2']);
  });
});

// -----------------------------------------------------------------------------
// Source B: unresolved_decision_task
// -----------------------------------------------------------------------------
describe('Source B: unresolved_decision_task', () => {
  it('emits finding_type=unresolved_decision_task / severity=medium with decision-task link', () => {
    const f = buildUnresolvedDecisionTaskFinding({
      decisionTaskId: 'DT-1',
      taskType: 'resolve_competing_relationships',
      relatedCandidateIds: ['C-1', 'C-2'],
    });
    expect(f.findingType).toBe('unresolved_decision_task');
    expect(f.category).toBe('ambiguity');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe('triageEngine.decisionTaskCreation');
    const taskLink = f.links?.find((l) => l.targetType === 'discovery_decision_task');
    expect(taskLink?.targetId).toBe('DT-1');
    const candLinks = f.links?.filter((l) => l.targetType === 'discovery_candidate');
    expect(candLinks?.map((l) => l.targetId)).toEqual(['C-1', 'C-2']);
  });
});

// -----------------------------------------------------------------------------
// Source C: candidate_conflict (both pipeline-dedup + triage-competing variants)
// -----------------------------------------------------------------------------
describe('Source C: candidate_conflict', () => {
  it('pipeline-dedup variant emits finding_type=candidate_conflict / severity=medium', () => {
    const f = buildCandidateConflictFinding({
      conflictingCandidateIds: ['C-A', 'C-B'],
      conflictDescription: "Duplicate candidates 'Foo' and 'Foo '",
      stage: 'discoveryV3Pipeline.dedup',
    });
    expect(f.findingType).toBe('candidate_conflict');
    expect(f.category).toBe('ambiguity');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe('discoveryV3Pipeline.dedup');
    expect(f.source).toBe('pipeline_dedup');
    expect(f.links?.map((l) => l.targetId)).toEqual(['C-A', 'C-B']);
  });

  it('triage-competing variant distinguishes itself via createdByStage', () => {
    const f = buildCandidateConflictFinding({
      conflictingCandidateIds: ['C-X', 'C-Y', 'C-Z'],
      conflictDescription: 'Competing relationships at anchor X',
      stage: 'triageEngine.competingRelationships',
    });
    expect(f.findingType).toBe('candidate_conflict');
    expect(f.createdByStage).toBe('triageEngine.competingRelationships');
    expect(f.source).toBe('pipeline_triage');
  });
});

// -----------------------------------------------------------------------------
// Source D: unmatched_runtime_endpoint
// -----------------------------------------------------------------------------
describe('Source D: unmatched_runtime_endpoint', () => {
  it('emits finding_type=unmatched_runtime_endpoint / category=runtime_usage', () => {
    const f = buildUnmatchedRuntimeEndpointFinding({
      method: 'GET',
      pathTemplate: '/api/legacy/{id}',
      observedUsageCount: 50,
      status2xxCount: 48,
      status3xxCount: 2,
    });
    expect(f.findingType).toBe('unmatched_runtime_endpoint');
    expect(f.category).toBe('runtime_usage');
    expect(f.severity).toBe('medium'); // <100
    expect(f.createdByStage).toBe('runtimeEvidence.endpointRuntimeMatcher');
    expect(f.source).toBe('runtime_log_enrichment');
  });

  it('uses high severity when observedUsageCount >= 100', () => {
    const f = buildUnmatchedRuntimeEndpointFinding({
      method: 'POST',
      pathTemplate: '/api/heavy',
      observedUsageCount: 500,
      status2xxCount: 495,
      status3xxCount: 5,
    });
    expect(f.severity).toBe('high');
  });
});

// -----------------------------------------------------------------------------
// Source D extension: unused_code_endpoint (no-usage case)
// Spec 2026-05-16 Wire Java/Spring/Maven Findings (D2). This shape covers
// the code-endpoint-present / no-runtime-hits case that the predecessor
// Source D builder did not emit (only the inverse: runtime-hits / no
// code-endpoint). The same source / category vocabulary is reused so the
// Findings tab filter dropdowns continue to work.
// -----------------------------------------------------------------------------
describe('Source D extension: unused_code_endpoint (no-usage)', () => {
  it('existing unmatched_runtime_endpoint builder still emits unchanged (regression guard)', () => {
    const f = buildUnmatchedRuntimeEndpointFinding({
      method: 'GET',
      pathTemplate: '/legacy/{id}',
      observedUsageCount: 5,
      status2xxCount: 5,
      status3xxCount: 0,
    });
    // Source D existing emission shape MUST be preserved -- finding_type,
    // category, source, createdByStage all unchanged.
    expect(f.findingType).toBe('unmatched_runtime_endpoint');
    expect(f.category).toBe('runtime_usage');
    expect(f.source).toBe('runtime_log_enrichment');
    expect(f.createdByStage).toBe('runtimeEvidence.endpointRuntimeMatcher');
  });

  it('emits finding_type=unused_code_endpoint / severity=info / usage_count=0', () => {
    const f = buildUnusedCodeEndpointFinding({
      candidateId: 'C-ep-no-usage',
      method: 'GET',
      pathTemplate: '/api/old',
    });
    expect(f.findingType).toBe('unused_code_endpoint');
    expect(f.category).toBe('runtime_usage');
    expect(f.severity).toBe('info');
    expect(f.source).toBe('runtime_log_enrichment');
    expect(f.createdByStage).toBe('runtimeEvidence.runDiscoveryRuntimeEvidence');
    const detail = f.detailJson as Record<string, unknown>;
    expect(detail.codeEndpointMethod).toBe('GET');
    expect(detail.codeEndpointPath).toBe('/api/old');
    expect(detail.usageCount).toBe(0);
    expect(typeof detail.note).toBe('string');
    const candLink = f.links?.find((l) => l.targetType === 'discovery_candidate');
    expect(candLink?.targetId).toBe('C-ep-no-usage');
  });

  it('reuses the same source/createdByStage vocabulary as Source D (and matches Source E for createdByStage)', () => {
    // The new finding type lives under the same 
    // source as the existing Source D + E emissions so the Findings-tab
    // source filter continues to scope correctly.
    const unmatched = buildUnmatchedRuntimeEndpointFinding({
      method: 'GET', pathTemplate: '/x', observedUsageCount: 1, status2xxCount: 1, status3xxCount: 0,
    });
    const unused = buildUnusedCodeEndpointFinding({
      candidateId: 'C-1', method: 'GET', pathTemplate: '/x',
    });
    expect(unmatched.source).toBe(unused.source);
  });

  it('produces a dedupe-stable shape (same args -> identical title + primary link)', () => {
    // The FindingEmitter dedupe key is (runId | findingType | category | title |
    // primaryLinkedTarget). For the same args, the builder MUST produce a
    // shape that yields the same title and same primary link, so the
    // emitter dedupe collapses repeated emissions in the same run.
    const a = buildUnusedCodeEndpointFinding({
      candidateId: 'C-1', method: 'GET', pathTemplate: '/api/old',
    });
    const b = buildUnusedCodeEndpointFinding({
      candidateId: 'C-1', method: 'GET', pathTemplate: '/api/old',
    });
    expect(a.title).toBe(b.title);
    const aLink = a.links?.find((l) => l.targetType === 'discovery_candidate');
    const bLink = b.links?.find((l) => l.targetType === 'discovery_candidate');
    expect(aLink?.targetId).toBe(bLink?.targetId);
  });
});

// -----------------------------------------------------------------------------
// Source E: runtime_usage_observation
// -----------------------------------------------------------------------------
describe('Source E: runtime_usage_observation', () => {
  it('emits finding_type=runtime_usage_observation / severity=info with candidate link', () => {
    const f = buildRuntimeUsageObservationFinding({
      candidateId: 'C-ep-1',
      method: 'GET',
      pathTemplate: '/api/users',
      observedUsageCount: 1234,
    });
    expect(f.findingType).toBe('runtime_usage_observation');
    expect(f.category).toBe('runtime_usage');
    expect(f.severity).toBe('info');
    expect(f.createdByStage).toBe('runtimeEvidence.runDiscoveryRuntimeEvidence');
    const candLink = f.links?.find((l) => l.targetType === 'discovery_candidate');
    expect(candLink?.targetId).toBe('C-ep-1');
  });
});

// -----------------------------------------------------------------------------
// Source F: ambiguous_relationship
// -----------------------------------------------------------------------------
describe('Source F: ambiguous_relationship', () => {
  it('emits finding_type=ambiguous_relationship / category=ambiguity with candidate links', () => {
    const f = buildAmbiguousRelationshipFinding({
      relationshipDescription: 'imports from atom-1 to (atom-2|atom-3)',
      confidence: 0.45,
      competingTargetCandidateIds: ['C-2', 'C-3'],
      sourceEvidenceId: 'E-1',
      ruleId: 'importsByPatternRule',
    });
    expect(f.findingType).toBe('ambiguous_relationship');
    expect(f.category).toBe('ambiguity');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe(
      'triageEngine.competingRelationships.importsByPatternRule',
    );
    const candLinks = f.links?.filter((l) => l.targetType === 'discovery_candidate');
    expect(candLinks?.map((l) => l.targetId).sort()).toEqual(['C-2', 'C-3']);
    const evLink = f.links?.find((l) => l.targetType === 'discovery_evidence');
    expect(evLink?.targetId).toBe('E-1');
  });
});

// -----------------------------------------------------------------------------
// Source H: evidence_gap (builder + scanner)
// -----------------------------------------------------------------------------
describe('Source H: evidence_gap', () => {
  it('builder emits finding_type=evidence_gap / severity=medium with candidate link', () => {
    const f = buildEvidenceGapFinding({
      candidateId: 'C-1',
      candidateName: 'GET /api/users',
      gapType: 'endpoint_missing_response_schema',
      gapDescription: 'No response schema attached',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('medium');
    expect(f.createdByStage).toBe('findings.evidenceGapScanner');
    expect(f.detailJson).toEqual({ gapType: 'endpoint_missing_response_schema' });
  });

  it('scanner flags endpoint without responseSchema', () => {
    const c: DiscoveryCandidate = {
      id: 'C-ep',
      runId: 'r1',
      candidateType: 'endpoints',
      name: 'GET /api/x',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    const out = scanForEvidenceGaps([c]);
    expect(out).toHaveLength(1);
    expect(out[0].findingType).toBe('evidence_gap');
    expect(out[0].detailJson).toEqual({ gapType: 'endpoint_missing_response_schema' });
  });

  it('scanner does NOT flag endpoint when responseSchema present', () => {
    const c: DiscoveryCandidate = {
      id: 'C-ep-2',
      runId: 'r1',
      candidateType: 'endpoints',
      name: 'GET /api/y',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: { responseSchema: { type: 'object' } },
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    expect(scanForEvidenceGaps([c])).toHaveLength(0);
  });

  it('scanner flags data entity without attributes (no inline + no children)', () => {
    const c: DiscoveryCandidate = {
      id: 'C-de',
      runId: 'r1',
      candidateType: 'physical_data_entities',
      name: 'orders',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    const out = scanForEvidenceGaps([c]);
    expect(out).toHaveLength(1);
    expect(out[0].detailJson).toEqual({ gapType: 'data_entity_missing_attributes' });
  });

  it('scanner does NOT flag a data entity that has attribute-child candidates', () => {
    const parent: DiscoveryCandidate = {
      id: 'C-de-2',
      runId: 'r1',
      candidateType: 'physical_data_entities',
      name: 'orders',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    const child: DiscoveryCandidate = {
      id: 'C-de-2-attr',
      runId: 'r1',
      candidateType: 'physical_data_attributes',
      name: 'order_id',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
      parentCandidateId: 'C-de-2',
    };
    const out = scanForEvidenceGaps([parent, child]);
    expect(out.find((f) => f.detailJson?.gapType === 'data_entity_missing_attributes')).toBeUndefined();
  });

  it('scanner flags service without owner and without parent', () => {
    const c: DiscoveryCandidate = {
      id: 'C-svc',
      runId: 'r1',
      candidateType: 'service',
      name: 'PaymentService',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    const out = scanForEvidenceGaps([c]);
    expect(out.some((f) => f.detailJson?.gapType === 'service_missing_owner')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Negative test: Source G is NOT emitted in v1 (D4 -- deferred)
// -----------------------------------------------------------------------------
describe("Source G (unsupported_pattern) -- DEFERRED per D4", () => {
  it('no v1 builder emits finding_type=unsupported_pattern', () => {
    const allBuilderOutputs = [
      buildLowConfidenceCandidateFinding({
        candidateId: 'X',
        candidateName: 'X',
        candidateType: 'service',
        confidence: 0.3,
      }),
      buildUnresolvedDecisionTaskFinding({
        decisionTaskId: 'X',
        taskType: 'confirm_relationship',
      }),
      buildCandidateConflictFinding({
        conflictingCandidateIds: ['X'],
        conflictDescription: 'X',
        stage: 'discoveryV3Pipeline.dedup',
      }),
      buildCandidateConflictFinding({
        conflictingCandidateIds: ['X'],
        conflictDescription: 'X',
        stage: 'triageEngine.competingRelationships',
      }),
      buildUnmatchedRuntimeEndpointFinding({
        method: 'GET',
        pathTemplate: '/',
        observedUsageCount: 1,
        status2xxCount: 1,
        status3xxCount: 0,
      }),
      buildRuntimeUsageObservationFinding({
        candidateId: 'X',
        method: 'GET',
        pathTemplate: '/',
        observedUsageCount: 1,
      }),
      buildAmbiguousRelationshipFinding({
        relationshipDescription: 'X',
        confidence: 0.5,
        competingTargetCandidateIds: ['X'],
      }),
      buildEvidenceGapFinding({
        candidateId: 'X',
        candidateName: 'X',
        gapType: 'endpoint_missing_response_schema',
        gapDescription: 'X',
      }),
    ];
    for (const f of allBuilderOutputs) {
      expect(f.findingType).not.toBe('unsupported_pattern');
    }
  });

  it("scanner output never includes finding_type='unsupported_pattern'", () => {
    const candidates: DiscoveryCandidate[] = [
      {
        id: 'C-1',
        runId: 'r1',
        candidateType: 'endpoints',
        name: 'GET /a',
        confidence: 0.5,
        status: 'proposed',
        sourceClusterIds: [],
        data: {},
        synthesizedAt: '',
      },
      {
        id: 'C-2',
        runId: 'r1',
        candidateType: 'service',
        name: 'X',
        confidence: 0.5,
        status: 'proposed',
        sourceClusterIds: [],
        data: {},
        synthesizedAt: '',
      },
    ];
    for (const f of scanForEvidenceGaps(candidates)) {
      expect(f.findingType).not.toBe('unsupported_pattern');
    }
  });
});


// -----------------------------------------------------------------------------
// Source H (deferred-inbound-surface variant): buildDeferredSurfacePresentFinding
// Spec #4 Task Group 7. PRESENCE finding for a deferred entry-point surface.
// -----------------------------------------------------------------------------
describe('Source H: deferred_inbound_surface (Spec #4 TG7)', () => {
  it('emits evidence_gap / migration_risk with gapType=deferred_inbound_surface and the surface in detail', () => {
    const f = buildDeferredSurfacePresentFinding({
      surface: 'graphql',
      signal: '@QueryMapping',
      sourceFilePath: 'src/main/java/com/example/BookController.java',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('migration_risk');
    expect(f.severity).toBe('medium');
    expect(f.source).toBe('pipeline_evidence_gap');
    expect(f.createdByStage).toBe('findings.deferredSurfaceScanner');
    const d = f.detailJson as Record<string, unknown>;
    expect(d.gapType).toBe('deferred_inbound_surface');
    expect(d.surface).toBe('graphql');
    expect(d.signal).toBe('@QueryMapping');
    expect(d.filePath).toBe('src/main/java/com/example/BookController.java');
    // Presence-only: no candidate link is produced (run-/file-level finding).
    expect(f.links ?? []).toHaveLength(0);
  });

  it('renders a human-readable surface label in the title for each surface kind', () => {
    const cases: Array<[Parameters<typeof buildDeferredSurfacePresentFinding>[0]['surface'], string]> = [
      ['graphql', 'GraphQL'],
      ['grpc', 'gRPC'],
      ['websocket_stomp', 'WebSocket-STOMP'],
      ['spring_batch', 'Spring Batch'],
    ];
    for (const [surface, label] of cases) {
      const f = buildDeferredSurfacePresentFinding({
        surface,
        signal: 'sig',
        sourceFilePath: 'F.java',
      });
      expect(f.title).toContain(label);
      expect((f.detailJson as Record<string, unknown>).surface).toBe(surface);
    }
  });
});
