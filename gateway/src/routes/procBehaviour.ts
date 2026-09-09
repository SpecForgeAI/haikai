/**
 * Proc behaviour capture proxies (Stored Proc & Function Behaviour Program,
 * Spec 3, 2026-09-09). Two downstreams, one gateway surface under
 * `/api/v1/projects/:projectId/architectures/:architectureId`:
 *
 *   - AMVS actions on a capture session (secrets / start / status / cancel /
 *     retry-uncovered / exclude-routine / not-possible / save-baseline):
 *       {AMVS}/api-migration-validation/api/proc-capture-sessions/:sessionId/<action>?projectId&architectureId
 *   - AMS data plane passthrough (sessions, scenarios, captures,
 *     diagnostics, baselines, items, the routine catalog):
 *       {AMS}/api/projects/:p/architectures/:a/proc-behaviour/...
 *       {AMS}/api/projects/:p/architectures/:a/db-routines...
 *
 * DB-native: this router never touches the API behaviour session routes.
 */

import { Router, type Request, type Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';

export const PROC_BEHAVIOUR_ACTION_PATHS = [
  'secrets',
  'start',
  'cancel',
  'retry-uncovered',
  'exclude-routine',
  'not-possible',
  'save-baseline',
] as const;

const procBehaviourRouter = Router();

async function relay(upstream: globalThis.Response, res: Response): Promise<void> {
  let body: unknown;
  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await upstream.json();
    } catch {
      body = null;
    }
  } else {
    const text = await upstream.text().catch(() => '');
    body = text.length > 0 ? { message: text } : null;
  }
  res.status(upstream.status);
  if (body === null || body === undefined) {
    res.end();
  } else {
    res.json(body);
  }
}

async function proxyActionToValidationService(req: Request, res: Response, action: string, method: 'POST' | 'GET'): Promise<void> {
  const { projectId, architectureId, sessionId } = req.params;
  const { apiMigrationValidationServiceBaseUrl } = getConfig();
  const params = new URLSearchParams();
  params.set('projectId', projectId);
  params.set('architectureId', architectureId);
  const url =
    `${apiMigrationValidationServiceBaseUrl}` +
    `/api-migration-validation/api/proc-capture-sessions/${encodeURIComponent(sessionId)}/${action}` +
    `?${params.toString()}`;
  try {
    const upstream = await fetch(url, method === 'GET'
      ? { method: 'GET', headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(req.body ?? {}) });
    await relay(upstream, res);
  } catch (error) {
    logger.error('[diag-gateway] proc_behaviour action proxy failed', {
      action,
      projectId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: `Validation service unreachable for proc capture action '${action}'.` });
  }
}

async function proxyToArchitectureModel(req: Request, res: Response, rest: string): Promise<void> {
  const { projectId, architectureId } = req.params;
  const { architectureModelServiceBaseUrl } = getConfig();
  const queryIdx = req.originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';
  const url =
    `${architectureModelServiceBaseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/${rest}${queryString}`;
  const method = req.method.toUpperCase();
  try {
    const upstream = await fetch(url, method === 'GET' || method === 'DELETE'
      ? { method, headers: { Accept: 'application/json' } }
      : { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(req.body ?? {}) });
    await relay(upstream, res);
  } catch (error) {
    logger.error('[diag-gateway] proc_behaviour AMS proxy failed', {
      rest,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: 'Architecture model service unreachable.' });
  }
}

const BASE = '/projects/:projectId/architectures/:architectureId';

// AMVS actions — registered BEFORE the AMS wildcard so `start` etc. win.
for (const action of PROC_BEHAVIOUR_ACTION_PATHS) {
  procBehaviourRouter.post(`${BASE}/proc-behaviour/capture-sessions/:sessionId/${action}`, (req, res) =>
    proxyActionToValidationService(req, res, action, 'POST'),
  );
}
procBehaviourRouter.get(`${BASE}/proc-behaviour/capture-sessions/:sessionId/status`, (req, res) =>
  proxyActionToValidationService(req, res, 'status', 'GET'),
);

// AMS data plane passthrough.
procBehaviourRouter.all(`${BASE}/proc-behaviour/*`, (req, res) => {
  const rest = `proc-behaviour/${(req.params as Record<string, string>)[0] ?? ''}`;
  return proxyToArchitectureModel(req, res, rest);
});
procBehaviourRouter.all(`${BASE}/proc-behaviour`, (req, res) => proxyToArchitectureModel(req, res, 'proc-behaviour'));
procBehaviourRouter.all(`${BASE}/db-routines/*`, (req, res) => {
  const rest = `db-routines/${(req.params as Record<string, string>)[0] ?? ''}`;
  return proxyToArchitectureModel(req, res, rest);
});
procBehaviourRouter.all(`${BASE}/db-routines`, (req, res) => proxyToArchitectureModel(req, res, 'db-routines'));

export { procBehaviourRouter };
