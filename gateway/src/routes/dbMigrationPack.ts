/**
 * DB Schema + Data Migration Pack routes.
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 4 (4.4 route surface, 4.5 zip download, 4.6 staleness) +
 * Task Group 5 (verify -> diff -> persisted drift history).
 *
 * Mounted at `/api/v1` (see `server.ts`). Conventions follow
 * `migrationBookOfWork.ts`: AMS errors round-trip status + body
 * byte-for-byte, `[diag-gw]` route logs + `[diag-gateway]` stage markers,
 * 503 on unreachable upstreams.
 *
 * Routes (all under `/projects/:projectId/db-migration-packs`):
 *
 *   POST  /generate                      — run the deterministic generation
 *                                          pipeline (explicit user action).
 *   POST  /regenerate                    — alias of generate; regeneration is
 *                                          ALWAYS an explicit route call —
 *                                          staleness NEVER auto-triggers it.
 *   GET   /?architecture_id=             — list packs (AMS proxy).
 *   GET   /:packId                       — pack + computed `is_stale` /
 *                                          `staleness_reason` (Task 4.6).
 *   GET   /:packId/files                 — file rows (AMS proxy).
 *   GET   /:packId/manifest              — manifest_json only.
 *   GET   /:packId/decisions             — decision queue (AMS proxy).
 *   POST  /:packId/decisions/:decisionId/resolve      — AMS proxy (AMS marks
 *                                          the pack stale on resolve).
 *   POST  /:packId/decisions/resolve-bulk             — AMS proxy.
 *   GET   /:packId/drift-reports         — verification history (AMS proxy).
 *   PATCH /:packId                       — attach work item (work_item_id).
 *   GET   /:packId/download              — on-demand zip from AMS file rows
 *                                          (no filesystem artifacts).
 *   POST  /:packId/refresh-seeds         — credentialed seed re-scan; updates
 *                                          ONLY the sequences-seed changeset.
 *   GET   /:packId/translations          — translation rows + coverage summary.
 *   POST  /:packId/translations/translate-all          — translate pending+failed.
 *   POST  /:packId/translations/:translationId/translate — translate ONE object.
 *   POST  /:packId/translations/:translationId/retry     — retry failed/stale.
 *   POST  /:packId/translations/:translationId/disposition — set disposition.
 *   POST  /:packId/translations/:translationId/review    — approve/reject/needs-rework
 *                                          (to/from approved re-runs emission).
 *   POST  /:packId/verify                — credentialed verification scan ->
 *                                          deterministic diff -> drift report
 *                                          row APPENDED to history.
 *   POST  /structural-harvest            — Sybase schema harvest (Spec 3,
 *                                          2026-08-04): metadata-only source
 *                                          scan -> auto-approve -> additive
 *                                          save-back -> regenerate -> refreshed
 *                                          finding states. LONG request (up to
 *                                          the poll timeout, default 10 min).
 *   POST  /test-source-connection        — thin discovery-service probe proxy
 *                                          (dbEngine defaulted to sybase) so
 *                                          the harvest modal can pre-flight.
 *
 * Credentials (refresh-seeds / verify / structural-harvest /
 * test-source-connection) live ONLY in the request body and the downstream
 * discovery-service in-process secrets bundle — never persisted, never logged.
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  AmsRoundTripError,
  CoverageAssertionError,
  generateDbMigrationPack,
  refreshDbMigrationPackSeeds,
  SeedScanSequence,
  UnsupportedEnginePairError,
} from '../services/dbMigrationPackHandler';
import {
  DriftAmsRoundTripError,
  runDbMigrationPackVerification,
} from '../services/dbMigrationPackDrift';
import { evaluatePackStaleness } from '../services/dbMigrationPack/staleness';
import { buildZipArchive } from '../services/dbMigrationPack/zip';
import {
  computeCoverageSummary,
  computeSourceBodyHash,
  defaultFetchTranslations,
  defaultPatchTranslation,
  runTranslationPipeline,
  TranslationActionError,
  TranslationCoverageError,
  TranslationDisposition,
  TranslationPatch,
  TranslationReviewStatus,
  TranslationsAmsError,
} from '../services/dbMigrationPack/translations';
import { runTranslationEmission } from '../services/dbMigrationPack/translationEmission';
import {
  StructuralDispositionRow,
  resolveStructuralFindingStates,
} from '../services/migrationStructuralFindings';
import { runStructuralHarvest } from '../services/dbSchemaHarvest';

export const dbMigrationPackRouter = Router();

const BASE = '/projects/:projectId/db-migration-packs';

function amsBase(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

function discoveryBase(): string {
  return getConfig().discoveryServiceBaseUrl;
}

// ---------------------------------------------------------------------------
// Shared error mapping (migrationBookOfWork conventions)
// ---------------------------------------------------------------------------

function mapError(
  error: unknown,
  res: Response,
  routeName: string,
  context: Record<string, unknown>
): void {
  if (error instanceof AmsRoundTripError || error instanceof DriftAmsRoundTripError) {
    logger.warn(`db-migration-pack ${routeName}: AMS error round-trip`, {
      ...context,
      status: error.status,
    });
    res.status(error.status);
    res.setHeader('content-type', 'application/json');
    res.send(
      error.body ||
        JSON.stringify({ error: { code: error.status, message: error.message } })
    );
    return;
  }
  if (error instanceof TranslationsAmsError) {
    logger.warn(`db-migration-pack ${routeName}: AMS translations error round-trip`, {
      ...context,
      status: error.status,
    });
    res.status(error.status);
    res.setHeader('content-type', 'application/json');
    res.send(
      error.body ||
        JSON.stringify({ error: { code: error.status, message: error.message } })
    );
    return;
  }
  if (error instanceof TranslationActionError) {
    res.status(error.status).json({ error: { code: error.status, message: error.message } });
    return;
  }
  if (error instanceof TranslationCoverageError) {
    res.status(500).json({
      error: {
        code: 500,
        message: error.message,
        unaccounted: error.unaccounted,
        invalid: error.invalid,
        unknown: error.unknown,
      },
    });
    return;
  }
  if (error instanceof UnsupportedEnginePairError) {
    res.status(422).json({ error: { code: 422, message: error.message } });
    return;
  }
  if (error instanceof CoverageAssertionError) {
    res.status(500).json({
      error: {
        code: 500,
        message: error.message,
        unaccounted: error.unaccounted,
        duplicated: error.duplicated,
        unknown: error.unknown,
      },
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`db-migration-pack ${routeName}: unexpected error`, {
    ...context,
    error: message,
  });
  res.status(500).json({
    error: { code: 500, message: `db-migration-pack ${routeName} failed`, details: message },
  });
}

/** Thin AMS pass-through proxy (status + body byte-for-byte). */
async function proxyToAms(
  res: Response,
  routeName: string,
  url: string,
  init?: RequestInit
): Promise<void> {
  const start = Date.now();
  try {
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    console.log(
      `[diag-gw] route=db-migration-pack-${routeName} status=${upstream.status} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`db-migration-pack ${routeName} proxy: upstream fetch failed`, {
      url,
      error: message,
    });
    console.warn(
      `[diag-gw] route=db-migration-pack-${routeName} status=503 elapsed_ms=${Date.now() - start}`
    );
    res.status(503).json({
      error: { code: 503, message: 'Architecture model service unavailable', details: message },
    });
  }
}

async function amsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new AmsRoundTripError(response.status, text);
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// POST /generate + POST /regenerate — the explicit HTTP (re)generation paths.
// GET-time staleness NEVER auto-triggers regeneration (2026-06-11 constraint,
// still honoured). Since Spec 2026-07-02-a, Create Migration Plan ALSO
// generates/refreshes via the same handler (`dbMigrationPackEnsure.ts`) as
// part of the user's explicit Generate action.
// ---------------------------------------------------------------------------

async function handleGenerate(
  req: Request,
  res: Response,
  routeName: 'generate' | 'regenerate'
): Promise<void> {
  const { projectId } = req.params;
  const body = (req.body ?? {}) as {
    architecture_id?: string;
    target_architecture_id?: string;
    seed_margin?: number;
  };
  if (!body.architecture_id || typeof body.architecture_id !== 'string') {
    res.status(400).json({
      error: { code: 400, message: 'architecture_id is required.' },
    });
    return;
  }
  const start = Date.now();
  try {
    const result = await generateDbMigrationPack({
      projectId,
      architectureId: body.architecture_id,
      // Optional decision-binding target (Spec 2026-07-02-a): absent →
      // legacy active-target fallback inside defaultFetchDbDecisions.
      targetArchitectureId:
        typeof body.target_architecture_id === 'string' && body.target_architecture_id.length > 0
          ? body.target_architecture_id
          : null,
      seedMargin: typeof body.seed_margin === 'number' ? body.seed_margin : undefined,
    });
    console.log(
      `[diag-gw] route=db-migration-pack-${routeName} status=200 ` +
        `files=${result.fileCount} decisions=${result.decisionCount} elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({
      pack: result.pack,
      input_snapshot_hash: result.inputSnapshotHash,
      counts: result.counts,
      file_count: result.fileCount,
      decision_count: result.decisionCount,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-${routeName} status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, routeName, { projectId });
  }
}

dbMigrationPackRouter.post(`${BASE}/generate`, (req, res) =>
  handleGenerate(req, res, 'generate')
);

// Regenerate is intentionally the same pipeline — a distinct route purely so
// the EXPLICIT user action is visible at the HTTP surface (never automatic).
dbMigrationPackRouter.post(`${BASE}/regenerate`, (req, res) =>
  handleGenerate(req, res, 'regenerate')
);

// ---------------------------------------------------------------------------
// GET / — list packs (AMS proxy)
// ---------------------------------------------------------------------------

dbMigrationPackRouter.get(BASE, async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const architectureId = typeof req.query.architecture_id === 'string'
    ? req.query.architecture_id
    : null;
  const url =
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs` +
    (architectureId ? `?architecture_id=${encodeURIComponent(architectureId)}` : '');
  await proxyToAms(res, 'list', url, { headers: { Accept: 'application/json' } });
});

// ---------------------------------------------------------------------------
// GET /:packId — pack + staleness (Task 4.6). NEVER regenerates.
// ---------------------------------------------------------------------------

dbMigrationPackRouter.get(`${BASE}/:packId`, async (req: Request, res: Response) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const pack = await amsJson<Record<string, unknown>>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}`,
      { headers: { Accept: 'application/json' } }
    );
    // Recompute against the SAME decision-binding target the pack was
    // generated for (persisted in manifest_json.target_architecture_id;
    // null on legacy packs → active-target fallback).
    const manifest = (pack.manifest_json ?? {}) as Record<string, unknown>;
    const boundTargetId =
      typeof manifest.target_architecture_id === 'string' &&
      manifest.target_architecture_id.length > 0
        ? manifest.target_architecture_id
        : null;
    const staleness = await evaluatePackStaleness({
      projectId,
      architectureId: String(pack.architecture_id ?? ''),
      targetArchitectureId: boundTargetId,
      storedHash: (pack.input_snapshot_hash as string | null) ?? null,
      storedStatus: (pack.status as string | null) ?? null,
      storedStaleReason: (pack.stale_reason as string | null) ?? null,
    });
    console.log(
      `[diag-gw] route=db-migration-pack-get status=200 is_stale=${staleness.is_stale} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({
      ...pack,
      is_stale: staleness.is_stale,
      staleness_reason: staleness.staleness_reason,
      current_input_snapshot_hash: staleness.current_input_snapshot_hash,
      staleness_check_error: staleness.staleness_check_error,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-get status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'get', { projectId, packId });
  }
});

// ---------------------------------------------------------------------------
// GET /:packId/files, /:packId/manifest, /:packId/decisions,
// /:packId/drift-reports — read proxies
// ---------------------------------------------------------------------------

dbMigrationPackRouter.get(`${BASE}/:packId/files`, async (req, res) => {
  const { projectId, packId } = req.params;
  await proxyToAms(
    res,
    'files',
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/files`,
    { headers: { Accept: 'application/json' } }
  );
});

