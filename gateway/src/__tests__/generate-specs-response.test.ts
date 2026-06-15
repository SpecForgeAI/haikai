/**
 * Tests for Gateway response handling for generate_specs intent
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 3: Gateway Response Handling
 */

import request from 'supertest';
import express from 'express';
import { chatRouter } from '../routes/chat';
import * as openaiClient from '../services/openaiClient';
import * as sessionStore from '../services/sessionStore';

// Mock dependencies
jest.mock('../services/openaiClient');
jest.mock('../services/architectureModelClient', () => ({
  resolveImplementContext: jest.fn().mockResolvedValue(null),
  fetchProductSummary: jest.fn().mockResolvedValue(null),
  fetchMetaModelSummary: jest.fn().mockResolvedValue(null),
  expandResolveContext: jest.fn().mockResolvedValue(null),
  hasBundleTypeSelections: jest.fn().mockReturnValue(false),
  tryResolveImplementContextWithBundles: jest.fn().mockResolvedValue(null),
}));

const mockedSendChatRequest = openaiClient.sendChatRequest as jest.Mock;

describe('Gateway response handling for generate_specs intent', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStore.clearAllSessions();

    // Set up Express app with chat router
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.requestId = 'test-request-id';
      next();
    });
    app.use('/api/chat', chatRouter);
  });

  afterEach(() => {
    sessionStore.clearAllSessions();
  });

  describe('valid generate_specs response', () => {
    it('should return ChatResponse with specs array when validation succeeds', async () => {
      const validSpecsArray = [
        '/agent-os:write-spec name: test-feature\nversion: 1.0.0',
        '/agent-os:write-spec name: another-spec\nversion: 1.0.0',
      ];

      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(validSpecsArray),
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Proceed to implementation planning',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Test Feature',
              type: 'Feature',
              description: 'Test description',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toBeDefined();
      expect(response.body.specs).toEqual(validSpecsArray);
      expect(response.body.assistant.message).toBe(JSON.stringify(validSpecsArray));
    });

    it('should include sessionId in response', async () => {
      const validSpecsArray = ['/agent-os:write-spec name: test\nversion: 1.0.0'];

      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(validSpecsArray),
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Generate specs',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBeDefined();
      expect(typeof response.body.sessionId).toBe('string');
    });
  });

  describe('invalid generate_specs response', () => {
    it('should return ChatResponse with error message when response is not valid JSON', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'This is not valid JSON at all',
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Generate specs',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toBeUndefined();
      expect(response.body.assistant.message).toContain('Error');
      expect(response.body.assistant.message).toContain('not valid JSON');
    });

    it('should return ChatResponse with error message when response is not an array', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify({ spec: '/agent-os:write-spec test' }),
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Generate specs',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toBeUndefined();
      expect(response.body.assistant.message).toContain('Error');
      expect(response.body.assistant.message).toContain('not a JSON array');
    });

    it('should return ChatResponse with error message when specs have invalid format', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(['invalid spec without prefix']),
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Generate specs',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toBeUndefined();
      expect(response.body.assistant.message).toContain('Error');
      expect(response.body.assistant.message).toContain('Invalid spec format');
    });
  });

  describe('normal_chat intent behavior', () => {
    it('should not trigger specs validation for normal_chat intent', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'I understand your requirements. Let me ask some clarifying questions...',
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Help me understand this feature',
          context: {
            mode: 'implement_feature',
            intent: 'normal_chat',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toBeUndefined();
      // Note: In normal_chat mode with refine phase, PlannerResponse validation
      // may transform the message. Check assistant message exists.
      expect(response.body.assistant).toBeDefined();
      expect(response.body.assistant.message).toBeDefined();
    });

    it('should not include specs field when intent is normal_chat', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'Normal response without specs',
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Test message',
          context: {
            mode: 'implement_feature',
            intent: 'normal_chat',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('specs');
    });

    it('should not include specs field when intent is undefined', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'Response without intent specified',
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          message: 'Test message',
          context: {
            mode: 'implement_feature',
            workItem: {
              id: 'FEAT-001',
              title: 'Test',
              type: 'Feature',
              description: 'Test',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('specs');
    });
  });
});
