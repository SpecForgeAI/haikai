import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import {
  applyEndpointEffects,
  EndpointEffectDelta,
} from '../services/endpointEffectApplyService';

/** UUID v4 guard — same loud-failure contract as applyGapMetadataRoute. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the apply_endpoint_effects MCP tool endpoint.
 * Mounts at /mcp/tools/apply_endpoint_effects
 *
 * Effect-map backfill (2026-08-20). The gateway's backfill route calls this
 * with corpus-derived (auto-applied) or human-approved LLM-proposed
 * endpoint -> write-table mappings; the MCP server (the model-write owner)
 * appends `endpoint_data_effects` rows ADDITIVELY — existing write edges are
 * never duplicated, unresolvable names are skipped whole with honest
 * reasons (the table-name resolution doubles as the hallucination guard).
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId / architectureId: UUID v4 (required)
 *   - deltas: non-empty array of { endpoint_id, table_name,
 *     source: 'corpus'|'llm', evidence? }
 *
 * Response: { applied: number, skipped: [{ delta, reason }] }
 */
export const applyEndpointEffectsRouter = Router();

applyEndpointEffectsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, deltas } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }
      if (
        !architectureId ||
        typeof architectureId !== 'string' ||
        !UUID_V4_REGEX.test(architectureId)
      ) {
        throw createHttpError(400, 'architectureId is required and must be a valid UUID');
      }
      if (!Array.isArray(deltas) || deltas.length === 0) {
        throw createHttpError(400, 'deltas is required and must be a non-empty array');
      }
      for (const delta of deltas as Array<Record<string, unknown>>) {
        if (
          !delta ||
          typeof delta !== 'object' ||
          typeof delta.endpoint_id !== 'string' ||
          delta.endpoint_id.trim() === '' ||
          typeof delta.table_name !== 'string' ||
          delta.table_name.trim() === ''
        ) {
          throw createHttpError(
            400,
            'every delta must carry string endpoint_id and table_name'
          );
        }
        if (delta.source !== 'corpus' && delta.source !== 'llm') {
          throw createHttpError(400, "every delta must carry source 'corpus' or 'llm'");
        }
      }

      getOrCreateSession(sessionId);

      const result = await applyEndpointEffects({
        projectId,
        architectureId,
        deltas: deltas as EndpointEffectDelta[],
      });

      console.log('[apply_endpoint_effects] Success', {
        projectId,
        architectureId,
        deltas: deltas.length,
        applied: result.applied,
        skipped: result.skipped.length,
      });

      res.json(result);
    } catch (error: any) {
      if (error.statusCode === 400) {
        res.status(400).json({ error: { code: 400, message: error.message } });
        return;
      }
      if (error.statusCode === 502) {
        console.error('[apply_endpoint_effects] Upstream failure', { error: error.message });
        res.status(502).json({ error: { code: 502, message: error.message } });
        return;
      }
      next(error);
    }
  }
);
