/**
 * Tests for Workspace Schema Version and Migration
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 8: Schema Versioning and Migration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  validateAndMigrateWorkspace,
  createEmptyWorkspaceState,
  applyDefaults,
} from './workspaceSchemaVersion';

describe('workspaceSchemaVersion', () => {
  beforeEach(() => {
    // Reset console.warn spy
    vi.restoreAllMocks();
  });

  /**
   * Test 1: Current schema (v1) round-trips correctly.
   */
  describe('current schema (v1)', () => {
    it('round-trips correctly', () => {
      // Given
      const v1State = {
        schemaVersion: 1,
        implementationMode: true,
        plannerPayload: { featureUnderstanding: 'Test' },
        activeIncrementId: 'INC-1',
        questions: [{ id: 'q1', question: 'Q?', status: 'Open', answer: '', source: 'Product Manager' }],
        executionArtifactsByIncrement: { 'INC-1': { shapeSpecArtifact: 'spec' } },
        teamChatTranscript: [{ id: 'm1', role: 'assistant', message: 'Hi', createdAt: '2026-01-23T10:00:00Z' }],
      };

      // When
      const result = validateAndMigrateWorkspace(v1State);

      // Then
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.migrated.implementationMode).toBe(true);
      expect(result.migrated.activeIncrementId).toBe('INC-1');
      expect(result.migrated.questions).toHaveLength(1);
      expect(result.migrated.teamChatTranscript).toHaveLength(1);
    });
  });

  /**
   * Test 2: Missing schemaVersion defaults to 1.
   */
  describe('missing schemaVersion', () => {
    it('defaults to 1', () => {
      // Given - state without schemaVersion
      const stateWithoutVersion = {
        implementationMode: false,
        plannerPayload: null,
        activeIncrementId: null,
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When
      const result = validateAndMigrateWorkspace(stateWithoutVersion);

      // Then
      expect(result.valid).toBe(true);
      expect(result.migrated.schemaVersion).toBe(1);
    });
  });

  /**
   * Test 3: Future version handling logs warning and attempts load.
   */
  describe('future version handling', () => {
    it('logs warning and attempts load with defaults', () => {
      // Given
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const futureState = {
        schemaVersion: 999,
        implementationMode: true,
        unknownField: 'should be ignored',
        plannerPayload: null,
        activeIncrementId: 'INC-X',
        questions: [],
        executionArtifactsByIncrement: {},
        teamChatTranscript: [],
      };

      // When
      const result = validateAndMigrateWorkspace(futureState);

      // Then
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('future schema version 999')
      );
      expect(result.errors).toContain('Future schema version 999 detected, applying defaults');
      // Should still load what it can
      expect(result.migrated.implementationMode).toBe(true);
      expect(result.migrated.activeIncrementId).toBe('INC-X');
      // Schema version should be set to current
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

      consoleSpy.mockRestore();
    });
  });

  describe('createEmptyWorkspaceState', () => {
    it('creates state with all default values', () => {
      // When
      const result = createEmptyWorkspaceState();

      // Then
      expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.implementationMode).toBe(false);
      expect(result.plannerPayload).toBeNull();
      expect(result.activeIncrementId).toBeNull();
      expect(result.questions).toEqual([]);
      expect(result.executionArtifactsByIncrement).toEqual({});
      expect(result.teamChatTranscript).toEqual([]);
    });
  });

  describe('applyDefaults', () => {
    it('logs warnings for unknown fields but continues', () => {
      // Given
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const stateWithUnknownFields = {
        schemaVersion: 1,
        implementationMode: true,
        unknownField1: 'value1',
        anotherUnknown: 42,
      };

      // When
      const result = applyDefaults(stateWithUnknownFields);

      // Then
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown field "unknownField1"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown field "anotherUnknown"')
      );
      // Should still return valid state
      expect(result.implementationMode).toBe(true);
      expect(result.schemaVersion).toBe(1);

      consoleSpy.mockRestore();
    });

    it('handles null/undefined input with defaults', () => {
      // When
      const result = validateAndMigrateWorkspace(null);

      // Then
      expect(result.valid).toBe(true);
      expect(result.migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.migrated.implementationMode).toBe(false);
    });
  });
});
