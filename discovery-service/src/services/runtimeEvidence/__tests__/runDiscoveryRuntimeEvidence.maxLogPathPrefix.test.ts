/**
 * Tests for the orchestrator's `M` (`maxLogPathPrefixSegments`) read +
 * thread-into-matcher behaviour.
 *
 * Discovery Run Robustness Section 1, Task Group 2:
 *   - The orchestrator reads
 *     `configSnapshot.runtimeEvidenceConfig.maxLogPathPrefixSegments`,
 *     clamps to `[0..5]`, defaults to `1` on missing/invalid, and threads
 *     the value into the matcher as the options-object third arg.
 *
 * The matcher is mocked to record the third argument passed to it.
 * Format / IO is exercised via the existing CLF fixture so the matcher
 * is actually invoked (a no-logs short-circuit would skip the matcher).
 */

jest.mock('../endpointRuntimeMatcher', () => ({
  matchAggregatesToCandidates: jest.fn(() => ({
    matched: [],
    noUsage: [],
    ambiguousObservations: [],
  })),
}));

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
import { matchAggregatesToCandidates } from '../endpointRuntimeMatcher';
import { archModelClient } from '../../archModelClient';

const mockedMatcher = matchAggregatesToCandidates as jest.Mock;
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

function makeConfigSnapshot(
  runtimeEvidenceConfig?: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    inputArtifacts: {
      logFiles: [
        {
          artifactId: 'a-clf',
          originalFileName: 'sample-clf.log',
          relativePath: 'sample-clf.log',
        },
      ],
    },
  };
  if (runtimeEvidenceConfig !== undefined) {
    snapshot.runtimeEvidenceConfig = runtimeEvidenceConfig;
  }
  return snapshot;
}

async function runOrchestrator(
  configSnapshot: Record<string, unknown>,
): Promise<void> {
  await runDiscoveryRuntimeEvidence({
    projectId: 'proj-1',
    runId: 'run-1',
    projectFolder: FIXTURES_DIR,
    deterministicCandidates: [],
    configSnapshot,
  });
}

function getOptionsArg(): { maxLogPathPrefixSegments: number } {
  expect(mockedMatcher).toHaveBeenCalledTimes(1);
  const call = mockedMatcher.mock.calls[0];
  // matchAggregatesToCandidates(aggregates, candidates, options)
  expect(call.length).toBeGreaterThanOrEqual(3);
  return call[2] as { maxLogPathPrefixSegments: number };
}

beforeEach(() => {
  mockedMatcher.mockClear();
  mockedMatcher.mockImplementation(() => ({
    matched: [],
    noUsage: [],
    ambiguousObservations: [],
  }));
  mockedClient.updateCandidate.mockReset();
  mockedClient.updateDiscoveryRun.mockReset();
  mockedClient.getDiscoveryRun.mockReset();
  mockedClient.getCandidatesByRun.mockReset();
  mockedClient.getDiscoveryRun.mockResolvedValue({ steps_payload: {} });
  mockedClient.updateDiscoveryRun.mockResolvedValue({});
  mockedClient.updateCandidate.mockResolvedValue({});
  mockedClient.getCandidatesByRun.mockResolvedValue([]);
});

describe('runDiscoveryRuntimeEvidence — maxLogPathPrefixSegments wiring', () => {
  it('threads a configured value (e.g. 3) through to the matcher as the options-object third arg', async () => {
    await runOrchestrator(makeConfigSnapshot({ maxLogPathPrefixSegments: 3 }));
    expect(getOptionsArg()).toEqual({ maxLogPathPrefixSegments: 3 });
  });

  it('defaults to 1 when `runtimeEvidenceConfig` is entirely absent from config_snapshot', async () => {
    await runOrchestrator(makeConfigSnapshot(undefined));
    expect(getOptionsArg()).toEqual({ maxLogPathPrefixSegments: 1 });
  });

  it('clamps out-of-range numerics: 99 -> 5, negative -> 0', async () => {
    await runOrchestrator(makeConfigSnapshot({ maxLogPathPrefixSegments: 99 }));
    expect(getOptionsArg()).toEqual({ maxLogPathPrefixSegments: 5 });

    mockedMatcher.mockClear();
    await runOrchestrator(makeConfigSnapshot({ maxLogPathPrefixSegments: -7 }));
    expect(getOptionsArg()).toEqual({ maxLogPathPrefixSegments: 0 });
  });

  it('falls back to the default of 1 when the value has the wrong type (e.g. "two")', async () => {
    await runOrchestrator(
      makeConfigSnapshot({ maxLogPathPrefixSegments: 'two' as unknown as number }),
    );
    expect(getOptionsArg()).toEqual({ maxLogPathPrefixSegments: 1 });
  });
});
