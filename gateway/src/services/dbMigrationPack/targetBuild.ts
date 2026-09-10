/**
 * Build the target database from the pack OUTSIDE a migration run (Stored
 * Proc & Function Behaviour Program, Spec 4, 2026-09-09): the workbench
 * needs a target at S0 to replay routine scenarios against long before a
 * plan executes. Same chain the DB plane runs — schema apply (structural)
 * → data load → schema apply (post-load, where translations land) — through
 * the SAME AMVS clients, so a workbench build IS a rehearsal of the plan's
 * DB plane. Idempotent (Liquibase changesets + truncate-before-load);
 * `rebuild` drops all first. Every phase is recorded on the AMS build row;
 * credentials are request-scoped and never persisted.
 */

import { logger } from '../logger';
import { createTracer } from '../../trace';
import { defaultApplySchema, defaultFetchPackFiles, type PackFilePayload, type SchemaApplyArgs, type SchemaApplyCallResult } from '../migrationDbPlaneCompletion';
import { runDataMigrationViaAmvs, type DataMigrationClientArgs, type DataMigrationClientResult } from '../migrationDataRunnerDispatch';
import type { TargetDbSecret } from '../migrationTargetCredentialsStore';
import { createTargetBuild, patchTargetBuild } from './procWorkbenchClients';

const trace = createTracer('gateway');

export interface TargetBuildDeps {
  fetchPackFiles?: (projectId: string, packId: string) => Promise<PackFilePayload[]>;
  fetchPackManifest?: (projectId: string, packId: string) => Promise<Record<string, unknown> | null>;
  applySchema?: (args: SchemaApplyArgs) => Promise<SchemaApplyCallResult>;
  runDataMigration?: (args: DataMigrationClientArgs) => Promise<DataMigrationClientResult>;
  createBuild?: typeof createTargetBuild;
  patchBuild?: typeof patchTargetBuild;
  now?: () => Date;
}

export interface TargetBuildArgs {
  projectId: string;
  architectureId: string;
  packId: string;
  sourceDb: TargetDbSecret;
  targetDb: TargetDbSecret;
  rebuild: boolean;
  packVersion?: string | null;
}

export interface TargetBuildPhase {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  started_at: string | null;
  ended_at: string | null;
  detail: string | null;
  error: string | null;
}

export interface TargetBuildResult {
  buildId: string | null;
  status: 'succeeded' | 'failed';
  phases: { schema: TargetBuildPhase; data: TargetBuildPhase; translations: TargetBuildPhase };
  error: string | null;
}

/** In-flight builds by pack (one build per pack at a time). */
export const targetBuildRegistry = new Map<string, { buildId: string | null; startedAt: number; phase: string }>();

function phase(): TargetBuildPhase {
  return { status: 'pending', started_at: null, ended_at: null, detail: null, error: null };
}

