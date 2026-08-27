/**
 * S0 restore runner (Capture-State Discipline Spec 2) — the safety net's
 * payout path, MINIMAL-DIFF since 2026-08-26 (Kiro replication): fingerprint
 * FIRST, then truncate + bulk re-insert ONLY the tables that actually
 * diverged from S0, identity-wrapped and reseeded, then VERIFY the result
 * against the manifest's fingerprint. A restore that cannot prove it
 * restored reports `failed` with the mismatch detail — never a silent
 * "probably fine".
 *
 * Why minimal-diff: Sybase refuses TRUNCATE on an FK-referenced parent
 * whose referencing tables hold rows. The old unconditional loop truncated
 * EVERY dumped table, so unchanged reference parents (which never needed
 * touching) failed the whole restore even though the DB was effectively at
 * S0. Unchanged tables are now reported `unchanged` and never touched.
 * HONEST RESIDUAL EDGE: an FK-referenced parent that GENUINELY drifts still
 * cannot be truncated — minimal-diff makes that rare, not impossible; the
 * fix for that edge (disabling constraints during restore) is deliberately
 * not made speculatively.
 *
 * Tables the snapshot skipped (`skipped_no_pk_count_only`) CANNOT be
 * restored (their content was never dumped) and are reported as such.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { S0_RESTORE_INSERTS_PER_BATCH } from '../../config';
import type { DbAdapter } from '../db/DbAdapter';
import type { CompensationMetadataIndex } from '../compensation/compensationMetadata';
import { metadataForTable } from '../compensation/compensationMetadata';
import { buildReseedStatements } from '../compensation/inverseDiff';
import { renderLiteral } from '../compensation/sqlLiterals';
import { valueForColumn } from '../compensation/tableImage';
import type { CompensationEngine, CompensationTableMeta } from '../compensation/types';
import type { CompensationWriteAdapter } from '../compensation/WriteAdapter';
import { defaultVerifyTolerated, verifyS0Fingerprint, S0FingerprintReport } from './fingerprint';
import type { S0Manifest } from './manifest';

export interface S0RestoreArgs {
  readAdapter: DbAdapter;
  writeAdapter: CompensationWriteAdapter;
  metadata: CompensationMetadataIndex;
  manifest: S0Manifest;
  dir: string;
  engine: CompensationEngine;
  schema?: string | null;
}

export interface S0RestoreTableResult {
  table: string;
  status: 'restored' | 'skipped_not_dumped' | 'unchanged' | 'failed';
  rows_inserted: number;
  detail: string | null;
}

export interface S0RestoreReport {
  status: 'restored' | 'failed';
  tables: S0RestoreTableResult[];
  verification: S0FingerprintReport | null;
}

function qualifyForEngine(
  table: string,
  schema: string | null | undefined,
  engine: CompensationEngine,
): string {
  if (!schema) return engine === 'postgres' ? `"${table}"` : table;
  return engine === 'postgres' ? `"${schema}"."${table}"` : `${schema}.${table}`;
}

function insertFor(
  row: Record<string, unknown>,
  meta: CompensationTableMeta,
  target: string,
  engine: CompensationEngine,
): string | null {
  const cols: string[] = [];
  const values: string[] = [];
  for (const col of meta.columns) {
    const value = valueForColumn(row, col.name);
    if (value === undefined) continue;
    cols.push(col.name);
    values.push(renderLiteral(value, engine, col.sourceType));
  }
  if (cols.length === 0) return null;
  return `INSERT INTO ${target} (${cols.join(', ')}) VALUES (${values.join(', ')})`;
}

async function readRows(file: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    rows.push(JSON.parse(trimmed) as Record<string, unknown>);
  }
  return rows;
}

export async function runS0Restore(args: S0RestoreArgs): Promise<S0RestoreReport> {
  const tables: S0RestoreTableResult[] = [];
  const tolerated = defaultVerifyTolerated(args.metadata, args.manifest);

  // Minimal-diff (2026-08-26): fingerprint BEFORE touching anything and
  // reload only the tables that actually diverged (hard mismatches AND
  // tolerated ones — the whole point of restore is resetting the volatile /
  // audit-sink / sequence drift the fingerprint tolerates). If the
  // pre-verify itself errors, fall back to reloading everything — the
  // optimization must never make restore LESS capable than the old
  // unconditional loop.
  let divergedTables: Set<string> | null = null;
  try {
    const preVerify = await verifyS0Fingerprint(
      args.readAdapter,
      args.metadata,
      args.manifest,
      args.schema,
      tolerated,
    );
    divergedTables = new Set<string>(
      [...preVerify.mismatches, ...preVerify.tolerated_mismatches].map((m) =>
        m.table.toLowerCase(),
      ),
    );
  } catch {
    divergedTables = null;
  }

  for (const entry of args.manifest.tables) {
    if (!entry.file) {
      tables.push({
        table: entry.table,
        status: 'skipped_not_dumped',
        rows_inserted: 0,
        detail: entry.note ?? 'snapshot holds no data file for this table',
      });
      continue;
    }
    if (divergedTables !== null && !divergedTables.has(entry.table.toLowerCase())) {
      // Already at S0 — never truncated, so an unchanged FK-referenced
      // parent can no longer fail the whole restore on the Sybase refusal.
      tables.push({
        table: entry.table,
        status: 'unchanged',
        rows_inserted: 0,
        detail: 'already at S0 — not reloaded',
      });
      continue;
    }
    tables.push(await restoreManifestEntry(args, entry));
  }

  const anyFailed = tables.some((t) => t.status === 'failed');
  let verification: S0FingerprintReport | null = null;
  if (!anyFailed) {
    // Kiro C2 (2026-08-25): the self-verify must tolerate what the restore
    // structurally cannot reset (un-dumped count-only tables) plus the
    // model's tolerance classes — a restore that reset every restorable
    // table reports `restored`, with the untouchable tables shown as
    // tolerated_mismatches instead of flipping the whole result to failed.
    // Same tolerated set as the pre-verify (computed once at the top).
    verification = await verifyS0Fingerprint(
      args.readAdapter,
      args.metadata,
      args.manifest,
      args.schema,
      tolerated,
    );
  }

  return {
    status: !anyFailed && verification?.matches === true ? 'restored' : 'failed',
    tables,
    verification,
  };
}

/** Truncate + reload + reseed ONE dumped manifest entry (shared by the full
 *  restore loop and the single-table heal seam). */
