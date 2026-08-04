/**
 * Orchestrator-level tests for the Task Group 7 dead-branch fix: Stage 2.5 now
 * writes `source='log'` discovery_evidence rows from the rich observations the
 * quality-first extraction pipeline produces.
 *
 * THE GAP-CLEARING LINK (documented, AMS read-only / NOT modified by this spec):
 * AMS `MigrationDiscoveryContextService.buildRuntimeUsageSummary` (~lines
 * 954-971) computes
 *   `runtimeEvidence = count of discovery_evidence rows where source == 'log'`
 *   `hasRuntimeEvidence = runtimeEvidence > 0 || runtimeFindings > 0`.
 * The `insufficient_runtime_evidence` gap fires only when `hasRuntimeEvidence`
 * is false. Therefore the EXACT precondition that clears the gap is "at least
 * one evidence atom with `source === 'log'` is written via bulkSaveEvidence".
 * These tests assert that precondition directly (the AMS-side count is verified
 * by reading the Java, not by an integration round-trip).
 *
 * `archModelClient` is mocked via the `jest.requireActual` spread (the client
 * has 20+ methods; a partial mock would break unrelated importers).
 * `findingEmitter` is mocked so the best-effort findings path can be asserted
 * without an AMS round-trip.
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
import { DiscoveryCandidate } from '../../../types/candidate';
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

/** A relay that always reports "no pattern" -> forces the TG1 fallback matcher. */
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
    synthesizedAt: '2026-06-20T00:00:00Z',
  } as DiscoveryCandidate;
}

function allSavedAtoms(): EvidenceAtom[] {
  return mockedClient.bulkSaveEvidence.mock.calls.flatMap(
    (c) => c[2] as EvidenceAtom[],
  );
}

describe('runDiscoveryRuntimeEvidence — source=log evidence write (TG7 dead-branch fix)', () => {
  it('writes >=1 source:log atom from an absolute-URL log via the broadened fallback matcher', async () => {
    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      // No candidates at all -> nothing can match. Evidence must STILL be written.
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

    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });

    // bulkSaveEvidence called with >=1 atom.
    expect(mockedClient.bulkSaveEvidence).toHaveBeenCalled();
    const atoms = allSavedAtoms();
    expect(atoms.length).toBeGreaterThanOrEqual(1);

    // THE gap-clearing precondition: every atom is source:'log'.
    expect(atoms.every((a) => a.source === 'log')).toBe(true);
    // The SampleSvc POST http://host:8080/api/orders line (the load-bearing absolute
    // URL the OLD regex extracted ZERO from) is present as endpoint_usage_log.
    expect(
      atoms.some(
        (a) =>
          (a.data as { patternName?: string }).patternName === 'endpoint_usage_log' &&
          (a.data as { matchedText?: string }).matchedText === 'POST /api/orders',
      ),
    ).toBe(true);
  });

  it('writes source:log evidence even when ZERO candidates match (evidence alone clears the gap)', async () => {
    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      // A candidate that matches NOTHING in the fixture.
      deterministicCandidates: [makeEndpointCandidate('c-x', 'GET', '/totally/unrelated')],
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

    const atoms = allSavedAtoms();
    // hasRuntimeEvidence flips true purely from source:log evidence count > 0.
    const logAtomCount = atoms.filter((a) => a.source === 'log').length;
    expect(logAtomCount).toBeGreaterThanOrEqual(1);
  });

  it('emits best-effort runtime_usage findings on a match, AND still writes evidence', async () => {
    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [
        // Matches the GET /api/users/{id} aggregate from the fixture.
        makeEndpointCandidate('c-users', 'GET', '/api/users/{id}'),
      ],
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

    // Evidence still written (the hard requirement).
    expect(allSavedAtoms().filter((a) => a.source === 'log').length).toBeGreaterThanOrEqual(1);

    // Best-effort: a runtime_usage finding was emitted for the matched endpoint.
    expect(mockedEmitter.emitFindings).toHaveBeenCalled();
    const emitted = mockedEmitter.emitFindings.mock.calls.flatMap((c) => c[1]);
    expect(
      emitted.some(
        (fi: { findingType?: string; category?: string }) =>
          fi.category === 'runtime_usage' && fi.findingType === 'runtime_usage_observation',
      ),
    ).toBe(true);
  });

  it('does NOT block the run or the evidence write when findings emission throws', async () => {
    mockedEmitter.emitFindings.mockRejectedValueOnce(new Error('AMS down'));

    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [makeEndpointCandidate('c-users', 'GET', '/api/users/{id}')],
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

    // Run completed (never threw) and evidence was still written.
    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    expect(allSavedAtoms().filter((a) => a.source === 'log').length).toBeGreaterThanOrEqual(1);
  });

  it('persists the recipe into steps_payload.v3.runtimeEvidence.recipe when a recipe is accepted', async () => {
    // A relay that returns a valid recipe for the SampleSvc `reqId=N > METHOD <url>`
    // shape so induction is ACCEPTED and the recipe is persisted + reused.
    const recipeRelay: LogRecipeRelay = {
      induceLogRecipe: jest.fn(async () => ({
        content: JSON.stringify({
          recordDelimiter: { kind: 'single_line' },
          fields: {
            method: { kind: 'regex', pattern: '>\\s+([A-Z]+)\\s+https?://' },
            path: { kind: 'regex', pattern: '>\\s+[A-Z]+\\s+(https?://[^\\s]+)' },
            responseStatus: { kind: 'regex', pattern: 'statusCode=(\\d{3})' },
          },
        }),
      })),
    };

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
      logRecipeRelay: recipeRelay,
    });

    // The run-summary write carried a recipe under v3.runtimeEvidence.recipe.
    const recipeWrites = mockedClient.updateDiscoveryRun.mock.calls.filter((c) => {
      const sp = (c[2] as { steps_payload?: Record<string, unknown> })?.steps_payload;
      const v3 = (sp?.v3 as Record<string, unknown> | undefined) ?? {};
      const re = (v3.runtimeEvidence as Record<string, unknown> | undefined) ?? {};
      return re.recipe !== undefined && Object.keys(re.recipe as object).length > 0;
    });
    expect(recipeWrites.length).toBeGreaterThanOrEqual(1);
    // Evidence still written from the recipe-extracted rich observations.
    expect(allSavedAtoms().filter((a) => a.source === 'log').length).toBeGreaterThanOrEqual(1);
  });
});