dbMigrationPackRouter.get(`${BASE}/:packId/manifest`, async (req, res) => {
  const { projectId, packId } = req.params;
  try {
    const pack = await amsJson<{ manifest_json?: Record<string, unknown> | null }>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}`,
      { headers: { Accept: 'application/json' } }
    );
    res.status(200).json(pack.manifest_json ?? null);
  } catch (error) {
    mapError(error, res, 'manifest', { projectId, packId });
  }
});

dbMigrationPackRouter.get(`${BASE}/:packId/decisions`, async (req, res) => {
  const { projectId, packId } = req.params;
  const params = new URLSearchParams();
  if (typeof req.query.status === 'string') params.set('status', req.query.status);
  if (typeof req.query.category === 'string') params.set('category', req.query.category);
  const qs = params.toString();
  await proxyToAms(
    res,
    'decisions-list',
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/decisions${qs ? `?${qs}` : ''}`,
    { headers: { Accept: 'application/json' } }
  );
});

dbMigrationPackRouter.get(`${BASE}/:packId/drift-reports`, async (req, res) => {
  const { projectId, packId } = req.params;
  await proxyToAms(
    res,
    'drift-reports-list',
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}/drift-reports`,
    { headers: { Accept: 'application/json' } }
  );
});

// ---------------------------------------------------------------------------
// Decision resolve (single + bulk) — AMS proxies. Resolving marks the pack
// stale AMS-side; the next pack GET exposes is_stale accordingly.
// ---------------------------------------------------------------------------

dbMigrationPackRouter.post(
  `${BASE}/:packId/decisions/resolve-bulk`,
  async (req, res) => {
    const { projectId, packId } = req.params;
    await proxyToAms(
      res,
      'decisions-resolve-bulk',
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}/decisions/resolve-bulk`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      }
    );
  }
);

