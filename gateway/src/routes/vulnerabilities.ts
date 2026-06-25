/**
 * Vulnerabilities Route
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 3 (gateway upload/parse/proxy surface).
 *
 * Surfaces the new top-level Security tab's vulnerability store through the
 * gateway, scoped to a project + architecture (the `:architectureId` segment is
 * mandatory -- omitting it 404s at the Express layer, matching every other
 * architecture-scoped proxy in this repo).
 *
 * Mounted at `/api/v1` in `server.ts`, so the router's internal paths resolve to
 *   POST /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/reports
 *   GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities
 *   GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/reports
 *   GET  /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities/rollup
 *
 * Upload (`POST .../reports`):
 *   - Multipart upload via `multer({ storage: multer.memoryStorage() })`,
 *     exactly as the `apiMigrationValidation` `parse-oas`/`manual-capture`
 *     action does (in-memory only -- the report bytes are never written to disk).
 *   - CSV/JSON pass through directly; XLSX goes through the SheetJS
 *     extraction-to-rows step first (inside the parser).
 *   - The LLM-flexible parse runs at the gateway (`vulnerabilityReportParser`);
 *     the deterministic dedup/normalize/match runs at AMS. The parsed rows +
 *     the recorded `parse_strategy` + the no-silent-drop accounting
 *     (`parser_dropped_count` / `parser_notes`) are forwarded to the AMS
 *     `POST .../vulnerabilities/reports` endpoint, whose summary is piped back.
 *
 * Reads (`GET vulnerabilities` / `reports` / `rollup`):
 *   - Thin JSON pass-throughs to the architecture-model-service on the
 *     architecture-scoped path, mirroring the `discovery.ts` proxy convention.
 *     Upstream status + body are forwarded verbatim; a network error surfaces
 *     as 503.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import { getLlmClient } from '../services/llmClient';
import { OpenAIMessage } from '../services/openaiClient';
import {
  parseVulnerabilityReport,
  VulnerabilityReportFormat,
  ParsedVulnerabilityRow,
} from '../services/vulnerabilityReportParser';

export const vulnerabilitiesRouter = Router();

// ============================================================================
// Multipart upload config
//
// In-memory only (the report bytes are parsed in-process and forwarded as JSON
// rows -- never written to disk). 15 MB single-file cap covers realistic SCA
// exports; the field name `file` matches the existing `parse-oas` convention.
// ============================================================================
const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the upload format from an explicit `format` body field, then the
 * filename extension, then the mimetype. Returns null when the format is not
 * one of the supported `csv|xlsx|json`.
 */
export function resolveReportFormat(
  explicit: unknown,
  filename: string | undefined,
  mimetype: string | undefined,
): VulnerabilityReportFormat | null {
  const norm = (v: string): VulnerabilityReportFormat | null => {
    const lower = v.trim().toLowerCase();
    if (lower === 'csv') return 'csv';
    if (lower === 'xlsx' || lower === 'xlsm') return 'xlsx';
    if (lower === 'json') return 'json';
    return null;
  };

  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    const fromExplicit = norm(explicit);
    if (fromExplicit) return fromExplicit;
  }

  if (filename) {
    const dot = filename.lastIndexOf('.');
    if (dot >= 0 && dot < filename.length - 1) {
      const fromExt = norm(filename.substring(dot + 1));
      if (fromExt) return fromExt;
    }
  }

  if (mimetype) {
    const mt = mimetype.toLowerCase();
    if (mt.includes('csv')) return 'csv';
    if (mt.includes('json')) return 'json';
    if (mt.includes('sheet') || mt.includes('excel') || mt.includes('xlsx')) {
      return 'xlsx';
    }
  }

  return null;
}

/**
 * Adapt the shared gateway LLM client to the parser's single-shot
 * `LlmCompletion` seam. Temperature 0 -> deterministic strategy/mapping for
 * byte-identical input. The model is selected gateway-side; no caller model id.
 */
function makeLlmCompletion(requestId: string, correlation: string) {
  return async (prompt: string): Promise<string> => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: prompt }];
    const response = await getLlmClient().sendChatRequest(
      messages,
      requestId,
      correlation,
      { tools: [], temperature: 0 },
    );
    return response.content ?? '';
  };
}

// ============================================================================
// POST .../vulnerabilities/reports  -- multipart upload + parse + AMS forward
// ============================================================================

