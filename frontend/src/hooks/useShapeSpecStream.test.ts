/**
 * Tests for useShapeSpecStream Hook
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 1: SSE Stream Utility Hook
 * Task Group 8: Test Review and Gap Analysis (additional strategic tests)
 *
 * Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop
 * Task Group 1: Extend useShapeSpecStream Hook for New Event Types
 * Task Group 5: Error Handling and Test Coverage Review (edge case tests)
 *
 * Spec 2026-01-30: Route Traffic Through Gateway
 * Task Group 4: Gateway URL routing tests (4.1)
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 4: Updated tests 12 and 13 to expect normalized company/project values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShapeSpecStream, getShapeSpecStreamBaseUrl } from './useShapeSpecStream';

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

describe('useShapeSpecStream', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Spec 2026-01-30: Route Traffic Through Gateway
  // Task Group 4: Gateway URL routing tests (Task 4.1)
  // ==========================================================================
  describe('Gateway URL routing (Spec 2026-01-30 Task Group 4)', () => {
    /**
     * Test 4.1.1: SHAPE_SPEC_BASE_URL uses VITE_GATEWAY_BASE_URL
     * When env var is not set, empty string is used as default (same-origin routing).
     */
    it('uses empty string base URL when VITE_GATEWAY_BASE_URL is not set (same-origin routing)', () => {
      // Given - VITE_GATEWAY_BASE_URL is not set in test environment
      // When
      const baseUrl = getShapeSpecStreamBaseUrl();

      // Then - should return empty string (same-origin)
      expect(baseUrl).toBe('');
    });

    /**
     * Test 4.1.2: localhost:8000 fallback is NOT present
     * Ensures no direct Shape-Spec service calls are possible.
     */
    it('does not include localhost:8000 fallback in base URL', () => {
      // Given - VITE_GATEWAY_BASE_URL is not set
      // When
      const baseUrl = getShapeSpecStreamBaseUrl();

      // Then - should NOT contain localhost:8000
      expect(baseUrl).not.toContain('localhost:8000');
      expect(baseUrl).not.toContain('http://localhost:8000');
    });

    /**
     * Test 4.1.3: Requests route to Gateway path correctly
     * Verifies that requests use the Gateway-relative URL pattern.
     */
    it('routes requests to Gateway path /api/v2/shape-spec/stream', async () => {
      // Given
      const chunks = [
        'data: {"type":"content","delta":"Test"}\n\n',
        'data: {"type":"done"}\n\n',
      ];
      mockFetch.mockResolvedValue(createMockResponse(chunks));

      const { result } = renderHook(() => useShapeSpecStream());

      // When
      await act(async () => {
        result.current.startStream({
          company: 'TestCo',
          project: 'TestProject',
          message: '/shape-spec test',
          sessionMode: 'new',
          onContent: vi.fn(),
          onDone: vi.fn(),
          onError: vi.fn(),
        });
      });

      // Then
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      const [url] = mockFetch.mock.calls[0];
      // URL should use Gateway path (empty base URL + path)
      expect(url).toBe('/api/v2/shape-spec/stream');
      // Should NOT include localhost:8000
      expect(url).not.toContain('localhost:8000');
    });

    /**
     * Test 4.1.4: No Authorization header is sent (Gateway handles auth)
     * Confirms that the frontend does not send Bearer tokens directly.
     */
    it('does not send Authorization header (Gateway handles auth server-side)', async () => {
      // Given
      const chunks = [
        'data: {"type":"content","delta":"Test"}\n\n',
        'data: {"type":"done"}\n\n',
      ];
      mockFetch.mockResolvedValue(createMockResponse(chunks));

      const { result } = renderHook(() => useShapeSpecStream());

      // When
      await act(async () => {
        result.current.startStream({
          company: 'TestCo',
          project: 'TestProject',
          message: '/shape-spec test',
          sessionMode: 'new',
          onContent: vi.fn(),
          onDone: vi.fn(),
          onError: vi.fn(),
        });
      });

      // Then
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      const [, options] = mockFetch.mock.calls[0];
      // Should only have Content-Type header
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
      });
      // Should NOT have Authorization header
      expect(options.headers).not.toHaveProperty('Authorization');
    });
  });

  // ==========================================================================
  // Test 1: Successful stream consumption with content events
  // ==========================================================================
  it('successfully streams content events and calls onContent callback', async () => {
    // Given
    const chunks = [
      'data: {"type":"content","delta":"Hello "}\n\n',
      'data: {"type":"content","delta":"World"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onContent).toHaveBeenCalledWith('Hello ');
      expect(onContent).toHaveBeenCalledWith('World');
      expect(onDone).toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ==========================================================================
  // Test 2: Handling of `done` event completing the stream
  // ==========================================================================
  it('completes stream on done event and resets isStreaming', async () => {
    // Given
    const chunks = [
      'data: {"type":"content","delta":"Test content"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onDone = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent: vi.fn(),
        onDone,
        onError: vi.fn(),
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  // ==========================================================================
  // Test 3: `skill_invoked` events are ignored (no callback)
  // ==========================================================================
  it('ignores skill_invoked events without calling any callback', async () => {
    // Given
    const chunks = [
      'data: {"type":"skill_invoked","skill":"analyze_code"}\n\n',
      'data: {"type":"content","delta":"Result"}\n\n',
      'data: {"type":"skill_invoked","skill":"write_file"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // skill_invoked should NOT trigger onContent
    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith('Result');
    expect(onError).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 4: Connection error handling
  // ==========================================================================
  it('handles connection errors and calls onError callback', async () => {
    // Given
    mockFetch.mockRejectedValue(new Error('Network error'));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Network error');
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.error).toBe('Network error');
    });

    expect(onContent).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 5: Malformed JSON parsing error handling
  // ==========================================================================
  it('handles malformed JSON and calls onError callback', async () => {
    // Given
    const chunks = [
      'data: {"type":"content","delta":"Valid"}\n\n',
      'data: {invalid json}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
      expect(result.current.isStreaming).toBe(false);
    });

    // First valid content should have been processed
    expect(onContent).toHaveBeenCalledWith('Valid');
    expect(result.current.error).not.toBeNull();
  });

  // ==========================================================================
  // Test 6: Stream cleanup on abort
  // ==========================================================================
  it('aborts stream and cleans up state', async () => {
    // Given - a stream that never completes
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const neverEndingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        // Enqueue one chunk but never close
        controller.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"Start"}\n\n'));
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: neverEndingStream,
      headers: new Headers(),
    } as Response);

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When - start stream
    act(() => {
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

    // Give time for stream to start
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    // When - abort the stream
    act(() => {
      result.current.abort();
    });

    // Then
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // Clean up the stream controller to avoid errors
    if (streamController) {
      try {
        (streamController as ReadableStreamDefaultController<Uint8Array>).close();
      } catch {
        // Ignore errors from already-closed controller
      }
    }
  });

  // ==========================================================================
  // Task Group 8: Additional Strategic Tests - Gap Analysis
  // ==========================================================================

  // ==========================================================================
  // Test 7 (Gap Analysis): HTTP error response handling (non-2xx status)
  // Gap: Hook handles HTTP errors differently than network errors
  // ==========================================================================
  it('handles non-2xx HTTP response and calls onError with HTTP status', async () => {
    // Given - Server returns 503 Service Unavailable
    mockFetch.mockResolvedValue(createMockResponse([], false, 503));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
      expect(result.current.isStreaming).toBe(false);
    });

    // Error message should contain HTTP status
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('503'));
    expect(result.current.error).toContain('503');
    expect(onContent).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 8 (Gap Analysis): Unknown event type handling
  // Gap: Unknown event types should be logged but not crash the stream
  // ==========================================================================
  it('logs warning for unknown event types and continues processing', async () => {
    // Given - Stream contains an unknown event type
    const chunks = [
      'data: {"type":"content","delta":"Before"}\n\n',
      'data: {"type":"unknown_future_event","data":"something"}\n\n',
      'data: {"type":"content","delta":"After"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const consoleWarnSpy = vi.spyOn(console, 'warn');

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Should have received both content events
    expect(onContent).toHaveBeenCalledWith('Before');
    expect(onContent).toHaveBeenCalledWith('After');
    expect(onContent).toHaveBeenCalledTimes(2);

    // Should have logged warning for unknown event type
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Unknown SSE event type:',
      'unknown_future_event'
    );

    // Should not have errored
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  // ==========================================================================
  // Shape-Spec 2 - Task Group 1: New Event Type Tests
  // ==========================================================================

  // ==========================================================================
  // Test 9: Parsing {type:"questions"} event with questions array
  // ==========================================================================
  it('parses questions event and invokes onQuestions callback with parsed questions', async () => {
    // Given - Stream contains a questions event
    const chunks = [
      'data: {"type":"content","delta":"Let me ask some questions."}\n\n',
      'data: {"type":"questions","questions":[{"id":"q1","question":"What is the primary use case?"},{"id":"q2","question":"Who are the target users?"}]}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onQuestions = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        onQuestions,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Should have invoked onQuestions with parsed questions
    expect(onQuestions).toHaveBeenCalledTimes(1);
    expect(onQuestions).toHaveBeenCalledWith([
      { id: 'q1', question: 'What is the primary use case?' },
      { id: 'q2', question: 'Who are the target users?' },
    ]);

    // Content callback should also have been invoked
    expect(onContent).toHaveBeenCalledWith('Let me ask some questions.');
    expect(onError).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 10: Parsing {type:"folder"} event with folder value
  // ==========================================================================
  it('parses folder event and invokes onFolder callback with folder value', async () => {
    // Given - Stream contains a folder event
    const chunks = [
      'data: {"type":"content","delta":"Creating the implementation..."}\n\n',
      'data: {"type":"folder","folder":"user-authentication-module"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onFolder = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        onFolder,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Should have invoked onFolder with folder value
    expect(onFolder).toHaveBeenCalledTimes(1);
    expect(onFolder).toHaveBeenCalledWith('user-authentication-module');

    // Content callback should also have been invoked
    expect(onContent).toHaveBeenCalledWith('Creating the implementation...');
    expect(onError).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 11: Questions and folder callbacks are optional (not invoked when not provided)
  // ==========================================================================
  it('handles questions and folder events when callbacks are not provided', async () => {
    // Given - Stream contains questions and folder events but no callbacks provided
    const chunks = [
      'data: {"type":"content","delta":"Content"}\n\n',
      'data: {"type":"questions","questions":[{"id":"q1","question":"Question?"}]}\n\n',
      'data: {"type":"folder","folder":"test-folder"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    // Note: onQuestions and onFolder callbacks are NOT provided

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        // onQuestions and onFolder intentionally omitted
      });
    });

    // Then - stream should complete without error
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    expect(onContent).toHaveBeenCalledWith('Content');
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  // ==========================================================================
  // Test 12: Continuation calls work without sessionMode (omits session_mode from request)
  // Spec 2026-01-30: Updated to expect normalized company/project values
  // ==========================================================================
  it('omits session_mode from request body when sessionMode is not provided', async () => {
    // Given
    const chunks = [
      'data: {"type":"content","delta":"Continuation response"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When - call startStream WITHOUT sessionMode (continuation scenario)
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: 'Answers to your questions:\n\nQ: Question?\nA: My answer',
        // sessionMode is intentionally NOT provided for continuation
        onContent,
        onDone,
        onError,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Verify fetch was called with request body that does NOT include session_mode
    // Spec 2026-01-30: company/project are now normalized (lowercase, hyphenated)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    expect(requestBody).toEqual({
      company: 'testco',  // normalized from 'TestCo'
      project: 'testproject',  // normalized from 'TestProject'
      message: 'Answers to your questions:\n\nQ: Question?\nA: My answer',
    });
    expect(requestBody).not.toHaveProperty('session_mode');
  });

  // ==========================================================================
  // Test 13: Request includes session_mode when sessionMode is provided
  // Spec 2026-01-30: Updated to expect normalized company/project values
  // ==========================================================================
  it('includes session_mode in request body when sessionMode is provided', async () => {
    // Given
    const chunks = [
      'data: {"type":"content","delta":"Initial response"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When - call startStream WITH sessionMode (new session scenario)
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec Implement a feature',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Verify fetch was called with request body that includes session_mode
    // Spec 2026-01-30: company/project are now normalized (lowercase, hyphenated)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);

    expect(requestBody).toEqual({
      company: 'testco',  // normalized from 'TestCo'
      project: 'testproject',  // normalized from 'TestProject'
      // Leading "/shape-spec " prefix is stripped before sending
      message: 'Implement a feature',
      session_mode: 'new',
    });
    expect(requestBody).toHaveProperty('session_mode', 'new');
  });

  // ==========================================================================
  // Test 14: Multiple folder events - last value wins
  // ==========================================================================
  it('invokes onFolder for each folder event received (multiple events)', async () => {
    // Given - Stream contains multiple folder events
    const chunks = [
      'data: {"type":"folder","folder":"initial-folder"}\n\n',
      'data: {"type":"content","delta":"Working..."}\n\n',
      'data: {"type":"folder","folder":"final-folder"}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onFolder = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        onFolder,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Both folder events should have invoked the callback
    expect(onFolder).toHaveBeenCalledTimes(2);
    expect(onFolder).toHaveBeenNthCalledWith(1, 'initial-folder');
    expect(onFolder).toHaveBeenNthCalledWith(2, 'final-folder');
  });

  // ==========================================================================
  // Task Group 5: Error Handling and Test Coverage Review - Edge Cases
  // ==========================================================================

  // ==========================================================================
  // Test 15 (Task Group 5): Empty questions array edge case
  // Tests handling of {type:"questions", questions:[]} with empty array
  // ==========================================================================
  it('handles empty questions array in questions event', async () => {
    // Given - Stream contains a questions event with empty array
    const chunks = [
      'data: {"type":"content","delta":"No more questions needed."}\n\n',
      'data: {"type":"questions","questions":[]}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onQuestions = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        onQuestions,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Should invoke onQuestions with empty array
    expect(onQuestions).toHaveBeenCalledTimes(1);
    expect(onQuestions).toHaveBeenCalledWith([]);

    // Stream should complete normally
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  // ==========================================================================
  // Test 16 (Task Group 5): Error after partial content - state resets correctly
  // Tests that streaming state resets even after content was accumulated
  // ==========================================================================
  it('resets isStreaming to false after error with partial content accumulated', async () => {
    // Given - Stream with some content followed by an error-inducing event
    const chunks = [
      'data: {"type":"content","delta":"Partial content 1"}\n\n',
      'data: {"type":"content","delta":" and more content"}\n\n',
      'data: {invalid-json-causes-error}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
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

    // Then - error should be called and state should reset
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    // Verify partial content was received before error
    expect(onContent).toHaveBeenCalledWith('Partial content 1');
    expect(onContent).toHaveBeenCalledWith(' and more content');

    // Verify state resets correctly
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).not.toBeNull();

    // Done should NOT have been called (stream errored)
    expect(onDone).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 17 (Task Group 5): Multiple questions events in one stream
  // Tests replacement behavior when multiple questions events are received
  // ==========================================================================
  it('invokes onQuestions for each questions event (multiple questions events)', async () => {
    // Given - Stream contains multiple questions events
    const chunks = [
      'data: {"type":"content","delta":"First batch of questions..."}\n\n',
      'data: {"type":"questions","questions":[{"id":"q1","question":"First question?"}]}\n\n',
      'data: {"type":"content","delta":"Updated questions..."}\n\n',
      'data: {"type":"questions","questions":[{"id":"q2","question":"New question?"},{"id":"q3","question":"Another question?"}]}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    mockFetch.mockResolvedValue(createMockResponse(chunks));

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onQuestions = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When
    await act(async () => {
      result.current.startStream({
        company: 'TestCo',
        project: 'TestProject',
        message: '/shape-spec test',
        sessionMode: 'new',
        onContent,
        onDone,
        onError,
        onQuestions,
      });
    });

    // Then
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });

    // Both questions events should have invoked the callback
    expect(onQuestions).toHaveBeenCalledTimes(2);
    expect(onQuestions).toHaveBeenNthCalledWith(1, [
      { id: 'q1', question: 'First question?' },
    ]);
    expect(onQuestions).toHaveBeenNthCalledWith(2, [
      { id: 'q2', question: 'New question?' },
      { id: 'q3', question: 'Another question?' },
    ]);

    expect(onError).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 18 (Task Group 5): State consistency after abort during active stream
  // Tests that abort correctly resets state even during content reception
  // ==========================================================================
  it('resets state correctly when abort is called during active streaming', async () => {
    // Given - a stream that produces content slowly
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const slowStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        // Enqueue initial content
        controller.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"Starting..."}\n\n'));
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: slowStream,
      headers: new Headers(),
    } as Response);

    const onContent = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() => useShapeSpecStream());

    // When - start stream and verify it's active
    act(() => {
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

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    // Abort the stream
    act(() => {
      result.current.abort();
    });

    // Then - state should be reset
    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    // Error should be null (abort is not an error)
    expect(result.current.error).toBeNull();

    // Clean up
    if (streamController) {
      try {
        (streamController as ReadableStreamDefaultController<Uint8Array>).close();
      } catch {
        // Ignore
      }
    }
  });
});
