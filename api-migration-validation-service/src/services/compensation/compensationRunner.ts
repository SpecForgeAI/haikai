/**
 * The compensation bracket runner (Capture-State Discipline Spec 1; scoped-row
 * imaging since 2026-08-27 — state-discipline remediation Item #1).
 *
 * One bracket = one mutating capture SEQUENCE. Tables are planned per tier:
 *
 *   - WRITE-mapped, count ≤ cap  -> FULL image (exact undo, unchanged v1 path).
 *   - WRITE-mapped, count > cap  -> SCOPED: per-call before-images of the rows
 *     the call can touch (WHERE pk = <param value>, via the BracketCallHooks
 *     the runner hands to fire()) + a new-row SWEEP (max(PK) before; rows
 *     above it after are inserts -> deleted on undo). Requires a single
 *     numeric-ish PK; otherwise the table still refuses `table_too_large`.
 *   - READ-mapped (any size)     -> NEVER imaged. Same scoped + sweep revert
 *     machinery when a key is derivable, plus a Tier-3 GUARD (count + max(PK))
 *     that catches what the revert could not explain: a moved guard is a
 *     mis-mined write -> `read_guard_moved` residue (the heal path repairs it;
 *     without a snapshot it is an honest halt). Policy-tolerated classes
 *     (volatile / audit-sink / sequence-generator) are skipped — the
 *     fingerprint tolerates their drift, so must the guard.
 *   - keyless_multiset WRITE tables keep the DETECT-ONLY observation bracket.
 *
 * Undo is derived per table (inverse diff over full or partial images), applied
 * transactionally with ONE reversed-order retry, identities reseeded from the
 * before state (scoped tables reseed to max(PK)-before — the id false-break
 * cascade killer under strict comparison), then VERIFIED: full tables prove
 * byte-parity; scoped tables prove key-parity + empty re-sweep + restored
 * count; read tables prove the guard is back at its before values. Anything
 * unproven is `residue` — never a silent "probably fine".
 */

import type { DbAdapter } from '../db/DbAdapter';
import { buildInverseStatements, buildReseedStatements, computeRowDiff, hasChanges, rowsEqual } from './inverseDiff';
import {
  captureMaxOfColumn,
  captureRowsAbove,
  captureScopedRows,
  captureTableImage,
  pkKeyOf,
  sweepablePkColumn,
  valueForColumn,
} from './tableImage';
import { COMPENSATION_FULL_IMAGE_MAX_ROWS } from '../../config';
import type { CompensationMetadataIndex } from './compensationMetadata';
import { metadataForTable } from './compensationMetadata';
import type { CompensationWriteAdapter } from './WriteAdapter';
import type {
  BracketCallHooks,
  BracketOutcome,
  CompensationEngine,
  CompensationRefusal,
  CompensationTableMeta,
  ReadGuardObservation,
  ResidueDetail,
  TableImage,
  TableRowDiff,
  KeylessObservation,
} from './types';

export interface CompensationBracketArgs<T> {
  readAdapter: DbAdapter;
  writeAdapter: CompensationWriteAdapter;
  engine: CompensationEngine;
  schema?: string | null;
  /** WRITE-mapped effect tables (bare physical names, caller-deduped). */
  tables: string[];
  /** READ-mapped effect tables (scoped/sweep revert + Tier-3 guard; never
   *  imaged, never refused). Tables also present in `tables` are ignored
   *  here — the write plan wins. */
  readTables?: string[];
  metadata: CompensationMetadataIndex;
  /** The capture/replay work to bracket — fired exactly once, pre-checks
   *  permitting. Receives the per-call hooks for scoped imaging; callers
   *  that fire without threading them simply get no Tier-1 coverage. */
  fire: (hooks?: BracketCallHooks) => Promise<T>;
}

export interface CompensationBracketRun<T> {
  outcome: BracketOutcome;
  /** FALSE when pre-checks refused — the call was never made. */
  fired: boolean;
  fireResult: T | null;
  /** A fire() throw is held so compensation still runs; caller re-raises. */
  fireError: unknown | null;
}

/** One partial-imaging plan (scoped write over cap, or read-mapped table). */
interface PartialPlan {
  meta: CompensationTableMeta;
  role: 'write' | 'read';
  /** Single numeric-ish PK column (sweep + guard max); null = count-only guard. */
  sweepPk: string | null;
  countBefore: number | null;
  maxPkBefore: number | null;
  /** First-touch-wins scoped before-images, keyed by pk tuple. */
  scopedBefore: Map<string, Record<string, unknown>>;
  /** The (column,value) predicates collected — re-run for after/verify. */
  predicates: Array<{ column: string; value: unknown }>;
}

