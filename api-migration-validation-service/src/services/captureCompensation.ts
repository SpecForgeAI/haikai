/**
 * Capture-side compensation context (Capture-State Discipline Spec 3).
 *
 * Bundles everything the orchestrator's per-scenario brackets need — the
 * effect scope (endpoint -> write tables), the committed-model metadata
 * (PKs / identity / column types), the READ adapter for imaging and the
 * WRITE adapter for the derived undo — plus the pre-flight helpers:
 *
 *   - the AGGREGATE warning listing every included write endpoint with NO
 *     effect map (user ruling 2026-08-18: fail closed per endpoint AND show
 *     the operator the full list so scale is judgeable);
 *   - the end-of-job S0 fingerprint ("is the DB still S0?"), whose mismatch
 *     is the session HALT signal.
 *
 * Engagement rule: mode 'required' (CONFIG) + DB credentials + committed
 * model resolvable. With NO DB credentials the discipline cannot run at all
 * and the session carries a loud advisory instead (back-compat posture from
 * the pre-build Q&A). Credential-role split: when a readonly login is
 * supplied, the session's observational adapter uses it and the WRITE login
 * exists ONLY inside this context's write adapter.
 */

import { CAPTURE_COMPENSATION_MODE } from '../config';
import type { DbAdapter } from './db/DbAdapter';
import type { DbConnectionConfig } from '../types/db';
import {
  CompensationMetadataIndex,
  fetchCompensationMetadataIndex,
} from './compensation/compensationMetadata';
import {
  CompensationWriteAdapter,
  PostgresCompensationWriteAdapter,
  SybaseCompensationWriteAdapter,
} from './compensation/WriteAdapter';
import type { CompensationEngine } from './compensation/types';
import { EffectScopeIndex, effectTablesFor, fetchEffectScopeIndex } from './stateDelta';
import { verifyS0Fingerprint, S0FingerprintReport } from './s0/fingerprint';
import { latestSnapshotId, readManifest, snapshotDirFor } from './s0/manifest';

/** Verbs whose scenarios run inside a bracket. Mirrors STATE_DELTA_VERBS. */
export const COMPENSATED_VERBS: ReadonlySet<string> = new Set([
  'post',
  'put',
  'patch',
  'delete',
]);

export interface CaptureCompensationContext {
  engine: CompensationEngine;
  schema: string | null;
  effectScope: EffectScopeIndex;
  metadata: CompensationMetadataIndex;
  /** Observational adapter (readonly login when split; else primary). */
  readAdapter: DbAdapter;
  writeAdapter: CompensationWriteAdapter;
}

export function createCompensationWriteAdapter(
  config: DbConnectionConfig,
): CompensationWriteAdapter {
  return config.dbType === 'postgres'
    ? new PostgresCompensationWriteAdapter(config)
    : new SybaseCompensationWriteAdapter(config);
}

export interface BuildCompensationArgs {
  projectId: string;
  architectureId: string;
  /** Primary (write-capable) connection config — password already resolved. */
  writeConfig: DbConnectionConfig;
  /** The session's observational adapter (already constructed). */
  readAdapter: DbAdapter;
  /** Test seams. */
  metadataFetcher?: typeof fetchCompensationMetadataIndex;
  effectScopeFetcher?: typeof fetchEffectScopeIndex;
  writeAdapterFactory?: typeof createCompensationWriteAdapter;
}

export type CompensationInactiveReason =
  | 'mode_off'
  | 'model_unavailable';

export interface BuildCompensationResult {
  context: CaptureCompensationContext | null;
  inactiveReason: CompensationInactiveReason | null;
}

export async function buildCaptureCompensationContext(
  args: BuildCompensationArgs,
): Promise<BuildCompensationResult> {
  if (CAPTURE_COMPENSATION_MODE === 'off') {
    return { context: null, inactiveReason: 'mode_off' };
  }
  const metadataFetcher = args.metadataFetcher ?? fetchCompensationMetadataIndex;
  const effectScopeFetcher = args.effectScopeFetcher ?? fetchEffectScopeIndex;
  const [metadata, effectScope] = await Promise.all([
    metadataFetcher(args.projectId, args.architectureId),
    effectScopeFetcher(args.projectId, args.architectureId),
  ]);
  if (!metadata || metadata.byTable.size === 0 || !effectScope) {
    return { context: null, inactiveReason: 'model_unavailable' };
  }
  const writeAdapterFactory = args.writeAdapterFactory ?? createCompensationWriteAdapter;
  return {
    context: {
      engine: args.writeConfig.dbType === 'postgres' ? 'postgres' : 'sybase',
      schema: args.writeConfig.schema ?? null,
      effectScope,
      metadata,
      readAdapter: args.readAdapter,
      writeAdapter: writeAdapterFactory(args.writeConfig),
    },
    inactiveReason: null,
  };
}

/**
 * The AGGREGATE pre-capture warning (user ruling): every INCLUDED operation
 * with a mutating verb whose (METHOD, path) resolves NO write tables in the
 * committed effect map. These endpoints will be REFUSED at scenario time —
 * this list tells the operator up front, at judgeable scale. A long list is
 * the signal that effect-map mining needs tool work (out of scope here).
 */
export function computeWriteEndpointsWithoutEffectMap(
  operations: Array<{ method: string; path: string; included?: boolean | null }>,
  effectScope: EffectScopeIndex,
): string[] {
  const missing: string[] = [];
  for (const op of operations) {
    if (op.included === false) continue;
    if (!COMPENSATED_VERBS.has(op.method.toLowerCase())) continue;
    if (effectTablesFor(effectScope, op.method, op.path).length === 0) {
      missing.push(`${op.method.toUpperCase()} ${op.path}`);
    }
  }
  return [...new Set(missing)].sort();
}

// ---------------------------------------------------------------------------
// End-of-job S0 fingerprint
// ---------------------------------------------------------------------------

export interface EndOfJobFingerprintResult {
  status: 'verified' | 'mismatch' | 'no_snapshot' | 'check_failed';
  snapshotId: string | null;
  report: S0FingerprintReport | null;
  detail: string | null;
}

export async function runEndOfJobFingerprint(args: {
  projectId: string;
  architectureId: string;
  readAdapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  schema: string | null;
}): Promise<EndOfJobFingerprintResult> {
  let snapshotId: string | null = null;
  try {
    snapshotId = latestSnapshotId(args.projectId, args.architectureId);
    if (!snapshotId) {
      return {
        status: 'no_snapshot',
        snapshotId: null,
        report: null,
        detail:
          'no S0 snapshot is pinned for this architecture — take one via ' +
          'POST /api/s0-snapshot/run so end-of-job state verification can run',
      };
    }
    const manifest = readManifest(
      snapshotDirFor(args.projectId, args.architectureId, snapshotId),
    );
    if (!manifest) {
      return {
        status: 'check_failed',
        snapshotId,
        report: null,
        detail: `snapshot ${snapshotId} has no readable manifest`,
      };
    }
    const report = await verifyS0Fingerprint(
      args.readAdapter,
      args.metadata,
      manifest,
      args.schema,
    );
    return {
      status: report.matches ? 'verified' : 'mismatch',
      snapshotId,
      report,
      detail: report.matches
        ? null
        : `${report.mismatches.length} table(s) diverged from S0 — restore via ` +
          'POST /api/s0-snapshot/restore before further captures',
    };
  } catch (err) {
    return {
      status: 'check_failed',
      snapshotId,
      report: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
