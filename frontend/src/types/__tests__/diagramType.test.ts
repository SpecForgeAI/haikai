/**
 * DiagramType Registry Tests
 *
 * Spec 2026-04-03: User Journey Native Diagram Type and Renderer
 * Task Group 1, Task 1.1: Tests for USER_JOURNEY registration and CREATABLE_DIAGRAM_TYPES
 *
 * Test 1: USER_JOURNEY is present in ALL_DIAGRAM_TYPES array
 * Test 2: DIAGRAM_TYPE_LABELS maps USER_JOURNEY to 'User Journey'
 * Test 3: normalizeDiagramType('user_journey') and normalizeDiagramType('user journey') both return 'USER_JOURNEY'
 * Test 4: USER_JOURNEY is NOT present in CREATABLE_DIAGRAM_TYPES
 *
 * Task Group 4, Task 4.3: Gap-filling tests
 * Test 5: getDiagramType returns USER_JOURNEY for case-insensitive diagram_type
 * Test 6: CREATABLE_DIAGRAM_TYPES length equals ALL_DIAGRAM_TYPES length minus non-creatable count
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_DIAGRAM_TYPES,
  CREATABLE_DIAGRAM_TYPES,
  DIAGRAM_TYPE_LABELS,
  normalizeDiagramType,
  getDiagramType,
} from '../diagramType';
import type { Diagram } from '../model';

describe('DiagramType registry - USER_JOURNEY', () => {
  it('USER_JOURNEY is present in ALL_DIAGRAM_TYPES array', () => {
    expect(ALL_DIAGRAM_TYPES).toContain('USER_JOURNEY');
  });

  it('DIAGRAM_TYPE_LABELS maps USER_JOURNEY to "User Journey"', () => {
    expect(DIAGRAM_TYPE_LABELS['USER_JOURNEY']).toBe('User Journey');
  });

  it('normalizeDiagramType resolves "user_journey" and "user journey" to "USER_JOURNEY"', () => {
    expect(normalizeDiagramType('user_journey')).toBe('USER_JOURNEY');
    expect(normalizeDiagramType('user journey')).toBe('USER_JOURNEY');
    // Also verify case-insensitive behavior
    expect(normalizeDiagramType('USER_JOURNEY')).toBe('USER_JOURNEY');
    expect(normalizeDiagramType('User_Journey')).toBe('USER_JOURNEY');
  });

  it('USER_JOURNEY is NOT present in CREATABLE_DIAGRAM_TYPES', () => {
    expect(CREATABLE_DIAGRAM_TYPES).not.toContain('USER_JOURNEY');
  });

  // Task Group 4 gap-filling tests

  it('getDiagramType returns USER_JOURNEY for case-insensitive diagram_type on a Diagram object', () => {
    const diagram: Diagram = {
      id: 'test-1',
      name: 'Test',
      description: '',
      diagram_type: 'USER_JOURNEY',
      diagram_nodes: [],
      diagram_edges: [],
    };
    expect(getDiagramType(diagram)).toBe('USER_JOURNEY');

    // Also verify case-insensitive normalization via getDiagramType
    const diagramLower: Diagram = {
      id: 'test-2',
      name: 'Test',
      description: '',
      diagram_type: 'user_journey',
      diagram_nodes: [],
      diagram_edges: [],
    };
    expect(getDiagramType(diagramLower)).toBe('USER_JOURNEY');
  });

  it('CREATABLE_DIAGRAM_TYPES excludes all generated-only types (USER_JOURNEY, USER_JOURNEY_OVERVIEW)', () => {
    // USER_JOURNEY and USER_JOURNEY_OVERVIEW are generated-only (non-creatable) types
    const nonCreatableTypes = ALL_DIAGRAM_TYPES.filter(
      t => !CREATABLE_DIAGRAM_TYPES.includes(t)
    );
    expect(nonCreatableTypes).toContain('USER_JOURNEY');
    expect(nonCreatableTypes).toContain('USER_JOURNEY_OVERVIEW');
    expect(CREATABLE_DIAGRAM_TYPES.length).toBe(ALL_DIAGRAM_TYPES.length - nonCreatableTypes.length);
  });
});