vulnerabilitiesRouter.post(
  '/projects/:projectId/architectures/:architectureId/vulnerabilities/reports',
  reportUpload.single('file'),
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const file = (req as Request & { file?: Express.Multer.File }).file;

    if (!file || !file.buffer || file.buffer.length === 0) {
      return res.status(400).json({
        error: {
          code: 400,
          message:
            'A report file is required (multipart field "file"; one of CSV / XLSX / JSON).',
        },
      });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const format = resolveReportFormat(body.format, file.originalname, file.mimetype);
    if (!format) {
      return res.status(400).json({
        error: {
          code: 400,
          message:
            'Unsupported report format. Provide a CSV, XLSX, or JSON file ' +
            '(detected from the "format" field, the filename extension, or the mimetype).',
        },
      });
    }

    const source =
      typeof body.source === 'string' && body.source.trim().length > 0
        ? body.source.trim()
        : 'internal_report';

    logger.info('[Vulnerabilities] Report upload received', {
      requestId,
      projectId,
      architectureId,
      format,
      source,
      originalFilename: file.originalname,
      sizeBytes: file.buffer.length,
    });

    // -- Parse (LLM-flexible strategy + deterministic extraction) ------------
    const parseResult = await parseVulnerabilityReport({
      fileBuffer: file.buffer,
      format,
      originalFilename: file.originalname,
      llm: makeLlmCompletion(requestId, `vuln-report-parse-${projectId}-${architectureId}`),
    });

    if (!parseResult.success) {
      logger.warn('[Vulnerabilities] Report parse failed', {
        requestId,
        projectId,
        architectureId,
        format,
        error: parseResult.error,
      });
      // 422: the upload was well-formed multipart but the content could not be
      // turned into rows (bad/empty report, or LLM unavailable). The message
      // carries the specific reason for the UI.
      return res.status(422).json({
        error: {
          code: 422,
          message: parseResult.error,
        },
      });
    }

    logger.info('[Vulnerabilities] Report parsed', {
      requestId,
      projectId,
      architectureId,
      parseStrategy: parseResult.parseStrategy,
      parsedRows: parseResult.rows.length,
      droppedUnparseable: parseResult.droppedCount,
    });

    // -- Forward the parsed rows to AMS for dedup/normalize/match/persist ----
    const { architectureModelServiceBaseUrl } = getConfig();
    const url =
      `${architectureModelServiceBaseUrl}` +
      `/api/model/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(architectureId)}/vulnerabilities/reports`;

    const amsBody = {
      source,
      original_filename: file.originalname ?? null,
      format,
      parse_strategy: parseResult.parseStrategy,
      parser_dropped_count: parseResult.droppedCount,
      parser_notes: parseResult.notes,
      rows: parseResult.rows as ParsedVulnerabilityRow[],
    };

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(amsBody),
      });

      let responseBody: unknown;
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          responseBody = await upstream.json();
        } catch {
          responseBody = null;
        }
      } else {
        responseBody = await upstream.text();
      }

      if (!upstream.ok) {
        logger.warn('[Vulnerabilities] AMS ingest returned non-OK', {
          requestId,
          projectId,
          architectureId,
          status: upstream.status,
        });
      }

      // TRANSPARENCY: surface the resolved column mapping the gateway parse used
      // (source header -> field, incl. which column was parsed as the GitLab
      // Location blob) so the frontend can show "mapping used." The mapping is a
      // gateway-side artifact (AMS does not echo it), so we MERGE it onto the AMS
      // JSON summary piped back. Non-JSON / empty AMS bodies still return it.
      res.status(upstream.status);
      if (responseBody === null || responseBody === undefined) {
        // No AMS body to enrich; still return the mapping so the UI has it.
        return res.json({
          parse_strategy: parseResult.parseStrategy,
          column_mapping: parseResult.columnMapping,
        });
      }
      if (typeof responseBody === 'string') {
        return res.send(responseBody);
      }
      if (
        responseBody &&
        typeof responseBody === 'object' &&
        !Array.isArray(responseBody)
      ) {
        return res.json({
          ...(responseBody as Record<string, unknown>),
          parse_strategy: parseResult.parseStrategy,
          column_mapping: parseResult.columnMapping,
        });
      }
      return res.json(responseBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Vulnerabilities] AMS ingest forward failed', {
        requestId,
        projectId,
        architectureId,
        error: message,
      });
      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
          details: message,
        },
      });
    }
  },
);

