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
import {
  EffectScopeIndex,
  effectTablesFor,
  fetchEffectScopeIndex,
  isReadMappedOperation,
} from './stateDelta';
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
      engine: args.writeConfig.dbType,
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
      // Proven-read classification (2026-08-20): a write-verb endpoint whose
      // committed effects are READ-only is a POST-implemented query — it is
      // MAPPED (as reads), needs no write tables, and must not be warned on.
      if (isReadMappedOperation(effectScope, op.method, op.path)) continue;
      // Foundations Spec 3 (2026-08-22): an endpoint whose ENTIRE effect map
      // was removed by migration scope is a SCOPE CONFLICT, not a missing
      // map — it is reported separately with the decision receipts.
      if (scopeConflictFor(effectScope, op.method, op.path).length > 0) continue;
      missing.push(`${op.method.toUpperCase()} ${op.path}`);
    }
  }
  return [...new Set(missing)].sort();
}

/** The scope-removed effect tables for one operation (empty = no conflict).
 *  Only meaningful when the REMAINING write map is empty. */
export function scopeConflictFor(
  effectScope: EffectScopeIndex,
  method: string,
  path: string,
): Array<{ table: string; scope: string; decision_ref: string | null }> {
  const key = `${method.toUpperCase()} ${path}`;
  const removed = effectScope.scopeExcludedByOperationKey?.get(key) ?? [];
  if (removed.length === 0) return [];
  if (effectTablesFor(effectScope, method, path).length > 0) return [];
  return removed;
}

/** Preflight list (Spec 3): operations whose whole effect map was scoped
 *  away, each with its receipts — `"POST /x — orders_bak excluded (F-1)"`. */
