/**
 * Backward Compatibility Tests
 *
 * Tests that workspace state from older schema versions can be loaded
 * and migrated to the current version without data loss.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 12: Backward Compatibility Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  validateAndMigrateWorkspace,
  migrateWorkspace,
  createEmptyWorkspaceState,
} from '../utils/workspaceSchemaVersion';
import { mapPersistedToState } from '../utils/workspaceStateMapper';

// Mock validation for these tests
vi.mock('../utils/validateLLMPayload', () => ({
  validateLLMPayload: vi.fn(() => ({ valid: true, errors: [] })),
}));

describe('Backward Compatibility Tests', () => {
  describe('Schema Version 1 Loading', () => {
    /**
     * Test 1: V1 workspace loads successfully in current version.
     */
    it('v1 workspace loads successfully in current version', () => {
      // Given - A v1 workspace state (current version)
      const v1Workspace = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: {
          schemaVersion: '1.1',
          message: 'V1 message',
          featureUnderstanding: 'V1 feature',
          scope: { in: ['item1'], out: [] },
          assumptions: ['assumption1'],
          acceptanceCriteria: ['criteria1'],
          openQuestions: [{ id: 'q1', question: 'Q1?' }],
          plannerReadyForSpec: false,
          implementationPlan: null,
        },
        activeIncrementId: 'INC-1',
        questions: [
          { id: 'q1', question: 'Q1?', status: 'Answered', answer: 'A1', source: 'Product Owner' },
        ],
        executionArtifactsByIncrement: {
          'INC-1': { shapeSpecArtifact: 'v1 spec' },
        },
        teamChatTranscript: [
          { id: 'm1', role: 'assistant', message: 'Hello from v1', createdAt: '2026-01-23T10:00:00Z' },
        ],
      };

      // When
      const result = validateAndMigrateWorkspace(v1Workspace);
      const restored = mapPersistedToState(result.migrated);

      // Then
      expect(result.valid).toBe(true);
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(restored.implementationMode).toBe(true);
      expect(restored.activeIncrementId).toBe('INC-1');
      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0].content).toBe('Hello from v1');
    });
  });

  describe('Missing Schema Version Handling', () => {
    /**
     * Test 2: Workspace without schemaVersion defaults to v1.
     */
    it('workspace without schemaVersion defaults to v1 and migrates', () => {
      // Given - Workspace without schemaVersion (legacy data)
      const legacyWorkspace = {
        // No schemaVersion field
        implementationMode: false,
        plannerPayload: null,
        activeIncrementId: null,
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When
      const result = validateAndMigrateWorkspace(legacyWorkspace);

      // Then
      expect(result.valid).toBe(true);
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });
  });

  describe('Partial State Handling', () => {
    /**
     * Test 3: Workspace with missing optional fields loads with defaults.
     */
    it('workspace with missing optional fields loads with defaults', () => {
      // Given - Workspace with only some fields
      const partialWorkspace = {
        schemaVersion: 1,
        implementationMode: true,
        // Missing: plannerPayload, activeIncrementId, questions, etc.
      };

      // When
      const result = validateAndMigrateWorkspace(partialWorkspace);
      const restored = mapPersistedToState(result.migrated);

      // Then
      expect(result.valid).toBe(true);
      expect(restored.implementationMode).toBe(true);
      // latestPlannerResponse is derived from plannerPayload, which defaults to null
      // When plannerPayload is null, latestPlannerResponse should be null
      expect(restored.latestPlannerResponse).toBeNull();
      expect(restored.activeIncrementId).toBeNull();
      expect(restored.saQuestions).toEqual([]);
    });
  });

  describe('Future Version Handling', () => {
    /**
     * Test 4: Workspace with unknown future version is handled gracefully.
     */
    it('workspace with future version logs warning and loads known fields', () => {
      // Given
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const futureWorkspace = {
        schemaVersion: 999, // Future version
        implementationMode: true,
        plannerPayload: { futureField: 'future data' },
        activeIncrementId: 'FUTURE-INC',
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
        // Unknown future field
        futureFeature: { enabled: true },
      };

      // When
      const result = validateAndMigrateWorkspace(futureWorkspace);

      // Then
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('future schema version 999')
      );
      expect(result.errors).toContain('Future schema version 999 detected, applying defaults');
      // Should still load known fields
      expect(result.migrated.implementationMode).toBe(true);
      expect(result.migrated.activeIncrementId).toBe('FUTURE-INC');
      // Schema version should be set to current
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      consoleSpy.mockRestore();
    });
  });

  describe('Unknown Fields Handling', () => {
    /**
     * Test 5: Unknown fields are logged but don't cause failure.
     */
    it('unknown fields are logged and ignored', () => {
      // Given
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const workspaceWithExtras = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: null,
        activeIncrementId: null,
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
        // Extra unknown fields
        customExtension: { data: 'custom' },
        anotherUnknown: 'value',
      };

      // When
      const result = validateAndMigrateWorkspace(workspaceWithExtras);

      // Then
      expect(result.valid).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown field')
      );
      // Unknown fields should not be in the result
      expect(result.migrated).not.toHaveProperty('customExtension');
      expect(result.migrated).not.toHaveProperty('anotherUnknown');

      consoleSpy.mockRestore();
    });
  });

  describe('Type Coercion', () => {
    /**
     * Test 6: Wrong types are replaced with defaults.
     */
    it('wrong types are replaced with defaults', () => {
      // Given - Workspace with wrong types
      const wrongTypesWorkspace = {
        schemaVersion: '1', // string instead of number (but parseable)
        implementationMode: 'true', // string instead of boolean
        plannerPayload: 'not an object', // string instead of object
        activeIncrementId: 123, // number instead of string
        questions: 'not an array', // string instead of array
        executionArtifactsByIncrement: [], // array instead of object
        teamChatTranscript: {}, // object instead of array
      };

      // When
      const result = validateAndMigrateWorkspace(wrongTypesWorkspace);

      // Then - Should apply defaults for wrong types
      expect(result.migrated.implementationMode).toBe(false); // default
      expect(result.migrated.plannerPayload).toBeNull(); // default
      expect(result.migrated.questions).toEqual([]); // default
      expect(result.migrated.teamChatTranscript).toEqual([]); // default
    });
  });

  describe('Null/Undefined Handling', () => {
    /**
     * Test 7: Null input returns empty workspace.
     */
    it('null input returns empty workspace', () => {
      // When
      const result = validateAndMigrateWorkspace(null);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.migrated).toEqual(createEmptyWorkspaceState());
    });

    /**
     * Test 8: Undefined input returns empty workspace.
     */
    it('undefined input returns empty workspace', () => {
      // When
      const result = validateAndMigrateWorkspace(undefined);

      // Then
      expect(result.valid).toBe(true);
      expect(result.migrated).toEqual(createEmptyWorkspaceState());
    });
  });

  describe('Migration Chain Integrity', () => {
    /**
     * Test 9: Sequential migrations are applied correctly.
     * Note: This test is a placeholder for when we have actual migrations.
     */
    it('migrateWorkspace applies defaults when no migrations defined', () => {
      // Given - A v1 state (no migrations needed currently)
      const v1State = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: { test: 'data' },
        activeIncrementId: 'INC-1',
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When
      const migrated = migrateWorkspace(v1State, 1);

      // Then - Should have current schema version
      expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      // Original data should be preserved
      expect(migrated.implementationMode).toBe(true);
      expect(migrated.activeIncrementId).toBe('INC-1');
    });
  });
});
