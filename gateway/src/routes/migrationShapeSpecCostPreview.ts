/**
 * Migration Shape-Spec Cost-Preview route.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 6
 *
 * Mounted at `/api` (see `server.ts`). One route:
 *
 *   POST /api/migration-shape-spec/cost-preview
 *     Body: { projectId, bookOfWorkId, includePass2?, tokensPerSecond? }
 *     Response: { estimatedTokens, estimatedWallClockSeconds, perStoryEstimates[], meta }
 *
 * BFF-style: never mutates state, only reads. The Generate-all dialog calls
 * this before submit to render the token + wall-clock estimate next to the
 * per-batch auto-run pass-2 toggle. The estimate model honours the
 * per-project budget caps from `fetchProjectConfigWithDefaults`.
 *
 * Error mapping mirrors the sibling shape-spec batch routes:
 *   - 400 on missing required input (projectId / bookOfWorkId)
 *   - 500 with structured envelope on unexpected errors
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  computeCostPreview,
  CostPreviewRequest,
} from '../services/migrationShapeSpecCostPreview';

export const migrationShapeSpecCostPreviewRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/migration-shape-spec/cost-preview
// ---------------------------------------------------------------------------

migrationShapeSpecCostPreviewRouter.post(
  '/migration-shape-spec/cost-preview',
  async (req: Request, res: Response) => {
    const requestId = (req as { requestId?: string }).requestId ?? 'unknown';
    const body = (req.body ?? {}) as Partial<CostPreviewRequest>;
    const start = Date.now();

    if (!body.projectId || typeof body.projectId !== 'string') {
      res.status(400).json({
        error: { code: 400, message: 'projectId is required.' },
      });
      return;
    }
    if (!body.bookOfWorkId || typeof body.bookOfWorkId !== 'string') {
      res.status(400).json({
        error: { code: 400, message: 'bookOfWorkId is required.' },
      });
      return;
    }

    try {
      const result = await computeCostPreview({
        projectId: body.projectId,
        bookOfWorkId: body.bookOfWorkId,
        includePass2:
          typeof body.includePass2 === 'boolean' ? body.includePass2 : undefined,
        tokensPerSecond:
          typeof body.tokensPerSecond === 'number'
            ? body.tokensPerSecond
            : undefined,
      });
      console.log(
        `[diag-gw] route=migration-shape-spec-cost-preview status=200 ` +
          `elapsed_ms=${Date.now() - start} ` +
          `storyCount=${result.meta.storyCount} ` +
          `includePass2=${result.meta.includePass2} ` +
          `estimatedTokens=${result.estimatedTokens}`
      );
      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Shape-spec cost-preview: unexpected error', {
        requestId,
        projectId: body.projectId,
        bookOfWorkId: body.bookOfWorkId,
        error: message,
      });
      console.warn(
        `[diag-gw] route=migration-shape-spec-cost-preview status=500 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(500).json({
        error: {
          code: 500,
          message: 'Shape-spec cost-preview failed',
          details: message,
        },
      });
    }
  }
);
