/**
 * Persistence Round-Trip Tests
 *
 * Tests that workspace state can be saved and loaded without data loss.
 * Verifies complete round-trip: component state -> persisted -> component state.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 11: Persistence Round-Trip Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mapStateToPersisted,
  mapPersistedToState,
  ComponentWorkspaceState,
} from '../utils/workspaceStateMapper';
import type { ChatMessage, PlannerResponse, Question } from '../api/chatApi';
import type { IncrementArtifacts, IncrementStatus } from '../components/ProductView/ImplementationAssistantPanel';

// Mock the validateLLMPayload module
vi.mock('../utils/validateLLMPayload', () => ({
  validateLLMPayload: vi.fn(() => ({ valid: true, errors: [] })),
}));

describe('Persistence Round-Trip Tests', () => {
  /**
   * Test 1: Complete workspace state round-trips successfully.
   */
  describe('full workspace round-trip', () => {
    it('preserves all persistable fields through save -> load cycle', () => {
      // Given - Complete workspace state
      const originalState: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: createMockPlannerResponse(),
        activeIncrementId: 'INC-001',
        answers: {
          'po-001': 'Answer to PO question 1',
          'po-002': 'Answer to PO question 2',
          'sa-001': 'Answer to SA question 1',
        },
        saQuestions: [
          {
            id: 'sa-001',
            question: 'What database to use?',
            status: 'Answered',
            answer: 'PostgreSQL',
            source: 'Software Architect',
            incrementId: 'INC-001',
          },
          {
            id: 'sa-002',
            question: 'Which cloud provider?',
            status: 'Open',
            answer: '',
            source: 'Software Architect',
            incrementId: 'INC-001',
          },
        ],
        incrementStatuses: new Map([
          ['INC-001', 'IN_CLARIFICATION'],
          ['INC-002', 'NOT_STARTED'],
        ]),
        incrementArtifacts: new Map([
          ['INC-001', {
            shapeSpecArtifact: 'Shape spec content',
            writeSpecArtifact: 'Write spec content',
          }],
        ]),
        messages: createMockMessages(),
        currentPhase: 'implementation_clarification',
      };

      // When - Save and reload
      const persisted = mapStateToPersisted(originalState);
      const restored = mapPersistedToState(persisted);

      // Then - Verify key fields are preserved
      expect(restored.implementationMode).toBe(originalState.implementationMode);
      expect(restored.activeIncrementId).toBe(originalState.activeIncrementId);

      // Verify answers are preserved
      expect(restored.answers['po-001']).toBe('Answer to PO question 1');
      expect(restored.answers['sa-001']).toBeDefined(); // SA answer is in the saQuestions

      // Verify SA questions are preserved
      expect(restored.saQuestions).toHaveLength(2);
      expect(restored.saQuestions.find(q => q.id === 'sa-001')?.incrementId).toBe('INC-001');

      // Verify increment artifacts are preserved
      expect(restored.incrementArtifacts.get('INC-001')?.shapeSpecArtifact).toBe('Shape spec content');

      // Verify messages are preserved
      expect(restored.messages).toHaveLength(originalState.messages.length);
      expect(restored.hasBootstrapped).toBe(true);
    });
  });

  /**
   * Test 2: Empty workspace state round-trips successfully.
   */
  describe('empty workspace round-trip', () => {
    it('preserves default values through save -> load cycle', () => {
      // Given - Empty/default state
      const emptyState: ComponentWorkspaceState = {
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
      const persisted = mapStateToPersisted(emptyState);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.implementationMode).toBe(false);
      expect(restored.latestPlannerResponse).toBeNull();
      expect(restored.activeIncrementId).toBeNull();
      expect(Object.keys(restored.answers)).toHaveLength(0);
      expect(restored.saQuestions).toHaveLength(0);
      expect(restored.incrementStatuses.size).toBe(0);
      expect(restored.incrementArtifacts.size).toBe(0);
      expect(restored.messages).toHaveLength(0);
      expect(restored.hasBootstrapped).toBe(false);
    });
  });

  /**
   * Test 3: Complex message history round-trips successfully.
   */
  describe('message history round-trip', () => {
    it('preserves message order and content', () => {
      // Given
      const messagesState: ComponentWorkspaceState = {
        implementationMode: false,
        latestPlannerResponse: null,
        activeIncrementId: null,
        answers: {},
        saQuestions: [],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map(),
        messages: [
          { id: 'm1', role: 'assistant', content: 'Hello, I am the Product Owner.', timestamp: new Date('2026-01-23T10:00:00Z') },
          { id: 'm2', role: 'user', content: 'I want to implement a dashboard.', timestamp: new Date('2026-01-23T10:01:00Z') },
          { id: 'm3', role: 'assistant', content: 'Great! Let me understand the requirements.', timestamp: new Date('2026-01-23T10:02:00Z') },
          { id: 'm4', role: 'user', content: 'It should show real-time metrics.', timestamp: new Date('2026-01-23T10:03:00Z') },
          { id: 'm5', role: 'assistant', content: 'I have some questions about the metrics...', timestamp: new Date('2026-01-23T10:04:00Z') },
        ],
        currentPhase: 'refine',
      };

      // When
      const persisted = mapStateToPersisted(messagesState);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.messages).toHaveLength(5);
      expect(restored.messages[0].id).toBe('m1');
      expect(restored.messages[0].content).toBe('Hello, I am the Product Owner.');
      expect(restored.messages[4].id).toBe('m5');
      expect(restored.messages[4].role).toBe('assistant');

      // Verify timestamps are preserved (as Date objects)
      expect(restored.messages[0].timestamp).toBeInstanceOf(Date);
    });
  });

  /**
   * Test 4: Increment status derivation is correct.
   */
  describe('increment status derivation', () => {
    it('derives COMPLETED status from artifacts with implementationResult', () => {
      // Given
      const state: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: null,
        activeIncrementId: 'INC-001',
        answers: {},
        saQuestions: [
          { id: 'sq1', question: 'Q?', status: 'Answered', answer: 'A', source: 'Software Architect', incrementId: 'INC-001' },
        ],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map([
          ['INC-001', { implementationResult: 'Implementation complete!' }],
        ]),
        messages: [],
        currentPhase: 'refine',
      };

      // When
      const persisted = mapStateToPersisted(state);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.incrementStatuses.get('INC-001')).toBe('COMPLETED');
    });

    it('derives FAILED status from artifacts with error', () => {
      // Given
      const state: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: null,
        activeIncrementId: 'INC-001',
        answers: {},
        saQuestions: [],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map([
          ['INC-001', { error: 'Build failed: syntax error' }],
        ]),
        messages: [],
        currentPhase: 'refine',
      };

      // When
      const persisted = mapStateToPersisted(state);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.incrementStatuses.get('INC-001')).toBe('FAILED');
    });

    it('derives IN_CLARIFICATION status from open SA questions', () => {
      // Given
      const state: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: null,
        activeIncrementId: 'INC-001',
        answers: {},
        saQuestions: [
          { id: 'sq1', question: 'Q?', status: 'Open', answer: '', source: 'Software Architect', incrementId: 'INC-001' },
        ],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map(),
        messages: [],
        currentPhase: 'refine',
      };

      // When
      const persisted = mapStateToPersisted(state);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.incrementStatuses.get('INC-001')).toBe('IN_CLARIFICATION');
    });

    it('derives READY_TO_EXECUTE status from all answered SA questions', () => {
      // Given
      const state: ComponentWorkspaceState = {
        implementationMode: true,
        latestPlannerResponse: null,
        activeIncrementId: 'INC-001',
        answers: { sq1: 'Answer 1', sq2: 'Answer 2' },
        saQuestions: [
          { id: 'sq1', question: 'Q1?', status: 'Answered', answer: 'A1', source: 'Software Architect', incrementId: 'INC-001' },
          { id: 'sq2', question: 'Q2?', status: 'Answered', answer: 'A2', source: 'Software Architect', incrementId: 'INC-001' },
        ],
        incrementStatuses: new Map(),
        incrementArtifacts: new Map(),
        messages: [],
        currentPhase: 'refine',
      };

      // When
      const persisted = mapStateToPersisted(state);
      const restored = mapPersistedToState(persisted);

      // Then
      expect(restored.incrementStatuses.get('INC-001')).toBe('READY_TO_EXECUTE');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockPlannerResponse(): PlannerResponse {
  return {
    schemaVersion: '1.1',
    message: 'I understand your requirements.',
    featureUnderstanding: 'Dashboard with real-time metrics',
    scope: { in: ['Real-time data'], out: ['Historical export'] },
    assumptions: ['API available'],
    acceptanceCriteria: ['Loads in 2s'],
    openQuestions: [
      { id: 'po-001', question: 'Refresh rate?' },
      { id: 'po-002', question: 'User limit?' },
    ],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };
}

function createMockMessages(): ChatMessage[] {
  return [
    { id: 'm1', role: 'assistant', content: 'Welcome!', timestamp: new Date('2026-01-23T10:00:00Z') },
    { id: 'm2', role: 'user', content: 'Hi!', timestamp: new Date('2026-01-23T10:01:00Z') },
  ];
}
