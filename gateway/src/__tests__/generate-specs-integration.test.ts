/**
 * Integration Tests for Generate Specs Feature
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 7: Strategic integration tests
 *
 * These tests verify the complete flow from Gateway request handling
 * through prompt building, OpenAI response validation, and final response.
 */

import request from 'supertest';
import express from 'express';
import { chatRouter } from '../routes/chat';
import * as openaiClient from '../services/openaiClient';
import * as sessionStore from '../services/sessionStore';
import { validateGeneratedSpecs } from '../services/specsValidator';
import { buildSystemPrompt, buildGenerateSpecsPrompt } from '../services/promptBuilder';
import { ChatContext } from '../types/chat';

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

describe('Generate Specs Integration Tests', () => {
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

  describe('end-to-end flow', () => {
    it('should complete full flow: request -> prompt selection -> validation -> response with specs', async () => {
      const validSpecs = [
        '/agent-os:write-spec name: auth-feature\nversion: 1.0.0\ntasks:\n  - id: task-1\n    description: Setup OAuth',
        '/agent-os:write-spec name: api-endpoints\nversion: 1.0.0\ntasks:\n  - id: task-2\n    description: Create REST endpoints',
      ];

      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(validSpecs),
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
          message: 'Proceed to implementation planning',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-AUTH-001',
              title: 'User Authentication',
              type: 'Epic',
              description: 'Implement full authentication flow with OAuth2',
            },
            architectureContext: {
              entityIds: ['SVC-AUTH', 'APP-WEB'],
              diagramIds: ['DIA-AUTH-FLOW'],
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.sessionId).toBe('test-session');
      expect(response.body.specs).toEqual(validSpecs);
      expect(response.body.assistant.message).toBe(JSON.stringify(validSpecs));
    });

    it('should return appropriate error when OpenAI returns invalid JSON', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'I apologize, but I cannot generate specifications because...',
        isFinal: true,
        toolCalls: [],
      });

      const response = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'test-session',
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
  });

  describe('prompt selection', () => {
    it('should use generate_specs prompt when intent is generate_specs', async () => {
      const validSpecs = ['/agent-os:write-spec test'];
      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(validSpecs),
        isFinal: true,
        toolCalls: [],
      });

      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'generate_specs',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      await request(app)
        .post('/api/chat')
        .send({
          message: 'Generate specs',
          context,
        });

      // Verify the messages sent to OpenAI include the generate_specs prompt
      const sentMessages = mockedSendChatRequest.mock.calls[0][0];
      const systemMessage = sentMessages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('JSON array');
      expect(systemMessage.content).toContain('/agent-os:write-spec');
      expect(systemMessage.content).not.toContain('structured refinement dialog');
    });

    it('should use planner prompt when intent is normal_chat', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'I understand your feature request. Let me ask some questions...',
        isFinal: true,
        toolCalls: [],
      });

      const context: ChatContext = {
        mode: 'implement_feature',
        intent: 'normal_chat',
        workItem: {
          id: 'FEAT-001',
          title: 'Test Feature',
          type: 'Feature',
          description: 'Test description',
        },
      };

      await request(app)
        .post('/api/chat')
        .send({
          message: 'Help me understand this feature',
          context,
        });

      // Verify the messages sent to OpenAI include the planner prompt
      const sentMessages = mockedSendChatRequest.mock.calls[0][0];
      const systemMessage = sentMessages.find((m: { role: string }) => m.role === 'system');
      expect(systemMessage.content).toContain('Implementation Planner');
      expect(systemMessage.content).toContain('structured refinement dialog');
    });
  });

  describe('validation edge cases', () => {
    it('should handle specs with complex YAML content correctly', async () => {
      const complexSpec = `/agent-os:write-spec
name: complex-feature
version: 1.0.0
description: |
  A complex feature that requires multiple steps
  and careful implementation.
tasks:
  - id: task-1
    name: Setup infrastructure
    steps:
      - Configure cloud services
      - Set up CI/CD pipeline
    dependencies: []
  - id: task-2
    name: Implement core logic
    dependencies:
      - task-1`;

      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify([complexSpec]),
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
              title: 'Complex Feature',
              type: 'Epic',
              description: 'Complex feature',
            },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.specs).toHaveLength(1);
      expect(response.body.specs[0]).toBe(complexSpec);
    });

    it('should reject specs that do not start with /agent-os:write-spec', async () => {
      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(['Some random command', '/agent-os:write-spec valid']),
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
    });
  });

  describe('session continuity', () => {
    it('should maintain session through normal_chat and then generate_specs', async () => {
      // First request: normal_chat to establish session with explicit sessionId
      mockedSendChatRequest.mockResolvedValueOnce({
        content: 'I understand. What authentication method do you prefer?',
        isFinal: true,
        toolCalls: [],
      });

      const firstResponse = await request(app)
        .post('/api/chat')
        .send({
          sessionId: 'session-continuity-test',
          message: 'I want to build user authentication',
          context: {
            mode: 'implement_feature',
            intent: 'normal_chat',
            workItem: {
              id: 'FEAT-001',
              title: 'Auth Feature',
              type: 'Feature',
              description: 'Authentication',
            },
          },
        });

      const sessionId = firstResponse.body.sessionId;
      expect(sessionId).toBe('session-continuity-test');

      // Second request: generate_specs with same session
      const validSpecs = ['/agent-os:write-spec name: auth\nversion: 1.0.0'];
      mockedSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify(validSpecs),
        isFinal: true,
        toolCalls: [],
      });

      const secondResponse = await request(app)
        .post('/api/chat')
        .send({
          sessionId,
          message: 'Proceed to implementation',
          context: {
            mode: 'implement_feature',
            intent: 'generate_specs',
            workItem: {
              id: 'FEAT-001',
              title: 'Auth Feature',
              type: 'Feature',
              description: 'Authentication',
            },
          },
        });

      expect(secondResponse.body.sessionId).toBe(sessionId);
      expect(secondResponse.body.specs).toEqual(validSpecs);
    });
  });
});

