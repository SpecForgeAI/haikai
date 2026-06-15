/**
 * Tests for API Migration Validation Gateway Routes
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 3.1
 *
 * Test inventory (4 tests, focused on the spec-required round-trip + safety
 * properties for Group 3):
 *   1. AMS CRUD pass-through: GET .../api-behaviour/capture-sessions forwards
 *      `:projectId` and `:architectureId` from the URL to the AMS-bound URL.
 *      AMS exposes `architectureId` as a query param on its list endpoints, so
 *      the gateway strips the URL safety segment from the path and injects it
 *      onto the query string. The list body comes back unchanged.
 *   2. URL safety: omitting `:architectureId` from the gateway URL must 404
 *      at the Express layer (no fallback resolution -- mirrors the
 *      `discovery.ts` URL safety property the rest of the system depends on).
 *   3. LLM tool-loop relay happy path: POST /llm-tool-loop relays exactly one
 *      provider round-trip via `getLlmClient().sendChatRequest` and returns
 *      an OpenAI-shaped assistant message including `tool_calls`. Verifies
 *      the gateway does NOT loop or execute tools (round-counter lives in
 *      the new service per spec).
 *   4. LLM tool-loop relay provider-error pass-through: when the provider
 *      throws an SDK error carrying a 429 status, the gateway surfaces a
 *      429 to the caller with a structured error envelope.
 */

// ---------------------------------------------------------------------------
// Mocks -- declared before importing the route under test
// ---------------------------------------------------------------------------

// Mock the gateway config so tests don't depend on env vars / .env files.
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
    discoveryServiceBaseUrl: 'http://localhost:8091',
    llmProvider: 'openai',
  }),
  resetConfig: jest.fn(),
}));

// Silence logger output during tests.
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock getLlmClient so the relay endpoint never touches a real provider.
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// Mock global fetch for AMS CRUD proxy calls.
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { apiMigrationValidationRouter } from '../routes/apiMigrationValidation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    (req as any).requestId = 'api-migration-validation-test';
    next();
  });
  // Mount the router at /api/v1 so the internal paths resolve to the
  // production-shaped URLs (matches server.ts exactly).
  app.use('/api/v1', apiMigrationValidationRouter);
  return app;
}

function jsonResponse(status: number, body: unknown) {
  const statusText = status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => (body === null || body === undefined ? '' : JSON.stringify(body)),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockSendChatRequest.mockReset();
});

// ---------------------------------------------------------------------------
// Test 1: GET .../api-behaviour/capture-sessions forwards :projectId and
// :architectureId verbatim. AMS receives /api/projects/{pid}/api-behaviour/
// capture-sessions?architectureId={aid}. The list body comes back unchanged.
// ---------------------------------------------------------------------------
test('GET .../api-behaviour/capture-sessions forwards projectId and architectureId, returns body verbatim', async () => {
  const projectId = 'proj-123';
  const architectureId = 'arch-456';

  const sessionList = [
    {
      id: 'sess-1',
      projectId,
      architectureId,
      status: 'draft',
      name: 'My capture session',
    },
  ];
  mockFetch.mockResolvedValueOnce(jsonResponse(200, sessionList));

  const app = createTestApp();
  const res = await request(app).get(
    `/api/v1/projects/${projectId}/architectures/${architectureId}/api-behaviour/capture-sessions`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(sessionList);

  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];

  const u = new URL(calledUrl);
  expect(`${u.origin}${u.pathname}`).toBe(
    `http://localhost:8080/api/projects/${projectId}/api-behaviour/capture-sessions`,
  );
  // The architecture URL safety segment is preserved by being injected onto
  // the query string for AMS list endpoints (which take it as @RequestParam).
  expect(u.searchParams.get('architectureId')).toBe(architectureId);
  expect(calledInit.method).toBe('GET');
});

