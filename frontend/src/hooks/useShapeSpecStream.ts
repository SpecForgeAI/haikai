/**
 * useShapeSpecStream Hook
 *
 * Custom hook for consuming Server-Sent Events (SSE) from the Shape-Spec
 * streaming endpoint. Uses fetch API with ReadableStream for POST-based
 * SSE consumption.
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 1: SSE Stream Utility Hook
 *
 * Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop
 * Task Group 1: Extend useShapeSpecStream Hook for New Event Types
 *
 * Spec 2026-01-30: Route Traffic Through Gateway
 * Task Group 4: Update useShapeSpecStream.ts to Use Gateway
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task 2.3: Apply normalizeIdentifier to company/project before building request body
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { normalizeIdentifier } from '../utils/normalizeIdentifier';

// ============================================================================
// TypeScript Interfaces for SSE Event Types
// ============================================================================

/**
 * Event emitted when a skill is invoked by the Claude Code proxy.
 * This event is IGNORED (no UI impact).
 */
export interface SkillInvokedEvent {
  type: 'skill_invoked';
  skill: string;
}

/**
 * Event containing content delta to append to the in-progress message.
 */
export interface ContentEvent {
  type: 'content';
  delta: string;
}

/**
 * Event indicating the stream is complete.
 */
export interface DoneEvent {
  type: 'done';
}

/**
 * Event containing questions from the Software Architect.
 * Each question has an id and question text.
 */
export interface QuestionsEvent {
  type: 'questions';
  questions: Array<{ id: string; question: string }>;
}

/**
 * Event containing the folder name for the implementation.
 */
export interface FolderEvent {
  type: 'folder';
  folder: string;
}

/**
 * Event containing the session ID for the shape-spec session.
 * Emitted during the first stream response; used to resume sessions
 * and to associate orchestration jobs with their originating session.
 */
export interface SessionEvent {
  type: 'session';
  session_id: string;
}

/**
 * Union type for all SSE event types from the Shape-Spec stream.
 */
export type ShapeSpecStreamEvent =
  | SkillInvokedEvent
  | ContentEvent
  | DoneEvent
  | QuestionsEvent
  | FolderEvent
  | SessionEvent;

// ============================================================================
// Stream Parameters and Callbacks
// ============================================================================

/**
 * Parameters for starting a Shape-Spec stream.
 */
export interface ShapeSpecStreamParams {
  /** Organisation name (not ID) */
  company: string;
  /** Project name */
  project: string;
  /** Message content prefixed with /shape-spec */
  message: string;
  /** Session mode - 'new' for new sessions, 'resume' for continuation */
  sessionMode?: 'new' | 'resume';
  /** Callback invoked for each content delta */
  onContent: (delta: string) => void;
  /** Callback invoked when stream completes */
  onDone: () => void;
  /** Callback invoked on error */
  onError: (message: string) => void;
  /** Callback invoked when questions are received */
  onQuestions?: (questions: Array<{ id: string; question: string }>) => void;
  /** Callback invoked when folder is received */
  onFolder?: (folder: string) => void;
  /** Callback invoked when session ID is received */
  onSession?: (sessionId: string) => void;
}

/**
 * Return type for useShapeSpecStream hook.
 */
