/**
 * SCL annotation-pass routes (SCL pipeline spec 4 of 10, 2026-08-18 design).
 *
 * The gateway surface for the LLM annotation pass over the SCL corpus
 * (services/sclAnnotationPass.ts):
 *
 *   POST /projects/:projectId/architectures/:architectureId/scl/annotation/run
 *     body { scan_id?, regenerate? } → 202 {status:'started'} fire-and-forget;
 *     completion / failure land as '[diag-gateway] scl_annotation ...' logs.
 *
 *   GET  /projects/:projectId/architectures/:architectureId/scl/annotation/status
 *     proxy convenience for the frontend: the latest scan's
 *     stats_json.scl_annotation (404 when no scan exists).
 *
 * Mounted at /api/v1 (server.ts), matching the sibling migration routers.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import { runSclAnnotationPass, SclScanWire } from '../services/sclAnnotationPass';

const BASE = '/projects/:projectId/architectures/:architectureId/scl/annotation';

export const sclAnnotationRouter = Router();

sclAnnotationRouter.post(`${BASE}/run`, (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const scanId = typeof body.scan_id === 'string' && body.scan_id ? body.scan_id : undefined;
  const regenerate = body.regenerate === true;

  logger.info('[diag-gateway] scl_annotation run requested', {
    projectId,
    architectureId,
    scanId: scanId ?? null,
    regenerate,
  });

  // Fire-and-forget: the pass logs its own start/complete/failure lines; the
  // frontend polls GET .../status for the merged stats.
  runSclAnnotationPass({ projectId, architectureId, scanId, regenerate }).catch((error) => {
    logger.error('[diag-gateway] scl_annotation background run failed', {
      projectId,
      architectureId,
      scanId: scanId ?? null,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });

  res.status(202).json({ status: 'started' });
});

sclAnnotationRouter.get(`${BASE}/status`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  try {
    const url =
      `${getConfig().architectureModelServiceBaseUrl}/api/model/projects/` +
      `${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}` +
      '/scl/scans/latest';
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) {
      res.status(404).json({ error: 'no SCL scan exists for this architecture' });
      return;
    }
    if (!response.ok) {
      res
        .status(502)
        .json({ error: `AMS latest-scan read failed: HTTP ${response.status}` });
      return;
    }
    const scan = (await response.json()) as SclScanWire;
    res.json({
      scan_id: scan.id ?? null,
      scan_status: scan.status ?? null,
      scl_annotation: scan.stats_json?.scl_annotation ?? null,
    });
  } catch (error) {
    logger.error('[diag-gateway] scl_annotation status read failed', {
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(502).json({ error: 'AMS latest-scan read failed' });
  }
});
