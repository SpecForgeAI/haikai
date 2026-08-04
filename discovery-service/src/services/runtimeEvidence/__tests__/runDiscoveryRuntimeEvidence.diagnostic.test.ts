/**
 * Task Group 8 tests: ~0-extraction-despite-pre-scan-hits diagnostic.
 *
 * When the streaming pre-scan detects request-like lines but the extraction
 * pipeline recovers ~no observations (e.g. a bespoke plaintext log whose request
 * lines carry no status and no inducible recipe), the runtime stage MUST:
 *   - record a structured `extractionOutcome` under
 *     `steps_payload.v3.runtimeEvidence` (NOT a new gap type),
 *   - emit a LOW-severity `runtime_log`-category finding for visibility,
 *   - and NEVER fail the run.
 *
 * The fixture `sample-hits-no-status.log` is plaintext (fails the JSON-lines
 * fast-path richness gate) whose request lines have a verb + `/path` (so the
 * pre-scan flags them as hits) but NO 3-digit status (so the broadened fallback
 * matcher, which requires a status, extracts nothing). The mock relay returns
 * "no pattern" so no recipe is induced -> the ~0-despite-hits branch fires.
 */

jest.mock('../../archModelClient', () => {
  const actual = jest.requireActual('../../archModelClient');
  return {
    ...actual,
    archModelClient: {
      ...actual.archModelClient,
      updateDiscoveryRun: jest.fn(),
      getDiscoveryRun: jest.fn(),
      bulkSaveEvidence: jest.fn(),
    },
  };
});

jest.mock('../../findings/FindingEmitter', () => {
  const actual = jest.requireActual('../../findings/FindingEmitter');
  return {
    ...actual,
    findingEmitter: {
      emitFindings: jest.fn(),
      emitFinding: jest.fn(),
      clearRunCache: jest.fn(),
      getRunAggregate: jest.fn(),
    },
  };
});

import * as path from 'path';
import { runDiscoveryRuntimeEvidence } from '../runDiscoveryRuntimeEvidence';
import { archModelClient } from '../../archModelClient';
import { findingEmitter } from '../../findings/FindingEmitter';
import type { LogRecipeRelay } from '../logRecipeInduction';

const mockedClient = archModelClient as unknown as {
  updateDiscoveryRun: jest.Mock;
  getDiscoveryRun: jest.Mock;
  bulkSaveEvidence: jest.Mock;
};
const mockedEmitter = findingEmitter as unknown as { emitFindings: jest.Mock };

const FIXTURES_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '__tests__',
  'fixtures',
  'runtimeEvidence',
);

const NO_PATTERN_RELAY: LogRecipeRelay = {
  induceLogRecipe: jest.fn(async () => ({ content: 'no pattern' })),
};

beforeEach(() => {
  mockedClient.updateDiscoveryRun.mockReset().mockResolvedValue({});
  mockedClient.getDiscoveryRun.mockReset().mockResolvedValue({ steps_payload: {} });
  mockedClient.bulkSaveEvidence.mockReset().mockResolvedValue(undefined);
  mockedEmitter.emitFindings.mockReset().mockResolvedValue([]);
  (NO_PATTERN_RELAY.induceLogRecipe as jest.Mock).mockClear();
});

function runWithNoStatusLog() {
  return runDiscoveryRuntimeEvidence({
    projectId: 'proj-1',
    runId: 'run-1',
    projectFolder: FIXTURES_DIR,
    deterministicCandidates: [],
    configSnapshot: {
      repoUrl: 'https://example.com/app.git',
      inputArtifacts: {
        logFiles: [
          {
            artifactId: 'a-nostatus',
            originalFileName: 'sample-hits-no-status.log',
            relativePath: 'sample-hits-no-status.log',
          },
        ],
      },
    },
    logRecipeRelay: NO_PATTERN_RELAY,
  });
}

/** Pull the last steps_payload.v3.runtimeEvidence written via updateDiscoveryRun. */
function lastRuntimeEvidencePayload(): Record<string, unknown> {
  const calls = mockedClient.updateDiscoveryRun.mock.calls;
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const last = calls[calls.length - 1];
  const sp = (last[2] as { steps_payload?: Record<string, unknown> }).steps_payload ?? {};
  const v3 = (sp.v3 as Record<string, unknown> | undefined) ?? {};
  return (v3.runtimeEvidence as Record<string, unknown> | undefined) ?? {};
}

describe('runDiscoveryRuntimeEvidence — ~0-despite-hits diagnostic (TG8)', () => {
  it('records a structured extractionOutcome in steps_payload.v3.runtimeEvidence', async () => {
    await runWithNoStatusLog();

    const re = lastRuntimeEvidencePayload();
    expect(re.extractionOutcome).toBeDefined();
    const outcome = re.extractionOutcome as Record<string, unknown>;
    expect(outcome.preScanHits as number).toBeGreaterThan(0);
    expect(outcome.observations).toBe(0);
    expect(typeof outcome.reason).toBe('string');
    expect('sampledBlocks' in outcome).toBe(true);
  });

  it('completes the run (never throws) and writes no source:log evidence in this case', async () => {
    const result = await runWithNoStatusLog();
    // Run returned a valid (non-skipped) result.
    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    expect(result.llmContext).toBeDefined();
    // Nothing was extractable, so no evidence atoms were written.
    const atomsWritten = mockedClient.bulkSaveEvidence.mock.calls.flatMap((c) => c[2]);
    expect(atomsWritten.length).toBe(0);
  });

  it('emits a LOW-severity runtime_log finding for visibility', async () => {
    await runWithNoStatusLog();

    expect(mockedEmitter.emitFindings).toHaveBeenCalled();
    const emitted = mockedEmitter.emitFindings.mock.calls.flatMap((c) => c[1]) as Array<{
      findingType: string;
      category: string;
      severity: string;
    }>;
    const diag = emitted.find((fi) => fi.category === 'runtime_log');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('low');
    expect(diag!.findingType).toBe('runtime_log_extraction_incomplete');
  });

  it('introduces NO new gap type: the diagnostic is not an evidence_gap finding', async () => {
    await runWithNoStatusLog();
    const emitted = mockedEmitter.emitFindings.mock.calls.flatMap((c) => c[1]) as Array<{
      findingType: string;
      category: string;
      detailJson?: Record<string, unknown> | null;
    }>;
    // The diagnostic must NOT be modelled as an evidence_gap (no new gapType).
    const diag = emitted.find((fi) => fi.findingType === 'runtime_log_extraction_incomplete');
    expect(diag).toBeDefined();
    expect(diag!.category).not.toBe('evidence_gap');
    expect(diag!.detailJson && 'gapType' in (diag!.detailJson as object)).toBeFalsy();
  });

  it('does NOT fire the diagnostic when extraction succeeds (no false positive)', async () => {
    // The absolute-URL fixture DOES extract (status present) -> no diagnostic.
    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: {
          logFiles: [
            {
              artifactId: 'a-samplesvc',
              originalFileName: 'sample-absolute-url.log',
              relativePath: 'sample-absolute-url.log',
            },
          ],
        },
      },
      logRecipeRelay: NO_PATTERN_RELAY,
    });

    const re = lastRuntimeEvidencePayload();
    expect(re.extractionOutcome).toBeUndefined();
    const emitted = mockedEmitter.emitFindings.mock.calls.flatMap((c) => c[1]) as Array<{
      category: string;
    }>;
    expect(emitted.some((fi) => fi.category === 'runtime_log')).toBe(false);
  });
});
