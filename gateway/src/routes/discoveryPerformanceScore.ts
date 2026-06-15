/**
 * Discovery Performance Scoring — gateway LLM relay.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 2.
 *
 * Mirrors the `discoveryGapFill.ts` pattern: takes a fully-composed
 * prompt from `discovery-service/services/performancePostRun.ts`,
 * forwards it to OpenAI in JSON mode, returns the raw content. No
 * tool definitions; no system-prompt injection (the caller passes a
 * complete system prompt including the rubric).
 *
 * Endpoint: POST /api/v1/discovery/performance/score
 * Mounted at /api/v1/discovery in server.ts.
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { type OpenAIMessage } from '../services/openaiClient';
import { logger } from '../services/logger';

interface PerformanceScoreRequest {
  runId: unknown;
  systemPrompt: unknown;
  userPrompt: unknown;
}

interface PerformanceScoreResponse {
  content: string;
  usage?: unknown;
}

export const discoveryPerformanceScoreRouter = Router();

discoveryPerformanceScoreRouter.post(
  '/performance/score',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const startTime = Date.now();

    const body = req.body as PerformanceScoreRequest;

    if (typeof body?.runId !== 'string' || (body.runId as string).length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'runId is required and must be a non-empty string' },
      });
    }
    if (typeof body?.systemPrompt !== 'string' || (body.systemPrompt as string).length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'systemPrompt is required and must be a non-empty string' },
      });
    }
    if (typeof body?.userPrompt !== 'string' || (body.userPrompt as string).length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'userPrompt is required and must be a non-empty string' },
      });
    }

    logger.info('[PerfScore] Received discovery performance scoring request', {
      requestId,
      runId: body.runId,
      systemPromptChars: (body.systemPrompt as string).length,
      userPromptChars: (body.userPrompt as string).length,
    });

    const messages: OpenAIMessage[] = [
      { role: 'system', content: body.systemPrompt as string },
      { role: 'user', content: body.userPrompt as string },
    ];

    try {
      const llmStart = Date.now();
      const llmResponse = await getLlmClient().sendChatRequest(
        messages,
        requestId,
        `discovery-performance-${body.runId}`,
        {
          jsonMode: true,
          tools: [],
          temperature: 0.2,
          maxTokens: 4000,
        },
      );
      const llmDurationMs = Date.now() - llmStart;

      logger.info('[PerfScore] LLM response received', {
        requestId,
        runId: body.runId,
        llmDurationMs,
        responseContentLength: llmResponse.content?.length || 0,
        usage: llmResponse.usage,
        totalDurationMs: Date.now() - startTime,
      });

      const out: PerformanceScoreResponse = {
        content: llmResponse.content || '',
        usage: llmResponse.usage,
      };
      return res.json(out);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      logger.error('[PerfScore] Endpoint error', {
        requestId,
        runId: body.runId,
        errorName,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        totalDurationMs: Date.now() - startTime,
      });
      // Forward the actual cause in the 500 body so the discovery-service's
      // gatewayClient debug file shows what really went wrong (Azure auth
      // failure, model deployment missing, JSON-mode 400, etc.) instead of
      // a generic "Internal server error" string.
      return res.status(500).json({
        error: {
          code: 500,
          message: `Performance scoring LLM call failed: ${errorMessage}`,
          name: errorName,
        },
      });
    }
  },
);
