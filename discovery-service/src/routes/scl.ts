/**
 * SCL scan routes.
 *
 * Spec 3 of the SCL pipeline (corpus assembly: roots, dedup, reachability):
 * `POST /discovery/scl/scans` accepts `{ project_id, architecture_id,
 * source_dir }`, creates the AMS scan row up-front (so the response can carry
 * the scan id), answers `202 { scan_id }`, and fires the full scan pipeline
 * (`runSclScan`) fire-and-forget. Completion / failure land in the AMS scan
 * row (`completed` / `failed` PATCH inside the runner) and in the service
 * log — the caller polls AMS for status, mirroring the long-running-job
 * posture of the other discovery routes.
 *
 * The AMS base URL comes from the same config the archModelClient uses
 * (`ARCHITECTURE_MODEL_SERVICE_BASE_URL`).
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md ("Corpus").
 */

import { Router, Request, Response } from 'express';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import { createSclScan, runSclScan } from '../scl/sclScanRunner';

const sclRouter = Router({ mergeParams: true });

/**
 * POST /discovery/scl/scans
 *
 * Body: `{ project_id: string, architecture_id: string, source_dir: string }`
 * (snake_case, matching the AMS wire convention the caller already speaks).
 *
 * Responses:
 *   202 `{ scan_id }` — scan row created; slicing/assembly runs detached.
 *   400 `{ error }`   — missing/invalid body fields.
 *   502 `{ error }`   — AMS scan-row creation failed (nothing started).
 */
sclRouter.post('/scans', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    project_id?: unknown;
    architecture_id?: unknown;
    source_dir?: unknown;
  };
  const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
  const architectureId =
    typeof body.architecture_id === 'string' ? body.architecture_id.trim() : '';
  const sourceDir = typeof body.source_dir === 'string' ? body.source_dir.trim() : '';

  if (!projectId || !architectureId || !sourceDir) {
    res.status(400).json({
      error: 'project_id, architecture_id and source_dir are required',
    });
    return;
  }

  const args = {
    projectId,
    architectureId,
    sourceDir,
    amsBaseUrl: ARCHITECTURE_MODEL_SERVICE_BASE_URL,
  };

  let scanId: string;
  try {
    scanId = await createSclScan(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scl-scan] scan-row creation failed: ${message}`);
    res.status(502).json({ error: `AMS scan creation failed: ${message}` });
    return;
  }

  res.status(202).json({ scan_id: scanId });

  // Fire-and-forget: the runner PATCHes the scan row completed/failed; log
  // the outcome here so the detached run is visible in the service log.
  runSclScan({ ...args, scanId })
    .then((result) => {
      console.log(
        `[scl-scan] detached scan ${result.scanId} finished: ` +
          `${result.corpus.stats.contractCount} contracts persisted`
      );
    })
    .catch((error) => {
      console.error(
        `[scl-scan] detached scan ${scanId} failed: ` +
          (error instanceof Error ? error.message : String(error))
      );
    });
});

export { sclRouter };
