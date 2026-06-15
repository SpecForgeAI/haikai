/**
 * Tests for the runtime evidence orchestrator
 * (`runDiscoveryRuntimeEvidence`).
 *
 * Post-hotfix-2026-05-12-A the orchestrator NEVER PUTs individual
 * candidates -- it mutates the in-memory `deterministicCandidates` list
 * so the downstream bulk-save path carries `logEnrichment.runtime`
 * through to AMS. The tests assert both behaviours: the in-memory
 * mutation occurred, and `archModelClient.updateCandidate` was not
 * called.
 *
 * Per Spec 5 Task 4.1, focused on the critical orchestrator behaviours:
 *   - No-logs short-circuit returns `{ skipped: true, reason: 'no_log_artifacts' }`
 *     and persists the same to `steps_payload.v3.runtimeEvidence`.
 *   - File-missing-on-disk records a warning, skips that file, continues
 *     with the remaining files.
 *   - All-files-fail short-circuit returns
 *     `{ skipped: true, reason: 'log_processing_failed', warnings: [...] }`.
 *   - Happy path produces matched evidence + no-usage entries +
 *     unmatched hints (using a real on-disk CLF fixture file so the
 *     orchestrator's `fs.createReadStream` path is exercised).
 *
 * The `archModelClient` is mocked via the `jest.requireActual` spread
 * pattern (per project memory feedback `jest.mock` + `requireActual`
 * is required because the client has 22+ methods and a partial mock
 * would break unrelated callers in the import graph).
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

import * as path from 'path';
import { runDiscoveryRuntimeEvidence } from '../runDiscoveryRuntimeEvidence';
import { archModelClient } from '../../archModelClient';
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
  // Default: existing discovery run with no v3 sub-tree.
  mockedClient.getDiscoveryRun.mockResolvedValue({ steps_payload: {} });
  mockedClient.updateDiscoveryRun.mockResolvedValue({});
  mockedClient.updateCandidate.mockResolvedValue({});
  mockedClient.getCandidatesByRun.mockResolvedValue([]);
});

const FIXTURES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '__tests__',
  'fixtures',
  'runtimeEvidence',
);

function makeEndpointCandidate(
  id: string,
  method: string,
  pathTemplate: string,
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'endpoints',
    name: `${method} ${pathTemplate}`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { method, pathTemplate, _addedBy: 'test-adapter' },
    synthesizedAt: '2026-05-10T00:00:00Z',
  } as DiscoveryCandidate;
}

describe('runDiscoveryRuntimeEvidence — short-circuits', () => {
  it('returns { skipped: no_log_artifacts } and persists same when configSnapshot has no log files', async () => {
    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: '/tmp/nonexistent-project',
      deterministicCandidates: [],
      configSnapshot: { inputArtifacts: { logFiles: [] } },
    });

    expect(result.persistenceSummary).toEqual({
      skipped: true,
      reason: 'no_log_artifacts',
    });
    // Empty LLM context (zero counts).
    expect(result.llmContext.runtimeEvidenceSummary.logFilesProcessed).toBe(0);
    expect(result.llmContext.runtimeEvidenceSummary.matchedEndpoints).toEqual([]);

    // Run-level write occurred with the skipped marker preserved verbatim.
    expect(mockedClient.updateDiscoveryRun).toHaveBeenCalledTimes(1);
    const [, , payload] = mockedClient.updateDiscoveryRun.mock.calls[0];
    expect(payload.steps_payload).toEqual({
      v3: { runtimeEvidence: { skipped: true, reason: 'no_log_artifacts' } },
    });

    // No per-candidate PUT -- the runtime-evidence stage must never
    // call updateCandidate from inside the V3 pipeline.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });

  it('all-files-fail returns { skipped: log_processing_failed, warnings } when every artifact is missing on disk', async () => {
    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: '/tmp/no-such-dir-xyz',
      deterministicCandidates: [],
      configSnapshot: {
        inputArtifacts: {
          logFiles: [
            {
              artifactId: 'a1',
              originalFileName: 'missing-1.log',
              relativePath: 'discovery-runs/run-1/logs/missing-1.log',
            },
            {
              artifactId: 'a2',
              originalFileName: 'missing-2.log',
              relativePath: 'discovery-runs/run-1/logs/missing-2.log',
            },
          ],
        },
      },
    });

    expect(result.persistenceSummary).toMatchObject({
      skipped: true,
      reason: 'log_processing_failed',
    });
    const summary = result.persistenceSummary as {
      skipped: true;
      reason: string;
      warnings: string[];
    };
    // One warning per missing file.
    expect(summary.warnings.length).toBeGreaterThanOrEqual(2);
    expect(summary.warnings[0]).toMatch(/missing on disk/i);

    // Run-level write reflects the failure marker.
    const [, , payload] = mockedClient.updateDiscoveryRun.mock.calls[0];
    expect((payload.steps_payload as Record<string, unknown>).v3).toMatchObject({
      runtimeEvidence: {
        skipped: true,
        reason: 'log_processing_failed',
      },
    });

    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('runDiscoveryRuntimeEvidence — file-missing tolerance', () => {
  it('records a warning and continues when ONE of two files is missing on disk', async () => {
    const candidates = [
      makeEndpointCandidate('cand-users', 'GET', '/api/users/{id}'),
    ];

    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      // The fixture file lives under the discovery-service tree; we point
      // projectFolder at it directly so `relativePath` resolves to the
      // fixture name (acting as the "in-project" relative path).
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: candidates,
      configSnapshot: {
        inputArtifacts: {
          logFiles: [
            {
              artifactId: 'a-missing',
              originalFileName: 'does-not-exist.log',
              relativePath: 'does-not-exist.log',
            },
            {
              artifactId: 'a-clf',
              originalFileName: 'sample-clf.log',
              relativePath: 'sample-clf.log',
            },
          ],
        },
      },
    });

    // Happy-path summary returned (one file processed, one warning).
    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    const summary = result.persistenceSummary as {
      logFilesProcessed: number;
      warnings: string[];
      totals: { observations: number; matchedEndpoints: number };
    };
    expect(summary.logFilesProcessed).toBe(1);
    expect(summary.warnings.length).toBeGreaterThanOrEqual(1);
    expect(summary.warnings.some((w) => /does-not-exist/.test(w))).toBe(true);
    // The matching candidate `/api/users/{id}` should have a matched aggregate.
    expect(summary.totals.matchedEndpoints).toBeGreaterThanOrEqual(1);

    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
  });
});

describe('runDiscoveryRuntimeEvidence — happy path', () => {
  it('produces matched + no-usage + unmatched-hint entries from a real CLF fixture and mutates candidates in memory', async () => {
    const candidates = [
      // Will MATCH the /api/users/{id} aggregates.
      makeEndpointCandidate('cand-users', 'GET', '/api/users/{id}'),
      // Will NOT match anything in the fixture -> no-usage row.
      makeEndpointCandidate('cand-products', 'GET', '/api/products/{id}'),
    ];

    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: candidates,
      configSnapshot: {
        inputArtifacts: {
          logFiles: [
            {
              artifactId: 'a-clf',
              originalFileName: 'sample-clf.log',
              relativePath: 'sample-clf.log',
            },
          ],
        },
      },
    });

    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    const summary = result.persistenceSummary as {
      logFilesProcessed: number;
      logWindow: { firstSeen?: string; lastSeen?: string };
      totals: {
        observations: number;
        matchedEndpoints: number;
        noUsageEndpoints: number;
        unmatchedHints: number;
      };
      unmatchedRouteHints: Array<{
        method: string;
        pathTemplate: string;
        observedUsageCount: number;
      }>;
    };

    expect(summary.logFilesProcessed).toBe(1);
    expect(summary.totals.observations).toBeGreaterThan(0);

    // /api/users/{id} matched (>=1 matched candidate).
    expect(summary.totals.matchedEndpoints).toBeGreaterThanOrEqual(1);
    // /api/products/{id} got a no-usage row.
    expect(summary.totals.noUsageEndpoints).toBeGreaterThanOrEqual(1);
    // /api/orphan-route/{id} appears 6x with 200 -> unmatched hint
    // (default RUNTIME_UNMATCHED_HINT_THRESHOLD=5).
    expect(summary.totals.unmatchedHints).toBeGreaterThanOrEqual(1);
    expect(
      summary.unmatchedRouteHints.some(
        (h) => h.pathTemplate === '/api/orphan-route/{id}' && h.method === 'GET',
      ),
    ).toBe(true);

    // Post-hotfix-2026-05-12-A: per-candidate evidence is applied to the
    // in-memory candidate list, NOT written via per-candidate PUTs.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();

    const usersCand = candidates.find((c) => c.id === 'cand-users')!;
    const productsCand = candidates.find((c) => c.id === 'cand-products')!;

    // Matched candidate carries the `runtime.matched` payload in memory.
    const usersRuntime =
      (usersCand.logEnrichment as unknown as { runtime?: { matched?: Record<string, unknown> } })?.runtime;
    expect(usersRuntime?.matched).toBeDefined();
    expect(usersRuntime!.matched!.candidateId).toBe('cand-users');
    expect(usersRuntime!.matched!.codePathTemplate).toBe('/api/users/{id}');

    // No-usage candidate carries the `runtime.noUsageObserved` flag in memory.
    const productsRuntime =
      (productsCand.logEnrichment as unknown as { runtime?: { noUsageObserved?: boolean } })?.runtime;
    expect(productsRuntime?.noUsageObserved).toBe(true);

    // LLM context shape -- privacy: NO snippet/IP/user-agent fields.
    const ctx = result.llmContext.runtimeEvidenceSummary;
    expect(ctx.matchedEndpoints.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toMatch(/Mozilla/);
    expect(serialized).not.toMatch(/127\.0\.0\.1/);
  });
});
