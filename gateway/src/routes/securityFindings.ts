/**
 * Security Findings Route (Security health dashboard, 2026-07-19, Spec 2 of 3)
 *
 * The gateway surface of the department-level security upload wizard. Mounted
 * at `/api/v1` in `server.ts`:
 *
 *   POST /api/v1/projects/:projectId/architectures/:architectureId/security/uploads/parse
 *     Multi-file multipart (field `files`). Parses each file independently
 *     (GitLab CSV/XLSX export, deterministic header-based parse), returns the
 *     header union, the proposed column mapping, the generic-attribute
 *     vocabulary, distinct linking values (for the value matcher) and sample
 *     rows. STATELESS -- the frontend keeps the File objects and re-posts them
 *     on ingest, so nothing is cached server-side between wizard steps.
 *     Optional `linking_column` body field recomputes distinct values when the
 *     user re-maps the linking column in the matcher.
 *
 *   POST .../security/uploads/ingest
 *     Multi-file multipart + the wizard's confirmed answers (`column_mapping`,
 *     `association_level`, `resolutions` as JSON fields). Normalizes every
 *     file's rows (the append), forwards ONE report to the AMS
 *     `POST .../security/reports` endpoint, then fire-and-forget kicks the
 *     OSV CVE enrichment cycle. The AMS ingest summary is piped back.
 *
 *   POST /api/v1/security/enrichment/run
 *     Manually drain the pending-CVE enrichment queue (also kicked
 *     automatically after ingest). Never blocks ingest; behind the
 *     SECURITY_CVE_ENRICHMENT_ENABLED kill-switch.
 *
 * Alias teaching and all reads (register / rollup / reports / aliases /
 * prefill) go straight to AMS from the frontend -- the gateway adds value only
 * where files or external calls are involved.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  SECURITY_GENERIC_ATTRIBUTES,
  SecurityParsedFile,
  distinctLinkingValues,
  normalizeSecurityRows,
  parseSecurityFile,
  proposeColumnMapping,
  unionHeaders,
  LinkingResolution,
} from '../services/securityFindingsPipeline';
import {
  kickSecurityCveEnrichment,
  runSecurityCveEnrichment,
} from '../services/securityCveEnrichment';

export const securityFindingsRouter = Router();

// In-memory multi-file upload: 15 MB per file, up to 20 files per upload
// (a department's scanner export set), field name `files`.
const uploadsMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

const SCOPED_BASE = '/projects/:projectId/architectures/:architectureId/security';

/** Parse every uploaded file independently; files with no rows are kept visible. */
function parseUploadedFiles(files: Express.Multer.File[]): SecurityParsedFile[] {
  return files.map((file) => parseSecurityFile(file.buffer, file.originalname));
}

/** Read a JSON-encoded multipart text field; null when absent/malformed. */
function readJsonField<T>(body: Record<string, unknown>, field: string): T | null {
  const raw = body?.[field];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// POST .../security/uploads/parse -- wizard preview (headers + proposal + values)
// ============================================================================
securityFindingsRouter.post(
  `${SCOPED_BASE}/uploads/parse`,
  uploadsMulter.array('files'),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'At least one file is required (field `files`)' });
      return;
    }
    try {
      const parsed = parseUploadedFiles(files);
      const headers = unionHeaders(parsed);
      const proposedMapping = proposeColumnMapping(headers);
      const linkingColumn =
        typeof req.body?.linking_column === 'string' && req.body.linking_column.trim().length > 0
          ? req.body.linking_column.trim()
          : Object.entries(proposedMapping).find(([, attr]) => attr === 'linking_value')?.[0] ??
            null;
      const totalRows = parsed.reduce((sum, f) => sum + f.rows.length, 0);
      const sampleRows = parsed.flatMap((f) => f.rows.slice(0, 3)).slice(0, 5);
      res.json({
        files: parsed.map((f) => ({
          name: f.name,
          headers: f.headers,
          row_count: f.rows.length,
        })),
        total_rows: totalRows,
        headers,
        proposed_mapping: proposedMapping,
        generic_attributes: SECURITY_GENERIC_ATTRIBUTES,
        linking_column: linkingColumn,
        distinct_linking_values: linkingColumn
          ? distinctLinkingValues(parsed, linkingColumn)
          : [],
        sample_rows: sampleRows,
      });
    } catch (err) {
      logger.error('Security uploads parse failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(422).json({ error: 'Failed to parse uploaded file(s)' });
    }
  },
);

// ============================================================================
// POST .../security/uploads/ingest -- normalize + forward ONE report to AMS
// ============================================================================
securityFindingsRouter.post(
  `${SCOPED_BASE}/uploads/ingest`,
  uploadsMulter.array('files'),
  async (req: Request, res: Response) => {
    const { projectId, architectureId } = req.params;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'At least one file is required (field `files`)' });
      return;
    }
    const columnMapping = readJsonField<Record<string, string>>(req.body, 'column_mapping');
    if (!columnMapping || Object.keys(columnMapping).length === 0) {
      res.status(400).json({ error: '`column_mapping` (JSON object field) is required' });
      return;
    }
    const resolutions =
      readJsonField<LinkingResolution[]>(req.body, 'resolutions') ?? [];
    const associationLevel =
      typeof req.body?.association_level === 'string' &&
      req.body.association_level.trim().length > 0
        ? req.body.association_level.trim()
        : 'application';

    try {
      const parsed = parseUploadedFiles(files);
      const normalized = normalizeSecurityRows(parsed, columnMapping, resolutions);

      const amsBase = getConfig().architectureModelServiceBaseUrl.replace(/\/$/, '');
      const amsUrl =
        `${amsBase}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/security/reports`;
      const amsResponse = await fetch(amsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'gitlab_export',
          association_level: associationLevel,
          original_filenames: parsed.map((f) => f.name),
          column_mapping: columnMapping,
          parser_dropped_count: normalized.droppedCount,
          parser_notes: normalized.notes,
          rows: normalized.rows,
        }),
      });
      const amsBody = await amsResponse.json().catch(() => null);
      if (!amsResponse.ok) {
        logger.error('Security ingest: AMS rejected the report', {
          status: amsResponse.status,
          projectId,
          architectureId,
        });
        res.status(amsResponse.status).json(
          amsBody ?? { error: 'architecture-model-service rejected the report' },
        );
        return;
      }

      // Post-ingest enrichment kick: strictly fire-and-forget.
      kickSecurityCveEnrichment();

      logger.info('Security ingest forwarded', {
        projectId,
        architectureId,
        files: parsed.length,
        rows: normalized.rows.length,
        dropped: normalized.droppedCount,
      });
      res.status(201).json(amsBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('column_mapping must map')) {
        res.status(400).json({ error: message });
        return;
      }
      logger.error('Security ingest failed', {
        error: message,
        projectId,
        architectureId,
      });
      res.status(503).json({ error: 'Security ingest failed', detail: message });
    }
  },
);

// ============================================================================
// POST /security/enrichment/run -- manual enrichment cycle
// ============================================================================
securityFindingsRouter.post('/security/enrichment/run', async (req: Request, res: Response) => {
  const limitRaw = (req.body as { limit?: unknown } | undefined)?.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : 100;
  const result = await runSecurityCveEnrichment(limit);
  res.json(result);
});
