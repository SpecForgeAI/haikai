/**
 * Tests for discovery-service archModelClient DecisionTask methods
 * and gatewayClient resolveDecisionTasks method.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 6: archModelClient DecisionTask Methods and Gateway Client
 *
 * Tests:
 * 1. bulkSaveDecisionTasks sends POST to correct URL with tasks array
 * 2. getDecisionTasksByRun sends GET with optional status and taskType query params
 * 3. getDecisionTaskCount sends GET to /count with optional status param
 * 4. updateDecisionTask sends PUT to correct URL with update payload
 * 5. gatewayClient.resolveDecisionTasks sends POST to gateway resolution endpoint with correct body shape
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

const ARCH_ID = 'arch-uuid-test';

// Mock runArchitectureRegistry so _resolveArchitectureForRun returns ARCH_ID
// without falling back to resolveDefaultArchitectureId.
jest.mock('../services/runArchitectureRegistry', () => ({
  ...jest.requireActual('../services/runArchitectureRegistry'),
  getRunArchitectureId: jest.fn(() => ARCH_ID),
}));

describe('archModelClient - DecisionTask methods', () => {

  // ==========================================================================
  // Test 1: bulkSaveDecisionTasks sends POST to correct URL with tasks array
  // ==========================================================================
  describe('bulkSaveDecisionTasks', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('sends POST to correct URL with tasks array', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const tasks = [
        {
          id: 'task-001',
          runId,
          taskType: 'confirm_relationship' as const,
          status: 'pending' as const,
          inputData: {
            sourceAtom: {
              id: 'atom-001',
              runId,
              type: 'symbol' as const,
              data: { name: 'Foo', kind: 'class', relativePath: 'src/foo.ts', line: 1 },
              extractedAt: '2026-04-05T10:00:00Z',
            },
            targetAtom: {
              id: 'atom-002',
              runId,
              type: 'symbol' as const,
              data: { name: 'Bar', kind: 'class', relativePath: 'src/bar.ts', line: 5 },
              extractedAt: '2026-04-05T10:00:00Z',
            },
            proposedRelationshipType: 'imports' as const,
            confidence: 0.65,
            ruleId: 'imports-by-pattern',
          },
          outputData: null,
          createdAt: '2026-04-05T10:00:00Z',
          resolvedAt: null,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockPost = jest.fn().mockResolvedValue({ data: undefined });
      const mockAxiosInstance = {
        post: mockPost,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.bulkSaveDecisionTasks(projectId, runId, tasks);

      // Verify POST was called with the correct URL and body.
      // Production maps tasks to snake_case via mapDecisionTaskToBackend
      // before sending; assert the wire shape, not the camelCase TS shape.
      // Note: nested input_data sub-objects (sourceAtom/targetAtom) are
      // passed through unchanged because the mapper only flattens top-level
      // keys of DecisionTask.
      const expectedTasksBody = tasks.map((t) => ({
        id: t.id,
        run_id: t.runId,
        task_type: t.taskType,
        status: t.status,
        input_data: t.inputData,
        output_data: t.outputData,
        created_at: t.createdAt,
        resolved_at: t.resolvedAt,
      }));
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks`,
        expectedTasksBody
      );
    });
  });

  // ==========================================================================
  // Test 2: getDecisionTasksByRun sends GET with optional status and taskType query params
  // ==========================================================================
  describe('getDecisionTasksByRun', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('sends GET with optional status and taskType query params', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const mockTasks = [
        {
          id: 'task-001',
          runId,
          taskType: 'confirm_relationship',
          status: 'pending',
          inputData: {},
          outputData: null,
          createdAt: '2026-04-05T10:00:00Z',
          resolvedAt: null,
        },
      ];

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: mockTasks });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      // Call with both status and taskType filters
      const result = await archModelClient.getDecisionTasksByRun(
        projectId, runId, 'pending', 'confirm_relationship'
      );

      // Verify GET was called with the correct URL and params
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks`,
        { params: { status: 'pending', taskType: 'confirm_relationship' } }
      );

      // Verify the returned data
      expect(result).toEqual(mockTasks);
      expect(result.length).toBe(1);
      expect(result[0].taskType).toBe('confirm_relationship');
    });

    it('sends GET without params when status and taskType are not specified', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: [] });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      await archModelClient.getDecisionTasksByRun(projectId, runId);

      // Verify GET was called with empty params (no filters)
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks`,
        { params: {} }
      );
    });
  });

  // ==========================================================================
  // Test 3: getDecisionTaskCount sends GET to /count with optional status param
  // ==========================================================================
  describe('getDecisionTaskCount', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('sends GET to /count with optional status param', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: 5 });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getDecisionTaskCount(projectId, runId, 'pending');

      // Verify GET was called with the correct URL and status param
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks/count`,
        { params: { status: 'pending' } }
      );

      // Verify numeric return value
      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });

    it('sends GET to /count without params when status is not specified', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';

      // Setup axios mock
      const axios = require('axios');
      const mockGet = jest.fn().mockResolvedValue({ data: 12 });
      const mockAxiosInstance = {
        get: mockGet,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.getDecisionTaskCount(projectId, runId);

      // Verify GET was called with empty params (no status filter)
      expect(mockGet).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks/count`,
        { params: {} }
      );

      expect(result).toBe(12);
    });
  });

  // ==========================================================================
  // Test 4: updateDecisionTask sends PUT to correct URL with update payload
  // ==========================================================================
  describe('updateDecisionTask', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    it('sends PUT to correct URL with update payload and returns updated task', async () => {
      const projectId = '550e8400-e29b-41d4-a716-446655440000';
      const runId = 'run-uuid-001';
      const taskId = 'task-001';
      const update = {
        status: 'resolved' as const,
        outputData: {
          decision: 'confirm' as const,
          adjustedConfidence: 0.85,
          reasoning: 'Import statement matches symbol name exactly.',
        },
        resolvedAt: '2026-04-05T10:05:00Z',
      };

      const mockResponse = {
        id: taskId,
        runId,
        taskType: 'confirm_relationship',
        status: 'resolved',
        inputData: {
          sourceAtom: { id: 'atom-001' },
          targetAtom: { id: 'atom-002' },
          proposedRelationshipType: 'imports',
          confidence: 0.65,
          ruleId: 'imports-by-pattern',
        },
        outputData: update.outputData,
        createdAt: '2026-04-05T10:00:00Z',
        resolvedAt: '2026-04-05T10:05:00Z',
      };

      // Setup axios mock
      const axios = require('axios');
      const mockPut = jest.fn().mockResolvedValue({ data: mockResponse });
      const mockAxiosInstance = {
        put: mockPut,
        interceptors: { response: { use: jest.fn() } },
      };
      axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

      // Import the client (after mocks are set up)
      const { archModelClient } = require('../services/archModelClient');

      const result = await archModelClient.updateDecisionTask(
        projectId, runId, taskId, update
      );

      // Verify PUT was called with the correct URL and body.
      // Production calls mapDecisionTaskToBackend(update as DecisionTask),
      // producing a fully-keyed snake_case object: missing fields become
      // `undefined` (no `?? null` defaulting on DecisionTask fields).
      const expectedUpdateBody = {
        id: undefined,
        run_id: undefined,
        task_type: undefined,
        status: update.status,
        input_data: undefined,
        output_data: update.outputData,
        created_at: undefined,
        resolved_at: update.resolvedAt,
      };
      expect(mockPut).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(ARCH_ID)}/discovery/runs/${encodeURIComponent(runId)}/decision-tasks/${encodeURIComponent(taskId)}`,
        expectedUpdateBody
      );

      // Verify the returned data
      expect(result).toEqual(mockResponse);
      expect(result.id).toBe(taskId);
      expect(result.status).toBe('resolved');
      expect(result.outputData.decision).toBe('confirm');
    });
  });
});

// ==========================================================================
// Test 5: gatewayClient.resolveDecisionTasks sends POST to gateway resolution endpoint
// ==========================================================================
describe('gatewayClient - resolveDecisionTasks', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('sends POST to gateway resolution endpoint with correct body shape', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000';
    const runId = 'run-uuid-001';
    const tasks = [
      {
        id: 'task-001',
        runId,
        taskType: 'confirm_relationship' as const,
        status: 'pending' as const,
        inputData: {
          sourceAtom: {
            id: 'atom-001',
            runId,
            type: 'symbol' as const,
            data: { name: 'Foo', kind: 'class', relativePath: 'src/foo.ts', line: 1 },
            extractedAt: '2026-04-05T10:00:00Z',
          },
          targetAtom: {
            id: 'atom-002',
            runId,
            type: 'symbol' as const,
            data: { name: 'Bar', kind: 'class', relativePath: 'src/bar.ts', line: 5 },
            extractedAt: '2026-04-05T10:00:00Z',
          },
          proposedRelationshipType: 'imports' as const,
          confidence: 0.65,
          ruleId: 'imports-by-pattern',
        },
        outputData: null,
        createdAt: '2026-04-05T10:00:00Z',
        resolvedAt: null,
      },
    ];

    const mockResolutionResults = {
      results: [
        {
          taskId: 'task-001',
          status: 'resolved' as const,
          outputData: {
            decision: 'confirm' as const,
            adjustedConfidence: 0.88,
            reasoning: 'The import statement directly matches the symbol name.',
          },
          error: null,
        },
      ],
    };

    // Setup axios mock
    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValue({ data: mockResolutionResults });
    const mockAxiosInstance = {
      post: mockPost,
        interceptors: { response: { use: jest.fn() } },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // Import the gateway client (after mocks are set up)
    const { gatewayClient } = require('../services/gatewayClient');

    const result = await gatewayClient.resolveDecisionTasks(projectId, runId, tasks);

    // Verify POST was called with the correct URL and body shape
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/discovery/resolve-decision-tasks',
      { projectId, runId, tasks }
    );

    // Verify the returned data
    expect(result).toEqual(mockResolutionResults);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].taskId).toBe('task-001');
    expect(result.results[0].status).toBe('resolved');
    expect(result.results[0].outputData.decision).toBe('confirm');
    expect(result.results[0].error).toBeNull();
  });
});
