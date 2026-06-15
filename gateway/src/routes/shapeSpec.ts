/**
 * Shape-Spec Proxy Route (SSE Streaming)
 *
 * Provides endpoint for proxying Shape-Spec streaming requests to the
 * upstream Shape-Spec service (localhost:8000) with centralized Bearer authentication.
 *
 * Spec 2026-01-30: Centralize Bearer Authentication for Gateway to Shape-Spec Service Requests
 * Task Group 3: Shape-Spec Proxy Route (SSE Streaming)
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring - Use implementationLlmProxyClient
 *
 * This route:
 * - Proxies POST /stream requests to localhost:8000/api/v2/shape-spec/stream
 * - Uses requestStream from implementationLlmProxyClient for automatic Bearer token injection
 * - Transparently streams SSE responses without buffering
 * - Returns opaque error responses (no auth details exposed)
 * - Aborts upstream requests when client disconnects (Task Group 2)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { requestStream } from '../services/implementationLlmProxyClient';
import { logger } from '../services/logger';

/** Path to the upstream Shape-Spec streaming endpoint */
const SHAPE_SPEC_STREAM_PATH = '/api/v2/shape-spec/stream';

/**
 * Request body for Shape-Spec streaming endpoint.
 */
export interface ShapeSpecStreamRequest {
  /** Organisation/company name */
  company: string;
  /** Project name */
  project: string;
  /** User message to process */
  message: string;
  /** Optional session mode (e.g., 'new', 'continue') */
  session_mode?: string;
}

// ============================================================================
// Router
// ============================================================================

export const shapeSpecRouter = Router();

/**
 * POST /stream - Proxy streaming requests to Shape-Spec service
 *
 * Spec 2026-01-30: Centralize Bearer Authentication for Gateway to Shape-Spec Service Requests
 * Task Group 3: Shape-Spec Proxy Route (SSE Streaming)
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring - Use implementationLlmProxyClient
 *
 * This endpoint:
 * - Accepts request body with company, project, message, and optional session_mode
 * - Proxies to localhost:8000/api/v2/shape-spec/stream with Bearer auth via implementationLlmProxyClient
 * - Sets SSE headers and transparently streams the response
 * - Returns opaque errors on failures (no auth details exposed)
 * - Aborts upstream request when client disconnects (Task Group 2)
 */
