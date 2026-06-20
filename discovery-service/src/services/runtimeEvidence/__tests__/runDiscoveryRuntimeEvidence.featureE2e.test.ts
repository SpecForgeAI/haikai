/**
 * Task Group 9 — strategic end-to-end seams for the runtime-log evidence
 * feature. These complement (do NOT duplicate) the per-group suites by wiring
 * the WHOLE Stage-2.5 orchestrator through a real fixture for the seams that
 * unit tests cannot exercise:
 *
 *   Seam A (fallback E2E): an absolute-URL HiFi log for which the LLM returns
 *     "no pattern" still writes `source='log'` evidence via the broadened TG1
 *     matcher — AND we prove the relay was genuinely consulted first (the
 *     recipe path was attempted, then the fallback branch produced the
 *     evidence). The headline `bulkSaveEvidence(source:'log')` case itself is
 *     already covered by `runDiscoveryRuntimeEvidence.evidence.test.ts`; this
 *     pins the path that produced it.
 *
 *   Seam B (recipe E2E): a RICH multi-line HiFi log (headers + body + logged
 *     response) drives induction -> held-out validation (>=60%) -> the
 *     recipe-aware extractor assembles multi-line records across the FULL file
 *     -> RICH `source='log'` atoms are written (the response status flows into
 *     the atom's contextSnippet, proving rich fields survived end-to-end) and
 *     the recipe is persisted under steps_payload.v3.runtimeEvidence.recipe.
 *
 *   Seam C (recipe E2E findings): the same rich log with a matching candidate
 *     emits a best-effort `runtime_usage` finding AND still writes evidence.
 *
 *   Seam D (redaction invariant E2E): a fixture with a planted secret is run
 *     through the orchestrator; the secret NEVER appears in ANY `payload.prompt`
 *     the relay receives (the redaction happens on the real orchestrator path,
 *     not a unit-level bypass), while the relay WAS called.
 *
 * THE GAP-CLEARING LINK (AMS read-only, NOT modified by this spec):
 * `MigrationDiscoveryContextService.buildRuntimeUsageSummary` computes
 *   runtimeEvidence = count of discovery_evidence rows where source == 'log';
 *   hasRuntimeEvidence = runtimeEvidence > 0 || runtimeFindings > 0.
 * The `insufficient_runtime_evidence` gap fires only when hasRuntimeEvidence is
 * false, so "at least one atom with source === 'log' written via
 * bulkSaveEvidence" is the exact precondition these tests assert.
 *
 * Mock pattern mirrors the sibling evidence/diagnostic suites: `archModelClient`
 * via the `jest.requireActual` spread (the client has 20+ methods); the LLM
 * relay is ALWAYS a mock — no test hits a real gateway/LLM.
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

/**
 * A recipe that reads the RICH multi-line HiFi shape: records start at
 * `<id> > METHOD `; method/path from the start line, headers from
 * `<id> > name: value`, request body from the JSON line, response status/body
 * from the `<id> < ...` lines. Serialized as the relay's `content` (exactly the
 * STRUCTURED-recipe contract the gateway relay forwards verbatim).
 */
const RICH_HIFI_RECIPE = {
  recordDelimiter: { kind: 'start_regex', pattern: '^\\d+ > [A-Z]+ ' },
  fields: {
    method: { kind: 'regex', pattern: '^\\d+ > ([A-Z]+) ' },
    path: { kind: 'regex', pattern: '^\\d+ > [A-Z]+ https?://[^/]+(/\\S+)' },
    requestHeaders: {
      kind: 'line_regex',
      pattern: '^\\d+ > ([A-Za-z][A-Za-z0-9-]*): (.+)$',
      captureKeyValue: true,
    },
    requestBody: { kind: 'line_regex', pattern: '^\\d+ > (\\{.*\\})\\s*$' },
    responseStatus: { kind: 'line_regex', pattern: '^\\d+ < HTTP/[\\d.]+ (\\d{3})' },
    responseBody: { kind: 'line_regex', pattern: '^\\d+ < (\\{.*\\})\\s*$' },
  },
};

/** A relay that always reports "no pattern" -> forces the TG1 fallback matcher. */
function makeNoPatternRelay(): LogRecipeRelay & { induceLogRecipe: jest.Mock } {
  return { induceLogRecipe: jest.fn(async () => ({ content: 'no pattern' })) };
}

/** A relay that returns the rich HiFi recipe so induction is ACCEPTED. */
function makeRichRecipeRelay(): LogRecipeRelay & { induceLogRecipe: jest.Mock } {
  return {
    induceLogRecipe: jest.fn(async () => ({ content: JSON.stringify(RICH_HIFI_RECIPE) })),
  };
}

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

// ---------------------------------------------------------------------------
// Seam A — fallback path end-to-end (absolute URL, no recipe, broadened matcher)
// ---------------------------------------------------------------------------

