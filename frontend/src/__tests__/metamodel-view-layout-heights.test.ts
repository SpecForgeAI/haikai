/**
 * Tests for Meta-Model View Layout Height CSS Properties
 *
 * These tests verify that the CSS classes have the correct viewport-based heights
 * to ensure proper layout behavior:
 * - MetaModelView container fills space beneath TopBar (100vh - 60px)
 * - ChatPanel expanded state (.panel) has correct height (100vh - 75px)
 * - ChatPanel collapsed state (.collapsedTab) has correct height (100vh - 75px)
 * - Heights remain consistent when toggling between expanded/collapsed states
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read CSS file content
function readCssFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Helper to extract a CSS property value from a selector block
function getCssPropertyValue(css: string, selector: string, property: string): string | null {
  // Simple regex to find the selector block
  const selectorRegex = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 's');
  const match = css.match(selectorRegex);
  if (!match) return null;

  const block = match[1];
  // Find the property and extract its value
  const propRegex = new RegExp(`${property}\\s*:\\s*([^;]+)`, 'i');
  const propMatch = block.match(propRegex);
  if (!propMatch) return null;

  return propMatch[1].trim();
}

// Helper to check if CSS content contains a property with specific value
function cssContains(css: string, selector: string, property: string, value: string): boolean {
  const actualValue = getCssPropertyValue(css, selector, property);
  if (!actualValue) return false;

  // Normalize the value for comparison (remove extra spaces)
  const normalizedActual = actualValue.replace(/\s+/g, ' ').toLowerCase();
  const normalizedExpected = value.replace(/\s+/g, ' ').toLowerCase();

  return normalizedActual === normalizedExpected;
}

describe('Meta-Model View Layout Height CSS', () => {
  describe('Test 1: MetaModelView container renders with correct viewport-based height', () => {
    it('container class has height: calc(100vh - 60px) for TopBar offset', () => {
      const css = readCssFile('components/MetaModelView/MetaModelView.module.css');

      // The container should use viewport-based height with 60px offset for TopBar
      expect(cssContains(css, 'container', 'height', 'calc(100vh - 60px)')).toBe(true);
    });

    it('container class preserves all required flex properties', () => {
      const css = readCssFile('components/MetaModelView/MetaModelView.module.css');

      // Verify all other properties are preserved
      expect(cssContains(css, 'container', 'display', 'flex')).toBe(true);
      expect(cssContains(css, 'container', 'flex-direction', 'row')).toBe(true);
      expect(cssContains(css, 'container', 'overflow', 'hidden')).toBe(true);
      expect(cssContains(css, 'container', 'min-height', '0')).toBe(true);
    });
  });

  describe('Test 2: ChatPanel expanded state (.panel) renders with correct height', () => {
    it('panel class has height: calc(100vh - 75px) for TopBar + internal offset', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // The panel should use viewport-based height with 75px offset (60px TopBar + 15px internal)
      expect(cssContains(css, 'panel', 'height', 'calc(100vh - 75px)')).toBe(true);
    });

    it('panel class preserves all required layout properties', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // Verify all other properties are preserved
      expect(cssContains(css, 'panel', 'display', 'flex')).toBe(true);
      expect(cssContains(css, 'panel', 'flex-direction', 'column')).toBe(true);
      expect(cssContains(css, 'panel', 'min-height', '0')).toBe(true);
      expect(cssContains(css, 'panel', 'align-self', 'stretch')).toBe(true);
      expect(cssContains(css, 'panel', 'position', 'relative')).toBe(true);
      expect(cssContains(css, 'panel', 'flex-shrink', '0')).toBe(true);
    });
  });

  describe('Test 3: ChatPanel collapsed state (.collapsedTab) renders with correct height', () => {
    it('collapsedTab class has height: calc(100vh - 75px) for TopBar + internal offset', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // The collapsed tab should use same viewport-based height as panel
      expect(cssContains(css, 'collapsedTab', 'height', 'calc(100vh - 75px)')).toBe(true);
    });

    it('collapsedTab class preserves all required layout properties', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // Verify all other properties are preserved
      expect(cssContains(css, 'collapsedTab', 'width', '32px')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'min-height', '0')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'align-self', 'stretch')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'display', 'flex')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'flex-direction', 'column')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'flex-shrink', '0')).toBe(true);
    });
  });

  describe('Test 4: ChatPanel maintains consistent height when toggling between expanded/collapsed states', () => {
    it('panel and collapsedTab use identical height calculations', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // Get the height values for both states
      const panelHeight = getCssPropertyValue(css, 'panel', 'height');
      const collapsedTabHeight = getCssPropertyValue(css, 'collapsedTab', 'height');

      // Both should be defined
      expect(panelHeight).not.toBeNull();
      expect(collapsedTabHeight).not.toBeNull();

      // Both should use the same height calculation for visual consistency
      expect(panelHeight).toBe(collapsedTabHeight);
    });

    it('both states use viewport-based calc() for dynamic height', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      const panelHeight = getCssPropertyValue(css, 'panel', 'height');
      const collapsedTabHeight = getCssPropertyValue(css, 'collapsedTab', 'height');

      // Both should use calc() with viewport height
      expect(panelHeight).toMatch(/calc\s*\(\s*100vh/);
      expect(collapsedTabHeight).toMatch(/calc\s*\(\s*100vh/);
    });

    it('height offset accounts for TopBar (60px) plus internal spacing (15px)', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      const panelHeight = getCssPropertyValue(css, 'panel', 'height');
      const collapsedTabHeight = getCssPropertyValue(css, 'collapsedTab', 'height');

      // Both should subtract 75px (60px TopBar + 15px internal offset)
      expect(panelHeight).toMatch(/75px/);
      expect(collapsedTabHeight).toMatch(/75px/);
    });
  });

  describe('Resize handle CSS classes remain intact', () => {
    it('resizeHandle class exists for horizontal panel width resize', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // The resize handle should have cursor: col-resize for horizontal resize
      expect(cssContains(css, 'resizeHandle', 'cursor', 'col-resize')).toBe(true);
      expect(cssContains(css, 'resizeHandle', 'position', 'absolute')).toBe(true);
    });

    it('inputDragHandle class exists for vertical input height resize', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // The input drag handle should have cursor: ns-resize for vertical resize
      expect(cssContains(css, 'inputDragHandle', 'cursor', 'ns-resize')).toBe(true);
    });
  });
});