export interface UseShapeSpecStreamReturn {
  /** Start streaming from the Shape-Spec endpoint */
  startStream: (params: ShapeSpecStreamParams) => void;
  /** Whether a stream is currently active */
  isStreaming: boolean;
  /** Error message if an error occurred */
  error: string | null;
  /** Abort the current stream */
  abort: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Base URL for the Gateway service.
 * Defaults to empty string (same origin) for Vite proxy in development.
 * The Gateway handles Bearer authentication and proxies to Shape-Spec service.
 *
 * Follows the same pattern as shapeSpecApi.ts for Gateway-relative URLs.
 *
 * Spec 2026-01-30: Route Traffic Through Gateway
 * Task 4.2: Route through Gateway instead of direct Shape-Spec service
 */
const SHAPE_SPEC_BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Endpoint path for Shape-Spec streaming via Gateway.
 * The Gateway proxies this to the Shape-Spec service with Bearer auth.
 */
const SHAPE_SPEC_STREAM_PATH = '/api/v2/shape-spec/stream';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for consuming SSE streams from the Shape-Spec endpoint via Gateway.
 *
 * Uses fetch API with ReadableStream for POST-based SSE consumption
 * (EventSource only supports GET requests).
 *
 * Features:
 * - Routes requests through Gateway (no Authorization header sent)
 * - Normalizes company/project identifiers before sending request
 * - Parses SSE `data:` lines to extract JSON payloads
 * - Routes events based on `type` field
 * - Handles partial line buffering across chunks
 * - Supports stream abortion via AbortController
 * - Cleans up on component unmount
 *
 * Usage:
 * ```tsx
 * const { startStream, isStreaming, error, abort } = useShapeSpecStream();
 *
 * const handleImplement = () => {
 *   startStream({
 *     company: 'MyCompany',
 *     project: 'MyProject',
 *     message: '/shape-spec Feature description...',
 *     sessionMode: 'new',
 *     onContent: (delta) => appendToMessage(delta),
 *     onDone: () => finalizeMessage(),
 *     onError: (msg) => showError(msg),
 *     onQuestions: (questions) => setQuestions(questions),
 *     onFolder: (folder) => setFolder(folder),
 *   });
 * };
 * ```
 */
export function useShapeSpecStream(): UseShapeSpecStreamReturn {
  // State
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup and abortion
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  /**
   * Parse a single SSE line and return the event, or null if not parseable.
   */
  const parseSSELine = useCallback((line: string): ShapeSpecStreamEvent | null => {
    // Skip empty lines (SSE delimiter)
    if (!line.trim()) {
      return null;
    }

    // Only process lines starting with 'data:'
    if (!line.startsWith('data:')) {
      return null;
    }

    // Extract JSON payload after 'data:'
    const jsonStr = line.slice(5).trim();
    if (!jsonStr) {
      return null;
    }

    // Parse JSON
    const parsed = JSON.parse(jsonStr);

    // Validate type field exists
    if (!parsed || typeof parsed.type !== 'string') {
      throw new Error('Invalid SSE event: missing type field');
    }

    return parsed as ShapeSpecStreamEvent;
  }, []);

  /**
   * Process an SSE event and invoke appropriate callbacks.
   * Returns true if this event is a `done` event (signal to the caller
   * that the stream should stop after all co-arriving events are handled).
   *
   * IMPORTANT: `done` may arrive in the same chunk as `questions` and
   * `folder`.  We must NOT call onDone here — the caller is responsible
   * for calling onDone AFTER all events in the current batch have been
   * processed so that questions/folder state is set first.
   */
  const processEvent = useCallback((
    event: ShapeSpecStreamEvent,
    callbacks: Pick<ShapeSpecStreamParams, 'onContent' | 'onDone' | 'onQuestions' | 'onFolder' | 'onSession'>
  ): boolean => {
    switch (event.type) {
      case 'skill_invoked':
        // Ignore skill_invoked events - no callback invocation
        return false;

      case 'content':
        callbacks.onContent(event.delta);
        return false;

      case 'done':
        // Signal done but do NOT call onDone yet — the caller handles it
        // after all sibling events in this batch have been processed.
        return true;

      case 'questions':
        if (callbacks.onQuestions) {
          callbacks.onQuestions(event.questions);
        }
        return false;

      case 'folder':
        if (callbacks.onFolder) {
          callbacks.onFolder(event.folder);
        }
        return false;

      case 'session':
        if (callbacks.onSession) {
          callbacks.onSession(event.session_id);
        }
        return false;

      default:
        // Unknown event type - log warning and continue
        console.warn('Unknown SSE event type:', (event as { type: string }).type);
        return false;
    }
  }, []);

  /**
   * Start streaming from the Shape-Spec endpoint via Gateway.
   * No Authorization header is sent - Gateway handles Bearer token injection.
   *
   * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
   * Task 2.3: Apply normalizeIdentifier to company and project before building request body
   */
  const startStream = useCallback(async (params: ShapeSpecStreamParams) => {
    const { company, project, message, sessionMode, onContent, onDone, onError, onQuestions, onFolder, onSession } = params;

    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Reset state
    setError(null);
    setIsStreaming(true);

    try {
      // Spec 2026-01-30: Normalize company and project identifiers before building request body
      const normalizedCompany = normalizeIdentifier(company);
      const normalizedProject = normalizeIdentifier(project);

      // Strip leading "/shape-spec " prefix if present — the endpoint does not expect it
      const cleanedMessage = message.startsWith('/shape-spec ')
        ? message.slice('/shape-spec '.length)
        : message;

      // Build request body with normalized identifiers
      // Only include session_mode when sessionMode is provided
      const requestBody: Record<string, unknown> = {
        company: normalizedCompany,
        project: normalizedProject,
        message: cleanedMessage,
      };

      if (sessionMode !== undefined) {
        requestBody.session_mode = sessionMode;
      }

      // Build request
      const url = `${SHAPE_SPEC_BASE_URL}${SHAPE_SPEC_STREAM_PATH}`;
      const body = JSON.stringify(requestBody);

      // DEBUG: Log the exact request payload for comparison with Postman
      console.log('[useShapeSpecStream] REQUEST URL:', url);
      console.log('[useShapeSpecStream] REQUEST BODY (raw JSON):', body);
      console.log('[useShapeSpecStream] REQUEST BODY (parsed):', requestBody);
      console.log('[useShapeSpecStream] message length:', cleanedMessage.length);
      console.log('[useShapeSpecStream] message first 200 chars:', cleanedMessage.slice(0, 200));

      // Initiate fetch - no Authorization header (Gateway handles auth server-side)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        signal: abortController.signal,
      });

      // DEBUG: Log response status and headers
      console.log('[useShapeSpecStream] RESPONSE status:', response.status);
      console.log('[useShapeSpecStream] RESPONSE headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Read stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunkIndex = 0;
      const allEventsReceived: Array<{ chunk: number; type: string; raw: string }> = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[useShapeSpecStream] STREAM ENDED (reader.done=true)');
          console.log('[useShapeSpecStream] Remaining buffer:', JSON.stringify(buffer));
          // Stream ended — flush any remaining data in the buffer.
          // Same batch-processing logic: handle all events, fire onDone last.
          let calledOnDone = false;
          if (isMountedRef.current && buffer.trim()) {
            let sawDoneInBuffer = false;
            try {
              const lines = buffer.split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  const event = parseSSELine(line);
                  if (event) {
                    allEventsReceived.push({ chunk: chunkIndex, type: event.type, raw: line });
                    console.log('[useShapeSpecStream] BUFFER-FLUSH event:', event.type, line.slice(0, 150));
                    const isDone = processEvent(event, { onContent, onDone, onQuestions, onFolder, onSession });
                    if (isDone) {
                      sawDoneInBuffer = true;
                    }
                  }
                }
              }
            } catch (parseErr) {
              // Ignore parse errors on final buffer
            }
            if (sawDoneInBuffer) {
              onDone();
              calledOnDone = true;
            }
          }
          // If no explicit 'done' event was received but the stream ended
          // (server closed connection), still fire onDone so the component
          // can clean up state (clear respondingPersona, trigger orchestration).
          if (!calledOnDone && isMountedRef.current) {
            console.log('[useShapeSpecStream] No explicit done event — firing onDone on stream close');
            onDone();
          }
          console.log('[useShapeSpecStream] === ALL EVENTS SUMMARY ===');
          console.log('[useShapeSpecStream] Total events:', allEventsReceived.length);
          console.log('[useShapeSpecStream] Event types:', allEventsReceived.map(e => e.type));
          console.log('[useShapeSpecStream] Has questions?', allEventsReceived.some(e => e.type === 'questions'));
          console.log('[useShapeSpecStream] Has folder?', allEventsReceived.some(e => e.type === 'folder'));
          console.log('[useShapeSpecStream] Has done?', allEventsReceived.some(e => e.type === 'done'));
          console.log('[useShapeSpecStream] Has session?', allEventsReceived.some(e => e.type === 'session'));
          console.table(allEventsReceived.map(e => ({ chunk: e.chunk, type: e.type, rawPreview: e.raw.slice(0, 100) })));
          break;
        }

