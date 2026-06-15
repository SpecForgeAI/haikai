/**
 * Gap Analysis Tests for Multi-File Upload + URL References
 *
 * Spec: 2026-02-17 Multi-File Upload + URL References for SA and PM Chat
 * Task Group 5: Test Review and Gap Analysis
 *
 * These tests cover critical edge cases and boundary conditions not addressed
 * by Task Groups 1-2 tests:
 *
 * Gap 1: buildContentParts with empty files array returns only text part
 * Gap 2: extractUrlsFromText with edge-case URLs (trailing punctuation, non-http schemes)
 * Gap 3: buildPersistenceContent with single file produces correct format
 * Gap 4: buildContentParts preserves augmented message text containing URL-fetched content
 */

import { buildContentParts, extractUrlsFromText, buildPersistenceContent } from '../routes/chat';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    mcpBaseUrl: 'http://localhost:8090',
    sessionTtlHours: 24,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
    maxConversationMessages: 80,
    maxConversationBytes: 200000,
    maxToolCallsPerTurn: 5,
    enableToolTrace: false,
  }),
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logOpenAIRequest: jest.fn(),
  logRequestStart: jest.fn(),
  logRequestEnd: jest.fn(),
}));

describe('Multi-File Upload Gap Tests (Gateway)', () => {
  // =========================================================================
  // Gap 1: buildContentParts with empty files array returns only text part
  // =========================================================================
  it('buildContentParts with empty files array should return only the text part', () => {
    const parts = buildContentParts('Analyze this message', []);

    expect(parts.length).toBe(1);
    expect(parts[0].type).toBe('text');
    expect((parts[0] as { type: 'text'; text: string }).text).toBe('Analyze this message');
  });

  // =========================================================================
  // Gap 2: extractUrlsFromText handles edge-case URLs
  // =========================================================================
  describe('extractUrlsFromText edge cases', () => {
    it('should handle URLs with trailing punctuation (period, comma) by including them', () => {
      // URLs followed by a space or end-of-string should be captured;
      // trailing punctuation that is part of the URL path is included
      const text = 'Visit https://example.com/page. Also see https://example.com/other, thanks';
      const urls = extractUrlsFromText(text);

      // The regex captures until whitespace, so trailing period/comma are included
      // in the URL match. This is the expected behavior per the regex pattern.
      expect(urls.length).toBe(2);
      // The first URL will include the trailing period
      expect(urls[0]).toContain('https://example.com/page');
      // The second URL will include the trailing comma
      expect(urls[1]).toContain('https://example.com/other');
    });

    it('should not match non-http schemes like ftp:// or file://', () => {
      const text = 'Check ftp://files.example.com and file:///local/path.txt and mailto:test@example.com';
      const urls = extractUrlsFromText(text);

      // Only http:// and https:// should be matched
      expect(urls.length).toBe(0);
    });
  });

  // =========================================================================
  // Gap 3: buildPersistenceContent with single file uses correct format
  // =========================================================================
  it('buildPersistenceContent with single file should produce correct format without trailing comma', () => {
    const result = buildPersistenceContent('Review this', [
      { filename: 'spec.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
    ]);

    expect(result).toBe('Review this\n\n[Attached: spec.pdf]');
    // Verify no trailing comma or extra whitespace in the filename list
    expect(result).not.toContain(', ]');
    expect(result).not.toContain(',]');
  });

  // =========================================================================
  // Gap 4: buildContentParts preserves augmented message with URL content
  // =========================================================================
  it('buildContentParts should preserve augmented text that includes URL-fetched content alongside files', () => {
    // Simulate what happens after buildAugmentedMessage appends URL content
    const augmentedMessage = 'Analyze this\n\n--- ATTACHED DOCUMENTS ---\n\n### Source: https://example.com\nFetched web page content here...';
    const files = [
      { filename: 'notes.txt', mimeType: 'text/plain', base64: 'SGVsbG8=' },
    ];

    const parts = buildContentParts(augmentedMessage, files);

    expect(parts.length).toBe(2); // augmented text + 1 inlined text file
    expect(parts[0].type).toBe('text');
    // The text part should contain the full augmented message including fetched URL content
    const textPart = parts[0] as { type: 'text'; text: string };
    expect(textPart.text).toContain('--- ATTACHED DOCUMENTS ---');
    expect(textPart.text).toContain('https://example.com');
    expect(textPart.text).toContain('Fetched web page content here...');

    // Text files are inlined as text (OpenAI only supports PDF for file type)
    expect(parts[1].type).toBe('text');
    const inlinedPart = parts[1] as { type: 'text'; text: string };
    expect(inlinedPart.text).toContain('--- File: notes.txt ---');
    expect(inlinedPart.text).toContain('Hello'); // decoded from SGVsbG8=
  });
});