async function restoreManifestEntry(
  args: Pick<S0RestoreArgs, 'writeAdapter' | 'metadata' | 'dir' | 'engine' | 'schema'>,
  entry: S0Manifest['tables'][number],
): Promise<S0RestoreTableResult> {
  const meta = metadataForTable(args.metadata, entry.table);
  if (!meta) {
    return {
      table: entry.table,
      status: 'failed',
      rows_inserted: 0,
      detail: 'table no longer in the committed model — cannot resolve columns/identity',
    };
  }

  const target = qualifyForEngine(meta.table, args.schema ?? null, args.engine);
  const identity = meta.columns.find((c) => c.isIdentity);
  let inserted = 0;
  try {
    const rows = await readRows(path.join(args.dir, entry.file as string));

    // Truncate first — its own restore batch so a later insert failure
    // leaves an OBVIOUSLY empty table, not a half-merged one.
    await args.writeAdapter.executeRestoreBatch([`TRUNCATE TABLE ${target}`], {
      transactional: true,
    });

    for (let i = 0; i < rows.length; i += S0_RESTORE_INSERTS_PER_BATCH) {
      const chunk = rows.slice(i, i + S0_RESTORE_INSERTS_PER_BATCH);
      const statements: string[] = [];
      const wrap = args.engine === 'sybase' && identity !== undefined;
      if (wrap) statements.push(`SET IDENTITY_INSERT ${target} ON`);
      for (const row of chunk) {
        const statement = insertFor(row, meta, target, args.engine);
        if (statement) statements.push(statement);
      }
      if (wrap) statements.push(`SET IDENTITY_INSERT ${target} OFF`);
      if (statements.length > 0) {
        await args.writeAdapter.executeRestoreBatch(statements, { transactional: true });
        inserted += chunk.length;
      }
    }

    if (identity) {
      let max = 0;
      for (const row of rows) {
        const v = valueForColumn(row, identity.name);
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        if (Number.isFinite(n) && n > max) max = n;
      }
      const reseed = buildReseedStatements(
        meta,
        identity.name,
        args.engine,
        args.schema ?? null,
        max,
      );
      await args.writeAdapter.executeRestoreBatch(reseed, { transactional: false });
    }

    return { table: entry.table, status: 'restored', rows_inserted: inserted, detail: null };
  } catch (err) {
    return {
      table: entry.table,
      status: 'failed',
      rows_inserted: inserted,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Single-table heal seam (Item #7, 2026-08-27): truncate + reload + reseed
 * exactly ONE table from a snapshot — the row-scoped repair the
 * heal-don't-halt path uses after a bracket residue. Honest failures:
 * a table the snapshot never dumped (count-only) or never contained cannot
 * be healed and says so.
 */
export async function restoreSingleTableFromSnapshot(
  args: Pick<S0RestoreArgs, 'writeAdapter' | 'metadata' | 'dir' | 'engine' | 'schema'> & {
    manifest: S0Manifest;
    table: string;
  },
): Promise<S0RestoreTableResult> {
  const entry = args.manifest.tables.find(
    (t) => t.table.toLowerCase() === args.table.toLowerCase(),
  );
  if (!entry) {
    return {
      table: args.table,
      status: 'failed',
      rows_inserted: 0,
      detail: 'table is not in the snapshot manifest — cannot heal from this snapshot',
    };
  }
  if (!entry.file) {
    return {
      table: args.table,
      status: 'failed',
      rows_inserted: 0,
      detail:
        entry.note ?? 'snapshot holds no data file for this table (count-only) — cannot heal',
    };
  }
  return restoreManifestEntry(args, entry);
}
