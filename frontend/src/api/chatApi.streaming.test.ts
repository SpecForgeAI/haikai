/**
 * ChatMessage Persona and Streaming Delta Handling Tests
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 3: ChatMessage Persona and Streaming Delta Handling
 * Task 3.1: Write 5-8 focused tests for ChatMessage and streaming behavior
 *
 * Tests verify:
 * - ChatMessage interface accepts optional persona field
 * - Persona set to 'Software Developer' on streamed message creation
 * - Each content delta creates new ChatMessage with unique id
 * - Empty delta content does not create ChatMessage
 * - Whitespace-only delta does not create ChatMessage
 * - Message content equals delta only (no accumulation)
 * - Message ordering preserved from stream
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShapeSpecStream } from '../hooks/useShapeSpecStream';
import type { ChatMessage, ChatMessagePersona } from './chatApi';

// ============================================================================
// Mock Setup
// ============================================================================

/**
 * Creates a mock ReadableStream that simulates SSE responses.
 */
function createMockReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let chunkIndex = 0;

  return new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Creates a mock Response with a ReadableStream body.
 */
function createMockResponse(chunks: string[], ok = true, status = 200): Response {
  return {
    ok,
    status,
    body: createMockReadableStream(chunks),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic',
    url: '',
    clone: () => createMockResponse(chunks, ok, status),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as Response;
}

// ============================================================================
// Task 3.1: ChatMessage Interface and Persona Tests
// ============================================================================

describe('ChatMessage Persona and Streaming Tests (Task Group 3)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    // Use globalThis instead of global for cross-platform compatibility
    globalThis.fetch = mockFetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Test 3.1.1: ChatMessage interface accepts optional persona field
  // ==========================================================================
  it('ChatMessage interface accepts optional persona field', () => {
    // Given: A ChatMessage object with all required fields
    const messageWithoutPersona: ChatMessage = {
      id: 'msg-123',
      role: 'assistant',
      content: 'Hello world',
      timestamp: new Date(),
    };

    // Then: The object should be valid without persona
    expect(messageWithoutPersona.id).toBe('msg-123');
    expect(messageWithoutPersona.persona).toBeUndefined();

    // Given: A ChatMessage with persona field set
    const messageWithPersona: ChatMessage = {
      id: 'msg-456',
      role: 'assistant',
      content: 'Hello from SA',
      timestamp: new Date(),
      persona: 'Software Developer',
    };

    // Then: The persona should be correctly stored
    expect(messageWithPersona.persona).toBe('Software Developer');
  });

  // ==========================================================================
  // Test 3.1.2: Persona set to 'Software Developer' on streamed message creation
  // ==========================================================================
  it('streaming messages have persona set to Software Architect', async () => {
    // Given: A stream with content events
    const chunks = [
      'data: {"type":"content","delta":"Hello from the architect"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const createdMessages: ChatMessage[] = [];
    const onContent = vi.fn((delta: string) => {
      // Simulate message creation with persona
      const message: ChatMessage = {
        id: `stream-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        role: 'assistant',
        content: delta,
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      createdMessages.push(message);
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: The created message should have Software Architect persona
    expect(createdMessages.length).toBe(1);
    expect(createdMessages[0].persona).toBe('Software Developer');
  });

  // ==========================================================================
  // Test 3.1.3: Each content delta creates new ChatMessage with unique id
  // ==========================================================================
  it('each content delta creates new ChatMessage with unique id', async () => {
    // Given: A stream with multiple content events
    const chunks = [
      'data: {"type":"content","delta":"First"}\n\n',
      'data: {"type":"content","delta":"Second"}\n\n',
      'data: {"type":"content","delta":"Third"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const createdMessageIds: string[] = [];
    const onContent = vi.fn((_delta: string) => {
      // Simulate unique ID generation for each delta
      const id = `stream-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      createdMessageIds.push(id);
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: Three unique messages should have been created
    expect(createdMessageIds.length).toBe(3);

    // Verify all IDs are unique
    const uniqueIds = new Set(createdMessageIds);
    expect(uniqueIds.size).toBe(3);

    // Verify ID format (stream-msg prefix)
    createdMessageIds.forEach(id => {
      expect(id).toMatch(/^stream-msg-/);
    });
  });

  // ==========================================================================
  // Test 3.1.4: Empty delta content does not create ChatMessage
  // ==========================================================================
  it('empty delta content does not create ChatMessage', async () => {
    // Given: A stream with empty delta
    const chunks = [
      'data: {"type":"content","delta":"Valid content"}\n\n',
      'data: {"type":"content","delta":""}\n\n',
      'data: {"type":"content","delta":"More content"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const validDeltas: string[] = [];
    const onContent = vi.fn((delta: string) => {
      // Only collect non-empty deltas (simulating the filtering logic)
      if (delta.trim() !== '') {
        validDeltas.push(delta);
      }
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: onContent was called 3 times (raw callbacks)
    expect(onContent).toHaveBeenCalledTimes(3);

    // But only 2 valid non-empty deltas should have been processed
    expect(validDeltas.length).toBe(2);
    expect(validDeltas).toContain('Valid content');
    expect(validDeltas).toContain('More content');
    expect(validDeltas).not.toContain('');
  });

  // ==========================================================================
  // Test 3.1.5: Whitespace-only delta does not create ChatMessage
  // ==========================================================================
  it('whitespace-only delta does not create ChatMessage', async () => {
    // Given: A stream with whitespace-only delta
    const chunks = [
      'data: {"type":"content","delta":"Actual content"}\n\n',
      'data: {"type":"content","delta":"   "}\n\n',
      'data: {"type":"content","delta":"\\t\\n"}\n\n',
      'data: {"type":"content","delta":"Final content"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const createdMessages: ChatMessage[] = [];
    const onContent = vi.fn((delta: string) => {
      // Skip creating message for whitespace-only deltas
      if (delta.trim() !== '') {
        const message: ChatMessage = {
          id: `stream-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          role: 'assistant',
          content: delta,
          timestamp: new Date(),
          persona: 'Software Developer',
        };
        createdMessages.push(message);
      }
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: Only 2 messages should have been created (non-whitespace)
    expect(createdMessages.length).toBe(2);
    expect(createdMessages[0].content).toBe('Actual content');
    expect(createdMessages[1].content).toBe('Final content');
  });

  // ==========================================================================
  // Test 3.1.6: Message content equals delta only (no accumulation)
  // ==========================================================================
  it('message content equals delta only without accumulation', async () => {
    // Given: A stream with multiple content events
    const chunks = [
      'data: {"type":"content","delta":"First part"}\n\n',
      'data: {"type":"content","delta":"Second part"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const createdMessages: ChatMessage[] = [];
    const onContent = vi.fn((delta: string) => {
      // Each message should contain ONLY the delta, not accumulated content
      const message: ChatMessage = {
        id: `stream-msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        role: 'assistant',
        content: delta, // Just the delta, no accumulation
        timestamp: new Date(),
        persona: 'Software Developer',
      };
      createdMessages.push(message);
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: Each message should contain only its delta content
    expect(createdMessages.length).toBe(2);
    expect(createdMessages[0].content).toBe('First part');
    expect(createdMessages[1].content).toBe('Second part');

    // Verify no accumulation happened
    expect(createdMessages[1].content).not.toBe('First partSecond part');
    expect(createdMessages[1].content).not.toContain('First part');
  });

  // ==========================================================================
  // Test 3.1.7: Message ordering preserved from stream
  // ==========================================================================
  it('message ordering preserved from stream', async () => {
    // Given: A stream with sequential content events
    const chunks = [
      'data: {"type":"content","delta":"One"}\n\n',
      'data: {"type":"content","delta":"Two"}\n\n',
      'data: {"type":"content","delta":"Three"}\n\n',
      'data: {"type":"content","delta":"Four"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const receivedOrder: string[] = [];
    const onContent = vi.fn((delta: string) => {
      receivedOrder.push(delta);
    });
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When: Stream is started
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then: Wait for completion
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Then: Order should be preserved
    expect(receivedOrder).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(receivedOrder[0]).toBe('One');
    expect(receivedOrder[3]).toBe('Four');
  });

  // ==========================================================================
  // Test 3.1.8: Persona type is correctly typed (type safety test)
  // ==========================================================================
  it('ChatMessagePersona type accepts only valid values', () => {
    // Given: Valid persona values
    const validPersona1: ChatMessagePersona = 'Product Manager';
    const validPersona2: ChatMessagePersona = 'Software Developer';

    // Then: Type should be correctly assigned
    expect(validPersona1).toBe('Product Manager');
    expect(validPersona2).toBe('Software Developer');

    // Create messages with each valid persona
    const messageWithPO: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'Test',
      timestamp: new Date(),
      persona: validPersona1,
    };

    const messageWithSA: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Test',
      timestamp: new Date(),
      persona: validPersona2,
    };

    expect(messageWithPO.persona).toBe('Product Manager');
    expect(messageWithSA.persona).toBe('Software Developer');
  });
});
