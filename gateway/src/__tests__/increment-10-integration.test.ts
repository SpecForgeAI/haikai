/**
 * Increment 10 Integration Tests -- Gap Analysis Coverage
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Task Group 4, Task 4.3: Strategic tests to fill coverage gaps
 *
 * These tests verify integration points NOT already covered by TG1-TG3:
 *
 * 1. buildSystemPrompt still returns valid prompt for oas_assistant mode after
 *    PM/SA/Roadmap branches were removed from promptBuilder.ts
 * 2. buildSystemPrompt still returns valid prompt for implement_feature mode
 *    (refine phase) after cleanup
 * 3. chatV2.ts /generate endpoint for architecture-baseline still works
 *    (imports validateBaselineJsonShape from the new chatValidation.ts path)
 * 4. chatV2.ts POST handler can still import roadmap context helpers
 *    (buildRoadmapSummary, hasExistingRoadmap, countRoadmapItems from
 *    roadmapSummaryBuilder.ts -- barrel export removed but direct import kept)
 */

import { buildSystemPrompt } from '../services/promptBuilder';
import { GatewaySession } from '../types/session';
import { ChatContext } from '../types/chat';
import {
  validateBaselineJsonShape,
  ensureMinimumServices,
  buildConversationTranscript,
  BASELINE_JSON_CORRECTIVE_INSTRUCTION,
} from '../routes/chatValidation';
import {
  buildRoadmapSummary,
  hasExistingRoadmap,
  countRoadmapItems,
} from '../services/roadmapSummaryBuilder';

// Mock logger to prevent console noise
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
  logToolCall: jest.fn(),
  logOpenAIRequest: jest.fn(),
}));

describe('Increment 10 Integration -- Gap Coverage', () => {
  // -------------------------------------------------------------------------
  // Gap 1: buildSystemPrompt for oas_assistant mode
  // -------------------------------------------------------------------------
  describe('buildSystemPrompt -- oas_assistant mode after cleanup', () => {
    it('returns a valid OAS assistant prompt with context placeholders replaced', () => {
      const session: GatewaySession = {
        sessionId: 'test-oas-session',
        mcpSessionId: 'mcp-1',
        filename: 'my-architecture.json',
        interfaceId: 'iface-001',
        conversation: [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const context: ChatContext = {
        mode: 'oas_assistant',
        filename: 'my-architecture.json',
        interfaceId: 'iface-001',
        preferredFormat: 'yaml',
      };

      const prompt = buildSystemPrompt(session, context);

      // Verify the prompt is a non-empty string
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);

      // Verify OAS-specific content is present
      expect(prompt).toContain('OpenAPI');
      expect(prompt).toContain('my-architecture.json');
      expect(prompt).toContain('iface-001');
      expect(prompt).toContain('yaml');

      // Verify legacy PM/SA/Roadmap prompts are NOT present
      expect(prompt).not.toContain('Product Manager');
      expect(prompt).not.toContain('Solution Architect');
      expect(prompt).not.toContain('Roadmap');
    });
  });

  // -------------------------------------------------------------------------
  // Gap 2: buildSystemPrompt for implement_feature mode (refine phase)
  // -------------------------------------------------------------------------
  describe('buildSystemPrompt -- implement_feature refine phase after cleanup', () => {
    it('returns a valid Implementation Planner prompt with work item context', () => {
      const session: GatewaySession = {
        sessionId: 'test-impl-session',
        mcpSessionId: 'mcp-2',
        conversation: [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      const context: ChatContext = {
        mode: 'implement_feature',
        phase: 'refine',
        workItem: {
          id: 'FEAT-42',
          title: 'User Login Feature',
          type: 'Feature',
          description: 'Allow users to log in with email and password',
        },
        architectureContext: {
          entityIds: ['svc-1', 'de-1'],
          diagramIds: ['diag-1'],
        },
      };

      const prompt = buildSystemPrompt(session, context);

      // Verify the prompt is a non-empty string
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);

      // Verify implement planner content is present
      expect(prompt).toContain('Implementation Planner');
      expect(prompt).toContain('User Login Feature');
      expect(prompt).toContain('Feature');
      expect(prompt).toContain('Allow users to log in');

      // Verify JSON schema instructions are present
      expect(prompt).toContain('schemaVersion');
      expect(prompt).toContain('plannerReadyForSpec');
    });
  });

  // -------------------------------------------------------------------------
  // Gap 3: chatValidation.ts import chain still works for chatV2 baseline flow
  // -------------------------------------------------------------------------
  describe('chatValidation.ts imports still resolve correctly for chatV2 usage', () => {
    it('validateBaselineJsonShape is importable from chatValidation and works for baseline generation', () => {
      const validBaseline = {
        services: [{ name: 'API Gateway', description: 'Entry point' }],
        interfaces: [{ name: 'REST API', serviceRef: 'API Gateway' }],
        interfaceEndpoints: [],
        logicalDataEntities: [],
        physicalDataEntities: [],
        businessLogic: [],
        dataMovements: [],
      };

      const result = validateBaselineJsonShape(validBaseline);
      expect(result.valid).toBe(true);
    });

    it('ensureMinimumServices is importable from chatValidation and injects default service', () => {
      const emptyBaseline: Record<string, unknown> = {
        services: [],
        interfaces: [],
      };

      const result = ensureMinimumServices(emptyBaseline);
      expect(Array.isArray(result.services)).toBe(true);
      expect((result.services as Array<{ name: string }>).length).toBe(1);
      expect((result.services as Array<{ name: string }>)[0].name).toBe('Core Application Service');
    });

    it('BASELINE_JSON_CORRECTIVE_INSTRUCTION is importable from chatValidation', () => {
      expect(typeof BASELINE_JSON_CORRECTIVE_INSTRUCTION).toBe('string');
      expect(BASELINE_JSON_CORRECTIVE_INSTRUCTION.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Gap 4: roadmapSummaryBuilder helpers still importable (direct import, not barrel)
  // -------------------------------------------------------------------------
  describe('roadmapSummaryBuilder helpers still importable after barrel cleanup', () => {
    it('buildRoadmapSummary is importable from roadmapSummaryBuilder and returns empty for null input', () => {
      const result = buildRoadmapSummary(null as any);
      expect(typeof result).toBe('string');
      expect(result).toBe('');
    });

    it('hasExistingRoadmap is importable and returns false for null input', () => {
      const result = hasExistingRoadmap(null as any);
      expect(result).toBe(false);
    });

    it('countRoadmapItems is importable and returns zeroes for null input', () => {
      const result = countRoadmapItems(null as any);
      // The actual return shape uses initiativeCount and epicCount
      expect(result).toEqual({ initiativeCount: 0, epicCount: 0 });
    });
  });
});