        // Decode chunk and add to buffer
        const chunkText = decoder.decode(value, { stream: true });
        chunkIndex++;
        console.log(`[useShapeSpecStream] CHUNK #${chunkIndex} (${value.byteLength} bytes):`, JSON.stringify(chunkText.slice(0, 300)));
        buffer += chunkText;

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        // Process ALL events in this batch before acting on `done`.
        // The upstream may send `done` before `questions`/`folder` in the
        // same chunk — we must handle questions and folder first.
        let sawDone = false;

        for (const line of lines) {
          try {
            const event = parseSSELine(line);
            if (event) {
              allEventsReceived.push({ chunk: chunkIndex, type: event.type, raw: line });
              console.log(`[useShapeSpecStream] EVENT in chunk #${chunkIndex}:`, event.type, line.slice(0, 150));
              const isDone = processEvent(event, { onContent, onDone, onQuestions, onFolder, onSession });
              if (isDone) {
                sawDone = true;
                // Do NOT break — continue processing remaining lines in
                // this batch so that questions/folder events are handled.
              }
            }
          } catch (parseErr) {
            // JSON parse error
            const errorMessage = parseErr instanceof Error ? parseErr.message : 'JSON parse error';
            console.error('[useShapeSpecStream] PARSE ERROR on line:', line.slice(0, 200), errorMessage);
            if (isMountedRef.current) {
              setError(errorMessage);
              setIsStreaming(false);
            }
            onError(errorMessage);
            reader.cancel();
            return;
          }
        }

