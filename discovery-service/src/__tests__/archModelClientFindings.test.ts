/**
 * Cross-stack gap-fill tests for the discovery-service archModelClient
 * Discovery Findings methods.
 *
 * Spec: 2026-05-16 Discovery Findings -- Task Group 8 (cross-stack test gap
 * review). Vocabulary normalized by Normalize Findings Review Actions
 * (Spec F, 2026-06-02): the wire disposition field is `review_status`
 * (candidate-parity vocabulary {pending_review, approved, rejected,
 * deferred}); the emit path omits it and lets AMS default to `pending_review`.
 *
 * Per-group test coverage already in place:
 *  - FindingEmitter (`findingEmitter.test.ts`) verifies normalization,
 *    dedupe, soft-fail BEHAVIOUR against a stubbed
 *    `FindingEmitterArchClient` interface -- so it never exercises the
 *    real `archModelClient` URL construction or snake_case body mapping.
 *  - emissionSources (`findingsEmissionSources.test.ts`) verifies the
 *    SHAPE of each v1 source's payload.
 *  - AMS controller + persistence tests verify the server-side contract.
 *  - Gateway proxy tests verify pass-through.
 *
 * What is NOT covered: the wire shape of `archModelClient.createDiscoveryFinding`,
 * `bulkCreateDiscoveryFindings`, `updateDiscoveryFinding`, `reviewDiscoveryFinding`
 * (URL construction including architecture-id resolution, snake_case body
 * mapping incl. links, error pass-through) — the integration boundary
 * between the emitter and the AMS HTTP surface.
 *
 * This file fills exactly that gap with the smallest possible surface:
 * 8 tests that pin the wire contract end-to-end through the actual
 * archModelClient methods + the dedupe/D6 cross-source scenarios.
 */

import { AxiosError } from 'axios';

// Mock dotenv before importing anything else (mirrors archModelClient.test.ts).
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('axios');

const ARCH_ID = 'arch-uuid-001';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const RUN_ID = 'run-uuid-001';
const FINDING_ID = 'finding-uuid-001';

// Mock runArchitectureRegistry so _resolveArchitectureForRun returns ARCH_ID
// in every test below without needing the fallback resolver chain.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

interface AxiosLikeInstance {
  post: jest.Mock;
  patch: jest.Mock;
  get: jest.Mock;
  delete: jest.Mock;
  interceptors: { response: { use: jest.Mock } };
}

function setupAxiosMock(): AxiosLikeInstance {
  const mockAxiosInstance: AxiosLikeInstance = {
    post: jest.fn(),
    patch: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    interceptors: { response: { use: jest.fn() } },
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axios = require('axios');
  axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

  // Re-mock runArchitectureRegistry after resetModules (matches the
  // pattern in archModelClient.test.ts).
  jest.mock('../services/runArchitectureRegistry', () => ({
    ...jest.requireActual('../services/runArchitectureRegistry'),
    getRunArchitectureId: jest.fn(() => ARCH_ID),
  }));

  return mockAxiosInstance;
}

const findingsUrl =
  `/api/model/projects/${encodeURIComponent(PROJECT_ID)}` +
  `/architectures/${encodeURIComponent(ARCH_ID)}` +
  `/discovery/runs/${encodeURIComponent(RUN_ID)}/findings`;

function backendFindingDto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FINDING_ID,
    run_id: RUN_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    finding_type: 'low_confidence_candidate',
    category: 'ambiguity',
    severity: 'medium',
    confidence: 0.42,
    review_status: 'pending_review',
    previous_review_status: null,
    title: 'a finding',
    summary: null,
    detail_json: null,
    source: 'pipeline_triage',
    created_by_stage: 'discoveryV3Pipeline.postMerge.lowConfidence',
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    reviewed_at: null,
    reviewer_notes: null,
    links: [],
    ...overrides,
  };
}

