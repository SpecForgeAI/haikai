/**
 * Diagram Type Normalization Tests
 *
 * Task Group 1: Tests for normalizeDiagramType function and getDiagramType integration.
 * These tests verify that diagram_type handling is case-insensitive and correctly
 * normalizes values to canonical DiagramType strings.
 *
 * Spec: Fix Diagram Type Normalization (2025-12-30)
 *
 * Critical test cases:
 * - normalizeDiagramType correctly handles uppercase input
 * - normalizeDiagramType correctly trims whitespace and handles lowercase
 * - normalizeDiagramType returns null for unknown values
 * - normalizeDiagramType returns null for null/undefined input
 * - getDiagramType correctly normalizes diagram_type from Diagram object
 * - getDiagramType returns default 'General' for null/undefined diagram
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDiagramType,
  getDiagramType,
  DEFAULT_DIAGRAM_TYPE,
  DiagramType,
} from '../types/diagramType';
import { Diagram } from '../types/model';

describe('normalizeDiagramType function', () => {
  /**
   * Task 1.1 - Test 1: normalizeDiagramType('SEQUENCE') returns 'Sequence'
   * Verifies uppercase input is normalized to canonical form
   */
  it('should normalize uppercase SEQUENCE to Sequence', () => {
    const result = normalizeDiagramType('SEQUENCE');
    expect(result).toBe('Sequence');
  });

  /**
   * Task 1.1 - Test 2: normalizeDiagramType(' sequence ') returns 'Sequence'
   * Verifies trimming and case-insensitive handling
   */
  it('should normalize lowercase with whitespace to Sequence', () => {
    const result = normalizeDiagramType(' sequence ');
    expect(result).toBe('Sequence');
  });

  /**
   * Task 1.1 - Test 3: normalizeDiagramType('unknown') returns null
   * Verifies unknown values return null
   */
  it('should return null for unknown diagram type', () => {
    const result = normalizeDiagramType('unknown');
    expect(result).toBeNull();
  });

  /**
   * Task 1.1 - Test 4: normalizeDiagramType(null) and normalizeDiagramType(undefined) return null
   * Verifies null/undefined handling
   */
  it('should return null for null and undefined input', () => {
    expect(normalizeDiagramType(null)).toBeNull();
    expect(normalizeDiagramType(undefined)).toBeNull();
  });

  /**
   * Additional coverage: Test all valid diagram types
   */
  it('should normalize all valid diagram types correctly', () => {
    // Test all canonical types are preserved
    expect(normalizeDiagramType('General')).toBe('General');
    expect(normalizeDiagramType('ER')).toBe('ER');
    expect(normalizeDiagramType('Sequence')).toBe('Sequence');
    expect(normalizeDiagramType('Activity')).toBe('Activity');
    expect(normalizeDiagramType('State')).toBe('State');

    // Test uppercase variations
    expect(normalizeDiagramType('GENERAL')).toBe('General');
    expect(normalizeDiagramType('ER')).toBe('ER');
    expect(normalizeDiagramType('ACTIVITY')).toBe('Activity');
    expect(normalizeDiagramType('STATE')).toBe('State');

    // Test lowercase variations
    expect(normalizeDiagramType('general')).toBe('General');
    expect(normalizeDiagramType('er')).toBe('ER');
    expect(normalizeDiagramType('activity')).toBe('Activity');
    expect(normalizeDiagramType('state')).toBe('State');
  });
});

describe('getDiagramType integration', () => {
  /**
   * Task 1.5 - Test 1: getDiagramType({diagram_type:'SEQUENCE', ...}) returns 'Sequence'
   * Verifies getDiagramType uses normalization for Diagram objects
   */
  it('should return normalized Sequence for diagram with uppercase SEQUENCE', () => {
    const diagram: Diagram = {
      id: 'test-diagram-1',
      name: 'Test Sequence Diagram',
      description: 'A test diagram',
      diagram_type: 'SEQUENCE',
      diagram_nodes: [],
      diagram_edges: [],
    };

    const result = getDiagramType(diagram);
    expect(result).toBe('Sequence');
  });

  /**
   * Task 1.5 - Test 2: getDiagramType(null) returns 'General' (default)
   * Verifies null handling returns default diagram type
   */
  it('should return General (default) for null diagram', () => {
    const result = getDiagramType(null);
    expect(result).toBe('General');
    expect(result).toBe(DEFAULT_DIAGRAM_TYPE);
  });

  /**
   * Additional coverage: undefined diagram and missing diagram_type
   */
  it('should return General (default) for undefined diagram', () => {
    const result = getDiagramType(undefined);
    expect(result).toBe('General');
  });

  it('should return General (default) for diagram with missing diagram_type', () => {
    const diagram: Diagram = {
      id: 'test-diagram-2',
      name: 'Test Diagram',
      description: 'A test diagram without type',
      diagram_nodes: [],
      diagram_edges: [],
    };

    const result = getDiagramType(diagram);
    expect(result).toBe('General');
  });

  it('should return General (default) for diagram with invalid diagram_type', () => {
    const diagram: Diagram = {
      id: 'test-diagram-3',
      name: 'Test Diagram',
      description: 'A test diagram with invalid type',
      diagram_type: 'InvalidType',
      diagram_nodes: [],
      diagram_edges: [],
    };

    const result = getDiagramType(diagram);
    expect(result).toBe('General');
  });

  /**
   * Additional coverage: Test whitespace handling in getDiagramType
   */
  it('should normalize diagram_type with whitespace', () => {
    const diagram: Diagram = {
      id: 'test-diagram-4',
      name: 'Test Diagram',
      description: 'A test diagram with whitespace type',
      diagram_type: '  Activity  ',
      diagram_nodes: [],
      diagram_edges: [],
    };

    const result = getDiagramType(diagram);
    expect(result).toBe('Activity');
  });
});