        if (sawDone) {
          // All sibling events processed — now fire onDone and stop.
          console.log('[useShapeSpecStream] sawDone=true after chunk #' + chunkIndex + ', calling onDone and cancelling reader');
          console.log('[useShapeSpecStream] === ALL EVENTS SUMMARY ===');
          console.log('[useShapeSpecStream] Total events:', allEventsReceived.length);
          console.log('[useShapeSpecStream] Event types:', allEventsReceived.map(e => e.type));
          console.log('[useShapeSpecStream] Has questions?', allEventsReceived.some(e => e.type === 'questions'));
          console.log('[useShapeSpecStream] Has folder?', allEventsReceived.some(e => e.type === 'folder'));
          console.log('[useShapeSpecStream] Has done?', allEventsReceived.some(e => e.type === 'done'));
          console.log('[useShapeSpecStream] Has session?', allEventsReceived.some(e => e.type === 'session'));
          console.table(allEventsReceived.map(e => ({ chunk: e.chunk, type: e.type, rawPreview: e.raw.slice(0, 100) })));
          onDone();
          reader.cancel();
          if (isMountedRef.current) {
            setIsStreaming(false);
          }
          return;
        }
      }

      // Stream ended naturally
      if (isMountedRef.current) {
        setIsStreaming(false);
      }

    } catch (err) {
      // Check if this was an abort
      if (err instanceof Error && err.name === 'AbortError') {
        // Stream was aborted - just clean up state
        if (isMountedRef.current) {
          setIsStreaming(false);
        }
        return;
      }

      // Network or other error
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (isMountedRef.current) {
        setError(errorMessage);
        setIsStreaming(false);
      }
      onError(errorMessage);
    }
  }, [parseSSELine, processEvent]);

  /**
   * Abort the current stream.
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (isMountedRef.current) {
      setIsStreaming(false);
    }
  }, []);

  return {
    startStream,
    isStreaming,
    error,
    abort,
  };
}

/**
 * Get the configured Shape-Spec base URL.
 * Useful for testing and debugging.
 *
 * Note: This returns the Gateway base URL, as Shape-Spec
 * requests are routed through the Gateway service.
 *
 * Spec 2026-01-30: Route Traffic Through Gateway
 * Task 4.1: Export for testing Gateway URL routing
 *
 * @returns The base URL for the Gateway (Shape-Spec proxy endpoint)
 */
export function getShapeSpecStreamBaseUrl(): string {
  return SHAPE_SPEC_BASE_URL;
}
