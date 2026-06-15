/**
 * Implementation LLM Proxy Client
 *
 * Unified HTTP client for communicating with the Implementation LLM Proxy service (localhost:8000).
 * Auto-injects Bearer authentication for ALL requests to this upstream service.
 * Replaces shapeSpecUpstreamClient.ts and standardsServiceClient.ts.
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 2: New Client Creation
 *
 * All calls to standards, orchestrations, and shape-spec endpoints use this client.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for the request() function.
 */
export interface RequestOptions {
  /** HTTP method (GET, POST, etc.). Default: GET */
  method?: string;
  /** Additional headers to include in the request */
  headers?: Record<string, string>;
  /** Request body (will be JSON-stringified if not already a string) */
  body?: unknown;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/**
 * Options for the requestStream() function.
 * Similar to RequestOptions but specifically for SSE streaming responses.
 */
export interface StreamRequestOptions {
  /** HTTP method (GET, POST, etc.). Default: POST */
  method?: string;
  /** Additional headers to include in the request */
  headers?: Record<string, string>;
  /** Request body (will be JSON-stringified if not already a string) */
  body?: unknown;
  /** AbortSignal for request cancellation (important for streaming) */
  signal?: AbortSignal;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalizes headers from various formats to a plain object.
 * Handles Headers instance, array format, and plain object format.
 *
 * @param headers - Headers in any supported format
 * @returns Plain object with header key-value pairs
 */
function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  // Plain object format - just copy
  return { ...headers };
}

// ============================================================================
// Core Request Function
// ============================================================================

/**
 * Makes an authenticated HTTP request to the Implementation LLM Proxy service.
 *
 * This function automatically injects the Bearer token configured in
 * IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN for all requests. It uses the base URL from
 * IMPLEMENTATION_LLM_SERVICE_BASE_URL.
 *
 * Fail-fast behavior: Throws Error immediately if token or base URL is missing.
 * The Authorization header ALWAYS overrides any caller-provided value (security pattern).
 *
 * @param path - The API path to call (e.g., '/api/v1/orchestrations')
 * @param options - Request options including method, headers, body, timeoutMs, signal
 * @returns Promise resolving to the fetch Response
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN is not configured
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BASE_URL is not configured
 * @throws DOMException with name 'AbortError' if the request is aborted via signal
 *
 * @example
 * ```typescript
 * // Simple GET request
 * const response = await request('/api/v1/health', { method: 'GET' });
 *
 * // POST request with body
 * const response = await request('/api/v1/orchestrations', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: { company: 'Global', project: 'MyProject' },
 * });
 *
 * // Request with AbortSignal for cancellation
 * const abortController = new AbortController();
 * const response = await request('/api/v1/shape-spec/stream', {
 *   method: 'POST',
 *   body: { company: 'Global', project: 'MyProject' },
 *   signal: abortController.signal,
 * });
 * // To cancel the request: abortController.abort();
 * ```
 */
export async function request(
  path: string,
  options: RequestOptions = {}
): Promise<Response> {
  const config = getConfig();

  // Fail-fast: Check token presence at the START before any upstream call
  const token = config.implementationLlmServiceBearerToken;
  if (!token) {
    const error = new Error('Implementation LLM Service Bearer token is not configured');
    logger.error('Implementation LLM Proxy request failed: token not configured', {
      path,
      error: error.message,
    });
    throw error;
  }

  // Fail-fast: Check base URL presence
  const baseUrl = config.implementationLlmServiceBaseUrl;
  if (!baseUrl) {
    const error = new Error('Implementation LLM Service base URL is not configured');
    logger.error('Implementation LLM Proxy request failed: base URL not configured', {
      path,
      error: error.message,
    });
    throw error;
  }

  // Construct full URL from config base URL + path
  const url = `${baseUrl}${path}`;

  // Normalize caller-provided headers to a plain object
  const callerHeaders = normalizeHeaders(options.headers);

  // Inject Authorization header - ALWAYS override any caller-provided Authorization
  // This ensures the configured token is always used and cannot be bypassed
  const mergedHeaders: Record<string, string> = {
    ...callerHeaders,
    'Authorization': `Bearer ${token}`,
  };

  // Prepare body - JSON-stringify if needed
  let bodyString: string | undefined;
  if (options.body !== undefined) {
    bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  // Build the final request options
  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers: mergedHeaders,
    body: bodyString,
    signal: options.signal,
  };

  // Debug logging - do NOT log sensitive data (token value, request body contents)
  logger.debug('Implementation LLM Proxy upstream request', {
    url,
    method: fetchOptions.method,
    hasBody: !!fetchOptions.body,
    hasSignal: !!fetchOptions.signal,
  });

  // Make the upstream request
  return fetch(url, fetchOptions);
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/**
 * Makes an authenticated POST request with JSON body to the Implementation LLM Proxy service.
 *
 * Convenience helper that sets Content-Type and Accept headers to application/json,
 * and JSON-stringifies the body.
 *
 * @param path - The API path to call (e.g., '/api/v1/standards/global/generate')
 * @param body - Request body object (will be JSON-stringified)
 * @returns Promise resolving to the fetch Response
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN is not configured
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BASE_URL is not configured
 *
 * @example
 * ```typescript
 * const response = await postJson('/api/v1/standards/global/generate', {
 *   company: 'TestCorp',
 *   sources: ['doc1.md'],
 *   technical_documents: { ... }
 * });
 * ```
 */
export async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
  });
}

