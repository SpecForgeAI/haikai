/**
 * Shape-Spec Stream API Client
 *
 * API client for the Shape-Spec streaming endpoint.
 * Requests are routed through the Gateway service, which handles
 * Bearer authentication and proxies to the Shape-Spec service.
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 3: Shape-Spec Stream API Integration
 *
 * Spec 2026-01-30: Centralize Bearer Authentication
 * Task Group 5: Frontend calls Gateway instead of direct Shape-Spec service
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task 2.4: Apply normalizeIdentifier to company/project before API calls
 */

import { normalizeIdentifier } from '../utils/normalizeIdentifier';

// ============================================================================
// Constants
// ============================================================================

/**
 * Base URL for the Gateway service.
 * Defaults to empty string (same origin) for Vite proxy in development.
 * The Gateway handles Bearer authentication and proxies to Shape-Spec service.
 *
 * Spec 2026-01-30: Centralize Bearer Authentication
 * Task 5.1: Route through Gateway instead of direct localhost:8000
 */
const SHAPE_SPEC_BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Endpoint path for Shape-Spec streaming via Gateway.
 * The Gateway proxies this to the Shape-Spec service with Bearer auth.
 */
const SHAPE_SPEC_STREAM_PATH = '/api/v2/shape-spec/stream';

// ============================================================================
// TypeScript Interfaces
// ============================================================================

/**
 * Request body for starting a Shape-Spec stream.
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task 3.2: Define ShapeSpecStreamRequest interface
 *
 * Updated in Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract
 * Task Group 2: Make session_mode optional for continuation calls
 */
export interface ShapeSpecStreamRequest {
  /** Organisation name (not ID) */
  company: string;
  /** Project name */
  project: string;
  /** Message content prefixed with /shape-spec */
  message: string;
  /**
   * Session mode - 'new' for new sessions, 'resume' for continuation calls.
   */
  session_mode?: 'new' | 'resume';
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Starts a Shape-Spec stream by calling the Gateway proxy endpoint.
 *
 * The Gateway handles Bearer authentication and proxies to the Shape-Spec
 * service. No Authorization headers are sent from the frontend.
 *
 * Returns the raw Response object for ReadableStream access by the calling hook.
 * The response is an SSE stream, not standard JSON.
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task 3.2, 3.3: Create startShapeSpecStream function
 *
 * Spec 2026-01-30: Centralize Bearer Authentication
 * Task 5.3: No Authorization headers sent from frontend
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task 2.4: Apply normalizeIdentifier to company and project before building request body
 *
 * @param request - The shape-spec stream request
 * @returns Promise resolving to the raw Response object for stream handling
 * @throws Error if the HTTP response is not OK (network/server errors)
 *
 * @example
 * ```ts
 * // New session:
 * const response = await startShapeSpecStream({
 *   company: 'MyCompany',
 *   project: 'MyProject',
 *   message: '/shape-spec Feature description...',
 *   session_mode: 'new',
 * });
 *
 * // Continuation (omit session_mode):
 * const response = await startShapeSpecStream({
 *   company: 'MyCompany',
 *   project: 'MyProject',
 *   message: 'Answers to questions...',
 * });
 *
 * // Handle the SSE stream
 * const reader = response.body?.getReader();
 * ```
 */
export async function startShapeSpecStream(
  request: ShapeSpecStreamRequest
): Promise<Response> {
  const url = `${SHAPE_SPEC_BASE_URL}${SHAPE_SPEC_STREAM_PATH}`;

  // Spec 2026-01-30: Normalize company and project identifiers before building request body
  const normalizedCompany = normalizeIdentifier(request.company);
  const normalizedProject = normalizeIdentifier(request.project);

  // Build request body with normalized identifiers
  // Only include session_mode if it is defined
  // This ensures continuation calls omit the field entirely (not null/undefined)
  const body: Record<string, string> = {
    company: normalizedCompany,
    project: normalizedProject,
    message: request.message,
  };

  if (request.session_mode !== undefined) {
    body.session_mode = request.session_mode;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Shape-spec stream request failed: ${response.status}`);
  }

  return response;
}

/**
 * Get the configured Shape-Spec base URL.
 * Useful for testing and debugging.
 *
 * Note: This now returns the Gateway base URL, as Shape-Spec
 * requests are routed through the Gateway service.
 *
 * @returns The base URL for the Gateway (Shape-Spec proxy endpoint)
 */
export function getShapeSpecBaseUrl(): string {
  return SHAPE_SPEC_BASE_URL;
}
