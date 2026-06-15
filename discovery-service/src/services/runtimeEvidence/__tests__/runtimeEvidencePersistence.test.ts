/**
 * Tests for runtimeEvidencePersistence.
 *
 * Post-hotfix-2026-05-12-A this module has TWO responsibilities:
 *   1. `applyRuntimeEvidenceToCandidates(candidates, matched, noUsage)`
 *      mutates the in-memory deterministic candidate objects in place,
 *      attaching a `runtime` sub-key on each candidate's `logEnrichment`
 *      blob. The bulk-save path in `RunManager.bulkSaveCandidates`
 *      subsequently serialises the mutated blob end-to-end -- no per-
 *      candidate PUT is performed by this module.
 *   2. `persistRuntimeEvidence({ ... })` writes the run-level
 *      `steps_payload.v3.runtimeEvidence` block via
 *      `archModelClient.updateDiscoveryRun`.
 *
 * The previous per-candidate `updateCandidate` PUT loop was the source
 * of the production "Candidate not found" 400 errors: this stage runs
 * BEFORE Stage 2's candidates are persisted, so the rows didn't exist
 * yet. These tests cover the new contract and assert that
 * `archModelClient.updateCandidate` is NEVER called by this module.
 *
 * Mock pattern (per project memory):
 *   - `jest.mock('../../archModelClient', () => { const actual = jest.requireActual(...); ... })`
 *     so that callers of unmocked archModelClient methods elsewhere in
 *     the import graph still hit a real implementation.
 */

jest.mock('../../archModelClient', () => {
  const actual = jest.requireActual('../../archModelClient');
  return {
    ...actual,
    archModelClient: {
      ...actual.archModelClient,
      updateCandidate: jest.fn(),
      updateDiscoveryRun: jest.fn(),
      getDiscoveryRun: jest.fn(),
      getCandidatesByRun: jest.fn(),
    },
  };
});

import {
  applyRuntimeEvidenceToCandidates,
  persistRuntimeEvidence,
} from '../runtimeEvidencePersistence';
import { archModelClient } from '../../archModelClient';
import {
  MatchedRuntimeEvidence,
  NoUsageRuntimeEvidence,
  RuntimeEvidenceRunSummary,
} from '../httpRuntimeObservation';
import { DiscoveryCandidate } from '../../../types/candidate';

const mockedClient = archModelClient as unknown as {
  updateCandidate: jest.Mock;
  updateDiscoveryRun: jest.Mock;
  getDiscoveryRun: jest.Mock;
  getCandidatesByRun: jest.Mock;
};

beforeEach(() => {
  mockedClient.updateCandidate.mockReset();
  mockedClient.updateDiscoveryRun.mockReset();
  mockedClient.getDiscoveryRun.mockReset();
  mockedClient.getCandidatesByRun.mockReset();
});

function buildMatched(candidateId: string): MatchedRuntimeEvidence {
  return {
    candidateId,
    candidateType: 'endpoints',
    method: 'GET',
    codePathTemplate: '/users/{id}',
    normalizedLogPath: '/users/{id}',
    totalLogRequests: 12,
    observedUsageCount: 10,
    status2xxCount: 9,
    status3xxCount: 1,
    status4xxCount: 1,
    status5xxCount: 1,
    topStatusCodes: [{ status: 200, count: 9 }],
    firstSeen: '2026-05-01T00:00:00Z',
    lastSeen: '2026-05-02T00:00:00Z',
    sourceLogFileCount: 1,
    matchConfidence: 'high',
    matchReason: 'exact_normalized_path',
  };
}

function buildNoUsage(candidateId: string): NoUsageRuntimeEvidence {
  return {
    candidateId,
    candidateType: 'endpoints',
    observedUsageCount: 0,
    status2xxCount: 0,
    status3xxCount: 0,
    status4xxCount: 0,
    status5xxCount: 0,
    totalLogRequests: 0,
    noUsageObserved: true,
    note: 'No matching log observations in processed log window',
  };
}

function buildRunSummary(): RuntimeEvidenceRunSummary {
  return {
    logFilesProcessed: 2,
    logWindow: { firstSeen: '2026-05-01T00:00:00Z', lastSeen: '2026-05-03T00:00:00Z' },
    totals: {
      observations: 100,
      matchedEndpoints: 1,
      noUsageEndpoints: 1,
      unmatchedHints: 0,
    },
    warnings: [],
    unmatchedRouteHints: [],
  };
}

function makeCandidate(
  id: string,
  logEnrichment?: DiscoveryCandidate['logEnrichment'],
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'endpoints',
    name: `cand-${id}`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { method: 'GET', pathTemplate: '/users/{id}' },
    synthesizedAt: '2026-05-10T00:00:00Z',
    logEnrichment,
  } as DiscoveryCandidate;
}