dbMigrationPackRouter.post(
  `${BASE}/:packId/decisions/:decisionId/resolve`,
  async (req, res) => {
    const { projectId, packId, decisionId } = req.params;
    await proxyToAms(
      res,
      'decision-resolve',
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}` +
        `/decisions/${encodeURIComponent(decisionId)}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      }
    );
  }
);

// ---------------------------------------------------------------------------
// PATCH /:packId — attach work item (DB-epic, `work_item_id`) — AMS proxy
// ---------------------------------------------------------------------------

dbMigrationPackRouter.patch(`${BASE}/:packId`, async (req, res) => {
  const { projectId, packId } = req.params;
  await proxyToAms(
    res,
    'patch',
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
      `/db-migration-packs/${encodeURIComponent(packId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    }
  );
});

// ---------------------------------------------------------------------------
// GET /:packId/download — on-demand zip (Task 4.5). Assembled in memory from
// the AMS file rows; NO filesystem artifacts at any point.
// ---------------------------------------------------------------------------

dbMigrationPackRouter.get(`${BASE}/:packId/download`, async (req, res) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const files = await amsJson<
      Array<{ file_path: string; content: string; sort_order: number }>
    >(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}/files`,
      { headers: { Accept: 'application/json' } }
    );
    if (!Array.isArray(files) || files.length === 0) {
      res.status(404).json({
        error: { code: 404, message: `Pack ${packId} has no files to download.` },
      });
      return;
    }
    const ordered = [...files].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const archive = buildZipArchive(
      ordered.map((f) => ({ path: f.file_path, content: f.content ?? '' }))
    );
    console.log(
      `[diag-gw] route=db-migration-pack-download status=200 entries=${ordered.length} ` +
        `bytes=${archive.length} elapsed_ms=${Date.now() - start}`
    );
    res.status(200);
    res.setHeader('content-type', 'application/zip');
    res.setHeader(
      'content-disposition',
      `attachment; filename="db-migration-pack-${packId}.zip"`
    );
    res.send(archive);
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-download status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'download', { projectId, packId });
  }
});

// ---------------------------------------------------------------------------
// POST /:packId/refresh-seeds — credentialed seed re-scan (discovery-service)
// -> regenerate ONLY the sequences-seed changeset. Credentials pass through
// per invocation; never persisted, never logged.
// ---------------------------------------------------------------------------

