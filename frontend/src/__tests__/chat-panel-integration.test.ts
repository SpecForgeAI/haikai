/**
 * Task Group 3 Tests: Chat Panel Integration
 *
 * These tests verify the end-to-end integration of chat panel layout
 * within the MetaModelView context. They ensure:
 * - Chat panel renders at full height
 * - CSS flex hierarchy is properly configured
 * - No layout shift occurs when messages are added
 *
 * Created as part of spec: 2025-12-16-chat-panel-layout-fix
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read CSS file content
function readCssFile(relativePath: string): string {
  const fullPath = path.resolve(__dirname, '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

// Helper to extract a CSS selector block
function extractSelectorBlock(css: string, selector: string): string | null {
  const selectorRegex = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 's');
  const match = css.match(selectorRegex);
  return match ? match[1] : null;
}

describe('Chat Panel Integration - Full Height in MetaModelView Context', () => {
  describe('CSS flex hierarchy ensures full height propagation', () => {
    it('MetaModelView container is a flex row with viewport-based height', () => {
      const css = readCssFile('components/MetaModelView/MetaModelView.module.css');
      const block = extractSelectorBlock(css, 'container');

      expect(block).not.toBeNull();
      expect(block).toMatch(/display:\s*flex/i);
      expect(block).toMatch(/flex-direction:\s*row/i);
      // Height uses calc(100vh - offset) for viewport-based full height
      expect(block).toMatch(/height:\s*calc\(100vh/i);
      // Critical for nested flex scrolling
      expect(block).toMatch(/min-height:\s*0/i);
    });

    it('ChatPanel panel stretches to fill parent height', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');
      const block = extractSelectorBlock(css, 'panel');

      expect(block).not.toBeNull();
      // Panel should stretch to fill flex row parent
      expect(block).toMatch(/align-self:\s*stretch/i);
      // Height uses calc(100vh - 75px) for viewport-based full height
      expect(block).toMatch(/height:\s*calc\(100vh/i);
      // Should also be a flex column for internal layout
      expect(block).toMatch(/display:\s*flex/i);
      expect(block).toMatch(/flex-direction:\s*column/i);
    });

    it('ChatPanel collapsedTab also stretches to fill parent height', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');
      const block = extractSelectorBlock(css, 'collapsedTab');

      expect(block).not.toBeNull();
      // Collapsed tab should also stretch
      expect(block).toMatch(/align-self:\s*stretch/i);
      // Height uses calc(100vh - 75px) for viewport-based full height
      expect(block).toMatch(/height:\s*calc\(100vh/i);
    });
  });

  describe('Message list and input area prevent layout shift (no jerking)', () => {
    it('ChatMessageList container uses flex: 1 1 0 to prevent content expansion', () => {
      const css = readCssFile('components/chat/ChatMessageList.module.css');
      const block = extractSelectorBlock(css, 'container');

      expect(block).not.toBeNull();
      // flex: 1 1 0 is crucial - the 0 flex-basis prevents content from expanding parent
      expect(block).toMatch(/flex:\s*1\s+1\s+0/i);
      // min-height: 0 allows the container to shrink below content height
      expect(block).toMatch(/min-height:\s*0/i);
      // overflow-y: auto enables scrolling when content exceeds height
      expect(block).toMatch(/overflow-y:\s*auto/i);
    });

    it('ChatInput container uses flex: 0 0 auto to stay fixed size', () => {
      const css = readCssFile('components/chat/ChatInput.module.css');
      const block = extractSelectorBlock(css, 'container');

      expect(block).not.toBeNull();
      // flex: 0 0 auto prevents input from growing/shrinking
      // This is what keeps it "pinned" at the bottom
      expect(block).toMatch(/flex:\s*0\s+0\s+auto/i);
    });

    it('ChatPanel panel has min-height: 0 for proper nested scroll behavior', () => {
      const css = readCssFile('components/chat/ChatPanel.module.css');
      const block = extractSelectorBlock(css, 'panel');

      expect(block).not.toBeNull();
      // min-height: 0 is required on all flex containers in the chain
      // for nested scroll to work properly
      expect(block).toMatch(/min-height:\s*0/i);
    });
  });
});
