/**
 * Tests for FindingEmitter (Spec 2026-05-16 Discovery Findings -- Task Group 4;
 * vocabulary normalized by Spec F, 2026-06-02).
 *
 * Verifies the contract pinned in the spec:
 *  - Normalization lowercases finding_type/category/severity, trims title,
 *    and forwards via archModelClient. The disposition is OMITTED from the
 *    emit payload so AMS applies its `pending_review` default (Spec F; was
 *    `status='new'` per D5).
 *  - Bulk emit takes one round-trip through bulkCreateDiscoveryFindings.
 *  - D2 dedupe key primary-target priority and lowest-targetId tiebreak.
 *  - Empty-links case uses the empty string for primaryLinkedTarget.
 *  - In-process dedupe filters a same-key second emit (cache per run).
 *  - Soft-fail: archModelClient errors do NOT propagate (warn + continue).
 *  - Link payload survives normalization unchanged.
 *  - Invalid severity / review_status are rejected (warn + skip; no throw).
 */

import {
  FindingEmitter,
  computePrimaryLinkedTarget,
  computeDedupeKey,
  type FindingEmitterArchClient,
} from '../services/findings/FindingEmitter';
import type {
  DiscoveryFindingCreatePayload,
  DiscoveryFindingDto,
} from '../services/archModelClient';

// -----------------------------------------------------------------------------
// Stub arch-model client. Records calls into in-memory arrays and is
// configurable per-test for happy-path / throws-on-create behaviours.
// -----------------------------------------------------------------------------
function makeStubClient(opts: { throwOnCreate?: boolean; throwOnBulk?: boolean } = {}): {
  client: FindingEmitterArchClient;
  createCalls: Array<{
    projectId: string;
    runId: string;
    payload: DiscoveryFindingCreatePayload;
  }>;
  bulkCalls: Array<{
    projectId: string;
    runId: string;
    payloads: DiscoveryFindingCreatePayload[];
  }>;
} {
  const createCalls: Array<{
    projectId: string;
    runId: string;
    payload: DiscoveryFindingCreatePayload;
  }> = [];
  const bulkCalls: Array<{
    projectId: string;
    runId: string;
    payloads: DiscoveryFindingCreatePayload[];
  }> = [];

  const stubDto = (
    projectId: string,
    runId: string,
    payload: DiscoveryFindingCreatePayload,
  ): DiscoveryFindingDto => ({
    id: 'finding-' + Math.random().toString(36).slice(2, 10),
    runId,
    projectId,
    architectureId: 'arch-1',
    findingType: payload.findingType,
    category: payload.category,
    severity: payload.severity,
    confidence: payload.confidence ?? null,
    // Mirrors the AMS default: an omitted disposition persists as
    // `pending_review` (Spec F).
    reviewStatus: payload.reviewStatus ?? 'pending_review',
    previousReviewStatus: null,
    title: payload.title,
    summary: payload.summary ?? null,
    detailJson: payload.detailJson ?? null,
    source: payload.source ?? null,
    createdByStage: payload.createdByStage ?? null,
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    reviewedAt: null,
    reviewerNotes: null,
    links: [],
  });

  const client: FindingEmitterArchClient = {
    async createDiscoveryFinding(projectId, runId, payload) {
      createCalls.push({ projectId, runId, payload });
      if (opts.throwOnCreate) throw new Error('AMS unavailable');
      return stubDto(projectId, runId, payload);
    },
    async bulkCreateDiscoveryFindings(projectId, runId, payloads) {
      bulkCalls.push({ projectId, runId, payloads });
      if (opts.throwOnBulk) throw new Error('AMS bulk unavailable');
      return payloads.map((p) => stubDto(projectId, runId, p));
    },
  };

  return { client, createCalls, bulkCalls };
}

const runContext = {
  runId: 'run-1',
  projectId: 'proj-1',
  architectureId: 'arch-1',
};

