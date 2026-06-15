/**
 * Tests for Chat Panel Layout CSS Properties
 *
 * These tests verify that the CSS classes have the correct flex properties
 * to ensure proper layout behavior:
 * - Full height stretching from TopBar to bottom of viewport
 * - Pinned input area at bottom (no jerking when messages are added)
 * - Only the message list scrolls when content exceeds available height
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read CSS file content
function readCssFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Helper to check if CSS content contains a property with specific value
function cssContains(css: string, selector: string, property: string, value: string): boolean {
  // Simple regex to find the selector block and check for the property
  const selectorRegex = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 's');
  const match = css.match(selectorRegex);
  if (!match) return false;

  const block = match[1];
  const propRegex = new RegExp(`${property}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return propRegex.test(block);
}

describe('Chat Panel Layout CSS', () => {
  describe('MetaModelView.module.css', () => {
    it('container class has min-height: 0 for proper nested flex scrolling', () => {
      const css = readCssFile('components/MetaModelView/MetaModelView.module.css');

      // The container class should have min-height: 0 to allow nested flex children to shrink
      expect(cssContains(css, 'container', 'min-height', '0')).toBe(true);
    });
  });

  describe('ChatPanel.module.css', () => {
    it('panel class has min-height: 0 and align-self: stretch for full height', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // Panel needs min-height: 0 for nested scroll behavior
      expect(cssContains(css, 'panel', 'min-height', '0')).toBe(true);
      // Panel needs align-self: stretch to fill parent height
      expect(cssContains(css, 'panel', 'align-self', 'stretch')).toBe(true);
    });

    it('collapsedTab class has min-height: 0 and align-self: stretch for full height', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');

      // Collapsed tab also needs these properties to span full height
      expect(cssContains(css, 'collapsedTab', 'min-height', '0')).toBe(true);
      expect(cssContains(css, 'collapsedTab', 'align-self', 'stretch')).toBe(true);
    });
  });

  describe('ChatMessageList.module.css', () => {
    it('container class has flex: 1 1 0 and min-height: 0 for scrollable behavior', () => {
      const css = readCssFile('components/chat/ChatMessageList.module.css');

      // The flex shorthand 1 1 0 ensures:
      // - flex-grow: 1 (take available space)
      // - flex-shrink: 1 (can shrink)
      // - flex-basis: 0 (start from zero, prevents content from expanding parent)
      expect(cssContains(css, 'container', 'flex', '1 1 0')).toBe(true);

      // min-height: 0 allows container to shrink below content height
      expect(cssContains(css, 'container', 'min-height', '0')).toBe(true);
    });
  });

  describe('ChatInput.module.css', () => {
    it('container class has flex: 0 0 auto to prevent grow/shrink (pinned at bottom)', () => {
      const css = readCssFile('components/chat/ChatInput.module.css');

      // The flex shorthand 0 0 auto ensures:
      // - flex-grow: 0 (don't grow)
      // - flex-shrink: 0 (don't shrink)
      // - flex-basis: auto (use natural size)
      // This keeps input pinned at its natural size at the bottom
      expect(cssContains(css, 'container', 'flex', '0 0 auto')).toBe(true);
    });
  });
});
