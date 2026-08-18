/**
 * SCL "explain this" route (SCL pipeline spec 6 of 10, 2026-08-18 design —
 * the Structural Model tab's LLM affordance).
 *
 *   POST /projects/:projectId/architectures/:architectureId/scl/explain
 *     body { scan_id, contract_key }
 *     200 → { explanation: string }   plain-English prose (never persisted)
 *     400 → { error }                 missing scan_id / contract_key
 *     404 → { error }                 unknown (scan, contract) pair
 *     502 → { error }                 AMS read failure or LLM failure
 *
 * Mounted at /api/v1 (server.ts), matching the sibling sclAnnotation router.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import { explainSclContract, SclContractNotFoundError } from '../services/sclExplain';

const BASE = '/projects/:projectId/architectures/:architectureId/scl';

export const sclExplainRouter = Router();

sclExplainRouter.post(`${BASE}/explain`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const scanId = typeof body.scan_id === 'string' ? body.scan_id : '';
  const contractKey = typeof body.contract_key === 'string' ? body.contract_key : '';

  if (!scanId || !contractKey) {
    res.status(400).json({ error: 'scan_id and contract_key are required' });
    return;
  }

  try {
    const explanation = await explainSclContract({
      projectId,
      architectureId,
      scanId,
      contractKey,
    });
    res.json({ explanation });
  } catch (error) {
    if (error instanceof SclContractNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[diag-gateway] scl_explain failed', {
      projectId,
      architectureId,
      scanId,
      contractKey,
      error: message,
    });
    res.status(502).json({ error: message });
  }
});