describe('buildGenerateSpecsPrompt unit tests', () => {
  it('should include all work item fields in generated prompt', () => {
    const context: ChatContext = {
      mode: 'implement_feature',
      intent: 'generate_specs',
      workItem: {
        id: 'FEAT-USER-123',
        title: 'User Management Dashboard',
        type: 'Epic',
        description: 'Create a comprehensive user management dashboard with role-based access control',
      },
      architectureContext: {
        entityIds: ['SVC-USER', 'SVC-AUTH', 'APP-ADMIN'],
        diagramIds: ['DIA-USER-FLOW', 'DIA-RBAC'],
      },
    };

    const prompt = buildGenerateSpecsPrompt(context);

    expect(prompt).toContain('User Management Dashboard');
    expect(prompt).toContain('Epic');
    expect(prompt).toContain('comprehensive user management dashboard');
    expect(prompt).toContain('SVC-USER');
    expect(prompt).toContain('SVC-AUTH');
    expect(prompt).toContain('APP-ADMIN');
    expect(prompt).toContain('DIA-USER-FLOW');
    expect(prompt).toContain('DIA-RBAC');
  });
});

describe('validateGeneratedSpecs unit tests', () => {
  it('should return valid: true for well-formed specs array', () => {
    const content = JSON.stringify([
      '/agent-os:write-spec name: feature-a\nversion: 1.0.0',
      '/agent-os:write-spec name: feature-b\nversion: 1.0.0',
      '/agent-os:write-spec name: feature-c\nversion: 1.0.0',
    ]);

    const result = validateGeneratedSpecs(content);

    expect(result.valid).toBe(true);
    expect(result.specs).toHaveLength(3);
  });

  it('should return valid: false for null JSON', () => {
    const result = validateGeneratedSpecs('null');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Response is not a JSON array');
  });

  it('should return valid: false for mixed valid/invalid specs', () => {
    const content = JSON.stringify([
      '/agent-os:write-spec valid',
      '/agent-os:read-spec invalid',
    ]);

    const result = validateGeneratedSpecs(content);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid spec format');
  });
});
