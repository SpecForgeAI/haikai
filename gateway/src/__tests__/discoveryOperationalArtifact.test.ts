/**
 * Tests for Discovery V3 Operational-Artifact Summariser Relay Endpoint.
 *
 * Spec 2026-06-14: Generic Operational-Artifact Discovery (D1) -- Task Group 1.
 *
 * The discovery-service composes the whole summariser prompt; this route is a
 * stateless relay (clean prompt / model / cache separation from gap-fill). It
 * is a near-clone of `discoveryGapFill.ts`.
 *
 * Tests (LLM client mocked -- NO live LLM, mirroring discoveryGapFill.test.ts):
 *  1. Happy path: relays the caller-supplied prompt and returns
 *     `{ content, usage }` verbatim from the mocked client.
 *  2. `sendChatRequest` is invoked with a single user message AND the relay
 *     options `{ tools: [], temperature: 0 }`.
 *  3. Returns 400 on a missing / empty `prompt`.
 *  4. The route is exported from the routes barrel.
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

import { discoveryOperationalArtifactRouter } from '../routes/discoveryOperationalArtifact';

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
  app.use('/api/v1/discovery', discoveryOperationalArtifactRouter);
  return app;
}

const SUMMARISER_JSON = JSON.stringify({
  purpose: 'Nightly Autosys batch that reconciles risk positions.',
  artifactKind: 'batch_job',
  behaviourBearing: true,
  invokes: ['reconcile.sh', 'com.example.risk.ReconcileJob'],
  inputs: ['/data/positions.csv'],
  outputs: ['risk_db.positions'],
  sideEffects: ['truncates risk_db.staging'],
  externalSystems: ['Sybase'],
  evidence: ['command: reconcile.sh -full'],
  language: 'jil',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery V3 Operational-Artifact Relay (Spec 2026-06-14, D1, Task Group 1)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  // Test 1: Happy path -- returns { content, usage } verbatim from the client.
  it('relays the caller-supplied prompt and returns { content, usage } verbatim', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-oa-1',
      content: SUMMARISER_JSON,
      isFinal: true,
      usage: { promptTokens: 420, completionTokens: 110, totalTokens: 530 },
    });

    const assembledPrompt =
      '# Operational artifact summariser\nReturn STRICT JSON.\n\n# File: jobs/reconcile.jil\n<contents>';

    const response = await request(app)
      .post('/api/v1/discovery/v3/operational-artifact')
      .send({
        prompt: assembledPrompt,
        filePath: 'jobs/reconcile.jil',
        runId: 'run-oa-1',
      });

    expect(response.status).toBe(200);
    expect(response.body.content).toBe(SUMMARISER_JSON);
    expect(response.body.usage).toEqual({
      promptTokens: 420,
      completionTokens: 110,
      totalTokens: 530,
    });
  });

  // Test 2: single user message + { tools: [], temperature: 0 }.
  it('forwards a single user message with { tools: [], temperature: 0 }', async () => {
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-oa-2',
      content: SUMMARISER_JSON,
      isFinal: true,
    });

    const assembledPrompt = '# Summariser prompt\n<file contents>';

    const response = await request(app)
      .post('/api/v1/discovery/v3/operational-artifact')
      .send({
        prompt: assembledPrompt,
        filePath: 'bin/deploy.sh',
        runId: 'run-oa-2',
      });

    expect(response.status).toBe(200);
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const [messages, requestId, sessionId, options] = mockSendChatRequest.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe(assembledPrompt);
    expect(requestId).toBe('test-request-id');
    expect(sessionId).toContain('v3-operational-artifact-');
    expect(sessionId).toContain('run-oa-2');
    expect(options).toEqual({ tools: [], temperature: 0 });
  });

  // Test 3: 400 on missing prompt; LLM client never called.
  it('returns 400 when prompt is missing from the request body', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/v3/operational-artifact')
      .send({ filePath: 'scripts/run.sh', runId: 'run-oa-3' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // Test 4: barrel export.
  it('routes index exports the discoveryOperationalArtifactRouter function', () => {
    jest.isolateModules(() => {
      const routesIndex = require('../routes');
      expect(typeof routesIndex.discoveryOperationalArtifactRouter).toBe('function');
    });
  });
});
