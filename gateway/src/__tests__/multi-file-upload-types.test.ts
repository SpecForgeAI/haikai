/**
 * Tests for multi-file upload type definitions and configuration changes.
 *
 * Spec: 2026-02-17 Multi-File Upload + URL References for SA and PM Chat
 * Task Group 1: Gateway Type Definitions, OpenAI Message Update, and Body Limit
 *
 * Test 1: Verify ChatRequest interface accepts a files array with { filename, mimeType, base64 } objects
 * Test 2: Verify ContentPart union type covers text, image_url, and file variants
 * Test 3: Verify OpenAIMessage.content accepts both string and ContentPart[] types
 * Test 4: Verify calculateConversationBytes correctly counts bytes when content is a ContentPart[]
 * Test 5: Verify calculateConversationBytes continues to work correctly when content is a plain string (regression)
 */

import { ChatRequest } from '../types/chat';
import { ContentPart, OpenAIMessage } from '../services/openaiClient';
import { calculateConversationBytes } from '../services/conversation';
import { OpenAIMessage as SessionOpenAIMessage, ContentPart as SessionContentPart } from '../types/session';

// Mock config for conversation helper
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
}));

describe('Multi-File Upload Type Definitions and Configuration', () => {
  // Test 1: Verify ChatRequest interface accepts a files array
  it('ChatRequest interface should accept a files array with { filename, mimeType, base64 } objects', () => {
    const request: ChatRequest = {
      message: 'Analyze these files',
      files: [
        { filename: 'architecture.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQ=' },
        { filename: 'diagram.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
      ],
    };

    expect(request.files).toBeDefined();
    expect(request.files!.length).toBe(2);
    expect(request.files![0].filename).toBe('architecture.pdf');
    expect(request.files![0].mimeType).toBe('application/pdf');
    expect(request.files![0].base64).toBe('JVBERi0xLjQ=');
    expect(request.files![1].filename).toBe('diagram.png');
    expect(request.files![1].mimeType).toBe('image/png');

    // Verify files is optional -- ChatRequest without files should also compile
    const requestWithoutFiles: ChatRequest = {
      message: 'Hello',
    };
    expect(requestWithoutFiles.files).toBeUndefined();

    // Verify backward compatibility -- sources field still works alongside files
    const requestWithBoth: ChatRequest = {
      message: 'Test',
      sources: ['/path/to/file.txt'],
      files: [{ filename: 'doc.md', mimeType: 'text/markdown', base64: 'SGVsbG8=' }],
    };
    expect(requestWithBoth.sources).toBeDefined();
    expect(requestWithBoth.files).toBeDefined();
  });

  // Test 2: Verify ContentPart union type covers text, image_url, and file variants
  it('ContentPart union type should cover text, image_url, and file variants', () => {
    const textPart: ContentPart = { type: 'text', text: 'Analyze this document' };
    expect(textPart.type).toBe('text');
    expect((textPart as { type: 'text'; text: string }).text).toBe('Analyze this document');

    const imagePart: ContentPart = {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'auto' },
    };
    expect(imagePart.type).toBe('image_url');
    expect((imagePart as { type: 'image_url'; image_url: { url: string; detail?: string } }).image_url.url).toBe(
      'data:image/png;base64,iVBORw0KGgo='
    );
    expect((imagePart as { type: 'image_url'; image_url: { url: string; detail?: string } }).image_url.detail).toBe(
      'auto'
    );

    const filePart: ContentPart = {
      type: 'file',
      file: { file_data: 'data:application/pdf;base64,JVBERi0xLjQ=', filename: 'design.pdf' },
    };
    expect(filePart.type).toBe('file');
    expect((filePart as { type: 'file'; file: { file_data: string; filename: string } }).file.file_data).toBe(
      'data:application/pdf;base64,JVBERi0xLjQ='
    );
    expect((filePart as { type: 'file'; file: { file_data: string; filename: string } }).file.filename).toBe(
      'design.pdf'
    );

    // Verify image_url detail is optional
    const imagePartNoDetail: ContentPart = {
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,/9j/' },
    };
    expect(imagePartNoDetail.type).toBe('image_url');
    expect(
      (imagePartNoDetail as { type: 'image_url'; image_url: { url: string; detail?: string } }).image_url.detail
    ).toBeUndefined();
  });

  // Test 3: Verify OpenAIMessage.content accepts both string and ContentPart[] types
  it('OpenAIMessage.content should accept both string and ContentPart[] types', () => {
    // String content (existing behavior)
    const stringMessage: OpenAIMessage = {
      role: 'user',
      content: 'Hello, please help me.',
    };
    expect(typeof stringMessage.content).toBe('string');

    // ContentPart[] content (new multimodal behavior)
    const contentParts: ContentPart[] = [
      { type: 'text', text: 'Analyze this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123', detail: 'auto' } },
    ];
    const multimodalMessage: OpenAIMessage = {
      role: 'user',
      content: contentParts,
    };
    expect(Array.isArray(multimodalMessage.content)).toBe(true);
    expect((multimodalMessage.content as ContentPart[]).length).toBe(2);
    expect((multimodalMessage.content as ContentPart[])[0].type).toBe('text');
    expect((multimodalMessage.content as ContentPart[])[1].type).toBe('image_url');

    // System and assistant messages still use string content
    const systemMessage: OpenAIMessage = {
      role: 'system',
      content: 'You are a solution architect.',
    };
    expect(typeof systemMessage.content).toBe('string');
  });

  // Test 4: Verify calculateConversationBytes correctly counts bytes when content is a ContentPart[]
  it('calculateConversationBytes should correctly count bytes when content is a ContentPart[]', () => {
    const contentParts: SessionContentPart[] = [
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ];

    // SessionOpenAIMessage now natively supports ContentPart[] content
    const messages: SessionOpenAIMessage[] = [
      { role: 'user', content: contentParts },
    ];

    const bytes = calculateConversationBytes(messages);

    // When content is an array, it should be JSON.stringified before measuring bytes
    const expectedJson = JSON.stringify(contentParts);
    const expectedBytes = Buffer.byteLength(expectedJson, 'utf8');
    expect(bytes).toBe(expectedBytes);
    expect(bytes).toBeGreaterThan(0);
  });

  // Test 5: Verify calculateConversationBytes continues to work with plain string content (regression)
  it('calculateConversationBytes should continue to work correctly when content is a plain string (regression)', () => {
    const messages: SessionOpenAIMessage[] = [
      { role: 'user', content: 'Hello' },        // 5 bytes
      { role: 'assistant', content: 'World' },    // 5 bytes
    ];

    const bytes = calculateConversationBytes(messages);
    expect(bytes).toBe(10);

    // Empty string content
    const messagesWithEmpty: SessionOpenAIMessage[] = [
      { role: 'user', content: 'Test' },          // 4 bytes
      { role: 'assistant', content: '' },          // 0 bytes
    ];
    expect(calculateConversationBytes(messagesWithEmpty)).toBe(4);

    // Empty array
    expect(calculateConversationBytes([])).toBe(0);
  });
});
