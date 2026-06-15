/**
 * contextPickerModalCss.test.ts
 *
 * Spec 2026-01-17: Context Picker UX - Relationship Labels and Stable Chips
 * Task Group 1: Tests for CSS and styling requirements
 *
 * Tests:
 * - Modal max-height is 90vh
 * - .relationshipChip class exists with green styling
 * - CSS structure matches existing chip patterns
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read CSS file content (follows chat-panel-layout.test.ts pattern)
function readCssFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

describe('ContextPickerModal CSS - Task Group 1', () => {
  describe('Modal Height', () => {
    it('should have max-height of 90vh in modal CSS', () => {
      const cssContent = readCssFile('components/ProductView/ContextPickerModal.module.css');

      // Check that .modal selector contains max-height: 90vh
      expect(cssContent).toContain('max-height: 90vh');
    });
  });
});

describe('FeatureDefinitionPanel CSS - Task Group 1', () => {
  describe('.relationshipChip styling', () => {
    it('should have .relationshipChip class defined', () => {
      const cssContent = readCssFile('components/ProductView/FeatureDefinitionPanel.module.css');

      // Check that .relationshipChip selector exists
      expect(cssContent).toContain('.relationshipChip');
    });

    it('should have green background color (#e8f5e9) for relationshipChip', () => {
      const cssContent = readCssFile('components/ProductView/FeatureDefinitionPanel.module.css');

      // Check for green background color
      expect(cssContent).toContain('#e8f5e9');
    });

    it('should have green text color (#2e7d32) for relationshipChip', () => {
      const cssContent = readCssFile('components/ProductView/FeatureDefinitionPanel.module.css');

      // Check for green text color
      expect(cssContent).toContain('#2e7d32');
    });

    it('should have green border color (#c8e6c9) for relationshipChip', () => {
      const cssContent = readCssFile('components/ProductView/FeatureDefinitionPanel.module.css');

      // Check for green border color
      expect(cssContent).toContain('#c8e6c9');
    });
  });
});
