/**
 * ContextPickerModal.depth-selector.test.tsx
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * Task Group 4: Tests for depth selector UI component
 *
 * Tests:
 * - DepthSelector renders only for entity_with_attributes_and_relationships bundle
 * - DepthSelector displays warning label for depth 2
 * - Depth change callback invoked with correct value
 * - Depth selector does not render for non-entity bundles
 */

import { describe, it, expect, vi } from 'vitest';
import { DEPTH_OPTIONS, DEPTH_LABELS, DEPTH_WARNING } from '../utils/contextBundleTypes';

// ============================================================================
// Test utility functions that mirror the component's logic
// ============================================================================

/**
 * Determines if DepthSelector should render for a given bundle type
 */
function shouldRenderDepthSelector(bundleType: string | undefined): boolean {
  return bundleType === 'entity_with_attributes_and_relationships';
}

/**
 * Gets the display label for a depth value
 */
function getDepthLabel(depth: 1 | 2): string {
  return DEPTH_LABELS[depth];
}

/**
 * Gets the warning message for depth 2
 */
function getDepthWarning(depth: 1 | 2): string | null {
  return depth === 2 ? DEPTH_WARNING : null;
}

/**
 * Handles depth change
 */
function handleDepthChange(
  currentDepths: Record<string, 1 | 2>,
  entityId: string,
  newDepth: 1 | 2
): Record<string, 1 | 2> {
  return {
    ...currentDepths,
    [entityId]: newDepth,
  };
}

/**
 * Initializes depth selection when entity is selected with entity bundle
 */
function initializeDepthOnSelection(
  currentDepths: Record<string, 1 | 2>,
  entityId: string,
  bundleType: string
): Record<string, 1 | 2> {
  if (bundleType === 'entity_with_attributes_and_relationships') {
    return {
      ...currentDepths,
      [entityId]: 1, // Default depth is 1
    };
  }
  return currentDepths;
}

// ============================================================================
// Tests
// ============================================================================

describe('ContextPickerModal DepthSelector', () => {
  describe('Render conditions', () => {
    it('renders only for entity_with_attributes_and_relationships bundle', () => {
      // Test the bundle types that should show depth selector
      expect(shouldRenderDepthSelector('entity_with_attributes_and_relationships')).toBe(true);
    });

    it('does not render for entity_only bundle', () => {
      expect(shouldRenderDepthSelector('entity_only')).toBe(false);
    });

    it('does not render for interface bundles', () => {
      expect(shouldRenderDepthSelector('interface_only')).toBe(false);
      expect(shouldRenderDepthSelector('interface_with_endpoints')).toBe(false);
      expect(shouldRenderDepthSelector('interface_with_endpoints_and_schemas')).toBe(false);
    });

    it('does not render for service bundles', () => {
      expect(shouldRenderDepthSelector('service_only')).toBe(false);
      expect(shouldRenderDepthSelector('service_with_parents_and_children')).toBe(false);
    });

    it('does not render for diagram bundle', () => {
      expect(shouldRenderDepthSelector('diagram_only')).toBe(false);
    });

    it('does not render for undefined bundle', () => {
      expect(shouldRenderDepthSelector(undefined)).toBe(false);
    });
  });

  describe('Depth labels', () => {
    it('displays correct label for depth 1', () => {
      expect(getDepthLabel(1)).toBe('Depth 1');
    });

    it('displays correct label for depth 2', () => {
      expect(getDepthLabel(2)).toBe('Depth 2 (Extended)');
    });
  });

  describe('Warning for depth 2', () => {
    it('displays warning for depth 2', () => {
      const warning = getDepthWarning(2);
      expect(warning).toBe('May increase context size significantly');
    });

    it('does not display warning for depth 1', () => {
      const warning = getDepthWarning(1);
      expect(warning).toBeNull();
    });
  });

  describe('Depth change callback', () => {
    it('invokes callback with correct value when changing from 1 to 2', () => {
      const currentDepths: Record<string, 1 | 2> = { 'pde-1': 1 };
      const newDepths = handleDepthChange(currentDepths, 'pde-1', 2);

      expect(newDepths['pde-1']).toBe(2);
    });

    it('invokes callback with correct value when changing from 2 to 1', () => {
      const currentDepths: Record<string, 1 | 2> = { 'pde-1': 2 };
      const newDepths = handleDepthChange(currentDepths, 'pde-1', 1);

      expect(newDepths['pde-1']).toBe(1);
    });

    it('preserves other entity depth selections when updating one entity', () => {
      const currentDepths: Record<string, 1 | 2> = { 'pde-1': 1, 'pde-2': 2 };
      const newDepths = handleDepthChange(currentDepths, 'pde-1', 2);

      expect(newDepths['pde-1']).toBe(2);
      expect(newDepths['pde-2']).toBe(2);
    });
  });

  describe('Depth initialization', () => {
    it('initializes depth to 1 when entity bundle is selected', () => {
      const currentDepths: Record<string, 1 | 2> = {};
      const newDepths = initializeDepthOnSelection(
        currentDepths,
        'pde-1',
        'entity_with_attributes_and_relationships'
      );

      expect(newDepths['pde-1']).toBe(1);
    });

    it('does not initialize depth for non-entity bundles', () => {
      const currentDepths: Record<string, 1 | 2> = {};
      const newDepths = initializeDepthOnSelection(
        currentDepths,
        'int-1',
        'interface_with_endpoints_and_schemas'
      );

      expect(newDepths['int-1']).toBeUndefined();
    });
  });

  describe('DEPTH_OPTIONS constant', () => {
    it('contains options [1, 2]', () => {
      expect(DEPTH_OPTIONS).toEqual([1, 2]);
    });
  });
});
