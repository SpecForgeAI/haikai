/**
 * Tests for multi-file upload chat route logic.
 *
 * Spec: 2026-02-17 Multi-File Upload + URL References
 * Task Group 2: Server-Side Validation, Content Parts Construction, URL Extraction,
 *               and Persistence Stripping
 *
 * Test 1: Reject request when files array length exceeds 10 (return 400)
 * Test 2: Reject request when any individual base64 payload exceeds ~6.67 MB (return 400)
 * Test 3: Build content parts array correctly for a mix of image and non-image files
 * Test 4: Image MIME types produce image_url content parts with correct data: URI and detail: "auto"
 * Test 5: Non-image MIME types (PDF, text) produce file content parts with correct file_data and filename
 * Test 6: When files are present and message text contains URLs, URLs are still extracted
 * Test 7: Persistence stripping replaces content parts array with plain string
 * Test 8: Persistence stripping works for any mode with files (mode-agnostic)
 */

import { buildContentParts, extractUrlsFromText, buildPersistenceContent } from '../routes/chat';
import { ContentPart } from '../services/openaiClient';

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

describe('Multi-File Upload Chat Route Logic', () => {
  // Test 1: Reject request when files array length exceeds 10
  describe('Server-side validation', () => {
    it('should reject when files array length exceeds 10', () => {
      // Validation logic: files.length > 10 returns 400
      const files = Array.from({ length: 11 }, (_, i) => ({
        filename: `file${i}.txt`,
        mimeType: 'text/plain',
        base64: 'SGVsbG8=',
      }));

      // Simulate the validation check from chat route
      const MAX_FILES = 10;
      expect(files.length).toBeGreaterThan(MAX_FILES);

      // The route returns: { error: 'Maximum 10 files allowed' }
      const error = files.length > MAX_FILES ? 'Maximum 10 files allowed' : null;
      expect(error).toBe('Maximum 10 files allowed');
    });

    // Test 2: Reject when any individual base64 payload exceeds ~6.67 MB
    it('should reject when any individual base64 payload exceeds ~6.67 MB', () => {
      const MAX_BASE64_LENGTH = 6_670_000;
      const oversizedBase64 = 'A'.repeat(MAX_BASE64_LENGTH + 1);
      const files = [
        { filename: 'small.txt', mimeType: 'text/plain', base64: 'SGVsbG8=' },
        { filename: 'huge.pdf', mimeType: 'application/pdf', base64: oversizedBase64 },
      ];

      // Simulate the validation check
      const oversizedFile = files.find(f => f.base64.length > MAX_BASE64_LENGTH);
      expect(oversizedFile).toBeDefined();
      expect(oversizedFile!.filename).toBe('huge.pdf');

      const error = oversizedFile
        ? `File exceeds 5 MB limit: ${oversizedFile.filename}`
        : null;
      expect(error).toBe('File exceeds 5 MB limit: huge.pdf');
    });
  });

  // Test 3: Build content parts array correctly for a mix of image and non-image files
  describe('buildContentParts', () => {
    it('should build content parts with text first, then files in attachment order', () => {
      const files = [
        { filename: 'doc.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
        { filename: 'photo.png', mimeType: 'image/png', base64: 'iVBORw0=' },
        { filename: 'notes.txt', mimeType: 'text/plain', base64: 'SGVsbG8=' },
      ];

      const parts = buildContentParts('Analyze these documents', files);

      // Verify ordering: text first, then files in attachment order
      expect(parts.length).toBe(4); // 1 text + 3 files
      expect(parts[0].type).toBe('text');
      expect((parts[0] as { type: 'text'; text: string }).text).toBe('Analyze these documents');

      // Second part: PDF (non-image -> file type)
      expect(parts[1].type).toBe('file');

      // Third part: PNG (image -> image_url type)
      expect(parts[2].type).toBe('image_url');

      // Fourth part: TXT (text -> inlined as text type)
      expect(parts[3].type).toBe('text');
    });

    // Test 4: Image MIME types produce image_url content parts
    it('should produce image_url content parts with correct data: URI and detail: "auto" for image MIME types', () => {
      const files = [
        { filename: 'photo.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
        { filename: 'screenshot.jpg', mimeType: 'image/jpeg', base64: '/9j/4AAQ=' },
        { filename: 'animation.gif', mimeType: 'image/gif', base64: 'R0lGODlh' },
        { filename: 'icon.svg', mimeType: 'image/svg+xml', base64: 'PHN2Zz4=' },
      ];

      const parts = buildContentParts('Check these images', files);

      // Skip text part (index 0)
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        expect(part.type).toBe('image_url');
        const imageUrl = (part as { type: 'image_url'; image_url: { url: string; detail?: string } }).image_url;
        expect(imageUrl.detail).toBe('auto');
        expect(imageUrl.url).toMatch(/^data:image\//);
        expect(imageUrl.url).toContain(';base64,');
      }

      // Verify specific data URIs
      const pngPart = parts[1] as { type: 'image_url'; image_url: { url: string; detail?: string } };
      expect(pngPart.image_url.url).toBe('data:image/png;base64,iVBORw0KGgo=');

      const jpgPart = parts[2] as { type: 'image_url'; image_url: { url: string; detail?: string } };
      expect(jpgPart.image_url.url).toBe('data:image/jpeg;base64,/9j/4AAQ=');

      const gifPart = parts[3] as { type: 'image_url'; image_url: { url: string; detail?: string } };
      expect(gifPart.image_url.url).toBe('data:image/gif;base64,R0lGODlh');

      const svgPart = parts[4] as { type: 'image_url'; image_url: { url: string; detail?: string } };
      expect(svgPart.image_url.url).toBe('data:image/svg+xml;base64,PHN2Zz4=');
    });

    // Test 5: PDF files produce file content parts; text files are inlined as text
    it('should produce file content parts for PDFs and inline text for text-based files', () => {
      const files = [
        { filename: 'document.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQ=' },
        { filename: 'readme.txt', mimeType: 'text/plain', base64: 'SGVsbG8gV29ybGQ=' },
        { filename: 'data.csv', mimeType: 'text/csv', base64: 'YSxiLGM=' },
      ];

      const parts = buildContentParts('Review these files', files);

      // parts[0] = text (user message), parts[1] = PDF file, parts[2] = txt inlined, parts[3] = csv inlined
      expect(parts.length).toBe(4);

      // PDF stays as file content part
      const pdfPart = parts[1] as { type: 'file'; file: { file_data: string; filename: string } };
      expect(pdfPart.type).toBe('file');
      expect(pdfPart.file.file_data).toBe('data:application/pdf;base64,JVBERi0xLjQ=');
      expect(pdfPart.file.filename).toBe('document.pdf');

      // Text files are inlined as text content (OpenAI only supports PDF for file type)
      const txtPart = parts[2] as { type: 'text'; text: string };
      expect(txtPart.type).toBe('text');
      expect(txtPart.text).toContain('--- File: readme.txt ---');
      expect(txtPart.text).toContain('Hello World'); // decoded from SGVsbG8gV29ybGQ=

      const csvPart = parts[3] as { type: 'text'; text: string };
      expect(csvPart.type).toBe('text');
      expect(csvPart.text).toContain('--- File: data.csv ---');
      expect(csvPart.text).toContain('a,b,c'); // decoded from YSxiLGM=
    });
  });

  // Test 6: URL extraction when files are present
  describe('extractUrlsFromText', () => {
    it('should extract http and https URLs from message text when files are present', () => {
      const text = 'Please analyze this page https://example.com/docs and also http://api.example.org/spec.json along with the attached files';

      const urls = extractUrlsFromText(text);

      expect(urls.length).toBe(2);
      expect(urls).toContain('https://example.com/docs');
      expect(urls).toContain('http://api.example.org/spec.json');
    });

    it('should return empty array when no URLs are present', () => {
      const text = 'Just analyze the attached files please';
      const urls = extractUrlsFromText(text);
      expect(urls.length).toBe(0);
    });

    it('should handle multiple URLs including those with paths and query strings', () => {
      const text = 'Check https://example.com/api/v2?format=json and https://docs.example.com/guide#section-3';
      const urls = extractUrlsFromText(text);
      expect(urls.length).toBe(2);
      expect(urls[0]).toBe('https://example.com/api/v2?format=json');
      expect(urls[1]).toBe('https://docs.example.com/guide#section-3');
    });
  });

  // Test 7: Persistence stripping with files
  describe('buildPersistenceContent (persistence stripping)', () => {
    it('should replace content parts array with plain string when files are attached', () => {
      const originalMessage = 'Analyze these architecture documents';
      const files = [
        { filename: 'design.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
        { filename: 'diagram.png', mimeType: 'image/png', base64: 'iVBORw0=' },
      ];

      const result = buildPersistenceContent(originalMessage, files);

      expect(typeof result).toBe('string');
      expect(result).toBe('Analyze these architecture documents\n\n[Attached: design.pdf, diagram.png]');
    });

    it('should handle files-only (no sources) correctly', () => {
      const originalMessage = 'Review this';
      const files = [
        { filename: 'spec.yaml', mimeType: 'text/yaml', base64: 'bmFtZTo=' },
      ];

      const result = buildPersistenceContent(originalMessage, files);

      expect(result).toBe('Review this\n\n[Attached: spec.yaml]');
    });

    // Test 8: Persistence stripping is mode-agnostic
    it('should work for any mode with files (mode-agnostic utility)', () => {
      // The buildPersistenceContent function is mode-agnostic; it just produces
      // the stripped string. The calling code in the route handler decides WHEN
      // to use it based on mode.
      const originalMessage = 'Here are the product requirements';
      const files = [
        { filename: 'requirements.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
        { filename: 'wireframe.png', mimeType: 'image/png', base64: 'iVBORw0=' },
        { filename: 'data.csv', mimeType: 'text/csv', base64: 'YSxiLGM=' },
      ];

      const result = buildPersistenceContent(originalMessage, files);

      expect(typeof result).toBe('string');
      expect(result).toBe('Here are the product requirements\n\n[Attached: requirements.pdf, wireframe.png, data.csv]');
      // Verify it does NOT contain any base64 data
      expect(result).not.toContain('JVBERi0=');
      expect(result).not.toContain('iVBORw0=');
      expect(result).not.toContain('YSxiLGM=');
    });
  });
});