shapeSpecRouter.post(
  '/stream',
  async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    const body = req.body as ShapeSpecStreamRequest;

    logger.info('Processing Shape-Spec stream request', {
      requestId,
      company: body.company,
      project: body.project,
      hasMessage: !!body.message,
      sessionMode: body.session_mode,
    });

    // DEBUG: Log the full request body arriving at Gateway for comparison
    console.log('[ShapeSpec Gateway] === INCOMING REQUEST ===');
    console.log('[ShapeSpec Gateway] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[ShapeSpec Gateway] Body:', JSON.stringify(body, null, 2));
    console.log('[ShapeSpec Gateway] Body keys:', Object.keys(body));
    console.log('[ShapeSpec Gateway] message length:', body.message?.length ?? 'N/A');
    console.log('[ShapeSpec Gateway] message first 200 chars:', body.message?.slice(0, 200) ?? 'N/A');
    console.log('[ShapeSpec Gateway] session_mode:', body.session_mode ?? '(not set)');
    console.log('[ShapeSpec Gateway] ==============================');

    // Task Group 2: Create AbortController before making requestStream call
    // This allows us to cancel the upstream request if the client disconnects
    const abortController = new AbortController();

    // Track client disconnect and abort upstream request
    let isClientConnected = true;
    req.on('close', () => {
      isClientConnected = false;
      // Task Group 2: Abort upstream request when client disconnects
      // This prevents orphaned upstream requests when users navigate away
      abortController.abort();
      logger.debug('Client disconnected from Shape-Spec stream, aborting upstream request', {
        requestId,
      });
    });

    try {
      // Build the request body to forward to upstream
      const upstreamBody: Record<string, string> = {
        company: body.company,
        project: body.project,
        message: body.message,
      };

      // Only include session_mode if provided
      if (body.session_mode !== undefined) {
        upstreamBody.session_mode = body.session_mode;
      }

      // Make the upstream request using requestStream
      // Spec 2026-02-01: Use implementationLlmProxyClient for unified auth
      // This will automatically inject the Bearer token
      // Task Group 2: Pass AbortController.signal for request cancellation
      const upstreamResponse = await requestStream(SHAPE_SPEC_STREAM_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: upstreamBody,
        signal: abortController.signal,
      });

      // Handle upstream authentication failures (401/403)
      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        logger.error('Upstream authentication failed', {
          requestId,
          status: upstreamResponse.status,
        });
        return res.status(502).json({ error: 'Upstream authentication failed' });
      }

      // Handle other non-success responses
      if (!upstreamResponse.ok) {
        logger.error('Upstream returned error status', {
          requestId,
          status: upstreamResponse.status,
        });
        return res.status(502).json({ error: 'Upstream authentication failed' });
      }

      // Set SSE headers for successful streaming response
      // Follow pattern from gateway/src/routes/chat.ts (lines 845-848)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Pipe upstream response body directly to client response
      // Do NOT buffer the stream - transparent SSE proxy
      const upstreamBodyStream = upstreamResponse.body;

      if (upstreamBodyStream) {
        // Convert Web ReadableStream to Node.js Readable stream
        // Node.js 18+ has built-in support for this conversion
        const nodeStream = upstreamBodyStream as unknown as Readable;

        // DEBUG: Track which stream path is used and log all SSE events passing through
        const decoder = new TextDecoder();
        let gatewayChunkIndex = 0;

        if (typeof nodeStream.pipe === 'function') {
          // Already a Node.js stream (e.g., from node-fetch or test mocks)
          console.log('[ShapeSpec Gateway] Using Node.js pipe() stream path');

          // Intercept data for logging before piping
          nodeStream.on('data', (chunk: Buffer) => {
            gatewayChunkIndex++;
            const text = chunk.toString('utf-8');
            console.log(`[ShapeSpec Gateway] PIPE chunk #${gatewayChunkIndex} (${chunk.length} bytes):`, text.slice(0, 300));
          });

          nodeStream.pipe(res);

          nodeStream.on('error', (err) => {
            logger.error('Upstream stream error', {
              requestId,
              error: err.message,
            });
            if (isClientConnected && !res.headersSent) {
              res.status(503).json({ error: 'Shape-Spec service unavailable' });
            } else if (isClientConnected) {
              res.end();
            }
          });

          nodeStream.on('end', () => {
            console.log(`[ShapeSpec Gateway] PIPE stream ended after ${gatewayChunkIndex} chunks`);
            logger.debug('Shape-Spec stream completed', { requestId });
          });
        } else {
          // Web ReadableStream - convert to Node.js stream
          console.log('[ShapeSpec Gateway] Using Web ReadableStream pump() path');
          const reader = (upstreamBodyStream as ReadableStream<Uint8Array>).getReader();

          const pump = async (): Promise<void> => {
            try {
              while (isClientConnected) {
                const { done, value } = await reader.read();
                if (done) {
                  console.log(`[ShapeSpec Gateway] PUMP stream ended after ${gatewayChunkIndex} chunks`);
                  logger.debug('Shape-Spec stream completed', { requestId });
                  res.end();
                  break;
                }
                if (value && isClientConnected) {
                  gatewayChunkIndex++;
                  const text = decoder.decode(value, { stream: true });
                  console.log(`[ShapeSpec Gateway] PUMP chunk #${gatewayChunkIndex} (${value.byteLength} bytes):`, text.slice(0, 300));
                  res.write(value);
                }
              }
            } catch (err) {
              logger.error('Upstream stream read error', {
                requestId,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
              if (isClientConnected && !res.headersSent) {
                res.status(503).json({ error: 'Shape-Spec service unavailable' });
              } else if (isClientConnected) {
                res.end();
              }
            }
          };

          pump();
        }
      } else {
        // No body - end response
        res.end();
      }

      logger.info('Shape-Spec stream proxy started', {
        requestId,
        company: body.company,
        project: body.project,
      });
    } catch (error) {
      // Handle errors based on type
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'Unknown';

      // Task Group 2: Handle abort errors from client disconnect
      if (errorName === 'AbortError') {
        logger.info('Upstream request aborted due to client disconnect', {
          requestId,
          error: errorMessage,
        });
        // Don't send response - client is already disconnected
        if (!res.headersSent && isClientConnected) {
          return res.status(503).json({ error: 'Shape-Spec service unavailable' });
        }
        return;
      }

      // Check if this is a token configuration error
      // Spec 2026-02-01: Updated error message to match new client
      if (errorMessage.includes('Implementation LLM Service Bearer token is not configured')) {
        logger.error('Shape-Spec stream failed: token not configured', {
          requestId,
        });
        // Return generic 500 - do NOT expose token absence to frontend
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Network errors, timeouts, and other failures
      logger.error('Shape-Spec stream failed', {
        requestId,
        error: errorMessage,
        errorName,
      });

      // Return 503 for service unavailability (network, timeout, etc.)
      return res.status(503).json({ error: 'Shape-Spec service unavailable' });
    }
  }
);
