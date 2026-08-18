/**
 * Log-replay round-2 CURRENT-side run route (Capture-State Discipline &
 * Log-Replay program, Spec 7, 2026-08-18).
 *
 *   POST /api/log-replay/run
 *
 * Replays the staged log corpus (AMS changeset 225) against the LIVE current
 * system at S0 and promotes a `log_replay`-kind baseline. Phase B (the
 * target-side replay + diff) rides the EXISTING headless reconcile machinery
 * with that baseline as its source — driven by the gateway.
 *
 * Synchronous long-running POST — the same posture as the data-migration /
 * s0-snapshot routes. Credentials arrive in the request body, live in
 * function scope only, never logged, never persisted.
 *
 * Body (snake_case wire):
 * {
 *   project_id, architecture_id,
 *   corpus_id?,                 // default: the latest corpus for the pair
 *   current_api: { base_url, auth: {type, ...}, default_headers? },
 *   current_db?: { db_type, host, port, database, schema?, username, password }
 * }
 */

import { Router, Request, Response } from 'express';

import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import type { ApiAuthSecret } from '../types/secrets';
import type { DbConnectionConfig, DbType } from '../types/db';
import {
  runLogReplayCurrentCapture,
  type LogReplayCorpusItemInput,
} from '../services/logReplayCaptureRunner';

interface DbBlock {
  db_type?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

interface RunBody {
  project_id?: string;
  architecture_id?: string;
  corpus_id?: string;
  current_api?: {
    base_url?: string;
    auth?: ApiAuthSecret;
    default_headers?: Record<string, string> | null;
  };
  current_db?: DbBlock | null;
}

function toDbConfig(block: DbBlock | null | undefined): DbConnectionConfig | null {
  if (!block) return null;
  if (block.db_type !== 'sybase' && block.db_type !== 'postgres') return null;
  if (!block.host || !block.database || !block.username || !block.password) return null;
  if (typeof block.port !== 'number' || !Number.isFinite(block.port)) return null;
  return {
    dbType: block.db_type as DbType,
    host: block.host,
    port: block.port,
    database: block.database,
    schema: block.schema ?? null,
    username: block.username,
    password: block.password,
  };
}

async function amsGetJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${ARCHITECTURE_MODEL_SERVICE_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function buildLogReplayRunRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post('/api/log-replay/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as RunBody;
    if (!body.project_id) return res.status(400).json({ error: 'project_id is required' });
    if (!body.architecture_id) {
      return res.status(400).json({ error: 'architecture_id is required' });
    }
    if (!body.current_api?.base_url || !body.current_api.auth?.type) {
      return res.status(400).json({
        error: 'current_api { base_url, auth: { type, ... } } is required',
      });
    }

    const base =
      `/api/model/projects/${encodeURIComponent(body.project_id)}` +
      `/architectures/${encodeURIComponent(body.architecture_id)}/log-replay-corpus`;

    // Resolve the corpus: explicit id, else the latest for the pair.
    let corpusId = body.corpus_id ?? null;
    if (!corpusId) {
      const latest = await amsGetJson<{ id?: string }>(`${base}/latest`);
      corpusId = latest?.id ?? null;
    }
    if (!corpusId) {
      return res.status(404).json({
        error:
          'no log-replay corpus is staged for this architecture — upload and extract ' +
          'an application log first',
      });
    }
    const items = await amsGetJson<LogReplayCorpusItemInput[]>(`${base}/${corpusId}/items`);
    if (!items || items.length === 0) {
      return res.status(422).json({ error: `corpus ${corpusId} has no items` });
    }

    const outcome = await runLogReplayCurrentCapture({
      projectId: body.project_id,
      architectureId: body.architecture_id,
      corpusId,
      items,
      currentApi: {
        baseUrl: body.current_api.base_url,
        auth: body.current_api.auth,
        defaultHeaders: body.current_api.default_headers ?? null,
      },
      currentDb: toDbConfig(body.current_db),
    });

    // Advance the corpus status on success (best-effort — the baseline is
    // the authoritative artifact).
    if (outcome.finalStatus === 'completed') {
      try {
        await fetch(`${ARCHITECTURE_MODEL_SERVICE_BASE_URL}${base}/${corpusId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'replayed_current' }),
        });
      } catch {
        /* best-effort */
      }
    }

    return res.status(outcome.finalStatus === 'completed' ? 200 : 500).json({
      corpus_id: corpusId,
      session_id: outcome.sessionId,
      baseline_id: outcome.baselineId,
      items_total: outcome.itemsTotal,
      items_replayed: outcome.itemsReplayed,
      items_skipped: outcome.itemsSkipped,
      items_failed: outcome.itemsFailed,
      final_status: outcome.finalStatus,
      error_message: outcome.errorMessage,
    });
  });

  return router;
}

export const logReplayRunRouter = buildLogReplayRunRouter();
