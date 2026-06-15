/**
 * Tests for Discovery V3 Capability-Naming Relay Endpoint.
 *
 * Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4.
 *
 * The discovery-service composes the whole naming prompt; this route is a
 * stateless relay (clean prompt / model / cache separation from gap-fill / the
 * operational-artifact summariser). It is a near-clone of
 * `discoveryOperationalArtifact.ts`. The LLM is NAMING-ONLY -- it proposes a
 * name/summary/kind for an ALREADY-DETERMINISTIC seed and never affects
 * membership.
 *
 * Tests (LLM client mocked -- NO live LLM, the gateway LLM-guard):
 *  1. Happy path: relays the caller-supplied prompt and returns
 *     `{ content, usage }` verbatim from the mocked client.
 *  2. `sendChatRequest` is invoked with a single user message AND the relay
 *     options `{ tools: [], temperature: 0 }`, correlated by `seedKey`.
 *  3. Returns 400 on a missing / empty `prompt` (LLM never called).
 *  4. Returns 400 on a missing `seedKey` (LLM never called).
 *  5. The route is exported from the routes barrel.
 */

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

// Mock getLlmClient so the relay doesn't actually call any LLM (the LLM-guard).
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { discoveryCapabilityNamingRouter } from '../routes/discoveryCapabilityNaming';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).requestId = 'test-request-id';
    next();
  });
  app.use('/api/v1/discovery', discoveryCapabilityNamingRouter);
  return app;
}

const NAMING_JSON = JSON.stringify({
  name: 'Daily Risk Hierarchy Load Pipeline',
  summary:
    'Nightly Autosys-orchestrated batch that extracts, loads, and archives the risk hierarchy.',
  kind: 'batch_pipeline',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery V3 Capability-Naming Relay (Spec 2026-06-14, D2, Task Group 4)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  // Test 1: Happy path -- returns { content, usage } verbatim from the client.
  it('relays the caller-supplied prompt and returns { content, usage } verbatim', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-cap-1',
      content: NAMING_JSON,
      isFinal: true,
      usage: { promptTokens: 510, completionTokens: 60, totalTokens: 570 },
    });

    const assembledPrompt =
      '# Capability naming\nName this deterministic seed. Return STRICT JSON { name, summary, kind }.';

    const response = await request(app)
      .post('/api/v1/discovery/v3/capability-naming')
      .send({
        prompt: assembledPrompt,
        seedKey: 'jil:risk_hier_box',
        runId: 'run-cap-1',
      });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(NAMING_JSON);
    expect(response.body.usage).toEqual({
      promptTokens: 510,
      completionTokens: 60,
      totalTokens: 570,
    });
  });

  // Test 2: single user message + { tools: [], temperature: 0 }, seedKey correlation.
  it('forwards a single user message with { tools: [], temperature: 0 } correlated by seedKey', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-cap-2',
      content: NAMING_JSON,
      isFinal: true,
    });

    const assembledPrompt = '# Naming prompt\n<seed summary>';

    const response = await request(app)
      .post('/api/v1/discovery/v3/capability-naming')
      .send({
        prompt: assembledPrompt,
        seedKey: 'colocation:monitoring',
        runId: 'run-cap-2',
      });

    expect(response.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const [messages, requestId, sessionId, options] = mockSendChatRequest.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe(assembledPrompt);
    expect(requestId).toBe('test-request-id');
    expect(sessionId).toContain('v3-capability-naming-');
    expect(sessionId).toContain('run-cap-2');
    expect(sessionId).toContain('colocation:monitoring');
    expect(options).toEqual({ tools: [], temperature: 0 });
  });

  // Test 3: 400 on missing prompt; LLM client never called.
  it('returns 400 when prompt is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/capability-naming')
      .send({ seedKey: 'jil:box', runId: 'run-cap-3' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // Test 4: 400 on missing seedKey; LLM client never called.
  it('returns 400 when seedKey is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/capability-naming')
      .send({ prompt: '# Naming prompt', runId: 'run-cap-4' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // Test 5: barrel export.
  it('routes index exports the discoveryCapabilityNamingRouter function', () => {
    jest.isolateModules(() => {
      const routesIndex = require('../routes');
      expect(typeof routesIndex.discoveryCapabilityNamingRouter).toBe('function');
    });
  });
});
