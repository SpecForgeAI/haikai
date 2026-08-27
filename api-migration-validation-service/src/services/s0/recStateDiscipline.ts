/**
 * Reconciliation-side state discipline (state-discipline remediation
 * Item #7, 2026-08-27) — HEAL, don't halt, don't quarantine.
 *
 * The invariant: every target scenario must observe the freshly-migrated
 * state, exactly as every source scenario observed S0. When a target undo
 * fails, continuing on drifted state produces false breaks that compound;
 * halting is the overnight-stop problem. The answer:
 *
 *   1. BEFORE replaying, snapshot the target's bracket-scope tables that are
 *      small enough to dump (write-mapped ∪ read-mapped ∪ sequence tables,
 *      each under the full-image cap) — the write surface is small by
 *      construction (huge tables are batch-owned and read-only from the
 *      API). The snapshot doubles as the rec START receipt.
 *   2. On bracket residue, HEAL the affected table(s) with the minimal-diff
 *      single-table restore pointed at the target, then continue. Nobody is
 *      woken up; the run records a `state_healed` receipt.
 *   3. STOP only when a non-snapshotted table drifted — a huge read table
 *      with no API write path, which should be unreachable; the documented
 *      remedy (re-run the migration load) applies. `migrateOneTable` is the
 *      exported fallback seam for that case.
 *   4. At rec END, fingerprint the same scope against the snapshot — a
 *      match (modulo policy-tolerated classes) is positive proof the rec
 *      run did not drift the target.
 *
 * Why a target-side snapshot rather than re-migrating one table: the replay
 * session carries only target URL/auth/DB; single-table re-migration needs
 * the SOURCE adapter + load plan + pair ruleset. The write-surface snapshot
 * achieves the same reset with no new credentials and reuses the
 * minimal-diff restore machinery.
 */

import { COMPENSATION_FULL_IMAGE_MAX_ROWS } from '../../config';
import type { DbAdapter } from '../db/DbAdapter';
import type { CompensationMetadataIndex } from '../compensation/compensationMetadata';
import type { CompensationWriteAdapter } from '../compensation/WriteAdapter';
import type { CompensationEngine } from '../compensation/types';
import type { EffectScopeIndex } from '../stateDelta';
import { defaultVerifyTolerated, verifyS0Fingerprint, S0FingerprintReport } from './fingerprint';
import type { S0Manifest } from './manifest';
import { runS0Snapshot } from './snapshotRunner';
import { restoreSingleTableFromSnapshot } from './restoreRunner';

export interface RecWriteSurfaceSnapshot {
  snapshotId: string;
  dir: string;
  manifest: S0Manifest;
  /** Lowercased tables the snapshot covers (= what heal can repair). */
  tableSet: Set<string>;
  /** Bracket-scope tables SKIPPED as over-cap (the honest stop set). */
  overCapTables: string[];
}

/** Every table any operation's effect map touches (write ∪ read), plus the
 *  sequence-generator tables — the full bracket scope of the run. */
export function bracketScopeTables(
  effectScope: EffectScopeIndex,
  metadata: CompensationMetadataIndex,
): Set<string> {
  const scope = new Set<string>();
  for (const tables of effectScope.tablesByOperationKey.values()) {
    for (const t of tables) scope.add(t.toLowerCase());
  }
  for (const tables of effectScope.readTablesByOperationKey?.values() ?? []) {
    for (const t of tables) scope.add(t.toLowerCase());
  }
  for (const t of metadata.sequenceGeneratorTables ?? []) scope.add(t.toLowerCase());
  return scope;
}

/**
 * Take the pre-rec write-surface snapshot from the TARGET. Fail-soft: a
 * snapshot that cannot be taken returns null and the caller degrades to the
 * halt-on-residue posture (heal unavailable) — loudly, never silently.
 */
export async function takeRecWriteSurfaceSnapshot(args: {
  adapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  effectScope: EffectScopeIndex;
  projectId: string;
  architectureId: string;
  sessionId: string;
  engine: CompensationEngine;
  schema?: string | null;
}): Promise<RecWriteSurfaceSnapshot | null> {
  try {
    const scope = bracketScopeTables(args.effectScope, args.metadata);
    const underCap = new Set<string>();
    const overCap: string[] = [];
    for (const lower of scope) {
      const meta = args.metadata.byTable.get(lower);
      if (!meta) continue;
      let count: number | null = null;
      try {
        count = await args.adapter.countRows({
          schema: args.schema ?? null,
          table: meta.table,
          limits: { maxRows: 1, timeoutSeconds: 30 },
        });
      } catch {
        count = null;
      }
      if (count !== null && count > COMPENSATION_FULL_IMAGE_MAX_ROWS) {
        overCap.push(meta.table);
        continue;
      }
      underCap.add(lower);
    }
    if (underCap.size === 0) return null;
    const result = await runS0Snapshot({
      adapter: args.adapter,
      metadata: args.metadata,
      projectId: args.projectId,
      architectureId: args.architectureId,
      sourceDbType: args.engine,
      schema: args.schema ?? null,
      snapshotId: `rec-${args.sessionId}`,
      tableFilter: (table) => underCap.has(table.toLowerCase()),
    });
    return {
      snapshotId: result.snapshotId,
      dir: result.dir,
      manifest: result.manifest,
      tableSet: underCap,
      overCapTables: overCap,
    };
  } catch {
    return null;
  }
}

export interface HealResult {
  healed: string[];
  unhealable: Array<{ table: string; reason: string }>;
}

/** Repair the named tables from the pre-rec snapshot (truncate + reload +
 *  reseed each). A table outside the snapshot is honestly unhealable. */
export async function healTablesFromSnapshot(args: {
  snapshot: RecWriteSurfaceSnapshot;
  writeAdapter: CompensationWriteAdapter;
  metadata: CompensationMetadataIndex;
  engine: CompensationEngine;
  schema?: string | null;
  tables: string[];
}): Promise<HealResult> {
  const healed: string[] = [];
  const unhealable: HealResult['unhealable'] = [];
  const distinct = [...new Set(args.tables.flatMap((t) => t.split(',')).map((t) => t.trim()))];
  for (const table of distinct) {
    if (!table) continue;
    if (!args.snapshot.tableSet.has(table.toLowerCase())) {
      unhealable.push({
        table,
        reason: 'not in the pre-rec write-surface snapshot (over-cap or unmodelled)',
      });
      continue;
    }
    const result = await restoreSingleTableFromSnapshot({
      writeAdapter: args.writeAdapter,
      metadata: args.metadata,
      manifest: args.snapshot.manifest,
      dir: args.snapshot.dir,
      engine: args.engine,
      schema: args.schema ?? null,
      table,
    });
    if (result.status === 'restored') healed.push(table);
    else unhealable.push({ table, reason: result.detail ?? result.status });
  }
  return { healed, unhealable };
}

/** Rec END receipt: the snapshot scope fingerprinted against the pre-rec
 *  manifest — matching (modulo tolerated classes) proves the rec run did
 *  not drift the target. */
export async function verifyRecWriteSurface(args: {
  snapshot: RecWriteSurfaceSnapshot;
  readAdapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  schema?: string | null;
}): Promise<S0FingerprintReport> {
  return verifyS0Fingerprint(
    args.readAdapter,
    args.metadata,
    args.snapshot.manifest,
    args.schema,
    defaultVerifyTolerated(args.metadata, args.snapshot.manifest),
  );
}
