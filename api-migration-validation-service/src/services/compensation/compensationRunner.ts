/**
 * The compensation bracket runner (Capture-State Discipline Spec 1).
 *
 * One bracket = one mutating capture SEQUENCE:
 *
 *   1. FAIL-CLOSED pre-checks: every effect table must resolve committed-model
 *      metadata with a primary key and fit the full-image cap. Any refusal
 *      means the call is NEVER FIRED (`kind: 'refused'`).
 *   2. Before-image every effect table (full PK-keyed rows).
 *   3. Fire the caller's callback (the HTTP capture). A thrown fire error is
 *      HELD, the bracket still compensates, and the error is returned —
 *      a failed HTTP call may still have written.
 *   4. After-image + row diff. No changes -> `clean`.
 *   5. Apply the DERIVED inverse batch (transactional). On failure, ONE retry
 *      with the per-table blocks reversed (FK topology is unknown here).
 *   6. Identity reseed from the FULL before-image maximum (non-transactional —
 *      Sybase sp_chgattribute cannot run in a user transaction).
 *   7. VERIFY: re-image and prove byte-parity with the before-image.
 *      Parity -> `compensated`. Anything else -> `residue` with row-level
 *      detail — the caller MUST halt the job (design ruling: the DB is no
 *      longer S0; guided restore, then resume).
 */

import type { DbAdapter } from '../db/DbAdapter';
import { buildInverseStatements, buildReseedStatements, computeRowDiff, hasChanges, rowsEqual } from './inverseDiff';
import { captureTableImage, pkKeyOf, valueForColumn } from './tableImage';
import type { CompensationMetadataIndex } from './compensationMetadata';
import { metadataForTable } from './compensationMetadata';
import type { CompensationWriteAdapter } from './WriteAdapter';
import type {
  BracketOutcome,
  CompensationEngine,
  CompensationRefusal,
  CompensationTableMeta,
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
  /** Effect tables for the sequence (bare physical names, caller-deduped). */
  tables: string[];
  metadata: CompensationMetadataIndex;
  /** The capture/replay work to bracket — fired exactly once, pre-checks permitting. */
  fire: () => Promise<T>;
}

export interface CompensationBracketRun<T> {
  outcome: BracketOutcome;
  /** FALSE when pre-checks refused — the call was never made. */
  fired: boolean;
  fireResult: T | null;
  /** A fire() throw is held so compensation still runs; caller re-raises. */
  fireError: unknown | null;
}

export async function runCompensationBracket<T>(
  args: CompensationBracketArgs<T>,
): Promise<CompensationBracketRun<T>> {
  const refusals: CompensationRefusal[] = [];
  const metas: CompensationTableMeta[] = [];
  // Foundations Spec 3 (2026-08-22): keyless_multiset tables get a
  // DETECT-ONLY bracket — no imaging, no undo (impossible without a key);
  // the row-count delta is observed and recorded. Updates inside the table
  // are not detectable without a key (count_only honesty); the S0 restore
  // is the reset lever.
  const keylessMetas: CompensationTableMeta[] = [];
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
    metas.push(meta);
  }

  const keylessCount = async (meta: CompensationTableMeta): Promise<number | null> => {
    try {
      return await args.readAdapter.countRows({
        schema: args.schema ?? null,
        table: meta.table,
        limits: { maxRows: 1, timeoutSeconds: 30 },
      });
    } catch {
      return null;
    }
  };

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

  const keylessBefore = new Map<string, number | null>();
  for (const meta of keylessMetas) {
    keylessBefore.set(meta.table, await keylessCount(meta));
  }

  // --- 2) before-images (fail-closed: any refusal aborts BEFORE firing) ----
  const beforeImages = new Map<string, TableImage>();
  for (const meta of metas) {
    const { image, refusal } = await captureTableImage(args.readAdapter, meta, args.schema);
    if (refusal) return refuse([refusal]);
    beforeImages.set(meta.table, image as TableImage);
  }

  // --- 3) fire ------------------------------------------------------------
  let fireResult: T | null = null;
  let fireError: unknown | null = null;
  try {
    fireResult = await args.fire();
  } catch (err) {
    fireError = err;
  }

  const keylessObservations: KeylessObservation[] = [];
  for (const meta of keylessMetas) {
    keylessObservations.push({
      table: meta.table,
      countBefore: keylessBefore.get(meta.table) ?? null,
      countAfter: await keylessCount(meta),
    });
  }

  const residue: ResidueDetail[] = [];
  const diffs: TableRowDiff[] = [];
  const statementsApplied: string[] = [];
  const reseedStatements: string[] = [];

  // --- 4) after-images + diff --------------------------------------------
  const perTableStatements: string[][] = [];
  for (const meta of metas) {
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

  if (residue.length > 0) {
    return {
      outcome: { kind: 'residue', refusals: [], diffs, statementsApplied, residue, reseedStatements: [], keylessObservations },
      fired: true,
      fireResult,
      fireError,
    };
  }

  if (diffs.length === 0) {
    return {
      outcome: { kind: 'clean', refusals: [], diffs: [], statementsApplied: [], residue: [], reseedStatements: [], keylessObservations },
      fired: true,
      fireResult,
      fireError,
    };
  }

  // --- 5) apply the inverse (one retry with reversed table order) ---------
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
        outcome: { kind: 'residue', refusals: [], diffs, statementsApplied: [], residue, reseedStatements: [], keylessObservations },
        fired: true,
        fireResult,
        fireError,
      };
    }
  }

  // --- 6) reseed (non-transactional; failures are residue, not silence) ---
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

  // --- 7) verify ----------------------------------------------------------
  for (const meta of metas) {
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

  return {
    outcome: {
      kind: residue.length > 0 ? 'residue' : 'compensated',
      refusals: [],
      diffs,
      statementsApplied,
      residue,
      reseedStatements,
      keylessObservations,
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