describe('FindingEmitter', () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ===========================================================================
  // Test 1: emitFinding normalizes + persists through archModelClient,
  // OMITTING the disposition so AMS defaults it to pending_review.
  // ===========================================================================
  it('normalizes finding_type/category/severity, omits the disposition, calls createDiscoveryFinding', async () => {
    const { client, createCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);

    const result = await emitter.emitFinding(runContext, {
      findingType: 'Low_Confidence_Candidate', // mixed case + underscore
      category: 'Ambiguity',
      severity: 'MEDIUM',
      title: '  Service X has low confidence  ', // whitespace
      summary: 'Confidence below threshold',
      confidence: 0.45,
      source: 'pipeline_triage',
      createdByStage: 'discoveryV3Pipeline.postMerge.lowConfidence',
      links: [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: 'cand-1',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].projectId).toBe('proj-1');
    expect(createCalls[0].runId).toBe('run-1');
    expect(createCalls[0].payload).toMatchObject({
      findingType: 'low_confidence_candidate',
      category: 'ambiguity',
      severity: 'medium',
      title: 'Service X has low confidence',
      confidence: 0.45,
      source: 'pipeline_triage',
      createdByStage: 'discoveryV3Pipeline.postMerge.lowConfidence',
    });
    // The emit path does NOT carry a disposition -- AMS defaults it.
    expect(createCalls[0].payload).not.toHaveProperty('reviewStatus');
    // The persisted DTO reflects AMS's pending_review default.
    expect(result?.reviewStatus).toBe('pending_review');
    // Links survive normalization (link_type / target_type / target_id unchanged).
    expect(createCalls[0].payload.links).toEqual([
      {
        linkType: 'supports',
        targetType: 'discovery_candidate',
        targetId: 'cand-1',
      },
    ]);
  });

  // ===========================================================================
  // Test 2: emitFindings (bulk) calls bulkCreateDiscoveryFindings once
  // ===========================================================================
  it('emitFindings bulk-calls bulkCreateDiscoveryFindings with N payloads in one request', async () => {
    const { client, createCalls, bulkCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);

    const results = await emitter.emitFindings(runContext, [
      {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'Endpoint A missing response schema',
        links: [
          { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'cand-A' },
        ],
      },
      {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'Endpoint B missing response schema',
        links: [
          { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'cand-B' },
        ],
      },
    ]);

    expect(results).toHaveLength(2);
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].payloads).toHaveLength(2);
    // No single-create calls -- the bulk path is taken.
    expect(createCalls).toHaveLength(0);
  });

  // ===========================================================================
  // Test 3: D2 primary-link priority + tiebreak
  // ===========================================================================
  it('computePrimaryLinkedTarget picks the highest-priority target_type and lowest target_id', () => {
    // Two competing target_types: candidate beats evidence regardless of id.
    expect(
      computePrimaryLinkedTarget([
        { linkType: 'supports', targetType: 'discovery_evidence', targetId: 'E1' },
        { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C7' },
      ]),
    ).toBe('discovery_candidate:C7');

    // Two same-priority targets: lowest target_id wins.
    expect(
      computePrimaryLinkedTarget([
        { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C7' },
        { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C2' },
      ]),
    ).toBe('discovery_candidate:C2');

    // Full priority chain ordering.
    expect(
      computePrimaryLinkedTarget([
        { linkType: 'supports', targetType: 'architecture_element', targetId: 'AE1' },
        { linkType: 'supports', targetType: 'discovery_cluster', targetId: 'CL1' },
        { linkType: 'supports', targetType: 'discovery_evidence', targetId: 'EV1' },
        { linkType: 'supports', targetType: 'discovery_relationship', targetId: 'R1' },
        { linkType: 'supports', targetType: 'discovery_decision_task', targetId: 'DT1' },
      ]),
    ).toBe('discovery_decision_task:DT1');
  });

  // ===========================================================================
  // Test 4: empty-links case uses the empty string
  // ===========================================================================
  it('uses empty string for primaryLinkedTarget when links are absent', () => {
    expect(computePrimaryLinkedTarget(undefined)).toBe('');
    expect(computePrimaryLinkedTarget([])).toBe('');
    expect(
      computeDedupeKey({
        runId: 'run-1',
        findingType: 'low_confidence_candidate',
        category: 'ambiguity',
        title: 'X',
        primaryLinkedTarget: '',
      }),
    ).toBe('run-1|low_confidence_candidate|ambiguity|X|');
  });

  // ===========================================================================
  // Test 5: dedupe -- emitting the same key twice posts once
  // ===========================================================================
  it('dedupes a second emit with the same dedupe key in the same run', async () => {
    const { client, createCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);

    const input = {
      findingType: 'unresolved_decision_task',
      category: 'ambiguity',
      severity: 'medium',
      title: 'DecisionTask DT-1 unresolved',
      links: [
        { linkType: 'related_to', targetType: 'discovery_decision_task' as const, targetId: 'DT-1' },
      ],
    };

    const r1 = await emitter.emitFinding(runContext, input);
    const r2 = await emitter.emitFinding(runContext, input);

    expect(r1).not.toBeNull();
    expect(r2).toBeNull(); // deduped
    expect(createCalls).toHaveLength(1);
  });

  // ===========================================================================
  // Test 6: soft-fail on AMS error
  // ===========================================================================
  it('does NOT propagate archModelClient errors; logs a warning instead', async () => {
    const { client, createCalls } = makeStubClient({ throwOnCreate: true });
    const emitter = new FindingEmitter(client);

    let thrown: unknown = null;
    let result: unknown;
    try {
      result = await emitter.emitFinding(runContext, {
        findingType: 'candidate_conflict',
        category: 'ambiguity',
        severity: 'medium',
        title: 'C1 vs C2 duplicate',
        links: [
          { linkType: 'related_to', targetType: 'discovery_candidate', targetId: 'C1' },
        ],
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(result).toBeNull();
    expect(createCalls).toHaveLength(1); // the call was attempted
    // At least one warn line was logged.
    expect(warnSpy).toHaveBeenCalled();
    const warningMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warningMessages.some((m) => m.includes('finding emit failed'))).toBe(true);
  });

  // ===========================================================================
  // Test 7: invalid severity is rejected (warn + skip; no throw)
  // ===========================================================================
  it('rejects invalid severity with a warning and no archModelClient call', async () => {
    const { client, createCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);

    const result = await emitter.emitFinding(runContext, {
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'urgent', // not in info/low/medium/high/critical
      title: 'X missing attributes',
    });
    expect(result).toBeNull();
    expect(createCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  // ===========================================================================
  // Test 8: the disposition is OMITTED on emission so AMS defaults it to
  // pending_review (Spec F; replaces the old "defaults status to 'new'" D5
  // behaviour). An explicitly supplied reviewStatus is still forwarded.
  // ===========================================================================
  it('omits the disposition on emission (AMS defaults pending_review); forwards an explicit reviewStatus', async () => {
    const { client, createCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);

    // (a) no disposition supplied -> omitted from the payload.
    const dDefault = await emitter.emitFinding(runContext, {
      findingType: 'runtime_usage_observation',
      category: 'runtime_usage',
      severity: 'info',
      title: 'GET /api/x observed',
      links: [
        { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C-ep-1' },
      ],
    });
    expect(createCalls[0].payload).not.toHaveProperty('reviewStatus');
    expect(dDefault?.reviewStatus).toBe('pending_review');

    // (b) explicit disposition -> forwarded on the payload (normalized).
    await emitter.emitFinding(runContext, {
      findingType: 'runtime_usage_observation',
      category: 'runtime_usage',
      severity: 'info',
      title: 'GET /api/y observed',
      reviewStatus: 'Approved',
      links: [
        { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C-ep-2' },
      ],
    });
    expect(createCalls[1].payload.reviewStatus).toBe('approved');
  });
});
