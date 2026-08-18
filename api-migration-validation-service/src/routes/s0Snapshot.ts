/**
 * S0 snapshot routes (Capture-State Discipline Spec 2).
 *
 *   POST /api/s0-snapshot/run      — take a snapshot of the committed model's
 *                                    tables from the live source DB
 *   GET  /api/s0-snapshot/latest   — latest snapshot manifest summary
 *   POST /api/s0-snapshot/verify   — fingerprint the live DB vs a snapshot
 *   POST /api/s0-snapshot/restore  — truncate + bulk-in from a snapshot
 *                                    (requires confirm: true), then verify
 *
 * Synchronous long-running POSTs — the same posture as the data-migration
 * and schema-apply run routes. Credentials arrive in the request body, live
 * in function scope only, never logged, never persisted.
 */

import { Router, Request, Response } from 'express';

import { createDbAdapter } from '../services/db/dbAdapterFactory';
import type { DbConnectionConfig, DbType } from '../types/db';
import {
  fetchCompensationMetadataIndex,
} from '../services/compensation/compensationMetadata';
import {
  PostgresCompensationWriteAdapter,
  SybaseCompensationWriteAdapter,
  CompensationWriteAdapter,
} from '../services/compensation/WriteAdapter';
import { verifyS0Fingerprint } from '../services/s0/fingerprint';
import { latestSnapshotId, readManifest, snapshotDirFor } from '../services/s0/manifest';
import { runS0Restore } from '../services/s0/restoreRunner';
import { runS0Snapshot } from '../services/s0/snapshotRunner';
import { createTracer } from '../trace';

const trace = createTracer('s0-snapshot');

interface DbBlock {
  db_type?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string | null;
  username?: string;
  password?: string;
}

interface S0Body {
  project_id?: string;
  architecture_id?: string;
  source_db?: DbBlock;
  snapshot_id?: string;
  confirm?: boolean;
}

function dbBlockError(block: DbBlock | undefined): string | null {
  if (!block) return 'source_db is required';
  if (block.db_type !== 'sybase' && block.db_type !== 'postgres') {
    return "source_db.db_type must be 'sybase' or 'postgres'";
  }
  for (const field of ['host', 'database', 'username', 'password'] as const) {
    if (!block[field] || typeof block[field] !== 'string') {
      return `source_db.${field} is required`;
    }
  }
  if (typeof block.port !== 'number' || !Number.isFinite(block.port)) {
    return 'source_db.port is required';
  }
  return null;
}

function toConnectionConfig(block: DbBlock): DbConnectionConfig {
  return {
    dbType: block.db_type as DbType,
    host: block.host as string,
    port: block.port as number,
    database: block.database as string,
    schema: block.schema ?? null,
    username: block.username as string,
    password: block.password as string,
  };
}

function writeAdapterFor(config: DbConnectionConfig): CompensationWriteAdapter {
  return config.dbType === 'postgres'
    ? new PostgresCompensationWriteAdapter(config)
    : new SybaseCompensationWriteAdapter(config);
}

async function requireContext(
  body: S0Body,
  res: Response,
): Promise<{ config: DbConnectionConfig; projectId: string; architectureId: string } | null> {
  if (!body.project_id) {
    res.status(400).json({ error: 'project_id is required' });
    return null;
  }
  if (!body.architecture_id) {
    res.status(400).json({ error: 'architecture_id is required' });
    return null;
  }
  const dbError = dbBlockError(body.source_db);
  if (dbError) {
    res.status(400).json({ error: dbError });
    return null;
  }
  return {
    config: toConnectionConfig(body.source_db as DbBlock),
    projectId: body.project_id,
    architectureId: body.architecture_id,
  };
}

function resolveManifest(
  projectId: string,
  architectureId: string,
  snapshotId: string | undefined,
  res: Response,
): { snapshotId: string; dir: string; manifest: NonNullable<ReturnType<typeof readManifest>> } | null {
  const resolved = snapshotId ?? latestSnapshotId(projectId, architectureId);
  if (!resolved) {
    res.status(404).json({ error: 'no S0 snapshot exists for this architecture' });
    return null;
  }
  const dir = snapshotDirFor(projectId, architectureId, resolved);
  const manifest = readManifest(dir);
  if (!manifest) {
    res.status(404).json({ error: `snapshot ${resolved} has no readable manifest` });
    return null;
  }
  return { snapshotId: resolved, dir, manifest };
}