// ============================================================================
// POST .../vulnerabilities/scan  -- thin proxy to the discovery-service
// on-demand automated enrichment trigger (Spec 2, Task Group 3, task 3.3)
//
// Mirrors the `discovery.ts` proxy precedent (run-create / resume / rescore):
// forward the request to the discovery-service endpoint, pass the upstream
// status + body back TRANSPARENTLY, and log start / complete / error. The
// gateway does NOT run OSV or hold the dependency graph -- it is a thin proxy
// only. The discovery-service endpoint is STRICTLY NON-BLOCKING (it always
// resolves, returning the informational "automated enrichment unavailable"
// signal rather than erroring), so this proxy simply relays whatever it
// returns; a discovery-service NETWORK error (service down) surfaces as 503.
// ============================================================================

vulnerabilitiesRouter.post(
  '/projects/:projectId/architectures/:architectureId/vulnerabilities/scan',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('[Vulnerabilities] Enrichment scan trigger proxy received', {
      requestId,
      projectId,
      architectureId,
      refresh: (req.body && (req.body as Record<string, unknown>).refresh) ?? true,
    });

    const url =
      `${discoveryServiceBaseUrl}` +
      `/discovery/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(architectureId)}/vulnerabilities/scan`;

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });

      let responseBody: unknown;
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          responseBody = await upstream.json();
        } catch {
          responseBody = null;
        }
      } else {
        responseBody = await upstream.text();
      }

      logger.info('[Vulnerabilities] Enrichment scan trigger proxy completed', {
        requestId,
        projectId,
        architectureId,
        status: upstream.status,
        success: upstream.ok,
      });

      res.status(upstream.status);
      if (responseBody === null || responseBody === undefined) {
        return res.end();
      }
      if (typeof responseBody === 'string') {
        return res.send(responseBody);
      }
      return res.json(responseBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[Vulnerabilities] Enrichment scan trigger proxy failed', {
        requestId,
        projectId,
        architectureId,
        error: message,
      });
      // The discovery-service itself never errors enrichment into the workflow;
      // a 503 here means the discovery-service was unreachable (a transport
      // failure), surfaced benignly so the Security view stays usable.
      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
          details: message,
        },
      });
    }
  },
);

// ============================================================================
// Shared GET pass-through to AMS
// ============================================================================

/**
 * Forward a GET read to the architecture-model-service on the
 * architecture-scoped vulnerabilities path, preserving the incoming query
 * string verbatim. Pipes the upstream status + body back; a network error
 * surfaces as 503. Mirrors the `discovery.ts` read-proxy convention.
 *
 * `amsSuffix` is appended after `.../vulnerabilities` (e.g. '' for the list,
 * '/reports' for history, '/rollup' for aggregates).
 */
async function proxyVulnGet(
  req: Request,
  res: Response,
  amsSuffix: string,
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;
  const { architectureModelServiceBaseUrl } = getConfig();

  const queryIdx = req.originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';

  const url =
    `${architectureModelServiceBaseUrl}` +
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/vulnerabilities${amsSuffix}` +
    queryString;

  logger.debug('[Vulnerabilities] GET proxy forwarding', {
    requestId,
    method: req.method,
    url,
    projectId,
    architectureId,
  });

  try {
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('[Vulnerabilities] GET proxy upstream returned non-OK', {
        requestId,
        url,
        status: upstream.status,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Vulnerabilities] GET proxy upstream fetch failed', {
      requestId,
      url,
      error: message,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'Architecture model service unavailable',
        details: message,
      },
    });
  }
}

// ============================================================================
// GET read routes
//
// The `/reports` and `/rollup` sub-paths are registered BEFORE the bare list so
// Express's first-match dispatch never folds them into the list handler (they
// are distinct literal segments, but registering specific-first keeps the
// ordering discipline the rest of the codebase follows).
// ============================================================================

vulnerabilitiesRouter.get(
  '/projects/:projectId/architectures/:architectureId/vulnerabilities/reports',
  (req, res) => proxyVulnGet(req, res, '/reports'),
);

vulnerabilitiesRouter.get(
  '/projects/:projectId/architectures/:architectureId/vulnerabilities/rollup',
  (req, res) => proxyVulnGet(req, res, '/rollup'),
);

vulnerabilitiesRouter.get(
  '/projects/:projectId/architectures/:architectureId/vulnerabilities',
  (req, res) => proxyVulnGet(req, res, ''),
);
