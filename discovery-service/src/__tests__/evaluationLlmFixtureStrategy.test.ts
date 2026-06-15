/**
 * Focused tests for the V3 evaluation harness Task Group 3:
 * LLM fixture replay / live / record strategy.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 3.1).
 *
 * Scope of this file:
 *   1. Replay mode intercepts `gatewayClient.gapFill` and returns the recorded
 *      response content verbatim.
 *   2. Replay mode with NO recorded fixture on disk throws the actionable
 *      "regenerate via `--live --record`" error when `gapFill` is called.
 *   3. Live mode does NOT intercept `gatewayClient.gapFill` — calls fall
 *      through to the real (test-mocked) method.
 *   4. Record mode captures the real response AND writes the capture to the
 *      fixture's `llmFixturePath` on `session.end()`.
 *   5. Replay mode FIFO-serves multiple recorded responses for fixtures with
 *      multiple gap-fill calls per pipeline run.
 *
 * Out of scope for this group:
 *   - Exhaustive filesystem / JSON-parse edge cases (covered implicitly by
 *     `evaluationRunner.test.ts`).
 *   - Runner-level wiring is exercised by `evaluationRunner.test.ts` test 4.
 *
 * Injection technique: these tests rely on the same mechanism the strategy
 * uses in production — `gatewayClient` is a singleton, and the strategy
 * assigns a new `gatewayClient.gapFill` (own-property shadow) around each
 * fixture. We replace `gapFill` before `createLlmStrategy` captures its
 * "original" reference so live / record modes pass through to our fake.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createLlmStrategy } from '../evaluation/llmFixtureStrategy';
import type { FixtureCase, LlmMode } from '../evaluation/types';

// ---------------------------------------------------------------------------
// Sandbox: temp directories for fixtures + LLM fixtures.
// ---------------------------------------------------------------------------

let tmpRoot: string;
let llmFixturesRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-llm-fixtures-'));
  llmFixturesRoot = path.join(tmpRoot, 'llm-fixtures');
  await fs.mkdir(llmFixturesRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a minimal `FixtureCase` pointing at a synthetic LLM fixture file
 * inside the temp root. The source file / expectations fields are populated
 * with placeholder values — the strategy under test does not inspect them.
 */
function makeFixture(
  frameworkId: string,
  caseId: string,
): FixtureCase {
  const llmFixturePath = path.join(
    llmFixturesRoot,
    frameworkId,
    `${caseId}.llm-response.json`,
  );
  return {
    frameworkId,
    caseId,
    fixtureDir: path.join(tmpRoot, 'fixtures', frameworkId, caseId),
    sourceFilePath: path.join(tmpRoot, 'fixtures', frameworkId, caseId, `${caseId}.java`),
    sourceFileName: `${caseId}.java`,
    sourceContents: 'class Stub {}\n',
    expectations: { expected: [], shouldNotEmit: [] },
    llmFixturePath,
  };
}

/**
 * Install a fresh `gatewayClient.gapFill` BEFORE importing `createLlmStrategy`
 * would capture the module-scope ORIGINAL reference.
 *
 * Because the strategy module captures the prototype method at import time,
 * we need a per-test shim that stands in for the "real" gateway and counts
 * invocations. We set `gatewayClient.gapFill` to our shim AT THE TOP of each
 * test and call `createLlmStrategy` AFTER.
 *
 * CAVEAT: `llmFixtureStrategy.ts` captures `ORIGINAL_GAP_FILL` once at module
 * load. For the LIVE and RECORD modes, we therefore assert on the patched
 * method's actual behavior (our shim is re-installed via the strategy's
 * restore path), not on invocation counts. The test below asserts on the
 * response content returned by the patched `gatewayClient.gapFill`, which
 * threads through the original method the module captured.
 */

// ---------------------------------------------------------------------------
// Module under test must be imported AFTER the gatewayClient module has been
// loaded so the strategy captures a stable "original" reference. `jest.mock`
// on `gatewayClient` with a custom gapFill implementation gives us a clean
// original to restore to across every test.
// ---------------------------------------------------------------------------

