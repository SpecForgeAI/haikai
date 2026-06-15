/**
 * Transcript Export Utility Tests
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 6, Task 6.1: Write 3 focused tests for transcript export
 *
 * Tests verify:
 * - buildTranscriptMarkdown filters messages to the specified taskId and formats
 *   user messages with "### You" and assistant messages with "### Product Manager"
 * - buildTranscriptMarkdown appends artifact content as an appendix section with
 *   the marker `> Saved artifact: agent-os/product/MISSION.MD`
 * - downloadMarkdownFile triggers a browser download (mock URL.createObjectURL
 *   and verify a link click is simulated)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ThreadMessage } from '../api/chatV2Api';
import { buildTranscriptMarkdown, downloadMarkdownFile } from '../utils/transcriptExport';

describe('transcriptExport', () => {
  // ==========================================================================
  // buildTranscriptMarkdown Tests
  // ==========================================================================

  describe('buildTranscriptMarkdown', () => {
    /**
     * Test 1: buildTranscriptMarkdown filters messages to the specified taskId
     * and formats user messages with "### You" and assistant messages with
     * "### Product Manager".
     */
    it('filters messages to the specified taskId and formats user/assistant messages with correct headers', () => {
      // Given
      const messages: ThreadMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          personaId: null,
          taskId: 'product-manager--define-product',
          content: 'I want to build a project management tool.',
          structuredResponse: null,
          timestamp: '2026-02-28T10:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          personaId: 'product-manager',
          taskId: 'product-manager--define-product',
          content: 'Great! Let me ask you some questions about your product.',
          structuredResponse: null,
          timestamp: '2026-02-28T10:00:01.000Z',
        },
        {
          id: 'msg-3',
          role: 'user',
          personaId: null,
          taskId: 'architect--baseline',
          content: 'This message belongs to a different task and should be excluded.',
          structuredResponse: null,
          timestamp: '2026-02-28T10:00:02.000Z',
        },
        {
          id: 'msg-4',
          role: 'system',
          personaId: null,
          taskId: 'product-manager--define-product',
          content: 'Task started.',
          structuredResponse: null,
          timestamp: '2026-02-28T10:00:03.000Z',
        },
      ];

      const taskId = 'product-manager--define-product';
      const artifactContent = '# Mission\n\nBuild a tool.';

      // When
      const result = buildTranscriptMarkdown(messages, taskId, artifactContent);

      // Then
      // Should include messages for the specified taskId only (3 messages, not the architect one)
      expect(result).toContain('### You');
      expect(result).toContain('I want to build a project management tool.');
      expect(result).toContain('### Product Manager');
      expect(result).toContain('Great! Let me ask you some questions about your product.');
      expect(result).toContain('> *Task started.*');

      // Should NOT include the architect message
      expect(result).not.toContain('This message belongs to a different task and should be excluded.');
    });

    /**
     * Test 2: buildTranscriptMarkdown appends artifact content as an appendix
     * section with the marker `> Saved artifact: agent-os/product/MISSION.MD`.
     */
    it('appends artifact content as an appendix section with the saved artifact marker', () => {
      // Given
      const messages: ThreadMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          personaId: null,
          taskId: 'product-manager--define-product',
          content: 'Define my product.',
          structuredResponse: null,
          timestamp: '2026-02-28T10:00:00.000Z',
        },
      ];

      const taskId = 'product-manager--define-product';
      const artifactContent = '# Product Mission\n\nWe are building a revolutionary platform.';

      // When
      const result = buildTranscriptMarkdown(messages, taskId, artifactContent);

      // Then
      // Should contain the appendix section
      expect(result).toContain('---');
      expect(result).toContain('## Appendix: Generated Artifact');
      expect(result).toContain('> Saved artifact: agent-os/product/MISSION.MD');
      expect(result).toContain(artifactContent);

      // Verify the appendix comes after the conversation messages
      const appendixIndex = result.indexOf('## Appendix: Generated Artifact');
      const conversationIndex = result.indexOf('### You');
      expect(appendixIndex).toBeGreaterThan(conversationIndex);
    });
  });

  // ==========================================================================
  // downloadMarkdownFile Test
  // ==========================================================================

  describe('downloadMarkdownFile', () => {
    /**
     * Test 3: downloadMarkdownFile triggers a browser download by creating a
     * Blob, URL.createObjectURL, and simulating a click on a temporary anchor.
     */
    it('triggers a browser download by creating a Blob URL and simulating a link click', () => {
      // Given
      const mockObjectURL = 'blob:http://localhost/mock-uuid';
      const createObjectURLMock = vi.fn().mockReturnValue(mockObjectURL);
      const revokeObjectURLMock = vi.fn();

      // Mock URL.createObjectURL and URL.revokeObjectURL
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      // Mock document.createElement to capture the anchor element
      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
      } as unknown as HTMLAnchorElement;

      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          return mockAnchor as unknown as HTMLAnchorElement;
        }
        return originalCreateElement(tag);
      });

      const content = '# Transcript\n\nSome conversation content.';
      const filename = 'pm-define-product-transcript.md';

      // When
      downloadMarkdownFile(content, filename);

      // Then
      // Verify Blob was created (via createObjectURL being called)
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLMock.mock.calls[0][0];
      expect(blobArg).toBeInstanceOf(Blob);

      // Verify anchor was configured correctly
      expect(mockAnchor.href).toBe(mockObjectURL);
      expect(mockAnchor.download).toBe(filename);

      // Verify click was triggered
      expect(mockAnchor.click).toHaveBeenCalledTimes(1);

      // Verify object URL was revoked after use
      expect(revokeObjectURLMock).toHaveBeenCalledWith(mockObjectURL);

      // Cleanup
      createElementSpy.mockRestore();
    });
  });
});
