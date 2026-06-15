/**
 * Foundation Layer Tests for Chat V2 Types and Persona Config
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 1, Task 1.1: Write 4 focused tests for foundation layer
 *
 * Tests verify:
 * - threadKeyToString produces correct serialized strings for hub, feature, and panel keys
 * - getPersonaConfig returns correct config for a known persona ID
 * - getPersonaConfig returns grey fallback for an unknown persona ID
 * - All 6 persona IDs in PERSONA_CONFIGS have unique id, color, and initials values
 */

import { describe, it, expect } from 'vitest';
import { threadKeyToString } from '../api/chatV2Api';
import type { HubThreadKey, FeatureThreadKey, PanelThreadKey } from '../api/chatV2Api';
import { getPersonaConfig, PERSONA_CONFIGS } from '../config/personaConfig';

// ============================================================================
// threadKeyToString Tests
// ============================================================================

describe('threadKeyToString', () => {
  it('produces correct serialized strings for hub, feature, and panel keys', () => {
    // Hub key
    const hubKey: HubThreadKey = { type: 'hub', projectId: 'proj-123' };
    expect(threadKeyToString(hubKey)).toBe('project:proj-123:hub');

    // Feature key
    const featureKey: FeatureThreadKey = {
      type: 'feature',
      projectId: 'proj-456',
      featureId: 'feat-abc',
    };
    expect(threadKeyToString(featureKey)).toBe('project:proj-456:feature:feat-abc');

    // Panel key without entityId
    const panelKey: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-789',
      screen: 'architecture',
    };
    expect(threadKeyToString(panelKey)).toBe('project:proj-789:panel:architecture');

    // Panel key with entityId
    const panelKeyWithEntity: PanelThreadKey = {
      type: 'panel',
      projectId: 'proj-789',
      screen: 'architecture',
      entityId: 'entity-001',
    };
    expect(threadKeyToString(panelKeyWithEntity)).toBe(
      'project:proj-789:panel:architecture:entity-001'
    );
  });
});

// ============================================================================
// getPersonaConfig Tests
// ============================================================================

describe('getPersonaConfig', () => {
  it('returns correct config for a known persona ID', () => {
    const pmConfig = getPersonaConfig('product-manager');
    expect(pmConfig).toEqual({
      id: 'product-manager',
      displayName: 'Product Manager',
      // Palette refresh: PM moved from teal (#00897B) to red (#C62828).
      color: '#C62828',
      initials: 'PM',
    });

    const archConfig = getPersonaConfig('architect');
    expect(archConfig).toEqual({
      id: 'architect',
      displayName: 'Architect',
      color: '#7B1FA2',
      initials: 'AR',
    });

    const assistantConfig = getPersonaConfig('assistant');
    expect(assistantConfig).toEqual({
      id: 'assistant',
      displayName: 'Assistant',
      color: '#5C6BC0',
      initials: 'AS',
    });
  });

  it('returns grey fallback for an unknown persona ID', () => {
    const unknownConfig = getPersonaConfig('unknown-persona');
    expect(unknownConfig).toEqual({
      id: 'unknown-persona',
      displayName: 'unknown-persona',
      color: '#9E9E9E',
      initials: '??',
    });

    const anotherUnknown = getPersonaConfig('some-new-role');
    expect(anotherUnknown.color).toBe('#9E9E9E');
    expect(anotherUnknown.initials).toBe('??');
    expect(anotherUnknown.id).toBe('some-new-role');
    expect(anotherUnknown.displayName).toBe('some-new-role');
  });
});

// ============================================================================
// PERSONA_CONFIGS Uniqueness Test
// ============================================================================

describe('PERSONA_CONFIGS', () => {
  it('has 6 entries with unique id, color, and initials values', () => {
    // Verify exactly 6 entries
    expect(PERSONA_CONFIGS).toHaveLength(6);

    // Verify unique IDs
    const ids = PERSONA_CONFIGS.map((p) => p.id);
    expect(new Set(ids).size).toBe(6);

    // Verify unique colors
    const colors = PERSONA_CONFIGS.map((p) => p.color);
    expect(new Set(colors).size).toBe(6);

    // Verify unique initials
    const initials = PERSONA_CONFIGS.map((p) => p.initials);
    expect(new Set(initials).size).toBe(6);
  });
});