jest.mock('../services/gatewayClient', () => {
  // The mock gateway returns a stable, inspectable response for live / record
  // modes. Tests that expect replay interception assert on replay content
  // that differs from this, so any mis-routing is immediately visible.
  const mockGapFill = jest.fn(async (_prompt: string, _filePath: string, _runId: string) => ({
    content: '[[LIVE_REAL_RESPONSE]]',
  }));
  return {
    gatewayClient: {
      gapFill: mockGapFill,
    },
    GapFillGatewayError: class GapFillGatewayError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'GapFillGatewayError';
      }
    },
  };
});

// Import AFTER the mock is registered so the module closes over the mock.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gatewayClient } = require('../services/gatewayClient');
const mockGapFill = gatewayClient.gapFill as jest.Mock;

beforeEach(() => {
  mockGapFill.mockClear();
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('evaluation harness — Task Group 3 LLM fixture strategy', () => {
  // Test 1: replay returns the recorded response.
  test("replay mode intercepts gatewayClient.gapFill and returns the recorded response", async () => {
    const fixture = makeFixture('spring-classic', 'patient-controller');
    // Pre-create the recorded fixture file.
    await fs.mkdir(path.dirname(fixture.llmFixturePath), { recursive: true });
    await fs.writeFile(
      fixture.llmFixturePath,
      JSON.stringify({
        capturedAt: '2026-04-19T00:00:00.000Z',
        request: { prompt: 'recorded prompt', filePath: fixture.sourceFileName, runId: 'recorded-run' },
        response: { content: '[[REPLAY_CONTENT_A]]' },
      }),
      'utf-8',
    );

    const strategy = createLlmStrategy('replay');
    expect(strategy.mode).toBe('replay');
    const session = await strategy.beginFixture(fixture);
    try {
      // Under replay, the patched method does NOT hit the real (mocked) gateway.
      const response = await gatewayClient.gapFill('ignored prompt', 'ignored.java', 'run-1');
      expect(response.content).toBe('[[REPLAY_CONTENT_A]]');
      // The live mock was NOT called while the replay patch was installed.
      expect(mockGapFill).not.toHaveBeenCalled();
    } finally {
      await session.end();
    }
  });

  // Test 2: missing replay fixture throws the actionable error.
  test('replay mode with missing fixture throws a regenerate-via-record error on gapFill', async () => {
    const fixture = makeFixture('rails', 'missing-case');
    // Deliberately do NOT create the fixture file.
    expect(fsSync.existsSync(fixture.llmFixturePath)).toBe(false);

    const strategy = createLlmStrategy('replay');
    const session = await strategy.beginFixture(fixture);
    try {
      await expect(
        gatewayClient.gapFill('prompt', 'any.rb', 'run-x'),
      ).rejects.toThrow(/no recorded LLM fixture/i);
      await expect(
        gatewayClient.gapFill('prompt', 'any.rb', 'run-x'),
      ).rejects.toThrow(/--live --record/);
      // Missing fixture must NOT silently fall through to the live gateway.
      expect(mockGapFill).not.toHaveBeenCalled();
    } finally {
      await session.end();
    }
  });

  // Test 3: live mode passes through to the real (test-mocked) gateway.
  test('live mode does not intercept gatewayClient.gapFill', async () => {
    const fixture = makeFixture('django', 'happy-path');
    const strategy = createLlmStrategy('live');
    expect(strategy.mode).toBe('live');
    const session = await strategy.beginFixture(fixture);
    try {
      const response = await gatewayClient.gapFill('prompt', fixture.sourceFileName, 'run-live');
      // The real (mocked) gateway returned its stable payload.
      expect(response.content).toBe('[[LIVE_REAL_RESPONSE]]');
      expect(mockGapFill).toHaveBeenCalledTimes(1);
    } finally {
      await session.end();
    }
  });

  // Test 4: record mode captures the real response to disk at the correct path.
  test('record mode writes captured response to the fixture path on session.end()', async () => {
    const fixture = makeFixture('spring-classic', 'recorded-case');
    expect(fsSync.existsSync(fixture.llmFixturePath)).toBe(false);

    const strategy = createLlmStrategy('record');
    expect(strategy.mode).toBe('record');
    const session = await strategy.beginFixture(fixture);
    try {
      const response = await gatewayClient.gapFill(
        'the-prompt',
        fixture.sourceFileName,
        'run-rec-1',
      );
      // The real (mocked) gateway was still called in record mode.
      expect(response.content).toBe('[[LIVE_REAL_RESPONSE]]');
      expect(mockGapFill).toHaveBeenCalledTimes(1);
    } finally {
      await session.end();
    }

    // File exists at the computed path and contains the captured payload.
    expect(fsSync.existsSync(fixture.llmFixturePath)).toBe(true);
    const raw = await fs.readFile(fixture.llmFixturePath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Single-call fixtures are written as a single object (not an array).
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.response.content).toBe('[[LIVE_REAL_RESPONSE]]');
    expect(parsed.request.prompt).toBe('the-prompt');
    expect(parsed.request.filePath).toBe(fixture.sourceFileName);
    expect(parsed.request.runId).toBe('run-rec-1');
    expect(typeof parsed.capturedAt).toBe('string');
  });

  // Test 5: replay FIFO-serves multiple recorded responses.
  test('replay mode FIFO-serves multiple recorded responses from an array fixture', async () => {
    const fixture = makeFixture('django', 'multi-file-case');
    await fs.mkdir(path.dirname(fixture.llmFixturePath), { recursive: true });
    await fs.writeFile(
      fixture.llmFixturePath,
      JSON.stringify([
        {
          capturedAt: '2026-04-19T00:00:00.000Z',
          request: { prompt: 'p1', filePath: 'a.py', runId: 'r-1' },
          response: { content: '[[FIRST]]' },
        },
        {
          capturedAt: '2026-04-19T00:00:01.000Z',
          request: { prompt: 'p2', filePath: 'b.py', runId: 'r-1' },
          response: { content: '[[SECOND]]' },
        },
      ]),
      'utf-8',
    );

    const strategy = createLlmStrategy('replay');
    const session = await strategy.beginFixture(fixture);
    try {
      const r1 = await gatewayClient.gapFill('p1', 'a.py', 'r-1');
      const r2 = await gatewayClient.gapFill('p2', 'b.py', 'r-1');
      expect(r1.content).toBe('[[FIRST]]');
      expect(r2.content).toBe('[[SECOND]]');
      // A third call (queue exhausted) surfaces the same actionable error as
      // the fully-missing fixture case.
      await expect(
        gatewayClient.gapFill('p3', 'c.py', 'r-1'),
      ).rejects.toThrow(/no recorded LLM fixture/i);
    } finally {
      await session.end();
    }
  });

  // Test 6: end() restores the original gatewayClient.gapFill after the
  // session so later fixtures (or subsequent tests) are not left patched.
  test('session.end() restores gatewayClient.gapFill to the original method', async () => {
    const fixture = makeFixture('spring-classic', 'restore-case');
    await fs.mkdir(path.dirname(fixture.llmFixturePath), { recursive: true });
    await fs.writeFile(
      fixture.llmFixturePath,
      JSON.stringify({
        capturedAt: '2026-04-19T00:00:00.000Z',
        request: { prompt: 'p', filePath: 'x.java', runId: 'r' },
        response: { content: '[[PATCHED]]' },
      }),
      'utf-8',
    );

    const mode: LlmMode = 'replay';
    const strategy = createLlmStrategy(mode);
    const session = await strategy.beginFixture(fixture);
    // While patched, the replay content is returned.
    const duringPatch = await gatewayClient.gapFill('p', 'x.java', 'r');
    expect(duringPatch.content).toBe('[[PATCHED]]');
    await session.end();

    // After end(), the original (test-mocked) gateway is back in place.
    mockGapFill.mockClear();
    const afterRestore = await gatewayClient.gapFill('p', 'x.java', 'r');
    expect(afterRestore.content).toBe('[[LIVE_REAL_RESPONSE]]');
    expect(mockGapFill).toHaveBeenCalledTimes(1);
  });
});
