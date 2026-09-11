/**
 * S0 pin durability + self-heal (2026-09-11).
 *
 * The DB scan pins S0 automatically and records "taken" on the discovery run
 * (an AMS row, durable). The pin itself, though, is a directory tree on this
 * service's local disk — and until today that tree lived INSIDE the service
 * checkout (`<service root>/s0-snapshots`, gitignored). The work machine
 * updates by fresh clone, so every pickup silently deleted every pinned S0
 * while the scan page kept saying "Taken with this scan": the proc-capture
 * wizard then refused with S0_NOT_PINNED and the API capture ran with no
 * canonical state to fingerprint against. Two repairs:
 *
 *   1. `migrateLegacyS0Snapshots` — at boot, copy whatever the legacy
 *      in-checkout tree still holds into the new checkout-independent
 *      location (config `S0_SNAPSHOT_DIR`, default `~/.haikai/s0-snapshots`).
 *      Fail-soft: a copy failure is logged, never fatal.
 *   2. `ensureS0Pinned` — when a capture is about to start and no S0 is
 *      pinned, take one NOW from the committed model with the credentials
 *      the session already holds, instead of sending the operator back to
 *      re-run a scan whose work is already saved. The outcome is explicit
 *      (`present` / `pinned` / `failed`) so callers can decide: the proc
 *      capture refuses only when the re-pin itself fails; the API capture
 *      warns (its fingerprint is end-of-job and informational).
 */

import fs from 'fs';
import path from 'path';
import { createDbAdapter } from '../db/dbAdapterFactory';
import type { DbConnectionConfig } from '../../types/db';
import { fetchCompensationMetadataIndex } from '../compensation/compensationMetadata';
import { latestSnapshotId, readManifest } from './manifest';
import { runS0Snapshot } from './snapshotRunner';

export type EnsureS0Outcome =
  | { status: 'present'; snapshotId: string; detail: null }
  | { status: 'pinned'; snapshotId: string; detail: string }
  | { status: 'failed'; snapshotId: null; detail: string };

export interface EnsureS0Deps {
  latestSnapshot?: typeof latestSnapshotId;
  fetchMetadata?: typeof fetchCompensationMetadataIndex;
  createAdapter?: typeof createDbAdapter;
  snapshot?: typeof runS0Snapshot;
}

/**
 * Make sure an S0 snapshot is pinned for the architecture; take one from the
 * committed model when none is. Never throws.
 */
export async function ensureS0Pinned(
  args: {
    projectId: string;
    architectureId: string;
    config: DbConnectionConfig;
    /** Who asked (log line only). */
    reason: string;
  },
  deps: EnsureS0Deps = {},
): Promise<EnsureS0Outcome> {
  const latest = deps.latestSnapshot ?? latestSnapshotId;
  const existing = latest(args.projectId, args.architectureId);
  if (existing) return { status: 'present', snapshotId: existing, detail: null };

  const fetchMetadata = deps.fetchMetadata ?? fetchCompensationMetadataIndex;
  const createAdapter = deps.createAdapter ?? createDbAdapter;
  const snapshot = deps.snapshot ?? runS0Snapshot;

  let metadata;
  try {
    metadata = await fetchMetadata(args.projectId, args.architectureId);
  } catch (err) {
    return {
      status: 'failed',
      snapshotId: null,
      detail: `committed model unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!metadata || metadata.byTable.size === 0) {
    const detail =
      'no committed table metadata for this architecture — save the DB scan (approve + commit its candidates) or re-run it';
    console.warn(
      `[diag-amvs] op=s0_repin result=failed reason=${args.reason} project=${args.projectId.slice(0, 8)} ` +
        `arch=${args.architectureId.slice(0, 8)} detail=${detail} model_read=${metadata ? 'ok_empty' : 'null'}`,
    );
    return { status: 'failed', snapshotId: null, detail };
  }
  let adapter;
  try {
    adapter = createAdapter(args.config);
  } catch (err) {
    return {
      status: 'failed',
      snapshotId: null,
      detail: `source DB adapter could not be created: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const result = await snapshot({
      adapter,
      metadata,
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceDbType: args.config.dbType,
      schema: args.config.schema ?? null,
    });
    console.warn(
      `[diag-amvs] op=s0_repin result=pinned reason=${args.reason} project=${args.projectId.slice(0, 8)} ` +
        `arch=${args.architectureId.slice(0, 8)} snapshot=${result.snapshotId} tables=${result.manifest.tables.length}`,
    );
    return {
      status: 'pinned',
      snapshotId: result.snapshotId,
      detail:
        `S0 was not pinned on this service (the scan's pin is gone — a fresh clone or a moved data ` +
        `directory) — re-pinned now from the committed model: ${result.manifest.tables.length} tables.`,
    };
  } catch (err) {
    const detail = `S0 re-pin failed: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(
      `[diag-amvs] op=s0_repin result=failed reason=${args.reason} project=${args.projectId.slice(0, 8)} ` +
        `arch=${args.architectureId.slice(0, 8)} detail=${detail}`,
    );
    return { status: 'failed', snapshotId: null, detail };
  } finally {
    try {
      await adapter.dispose();
    } catch {
      // pool teardown must not mask the outcome
    }
  }
}

export interface LegacyMigrationReport {
  legacyDir: string;
  targetDir: string;
  copied: string[];
  skipped: number;
  failed: Array<{ snapshot: string; error: string }>;
}

/**
 * Copy every `<project>/<architecture>/<snapshot>` directory with a readable
 * manifest from the legacy tree into the target tree when the target lacks
 * it. Idempotent; never deletes the legacy copy; never throws.
 */
export function migrateLegacyS0Snapshots(legacyDir: string, targetDir: string): LegacyMigrationReport {
  const report: LegacyMigrationReport = { legacyDir, targetDir, copied: [], skipped: 0, failed: [] };
  if (!legacyDir || !targetDir || path.resolve(legacyDir) === path.resolve(targetDir)) return report;
  if (!fs.existsSync(legacyDir)) return report;
  const dirs = (p: string): string[] => {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const project of dirs(legacyDir)) {
    for (const architecture of dirs(path.join(legacyDir, project))) {
      for (const snapshot of dirs(path.join(legacyDir, project, architecture))) {
        const from = path.join(legacyDir, project, architecture, snapshot);
        if (readManifest(from) === null) continue; // half-written / not a snapshot
        const to = path.join(targetDir, project, architecture, snapshot);
        if (readManifest(to) !== null) {
          report.skipped += 1;
          continue;
        }
        try {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.cpSync(from, to, { recursive: true });
          report.copied.push(`${project}/${architecture}/${snapshot}`);
        } catch (err) {
          report.failed.push({
            snapshot: `${project}/${architecture}/${snapshot}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
  if (report.copied.length > 0 || report.failed.length > 0) {
    console.warn(
      `[diag-amvs] op=s0_legacy_migration copied=${report.copied.length} skipped=${report.skipped} ` +
        `failed=${report.failed.length} from=${legacyDir} to=${targetDir}`,
    );
  }
  return report;
}
