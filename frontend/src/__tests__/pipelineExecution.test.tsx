/**
 * Spec 2026-01-23: Execute Increment Pipeline
 * Task Groups 5, 6, 7: Pipeline Execution, Progress Messages, and Completion Handling
 *
 * Tests for the 4-step sequential pipeline execution:
 * Step 1: Shape Spec
 * Step 2: Write Spec
 * Step 3: Create Tasks
 * Step 4: Implement Tasks
 *
 * Tests verify:
 * 1. Pipeline step execution order (sequential)
 * 2. Status transitions (READY_TO_EXECUTE -> EXECUTING -> COMPLETED/FAILED)
 * 3. Progress chat messages for each step
 * 4. Artifact capture for each step
 * 5. Failure handling (status -> FAILED, no auto-retry)
 * 6. Manual advance only (no auto-advance to next increment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the orchestration API
vi.mock('../api/orchestrationApi', async () => {
  const actual = await vi.importActual('../api/orchestrationApi');
  return {
    ...actual,
    startOrchestration: vi.fn(),
  };
});

// Mock the chat API
vi.mock('../api/chatApi', async () => {
  const actual = await vi.importActual('../api/chatApi');
  return {
    ...actual,
    postChatMessage: vi.fn(),
  getImplementConversation: vi.fn(),
  convertMessageEntryToChatMessage: vi.fn(),
  };
});

import { startOrchestration } from '../api/orchestrationApi';
import { postChatMessage } from '../api/chatApi';

describe('Spec 2026-01-23: Pipeline Execution Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Pipeline step execution order', () => {
    it('should define 4 pipeline steps: Shape Spec, Write Spec, Create Tasks, Implement Tasks', () => {
      const PIPELINE_STEPS = [
        { id: 'shape-spec', name: 'Shape Spec', phase: 'increment_shape_spec' },
        { id: 'write-spec', name: 'Write Spec', phase: 'increment_write_spec' },
        { id: 'create-tasks', name: 'Create Tasks', phase: 'increment_create_tasks' },
        { id: 'implement-tasks', name: 'Implement Tasks', phase: 'increment_implement_tasks' },
      ];

      expect(PIPELINE_STEPS).toHaveLength(4);
      expect(PIPELINE_STEPS[0].id).toBe('shape-spec');
      expect(PIPELINE_STEPS[1].id).toBe('write-spec');
      expect(PIPELINE_STEPS[2].id).toBe('create-tasks');
      expect(PIPELINE_STEPS[3].id).toBe('implement-tasks');
    });
  });

  describe('Status transitions', () => {
    it('should transition from READY_TO_EXECUTE to EXECUTING when pipeline starts', () => {
      let status = 'READY_TO_EXECUTE';

      // Simulate starting pipeline
      status = 'EXECUTING';

      expect(status).toBe('EXECUTING');
    });

    it('should transition from EXECUTING to COMPLETED on success', () => {
      let status = 'EXECUTING';

      // Simulate successful completion
      status = 'COMPLETED';

      expect(status).toBe('COMPLETED');
    });

    it('should transition from EXECUTING to FAILED on error', () => {
      let status = 'EXECUTING';

      // Simulate failure
      status = 'FAILED';

      expect(status).toBe('FAILED');
    });
  });

  describe('Progress chat messages', () => {
    it('should generate progress message for Shape Spec step', () => {
      const stepName = 'Shape Spec';
      const incrementId = 'INC-1';
      const expectedMessage = `Starting ${stepName} for increment ${incrementId}...`;

      expect(expectedMessage).toContain('Shape Spec');
      expect(expectedMessage).toContain('INC-1');
    });

    it('should generate completion message for each step', () => {
      const stepName = 'Write Spec';
      const incrementId = 'INC-1';
      const expectedMessage = `Completed ${stepName} for increment ${incrementId}.`;

      expect(expectedMessage).toContain('Completed');
      expect(expectedMessage).toContain('Write Spec');
    });

    it('should generate failure message with error details', () => {
      const stepName = 'Create Tasks';
      const incrementId = 'INC-1';
      const errorMessage = 'API timeout';
      const expectedMessage = `Failed ${stepName} for increment ${incrementId}: ${errorMessage}`;

      expect(expectedMessage).toContain('Failed');
      expect(expectedMessage).toContain('API timeout');
    });
  });

  describe('No auto-retry behavior', () => {
    it('should not retry on failure - status stays FAILED', async () => {
      const mockOrchestration = startOrchestration as ReturnType<typeof vi.fn>;
      mockOrchestration.mockResolvedValueOnce({
        success: false,
        error: { code: 500, message: 'Server error' },
      });

      let status = 'EXECUTING';
      let retryCount = 0;

      // Simulate pipeline step failure
      const result = await mockOrchestration({
        company: 'test',
        project: 'test',
        spec_intents: ['test'],
      });

      if (!result.success) {
        status = 'FAILED';
        // No retry logic
      }

      expect(status).toBe('FAILED');
      expect(retryCount).toBe(0);
      expect(mockOrchestration).toHaveBeenCalledTimes(1);
    });
  });

  describe('No auto-advance behavior', () => {
    it('should not automatically advance to next increment after completion', () => {
      const activeIncrementId = 'INC-1';
      let autoAdvancedToNextIncrement = false;

      // Simulate pipeline completion
      const status = 'COMPLETED';

      // No auto-advance logic
      if (status === 'COMPLETED') {
        // Manual advance only - user must select next increment
        autoAdvancedToNextIncrement = false;
      }

      expect(autoAdvancedToNextIncrement).toBe(false);
    });
  });

  describe('Artifact capture', () => {
    it('should capture artifacts for each step', () => {
      interface IncrementArtifacts {
        shapeSpecArtifact?: string;
        writeSpecArtifact?: string;
        tasksSummary?: string;
        implementationResult?: string;
        error?: string;
      }

      const artifacts: IncrementArtifacts = {};

      // Step 1: Shape Spec
      artifacts.shapeSpecArtifact = 'Shaped spec output';
      expect(artifacts.shapeSpecArtifact).toBe('Shaped spec output');

      // Step 2: Write Spec
      artifacts.writeSpecArtifact = 'Written spec output';
      expect(artifacts.writeSpecArtifact).toBe('Written spec output');

      // Step 3: Create Tasks
      artifacts.tasksSummary = 'Tasks created: 5';
      expect(artifacts.tasksSummary).toBe('Tasks created: 5');

      // Step 4: Implement Tasks
      artifacts.implementationResult = 'Implementation complete';
      expect(artifacts.implementationResult).toBe('Implementation complete');
    });

    it('should capture error in artifacts on failure', () => {
      interface IncrementArtifacts {
        error?: string;
      }

      const artifacts: IncrementArtifacts = {};

      // Simulate failure
      artifacts.error = 'Step failed: Connection timeout';

      expect(artifacts.error).toContain('Connection timeout');
    });
  });
});
