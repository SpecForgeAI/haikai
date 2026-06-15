/**
 * Phase 1b Gap Tests -- Gateway-side strategic tests filling coverage gaps
 * identified during Task Group 11 review.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 11: Test Review and Gap Analysis
 *
 * Tests:
 * 6. Gateway JSON parsing resilience: malformed LLM response gracefully fails
 * 7. Gateway prompt template interpolation correctness: variables are properly substituted
 * 8. parseLlmJsonResponse handles edge cases (plain fences, extra whitespace)
 */

import request from 'supertest';
import express from 'express';

// ---------------------------------------------------------------------------
// Mocks
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { discoveryDecisionTasksRouter, parseLlmJsonResponse } from '../routes/discoveryDecisionTasks';
import { interpolateTemplate } from '../routes/discoveryDecisionTaskPrompts';

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

// Shared test data
function makeConfirmTask(id = 'task-gap-1') {
  return {
    id,
    runId: 'run-gap',
    taskType: 'confirm_relationship' as const,
    status: 'pending',
    inputData: {
      sourceAtom: {
        id: 'atom-src',
        runId: 'run-gap',
        type: 'string_pattern',
        data: {
          relativePath: 'src/services/userService.ts',
          patternName: 'import_statement',
          matchedText: "import { UserRepository } from './userRepository'",
          lineNumber: 1,
        },
        createdAt: '2026-04-05T12:00:00Z',
      },
      targetAtom: {
        id: 'atom-tgt',
        runId: 'run-gap',
        type: 'symbol',
        data: {
          relativePath: 'src/repositories/userRepository.ts',
          name: 'UserRepository',
          kind: 'class',
          lineNumber: 5,
        },
        createdAt: '2026-04-05T12:00:00Z',
      },
      proposedRelationshipType: 'imports',
      confidence: 0.65,
      ruleId: 'imports-by-pattern',
    },
    outputData: null,
    createdAt: '2026-04-05T12:00:00Z',
    resolvedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 1b Gateway Gap Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    mockSendChatRequest.mockReset();
  });

  // ==========================================================================
  // Test 6: Malformed LLM response gracefully fails the task
  // ==========================================================================
  test('malformed LLM response results in failed task status with error message', async () => {
    // LLM returns something that is not valid JSON at all
    mockSendChatRequest.mockResolvedValueOnce({
      id: 'llm-resp-malformed',
      content: 'This is not JSON at all. The model went off-script.',
      isFinal: true,
    });

    const response = await request(app)
      .post('/api/v1/discovery/resolve-decision-tasks')
      .send({
        projectId: 'proj-gap',
        runId: 'run-gap',
        tasks: [makeConfirmTask()],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);

    const result = response.body.results[0];
    expect(result.taskId).toBe('task-gap-1');
    expect(result.status).toBe('failed');
    expect(result.outputData).toBeNull();
    // Error should mention something about parsing or JSON
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Test 7: Prompt template interpolation substitutes variables correctly
  // ==========================================================================
  test('interpolateTemplate correctly substitutes all variables for confirm_relationship', () => {
    const template = [
      'Source: {{SOURCE_ATOM_TYPE}} at {{SOURCE_ATOM_FILE_PATH}}',
      'Source Data: {{SOURCE_ATOM_DATA}}',
      'Target: {{TARGET_ATOM_TYPE}} at {{TARGET_ATOM_FILE_PATH}}',
      'Target Data: {{TARGET_ATOM_DATA}}',
      'Relationship: {{RELATIONSHIP_TYPE}} ({{CONFIDENCE}}) by {{RULE_ID}}',
    ].join('\n');

    const inputData = {
      sourceAtom: {
        type: 'string_pattern',
        data: {
          relativePath: 'src/app.ts',
          patternName: 'import_statement',
          matchedText: 'import Foo',
        },
      },
      targetAtom: {
        type: 'symbol',
        data: {
          relativePath: 'src/foo.ts',
          name: 'Foo',
          kind: 'class',
        },
      },
      proposedRelationshipType: 'imports',
      confidence: 0.65,
      ruleId: 'imports-by-pattern',
    };

    const result = interpolateTemplate(template, 'confirm_relationship', inputData);

    // Verify all placeholders were replaced
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');

    // Verify specific substitutions
    expect(result).toContain('Source: string_pattern at src/app.ts');
    expect(result).toContain('Target: symbol at src/foo.ts');
    expect(result).toContain('Relationship: imports (0.65) by imports-by-pattern');

    // Verify source/target data are valid JSON
    expect(result).toContain('"patternName": "import_statement"');
    expect(result).toContain('"name": "Foo"');
  });

  // ==========================================================================
  // Test 8: parseLlmJsonResponse handles various edge cases
  // ==========================================================================
  describe('parseLlmJsonResponse edge cases', () => {
    test('parses raw JSON string correctly', () => {
      const raw = '{"decision":"confirm","adjustedConfidence":0.9,"reasoning":"test"}';
      const parsed = parseLlmJsonResponse(raw);

      expect(parsed.decision).toBe('confirm');
      expect(parsed.adjustedConfidence).toBe(0.9);
      expect(parsed.reasoning).toBe('test');
    });

    test('strips markdown fences without "json" language tag', () => {
      const raw = '```\n{"selectedIndex":1,"adjustedConfidence":0.7,"reasoning":"plain fence"}\n```';
      const parsed = parseLlmJsonResponse(raw);

      expect(parsed.selectedIndex).toBe(1);
      expect(parsed.adjustedConfidence).toBe(0.7);
    });

    test('handles extra whitespace around fences', () => {
      const raw = '  ```json\n  {"decision":"reject","adjustedConfidence":0.0,"reasoning":"ws test"}  \n```  ';
      const parsed = parseLlmJsonResponse(raw);

      expect(parsed.decision).toBe('reject');
      expect(parsed.adjustedConfidence).toBe(0.0);
    });

    test('throws on completely invalid content', () => {
      expect(() => parseLlmJsonResponse('not json at all')).toThrow();
    });
  });
});