describe('runtime-log E2E — fallback path (absolute URL, no valid recipe)', () => {
  it('consults the relay, gets "no pattern", and STILL writes source:log evidence via the broadened matcher', async () => {
    const relay = makeNoPatternRelay();

    const result = await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-hifi-absolute-url.log')] },
      },
      logRecipeRelay: relay,
    });

    // The recipe path was genuinely attempted (the relay was consulted) before
    // the fallback branch produced the evidence — this is the path under test.
    expect(relay.induceLogRecipe).toHaveBeenCalled();

    // The run completed and wrote source:'log' evidence purely from the
    // broadened deterministic matcher (the OLD regex extracted ZERO here).
    expect(result.persistenceSummary).not.toMatchObject({ skipped: true });
    const logAtoms = allSavedAtoms().filter((a) => a.source === 'log');
    expect(logAtoms.length).toBeGreaterThanOrEqual(1);
    // The load-bearing absolute-URL line surfaced as endpoint_usage_log.
    expect(
      logAtoms.some(
        (a) =>
          (a.data as { patternName?: string }).patternName === 'endpoint_usage_log' &&
          (a.data as { matchedText?: string }).matchedText === 'POST /api/orders',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seam B — recipe path end-to-end (rich multi-line induce -> validate -> extract)
// ---------------------------------------------------------------------------

describe('runtime-log E2E — recipe path (rich multi-line log)', () => {
  it('induces+validates a recipe, extracts rich observations full-file, and writes rich source:log evidence + persists the recipe', async () => {
    const relay = makeRichRecipeRelay();

    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-hifi-rich-multiline.log')] },
      },
      logRecipeRelay: relay,
    });

    // Induction was driven through the relay (the LLM recognises the format once).
    expect(relay.induceLogRecipe).toHaveBeenCalled();

    // Evidence written, every atom source:'log' (the gap-clearing precondition).
    const logAtoms = allSavedAtoms().filter((a) => a.source === 'log');
    expect(logAtoms.length).toBeGreaterThanOrEqual(1);

    // The fixture carries 5 distinct METHOD+normalizedPath endpoints
    // (POST /api/orders, GET /api/users/{id}, DELETE /api/orders/{id},
    // PUT /api/users/{id}) -> the multi-line records were assembled full-file.
    const matchedTexts = new Set(
      logAtoms.map((a) => (a.data as { matchedText?: string }).matchedText),
    );
    expect(matchedTexts.has('POST /api/orders')).toBe(true);
    expect(matchedTexts.has('GET /api/users/{id}')).toBe(true);

    // RICH fields survived end-to-end: the logged RESPONSE STATUS flows into the
    // atom contextSnippet (`METHOD rawPath -> status`). The thin fallback path
    // could never produce a `->` snippet for the POST, so this proves the
    // recipe-aware extractor (not the fallback) produced these atoms.
    const postAtom = logAtoms.find(
      (a) => (a.data as { matchedText?: string }).matchedText === 'POST /api/orders',
    );
    expect(postAtom).toBeDefined();
    expect((postAtom!.data as { contextSnippet?: string }).contextSnippet).toMatch(/->\s*201/);

    // The recipe was persisted under steps_payload.v3.runtimeEvidence.recipe.
    const recipeWrites = mockedClient.updateDiscoveryRun.mock.calls.filter((c) => {
      const sp = (c[2] as { steps_payload?: Record<string, unknown> })?.steps_payload;
      const v3 = (sp?.v3 as Record<string, unknown> | undefined) ?? {};
      const re = (v3.runtimeEvidence as Record<string, unknown> | undefined) ?? {};
      return re.recipe !== undefined && Object.keys(re.recipe as object).length > 0;
    });
    expect(recipeWrites.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a best-effort runtime_usage finding on a candidate match AND still writes evidence', async () => {
    const relay = makeRichRecipeRelay();

    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      // Matches the GET /api/users/{id} traffic in the rich fixture.
      deterministicCandidates: [makeEndpointCandidate('c-users', 'GET', '/api/users/{id}')],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-hifi-rich-multiline.log')] },
      },
      logRecipeRelay: relay,
    });

    // Hard requirement: evidence written regardless of matching.
    expect(allSavedAtoms().filter((a) => a.source === 'log').length).toBeGreaterThanOrEqual(1);

    // Best-effort: a runtime_usage finding emitted for the matched endpoint.
    expect(mockedEmitter.emitFindings).toHaveBeenCalled();
    const emitted = mockedEmitter.emitFindings.mock.calls.flatMap((c) => c[1]) as Array<{
      findingType?: string;
      category?: string;
    }>;
    expect(
      emitted.some(
        (fi) => fi.category === 'runtime_usage' && fi.findingType === 'runtime_usage_observation',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seam D — redaction invariant end-to-end (no secret reaches the relay)
// ---------------------------------------------------------------------------

describe('runtime-log E2E — redaction invariant', () => {
  it('never sends a planted secret to the relay payload, while the relay IS consulted', async () => {
    // Capture every prompt the relay receives across all (re)samples.
    const seenPrompts: string[] = [];
    const relay: LogRecipeRelay = {
      induceLogRecipe: jest.fn(async (payload: { prompt: string }) => {
        seenPrompts.push(payload.prompt);
        // Return "no pattern" so the run still completes via the fallback path;
        // the assertion is purely about what left the process.
        return { content: 'no pattern' };
      }),
    };

    await runDiscoveryRuntimeEvidence({
      projectId: 'proj-1',
      runId: 'run-1',
      projectFolder: FIXTURES_DIR,
      deterministicCandidates: [],
      configSnapshot: {
        repoUrl: 'https://example.com/app.git',
        inputArtifacts: { logFiles: [logFileArtifact('sample-hifi-secret.log')] },
      },
      logRecipeRelay: relay,
    });

    // The relay was genuinely exercised on the real orchestrator path (so the
    // redaction below is meaningful, not vacuous).
    expect(relay.induceLogRecipe).toHaveBeenCalled();
    expect(seenPrompts.length).toBeGreaterThanOrEqual(1);

    // The planted secrets (which appear in the fixture only in reliably-scrubbed
    // `Bearer <token>` and `password=<value>` positions) NEVER reach the LLM.
    const joined = seenPrompts.join('\n');
    expect(joined).not.toContain('SECRETBEARER-credential-abc123-do-not-leak');
    expect(joined).not.toContain('SECRETPWD-credential-xyz789-do-not-leak');
    // The redactor's marker is present, confirming the scrub actually ran on the
    // sample blocks that were forwarded.
    expect(joined).toContain('<REDACTED>');
  });
});
