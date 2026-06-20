/**
 * Discovery V3 Log-Recipe Relay Route
 *
 * Provides a stateless relay endpoint for the V3 discovery pipeline's runtime
 * log-evidence "recipe induction" stage. The discovery-service streams an
 * uploaded runtime log, assembles a small set of REDACTED sample blocks, and
 * composes a fully-assembled prompt asking the LLM to recognise the log's
 * format and return a STRUCTURED RECIPE (record delimiter + field rules for
 * method/path/headers/body/response) OR "no pattern". It POSTs that prompt
 * here; this route simply forwards it to the shared LLM client and returns
 * the response content unmodified. Deterministic discovery-service code then
 * applies the inferred recipe across the WHOLE file -- the LLM only ever sees
 * the small redacted samples sent in the prompt.
 *
 * Mirrors discoveryGapFill.ts: the gateway is stateless with respect to prompt
 * content; prompt composition (and the mandatory sample redaction) happen
 * upstream in discovery-service. The model is selected gateway-side (latest
 * Claude per gateway config) -- the caller does NOT supply a model id.
 *
 * Spec 2026-06-20: Runtime Log Evidence -- Format-Agnostic Extraction (Task Group 4)
 *
 * Endpoint:
 *   POST /v3/log-recipe
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/v3/log-recipe
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { OpenAIMessage } from '../services/openaiClient';

export const discoveryLogRecipeRouter = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Request shape for V3 log-recipe relay.
 *
 * The discovery-service composes the prompt (which embeds the already-redacted
 * sample blocks from the runtime log) and sends it here fully assembled. runId
 * is required for logging / correlation; filePath is optional correlation
 * metadata identifying the source log file. No model id is accepted -- the
 * model is selected gateway-side.
 */
interface LogRecipeRequest {
  /** Fully-assembled prompt (with embedded redacted sample blocks) composed by discovery-service. */
  prompt: string;
  /** Discovery run ID -- required, used for logging / correlation. */
  runId: string;
  /** Source log file path the recipe targets -- optional, used for logging / correlation only. */
  filePath?: string;
}

/**
 * Response shape returned to discovery-service.
 *
 * Raw LLM text content is returned verbatim. Recipe parsing, held-out
 * validation, and the "no pattern" fallback decision happen downstream in
 * discovery-service.
 */
interface LogRecipeResponse {
  /** Raw LLM response content (expected to be a structured recipe or "no pattern" per prompt contract). */
  content: string;
  /** Token usage information (passthrough from the LLM client). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ============================================================================
// POST /v3/log-recipe
// ============================================================================

/**
 * POST /v3/log-recipe
 *
 * Stateless relay: accepts a caller-composed prompt (carrying redacted runtime
 * log sample blocks), forwards it to the configured LLM client, and returns
 * the response content. The model is selected gateway-side.
 *
 * Request body: { prompt: string, runId: string, filePath?: string }
 * Response body: { content: string, usage?: {...} }
 */
discoveryLogRecipeRouter.post('/v3/log-recipe', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const startTime = Date.now();

  try {
    const body = req.body as LogRecipeRequest;

    // Validate request body (mirrors gap-fill's validation).
    if (!body || typeof body.prompt !== 'string' || body.prompt.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'prompt is required and must be a non-empty string' },
      });
    }

    if (typeof body.runId !== 'string' || body.runId.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'runId is required and must be a non-empty string' },
      });
    }

    const filePath = typeof body.filePath === 'string' ? body.filePath : '';

    logger.info('[LogRecipe] Received V3 log-recipe request', {
      requestId,
      runId: body.runId,
      filePath,
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
      `v3-log-recipe-${body.runId}-${filePath}`,
      // temperature 0 -> deterministic recipe induction: re-running discovery on
      // byte-identical samples yields the same inferred recipe (reproducibility).
      // openaiClient skips this for reasoning models.
      { tools: [], temperature: 0 },
    );
    const llmDurationMs = Date.now() - llmStart;

    logger.info('[LogRecipe] LLM response received', {
      requestId,
      runId: body.runId,
      filePath,
      llmDurationMs,
      responseContentLength: llmResponse.content?.length || 0,
      usage: llmResponse.usage,
      totalDurationMs: Date.now() - startTime,
    });

    const response: LogRecipeResponse = {
      content: llmResponse.content || '',
      usage: llmResponse.usage,
    };

    return res.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[LogRecipe] Endpoint error', {
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
