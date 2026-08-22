/**
 * Foundation-decision routes (Foundations & Scope program, Spec 2,
 * 2026-08-22).
 *
 *   GET  /projects/:projectId/architectures/:architectureId/foundation-decisions
 *        -> AMS list (snake_case passthrough).
 *   POST /projects/:projectId/architectures/:architectureId/foundation-decisions/apply
 *        body { decisions: [...] } -> MCP apply_foundation_decisions (the
 *        model-write owner): scope tags + receipts on named entities,
 *        additive PK promotion, decisions upserted to AMS.
 *
 * Mounted at /api/v1 (server.ts), beside the effect-map-backfill router.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';

const BASE = '/projects/:projectId/architectures/:architectureId/foundation-decisions';

export const foundationDecisionsRouter = Router();

foundationDecisionsRouter.get(`${BASE}`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  try {
    const base = getConfig().architectureModelServiceBaseUrl;
    const response = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/foundation-decisions`,
      { headers: { Accept: 'application/json' } },
    );
    const text = await response.text().catch(() => '');
    res
      .status(response.status)
      .type('application/json')
      .send(text || '[]');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[foundation-decisions] list failed', { projectId, architectureId, error: message });
    res.status(502).json({ error: message });
  }
});

foundationDecisionsRouter.post(`${BASE}/apply`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as { decisions?: unknown };
  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    res.status(400).json({ error: 'decisions must be a non-empty array' });
    return;
  }
  try {
    const { mcpBaseUrl } = getConfig();
    const response = await fetch(`${mcpBaseUrl}/mcp/tools/apply_foundation_decisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sessionId: 'gateway',
        projectId,
        architectureId,
        decisions: body.decisions,
      }),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      logger.error('[foundation-decisions] apply failed upstream', {
        projectId,
        architectureId,
        status: response.status,
      });
    }
    res
      .status(response.status)
      .type('application/json')
      .send(text || '{}');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[foundation-decisions] apply failed', { projectId, architectureId, error: message });
    res.status(502).json({ error: message });
  }
});