// ---------------------------------------------------------------------------
// Test 2: URL safety -- forgetting :architectureId must 404 at the Express
// layer (no fallback / no silent default resolution). This mirrors the
// pattern enforced by discovery.ts and is the gateway-layer guarantee that
// every API behaviour write/read is bound to a specific architecture.
// ---------------------------------------------------------------------------
test('AMS CRUD proxy 404s when :architectureId is missing from the URL', async () => {
  const app = createTestApp();

  // Hit the capture-sessions list proxy WITHOUT the :architectureId path
  // segment. No route matches -> Express returns 404. Crucially, the
  // upstream is never contacted.
  const res = await request(app).get(
    '/api/v1/projects/proj-123/api-behaviour/capture-sessions',
  );

  expect(res.status).toBe(404);
  expect(mockFetch).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 3: LLM tool-loop relay happy path -- one provider round trip,
// returns an OpenAI-shaped assistant message with tool_calls. Confirms the
// gateway is a thin pass-through (one sendChatRequest call, no loop logic,
// no round counter -- those live in the new service per spec).
// ---------------------------------------------------------------------------
test('POST /llm-tool-loop relays one provider round-trip and returns assistant message with tool_calls', async () => {
  // The LlmClient interface returns parsed tool_calls (callId / name /
  // arguments object); the relay must convert them back to OpenAI wire
  // format with arguments stringified, ready to feed straight back into the
  // next round trip from the new service.
  mockSendChatRequest.mockResolvedValueOnce({
    id: 'llm-resp-1',
    content: '',
    toolCalls: [
      {
        callId: 'call_abc123',
        name: 'list_oas_operations',
        arguments: { sessionId: 'sess-99' },
      },
    ],
    isFinal: false,
    usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
  });

  const app = createTestApp();
  const tools = [
    {
      type: 'function',
      function: {
        name: 'list_oas_operations',
        description: 'List parsed OAS operations for the current capture session.',
        parameters: { type: 'object', properties: { sessionId: { type: 'string' } } },
      },
    },
  ];
  const messages = [
    { role: 'system', content: 'You are an API behaviour capture planner.' },
    { role: 'user', content: 'Plan happy_path scenarios for session sess-99.' },
  ];

  const res = await request(app)
    .post('/api/v1/api-migration-validation/llm-tool-loop')
    .send({ messages, tools, toolChoice: 'auto', model: 'gpt-4o' });

  expect(res.status).toBe(200);

  // Response shape: { message: { role, content, tool_calls? }, usage? }
  expect(res.body.message).toBeDefined();
  expect(res.body.message.role).toBe('assistant');
  expect(res.body.message.content).toBe('');
  expect(res.body.message.tool_calls).toEqual([
    {
      id: 'call_abc123',
      type: 'function',
      function: {
        name: 'list_oas_operations',
        arguments: JSON.stringify({ sessionId: 'sess-99' }),
      },
    },
  ]);
  expect(res.body.usage).toEqual({
    promptTokens: 120,
    completionTokens: 25,
    totalTokens: 145,
  });

  // EXACTLY one provider round-trip -- no loop in the gateway. The
  // round-counter / multi-round-trip orchestration is the new service's
  // responsibility per spec.
  expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
  const [forwardedMessages, , , options] = mockSendChatRequest.mock.calls[0];
  expect(forwardedMessages).toEqual(messages);
  expect(options).toEqual({ tools, toolChoice: 'auto' });
});

// ---------------------------------------------------------------------------
// Test 4: Provider-error pass-through. When the provider throws an SDK
// error carrying a status code (e.g. 429 rate-limit), the gateway surfaces
// that status to the caller wrapped in the standard error envelope so the
// new service can distinguish provider faults from gateway-layer faults.
// ---------------------------------------------------------------------------
test('POST /llm-tool-loop surfaces provider 429 status verbatim with structured error envelope', async () => {
  // Simulate a provider SDK error (OpenAI / Azure both expose .status on
  // their error classes).
  const providerError = Object.assign(new Error('Rate limit exceeded for requests per minute'), {
    name: 'OpenAIError',
    status: 429,
  });
  mockSendChatRequest.mockRejectedValueOnce(providerError);

  const app = createTestApp();
  const res = await request(app)
    .post('/api/v1/api-migration-validation/llm-tool-loop')
    .send({
      messages: [{ role: 'user', content: 'Plan scenarios.' }],
      tools: [],
    });

  expect(res.status).toBe(429);
  expect(res.body.error).toBeDefined();
  expect(res.body.error.code).toBe(429);
  expect(res.body.error.message).toContain('Rate limit exceeded');
  expect(res.body.error.provider).toBe('OpenAIError');
  expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
});
