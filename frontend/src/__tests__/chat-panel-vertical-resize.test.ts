/**
 * Tests for Chat Panel Vertical Resize and Layout
 *
 * This file tests:
 * - ChatPanel flex layout structure
 * - Drag handle between message list and input area
 * - inputHeight state updates during vertical resize
 * - ChatInput receiving and applying height prop
 * - Textarea height: 100% and overflow: auto styling
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read file content
function readFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Helper to check if CSS content contains a property with specific value
function cssContains(css: string, selector: string, property: string, value: string): boolean {
  // Handle both simple and complex selectors
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectorRegex = new RegExp(`\\.${escapedSelector}\\s*\\{([^}]*)\\}`, 's');
  const match = css.match(selectorRegex);
  if (!match) return false;

  const block = match[1];
  const propRegex = new RegExp(`${property}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return propRegex.test(block);
}

// Helper to check if a file contains a string
function fileContains(content: string, searchString: string): boolean {
  return content.includes(searchString);
}

describe('Chat Panel Vertical Resize and Layout', () => {
  describe('ChatPanel.tsx flex layout structure', () => {
    it('ChatPanel renders with correct flex layout structure', () => {
      const tsx = readFile('components/chat/ChatPanel.tsx');

      // Panel should have flex column layout via styles.panel
      expect(fileContains(tsx, 'className={styles.panel}')).toBe(true);

      // Panel should contain ChatMessageList and ChatInput
      expect(fileContains(tsx, '<ChatMessageList')).toBe(true);
      expect(fileContains(tsx, '<ChatInput')).toBe(true);
    });

    it('drag handle appears between message list and input area', () => {
      const tsx = readFile('components/chat/ChatPanel.tsx');

      // There should be an inputDragHandle element
      expect(fileContains(tsx, 'inputDragHandle')).toBe(true);

      // Drag handle should have onMouseDown handler for resize
      expect(fileContains(tsx, 'handleInputResizeStart')).toBe(true);

      // Drag handle should have proper aria attributes
      expect(fileContains(tsx, 'role="separator"')).toBe(true);
      expect(fileContains(tsx, 'aria-orientation="horizontal"')).toBe(true);
    });
  });

  describe('ChatPanel inputHeight state management', () => {
    it('inputHeight state updates during vertical resize drag', () => {
      const tsx = readFile('components/chat/ChatPanel.tsx');

      // inputHeight state should be initialized with useState
      expect(fileContains(tsx, 'inputHeight')).toBe(true);
      expect(fileContains(tsx, 'setInputHeight')).toBe(true);
      expect(fileContains(tsx, 'useState(100)')).toBe(true);

      // isResizingInput ref should exist for resize tracking
      expect(fileContains(tsx, 'isResizingInput')).toBe(true);
    });
  });

  describe('ChatInput height prop', () => {
    it('ChatInput receives and applies height prop correctly', () => {
      const inputTsx = readFile('components/chat/ChatInput.tsx');
      const panelTsx = readFile('components/chat/ChatPanel.tsx');

      // ChatInput should accept height prop in interface
      expect(fileContains(inputTsx, 'height?: number')).toBe(true);

      // ChatInput container should apply height via inline style
      expect(fileContains(inputTsx, 'style=')).toBe(true);
      expect(fileContains(inputTsx, 'height')).toBe(true);

      // ChatPanel should pass inputHeight to ChatInput
      expect(fileContains(panelTsx, 'height={inputHeight}')).toBe(true);
    });
  });

  describe('ChatInput.module.css for controlled height', () => {
    it('textarea uses height: 100% and overflow: auto (no native resize)', () => {
      const css = readFile('components/chat/ChatInput.module.css');

      // Container should have box-sizing: border-box
      expect(cssContains(css, 'container', 'box-sizing', 'border-box')).toBe(true);

      // Textarea should have height: 100%
      expect(cssContains(css, 'textarea', 'height', '100%')).toBe(true);

      // Textarea should have overflow: auto
      expect(cssContains(css, 'textarea', 'overflow', 'auto')).toBe(true);

      // Textarea should NOT have resize: vertical (custom drag handle replaces it)
      expect(fileContains(css, 'resize: vertical')).toBe(false);
      expect(fileContains(css, 'resize:vertical')).toBe(false);

      // Textarea should NOT have min-height or max-height constraints
      expect(cssContains(css, 'textarea', 'min-height', '60px')).toBe(false);
      expect(cssContains(css, 'textarea', 'max-height', '150px')).toBe(false);
    });
  });

  describe('ChatPanel.module.css inputDragHandle', () => {
    it('inputDragHandle has correct styles for drag interaction', () => {
      const css = readFile('components/chat/ChatPanel.module.css');

      // inputDragHandle should exist with specific properties
      expect(cssContains(css, 'inputDragHandle', 'height', '8px')).toBe(true);
      expect(cssContains(css, 'inputDragHandle', 'cursor', 'ns-resize')).toBe(true);
      expect(cssContains(css, 'inputDragHandle', 'flex', '0 0 auto')).toBe(true);
    });
  });

  describe('Flex hierarchy min-height verification', () => {
    it('panel has min-height: 0 for proper nested flex scrolling', () => {
      const css = readFile('components/chat/ChatPanel.module.css');
      expect(cssContains(css, 'panel', 'min-height', '0')).toBe(true);
    });

    it('ChatMessageList container has min-height: 0', () => {
      const css = readFile('components/chat/ChatMessageList.module.css');
      expect(cssContains(css, 'container', 'min-height', '0')).toBe(true);
    });
  });
});
