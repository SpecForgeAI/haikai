import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import {
  applyGapMetadata,
  GapMetadataDelta,
} from '../services/gapMetadataApplyService';

/**
 * UUID v4 regex pattern for projectId / architectureId validation (same
 * loud-failure contract as saveApprovedCandidatesRoute: a mistyped id must
 * never silently target the wrong model).
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the apply_gap_metadata MCP tool endpoint.
 * Mounts at /mcp/tools/apply_gap_metadata
 *
 * Spec 4 — LLM gap-proposal queue (2026-08-04). The gateway's proposal-review
 * route calls this on APPROVE: it forwards the approved proposal's payload as
 * one or more deltas, and the MCP server (the model-write owner) merges them
 * into the committed model additively — populated slots are never overwritten,
 * they come back as per-delta skip notes the gateway surfaces honestly.
 */
export const applyGapMetadataRouter = Router();

/** Delta kinds this tool understands (must match gapMetadataApplyService). */
const VALID_KINDS = new Set(['fk_join', 'primary_key']);

/**
 * POST /
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - architectureId: string (required, UUID v4)
 *   - deltas: array (required, non-empty) of
 *       { kind: 'fk_join', relationship_id, fk_columns: { join_columns,
 *         referenced_columns, on_delete, on_update } }
 *     | { kind: 'primary_key', entity_id, columns: string[] }
 *
 * Response: { applied: number, skipped: [{ delta, reason }] }
 *
 * Error handling (mirrors saveApprovedCandidatesRoute):
 *   - 400 Bad Request: missing/invalid required fields
 *   - 404 Not Found: no committed model for the (project, architecture) pair
 *   - 502 Bad Gateway: upstream AMS communication failure
 */
applyGapMetadataRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, deltas } = req.body ?? {};

      // ====================================================================
      // Request Validation
      // ====================================================================

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Loud-failure contract: no default-architecture fallback — an approved
      // structural write landing on the wrong architecture corrupts the model.
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
        if (!delta || typeof delta !== 'object' || !VALID_KINDS.has(String(delta.kind))) {
          throw createHttpError(
            400,
            `every delta must carry kind 'fk_join' or 'primary_key' (got "${String(
              (delta as { kind?: unknown })?.kind
            )}")`
          );
        }
        if (delta.kind === 'fk_join' && typeof delta.relationship_id !== 'string') {
          throw createHttpError(400, 'fk_join deltas require a string relationship_id');
        }
        if (delta.kind === 'primary_key' && typeof delta.entity_id !== 'string') {
          throw createHttpError(400, 'primary_key deltas require a string entity_id');
        }
      }

      // ====================================================================
      // Session Management (route convention — session tracks tool usage)
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to the model-write service
      // ====================================================================

      const result = await applyGapMetadata({
        projectId,
        architectureId,
        deltas: deltas as GapMetadataDelta[],
      });

      console.log('[apply_gap_metadata] Success', {
        projectId,
        architectureId,
        deltas: deltas.length,
        applied: result.applied,
        skipped: result.skipped.length,
      });

      res.json(result);
    } catch (error: any) {
      // Mirror saveApprovedCandidatesRoute's explicit 400/502 arms; everything
      // else (incl. the service's 404) flows to the shared errorHandler.
      if (error.statusCode === 400) {
        res.status(400).json({ error: { code: 400, message: error.message } });
        return;
      }
      if (error.statusCode === 502) {
        console.error('[apply_gap_metadata] Upstream failure', { error: error.message });
        res.status(502).json({ error: { code: 502, message: error.message } });
        return;
      }
      next(error);
    }
  }
);
