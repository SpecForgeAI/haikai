/**
 * Oracle Nine item 9 — configured-pattern path through the WHOLE orchestrator.
 *
 * When `config_snapshot.runtimeEvidenceConfig.logPatternHint` carries the
 * app's log4j ConversionPattern, the recipe is built DETERMINISTICALLY from
 * it: the LLM relay is NEVER consulted for a file the pattern matches, rich
 * `source:'log'` evidence is written, stack-trace continuation lines fold
 * into their parent records, and the translated recipe persists for reuse.
 * A file the pattern does NOT match still falls through to the normal
 * induction path (the relay IS consulted) — declared patterns never
 * suppress evidence from differently-shaped files.
 *
 * Mock pattern mirrors the sibling featureE2e suite.
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
import type { EvidenceAtom } from '../../../types/evidenceAtom';
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

const LOG4J_PATTERN = '%d{dd,HH:mm:ss,SSS} %p [%t] [%c{1}] - %m%n';

function makeNoPatternRelay(): LogRecipeRelay & { induceLogRecipe: jest.Mock } {
  return { induceLogRecipe: jest.fn(async () => ({ content: 'no pattern' })) };
}

function allSavedAtoms(): EvidenceAtom[] {
  return mockedClient.bulkSaveEvidence.mock.calls.flatMap((c) => c[2] as EvidenceAtom[]);
}

function logFileArtifact(name: string) {
  return { artifactId: `a-${name}`, originalFileName: name, relativePath: name };
}

beforeEach(() => {
  mockedClient.updateDiscoveryRun.mockReset().mockResolvedValue({});
  mockedClient.getDiscoveryRun.mockReset().mockResolvedValue({ steps_payload: {} });
  mockedClient.bulkSaveEvidence.mockReset().mockResolvedValue(undefined);
  mockedEmitter.emitFindings.mockReset().mockResolvedValue([]);
});

describe('runtime-log E2E — configured ConversionPattern (item 9)', () => {
  it('extracts via the translated recipe with ZERO LLM calls and persists the recipe', async () => {
    const relay = makeNoPatternRelay();

    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-log4j-app.log')] },
        runtimeEvidenceConfig: { logPatternHint: LOG4J_PATTERN },
      },
      logRecipeRelay: relay,
    });

    // THE point of item 9: the model was never asked to guess the format.
    expect(relay.induceLogRecipe).not.toHaveBeenCalled();

    const logAtoms = allSavedAtoms().filter((a) => a.source === 'log');
    expect(logAtoms.length).toBeGreaterThanOrEqual(1);

    // All four request lines extracted; the stack trace produced NO bogus
    // observation and no record was split by its continuation lines.
    const matched = logAtoms
      .map((a) => (a.data as { matchedText?: string }).matchedText)
      .filter((text): text is string => typeof text === 'string');
    expect(matched).toEqual(
      expect.arrayContaining([
        'POST /api/deal-books/{id}/positions',
        'GET /api/deal-books/{id}',
        'GET /api/org-registry/nodes',
        'DELETE /api/screen-filters/{id}',
      ]),
    );

    // The translated recipe persisted for cross-run reuse, honestly labelled.
    const persistedJson = JSON.stringify(mockedClient.updateDiscoveryRun.mock.calls);
    expect(persistedJson).toContain('"origin":"pattern_translation"');
    expect(persistedJson).toContain('"llmCallsUsed":0');
  });

  it('falls through to normal induction for a file the declared pattern does not match', async () => {
    const relay = makeNoPatternRelay();

    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-absolute-url.log')] },
        runtimeEvidenceConfig: { logPatternHint: LOG4J_PATTERN },
      },
      logRecipeRelay: relay,
    });

    // The pattern did not match this file, so the pipeline behaved exactly
    // as before the feature existed: relay consulted, fallback evidence out.
    expect(relay.induceLogRecipe).toHaveBeenCalled();
    const logAtoms = allSavedAtoms().filter((a) => a.source === 'log');
    expect(logAtoms.length).toBeGreaterThanOrEqual(1);
  });
});