export async function runTargetBuild(args: TargetBuildArgs, deps: TargetBuildDeps = {}): Promise<TargetBuildResult> {
  const fetchPackFiles = deps.fetchPackFiles ?? defaultFetchPackFiles;
  const applySchema = deps.applySchema ?? defaultApplySchema;
  const runDataMigration = deps.runDataMigration ?? runDataMigrationViaAmvs;
  const createBuild = deps.createBuild ?? createTargetBuild;
  const patchBuild = deps.patchBuild ?? patchTargetBuild;
  const now = deps.now ?? (() => new Date());
  const { projectId, architectureId, packId } = args;
  const corr = { project: projectId, arch: architectureId };
  const phases = { schema: phase(), data: phase(), translations: phase() };
  if (args.rebuild) {
    // HONEST: the schema-apply runner has no drop-all. The chain is
    // idempotent (Liquibase-tracked changesets; truncate-before-load), so a
    // plain build re-applies over the current target; a from-scratch rebuild
    // is an operator action on the database itself.
    const error =
      'rebuild_unsupported: the schema-apply runner cannot drop the target; drop and recreate the target database ' +
      '(the declared db.databaseName), then run Build target again without rebuild.';
    logger.warn('[diag-gateway] proc_workbench target_build_rebuild_refused', { projectId, packId });
    return { buildId: null, status: 'failed', phases, error };
  }
  const targetBinding = { db_type: args.targetDb.dbType, host: args.targetDb.host, port: args.targetDb.port, database: args.targetDb.database, schema: args.targetDb.schema ?? null };
  const build = await createBuild(projectId, packId, {
    project_id: projectId,
    architecture_id: architectureId,
    target_binding_json: targetBinding,
    pack_version: args.packVersion ?? null,
    rebuild: args.rebuild,
  });
  const buildId = build?.id ?? null;
  targetBuildRegistry.set(packId, { buildId, startedAt: Date.now(), phase: 'starting' });
  const record = async (): Promise<void> => {
    if (!buildId) return;
    await patchBuild(projectId, packId, buildId, { phases_json: phases });
  };
  const start = (p: TargetBuildPhase, label: string): void => {
    p.status = 'running';
    p.started_at = now().toISOString();
    targetBuildRegistry.set(packId, { buildId, startedAt: targetBuildRegistry.get(packId)?.startedAt ?? Date.now(), phase: label });
  };
  const end = (p: TargetBuildPhase, ok: boolean, detail: string | null, error: string | null): void => {
    p.status = ok ? 'succeeded' : 'failed';
    p.ended_at = now().toISOString();
    p.detail = detail;
    p.error = error;
  };
  try {
    trace.step('Workbench target build — schema, load, translations', corr);
    const files = await fetchPackFiles(projectId, packId);
    const liquibase = files.filter((f) => f.path.replace(/\\/g, '/').startsWith('liquibase/'));
    if (liquibase.length === 0) throw new Error('the pack contains no liquibase/ files to apply');
    const manifest = deps.fetchPackManifest ? await deps.fetchPackManifest(projectId, packId) : parseManifest(files);

    // ---- 1. schema (structural) ------------------------------------------
    start(phases.schema, 'schema');
    await record();
    const structural = await applySchema({
      projectId,
      architectureId,
      targetDb: args.targetDb,
      files: liquibase,
      contexts: ['structural'],
    });
    if (!structural.ok) {
      end(phases.schema, false, null, structural.error ?? 'schema apply failed');
      throw new Error(`schema apply (structural): ${structural.error ?? 'failed'}`);
    }
    end(phases.schema, true, `${structural.applied} changeset(s) applied, ${structural.skipped} skipped`, null);
    await record();

    // ---- 2. data (full S0 load) ------------------------------------------
    start(phases.data, 'data');
    await record();
    const bulk = (manifest as { bulk_load?: { table_order?: string[]; expected_row_counts?: Record<string, number> } } | null)?.bulk_load;
    const load = await runDataMigration({
      projectId,
      architectureId,
      sourceDb: args.sourceDb,
      targetDb: args.targetDb,
      manifest,
      bulkManifest: bulk?.table_order ? { table_order: bulk.table_order, expected_source_row_counts: bulk.expected_row_counts ?? {} } : undefined,
    });
    if (!load.ok) {
      end(phases.data, false, null, load.error ?? 'data migration failed');
      throw new Error(`data load: ${load.error ?? 'failed'}`);
    }
    end(phases.data, true, `status=${load.status ?? '?'} rows=${load.rowsLoaded ?? '?'}`, null);
    await record();

    // ---- 3. translations (post-load) ------------------------------------
    start(phases.translations, 'translations');
    await record();
    const postLoad = await applySchema({ projectId, architectureId, targetDb: args.targetDb, files: liquibase, contexts: ['post-load'] });
    if (!postLoad.ok) {
      end(phases.translations, false, null, postLoad.error ?? 'schema apply failed');
      throw new Error(`schema apply (post-load): ${postLoad.error ?? 'failed'}`);
    }
    end(phases.translations, true, `${postLoad.applied} changeset(s) applied, ${postLoad.skipped} skipped`, null);
    if (buildId) await patchBuild(projectId, packId, buildId, { status: 'succeeded', phases_json: phases, ended_at: now().toISOString() });
    trace.predicate('PROC.BUILD.01', 'workbench target build completed every phase', true, 'schema, data, translations all succeeded', `build=${buildId ?? 'unrecorded'}`, corr);
    return { buildId, status: 'succeeded', phases, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[diag-gateway] proc_workbench target_build_failed', { projectId, packId, error: message });
    if (buildId) await patchBuild(projectId, packId, buildId, { status: 'failed', phases_json: phases, error: message, ended_at: now().toISOString() });
    trace.predicate('PROC.BUILD.01', 'workbench target build completed every phase', false, 'schema, data, translations all succeeded', `failed: ${message}`, corr);
    return { buildId, status: 'failed', phases, error: message };
  } finally {
    targetBuildRegistry.delete(packId);
  }
}

function parseManifest(files: PackFilePayload[]): Record<string, unknown> | null {
  const m = files.find((f) => f.path === 'manifest.json');
  if (!m) return null;
  try {
    return JSON.parse(m.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}