dbMigrationPackRouter.post(`${BASE}/:packId/refresh-seeds`, async (req, res) => {
  const { projectId, packId } = req.params;
  const body = (req.body ?? {}) as {
    db?: Record<string, unknown>;
    username?: string;
    password?: string;
  };
  if (!body.db || typeof body.db !== 'object') {
    res.status(400).json({
      error: { code: 400, message: 'db connection details are required.' },
    });
    return;
  }
  if (!body.username || !body.password) {
    res.status(400).json({
      error: {
        code: 400,
        message: 'username and password are required (per-invocation; never persisted).',
      },
    });
    return;
  }
  const start = Date.now();
  try {
    logger.info(
      `[diag-gateway] db_migration_pack_refresh_seeds stage=scan projectId=${projectId} packId=${packId}`
    );
    const scanResponse = await fetch(`${discoveryBase()}/discovery/db/refresh-seeds-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...body.db,
        username: body.username,
        password: body.password,
      }),
    });
    const scanText = await scanResponse.text().catch(() => '');
    if (!scanResponse.ok) {
      console.warn(
        `[diag-gw] route=db-migration-pack-refresh-seeds status=${scanResponse.status} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(scanResponse.status);
      const contentType = scanResponse.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(scanText);
      return;
    }
    const scan = JSON.parse(scanText) as { sequences?: SeedScanSequence[] };

    const result = await refreshDbMigrationPackSeeds({
      projectId,
      packId,
      scanSequences: scan.sequences ?? [],
    });
    console.log(
      `[diag-gw] route=db-migration-pack-refresh-seeds status=200 ` +
        `changed=${result.seedChangesetChanged} sequences=${result.scanSequenceCount} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({
      pack: result.pack,
      updated_file_path: result.updatedFilePath,
      seed_changeset_changed: result.seedChangesetChanged,
      scan_sequence_count: result.scanSequenceCount,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-refresh-seeds status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'refresh-seeds', { projectId, packId });
  }
});


// ---------------------------------------------------------------------------
// Translations (Spec 2026-06-11 LLM-Assisted DB Object Translation Drafts —
// Task Group 3.7 + 4.3). Persistence proxies to the Group-2 AMS endpoints;
// LLM appears ONLY inside the translate/judge pipeline calls. Review-status
// changes to/from 'approved' (and disposition changes on an approved row)
// re-run the approved-only emission so the executable path NEVER carries an
// unapproved draft.
// ---------------------------------------------------------------------------

const REVIEW_STATUS_BY_ACTION: Record<string, TranslationReviewStatus> = {
  approve: 'approved',
  reject: 'rejected',
  needs_rework: 'needs_rework',
};

const TRANSLATION_DISPOSITIONS: TranslationDisposition[] = [
  'translate',
  'rewrite_in_app',
  'drop',
];

/** GET — list translation rows + the deterministic coverage summary. */
dbMigrationPackRouter.get(`${BASE}/:packId/translations`, async (req, res) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const rows = await defaultFetchTranslations(projectId, packId);
    console.log(
      `[diag-gw] route=db-migration-pack-translations-list status=200 ` +
        `rows=${rows.length} elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({ translations: rows, coverage: computeCoverageSummary(rows) });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-translations-list status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'translations-list', { projectId, packId });
  }
});

/** POST translate-all — pending + failed ONLY (drafted/approved/dispositioned/needs_manual skipped). */
dbMigrationPackRouter.post(`${BASE}/:packId/translations/translate-all`, async (req, res) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const result = await runTranslationPipeline({ projectId, packId, scope: { mode: 'all' } });
    console.log(
      `[diag-gw] route=db-migration-pack-translate-all status=200 ` +
        `outcomes=${result.outcomes.length} elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({ outcomes: result.outcomes, coverage: result.coverage });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-translate-all status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'translate-all', { projectId, packId });
  }
});

async function handleSingleTranslate(
  req: Request,
  res: Response,
  mode: 'single' | 'retry'
): Promise<void> {
  const { projectId, packId, translationId } = req.params;
  const routeName = mode === 'retry' ? 'translation-retry' : 'translation-translate';
  const start = Date.now();
  try {
    const result = await runTranslationPipeline({
      projectId,
      packId,
      scope: { mode, translationId },
    });
    console.log(
      `[diag-gw] route=db-migration-pack-${routeName} status=200 elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({ outcomes: result.outcomes, coverage: result.coverage });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-${routeName} status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, routeName, { projectId, packId, translationId });
  }
}

/** POST — translate / re-translate ONE object (re-translate resets review to unreviewed). */
dbMigrationPackRouter.post(
  `${BASE}/:packId/translations/:translationId/translate`,
  (req, res) => handleSingleTranslate(req, res, 'single')
);

/** POST — retry a failed (or stale 'translating') object. */
dbMigrationPackRouter.post(
  `${BASE}/:packId/translations/:translationId/retry`,
  (req, res) => handleSingleTranslate(req, res, 'retry')
);

