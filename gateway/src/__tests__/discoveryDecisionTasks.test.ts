/**
 * Tests for Discovery DecisionTask Resolution Endpoint
 *
 * Spec 2026-04-05: Phase 1b Linker and DecisionTask Engine
 * Task Group 8: Gateway Resolution Route and Registration
 *
 * Tests:
 * 1. POST /api/v1/discovery/resolve-decision-tasks with a valid confirm_relationship task
 *    returns resolved result with outputData
 * 2. POST with a valid resolve_competing_relationships task returns resolved result
 *    with selectedIndex
 * 3. An individual LLM failure returns status: 'failed' with error message while other
 *    tasks continue processing
 * 4. Request body validation rejects missing projectId or runId
 * 5. LLM response parsing handles both raw JSON and markdown-fenced JSON
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

// Mock getLlmClient
const mockSendChatRequest = jest.fn();
jest.mock('../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { discoveryDecisionTasksRouter } from '../routes/discoveryDecisionTasks';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).requestId = 'test-request-id';
    next();
  });
  app.use('/api/v1/discovery', discoveryDecisionTasksRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const sampleSourceAtom = {
  id: 'atom-source-1',
  runId: 'run-123',
  type: 'string_pattern',
  data: {
    relativePath: 'src/services/userService.ts',
    patternName: 'import_statement',
    matchedText: "import { UserRepository } from './userRepository'",
    lineNumber: 1,
  },
  createdAt: '2026-04-05T12:00:00Z',
};

const sampleTargetAtom = {
  id: 'atom-target-1',
  runId: 'run-123',
  type: 'symbol',
  data: {
    relativePath: 'src/repositories/userRepository.ts',
    name: 'UserRepository',
    kind: 'class',
    lineNumber: 5,
  },
  createdAt: '2026-04-05T12:00:00Z',
};

function makeConfirmTask(id = 'task-confirm-1') {
  return {
    id,
    runId: 'run-123',
    taskType: 'confirm_relationship' as const,
    status: 'pending',
    inputData: {
      sourceAtom: sampleSourceAtom,
      targetAtom: sampleTargetAtom,
      proposedRelationshipType: 'imports',
      confidence: 0.65,
      ruleId: 'imports-by-pattern',
    },
    outputData: null,
    createdAt: '2026-04-05T12:00:00Z',
    resolvedAt: null,
  };
}

function makeCompetingTask(id = 'task-competing-1') {
  return {
    id,
    runId: 'run-123',
    taskType: 'resolve_competing_relationships' as const,
    status: 'pending',
    inputData: {
      sourceAtom: sampleSourceAtom,
      competitors: [
        {
          targetAtom: sampleTargetAtom,
          relationshipType: 'imports',
          confidence: 0.6,
          ruleId: 'imports-by-pattern',
        },
        {
          targetAtom: {
            id: 'atom-target-2',
            runId: 'run-123',
            type: 'symbol',
            data: {
              relativePath: 'src/models/userRepository.ts',
              name: 'UserRepository',
              kind: 'interface',
              lineNumber: 3,
            },
            createdAt: '2026-04-05T12:00:00Z',
          },
          relationshipType: 'imports',
          confidence: 0.55,
          ruleId: 'imports-by-pattern',
        },
      ],
    },
    outputData: null,
    createdAt: '2026-04-05T12:00:00Z',
    resolvedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery DecisionTask Resolution Endpoint (Spec 2026-04-05, Task Group 8)', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  // Test 1: confirm_relationship task returns resolved result with outputData
  it('resolves a confirm_relationship task with outputData', async () => {
    const llmOutput = {
      decision: 'confirm',
      adjustedConfidence: 0.85,
      reasoning: 'The import statement clearly references the UserRepository class.',
    };

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-1',
      content: JSON.stringify(llmOutput),
      isFinal: true,
    });

    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-abc',
        runId: 'run-123',
        tasks: [makeConfirmTask()],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);

    const result = response.body.results[0];
    expect(result.taskId).toBe('task-confirm-1');
    expect(result.status).toBe('resolved');
    expect(result.outputData).toEqual(llmOutput);
    expect(result.error).toBeNull();

    // Verify LLM was called with messages array
    expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    const [messages, requestId, sessionId] = mockSendChatRequest.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(requestId).toBe('test-request-id');
    expect(sessionId).toContain('decision-task-');
  });

  // Test 2: resolve_competing_relationships task returns resolved result with selectedIndex
  it('resolves a resolve_competing_relationships task with selectedIndex', async () => {
    const llmOutput = {
      selectedIndex: 0,
      adjustedConfidence: 0.8,
      reasoning: 'The first target is a class in the repositories directory, which is the more likely import target.',
    };

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-2',
      content: JSON.stringify(llmOutput),
      isFinal: true,
    });

    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-abc',
        runId: 'run-123',
        tasks: [makeCompetingTask()],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);

    const result = response.body.results[0];
    expect(result.taskId).toBe('task-competing-1');
    expect(result.status).toBe('resolved');
    expect(result.outputData.selectedIndex).toBe(0);
    expect(result.outputData.adjustedConfidence).toBe(0.8);
    expect(result.outputData.reasoning).toBeDefined();
    expect(result.error).toBeNull();
  });

  // Test 3: individual LLM failure returns 'failed' with error, other tasks continue
  it('continues processing after an individual LLM failure', async () => {
    // First task: LLM call fails
    mockSendChatRequest.mockRejectedValueOnce(new Error('LLM timeout after 30000ms'));

    // Second task: LLM call succeeds
    const successOutput = {
      decision: 'reject',
      adjustedConfidence: 0.0,
      reasoning: 'No clear import relationship found.',
    };
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-3',
      content: JSON.stringify(successOutput),
      isFinal: true,
    });

    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-abc',
        runId: 'run-123',
        tasks: [
          makeConfirmTask('task-fail-1'),
          makeConfirmTask('task-success-1'),
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);

    // First result: failed
    const failedResult = response.body.results[0];
    expect(failedResult.taskId).toBe('task-fail-1');
    expect(failedResult.status).toBe('failed');
    expect(failedResult.error).toContain('LLM timeout');
    expect(failedResult.outputData).toBeNull();

    // Second result: resolved successfully
    const successResult = response.body.results[1];
    expect(successResult.taskId).toBe('task-success-1');
    expect(successResult.status).toBe('resolved');
    expect(successResult.outputData).toEqual(successOutput);
    expect(successResult.error).toBeNull();

    // Both LLM calls were attempted
    expect(mockSendChatRequest).toHaveBeenCalledTimes(2);
  });

  // Test 4: request body validation rejects missing projectId or runId
  it('rejects requests with missing projectId', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        runId: 'run-123',
        tasks: [makeConfirmTask()],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(400);
    expect(response.body.error.message).toContain('projectId');

    // LLM should not have been called
    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  it('rejects requests with missing runId', async () => {
    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-abc',
        tasks: [makeConfirmTask()],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(400);
    expect(response.body.error.message).toContain('runId');

    expect(mockSendChatRequest).not.toHaveBeenCalled();
  });

  // Test 5: LLM response parsing handles both raw JSON and markdown-fenced JSON
  it('handles markdown-fenced JSON in LLM response', async () => {
    const llmOutput = {
      decision: 'confirm',
      adjustedConfidence: 0.9,
      reasoning: 'Strong evidence of import relationship.',
    };

    // LLM returns JSON wrapped in markdown code fences
    const fencedResponse = '```json\n' + JSON.stringify(llmOutput, null, 2) + '\n```';

    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-fenced',
      content: fencedResponse,
      isFinal: true,
    });

    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-abc',
        runId: 'run-123',
        tasks: [makeConfirmTask()],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);

    const result = response.body.results[0];
    expect(result.taskId).toBe('task-confirm-1');
    expect(result.status).toBe('resolved');
    expect(result.outputData).toEqual(llmOutput);
    expect(result.error).toBeNull();
  });
});
