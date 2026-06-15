/**
 * Discovery V3 Gap-Fill Relay Route
 *
 * Provides a stateless relay endpoint for the V3 discovery pipeline's LLM
 * gap-fill stage. The discovery-service composes the fully-assembled prompt
 * from its layered markdown files (base + language + framework + dynamic
 * injection) and POSTs it here; this route simply forwards the prompt to
 * the shared LLM client and returns the response content unmodified.
 *
 * Unlike the V2 /api/v1/discovery/analyze-files route, this endpoint does
 * NOT load gateway/src/config/prompts/discovery.file-analysis.prompt.md.
 * Prompt composition has been moved to discovery-service; the gateway is
 * stateless with respect to prompt content for V3.
 *
 * Spec 2026-04-19: V3 Layered Prompt System (Task Group 3)
 *
 * Endpoint:
 *   POST /v3/gap-fill
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/v3/gap-fill
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { OpenAIMessage } from '../services/openaiClient';

export const discoveryGapFillRouter = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Request shape for V3 gap-fill relay.
 *
 * The discovery-service composes the prompt from layered markdown templates
 * and sends it here fully assembled. filePath and runId are carried for
 * logging/correlation only.
 */
interface GapFillRequest {
  /** Fully-assembled prompt composed by discovery-service. */
  prompt: string;
  /** File path the prompt targets -- used for logging / correlation only. */
  filePath: string;
  /** Discovery run ID -- used for logging / correlation only. */
  runId: string;
}

/**
 * Response shape returned to discovery-service.
 *
 * Raw LLM text content is returned verbatim. JSON-schema validation and
 * candidate parsing happen downstream in discovery-service.
 */
interface GapFillResponse {
  /** Raw LLM response content (expected to be a JSON array per prompt contract). */
  content: string;
  /** Token usage information (passthrough from the LLM client). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ============================================================================
// POST /v3/gap-fill
// ============================================================================

/**
 * POST /v3/gap-fill
 *
 * Stateless relay: accepts a caller-composed prompt, forwards it to the
 * configured LLM client, returns the response content.
 *
 * Request body: { prompt: string, filePath: string, runId: string }
 * Response body: { content: string, usage?: {...} }
 */
discoveryGapFillRouter.post('/v3/gap-fill', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const startTime = Date.now();

  try {
    const body = req.body as GapFillRequest;

    // Validate request body
    if (!body || typeof body.prompt !== 'string' || body.prompt.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'prompt is required and must be a non-empty string' },
      });
    }

    if (typeof body.filePath !== 'string' || body.filePath.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'filePath is required and must be a non-empty string' },
      });
    }

    if (typeof body.runId !== 'string' || body.runId.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'runId is required and must be a non-empty string' },
      });
    }

    logger.info('[GapFill] Received V3 gap-fill request', {
      requestId,
      runId: body.runId,
      filePath: body.filePath,
      promptLengthChars: body.prompt.length,
      estimatedTokens: Math.ceil(body.prompt.length / 4),
    });

    // Build a single user message containing the caller-supplied prompt.
    // No system message is injected here -- the caller-composed prompt
    // already contains any role / system context from its base layer.
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: body.prompt,
      },
    ];

    const llmClient = getLlmClient();
    const llmStart = Date.now();
    const llmResponse = await llmClient.sendChatRequest(
      messages,
      requestId,
      `v3-gap-fill-${body.runId}-${body.filePath}`,
      // temperature 0 → deterministic extraction: re-running discovery on
      // byte-identical source yields the same candidate model (oracle
      // reproducibility). openaiClient skips this for reasoning models.
      { tools: [], temperature: 0 },
    );
    const llmDurationMs = Date.now() - llmStart;

    logger.info('[GapFill] LLM response received', {
      requestId,
      runId: body.runId,
      filePath: body.filePath,
      llmDurationMs,
      responseContentLength: llmResponse.content?.length || 0,
      usage: llmResponse.usage,
      totalDurationMs: Date.now() - startTime,
    });

    const response: GapFillResponse = {
      content: llmResponse.content || '',
      usage: llmResponse.usage,
    };

    return res.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[GapFill] Endpoint error', {
      requestId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalDurationMs: Date.now() - startTime,
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});