describe('archModelClient -- Discovery Findings methods (cross-stack gap-fill)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Test 1: createDiscoveryFinding POSTs to the architecture-scoped URL with
  // snake_case body INCLUDING links (camelCase -> snake_case mapping). The
  // emit path omits the disposition, so the wire body carries NO
  // review_status (AMS defaults it to pending_review).
  // ===========================================================================
  it('createDiscoveryFinding maps camelCase payload to snake_case wire body + correct URL (incl. links), omitting review_status', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({
        links: [
          {
            id: 'link-1',
            finding_id: FINDING_ID,
            link_type: 'supports',
            target_type: 'discovery_candidate',
            target_id: 'cand-7',
            label: null,
            created_at: '2026-05-16T00:00:00Z',
          },
        ],
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    const result = await archModelClient.createDiscoveryFinding(PROJECT_ID, RUN_ID, {
      findingType: 'low_confidence_candidate',
      category: 'ambiguity',
      severity: 'medium',
      title: 'a finding',
      confidence: 0.42,
      source: 'pipeline_triage',
      createdByStage: 'discoveryV3Pipeline.postMerge.lowConfidence',
      links: [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: 'cand-7',
        },
      ],
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe(findingsUrl);
    // Body shape -- every key snake_case per AMS Jackson SNAKE_CASE. No
    // disposition field on the emit path: AMS defaults review_status to
    // pending_review.
    expect(body).toEqual({
      finding_type: 'low_confidence_candidate',
      category: 'ambiguity',
      severity: 'medium',
      title: 'a finding',
      confidence: 0.42,
      source: 'pipeline_triage',
      created_by_stage: 'discoveryV3Pipeline.postMerge.lowConfidence',
      links: [
        {
          link_type: 'supports',
          target_type: 'discovery_candidate',
          target_id: 'cand-7',
          label: null,
        },
      ],
    });
    // Neither the old `status` nor the new `review_status` is sent on emit.
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('review_status');
    // mapFindingFromBackend round-trips the response back to camelCase.
    expect(result.findingType).toBe('low_confidence_candidate');
    expect(result.reviewStatus).toBe('pending_review');
    expect(result.previousReviewStatus).toBeNull();
    expect(result.links).toHaveLength(1);
    expect(result.links[0].targetId).toBe('cand-7');
  });

  // ===========================================================================
  // Test 2: bulkCreateDiscoveryFindings wraps in { findings: [...] } and POSTs
  // to /bulk -- single round-trip for N payloads.
  // ===========================================================================
  it('bulkCreateDiscoveryFindings wraps N payloads in {findings:[...]} and POSTs to /bulk in one call', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: [
        backendFindingDto({ id: 'f-1', title: 'one' }),
        backendFindingDto({ id: 'f-2', title: 'two' }),
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    const result = await archModelClient.bulkCreateDiscoveryFindings(PROJECT_ID, RUN_ID, [
      {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'one',
      },
      {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'two',
      },
    ]);

    // Critical: single POST regardless of N -- this is the whole point of
    // the bulk path.
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe(`${findingsUrl}/bulk`);
    expect((body as { findings: unknown[] }).findings).toHaveLength(2);
    expect((body as { findings: Array<{ title: string }> }).findings[0].title).toBe('one');
    expect((body as { findings: Array<{ title: string }> }).findings[1].title).toBe('two');
    expect(result).toHaveLength(2);
  });

  // ===========================================================================
  // Test 2b-2d: bulk chunking (2026-08-02). AMS caps a bulk call at
  // MAX_BULK_FINDINGS = 500 and 400s over-cap requests wholesale -- the
  // client chunks, continues past a failed chunk, and throws only when
  // NOTHING persisted.
  // ===========================================================================
  function bulkPayloads(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'medium',
      title: `finding-${i}`,
    }));
  }

  it('chunks an over-cap bulk create into 500-sized POSTs and concatenates the results', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post
      .mockResolvedValueOnce({ data: [backendFindingDto({ id: 'f-a' })] })
      .mockResolvedValueOnce({ data: [backendFindingDto({ id: 'f-b' })] })
      .mockResolvedValueOnce({ data: [backendFindingDto({ id: 'f-c' })] });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.bulkCreateDiscoveryFindings(
      PROJECT_ID,
      RUN_ID,
      bulkPayloads(1201),
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    const lengths = mockAxiosInstance.post.mock.calls.map(
      ([, body]: [string, { findings: unknown[] }]) => body.findings.length,
    );
    expect(lengths).toEqual([500, 500, 201]);
    for (const [url] of mockAxiosInstance.post.mock.calls) {
      expect(url).toBe(`${findingsUrl}/bulk`);
    }
    expect(result.map((f: { id: string }) => f.id)).toEqual(['f-a', 'f-b', 'f-c']);
  });

  it('a failed chunk logs and the remaining chunks still persist (partial success returned)', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post
      .mockResolvedValueOnce({ data: [backendFindingDto({ id: 'f-1' })] })
      .mockRejectedValueOnce(new Error('AMS 400 on chunk 2'))
      .mockResolvedValueOnce({ data: [backendFindingDto({ id: 'f-3' })] });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    const result = await archModelClient.bulkCreateDiscoveryFindings(
      PROJECT_ID,
      RUN_ID,
      bulkPayloads(1201),
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    expect(result.map((f: { id: string }) => f.id)).toEqual(['f-1', 'f-3']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chunk 2/3 failed'));
    warnSpy.mockRestore();
  });

  it('throws when EVERY chunk fails (total failure stays loud)', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post
      .mockRejectedValueOnce(new Error('boom1'))
      .mockRejectedValueOnce(new Error('boom2'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    await expect(
      archModelClient.bulkCreateDiscoveryFindings(PROJECT_ID, RUN_ID, bulkPayloads(600)),
    ).rejects.toThrow('boom2');
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  // ===========================================================================
  // Test 3: updateDiscoveryFinding PATCH preserves an explicit `confidence: null`
  // on the wire (boxed-Double pitfall coverage end-to-end through the wire
  // mapper) AND omits keys that were not supplied so AMS null-guards apply.
  // ===========================================================================
  it('updateDiscoveryFinding wire-maps explicit null confidence AND omits unspecified keys', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.patch.mockResolvedValueOnce({
      data: backendFindingDto({ reviewer_notes: 'looked at it' }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    // Reviewer-notes-only PATCH with explicit confidence:null AND review_status
    // not sent -- the wire body MUST include reviewer_notes + confidence (with
    // the null value) but NOT review_status. This protects against two
    // regressions:
    //  (a) primitive-Double overwrite on the AMS side (covered separately by
    //      DiscoveryFindingControllerTest.patchPreservesConfidenceWhenOmitted)
    //  (b) the discovery-service wire mapper accidentally dropping `null`
    //      keys -- which is the gap THIS test fills.
    await archModelClient.updateDiscoveryFinding(PROJECT_ID, RUN_ID, FINDING_ID, {
      reviewerNotes: 'looked at it',
      confidence: null,
    });

    expect(mockAxiosInstance.patch).toHaveBeenCalledTimes(1);
    const [url, body] = mockAxiosInstance.patch.mock.calls[0];
    expect(url).toBe(`${findingsUrl}/${encodeURIComponent(FINDING_ID)}`);
    // Both keys present; explicit null preserved.
    expect(body).toEqual({
      reviewer_notes: 'looked at it',
      confidence: null,
    });
    // review_status, finding_type, severity, etc. all OMITTED -- AMS
    // null-guards every PATCH field; a missing key keeps the column.
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual([
      'confidence',
      'reviewer_notes',
    ]);
  });

  // ===========================================================================
  // Test 4: reviewDiscoveryFinding maps the disposition onto the renamed wire
  // field `review_status` and POSTs to the /review endpoint. Transitions are
  // now unrestricted (any->any) so this is the happy path; we also confirm a
  // valid candidate-parity disposition value is threaded through verbatim.
  // ===========================================================================
  it('reviewDiscoveryFinding maps reviewStatus -> review_status on the wire at the /review endpoint', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({
        review_status: 'approved',
        previous_review_status: 'pending_review',
        reviewed_at: '2026-06-02T00:00:00Z',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');

    const result = await archModelClient.reviewDiscoveryFinding(PROJECT_ID, RUN_ID, FINDING_ID, {
      reviewStatus: 'approved',
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe(`${findingsUrl}/${encodeURIComponent(FINDING_ID)}/review`);
    // review_status threaded through, reviewer_notes omitted (not in input).
    expect(body).toEqual({ review_status: 'approved' });
    // Response round-trips the renamed fields back to camelCase.
    expect(result.reviewStatus).toBe('approved');
    expect(result.previousReviewStatus).toBe('pending_review');
  });

  // ===========================================================================
  // Test 5: end-to-end soft-fail -- FindingEmitter wired against the REAL
  // archModelClient method swallows network failures and the run continues.
  //
  // This is the priority-3 cross-stack scenario in tasks 8.3: "AMS returns
  // 500 mid-run → other findings persist, warning logged". The existing
  // findingEmitter.test.ts only proves this through a stub interface; this
  // test proves it through the actual `archModelClient.createDiscoveryFinding`
  // method that the runtime emitter uses by default.
  // ===========================================================================
  it('end-to-end soft-fail: AMS 500 on createDiscoveryFinding -> FindingEmitter returns null, run continues', async () => {
    const mockAxiosInstance = setupAxiosMock();
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 500',
      response: {
        status: 500,
        data: { message: 'AMS internal error' },
        statusText: 'Internal Server Error',
        headers: {},
        config: {},
      },
    } as AxiosError;
    mockAxiosInstance.post.mockRejectedValueOnce(axiosError);
    // Second emit succeeds -- proves "run continues" semantics.
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({ id: 'f-success', title: 'second one' }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FindingEmitter } = require('../services/findings/FindingEmitter');

    const emitter = new FindingEmitter(archModelClient);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const runContext = {
        runId: RUN_ID,
        projectId: PROJECT_ID,
        architectureId: ARCH_ID,
      };

      const r1 = await emitter.emitFinding(runContext, {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'first one (will 500)',
      });
      expect(r1).toBeNull();

      const r2 = await emitter.emitFinding(runContext, {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'second one',
      });
      expect(r2).not.toBeNull();
      expect((r2 as { id: string }).id).toBe('f-success');

      // Both attempts hit the wire.
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      // The 500 was logged as a warning -- the spec's "warning logged, run continues" guarantee.
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warned.some((m) => m.includes('finding emit failed'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ===========================================================================
  // Test 6 (priority 8.3.2): cross-source dedupe end-to-end.
  // A candidate flagged by Source A (`low_confidence_candidate`) AND Source H
  // (`evidence_gap`) MUST emit TWO findings -- both linked to the same
  // `discovery_candidate` as primary target, with DISTINCT dedupe keys
  // because `findingType` differs. This pins the D2 dedupe-key formula
  // end-to-end through the FindingEmitter + real archModelClient wiring.
  // ===========================================================================
  it('two different finding_types linked to the same candidate emit two distinct findings (D2 cross-source)', async () => {
    const mockAxiosInstance = setupAxiosMock();
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({
        id: 'f-source-a',
        finding_type: 'low_confidence_candidate',
        title: 'Low confidence candidate cand-shared',
      }),
    });
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({
        id: 'f-source-h',
        finding_type: 'evidence_gap',
        category: 'evidence_gap',
        title: 'Endpoint cand-shared missing response schema',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FindingEmitter, computeDedupeKey, computePrimaryLinkedTarget } =
      require('../services/findings/FindingEmitter');

    const emitter = new FindingEmitter(archModelClient);
    const runContext = {
      runId: RUN_ID,
      projectId: PROJECT_ID,
      architectureId: ARCH_ID,
    };
    const sharedCandidateId = 'cand-shared';

    // Source A emit
    const aFinding = await emitter.emitFinding(runContext, {
      findingType: 'low_confidence_candidate',
      category: 'ambiguity',
      severity: 'medium',
      title: 'Low confidence candidate cand-shared',
      links: [
        {
          linkType: 'derived_from',
          targetType: 'discovery_candidate',
          targetId: sharedCandidateId,
        },
      ],
    });

    // Source H emit -- same candidate, different finding_type+category+title
    const hFinding = await emitter.emitFinding(runContext, {
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'medium',
      title: 'Endpoint cand-shared missing response schema',
      links: [
        {
          linkType: 'supports',
          targetType: 'discovery_candidate',
          targetId: sharedCandidateId,
        },
      ],
    });

    // Both findings persisted -- NOT deduped.
    expect(aFinding).not.toBeNull();
    expect(hFinding).not.toBeNull();
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);

    // Both findings carry the same primary linked target (candidate priority
    // is the highest in the D2 chain; only one candidate in each link list).
    const primaryA = computePrimaryLinkedTarget([
      { linkType: 'derived_from', targetType: 'discovery_candidate', targetId: sharedCandidateId },
    ]);
    const primaryH = computePrimaryLinkedTarget([
      { linkType: 'supports', targetType: 'discovery_candidate', targetId: sharedCandidateId },
    ]);
    expect(primaryA).toBe(`discovery_candidate:${sharedCandidateId}`);
    expect(primaryH).toBe(primaryA);

    // But the dedupe keys are DIFFERENT -- this is the whole D2 contract:
    // findingType+category+title differ, so the keys differ, and both
    // findings survive into the persisted set.
    const keyA = computeDedupeKey({
      runId: RUN_ID,
      findingType: 'low_confidence_candidate',
      category: 'ambiguity',
      title: 'low confidence candidate cand-shared',
      primaryLinkedTarget: primaryA,
    });
    const keyH = computeDedupeKey({
      runId: RUN_ID,
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      title: 'endpoint cand-shared missing response schema',
      primaryLinkedTarget: primaryH,
    });
    expect(keyA).not.toBe(keyH);

    // Both POST bodies linked to the same candidate
    const linkA = (mockAxiosInstance.post.mock.calls[0][1] as {
      links?: Array<{ target_id: string }>;
    }).links?.[0]?.target_id;
    const linkH = (mockAxiosInstance.post.mock.calls[1][1] as {
      links?: Array<{ target_id: string }>;
    }).links?.[0]?.target_id;
    expect(linkA).toBe(sharedCandidateId);
    expect(linkH).toBe(sharedCandidateId);
  });

  // ===========================================================================
  // Test 7 (priority 8.3.4): D6 invalid-link-target end-to-end.
  // The emitter attempts to attach a link to a target from a different run.
  // AMS returns 400 with `{code: 'invalid_link_target'}`. The emitter MUST
  // soft-fail -- no exception escapes, warning is logged, run continues.
  //
  // This complements test 5 (which used a 500). The 400 path is the
  // most likely real-world failure since it's a content-driven rejection,
  // not a transient outage.
  // ===========================================================================
  it('end-to-end D6 reject: AMS 400 invalid_link_target -> soft-fail, no exception, run continues', async () => {
    const mockAxiosInstance = setupAxiosMock();
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          code: 'invalid_link_target',
          message: 'Target candidate cand-other-run belongs to a different run',
          target_type: 'discovery_candidate',
          target_id: 'cand-other-run',
        },
        statusText: 'Bad Request',
        headers: {},
        config: {},
      },
    } as AxiosError;
    // First emit: D6 reject. Second emit (no links): succeeds, proves
    // "run continues" semantics.
    mockAxiosInstance.post.mockRejectedValueOnce(axiosError);
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({ id: 'f-followup', title: 'recovered' }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FindingEmitter } = require('../services/findings/FindingEmitter');

    const emitter = new FindingEmitter(archModelClient);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const runContext = {
        runId: RUN_ID,
        projectId: PROJECT_ID,
        architectureId: ARCH_ID,
      };

      // Emit with a bad link target.
      let thrown: unknown = null;
      let result1: unknown;
      try {
        result1 = await emitter.emitFinding(runContext, {
          findingType: 'candidate_conflict',
          category: 'ambiguity',
          severity: 'medium',
          title: 'Conflict referencing other-run candidate',
          links: [
            {
              linkType: 'related_to',
              targetType: 'discovery_candidate',
              targetId: 'cand-other-run',
            },
          ],
        });
      } catch (e) {
        thrown = e;
      }
      // No exception escapes -- this is the soft-fail contract.
      expect(thrown).toBeNull();
      expect(result1).toBeNull();

      // The run continues -- subsequent emits still go through.
      const result2 = await emitter.emitFinding(runContext, {
        findingType: 'evidence_gap',
        category: 'evidence_gap',
        severity: 'medium',
        title: 'recovered',
      });
      expect(result2).not.toBeNull();
      expect((result2 as { id: string }).id).toBe('f-followup');

      // Warning logged with the dedupe-key context.
      const warned = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warned.some((m) => m.includes('finding emit failed'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // ===========================================================================
  // Test 8 (Spec F, 2026-06-02): the emit path OMITS the disposition so AMS
  // applies its `pending_review` default; but an explicitly supplied
  // `reviewStatus` still maps onto the renamed wire field `review_status`.
  // This pins the "omit by default, map when supplied" contract end-to-end
  // through the real FindingEmitter + archModelClient wiring.
  // ===========================================================================
  it('emit omits review_status by default and maps an explicit reviewStatus onto review_status', async () => {
    const mockAxiosInstance = setupAxiosMock();
    // Two successful creates: first with no disposition, second with an
    // explicit one.
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({ id: 'f-default', title: 'no disposition' }),
    });
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: backendFindingDto({
        id: 'f-explicit',
        title: 'explicit disposition',
        review_status: 'approved',
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { archModelClient } = require('../services/archModelClient');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FindingEmitter } = require('../services/findings/FindingEmitter');

    const emitter = new FindingEmitter(archModelClient);
    const runContext = { runId: RUN_ID, projectId: PROJECT_ID, architectureId: ARCH_ID };

    // (a) default emit: no reviewStatus on the input.
    await emitter.emitFinding(runContext, {
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'medium',
      title: 'no disposition',
    });
    const defaultBody = mockAxiosInstance.post.mock.calls[0][1] as Record<string, unknown>;
    expect(defaultBody).not.toHaveProperty('review_status');
    expect(defaultBody).not.toHaveProperty('status');

    // (b) explicit emit: reviewStatus supplied -> mapped to review_status.
    await emitter.emitFinding(runContext, {
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'medium',
      title: 'explicit disposition',
      reviewStatus: 'approved',
    });
    const explicitBody = mockAxiosInstance.post.mock.calls[1][1] as Record<string, unknown>;
    expect(explicitBody.review_status).toBe('approved');
    expect(explicitBody).not.toHaveProperty('status');
  });
});
