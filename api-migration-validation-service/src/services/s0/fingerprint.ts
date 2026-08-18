/**
 * S0 fingerprint — the "is the live DB still S0?" verdict (Capture-State
 * Discipline Spec 2).
 *
 * Recomputes per-table counts (always) and streaming checksums (bounded by
 * `S0_FINGERPRINT_CHECKSUM_MAX_ROWS` — over-cap tables verify COUNT-ONLY
 * with an honest note) and compares against the snapshot manifest. Green
 * means no restore is needed — the routine end-of-job path. Any mismatch is
 * the HALT signal: the DB is not S0.
 */

import {
  S0_FINGERPRINT_CHECKSUM_MAX_ROWS,
  S0_SNAPSHOT_PAGE_ROWS,
  S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS,
} from '../../config';
import type { DbAdapter } from '../db/DbAdapter';
import { MAX_SINGLE_FETCH_ROWS } from '../db/DbAdapter';
import type { CompensationMetadataIndex } from '../compensation/compensationMetadata';
import { metadataForTable } from '../compensation/compensationMetadata';
import { valueForColumn } from '../compensation/tableImage';
import { canonicalRowJson, createStreamHasher } from './canonicalRow';
import type { S0Manifest } from './manifest';

export interface S0FingerprintMismatch {
  table: string;
  kind: 'count_mismatch' | 'checksum_mismatch' | 'table_not_in_model' | 'read_failed';
  expected: string | number | null;
  actual: string | number | null;
  note: string | null;
}

export interface S0FingerprintReport {
  matches: boolean;
  checked_tables: number;
  count_only_tables: string[];
  mismatches: S0FingerprintMismatch[];
}

export async function verifyS0Fingerprint(
  adapter: DbAdapter,
  metadata: CompensationMetadataIndex,
  manifest: S0Manifest,
  schema?: string | null,
): Promise<S0FingerprintReport> {
  const limits = {
    maxRows: Math.min(S0_SNAPSHOT_PAGE_ROWS, MAX_SINGLE_FETCH_ROWS),
    timeoutSeconds: S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS,
  };
  const mismatches: S0FingerprintMismatch[] = [];
  const countOnly: string[] = [];

  for (const entry of manifest.tables) {
    const meta = metadataForTable(metadata, entry.table);
    if (!meta) {
      mismatches.push({
        table: entry.table,
        kind: 'table_not_in_model',
        expected: entry.row_count,
        actual: null,
        note: 'table no longer in the committed model — re-snapshot after model changes',
      });
      continue;
    }

    let liveCount: number;
    try {
      liveCount = await adapter.countRows({ schema: schema ?? null, table: entry.table, limits });
    } catch (err) {
      mismatches.push({
        table: entry.table,
        kind: 'read_failed',
        expected: entry.row_count,
        actual: null,
        note: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (liveCount !== entry.row_count) {
      mismatches.push({
        table: entry.table,
        kind: 'count_mismatch',
        expected: entry.row_count,
        actual: liveCount,
        note: null,
      });
      continue; // checksum would only restate the count divergence
    }

    if (entry.checksum === null || entry.pk_columns.length === 0) {
      countOnly.push(entry.table);
      continue; // snapshot itself was count-only for this table
    }
    if (liveCount > S0_FINGERPRINT_CHECKSUM_MAX_ROWS) {
      countOnly.push(entry.table);
      continue; // over the verify checksum cap — honest count-only pass
    }

    const typesByColumn = new Map(meta.columns.map((c) => [c.name.toLowerCase(), c.sourceType]));
    const orderByTypes = entry.pk_columns.map((c) => typesByColumn.get(c.toLowerCase()) ?? null);
    const hasher = createStreamHasher();
    let after: unknown[] | null = null;
    let readError: string | null = null;
    for (;;) {
      let page;
      try {
        page = await adapter.fetchOrderedRows({
          schema: schema ?? null,
          table: entry.table,
          orderBy: entry.pk_columns,
          limits,
          after,
          orderByTypes,
        });
      } catch (err) {
        readError = err instanceof Error ? err.message : String(err);
        break;
      }
      const rows = page.rows ?? [];
      for (const row of rows) hasher.addLine(canonicalRowJson(row));
      if (rows.length < limits.maxRows) break;
      const last = rows[rows.length - 1];
      after = entry.pk_columns.map((c) => valueForColumn(last, c) ?? null);
    }
    if (readError) {
      mismatches.push({
        table: entry.table,
        kind: 'read_failed',
        expected: entry.checksum,
        actual: null,
        note: readError,
      });
      continue;
    }
    const liveChecksum = hasher.digest();
    if (liveChecksum !== entry.checksum) {
      mismatches.push({
        table: entry.table,
        kind: 'checksum_mismatch',
        expected: entry.checksum,
        actual: liveChecksum,
        note: null,
      });
    }
  }

  return {
    matches: mismatches.length === 0,
    checked_tables: manifest.tables.length,
    count_only_tables: countOnly,
    mismatches,
  };
}
