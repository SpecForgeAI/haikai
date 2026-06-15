/**
 * Discovery V3 Capability-Naming Relay Route.
 *
 * Spec: 2026-06-14 D2 -- Capability Synthesis + Batch Spines, Task Group 4.
 *
 * D2's capability-synthesis step computes capability membership DETERMINISTICALLY
 * (a JIL-DAG transitive closure + a co-location heuristic over the discovery
 * findings / candidates). The LLM is NAMING-ONLY: given the deterministic seed
 * (the members + the JIL-DAG topology + the invocation edges) it proposes a
 * human-readable `name`, a one-line `summary`, and a `kind` classification. It
 * NEVER adds, removes, or moves members -- the seed is fixed before this call.
 *
 * Like the V3 gap-fill (`discoveryGapFill.ts`) and operational-artifact
 * (`discoveryOperationalArtifact.ts`) relays, the discovery-service composes the
 * FULLY-ASSEMBLED naming prompt (the strict-JSON contract is defined
 * service-side) and POSTs it here; this route simply forwards the prompt to the
 * shared LLM client at `temperature: 0` and returns the response content
 * unmodified. A SEPARATE relay from gap-fill / operational-artifact keeps clean
 * prompt / model / cache separation -- the gateway is stateless with respect to
 * the naming prompt content. The synthesis prompt diverges enough (capability
 * seed-naming, correlated by a `seedKey` rather than a `filePath`) to warrant
 * its own relay rather than reusing the per-file summariser route.
 *
 * Endpoint:
 *   POST /v3/capability-naming
 *
 * Mounted at /api/v1/discovery in server.ts, serving:
 *   POST /api/v1/discovery/v3/capability-naming
 */

import { Router, Request, Response } from 'express';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';
import { OpenAIMessage } from '../services/openaiClient';

export const discoveryCapabilityNamingRouter = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Request shape for the V3 capability-naming relay.
 *
 * The discovery-service composes the per-seed naming prompt (requesting the
 * strict `{ name, summary, kind }` object) and sends it here fully assembled.
 * `seedKey` and `runId` are carried for logging / correlation only -- `seedKey`
 * is the deterministic seed identifier (e.g. the JIL box name or a co-location
 * group key), NOT a file path.
 */
interface CapabilityNamingRequest {
  /** Fully-assembled naming prompt composed by discovery-service. */
  prompt: string;
  /** Deterministic seed identifier -- used for logging / correlation only. */
  seedKey: string;
  /** Discovery run ID -- used for logging / correlation only. */
  runId: string;
}

/**
 * Response shape returned to discovery-service.
 *
 * Raw LLM text content is returned verbatim. The strict-JSON parse + validation
 * (and the capability shaping) happen downstream in discovery-service.
 */
interface CapabilityNamingResponse {
  /** Raw LLM response content (expected to be the strict `{ name, summary, kind }` object). */
  content: string;
  /** Token usage information (passthrough from the LLM client). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

// ============================================================================
// POST /v3/capability-naming
// ============================================================================

/**
 * POST /v3/capability-naming
 *
 * Stateless relay: accepts a caller-composed prompt, forwards it to the
 * configured LLM client at `temperature: 0` with no tools, returns the
 * response content.
 *
 * Request body: { prompt: string, seedKey: string, runId: string }
 * Response body: { content: string, usage?: {...} }
 */
discoveryCapabilityNamingRouter.post(
  '/v3/capability-naming',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const startTime = Date.now();

    try {
      const body = req.body as CapabilityNamingRequest;

      // Validate request body (same 400 shape as the gap-fill / OA relays).
      if (!body || typeof body.prompt !== 'string' || body.prompt.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'prompt is required and must be a non-empty string' },
        });
      }

      if (typeof body.seedKey !== 'string' || body.seedKey.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'seedKey is required and must be a non-empty string' },
        });
      }

      if (typeof body.runId !== 'string' || body.runId.length === 0) {
        return res.status(400).json({
          error: { code: 400, message: 'runId is required and must be a non-empty string' },
        });
      }

      logger.info('[CapabilityNaming] Received V3 capability-naming request', {
        requestId,
        runId: body.runId,
        seedKey: body.seedKey,
        promptLengthChars: body.prompt.length,
        estimatedTokens: Math.ceil(body.prompt.length / 4),
      });

      // Build a single user message containing the caller-supplied prompt. No
      // system message is injected here -- the caller-composed prompt already
      // carries the naming role + the strict-JSON contract.
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
        `v3-capability-naming-${body.runId}-${body.seedKey}`,
        // temperature 0 -> deterministic naming: re-running synthesis on the same
        // deterministic seed yields the same name/summary/kind (oracle
        // reproducibility). openaiClient skips this for reasoning models.
        { tools: [], temperature: 0 },
      );
      const llmDurationMs = Date.now() - llmStart;

      logger.info('[CapabilityNaming] LLM response received', {
        requestId,
        runId: body.runId,
        seedKey: body.seedKey,
        llmDurationMs,
        responseContentLength: llmResponse.content?.length || 0,
        usage: llmResponse.usage,
        totalDurationMs: Date.now() - startTime,
      });

      const response: CapabilityNamingResponse = {
        content: llmResponse.content || '',
        usage: llmResponse.usage,
      };

      return res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[CapabilityNaming] Endpoint error', {
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
