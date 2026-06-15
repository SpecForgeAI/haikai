/**
 * Tests for v2 conversation engine type contracts
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 1: Types and Interfaces
 *
 * Tests:
 * 1. ThreadKey discriminated union narrowing for all 3 variants (hub, feature, panel)
 * 2. threadKeyToString() produces expected serialized form for each variant
 * 3. parseThreadKey() round-trips correctly (serialize then parse)
 * 4. ChatV2Request and ChatV2Response type guards validate required fields
 */

import {
  ThreadKey,
  HubThreadKey,
  FeatureThreadKey,
  PanelThreadKey,
  threadKeyToString,
  parseThreadKey,
  ThreadMessage,
  Thread,
  PersonaDefinition,
  TaskDefinition,
  PhaseDefinition,
  ContextResolverConfig,
  ChatV2Request,
  ChatV2Response,
  isChatV2Request,
  isChatV2Response,
} from '../types/chatV2';

describe('ChatV2 Types (Spec 2026-02-28)', () => {
  // ========================================================================
  // Test 1: ThreadKey discriminated union narrowing
  // ========================================================================
  describe('ThreadKey discriminated union narrowing', () => {
    it('should narrow to HubThreadKey when type is hub', () => {
      const key: ThreadKey = { type: 'hub', projectId: 'proj-001' };

      expect(key.type).toBe('hub');
      expect(key.projectId).toBe('proj-001');

      // Verify discriminated union narrowing works at runtime
      if (key.type === 'hub') {
        // TypeScript narrows to HubThreadKey here
        const hubKey: HubThreadKey = key;
        expect(hubKey.projectId).toBe('proj-001');
      }
    });

    it('should narrow to FeatureThreadKey when type is feature', () => {
      const key: ThreadKey = { type: 'feature', projectId: 'proj-002', featureId: 'feat-abc' };

      expect(key.type).toBe('feature');
      expect(key.projectId).toBe('proj-002');

      if (key.type === 'feature') {
        // TypeScript narrows to FeatureThreadKey here
        const featureKey: FeatureThreadKey = key;
        expect(featureKey.featureId).toBe('feat-abc');
      }
    });

    it('should narrow to PanelThreadKey when type is panel', () => {
      const key: ThreadKey = { type: 'panel', projectId: 'proj-003', screen: 'entity-detail', entityId: 'ent-xyz' };

      expect(key.type).toBe('panel');
      expect(key.projectId).toBe('proj-003');

      if (key.type === 'panel') {
        // TypeScript narrows to PanelThreadKey here
        const panelKey: PanelThreadKey = key;
        expect(panelKey.screen).toBe('entity-detail');
        expect(panelKey.entityId).toBe('ent-xyz');
      }
    });

    it('should narrow to PanelThreadKey without entityId (optional)', () => {
      const key: ThreadKey = { type: 'panel', projectId: 'proj-004', screen: 'dashboard' };

      if (key.type === 'panel') {
        const panelKey: PanelThreadKey = key;
        expect(panelKey.screen).toBe('dashboard');
        expect(panelKey.entityId).toBeUndefined();
      }
    });

    it('should work in a switch statement for exhaustive handling', () => {
      function describeKey(key: ThreadKey): string {
        switch (key.type) {
          case 'hub':
            return `hub:${key.projectId}`;
          case 'feature':
            return `feature:${key.projectId}:${key.featureId}`;
          case 'panel':
            return `panel:${key.projectId}:${key.screen}`;
        }
      }

      expect(describeKey({ type: 'hub', projectId: 'p1' })).toBe('hub:p1');
      expect(describeKey({ type: 'feature', projectId: 'p2', featureId: 'f1' })).toBe('feature:p2:f1');
      expect(describeKey({ type: 'panel', projectId: 'p3', screen: 's1' })).toBe('panel:p3:s1');
    });
  });

  // ========================================================================
  // Test 2: threadKeyToString() serialization
  // ========================================================================
  describe('threadKeyToString()', () => {
    it('should serialize hub key to project:{projectId}:hub', () => {
      const key: ThreadKey = { type: 'hub', projectId: 'my-project-123' };
      expect(threadKeyToString(key)).toBe('project:my-project-123:hub');
    });

    it('should serialize feature key to project:{projectId}:feature:{featureId}', () => {
      const key: ThreadKey = { type: 'feature', projectId: 'proj-abc', featureId: 'feat-def' };
      expect(threadKeyToString(key)).toBe('project:proj-abc:feature:feat-def');
    });

    it('should serialize panel key with entityId to project:{projectId}:panel:{screen}:{entityId}', () => {
      const key: ThreadKey = { type: 'panel', projectId: 'proj-xyz', screen: 'entity-detail', entityId: 'ent-001' };
      expect(threadKeyToString(key)).toBe('project:proj-xyz:panel:entity-detail:ent-001');
    });

    it('should serialize panel key without entityId to project:{projectId}:panel:{screen}', () => {
      const key: ThreadKey = { type: 'panel', projectId: 'proj-xyz', screen: 'dashboard' };
      expect(threadKeyToString(key)).toBe('project:proj-xyz:panel:dashboard');
    });
  });

  // ========================================================================
  // Test 3: parseThreadKey() and round-trip
  // ========================================================================
  describe('parseThreadKey() round-trip', () => {
    it('should round-trip hub key correctly', () => {
      const original: ThreadKey = { type: 'hub', projectId: 'proj-001' };
      const serialized = threadKeyToString(original);
      const parsed = parseThreadKey(serialized);

      expect(parsed).toEqual(original);
      expect(parsed.type).toBe('hub');
    });

    it('should round-trip feature key correctly', () => {
      const original: ThreadKey = { type: 'feature', projectId: 'proj-002', featureId: 'feat-abc' };
      const serialized = threadKeyToString(original);
      const parsed = parseThreadKey(serialized);

      expect(parsed).toEqual(original);
      expect(parsed.type).toBe('feature');
    });

    it('should round-trip panel key with entityId correctly', () => {
      const original: ThreadKey = { type: 'panel', projectId: 'proj-003', screen: 'entity-detail', entityId: 'ent-xyz' };
      const serialized = threadKeyToString(original);
      const parsed = parseThreadKey(serialized);

      expect(parsed).toEqual(original);
      expect(parsed.type).toBe('panel');
    });

    it('should round-trip panel key without entityId correctly', () => {
      const original: ThreadKey = { type: 'panel', projectId: 'proj-004', screen: 'dashboard' };
      const serialized = threadKeyToString(original);
      const parsed = parseThreadKey(serialized);

      expect(parsed).toEqual(original);
      expect(parsed.type).toBe('panel');
    });

    it('should throw on invalid thread key format', () => {
      expect(() => parseThreadKey('')).toThrow('Invalid thread key format');
      expect(() => parseThreadKey('invalid')).toThrow('Invalid thread key format');
      expect(() => parseThreadKey('project:abc')).toThrow('Invalid thread key format');
      expect(() => parseThreadKey('project:abc:unknown')).toThrow("Unknown thread key type 'unknown'");
    });

    it('should throw on malformed hub key with extra segments', () => {
      expect(() => parseThreadKey('project:abc:hub:extra')).toThrow('Invalid hub thread key format');
    });

    it('should throw on malformed feature key with missing featureId', () => {
      expect(() => parseThreadKey('project:abc:feature')).toThrow('Invalid feature thread key format');
    });

    it('should throw on malformed panel key with missing screen', () => {
      expect(() => parseThreadKey('project:abc:panel')).toThrow('Invalid panel thread key format');
    });
  });

  // ========================================================================
  // Test 4: ChatV2Request and ChatV2Response type guards
  // ========================================================================
  describe('isChatV2Request() type guard', () => {
    it('should return true for a valid request with all required fields', () => {
      const request = {
        threadKey: { type: 'hub', projectId: 'proj-001' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Define my product',
      };

      expect(isChatV2Request(request)).toBe(true);
    });

    it('should return true for a valid request with files', () => {
      const request = {
        threadKey: { type: 'feature', projectId: 'proj-001', featureId: 'feat-001' },
        personaId: 'architect',
        taskId: 'architect--define-architecture',
        message: 'Review this document',
        files: [
          { filename: 'spec.pdf', mimeType: 'application/pdf', base64: 'dGVzdA==' },
        ],
      };

      expect(isChatV2Request(request)).toBe(true);
    });

    it('should return false when threadKey is missing', () => {
      const request = {
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
      };

      expect(isChatV2Request(request)).toBe(false);
    });

    it('should return false when threadKey.type is invalid', () => {
      const request = {
        threadKey: { type: 'invalid', projectId: 'proj-001' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
      };

      expect(isChatV2Request(request)).toBe(false);
    });

    it('should return false when personaId is missing', () => {
      const request = {
        threadKey: { type: 'hub', projectId: 'proj-001' },
        taskId: 'product-manager--define-product',
        message: 'Hello',
      };

      expect(isChatV2Request(request)).toBe(false);
    });

    it('should return false when taskId is missing', () => {
      const request = {
        threadKey: { type: 'hub', projectId: 'proj-001' },
        personaId: 'product-manager',
        message: 'Hello',
      };

      expect(isChatV2Request(request)).toBe(false);
    });

    it('should return false when message is missing', () => {
      const request = {
        threadKey: { type: 'hub', projectId: 'proj-001' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
      };

      expect(isChatV2Request(request)).toBe(false);
    });

    it('should return false for null input', () => {
      expect(isChatV2Request(null)).toBe(false);
    });

    it('should return false for non-object input', () => {
      expect(isChatV2Request('string')).toBe(false);
      expect(isChatV2Request(42)).toBe(false);
      expect(isChatV2Request(undefined)).toBe(false);
    });

    it('should return false when files array contains invalid entries', () => {
      const request = {
        threadKey: { type: 'hub', projectId: 'proj-001' },
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        message: 'Hello',
        files: [{ filename: 'test.txt' }], // missing mimeType and base64
      };

      expect(isChatV2Request(request)).toBe(false);
    });
  });

  describe('isChatV2Response() type guard', () => {
    it('should return true for a valid response with all required fields', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        assistant: { message: 'Let me help you define your product.' },
        structuredResponse: { phase: 'questions', questions: ['What is your product?'], summary: 'Starting discovery.' },
      };

      expect(isChatV2Response(response)).toBe(true);
    });

    it('should return true for a valid response with null structuredResponse', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'assistant',
        taskId: 'assistant--freeform',
        assistant: { message: 'Here is my response.' },
        structuredResponse: null,
      };

      expect(isChatV2Response(response)).toBe(true);
    });

    it('should return true for a valid response with error field', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        assistant: { message: 'Raw fallback message.' },
        structuredResponse: null,
        error: 'Missing required field: phase',
      };

      expect(isChatV2Response(response)).toBe(true);
    });

    it('should return false when threadKey is not a string', () => {
      const response = {
        threadKey: { type: 'hub', projectId: 'proj-001' }, // should be string, not object
        personaId: 'product-manager',
        taskId: 'test',
        assistant: { message: 'Hello' },
        structuredResponse: null,
      };

      expect(isChatV2Response(response)).toBe(false);
    });

    it('should return false when assistant is missing', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'product-manager',
        taskId: 'test',
        structuredResponse: null,
      };

      expect(isChatV2Response(response)).toBe(false);
    });

    it('should return false when assistant.message is not a string', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'product-manager',
        taskId: 'test',
        assistant: { message: 123 }, // should be string
        structuredResponse: null,
      };

      expect(isChatV2Response(response)).toBe(false);
    });

    it('should return false when personaId is missing', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        taskId: 'test',
        assistant: { message: 'Hello' },
        structuredResponse: null,
      };

      expect(isChatV2Response(response)).toBe(false);
    });

    it('should return false for null input', () => {
      expect(isChatV2Response(null)).toBe(false);
    });

    it('should return false when error is not a string', () => {
      const response = {
        threadKey: 'project:proj-001:hub',
        personaId: 'product-manager',
        taskId: 'test',
        assistant: { message: 'Hello' },
        structuredResponse: null,
        error: 42, // should be string
      };

      expect(isChatV2Response(response)).toBe(false);
    });
  });

  // ========================================================================
  // Additional structural validation for supporting types
  // ========================================================================
  describe('ThreadMessage interface', () => {
    it('should accept all required fields for an assistant message', () => {
      const message: ThreadMessage = {
        id: 'msg-001',
        role: 'assistant',
        personaId: 'product-manager',
        taskId: 'product-manager--define-product',
        content: 'Here is my analysis.',
        structuredResponse: { phase: 'questions', questions: ['What is your product?'], summary: 'Summary text.' },
        timestamp: '2026-02-28T12:00:00.000Z',
      };

      expect(message.role).toBe('assistant');
      expect(message.personaId).toBe('product-manager');
      expect(message.structuredResponse).not.toBeNull();
    });

    it('should accept null personaId and taskId for user messages', () => {
      const message: ThreadMessage = {
        id: 'msg-002',
        role: 'user',
        personaId: null,
        taskId: null,
        content: 'I want to build a task management app.',
        structuredResponse: null,
        timestamp: '2026-02-28T12:01:00.000Z',
      };

      expect(message.role).toBe('user');
      expect(message.personaId).toBeNull();
      expect(message.taskId).toBeNull();
      expect(message.structuredResponse).toBeNull();
    });
  });

  describe('Thread interface', () => {
    it('should accept all required fields', () => {
      const thread: Thread = {
        threadKey: 'project:proj-001:hub',
        projectId: 'proj-001',
        messages: [],
        activePersonaId: null,
        activeTaskId: null,
        summary: null,
        summarisedUpToIndex: 0,
        createdAt: '2026-02-28T12:00:00.000Z',
        updatedAt: '2026-02-28T12:00:00.000Z',
      };

      expect(thread.threadKey).toBe('project:proj-001:hub');
      expect(thread.messages).toHaveLength(0);
      expect(thread.activePersonaId).toBeNull();
    });
  });

  describe('PersonaDefinition interface', () => {
    it('should accept all required fields', () => {
      const persona: PersonaDefinition = {
        id: 'product-manager',
        displayName: 'Product Manager',
        color: '#3B82F6',
        identityPromptRef: 'prompts/product-manager.identity.md',
        tasks: ['product-manager--define-product', 'product-manager--roadmap'],
        menuLabel: 'Product Manager',
      };

      expect(persona.id).toBe('product-manager');
      expect(persona.tasks).toHaveLength(2);
    });
  });

  describe('TaskDefinition interface', () => {
    it('should accept all required fields for a discovery-mode task', () => {
      const task: TaskDefinition = {
        id: 'product-manager--define-product',
        personaId: 'product-manager',
        menuLabel: 'Define Product',
        description: 'Conduct structured product discovery.',
        mode: 'discovery',
        taskPromptRef: 'prompts/product-manager.define-product.task.md',
        responseFormat: { type: 'object', properties: { phase: { type: 'string' } } },
        contextNeeds: [],
        persistence: 'hub',
        artifacts: [],
        phases: null,
        availableFrom: ['hub'],
      };

      expect(task.mode).toBe('discovery');
      expect(task.phases).toBeNull();
      expect(task.responseFormat).not.toBeNull();
    });

    it('should accept a workflow-mode task with phases', () => {
      const task: TaskDefinition = {
        id: 'product-manager--implement-support',
        personaId: 'product-manager',
        menuLabel: 'Implement Support',
        description: 'Support implementation workflow.',
        mode: 'workflow',
        taskPromptRef: 'prompts/product-manager.implement-support.task.md',
        responseFormat: null,
        contextNeeds: ['meta-model-summary', 'product-summary'],
        persistence: 'feature',
        artifacts: [],
        phases: [
          { id: 'bootstrap', label: 'Bootstrap', phasePromptRef: 'prompts/implement-support.bootstrap.md', responseFormat: null },
          { id: 'refine', label: 'Refine', phasePromptRef: 'prompts/implement-support.refine.md', responseFormat: { type: 'object' } },
        ],
        availableFrom: ['embedded'],
      };

      expect(task.mode).toBe('workflow');
      expect(task.phases).toHaveLength(2);
      expect(task.phases![0].id).toBe('bootstrap');
    });
  });

  describe('ContextResolverConfig interface', () => {
    it('should accept key and resolverType fields', () => {
      const config: ContextResolverConfig = {
        key: 'mission',
        resolverType: 'file-reader',
      };

      expect(config.key).toBe('mission');
      expect(config.resolverType).toBe('file-reader');
    });
  });
});