/**
 * Makes an authenticated GET request expecting JSON response from the Implementation LLM Proxy service.
 *
 * Convenience helper that sets Accept header to application/json.
 *
 * @param path - The API path to call (e.g., '/api/v1/health')
 * @returns Promise resolving to the fetch Response
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN is not configured
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BASE_URL is not configured
 *
 * @example
 * ```typescript
 * const response = await getJson('/api/v1/health');
 * const data = await response.json();
 * ```
 */
export async function getJson(path: string): Promise<Response> {
  return request(path, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });
}

// ============================================================================
// Streaming Support
// ============================================================================

/**
 * Makes an authenticated request for SSE streaming responses to the Implementation LLM Proxy service.
 *
 * This function is specifically designed for Server-Sent Events (SSE) streaming.
 * It does NOT set Accept: application/json header (SSE uses text/event-stream).
 * It preserves AbortSignal passthrough for client disconnect cancellation.
 *
 * @param path - The API path to call (e.g., '/api/v1/shape-spec/stream')
 * @param options - Request options including method, headers, body, signal
 * @returns Promise resolving to the fetch Response (body is a ReadableStream)
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN is not configured
 * @throws Error if IMPLEMENTATION_LLM_SERVICE_BASE_URL is not configured
 * @throws DOMException with name 'AbortError' if the request is aborted via signal
 *
 * @example
 * ```typescript
 * const abortController = new AbortController();
 * const response = await requestStream('/api/v1/shape-spec/stream', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: { company: 'Global', project: 'MyProject', message: 'Hello' },
 *   signal: abortController.signal,
 * });
 *
 * // Handle SSE stream
 * const reader = response.body.getReader();
 * // ... read chunks ...
 *
 * // To cancel: abortController.abort();
 * ```
 */
export async function requestStream(
  path: string,
  options: StreamRequestOptions = {}
): Promise<Response> {
  // For streaming, we do NOT set Accept: application/json
  // SSE responses use text/event-stream content type
  // We only set Content-Type for POST requests with body
  const headers: Record<string, string> = options.headers ? { ...options.headers } : {};

  // If body is provided and Content-Type is not set, default to application/json
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return request(path, {
    method: options.method || 'POST',
    headers,
    body: options.body,
    signal: options.signal,
  });
}