/** POST — set disposition (translate | rewrite_in_app | drop + mandatory reason). */
dbMigrationPackRouter.post(
  `${BASE}/:packId/translations/:translationId/disposition`,
  async (req, res) => {
    const { projectId, packId, translationId } = req.params;
    const body = (req.body ?? {}) as { disposition?: string; drop_reason?: string };
    const start = Date.now();
    try {
      if (
        !body.disposition ||
        !TRANSLATION_DISPOSITIONS.includes(body.disposition as TranslationDisposition)
      ) {
        throw new TranslationActionError(
          400,
          `disposition must be one of ${TRANSLATION_DISPOSITIONS.join(' | ')}.`
        );
      }
      const disposition = body.disposition as TranslationDisposition;
      if (disposition === 'drop' && (!body.drop_reason || body.drop_reason.trim().length === 0)) {
        throw new TranslationActionError(
          400,
          'drop_reason is required when disposition is drop — dropped objects always carry an explicit reason.'
        );
      }
      const rows = await defaultFetchTranslations(projectId, packId);
      const row = rows.find((r) => r.id === translationId);
      if (!row) {
        throw new TranslationActionError(
          404,
          `Translation ${translationId} not found on pack ${packId}.`
        );
      }
      const patch: TranslationPatch = { disposition };
      if (disposition === 'drop') patch.drop_reason = body.drop_reason!.trim();
      if (disposition === 'translate' && row.disposition !== 'translate') {
        // Flipping back to translate returns the row to pending (or terminal
        // needs_manual when the captured body is truncated).
        patch.pipeline_state = row.truncated === true ? 'needs_manual' : 'pending';
      }
      const updated = await defaultPatchTranslation(projectId, packId, translationId, patch);
      // An APPROVED row dispositioned away must leave the executable path
      // immediately (and vice versa on return) — re-run the emission.
      let emission = null;
      if (row.review_status === 'approved') {
        const emissionResult = await runTranslationEmission(projectId, packId);
        emission = {
          approved_count: emissionResult.approvedCount,
          emitted_file_paths: emissionResult.emittedFilePaths,
          changed: emissionResult.changed,
        };
      }
      console.log(
        `[diag-gw] route=db-migration-pack-translation-disposition status=200 ` +
          `disposition=${disposition} elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({ translation: updated, emission });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-migration-pack-translation-disposition status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'translation-disposition', { projectId, packId, translationId });
    }
  }
);

/**
 * POST — supply the FULL source body for a truncated capture (gold standard
 * 2026-08-07). `needs_manual (truncated)` used to be a terminal dead-end —
 * the only remedy was manual work outside the tool. The operator pastes the
 * complete T-SQL body; the row's hash recomputes, the fidelity flags clear,
 * and the pipeline returns to `pending` for a fresh translate. A previously
 * approved/drafted row demotes to needs_rework (approval NEVER silently
 * survives a source change) and the emission re-runs to drop it from the
 * executable path until re-approved.
 */
dbMigrationPackRouter.post(
  `${BASE}/:packId/translations/:translationId/supply-body`,
  async (req, res) => {
    const { projectId, packId, translationId } = req.params;
    const body = (req.body ?? {}) as { source_body?: string };
    const start = Date.now();
    try {
      const sourceBody = typeof body.source_body === 'string' ? body.source_body : '';
      if (sourceBody.trim().length === 0) {
        throw new TranslationActionError(400, 'source_body is required (the complete source text).');
      }
      const rows = await defaultFetchTranslations(projectId, packId);
      const row = rows.find((r) => r.id === translationId);
      if (!row) {
        throw new TranslationActionError(
          404,
          `Translation ${translationId} not found on pack ${packId}.`
        );
      }
      const patch: TranslationPatch = {
        source_body: sourceBody,
        source_body_hash: computeSourceBodyHash(sourceBody),
        truncated: false,
        legacy_redacted: false,
        pipeline_state: 'pending',
      };
      const hadWork =
        (typeof row.draft_content === 'string' && row.draft_content.length > 0) ||
        row.review_status === 'approved' ||
        row.review_status === 'rejected';
      if (hadWork) {
        patch.review_status = 'needs_rework';
        patch.reviewer_notes =
          `${row.reviewer_notes ? `${row.reviewer_notes}
` : ''}` +
          '[auto] Full source body supplied by the operator (was truncated); prior ' +
          'draft/review demoted to needs_rework — re-translate and re-review against ' +
          'the complete source. Approval never silently survives a source change.';
      }
      const updated = await defaultPatchTranslation(projectId, packId, translationId, patch);
      let emission = null;
      if (row.review_status === 'approved') {
        const emissionResult = await runTranslationEmission(projectId, packId);
        emission = {
          approved_count: emissionResult.approvedCount,
          emitted_file_paths: emissionResult.emittedFilePaths,
          changed: emissionResult.changed,
        };
      }
      console.log(
        `[diag-gw] route=db-migration-pack-translation-supply-body status=200 ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({ translation: updated, emission });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-migration-pack-translation-supply-body status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'translation-supply-body', { projectId, packId, translationId });
    }
  }
);

