/**
 * Discovery V3 Operational-Artifact Summariser Relay Route.
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery (D1), Task Group 1.
 *
 * D1 adds an always-on, pack-agnostic discovery pass in discovery-service that
 * LLM-summarises every unclaimed-but-relevant text file (shell / Autosys JIL /
 * Perl / monitoring XML / CI YAML / proprietary config) into exactly one rich
 * `operational_artifact` Finding. The pass talks to THIS dedicated relay.
 *
 * Like the V3 gap-fill relay (`discoveryGapFill.ts`), the discovery-service
 * composes the FULLY-ASSEMBLED summariser prompt (the strict-JSON contract is
 * defined service-side) and POSTs it here; this route simply forwards the
 * prompt to the shared LLM client and returns the response content unmodified.
 * Keeping a SEPARATE relay from gap-fill gives clean prompt / model / cache
 * separation (Decision 7) -- the gateway is stateless with respect to the
 * summariser prompt content.
 *
 * Endpoint:
 *   POST /v3/operational-artifact
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/v3/operational-artifact
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { OpenAIMessage } from '../services/openaiClient';

export const discoveryOperationalArtifactRouter = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Request shape for the V3 operational-artifact relay.
 *
 * The discovery-service composes the per-file summariser prompt (requesting the
 * strict `detailJson` object) and sends it here fully assembled. `filePath` and
 * `runId` are carried for logging / correlation only.
 */
interface OperationalArtifactRequest {
  /** Fully-assembled summariser prompt composed by discovery-service. */
  prompt: string;
  /** File path the prompt targets -- used for logging / correlation only. */
  filePath: string;
  /** Discovery run ID -- used for logging / correlation only. */
  runId: string;
}

/**
 * Response shape returned to discovery-service.
 *
 * Raw LLM text content is returned verbatim. The strict-JSON parse + validation
 * (and the `operational_artifact` finding shaping) happen downstream in
 * discovery-service.
 */
interface OperationalArtifactResponse {
  /** Raw LLM response content (expected to be the strict summariser JSON object). */
  content: string;
  /** Token usage information (passthrough from the LLM client). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ============================================================================
// POST /v3/operational-artifact
// ============================================================================

/**
 * POST /v3/operational-artifact
 *
 * Stateless relay: accepts a caller-composed prompt, forwards it to the
 * configured LLM client at `temperature: 0` with no tools, returns the
 * response content.
 *
 * Request body: { prompt: string, filePath: string, runId: string }
 * Response body: { content: string, usage?: {...} }
 */
discoveryOperationalArtifactRouter.post(
  '/v3/operational-artifact',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const startTime = Date.now();

    try {
      const body = req.body as OperationalArtifactRequest;

      // Validate request body (same 400 shape as the gap-fill relay).
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

      logger.info('[OperationalArtifact] Received V3 summariser request', {
        requestId,
        runId: body.runId,
        filePath: body.filePath,
        promptLengthChars: body.prompt.length,
        estimatedTokens: Math.ceil(body.prompt.length / 4),
      });

      // Build a single user message containing the caller-supplied prompt. No
      // system message is injected here -- the caller-composed prompt already
      // carries the summariser role + the strict-JSON contract.
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
        `v3-operational-artifact-${body.runId}-${body.filePath}`,
        // temperature 0 -> deterministic summarisation: re-running discovery on
        // byte-identical source yields the same per-file summary (oracle
        // reproducibility). openaiClient skips this for reasoning models.
        { tools: [], temperature: 0 },
      );
      const llmDurationMs = Date.now() - llmStart;

      logger.info('[OperationalArtifact] LLM response received', {
        requestId,
        runId: body.runId,
        filePath: body.filePath,
        llmDurationMs,
        responseContentLength: llmResponse.content?.length || 0,
        usage: llmResponse.usage,
        totalDurationMs: Date.now() - startTime,
      });

      const response: OperationalArtifactResponse = {
        content: llmResponse.content || '',
        usage: llmResponse.usage,
      };

      return res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[OperationalArtifact] Endpoint error', {
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
  },
);
