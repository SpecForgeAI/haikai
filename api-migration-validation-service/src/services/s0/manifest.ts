/**
 * S0 snapshot manifest (Capture-State Discipline Spec 2).
 *
 * File-based state — the snapshot IS files (like the DB packs), so its
 * manifest lives beside the data, not in AMS. `manifest.json` is written
 * once at the end of a successful snapshot run (a crashed run leaves NO
 * manifest — a snapshot either exists completely or not at all; partial
 * table files without a manifest are inert).
 */

import * as fs from 'fs';
import * as path from 'path';

import { S0_SNAPSHOT_DIR } from '../../config';

export interface S0TableManifestEntry {
  table: string;
  pk_columns: string[];
  row_count: number;
  /** sha256 over the canonical row stream; null ONLY for skipped tables. */
  checksum: string | null;
  /** Relative data file name (`<table>.jsonl`); null for skipped tables. */
  file: string | null;
  /** Honest coverage note (`skipped_no_pk_count_only`) or null. */
  note: string | null;
}

export interface S0Manifest {
  snapshot_id: string;
  project_id: string;
  architecture_id: string;
  created_at: string;
  source_db_type: string;
  schema: string | null;
  tables: S0TableManifestEntry[];
}

export function snapshotRootFor(projectId: string, architectureId: string): string {
  return path.join(S0_SNAPSHOT_DIR, sanitize(projectId), sanitize(architectureId));
}

export function snapshotDirFor(
  projectId: string,
  architectureId: string,
  snapshotId: string,
): string {
  return path.join(snapshotRootFor(projectId, architectureId), sanitize(snapshotId));
}

/** Path segments come from ids/user input — keep them filesystem-safe. */
function sanitize(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function writeManifest(dir: string, manifest: S0Manifest): void {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

export function readManifest(dir: string): S0Manifest | null {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as S0Manifest;
  } catch {
    return null;
  }
}

/** Snapshot ids are timestamp-prefixed, so the lexicographic max is latest. */
export function latestSnapshotId(projectId: string, architectureId: string): string | null {
  const root = snapshotRootFor(projectId, architectureId);
  if (!fs.existsSync(root)) return null;
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => readManifest(path.join(root, name)) !== null)
    .sort();
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}
