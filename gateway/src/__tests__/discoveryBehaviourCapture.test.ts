/**
 * Tests for the Discovery Behaviour-Capture Relay Endpoint (Seam 1 of Spec
 * 2026-05-29 Business-logic behaviour capture, Gap C — Task Group 2).
 *
 * Sibling of `discoveryGapFill.test.ts`. The route is a stateless prompt relay
 * for the per-method behaviour-capture stage in discovery-service.
 *
 * Tests:
 *  1. POST /api/v1/discovery/v3/behaviour-capture relays the caller-supplied
 *     prompt to the LLM client (single user message, no injected system
 *     prompt) and returns the response content + usage unmodified.
 *  2. Returns 400 on malformed request bodies (missing prompt / methodId / runId).
 */

import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before importing any modules that use them
// ---------------------------------------------------------------------------

jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

import { discoveryBehaviourCaptureRouter } from '../routes/discoveryBehaviourCapture';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).requestId = 'test-request-id';
    next();
  });
  app.use('/api/v1/discovery', discoveryBehaviourCaptureRouter);
  return app;
}

describe('Discovery Behaviour-Capture Relay (Spec 2026-05-29, Gap C)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  it('relays the caller-supplied prompt to the LLM client and returns response content', async () => {
    const llmContent = JSON.stringify({
      io: {},
      validation: [],
      transformation: 'x',
      data_effects: 'y',
      side_effects: 'z',
      edge_cases: [],
      provenance: {},
      confidence: 0.6,
    });
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-1',
      content: llmContent,
      isFinal: true,
      usage: { promptTokens: 900, completionTokens: 150, totalTokens: 1050 },
    });

    const assembledPrompt = 'You are a migration analyst...\n=== METHOD UNDER ANALYSIS ===\n...';
    const methodId = 'com.foo.OwnerService#registerOwner(Owner)';

    const response = await request(app)
      .post('/api/v1/discovery/v3/behaviour-capture')
      .send({ prompt: assembledPrompt, methodId, runId: 'run-bc-1' });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(llmContent);
    expect(response.body.usage).toEqual({
      promptTokens: 900,
      completionTokens: 150,
      totalTokens: 1050,
    });

    // Single user message; no injected system prompt; correlated session id.
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const [messages, requestId, sessionId, options] = mockSendChatRequest.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe(assembledPrompt);
    expect(requestId).toBe('test-request-id');
    expect(sessionId).toContain('v3-behaviour-capture-');
    expect(sessionId).toContain('run-bc-1');
    expect(options).toEqual({ tools: [], temperature: 0 });
  });

  it('returns 400 when prompt is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/behaviour-capture')
      .send({ methodId: 'com.foo.X#m()', runId: 'run-bc-2' });
    expect(response.status).toBe(400);
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  it('returns 400 when methodId is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/behaviour-capture')
      .send({ prompt: 'p', runId: 'run-bc-3' });
    expect(response.status).toBe(400);
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });
});
