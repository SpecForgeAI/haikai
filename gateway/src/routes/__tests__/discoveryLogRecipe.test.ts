/**
 * Tests for Discovery V3 Log-Recipe Relay Route
 *
 * Spec 2026-06-20: Runtime Log Evidence -- Format-Agnostic Extraction (Task Group 4)
 *
 * The route is a stateless relay (mirror of discoveryGapFill): it forwards a
 * discovery-composed prompt (carrying REDACTED runtime-log sample blocks) to
 * the shared LLM client and returns the model's content + usage VERBATIM. The
 * model is selected gateway-side; the caller supplies no model id. Recipe
 * parsing / "no pattern" handling happen downstream in discovery-service, so
 * this route must never reshape the LLM content.
 */

import request from 'supertest';
import express from 'express';
import { discoveryLogRecipeRouter } from '../discoveryLogRecipe';

// Mock the logger to keep test output clean.
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the LLM client singleton accessor. sendChatRequest is the single seam
// the relay depends on; tests drive its return value and assert on its args.
const mockSendChatRequest = jest.fn();
jest.mock('../../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

describe('Discovery V3 Log-Recipe Relay Route', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    // Mount at root so the router-internal path /v3/log-recipe matches directly
    // (in server.ts the same router is mounted under /api/v1/discovery).
    app.use('/', discoveryLogRecipeRouter);
  });

  describe('POST /v3/log-recipe', () => {
    it('relays the caller-composed prompt to the LLM and returns content + usage verbatim', async () => {
      const recipeContent = JSON.stringify({
        recordDelimiter: 'blank_line',
        fields: { method: 'rule-m', path: 'rule-p', headers: 'rule-h', body: 'rule-b', response: 'rule-r' },
      });
      mockSendChatRequest.mockResolvedValueOnce({
        content: recipeContent,
        usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
      });

      const res = await request(app)
        .post('/v3/log-recipe')
        .send({
          prompt: 'Infer a structured recipe from these redacted runtime-log samples...',
          runId: 'run-abc-123',
          filePath: 'logs/app-2026-06-20.log',
        });

      expect(res.status).toBe(200);
      // Content + usage returned VERBATIM (no reshaping by the relay).
      expect(res.body).toEqual({
        content: recipeContent,
        usage: { promptTokens: 120, completionTokens: 45, totalTokens: 165 },
      });

      // The LLM client received exactly one call, with the caller's prompt as a
      // single user message, temperature 0 and no tools (deterministic relay).
      expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
      const [messages, , , options] = mockSendChatRequest.mock.calls[0];
      expect(messages).toEqual([
        { role: 'user', content: 'Infer a structured recipe from these redacted runtime-log samples...' },
      ]);
      expect(options).toEqual({ tools: [], temperature: 0 });
    });

    it('returns a "no pattern" LLM response unmodified', async () => {
      mockSendChatRequest.mockResolvedValueOnce({
        content: 'no pattern',
        usage: { totalTokens: 30 },
      });

      const res = await request(app)
        .post('/v3/log-recipe')
        .send({ prompt: 'Samples that do not reveal a parseable format', runId: 'run-xyz' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('no pattern');
      expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    });

    it('does NOT accept a caller-supplied model id (model selected gateway-side)', async () => {
      mockSendChatRequest.mockResolvedValueOnce({ content: 'no pattern' });

      await request(app)
        .post('/v3/log-recipe')
        .send({ prompt: 'samples', runId: 'run-1', model: 'attacker-chosen-model' });

      // The relay must never forward a caller model id into the LLM call.
      const serialisedCall = JSON.stringify(mockSendChatRequest.mock.calls[0]);
      expect(serialisedCall).not.toContain('attacker-chosen-model');
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await request(app)
        .post('/v3/log-recipe')
        .send({ runId: 'run-abc-123' });

      expect(res.status).toBe(400);
      expect(mockSendChatRequest).not.toHaveBeenCalled();
    });

    it('returns 400 when prompt is an empty string', async () => {
      const res = await request(app)
        .post('/v3/log-recipe')
        .send({ prompt: '', runId: 'run-abc-123' });

      expect(res.status).toBe(400);
      expect(mockSendChatRequest).not.toHaveBeenCalled();
    });

    it('returns 400 when runId is missing', async () => {
      const res = await request(app)
        .post('/v3/log-recipe')
        .send({ prompt: 'Infer a recipe from these samples' });

      expect(res.status).toBe(400);
      expect(mockSendChatRequest).not.toHaveBeenCalled();
    });
  });
});
