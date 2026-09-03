/**
 * Effect-map backfill routes (2026-08-20).
 *
 *   POST /projects/:projectId/architectures/:architectureId/effect-map-backfill/run
 *     -> runs the full backfill: deterministic corpus derivations are
 *        APPLIED (additively, via the MCP model-write owner) before the
 *        response; guarded LLM proposals ride back for human review.
 *
 *   POST /projects/:projectId/architectures/:architectureId/effect-map-backfill/reland-committed
 *     body { run_ids?: string[] } — re-inserts the endpoint_data_effects rows
 *     of candidates a save-back stamped `committed` whose phase-2 PUT never
 *     landed (2026-09-03). All discovery runs of the architecture when
 *     run_ids is omitted. Additive + idempotent; asserts rows after the PUT.
 *
 *   POST /projects/:projectId/architectures/:architectureId/effect-map-backfill/apply
 *     body { effects: [{ endpoint_id, table_name }] } — the APPROVED
 *     proposal subset; applied additively with source 'llm' (the MCP apply
 *     re-runs the table-name guard).
 *
 * Mounted at /api/v1 (server.ts), beside the sibling SCL routers. Both
 * routes are synchronous (the run is bounded: one model read, one corpus
 * read, ceil(n/8) LLM calls).
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import {
  McpApplyEffect,
  defaultMcpApply,
  defaultMcpReland,
  listDiscoveryRunIds,
  runEffectMapBackfill,
} from '../services/effectMapBackfill';

const BASE = '/projects/:projectId/architectures/:architectureId/effect-map-backfill';

export const effectMapBackfillRouter = Router();

effectMapBackfillRouter.post(`${BASE}/run`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  try {
    const result = await runEffectMapBackfill({ projectId, architectureId });
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[effect-map-backfill] run failed', { projectId, architectureId, error: message });
    res.status(502).json({ error: message });
  }
});

effectMapBackfillRouter.post(`${BASE}/apply`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as { effects?: unknown };
  const rawEffects = Array.isArray(body.effects) ? body.effects : [];
  const effects: McpApplyEffect[] = [];
  for (const raw of rawEffects) {
    const e = raw as { endpoint_id?: unknown; table_name?: unknown };
    if (typeof e?.endpoint_id === 'string' && typeof e?.table_name === 'string') {
      effects.push({
        endpoint_id: e.endpoint_id,
        table_name: e.table_name,
        source: 'llm',
        evidence: 'approved LLM proposal',
      });
    }
  }
  if (effects.length === 0) {
    res.status(400).json({ error: 'effects must be a non-empty array of {endpoint_id, table_name}' });
    return;
  }
  try {
    const result = await defaultMcpApply(projectId, architectureId, effects);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[effect-map-backfill] apply failed', { projectId, architectureId, error: message });
    res.status(502).json({ error: message });
  }
});


effectMapBackfillRouter.post(`${BASE}/reland-committed`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as { run_ids?: unknown };
  try {
    const runIds =
      Array.isArray(body.run_ids) && body.run_ids.length > 0
        ? body.run_ids.filter((r): r is string => typeof r === 'string' && r.length > 0)
        : await listDiscoveryRunIds(projectId, architectureId);
    if (runIds.length === 0) {
      res.status(200).json({ runsScanned: 0, candidatesSeen: 0, relanded: 0, alreadyPresent: 0, skipped: [] });
      return;
    }
    const result = await defaultMcpReland(projectId, architectureId, runIds);
    res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[effect-map-backfill] reland-committed failed', { projectId, architectureId, error: message });
    res.status(502).json({ error: message });
  }
});
