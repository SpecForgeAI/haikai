/**
 * Log-Replay Corpus Route (Capture-State Discipline & Log-Replay program,
 * Spec 5, 2026-08-18).
 *
 *   POST /  (mounted at /discovery/log-replay-corpus)
 *
 * Ingests an application log (inline content or server-side path — the exact
 * shape of the log-enrichment route), extracts the reconciliation round-2
 * REPLAY CORPUS via the shared runtime-evidence parsers, matches requests
 * against the committed model's endpoints, and persists the staged corpus
 * ATOMICALLY to AMS (changeset 225).
 *
 * ZERO useful requests -> the source is ABANDONED for replay purposes (user
 * ruling): nothing persists, the response says so loudly with the funnel so
 * the operator sees exactly why every line was discarded.
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';

import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import {
  LOG_MAX_CONTENT_SIZE_BYTES,
  LOG_MAX_LINE_COUNT,
} from '../constants/logEnrichmentDefaults';
import {
  extractReplayCorpus,
  type CorpusEndpoint,
} from '../services/logReplayCorpus/corpusExtractor';
import type { ExtractorRecipe } from '../services/runtimeEvidence/recipeAwareExtractor';

const logReplayCorpusRouter = Router();

interface RawModelEndpoint {
  id?: string;
  path_or_address?: string;
  operation_verb?: string;
}

/** One committed-model read -> the endpoint match set. */
async function fetchModelEndpoints(
  projectId: string,
  architectureId: string,
): Promise<CorpusEndpoint[] | null> {
  try {
    const response = await fetch(
      `${ARCHITECTURE_MODEL_SERVICE_BASE_URL}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const model = (await response.json()) as {
      metaModel?: { entities?: { endpoints?: RawModelEndpoint[] } };
    };
    return (model.metaModel?.entities?.endpoints ?? [])
      .filter((e) => e.id && e.operation_verb && e.path_or_address)
      .map((e) => ({
        id: e.id as string,
        method: (e.operation_verb as string).toUpperCase(),
        template: e.path_or_address as string,
      }));
  } catch {
    return null;
  }
}

logReplayCorpusRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, architectureId, logFilePath, logContent, fileName, recipeJson } =
    (req.body ?? {}) as {
      projectId?: string;
      architectureId?: string;
      logFilePath?: string;
      logContent?: string;
      fileName?: string;
      recipeJson?: unknown;
    };

  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    return res.status(400).json({ error: { code: 400, message: 'projectId is required' } });
  }
  if (!architectureId || typeof architectureId !== 'string' || architectureId.trim() === '') {
    return res
      .status(400)
      .json({ error: { code: 400, message: 'architectureId is required' } });
  }
  if (!logFilePath && !logContent) {
    return res.status(400).json({
      error: { code: 400, message: 'Either logFilePath or logContent must be provided' },
    });
  }

  let content: string;
  try {
    content = logContent ?? (await fs.readFile(logFilePath as string, 'utf-8'));
  } catch (err) {
    return res.status(400).json({
      error: {
        code: 400,
        message: `Could not read log file: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
  if (Buffer.byteLength(content, 'utf8') > LOG_MAX_CONTENT_SIZE_BYTES) {
    return res.status(400).json({
      error: {
        code: 400,
        message: `Log content exceeds the ${LOG_MAX_CONTENT_SIZE_BYTES}-byte cap`,
      },
    });
  }
  const lineCount = content.split('\n').length;
  if (lineCount > LOG_MAX_LINE_COUNT) {
    return res.status(400).json({
      error: {
        code: 400,
        message: `Log content exceeds the ${LOG_MAX_LINE_COUNT}-line cap (${lineCount} lines)`,
      },
    });
  }

  const endpoints = await fetchModelEndpoints(projectId, architectureId);
  if (!endpoints || endpoints.length === 0) {
    return res.status(422).json({
      error: {
        code: 422,
        message:
          'the committed model exposes no endpoints for this architecture — ' +
          'commit discovery before extracting a replay corpus',
      },
    });
  }

  const result = extractReplayCorpus({
    content,
    fileName: fileName ?? (logFilePath ? String(logFilePath).split(/[\\/]/).pop() : null),
    endpoints,
    recipe: (recipeJson as ExtractorRecipe | undefined) ?? null,
  });

  // ZERO useful requests -> ABANDON the source loudly (user ruling): the
  // funnel tells the operator exactly why; nothing persists.
  if (result.items.length === 0) {
    return res.status(200).json({
      abandoned: true,
      message:
        'no useful requests were found in this log — the source is abandoned for ' +
        'reconciliation purposes (see the funnel for the per-reason accounting)',
      funnel: result.funnel,
      corpus: null,
    });
  }

  // Persist the staged corpus ATOMICALLY to AMS.
  try {
    const response = await fetch(
      `${ARCHITECTURE_MODEL_SERVICE_BASE_URL}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/log-replay-corpus`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          file_name: fileName ?? null,
          funnel_json: result.funnel as unknown as Record<string, unknown>,
          items: result.items,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return res.status(502).json({
        error: {
          code: 502,
          message: `AMS corpus persistence failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        },
      });
    }
    const corpus = await response.json();
    return res.status(200).json({ abandoned: false, corpus, funnel: result.funnel });
  } catch (err) {
    return res.status(502).json({
      error: {
        code: 502,
        message: `AMS corpus persistence failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    });
  }
});

export { logReplayCorpusRouter };
