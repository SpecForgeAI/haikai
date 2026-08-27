/**
 * S0 snapshot runner (Capture-State Discipline Spec 2).
 *
 * Logical snapshot of the committed physical model's tables via the EXISTING
 * read-only adapter's deterministic keyset pagination — the same uncapped
 * full-table read discipline the data-migration bulk load trusts. One JSONL
 * file per table (canonical sorted-key rows in PK order) + a manifest with
 * per-table counts and streaming sha256 checksums.
 *
 * Scope = the committed physical model (design ruling): writes landing
 * OUTSIDE modelled tables are findings elsewhere; this snapshot can only
 * restore what it dumped, and says exactly what that is.
 *
 * No-PK tables cannot be read in a deterministic order or safely restored:
 * they are recorded COUNT-ONLY with `skipped_no_pk_count_only` (loud,
 * honest), never silently included.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  S0_SNAPSHOT_PAGE_ROWS,
  S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS,
} from '../../config';
import type { DbAdapter } from '../db/DbAdapter';
import { MAX_SINGLE_FETCH_ROWS } from '../db/DbAdapter';
import type { CompensationMetadataIndex } from '../compensation/compensationMetadata';
import { valueForColumn } from '../compensation/tableImage';
import { canonicalRowJson, createStreamHasher } from './canonicalRow';
import type { S0Manifest, S0TableManifestEntry } from './manifest';
import { snapshotDirFor, writeManifest } from './manifest';

export interface S0SnapshotArgs {
  adapter: DbAdapter;
  metadata: CompensationMetadataIndex;
  projectId: string;
  architectureId: string;
  sourceDbType: string;
  schema?: string | null;
  /** Injectable for tests; defaults to a timestamp id. */
  snapshotId?: string;
  /**
   * Optional subset filter (rec write-surface snapshots, Item #7
   * 2026-08-27): only tables for which this returns TRUE are dumped. The
   * manifest then scopes exactly what the snapshot can restore — absent
   * filter = the whole committed model, unchanged.
   */
  tableFilter?: (table: string) => boolean;
}

export interface S0SnapshotResult {
  snapshotId: string;
  dir: string;
  manifest: S0Manifest;
}

function defaultSnapshotId(): string {
  return `s0-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${process.pid}`;
}

export async function runS0Snapshot(args: S0SnapshotArgs): Promise<S0SnapshotResult> {
  const snapshotId = args.snapshotId ?? defaultSnapshotId();
  const dir = snapshotDirFor(args.projectId, args.architectureId, snapshotId);
  fs.mkdirSync(dir, { recursive: true });

  const limits = {
    maxRows: Math.min(S0_SNAPSHOT_PAGE_ROWS, MAX_SINGLE_FETCH_ROWS),
    timeoutSeconds: S0_SNAPSHOT_QUERY_TIMEOUT_SECONDS,
  };

  const tables: S0TableManifestEntry[] = [];
  const tableNames = [...args.metadata.byTable.keys()].sort();
  for (const key of tableNames) {
    const meta = args.metadata.byTable.get(key)!;
    if (args.tableFilter && !args.tableFilter(meta.table)) continue;

    if (meta.pkColumns.length === 0) {
      const count = await args.adapter.countRows({
        schema: args.schema ?? null,
        table: meta.table,
        limits,
      });
      tables.push({
        table: meta.table,
        pk_columns: [],
        row_count: count,
        checksum: null,
        file: null,
        note: 'skipped_no_pk_count_only',
      });
      continue;
    }

    const typesByColumn = new Map(meta.columns.map((c) => [c.name.toLowerCase(), c.sourceType]));
    const orderByTypes = meta.pkColumns.map((c) => typesByColumn.get(c.toLowerCase()) ?? null);

    const fileName = `${meta.table}.jsonl`;
    const stream = fs.createWriteStream(path.join(dir, fileName), { encoding: 'utf8' });
    const hasher = createStreamHasher();
    let rowCount = 0;
    let after: unknown[] | null = null;
    try {
      for (;;) {
        const page = await args.adapter.fetchOrderedRows({
          schema: args.schema ?? null,
          table: meta.table,
          orderBy: meta.pkColumns,
          limits,
          after,
          orderByTypes,
        });
        const rows = page.rows ?? [];
        for (const row of rows) {
          const line = canonicalRowJson(row);
          if (!stream.write(line + '\n')) {
            await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
          }
          hasher.addLine(line);
          rowCount++;
        }
        if (rows.length < limits.maxRows) break;
        const last = rows[rows.length - 1];
        after = meta.pkColumns.map((c) => valueForColumn(last, c) ?? null);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    }

    tables.push({
      table: meta.table,
      pk_columns: meta.pkColumns,
      row_count: rowCount,
      checksum: hasher.digest(),
      file: fileName,
      note: null,
    });
  }

  const manifest: S0Manifest = {
    snapshot_id: snapshotId,
    project_id: args.projectId,
    architecture_id: args.architectureId,
    created_at: new Date().toISOString(),
    source_db_type: args.sourceDbType,
    schema: args.schema ?? null,
    tables,
  };
  writeManifest(dir, manifest);
  return { snapshotId, dir, manifest };
}