function foldParamName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

export async function runCompensationBracket<T>(
  args: CompensationBracketArgs<T>,
): Promise<CompensationBracketRun<T>> {
  const refusals: CompensationRefusal[] = [];
  const fullMetas: CompensationTableMeta[] = [];
  const keylessMetas: CompensationTableMeta[] = [];
  const partialPlans: PartialPlan[] = [];

  const limits = { maxRows: 1, timeoutSeconds: 30 };
  const countOf = async (table: string): Promise<number | null> => {
    try {
      return await args.readAdapter.countRows({ schema: args.schema ?? null, table, limits });
    } catch {
      return null;
    }
  };

  // ---- 1) plan WRITE tables (fail-closed, as ever) -----------------------
  for (const table of args.tables) {
    const meta = metadataForTable(args.metadata, table);
    if (!meta) {
      refusals.push({
        table,
        reason: 'missing_pk',
        detail:
          'table is not in the committed model — no metadata to image/restore with; ' +
          'remedy: re-scan/save-back the database structure, then re-run',
      });
      continue;
    }
    if (meta.pkColumns.length === 0 && meta.keyPolicy === 'keyless_multiset') {
      keylessMetas.push(meta);
      continue;
    }
    const count = await countOf(meta.table);
    if (count !== null && count > COMPENSATION_FULL_IMAGE_MAX_ROWS) {
      const sweepPk = sweepablePkColumn(meta);
      if (sweepPk) {
        // Scoped tier: no full image; per-call scoped rows + new-row sweep.
        partialPlans.push({
          meta,
          role: 'write',
          sweepPk,
          countBefore: count,
          maxPkBefore: null,
          scopedBefore: new Map(),
          predicates: [],
        });
        continue;
      }
      refusals.push({
        table: meta.table,
        reason: 'table_too_large',
        detail:
          `${count} rows exceeds COMPENSATION_FULL_IMAGE_MAX_ROWS=${COMPENSATION_FULL_IMAGE_MAX_ROWS} ` +
          'and the table has no single numeric PK for scoped imaging — raise the cap (CONFIG) ' +
          'or accept exclusion of this endpoint from compensated capture',
      });
      continue;
    }
    fullMetas.push(meta);
  }

  const refuse = (extra: CompensationRefusal[]): CompensationBracketRun<T> => ({
    outcome: {
      kind: 'refused',
      refusals: [...refusals, ...extra],
      diffs: [],
      statementsApplied: [],
      residue: [],
      reseedStatements: [],
    },
    fired: false,
    fireResult: null,
    fireError: null,
  });

  if (refusals.length > 0) return refuse([]);

  // ---- 1b) plan READ tables (never refused, never imaged) ----------------
  const writeNames = new Set(args.tables.map((t) => t.toLowerCase()));
  const tolerated = new Set<string>([
    ...[...(args.metadata.volatileTables ?? [])].map((t) => t.toLowerCase()),
    ...[...(args.metadata.auditSinkTables ?? [])].map((t) => t.toLowerCase()),
    ...[...(args.metadata.sequenceGeneratorTables ?? [])].map((t) => t.toLowerCase()),
  ]);
  for (const table of args.readTables ?? []) {
    const lower = table.toLowerCase();
    if (writeNames.has(lower)) continue; // write plan wins
    if (tolerated.has(lower)) continue; // policy drift — the fingerprint tolerates it
    const meta = metadataForTable(args.metadata, table);
    if (!meta || meta.pkColumns.length === 0) {
      // Count-only guard — no revert capability, but a moved count is LOUD.
      partialPlans.push({
        meta: meta ?? { table, pkColumns: [], columns: [] },
        role: 'read',
        sweepPk: null,
        countBefore: await countOf(table),
        maxPkBefore: null,
        scopedBefore: new Map(),
        predicates: [],
      });
      continue;
    }
    partialPlans.push({
      meta,
      role: 'read',
      sweepPk: sweepablePkColumn(meta),
      countBefore: await countOf(meta.table),
      maxPkBefore: null,
      scopedBefore: new Map(),
      predicates: [],
    });
  }

  const keylessBefore = new Map<string, number | null>();
  for (const meta of keylessMetas) {
    keylessBefore.set(meta.table, await countOf(meta.table));
  }

  // ---- 2) before state ---------------------------------------------------
  const beforeImages = new Map<string, TableImage>();
  for (const meta of fullMetas) {
    const { image, refusal } = await captureTableImage(args.readAdapter, meta, args.schema);
    if (refusal) return refuse([refusal]);
    beforeImages.set(meta.table, image as TableImage);
  }
  for (const plan of partialPlans) {
    if (plan.sweepPk) {
      plan.maxPkBefore = await captureMaxOfColumn(
        args.readAdapter,
        plan.meta.table,
        plan.sweepPk,
        args.schema,
      );
    }
  }

  // ---- 2b) per-call scoped-imaging hooks ---------------------------------
  const scopedTargets = partialPlans.filter((p) => p.meta.pkColumns.length === 1);
  const hooks: BracketCallHooks = {
    beforeMutatingCall: async ({ params }) => {
      if (scopedTargets.length === 0) return;
      const folded = new Map<string, unknown>();
      for (const [name, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) folded.set(foldParamName(name), value);
      }
      for (const plan of scopedTargets) {
        const pk = plan.meta.pkColumns[0];
        const value = folded.get(foldParamName(pk));
        if (value === undefined) continue;
        const already = plan.predicates.some(
          (p) => String(p.value) === String(value) && p.column === pk,
        );
        if (already) continue;
        plan.predicates.push({ column: pk, value });
        const { rowsByPk } = await captureScopedRows(
          args.readAdapter,
          plan.meta,
          args.schema,
          pk,
          value,
        );
        for (const [key, row] of rowsByPk ?? []) {
          // First-touch-wins: the earliest image of a key is the true before.
          if (!plan.scopedBefore.has(key)) plan.scopedBefore.set(key, row);
        }
      }
    },
  };

  // ---- 3) fire ------------------------------------------------------------
  let fireResult: T | null = null;
  let fireError: unknown | null = null;
  try {
    fireResult = await args.fire(hooks);
  } catch (err) {
    fireError = err;
  }

  const keylessObservations: KeylessObservation[] = [];
  for (const meta of keylessMetas) {
    keylessObservations.push({
      table: meta.table,
      countBefore: keylessBefore.get(meta.table) ?? null,
      countAfter: await countOf(meta.table),
    });
  }

  const residue: ResidueDetail[] = [];
  const diffs: TableRowDiff[] = [];
  const statementsApplied: string[] = [];
  const reseedStatements: string[] = [];
  const readGuardObservations: ReadGuardObservation[] = [];

  // ---- 4) after state + diffs --------------------------------------------
  const perTableStatements: string[][] = [];

  for (const meta of fullMetas) {
    const { image, refusal } = await captureTableImage(args.readAdapter, meta, args.schema);
    if (refusal) {
      residue.push({
        table: meta.table,
        kind: 'reimage_failed',
        pkKey: null,
        detail: `after-image failed (${refusal.reason}): ${refusal.detail}`,
      });
      continue;
    }
    const diff = computeRowDiff(beforeImages.get(meta.table) as TableImage, image as TableImage);
    if (hasChanges(diff)) {
      diffs.push(diff);
      const inverse = buildInverseStatements(diff, meta, args.engine, args.schema);
      perTableStatements.push(inverse.statements);
      if (diff.inserted.length > 0) {
        const identity = meta.columns.find((c) => c.isIdentity);
        if (identity) {
          reseedStatements.push(
            ...buildReseedStatements(
              meta,
              identity.name,
              args.engine,
              args.schema ?? null,
              maxIdentityIn(beforeImages.get(meta.table) as TableImage, identity.name),
            ),
          );
        }
      }
    }
  }

  for (const plan of partialPlans) {
    const after = new Map<string, Record<string, unknown>>();
    let readFailed = false;
    for (const predicate of plan.predicates) {
      const { rowsByPk, error } = await captureScopedRows(
        args.readAdapter,
        plan.meta,
        args.schema,
        predicate.column,
        predicate.value,
      );
      if (error !== null) {
        residue.push({
          table: plan.meta.table,
          kind: 'reimage_failed',
          pkKey: null,
          detail: `scoped after-image failed: ${error}`,
        });
        readFailed = true;
        break;
      }
      for (const [key, row] of rowsByPk ?? []) after.set(key, row);
    }
    if (readFailed) continue;
    if (plan.sweepPk && plan.maxPkBefore !== null) {
      const { rowsByPk, error } = await captureRowsAbove(
        args.readAdapter,
        plan.meta,
        args.schema,
        plan.sweepPk,
        plan.maxPkBefore,
      );
      if (error !== null) {
        residue.push({
          table: plan.meta.table,
          kind: 'reimage_failed',
          pkKey: null,
          detail: `new-row sweep failed: ${error}`,
        });
        continue;
      }
      for (const [key, row] of rowsByPk ?? []) {
        if (!after.has(key)) after.set(key, row);
      }
    }

    const beforePartial: TableImage = {
      table: plan.meta.table,
      pkColumns: plan.meta.pkColumns,
      rowsByPk: plan.scopedBefore,
      rowCount: plan.scopedBefore.size,
    };
    const afterPartial: TableImage = {
      table: plan.meta.table,
      pkColumns: plan.meta.pkColumns,
      rowsByPk: after,
      rowCount: after.size,
    };
    if (plan.meta.pkColumns.length > 0) {
      const diff = computeRowDiff(beforePartial, afterPartial);
      if (hasChanges(diff)) {
        diffs.push(diff);
        const inverse = buildInverseStatements(diff, plan.meta, args.engine, args.schema);
        perTableStatements.push(inverse.statements);
        if (diff.inserted.length > 0) {
          const identity = plan.meta.columns.find((c) => c.isIdentity);
          if (identity && plan.maxPkBefore !== null) {
            reseedStatements.push(
              ...buildReseedStatements(
                plan.meta,
                identity.name,
                args.engine,
                args.schema ?? null,
                plan.maxPkBefore,
              ),
            );
          }
        }
      }
    }
  }

  if (residue.length > 0) {
    return {
      outcome: { kind: 'residue', refusals: [], diffs, statementsApplied, residue, reseedStatements: [], keylessObservations, readGuardObservations },
      fired: true,
      fireResult,
      fireError,
    };
  }

  // ---- 5) apply the inverse (one retry with reversed table order) ---------
  if (diffs.length > 0) {
    const flat = perTableStatements.flat();
    try {
      await args.writeAdapter.executeCompensationBatch(flat, { transactional: true });
      statementsApplied.push(...flat);
    } catch (firstErr) {
      const reversed = [...perTableStatements].reverse().flat();
      try {
        await args.writeAdapter.executeCompensationBatch(reversed, { transactional: true });
        statementsApplied.push(...reversed);
      } catch (secondErr) {
        residue.push({
          table: diffs.map((d) => d.table).join(','),
          kind: 'row_changed',
          pkKey: null,
          detail:
            `inverse batch failed twice (forward then reversed table order): ` +
            `${asMessage(firstErr)} / ${asMessage(secondErr)}`,
        });
        return {
          outcome: { kind: 'residue', refusals: [], diffs, statementsApplied: [], residue, reseedStatements: [], keylessObservations, readGuardObservations },
          fired: true,
          fireResult,
          fireError,
        };
      }
    }

    // ---- 6) reseed (non-transactional; failures are residue, not silence) -
    if (reseedStatements.length > 0) {
      try {
        await args.writeAdapter.executeCompensationBatch(reseedStatements, { transactional: false });
      } catch (err) {
        residue.push({
          table: diffs.map((d) => d.table).join(','),
          kind: 'row_changed',
          pkKey: null,
          detail: `identity reseed failed: ${asMessage(err)}`,
        });
      }
    }
  }

  // ---- 7) verify ----------------------------------------------------------
  for (const meta of fullMetas) {
    const before = beforeImages.get(meta.table) as TableImage;
    const { image: verifyImage, refusal } = await captureTableImage(
      args.readAdapter,
      meta,
      args.schema,
    );
    if (refusal) {
      residue.push({
        table: meta.table,
        kind: 'reimage_failed',
        pkKey: null,
        detail: `verify re-image failed (${refusal.reason}): ${refusal.detail}`,
      });
      continue;
    }
    const verified = verifyImage as TableImage;
    for (const [key, beforeRow] of before.rowsByPk) {
      const now = verified.rowsByPk.get(key);
      if (!now) {
        residue.push({ table: meta.table, kind: 'row_missing', pkKey: key, detail: 'row absent after compensation' });
      } else if (!rowsEqual(beforeRow, now)) {
        residue.push({ table: meta.table, kind: 'row_changed', pkKey: key, detail: 'row differs from before-image' });
      }
    }
    for (const key of verified.rowsByPk.keys()) {
      if (!before.rowsByPk.has(key)) {
        residue.push({ table: meta.table, kind: 'row_extra', pkKey: key, detail: 'row exists that the before-image did not' });
      }
    }
  }

  for (const plan of partialPlans) {
    // Scoped keys back to byte-parity with their before rows.
    for (const predicate of plan.predicates) {
      const { rowsByPk, error } = await captureScopedRows(
        args.readAdapter,
        plan.meta,
        args.schema,
        predicate.column,
        predicate.value,
      );
      if (error !== null) {
        residue.push({ table: plan.meta.table, kind: 'reimage_failed', pkKey: null, detail: `verify scoped read failed: ${error}` });
        continue;
      }
      const now = rowsByPk ?? new Map<string, Record<string, unknown>>();
      for (const [key, beforeRow] of plan.scopedBefore) {
        const nowRow = now.get(key);
        if (!nowRow) {
          residue.push({ table: plan.meta.table, kind: 'row_missing', pkKey: key, detail: 'scoped row absent after compensation' });
        } else if (!rowsEqual(beforeRow, nowRow)) {
          residue.push({ table: plan.meta.table, kind: 'row_changed', pkKey: key, detail: 'scoped row differs from before-image' });
        }
      }
      for (const key of now.keys()) {
        if (!plan.scopedBefore.has(key)) {
          residue.push({ table: plan.meta.table, kind: 'row_extra', pkKey: key, detail: 'scoped row exists that the before-image did not' });
        }
      }
    }
    // Re-sweep must be EMPTY (all new rows deleted).
    if (plan.sweepPk && plan.maxPkBefore !== null) {
      const { rowsByPk } = await captureRowsAbove(
        args.readAdapter,
        plan.meta,
        args.schema,
        plan.sweepPk,
        plan.maxPkBefore,
      );
      for (const key of (rowsByPk ?? new Map()).keys()) {
        residue.push({ table: plan.meta.table, kind: 'row_extra', pkKey: key, detail: 'new row above max(PK)-before survived the undo' });
      }
    }
    // Tier-3 guard: count + max(PK) back at their before values, or the
    // bracket saw a write it could not revert (mis-mined write).
    const countAfter = await countOf(plan.meta.table);
    const maxPkAfter =
      plan.sweepPk !== null
        ? await captureMaxOfColumn(args.readAdapter, plan.meta.table, plan.sweepPk, args.schema)
        : null;
    const countMoved =
      plan.countBefore !== null && countAfter !== null && countAfter !== plan.countBefore;
    const maxMoved =
      plan.maxPkBefore !== null && maxPkAfter !== null && maxPkAfter !== plan.maxPkBefore;
    readGuardObservations.push({
      table: plan.meta.table,
      countBefore: plan.countBefore,
      countAfter,
      maxPkBefore: plan.maxPkBefore,
      maxPkAfter,
      revertedBySweep: !countMoved && !maxMoved,
    });
    if (plan.role === 'read' && (countMoved || maxMoved)) {
      residue.push({
        table: plan.meta.table,
        kind: 'read_guard_moved',
        pkKey: null,
        detail:
          `READ-mapped table moved beyond what the bracket could revert ` +
          `(rows ${plan.countBefore ?? '?'} -> ${countAfter ?? '?'}` +
          (plan.sweepPk ? `, max(${plan.sweepPk}) ${plan.maxPkBefore ?? '?'} -> ${maxPkAfter ?? '?'}` : '') +
          `) — a write this op's effect map holds as READ (mis-mined write edge).`,
      });
    }
    if (plan.role === 'write' && plan.countBefore !== null && countAfter !== null && countAfter !== plan.countBefore) {
      residue.push({
        table: plan.meta.table,
        kind: 'row_changed',
        pkKey: null,
        detail: `scoped-tier write table count ${plan.countBefore} -> ${countAfter} after undo — writes outside the scoped keys/sweep`,
      });
    }
  }

  const finalKind: BracketOutcome['kind'] =
    residue.length > 0 ? 'residue' : diffs.length === 0 ? 'clean' : 'compensated';

  return {
    outcome: {
      kind: finalKind,
      refusals: [],
      diffs,
      statementsApplied,
      residue,
      reseedStatements,
      keylessObservations,
      readGuardObservations,
    },
    fired: true,
    fireResult,
    fireError,
  };
}

function maxIdentityIn(image: TableImage, identityColumn: string): number {
  let max = 0;
  for (const row of image.rowsByPk.values()) {
    const v = valueForColumn(row, identityColumn);
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { pkKeyOf };