describe('applyRuntimeEvidenceToCandidates — matched mutation is additive', () => {
  it('preserves existing { enriched, logAtomCount, signalSummary } keys when attaching the runtime sub-key for a matched candidate', () => {
    const existingEnrichment = {
      enriched: true,
      logAtomCount: 7,
      signalSummary: '7 endpoint hits observed',
    };
    const candidate = makeCandidate(
      'cand-matched-1',
      existingEnrichment as DiscoveryCandidate['logEnrichment'],
    );
    const matched = buildMatched('cand-matched-1');

    applyRuntimeEvidenceToCandidates([candidate], [matched], []);

    // The mutated logEnrichment must preserve the Increment 14 keys
    // alongside the new `runtime` sub-key.
    expect(candidate.logEnrichment).toMatchObject({
      enriched: true,
      logAtomCount: 7,
      signalSummary: '7 endpoint hits observed',
      runtime: { matched },
    });
    // No per-candidate PUT.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });

  it('attaches the runtime sub-key even when no prior logEnrichment exists on the candidate', () => {
    const candidate = makeCandidate('cand-empty');
    const matched = buildMatched('cand-empty');

    applyRuntimeEvidenceToCandidates([candidate], [matched], []);

    expect(candidate.logEnrichment).toEqual({ runtime: { matched } });
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('applyRuntimeEvidenceToCandidates — no-usage mutation is additive', () => {
  it('attaches a noUsageObserved runtime block, preserving existing keys on the candidate', () => {
    const candidate = makeCandidate(
      'cand-no-usage-1',
      {
        enriched: false,
        logAtomCount: 0,
        signalSummary: 'no log signals',
      } as DiscoveryCandidate['logEnrichment'],
    );
    const noUsage = buildNoUsage('cand-no-usage-1');

    applyRuntimeEvidenceToCandidates([candidate], [], [noUsage]);

    expect(candidate.logEnrichment).toMatchObject({
      enriched: false,
      logAtomCount: 0,
      signalSummary: 'no log signals',
      runtime: {
        candidateId: 'cand-no-usage-1',
        candidateType: 'endpoints',
        noUsageObserved: true,
        observedUsageCount: 0,
        note: expect.stringContaining('No matching log observations'),
      },
    });
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('applyRuntimeEvidenceToCandidates — fan-out across the candidate list', () => {
  it('mutates only the matched / no-usage candidates and leaves unrelated candidates untouched', () => {
    const matchedCand = makeCandidate('cand-matched-A');
    const noUsageCand = makeCandidate('cand-no-usage-B');
    const untouchedCand = makeCandidate(
      'cand-other-C',
      { enriched: true, logAtomCount: 3, signalSummary: 'three' } as DiscoveryCandidate['logEnrichment'],
    );

    applyRuntimeEvidenceToCandidates(
      [matchedCand, noUsageCand, untouchedCand],
      [buildMatched('cand-matched-A')],
      [buildNoUsage('cand-no-usage-B')],
    );

    expect(
      (matchedCand.logEnrichment as unknown as { runtime?: unknown })?.runtime,
    ).toBeDefined();
    expect(
      (noUsageCand.logEnrichment as unknown as { runtime?: unknown })?.runtime,
    ).toBeDefined();
    // Untouched candidate keeps exactly its prior shape -- no `runtime` key.
    expect(untouchedCand.logEnrichment).toEqual({
      enriched: true,
      logAtomCount: 3,
      signalSummary: 'three',
    });
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });

  it('silently skips matched / no-usage entries whose candidateId is absent from the candidate list', () => {
    const candidate = makeCandidate('cand-known');
    // The matched entry references an id that is NOT in the candidates
    // array -- this can happen if the matcher returns evidence for a
    // candidate that was filtered out upstream. The mutation function
    // must not throw or pollute the known candidate.
    applyRuntimeEvidenceToCandidates(
      [candidate],
      [buildMatched('cand-orphan')],
      [],
    );
    expect(candidate.logEnrichment).toBeUndefined();
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('persistRuntimeEvidence — run-level write preserves sibling keys', () => {
  it('namespaced-merges runtimeEvidence into steps_payload.v3 without overwriting an existing gapFill sibling', async () => {
    const existingGapFill = {
      stageStatus: 'completed',
      filesProcessed: 42,
      candidatesEmitted: 17,
    };
    mockedClient.getDiscoveryRun.mockResolvedValue({
      steps_payload: {
        v3: { gapFill: existingGapFill },
        someTopLevelKey: { kept: true },
      },
    });

    const runSummary = buildRunSummary();
    await persistRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      runSummary,
    });

    expect(mockedClient.updateDiscoveryRun).toHaveBeenCalledTimes(1);
    const [projectId, runId, payload] =
      mockedClient.updateDiscoveryRun.mock.calls[0];
    expect(projectId).toBe('proj-1');
    expect(runId).toBe('run-1');

    // gapFill sibling must be preserved alongside the new runtimeEvidence key.
    expect(payload.steps_payload).toEqual({
      v3: {
        gapFill: existingGapFill,
        runtimeEvidence: runSummary,
      },
      someTopLevelKey: { kept: true },
    });

    // The persistence module must NOT call updateCandidate -- per-candidate
    // writes are handled via the bulk-save path post-hotfix-2026-05-12-A.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });

  it('writes the runtimeEvidence shape verbatim under steps_payload.v3 even when no v3 sub-tree exists yet', async () => {
    mockedClient.getDiscoveryRun.mockResolvedValue({ steps_payload: {} });
    const runSummary = buildRunSummary();

    await persistRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      runSummary,
    });

    const payload = mockedClient.updateDiscoveryRun.mock.calls[0][2];
    expect(payload.steps_payload).toEqual({
      v3: { runtimeEvidence: runSummary },
    });
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('persistRuntimeEvidence — failure isolation', () => {
  it('warns and does NOT throw when the run-level write fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedClient.getDiscoveryRun.mockResolvedValue({ steps_payload: {} });
    mockedClient.updateDiscoveryRun.mockRejectedValueOnce(
      new Error('boom on run-level write'),
    );

    await persistRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      runSummary: buildRunSummary(),
    });

    // Warning emitted for the failed run-level write.
    expect(warnSpy).toHaveBeenCalled();
    // Still no per-candidate PUTs.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
