/**
 * End-to-end orchestrator tests for `runDiscoveryRuntimeEvidence`
 * (Spec 5 Task 5.3).
 *
 * Post-hotfix-2026-05-12-A the runtime-evidence stage mutates the
 * in-memory candidate list rather than PUT'ing each candidate via
 * `archModelClient.updateCandidate` (the previous behaviour caused
 * "Candidate not found" 400s because the V3 pipeline persists Stage 2
 * candidates AFTER this stage runs). The assertions therefore look at
 * the mutated `logEnrichment.runtime` payload on the candidate objects
 * passed in, NOT at the (no-longer-issued) per-candidate PUT calls.
 *
 * The per-group orchestrator suite (Group 4) covers the four critical
 * behaviours called out in 4.1: no-logs short-circuit, file-missing
 * tolerance, all-files-fail short-circuit, and the happy path on a
 * pure-CLF fixture. This file fills two strategic gaps identified in
 * Task 5.2 that cannot be exercised through unit tests alone:
 *
 *   1. Mixed-format input (CLF + JSONL in the SAME run) -- exercises
 *      the orchestrator's per-file format-detection branch and proves
 *      that observations from BOTH formats contribute to the matched
 *      `logEnrichment.runtime` payload mutated onto the candidate.
 *   2. File-size cap exceeded -- exercises the
 *      `LOG_PARSE_MAX_FILE_BYTES` skip path: the run continues with the
 *      remaining files and a warning is recorded in the run summary.
 *
 * Mock pattern: `archModelClient` is mocked via the
 * `jest.requireActual` spread (per project memory).
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archModelClient } from '../../archModelClient';
import { DiscoveryCandidate } from '../../../types/candidate';

const mockedClient = archModelClient as unknown as {
  updateCandidate: jest.Mock;
  updateDiscoveryRun: jest.Mock;
  getDiscoveryRun: jest.Mock;
  getCandidatesByRun: jest.Mock;
};

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

beforeEach(() => {
  mockedClient.updateCandidate.mockReset();
  mockedClient.updateDiscoveryRun.mockReset();
  mockedClient.getDiscoveryRun.mockReset();
  mockedClient.getCandidatesByRun.mockReset();
  mockedClient.getDiscoveryRun.mockResolvedValue({ steps_payload: {} });
  mockedClient.updateDiscoveryRun.mockResolvedValue({});
  mockedClient.updateCandidate.mockResolvedValue({});
  mockedClient.getCandidatesByRun.mockResolvedValue([]);
});

describe('runDiscoveryRuntimeEvidence — end-to-end mixed CLF + JSONL', () => {
  it('processes both a CLF file and a JSONL file in the same run, contributing observations to the in-memory matched logEnrichment.runtime payload on each candidate', async () => {
    const { runDiscoveryRuntimeEvidence } = await import(
      '../runDiscoveryRuntimeEvidence'
    );

    // Two endpoint candidates: one matches the CLF traffic
    // (`/api/users/{id}`), the other matches the JSONL traffic
    // (`/api/orders`).
    const candidates: DiscoveryCandidate[] = [
      makeEndpointCandidate('cand-users', 'GET', '/api/users/{id}'),
      makeEndpointCandidate('cand-orders', 'POST', '/api/orders'),
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
            {
              artifactId: 'a-jsonl',
              originalFileName: 'sample-jsonl.log',
              relativePath: 'sample-jsonl.log',
            },
          ],
        },
      },
    });

    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    const summary = result.persistenceSummary as {
      logFilesProcessed: number;
      totals: {
        observations: number;
        matchedEndpoints: number;
        noUsageEndpoints: number;
      };
    };

    // Both files were processed.
    expect(summary.logFilesProcessed).toBe(2);
    // Observations come from BOTH formats (CLF has 15 lines, JSONL has 2).
    expect(summary.totals.observations).toBeGreaterThanOrEqual(15 + 1);
    // Both candidates matched (one per format).
    expect(summary.totals.matchedEndpoints).toBe(2);
    expect(summary.totals.noUsageEndpoints).toBe(0);

    // Per-candidate evidence is mutated in memory -- the bulk-save path
    // (RunManager.bulkSaveCandidates) is responsible for persisting it,
    // NOT this stage. No per-candidate PUT must be issued from here.
    expect(mockedClient.updateCandidate).not.toHaveBeenCalled();

    const usersCand = candidates.find((c) => c.id === 'cand-users')!;
    const ordersCand = candidates.find((c) => c.id === 'cand-orders')!;

    const usersRuntime =
      (usersCand.logEnrichment as unknown as { runtime?: { matched?: Record<string, unknown> } })?.runtime;
    expect(usersRuntime?.matched).toMatchObject({
      candidateId: 'cand-users',
      method: 'GET',
      codePathTemplate: '/api/users/{id}',
    });
    expect(
      (usersRuntime!.matched as { observedUsageCount: number }).observedUsageCount,
    ).toBeGreaterThanOrEqual(8);

    const ordersRuntime =
      (ordersCand.logEnrichment as unknown as { runtime?: { matched?: Record<string, unknown> } })?.runtime;
    expect(ordersRuntime?.matched).toMatchObject({
      candidateId: 'cand-orders',
      method: 'POST',
      codePathTemplate: '/api/orders',
    });
    // /api/orders appears once in CLF (201) and once in JSONL (201) -> 2.
    expect(
      (ordersRuntime!.matched as { observedUsageCount: number }).observedUsageCount,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('runDiscoveryRuntimeEvidence — end-to-end file-size cap exceeded', () => {
  it('records a warning and skips the oversized file while continuing with the remaining files', async () => {
    // Build an oversized fixture file in a temp directory; bump
    // LOG_PARSE_MAX_FILE_BYTES down so a small (~2KB) file trips the cap.
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'rte-size-cap-'),
    );
    try {
      const oversizedName = 'oversized.log';
      const oversizedPath = path.join(tempDir, oversizedName);
      // 2KB of CLF lines -- comfortably above an artificially low cap
      // and above the lower-bound fixture size.
      const clfLine =
        '127.0.0.1 - frank [10/Oct/2026:13:55:36 +0000] "GET /api/users/123 HTTP/1.1" 200 1024\n';
      const repeated = clfLine.repeat(40); // ~3KB
      await fs.promises.writeFile(oversizedPath, repeated, 'utf8');

      // Also drop a small CLF file that should still process.
      const smallName = 'small.log';
      const smallPath = path.join(tempDir, smallName);
      await fs.promises.writeFile(smallPath, clfLine, 'utf8');

      // Re-import the orchestrator with a tiny per-file cap so
      // `oversized.log` (~3KB) is rejected and `small.log` (~80B) survives.
      const originalCap = process.env.LOG_PARSE_MAX_FILE_BYTES;
      process.env.LOG_PARSE_MAX_FILE_BYTES = '256';

      let runDiscoveryRuntimeEvidence: typeof import('../runDiscoveryRuntimeEvidence').runDiscoveryRuntimeEvidence;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        runDiscoveryRuntimeEvidence = require('../runDiscoveryRuntimeEvidence').runDiscoveryRuntimeEvidence;
      });

      const candidates = [
        makeEndpointCandidate('cand-users', 'GET', '/api/users/{id}'),
      ];

      try {
        const result = await runDiscoveryRuntimeEvidence!({
          projectId: 'proj-1',
          runId: 'run-1',
          projectFolder: tempDir,
          deterministicCandidates: candidates,
          configSnapshot: {
            inputArtifacts: {
              logFiles: [
                {
                  artifactId: 'a-oversized',
                  originalFileName: oversizedName,
                  relativePath: oversizedName,
                },
                {
                  artifactId: 'a-small',
                  originalFileName: smallName,
                  relativePath: smallName,
                },
              ],
            },
          },
        });

        // Run is NOT skipped -- we continued with the small file.
        expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
        const summary = result.persistenceSummary as {
          logFilesProcessed: number;
          warnings: string[];
          totals: { observations: number; matchedEndpoints: number };
        };

        // One file processed (the small one).
        expect(summary.logFilesProcessed).toBe(1);
        // Cap-exceeded warning recorded for the oversized file.
        expect(summary.warnings.some((w) => /exceeds per-file cap/i.test(w))).toBe(true);
        expect(summary.warnings.some((w) => w.includes(oversizedName))).toBe(true);
        // The small file's single observation matched the candidate.
        expect(summary.totals.observations).toBe(1);
        expect(summary.totals.matchedEndpoints).toBe(1);

        // No per-candidate PUT issued by this stage.
        expect(mockedClient.updateCandidate).not.toHaveBeenCalled();
      } finally {
        if (originalCap === undefined) {
          delete process.env.LOG_PARSE_MAX_FILE_BYTES;
        } else {
          process.env.LOG_PARSE_MAX_FILE_BYTES = originalCap;
        }
      }
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
