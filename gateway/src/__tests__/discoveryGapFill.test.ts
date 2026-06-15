/**
 * Tests for Discovery V3 Gap-Fill Relay Endpoint
 *
 * Spec 2026-04-19: V3 Layered Prompt System (Task Group 3)
 *
 * Tests:
 * 1. POST /api/v1/discovery/v3/gap-fill relays the caller-supplied prompt to
 *    the LLM client and returns the response content unmodified.
 * 2. The new route does NOT load any V2 file-analysis prompt template --
 *    verified by static inspection of the route source with comments stripped:
 *    no import of the V2 prompt loader, no fs/path usage, no 'config/prompts'
 *    path string in live code.
 * 3. Returns 400 on malformed request bodies.
 *
 * Updated 2026-04-20: the V2 `/analyze-files` route and its prompt template
 * were deleted. This test suite no longer asserts that the V2 router remains
 * registered -- only the V3 relay router is exported from routes/index.
 */

import path from 'path';
import { promises as fs } from 'fs';
import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before importing any modules that use them
// ---------------------------------------------------------------------------

// Mock logger to suppress console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock getLlmClient so the relay doesn't actually call any LLM
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { discoveryGapFillRouter } from '../routes/discoveryGapFill';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips TypeScript // line comments and /* block comments *\/ from a source
 * string so static-inspection assertions can focus on executable code only.
 * This keeps the header-comment in discoveryGapFill.ts (which legitimately
 * documents that the V2 prompt file is NOT loaded) from tripping guards that
 * look for references in actual code.
 */
function stripCommentsFromTs(source: string): string {
  // Remove block comments (including docblocks)
  let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).requestId = 'test-request-id';
    next();
  });
  app.use('/api/v1/discovery', discoveryGapFillRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery V3 Gap-Fill Relay (Spec 2026-04-19, Task Group 3)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  // Test 1: Relays caller-supplied prompt to LLM and returns response content.
  it('relays the caller-supplied prompt to the LLM client and returns response content', async () => {
    const llmContent = JSON.stringify([
      { type: 'class', name: 'PatientController', filePath: 'src/main/java/PatientController.java', confidence: 0.9 },
    ]);
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-1',
      content: llmContent,
      isFinal: true,
      usage: { promptTokens: 300, completionTokens: 60, totalTokens: 360 },
    });

    const assembledPrompt =
      '# Role\nYou are a discovery assistant.\n\n# Pack output\n```json\n[]\n```\n\n# Source\n<file contents here>';

    const response = await request(app)
      .post('/api/v1/discovery/v3/gap-fill')
      .send({
        prompt: assembledPrompt,
        filePath: 'src/main/java/PatientController.java',
        runId: 'run-xyz-1',
      });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(llmContent);
    expect(response.body.usage).toEqual({
      promptTokens: 300,
      completionTokens: 60,
      totalTokens: 360,
    });

    // Verify the LLM was called exactly once with the caller prompt embedded in
    // a single user message -- no system message is injected here because the
    // caller-composed prompt already contains its own role/base layer.
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const [messages, requestId, sessionId, options] =
      mockSendChatRequest.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe(assembledPrompt);
    expect(requestId).toBe('test-request-id');
    expect(sessionId).toContain('v3-gap-fill-');
    expect(sessionId).toContain('run-xyz-1');
    expect(options).toEqual({ tools: [], temperature: 0 });
  });

  // Test 2: Static proof the V3 route never loads any V2 prompt file.
  //
  // The task requires verifying the new route does NOT load any V2
  // file-analysis prompt template. Rather than runtime-spying on fs (Node's
  // fs.readFileSync descriptor is non-configurable under this ts-jest setup),
  // we strip comments and assert the route's LIVE code neither imports the
  // V2 prompt loader, uses fs, nor references the config/prompts path.
  it('does NOT reference any V2 prompt loader or config/prompts in live route code', async () => {
    const routeSourcePath = path.resolve(
      __dirname,
      '..',
      'routes',
      'discoveryGapFill.ts'
    );
    const raw = await fs.readFile(routeSourcePath, 'utf-8');
    const code = stripCommentsFromTs(raw);

    // The deleted V2 prompt filename must not appear in live code.
    expect(code).not.toContain('discovery.file-analysis.prompt.md');
    // The loader module + any exported template-loading function must not be
    // imported or invoked.
    expect(code).not.toMatch(/discoveryDecisionTaskPrompts/);
    expect(code).not.toMatch(/loadFileAnalysisPromptTemplate/);
    // The route must not import fs or reach into the config/prompts directory.
    expect(code).not.toMatch(/from\s+['"]fs['"]/);
    expect(code).not.toMatch(/require\(['"]fs['"]\)/);
    expect(code).not.toMatch(/config[\\/]+prompts/);
  });

  // Test 3: Returns 400 for missing prompt in request body.
  it('returns 400 when prompt is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/gap-fill')
      .send({ filePath: 'src/foo/Bar.java', runId: 'run-xyz-3' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// V3 relay router is the only discovery-prompt router exported from the index
// ---------------------------------------------------------------------------

describe('Routes index exports the V3 gap-fill router', () => {
  it('routes index exports the discoveryGapFillRouter function', () => {
    jest.isolateModules(() => {
      const routesIndex = require('../routes');
      expect(typeof routesIndex.discoveryGapFillRouter).toBe('function');
      // The V2 analyze-files router was removed 2026-04-20; ensure it is
      // no longer re-exported from the routes index.
      expect(routesIndex.discoveryFileAnalysisRouter).toBeUndefined();
    });
  });
});