export function computeScopeConflictEndpoints(
  operations: Array<{ method: string; path: string; included?: boolean | null }>,
  effectScope: EffectScopeIndex,
): string[] {
  const out: string[] = [];
  for (const op of operations) {
    if (op.included === false) continue;
    if (!COMPENSATED_VERBS.has(op.method.toLowerCase())) continue;
    if (isReadMappedOperation(effectScope, op.method, op.path)) continue;
    const removed = scopeConflictFor(effectScope, op.method, op.path);
    if (removed.length === 0) continue;
    const detail = removed
      .map((r) => `${r.table} ${r.scope}${r.decision_ref ? ` (${r.decision_ref})` : ''}`)
      .join(', ');
    out.push(`${op.method.toUpperCase()} ${op.path} — ${detail}`);
  }
  return [...new Set(out)].sort();
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

/**
 * Quiet-window guardrail (Oracle Nine item 5): fingerprint every in-scope
 * table's row count TWICE, `gapSeconds` apart, BEFORE any scenario fires.
 * Any drifting table not covered by volatile / audit-sink / keyless /
 * excluded policy proves the database is NOT quiet — the capture REFUSES
 * to start, naming every drifter (concurrent batch feeds and external
 * writers make the S0 fingerprint a guaranteed failure; better to refuse
 * in two minutes than fail after an hour).
 */
export async function runQuietWindowCheck(args: {
  adapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  schema: string | null;
  gapSeconds?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{
  quiet: boolean;
  drifted: Array<{ table: string; before: number; after: number }>;
  toleratedDrift: string[];
  gapSeconds: number;
}> {
  const gapSeconds = args.gapSeconds ?? 120;
  const sleep = args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const tolerated = new Set<string>([
    ...(args.metadata.volatileTables ?? []),
    ...(args.metadata.auditSinkTables ?? []),
    // Kiro C1 (2026-08-25): sequence/counter tables move under ANY create
    // traffic — a bump is not evidence the window is unquiet.
    ...(args.metadata.sequenceGeneratorTables ?? []),
  ]);
  for (const [lower, meta] of args.metadata.byTable) {
    if (meta.keyPolicy === 'keyless_multiset') tolerated.add(lower);
    if (meta.scope === 'excluded') tolerated.add(lower);
  }
  const tables = [...args.metadata.byTable.values()].map((m) => m.table);
  const countAll = async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    for (const table of tables) {
      try {
        const n = await args.adapter.countRows({
          schema: args.schema,
          table,
          limits: { maxRows: 1, timeoutSeconds: 30 },
        });
        if (typeof n === 'number') counts.set(table.toLowerCase(), n);
      } catch {
        // Unreadable table: no drift signal either way — skip honestly.
      }
    }
    return counts;
  };
  const before = await countAll();
  await sleep(gapSeconds * 1000);
  const after = await countAll();
  const drifted: Array<{ table: string; before: number; after: number }> = [];
  const toleratedDrift: string[] = [];
  for (const [lower, beforeCount] of before) {
    const afterCount = after.get(lower);
    if (afterCount === undefined || afterCount === beforeCount) continue;
    if (tolerated.has(lower)) {
      toleratedDrift.push(lower);
      continue;
    }
    drifted.push({ table: lower, before: beforeCount, after: afterCount });
  }
  drifted.sort((a, b) => (a.table < b.table ? -1 : 1));
  toleratedDrift.sort();
  return { quiet: drifted.length === 0, drifted, toleratedDrift, gapSeconds };
}

export async function runEndOfJobFingerprint(args: {
  projectId: string;
  architectureId: string;
  readAdapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  schema: string | null;
  /** Lowercase names of tables written under keyless_multiset THIS run
   *  (Foundations Spec 3) — tolerated alongside `volatile`-scoped tables. */
  keylessWrittenTables?: Set<string>;
  /** When supplied (2026-08-26), a mismatch names the ops whose committed
   *  effect map holds the diverged table as READ — the prime suspects for a
   *  missed write edge (the read-then-write idiom whose write the mining
   *  lost). Turns "table X diverged" into "table X diverged; look at op Y". */
  effectScope?: EffectScopeIndex;
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
    const tolerated = new Set<string>(args.metadata.volatileTables ?? []);
    for (const table of args.metadata.auditSinkTables ?? []) tolerated.add(table.toLowerCase());
    // Kiro C1 (2026-08-25): the sequence table bumps unavoidably on every
    // create and only the S0 restore resets it — tolerated by the SAME
    // rationale as audit sinks (it has a PK, so the keyless rule never
    // covered it and the fingerprint false-halted).
    for (const table of args.metadata.sequenceGeneratorTables ?? []) tolerated.add(table.toLowerCase());
    for (const table of args.keylessWrittenTables ?? []) tolerated.add(table.toLowerCase());
    const report = await verifyS0Fingerprint(
      args.readAdapter,
      args.metadata,
      manifest,
      args.schema,
      tolerated,
    );
    const toleratedNote =
      report.tolerated_mismatches.length > 0
        ? ` — ${report.tolerated_mismatches.length} tolerated ` +
          `(volatile/keyless: ${report.tolerated_mismatches
            .slice(0, 6)
            .map((m) => m.table)
            .join(', ')}${report.tolerated_mismatches.length > 6 ? ', …' : ''})`
        : '';
    return {
      status: report.matches ? 'verified' : 'mismatch',
      snapshotId,
      report,
      detail: report.matches
        ? toleratedNote.length > 0
          ? `all non-tolerated tables match S0${toleratedNote}`
          : null
        : fingerprintMismatchDetail(report.mismatches) +
          toleratedNote +
          fingerprintSuspectsNote(report.mismatches, args.effectScope),
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

/**
 * Human detail line NAMING the diverged tables (Spec 0, 2026-08-22):
 * "26 table(s) diverged" with no names left the operator unable to triage
 * expected churn vs true residue. Screenshot-brief: top 10 + a +N tail.
 */
export function fingerprintMismatchDetail(
  mismatches: ReadonlyArray<{
    table: string;
    kind: string;
    expected: string | number | null;
    actual: string | number | null;
  }>,
): string {
  const shown = mismatches
    .slice(0, 10)
    .map((m) =>
      m.kind === 'count_mismatch'
        ? `${m.table} rows ${m.expected}->${m.actual}`
        : `${m.table} ${m.kind}`,
    )
    .join('; ');
  const tail = mismatches.length > 10 ? `; +${mismatches.length - 10} more` : '';
  return (
    `${mismatches.length} table(s) diverged from S0 [${shown}${tail}] — ` +
    'restore via POST /api/s0-snapshot/restore before further captures'
  );
}

/**
 * Suspect attribution for a fingerprint mismatch (2026-08-26): a diverged
 * table that NO bracket imaged means some op wrote it outside its effect
 * map, and the op whose committed map holds the table as READ is the usual
 * culprit — the legacy read-then-write idiom (createOrGet, favourite-style
 * toggles) whose write edge the mining missed. Name those ops in the halt
 * detail so the discovery gap is chased by op, not by forensic grep.
 * Empty string when the scope is absent or nothing read-maps the tables.
 */
export function fingerprintSuspectsNote(
  mismatches: ReadonlyArray<{ table: string }>,
  effectScope?: EffectScopeIndex,
): string {
  const readTables = effectScope?.readTablesByOperationKey;
  if (!readTables || readTables.size === 0 || mismatches.length === 0) return '';
  const notes: string[] = [];
  for (const mismatch of mismatches.slice(0, 10)) {
    const table = mismatch.table.toLowerCase();
    const suspects: string[] = [];
    for (const [opKey, tables] of readTables) {
      if (tables.some((t) => t.toLowerCase() === table)) suspects.push(opKey);
    }
    if (suspects.length === 0) continue;
    suspects.sort();
    const shownSuspects = suspects.slice(0, 6).join(', ');
    const suspectTail = suspects.length > 6 ? `, +${suspects.length - 6} more` : '';
    notes.push(`${mismatch.table}: ${shownSuspects}${suspectTail}`);
  }
  if (notes.length === 0) return '';
  return (
    ` — suspect op(s) holding the diverged table(s) as READ in the committed ` +
    `map (a read-then-write op with a missed write edge is the usual cause; ` +
    `fix the effect map in discovery): ${notes.join(' | ')}`
  );
}
