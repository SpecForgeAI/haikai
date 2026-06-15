/**
 * Tech Hints Resolve Relay Route
 *
 * Provides a thin pass-through from the frontend to the discovery-service
 * save-time tech-hints classification endpoint. Structurally mirrors the
 * pattern established by `discoveryGapFill.ts` — no prompt composition or
 * LLM calls happen here; this route only forwards the request body and
 * relays the response (including `reason` tags) back to the caller.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 3
 *
 * Endpoint:
 *   POST /tech-hints/resolve
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/tech-hints/resolve
 *
 * Request body (validated here):
 *   { freeText: string, repoLocation?: string, repoSubfolder?: string }
 *
 * Response: passed through unchanged from discovery-service.
 *
 * Error translation (mirrors discoveryGapFill.ts):
 *   - 400 on missing/empty `freeText`.
 *   - 502 on downstream unreachable (network error).
 *   - 504 on downstream timeout.
 *   - otherwise 4xx/5xx bodies are passed through verbatim so `reason`
 *     tags from the discovery-service resolver (clone_timeout,
 *     llm_timeout, llm_malformed, network_error) reach the UI intact.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';

export const techHintsResolveRouter = Router();

/**
 * POST /tech-hints/resolve
 */
techHintsResolveRouter.post('/tech-hints/resolve', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const startTime = Date.now();

  const body = req.body as {
    freeText?: unknown;
    repoLocation?: unknown;
    repoSubfolder?: unknown;
  };

  // Validation: freeText is required non-empty string.
  if (typeof body?.freeText !== 'string' || body.freeText.trim().length === 0) {
    return res.status(400).json({
      error: 'freeText is required and must be a non-empty string',
    });
  }

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('Processing tech-hints resolve proxy request', {
      requestId,
      hasRepo: typeof body.repoLocation === 'string' && (body.repoLocation as string).length > 0,
    });

    const forwardedBody: Record<string, unknown> = {
      freeText: body.freeText,
    };
    if (typeof body.repoLocation === 'string') forwardedBody.repoLocation = body.repoLocation;
    if (typeof body.repoSubfolder === 'string') forwardedBody.repoSubfolder = body.repoSubfolder;

    try {
      const response = await fetch(
        `${discoveryServiceBaseUrl}/discovery/tech-hints/resolve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(forwardedBody),
        },
      );

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Tech-hints resolve proxy request completed', {
        requestId,
        status: response.status,
        success: response.ok,
        totalDurationMs: Date.now() - startTime,
      });

      // Pass status + body through verbatim so `reason` tags survive.
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Tech-hints resolve proxy request failed', {
        requestId,
        error: errorMessage,
      });

      // Timeout vs unreachable: use 504 on timeout-shaped errors, 502 otherwise.
      const isTimeout = /timeout/i.test(errorMessage) || (fetchError as any)?.name === 'AbortError';
      if (isTimeout) {
        return res.status(504).json({
          error: 'Discovery service timed out',
          reason: 'clone_timeout',
        });
      }
      return res.status(502).json({
        error: 'Discovery service unavailable',
      });
    }
  } catch (error) {
    logger.error('Tech-hints resolve proxy error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});