/** POST — review action (approve / reject / needs_rework + optional notes). */
dbMigrationPackRouter.post(
  `${BASE}/:packId/translations/:translationId/review`,
  async (req, res) => {
    const { projectId, packId, translationId } = req.params;
    const body = (req.body ?? {}) as { action?: string; notes?: string };
    const start = Date.now();
    try {
      const newStatus = body.action ? REVIEW_STATUS_BY_ACTION[body.action] : undefined;
      if (!newStatus) {
        throw new TranslationActionError(
          400,
          `action must be one of ${Object.keys(REVIEW_STATUS_BY_ACTION).join(' | ')}.`
        );
      }
      const rows = await defaultFetchTranslations(projectId, packId);
      const row = rows.find((r) => r.id === translationId);
      if (!row) {
        throw new TranslationActionError(
          404,
          `Translation ${translationId} not found on pack ${packId}.`
        );
      }
      if (row.pipeline_state === 'needs_manual') {
        throw new TranslationActionError(
          400,
          `Translation ${row.translation_key} needs manual translation (body truncated at capture) — no review is possible.`
        );
      }
      if (
        newStatus === 'approved' &&
        (row.pipeline_state !== 'drafted' || !row.draft_content || !row.judge_verdict_json)
      ) {
        throw new TranslationActionError(
          400,
          `Only a drafted translation carrying its judge verdict can be approved (${row.translation_key} is '${row.pipeline_state}').`
        );
      }
      const patch: TranslationPatch = { review_status: newStatus };
      if (typeof body.notes === 'string') patch.reviewer_notes = body.notes;
      const updated = await defaultPatchTranslation(projectId, packId, translationId, patch);
      // Emission re-runs whenever review status changes to/from approved —
      // the approved-only invariant on the executable path (Task 4.3).
      let emission = null;
      if (newStatus === 'approved' || row.review_status === 'approved') {
        const emissionResult = await runTranslationEmission(projectId, packId);
        emission = {
          approved_count: emissionResult.approvedCount,
          emitted_file_paths: emissionResult.emittedFilePaths,
          changed: emissionResult.changed,
        };
      }
      console.log(
        `[diag-gw] route=db-migration-pack-translation-review status=200 ` +
          `action=${body.action} elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({ translation: updated, emission });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-migration-pack-translation-review status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'translation-review', { projectId, packId, translationId });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:packId/translations/approve-all — bulk approve (2026-08-08).
//
// The first Approve-all shipped as a CLIENT-side loop over the single review
// route: it admitted rows the approve gate always rejects (drafted content
// but no judge verdict) so the run ended in a wall of 400s, and it re-ran
// the approved-only emission PER approve — punishing on an 800-row pack.
// Server-side instead: filter to the truly approvable rows ONCE (the exact
// gate the single-review route enforces), PATCH each fail-soft, then run ONE
// emission at the end. Rows an operator must handle individually are
// reported honestly in `not_approvable` (never silently skipped).
// ---------------------------------------------------------------------------
dbMigrationPackRouter.post(`${BASE}/:packId/translations/approve-all`, async (req, res) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const rows = await defaultFetchTranslations(projectId, packId);
    const unreviewedTranslate = rows.filter(
      (r) => r.disposition === 'translate' && r.review_status === 'unreviewed'
    );
    // The single-review approve gate, verbatim: drafted + draft + verdict.
    const eligible = unreviewedTranslate.filter(
      (r) => r.pipeline_state === 'drafted' && !!r.draft_content && !!r.judge_verdict_json
    );
    const notApprovable = unreviewedTranslate
      .filter((r) => !eligible.includes(r))
      .map((r) => ({
        translation_key: r.translation_key,
        pipeline_state: r.pipeline_state,
        reason:
          r.pipeline_state !== 'drafted'
            ? `pipeline state '${r.pipeline_state}' — translate it first`
            : !r.draft_content
              ? 'no draft content'
              : 'no judge verdict — re-run Translate to judge the draft',
      }));

    const failed: Array<{ translation_key: string; reason: string }> = [];
    let approvedCount = 0;
    for (const row of eligible) {
      try {
        await defaultPatchTranslation(projectId, packId, row.id, {
          review_status: 'approved',
        });
        approvedCount += 1;
      } catch (error) {
        failed.push({
          translation_key: row.translation_key,
          reason: error instanceof Error ? error.message : 'patch failed',
        });
      }
    }

    // ONE emission for the whole batch (vs one per approve on the old path).
    let emission = null;
    if (approvedCount > 0) {
      const emissionResult = await runTranslationEmission(projectId, packId);
      emission = {
        approved_count: emissionResult.approvedCount,
        emitted_file_paths: emissionResult.emittedFilePaths,
        changed: emissionResult.changed,
      };
    }

    console.log(
      `[diag-gw] route=db-migration-pack-translations-approve-all status=200 ` +
        `approved=${approvedCount} not_approvable=${notApprovable.length} ` +
        `failed=${failed.length} elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({
      approved_count: approvedCount,
      eligible_count: eligible.length,
      not_approvable: notApprovable,
      failed,
      emission,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-translations-approve-all status=err ` +
        `elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'translations-approve-all', { projectId, packId });
  }
});

// ---------------------------------------------------------------------------
// POST /:packId/verify — credentialed verification scan -> deterministic
// diff -> drift-report row APPENDED to history (Task Group 5).
// ---------------------------------------------------------------------------

dbMigrationPackRouter.post(`${BASE}/:packId/verify`, async (req, res) => {
  const { projectId, packId } = req.params;
  const body = (req.body ?? {}) as {
    db?: {
      host?: string;
      port?: number;
      databaseName?: string;
      schemaName?: string | null;
      queryTimeoutSeconds?: number;
    };
    username?: string;
    password?: string;
    scope?: { schemas?: string[]; tables?: string[] } | null;
  };
  if (!body.db || typeof body.db !== 'object' || !body.db.host) {
    res.status(400).json({
      error: { code: 400, message: 'db connection details (incl. host) are required.' },
    });
    return;
  }
  if (!body.username || !body.password) {
    res.status(400).json({
      error: {
        code: 400,
        message: 'username and password are required (per-invocation; never persisted).',
      },
    });
    return;
  }
  const start = Date.now();
  try {
    const result = await runDbMigrationPackVerification({
      projectId,
      packId,
      connection: {
        host: body.db.host,
        port: body.db.port ?? 5432,
        databaseName: body.db.databaseName ?? '',
        schemaName: body.db.schemaName ?? null,
        queryTimeoutSeconds: body.db.queryTimeoutSeconds,
        username: body.username,
        password: body.password,
      },
      scope: body.scope ?? null,
    });
    console.log(
      `[diag-gw] route=db-migration-pack-verify status=200 ` +
        `match=${result.report.summary.match_count} ` +
        `missing=${result.report.summary.missing_count} ` +
        `mismatch=${result.report.summary.mismatch_count} elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({
      report: result.report,
      drift_report: result.persisted,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-verify status=err elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'verify', { projectId, packId });
  }
});

// ---------------------------------------------------------------------------
// POST /projects/:projectId/db-migration-packs/:packId/revalidate-db-consumers
// (Spec 2026-07-06-f §5 — scoped revalidation of the DB change's code-side
// blast radius). Computes the AFFECTED endpoint set (translated procs / T-SQL
// dialect SQL / altered tables) and runs ONE replay+diff SCOPED to exactly
// those endpoints against the pinned current baseline. Target auth is
// per-invocation, held in memory, pushed only to the validation service's
// in-memory secretsStore — NEVER persisted (the Spec E credentials pattern).
// ---------------------------------------------------------------------------
dbMigrationPackRouter.post(
  `${BASE}/:packId/revalidate-db-consumers`,
  async (req, res) => {
    const { projectId, packId } = req.params as { projectId: string; packId: string };
    const start = Date.now();
    try {
      const body = (req.body ?? {}) as {
        current_architecture_id?: string;
        source_baseline_id?: string;
        target_base_url?: string;
        api?: unknown;
        altered_table_names?: string[];
      };
      if (!body.current_architecture_id || !body.source_baseline_id || !body.target_base_url) {
        res.status(400).json({
          error: {
            code: 400,
            message:
              'current_architecture_id, source_baseline_id and target_base_url are required',
          },
        });
        return;
      }
      if (!body.api || typeof body.api !== 'object') {
        res.status(400).json({
          error: { code: 400, message: 'api (per-invocation target auth) is required' },
        });
        return;
      }

      // The pack's translate-disposition rows define the proc/view object set.
      const translations = await defaultFetchTranslations(projectId, packId);
      const { packObjectSetFromTranslations, revalidateDbConsumers } = await import(
        '../services/dbChangeConsumerResolver'
      );
      const packObjects = packObjectSetFromTranslations(
        translations,
        Array.isArray(body.altered_table_names) ? body.altered_table_names : []
      );

      const result = await revalidateDbConsumers({
        projectId,
        currentArchitectureId: body.current_architecture_id,
        sourceBaselineId: body.source_baseline_id,
        targetBaseUrl: body.target_base_url,
        api: body.api as never,
        packObjects,
      });

      console.log(
        `[diag-gw] route=db-migration-pack-revalidate-consumers status=200 ` +
          `affected=${result.affected.affectedEndpointIds.length} ` +
          `clean=${result.verdict?.clean ?? 'n/a'} elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({
        affected_endpoint_ids: result.affected.affectedEndpointIds,
        affected_endpoint_keys: result.affected.affectedEndpointKeys,
        reasons: Object.fromEntries(result.affected.reasonsByEndpointId),
        verdict: result.verdict,
      });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-migration-pack-revalidate-consumers status=err ` +
          `elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'revalidate-db-consumers', { projectId, packId });
    }
  }
);

// ---------------------------------------------------------------------------
// Structural findings + dispositions (Spec 2026-08-04-2). The pack generator
// emits structured `structural_findings` (stable kind:subject identities);
// dispositions persist PER PROJECT in AMS so they survive regeneration. This
// merged view is what the Schema-migration tab's findings panel renders; the
// disposition writes proxy to AMS. Resolution is never a manual flag — a
// regenerated pack that stops emitting a finding auto-clears it.
// ---------------------------------------------------------------------------

/** GET — the pack's current findings joined with the project dispositions. */
dbMigrationPackRouter.get(`${BASE}/:packId/structural-findings`, async (req, res) => {
  const { projectId, packId } = req.params;
  const start = Date.now();
  try {
    const pack = await amsJson<{ manifest_json?: Record<string, unknown> | null }>(
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}`
    );
    let dispositions: StructuralDispositionRow[] = [];
    try {
      dispositions = await amsJson<StructuralDispositionRow[]>(
        `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
          `/db-structural-finding-dispositions`
      );
    } catch (error) {
      // Older AMS without the endpoint: findings render as undispositioned.
      logger.warn('db-migration-pack structural-findings: dispositions read failed', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const manifest = (pack.manifest_json ?? {}) as {
      structural_findings?: Array<{ kind: string; subject: string; message: string }>;
      structural_warnings?: string[];
    };
    const findings = resolveStructuralFindingStates(manifest, dispositions);
    console.log(
      `[diag-gw] route=db-migration-pack-structural-findings status=200 ` +
        `findings=${findings.length} open=${findings.filter((f) => f.open).length} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.status(200).json({ findings });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-structural-findings status=err ` +
        `elapsed_ms=${Date.now() - start}`
    );
    mapError(error, res, 'structural-findings', { projectId, packId });
  }
});

/**
 * PUT — set/replace one finding's disposition (accepted | fix_upstream |
 * known_gap; note required for accepted/known_gap — AMS validates). Proxied
 * to the project-scoped AMS store; the finding key rides URL-encoded.
 */
dbMigrationPackRouter.put(
  `${BASE}/:packId/structural-findings/:findingKey/disposition`,
  async (req, res) => {
    const { projectId, findingKey } = req.params;
    await proxyToAms(
      res,
      'structural-finding-disposition',
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-structural-finding-dispositions/${encodeURIComponent(findingKey)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      }
    );
  }
);

/** DELETE — remove a disposition (the finding re-opens). */
dbMigrationPackRouter.delete(
  `${BASE}/:packId/structural-findings/:findingKey/disposition`,
  async (req, res) => {
    const { projectId, findingKey } = req.params;
    await proxyToAms(
      res,
      'structural-finding-disposition-delete',
      `${amsBase()}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-structural-finding-dispositions/${encodeURIComponent(findingKey)}`,
      { method: 'DELETE' }
    );
  }
);

// ---------------------------------------------------------------------------
// Sybase schema harvest (Spec 3, 2026-08-04). Closes structural findings by
// harvesting catalog truth from the live SOURCE database: metadata-only
// discovery scan -> auto-approve -> additive save-back -> regenerate ->
// refreshed finding states. Full orchestration doc in
// services/dbSchemaHarvest.ts.
//
// TIMEOUT NOTE: this is deliberately a LONG synchronous request — it holds
// the HTTP connection while polling the discovery run (default cap 10 min via
// DB_HARVEST_POLL_TIMEOUT_MS). The gateway's Node server uses the platform
// defaults (`server.timeout` = 0 / disabled since Node 13 — server.ts sets no
// explicit response timeout, same posture the /verify credentialed-scan route
// relies on), so the response window is bounded by our own poll deadline, not
// by the server. Callers (FE fetch) must set their own client timeout ≥ the
// poll cap.
//
// FAILURE CONTRACT: chain failures are DATA, not transport errors — the
// response is 200 with `stage` ∈ {completed, scan_failed, save_failed,
// regenerate_failed} + `error`. 4xx is reserved for request-shape problems,
// 5xx for gateway-side crashes.
// ---------------------------------------------------------------------------

dbMigrationPackRouter.post(`${BASE}/structural-harvest`, async (req, res) => {
  const { projectId } = req.params;
  // snake_case body (FE/gateway wire convention for this route family).
  const body = (req.body ?? {}) as {
    architecture_id?: string;
    target_architecture_id?: string;
    host?: string;
    port?: number;
    database_name?: string;
    username?: string;
    password?: string;
    sybase_driver?: string;
    include_schemas?: string[];
    service_id?: string;
  };

  const missing: string[] = [];
  if (!body.architecture_id || typeof body.architecture_id !== 'string') {
    missing.push('architecture_id');
  }
  if (!body.host || typeof body.host !== 'string') missing.push('host');
  if (typeof body.port !== 'number' || body.port <= 0 || body.port > 65535) {
    missing.push('port');
  }
  if (!body.database_name || typeof body.database_name !== 'string') {
    missing.push('database_name');
  }
  if (!body.username || typeof body.username !== 'string') missing.push('username');
  if (!body.password || typeof body.password !== 'string') missing.push('password');
  if (missing.length > 0) {
    res.status(400).json({
      error: {
        code: 400,
        message:
          `Missing/invalid required field(s): ${missing.join(', ')}. ` +
          `(password is request-body only; never persisted.)`,
      },
    });
    return;
  }

  const start = Date.now();
  try {
    const result = await runStructuralHarvest({
      projectId,
      architectureId: body.architecture_id!,
      targetArchitectureId:
        typeof body.target_architecture_id === 'string' &&
        body.target_architecture_id.length > 0
          ? body.target_architecture_id
          : null,
      serviceId: typeof body.service_id === 'string' ? body.service_id : null,
      connection: {
        host: body.host!,
        port: body.port!,
        databaseName: body.database_name!,
        username: body.username!,
        password: body.password!,
        sybaseDriver:
          typeof body.sybase_driver === 'string' ? body.sybase_driver : undefined,
        includeSchemas: Array.isArray(body.include_schemas)
          ? body.include_schemas
          : undefined,
      },
    });
    console.log(
      `[diag-gw] route=db-migration-pack-structural-harvest status=200 ` +
        `stage=${result.stage} run=${result.runId ?? 'none'} ` +
        `findings=${result.findings.length} elapsed_ms=${Date.now() - start}`
    );
    // snake_case response envelope around the structured result.
    res.status(200).json({
      run_id: result.runId,
      run_status: result.runStatus,
      saved_back: result.savedBack
        ? {
            entities_created: result.savedBack.entitiesCreated,
            entities_skipped: result.savedBack.entitiesSkipped,
            candidates_committed: result.savedBack.candidatesCommitted,
          }
        : null,
      pack_regenerated: result.packRegenerated,
      findings: result.findings,
      stage: result.stage,
      error: result.error ?? null,
    });
  } catch (error) {
    console.warn(
      `[diag-gw] route=db-migration-pack-structural-harvest status=err ` +
        `elapsed_ms=${Date.now() - start}`
    );
    // runStructuralHarvest only throws on gateway-side programming errors —
    // mapError's generic branch logs the message (never credentials; the
    // orchestrator builds errors from HTTP status + upstream text only).
    mapError(error, res, 'structural-harvest', { projectId });
  }
});

/**
 * POST /test-source-connection — thin pass-through to the discovery-service
 * connection probe so the harvest modal can pre-flight credentials before
 * committing to a scan. Body forwarded verbatim except `dbEngine`, which is
 * defaulted (not forced) to 'sybase' — the harvest flow is Sybase-scoped
 * today, but an explicit engine in the body wins so the route needs no change
 * when other source engines arrive. Upstream returns 200 {success:true,...}
 * or 400 {success:false, error} — both proxied byte-for-byte; credentials
 * exist only in the request body (discovery-service purges its in-memory
 * copy after the probe).
 */
dbMigrationPackRouter.post(`${BASE}/test-source-connection`, async (req, res) => {
  const start = Date.now();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = `${discoveryBase()}/discovery/db/test-connection`;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ dbEngine: 'sybase', ...body }),
    });
    const text = await upstream.text();
    console.log(
      `[diag-gw] route=db-migration-pack-test-source-connection ` +
        `status=${upstream.status} elapsed_ms=${Date.now() - start}`
    );
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // No request context in the log — the body carries credentials.
    logger.error('db-migration-pack test-source-connection: upstream fetch failed', {
      url,
      error: message,
    });
    console.warn(
      `[diag-gw] route=db-migration-pack-test-source-connection status=503 ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.status(503).json({
      error: { code: 503, message: 'Discovery service unavailable', details: message },
    });
  }
});
