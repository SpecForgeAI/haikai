/**
 * Tests for Workspace State Mapper
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 5: Workspace State Mapping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mapStateToPersisted,
  mapPersistedToState,
  ComponentWorkspaceState,
} from './workspaceStateMapper';
import type { PersistedWorkspaceState } from '../api/implementWorkspaceApi';
import type { PlannerResponse, Question, ChatMessage } from '../api/chatApi';

// Mock the validateLLMPayload module
vi.mock('./validateLLMPayload', () => ({
  validateLLMPayload: vi.fn(() => ({ valid: true, errors: [] })),
}));

describe('workspaceStateMapper', () => {
  describe('mapStateToPersisted', () => {
    /**
     * Test 1: mapStateToPersisted correctly extracts persistable fields.
     */
    it('correctly extracts persistable fields', () => {
      // Given
      const mockPlannerResponse: PlannerResponse = {
        schemaVersion: '1.1',
        message: 'Test message',
        featureUnderstanding: 'Test feature',
        scope: { in: ['item1'], out: ['item2'] },
        assumptions: ['assumption1'],
        acceptanceCriteria: ['criteria1'],
        openQuestions: [{ id: 'q1', question: 'What is X?' }],
        plannerReadyForSpec: false,
        implementationPlan: null,
      };

      const mockMessages: ChatMessage[] = [
        { id: 'm1', role: 'assistant', content: 'Hello', timestamp: new Date('2026-01-23T10:00:00Z') },
        { id: 'm2', role: 'user', content: 'Hi', timestamp: new Date('2026-01-23T10:01:00Z') },
      ];

      const state: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: mockPlannerResponse,
        activeIncrementId: 'INC-1',
        answers: { q1: 'Answer to X' },
        saQuestions: [
          { id: 'sq1', question: 'SA Question', status: 'Open', answer: '', source: 'Software Developer', incrementId: 'INC-1' },
        ],
        incrementStatuses: new Map([['INC-1', 'IN_CLARIFICATION']]),
        incrementArtifacts: new Map([['INC-1', { shapeSpecArtifact: 'spec content' }]]),
        messages: mockMessages,
        currentPhase: 'refine',
      };

      // When
      const result = mapStateToPersisted(state);

      // Then
      expect(result.schemaVersion).toBe(1);
      expect(result.implementationMode).toBe(true);
      expect(result.activeIncrementId).toBe('INC-1');
      expect(result.questions).toHaveLength(2); // 1 PO + 1 SA
      expect(result.questions[0].id).toBe('q1');
      expect(result.questions[0].source).toBe('Product Manager');
      expect(result.questions[1].id).toBe('sq1');
      expect(result.questions[1].source).toBe('Software Developer');
      expect(result.executionArtifactsByIncrement['INC-1'].shapeSpecArtifact).toBe('spec content');
      expect(result.teamChatTranscript).toHaveLength(2);
    });

    /**
     * Test 2: mapStateToPersisted excludes transient fields.
     */
    it('excludes transient fields (isLoading, isBootstrapping, etc.)', () => {
      // Given
      const state: ComponentWorkspaceState = {
        implementationMode: false,
        latestPlannerResponse: null,
        activeIncrementId: null,
        answers: {},
        saQuestions: [],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map(),
        messages: [],
        currentPhase: 'refine',
      };

      // When
      const result = mapStateToPersisted(state);

      // Then - verify transient fields are NOT in the result
      const resultKeys = Object.keys(result);
      expect(resultKeys).not.toContain('isLoading');
      expect(resultKeys).not.toContain('isBootstrapping');
      expect(resultKeys).not.toContain('isImplementing');
      expect(resultKeys).not.toContain('isSubmittingAnswers');
      expect(resultKeys).not.toContain('activeTab');
      expect(resultKeys).not.toContain('isConfirmModalOpen');
      expect(resultKeys).not.toContain('error');
      expect(resultKeys).not.toContain('sessionId');
      expect(resultKeys).not.toContain('inputDraft');
    });
  });

  describe('mapPersistedToState', () => {
    /**
     * Test 3: mapPersistedToState restores state from persisted format.
     */
    it('restores state from persisted format', () => {
      // Given
      const persisted: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: {
          schemaVersion: '1.1',
          message: 'Restored',
          featureUnderstanding: 'Test',
          scope: { in: [], out: [] },
          assumptions: [],
          acceptanceCriteria: [],
          openQuestions: [{ id: 'q1', question: 'Q1?' }],
          plannerReadyForSpec: false,
          implementationPlan: null,
        },
        activeIncrementId: 'INC-2',
        questions: [
          { id: 'q1', question: 'Q1?', status: 'Answered', answer: 'A1', source: 'Product Manager' },
          { id: 'sq1', question: 'SQ1?', status: 'Open', answer: '', source: 'Software Developer', incrementId: 'INC-2' },
        ],
        executionArtifactsByIncrement: {
          'INC-1': { shapeSpecArtifact: 'spec', implementationResult: 'done' },
        },
        teamChatTranscript: [
          { id: 'm1', role: 'assistant', message: 'Hello', createdAt: '2026-01-23T10:00:00Z' },
        ],
      };

      // When
      const result = mapPersistedToState(persisted);

      // Then
      expect(result.implementationMode).toBe(true);
      expect(result.activeIncrementId).toBe('INC-2');
      expect(result.answers['q1']).toBe('A1');
      expect(result.saQuestions).toHaveLength(1);
      expect(result.saQuestions[0].incrementId).toBe('INC-2');
      expect(result.incrementArtifacts.get('INC-1')?.implementationResult).toBe('done');
      expect(result.incrementStatuses.get('INC-1')).toBe('COMPLETED');
      expect(result.messages).toHaveLength(1);
      expect(result.hasBootstrapped).toBe(true);
    });

    /**
     * Test 4: mapPersistedToState applies safe defaults for missing fields.
     */
    it('applies safe defaults for missing fields', () => {
      // Given - minimal persisted state
      const persisted: PersistedWorkspaceState = {
        schemaVersion: 1,
        implementationMode: false,
        plannerPayload: null,
        activeIncrementId: null,
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When
      const result = mapPersistedToState(persisted);

      // Then - all fields should have safe defaults
      expect(result.implementationMode).toBe(false);
      expect(result.latestPlannerResponse).toBeNull();
      expect(result.activeIncrementId).toBeNull();
      expect(result.answers).toEqual({});
      expect(result.saQuestions).toEqual([]);
      expect(result.incrementStatuses.size).toBe(0);
      expect(result.incrementArtifacts.size).toBe(0);
      expect(result.messages).toEqual([]);
      expect(result.hasBootstrapped).toBe(false);
    });

    /**
     * Test: mapPersistedToState handles null input.
     */
    it('handles null input with empty defaults', () => {
      // When
      const result = mapPersistedToState(null);

      // Then
      expect(result.implementationMode).toBe(false);
      expect(result.latestPlannerResponse).toBeNull();
      expect(result.hasBootstrapped).toBe(false);
    });
  });
});