export function buildS0SnapshotRouter(): Router {
  const router = Router({ mergeParams: true });

  router.post('/api/s0-snapshot/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as S0Body;
    const ctx = await requireContext(body, res);
    if (!ctx) return;
    const metadata = await fetchCompensationMetadataIndex(ctx.projectId, ctx.architectureId);
    if (!metadata || metadata.byTable.size === 0) {
      return res.status(422).json({
        error:
          'the committed model exposes no physical tables — run/commit database discovery first',
      });
    }
    const adapter = createDbAdapter(ctx.config);
    try {
      trace.detail('s0.snapshot.start', {
        tables: metadata.byTable.size,
        dbType: ctx.config.dbType,
      });
      const result = await runS0Snapshot({
        adapter,
        metadata,
        projectId: ctx.projectId,
        architectureId: ctx.architectureId,
        sourceDbType: ctx.config.dbType,
        schema: ctx.config.schema ?? null,
      });
      trace.detail('s0.snapshot.done', {
        snapshotId: result.snapshotId,
        tables: result.manifest.tables.length,
      });
      return res.status(200).json({ snapshot_id: result.snapshotId, manifest: result.manifest });
    } catch (err) {
      return res.status(500).json({
        error: `S0 snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      await adapter.dispose();
    }
  });

  router.get('/api/s0-snapshot/latest', (req: Request, res: Response) => {
    const projectId = String(req.query.project_id ?? '');
    const architectureId = String(req.query.architecture_id ?? '');
    if (!projectId || !architectureId) {
      return res.status(400).json({ error: 'project_id and architecture_id are required' });
    }
    const snapshotId = latestSnapshotId(projectId, architectureId);
    if (!snapshotId) return res.status(200).json({ snapshot: null });
    const manifest = readManifest(snapshotDirFor(projectId, architectureId, snapshotId));
    return res.status(200).json({ snapshot: manifest });
  });

  router.post('/api/s0-snapshot/verify', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as S0Body;
    const ctx = await requireContext(body, res);
    if (!ctx) return;
    const resolved = resolveManifest(ctx.projectId, ctx.architectureId, body.snapshot_id, res);
    if (!resolved) return;
    const metadata = await fetchCompensationMetadataIndex(ctx.projectId, ctx.architectureId);
    if (!metadata) {
      return res.status(422).json({ error: 'could not read the committed model' });
    }
    const adapter = createDbAdapter(ctx.config);
    try {
      const report = await verifyS0Fingerprint(
        adapter,
        metadata,
        resolved.manifest,
        ctx.config.schema ?? null,
      );
      trace.detail('s0.verify.done', {
        snapshotId: resolved.snapshotId,
        matches: report.matches,
        mismatches: report.mismatches.length,
      });
      return res.status(200).json({ snapshot_id: resolved.snapshotId, report });
    } catch (err) {
      return res.status(500).json({
        error: `S0 verify failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      await adapter.dispose();
    }
  });

  router.post('/api/s0-snapshot/restore', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as S0Body;
    if (body.confirm !== true) {
      return res.status(400).json({
        error:
          'restore truncates and reloads every dumped table — send confirm: true to proceed',
      });
    }
    const ctx = await requireContext(body, res);
    if (!ctx) return;
    const resolved = resolveManifest(ctx.projectId, ctx.architectureId, body.snapshot_id, res);
    if (!resolved) return;
    const metadata = await fetchCompensationMetadataIndex(ctx.projectId, ctx.architectureId);
    if (!metadata) {
      return res.status(422).json({ error: 'could not read the committed model' });
    }
    const readAdapter = createDbAdapter(ctx.config);
    const writeAdapter = writeAdapterFor(ctx.config);
    try {
      trace.detail('s0.restore.start', { snapshotId: resolved.snapshotId });
      const report = await runS0Restore({
        readAdapter,
        writeAdapter,
        metadata,
        manifest: resolved.manifest,
        dir: resolved.dir,
        engine: ctx.config.dbType === 'postgres' ? 'postgres' : 'sybase',
        schema: ctx.config.schema ?? null,
      });
      trace.detail('s0.restore.done', {
        snapshotId: resolved.snapshotId,
        status: report.status,
      });
      return res.status(200).json({ snapshot_id: resolved.snapshotId, report });
    } catch (err) {
      return res.status(500).json({
        error: `S0 restore failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      await readAdapter.dispose();
      await writeAdapter.dispose();
    }
  });

  return router;
}

export const s0SnapshotRouter = buildS0SnapshotRouter();
