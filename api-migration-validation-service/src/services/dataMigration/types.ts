/**
 * Types for the data-migration runner (Spec Y, plane-based migration reframe
 * — agent-os/planning/2026-07-17-plane-based-migration-execution-shaping.md §5).
 *
 * Executes the pack's Phase-2 bulk load: source -> forward transform -> target,
 * count-reconciled and rule-cited. Sibling of the data-parity comparator
 * (Spec P): same read-only DbAdapter seam for reads, same migration-pair
 * ruleset-as-data, never throws (a per-table failure becomes unverifiable).
 * The WRITE path is separate (see targetLoader.ts) so the read-only adapter's
 * SELECT-only guard is never weakened.
 */

export interface TableLoadSpec {
  schema: string | null;
  table: string;
  /** Deterministic read order (primary key preferred). */
  orderBy: string[];
  /** Non-generated target columns to load (== source column names; like-for-like). */
  loadColumns: string[];
  /**
   * Identity columns present on the target => INSERT ... OVERRIDING SYSTEM
   * VALUE, so source-assigned ids are preserved. Sequences are reseeded by the
   * schema pack's post-load changeset (Spec X), not here.
   */
  identityColumns: string[];
  /** Expected source row count from the pack's bulk-load manifest (null = unknown). */
  expectedSourceRowCount: number | null;
}

export interface LoadPlan {
  tables: TableLoadSpec[];
  /** Non-fatal notes from plan construction (e.g. malformed manifest sections). */
  issues: string[];
}

export type TableLoadStatus =
  | 'loaded'
  | 'reconciled_mismatch'
  | 'unverifiable'
  | 'empty';

export interface TableLoadResult {
  schema: string | null;
  table: string;
  status: TableLoadStatus;
  sourceCount: number | null;
  loadedCount: number;
  /** Target row count observed AFTER load — the reconcile anchor. */
  targetCount: number | null;
  /** Pair rules whose forward (load-time) transforms were applied. */
  rulesCited: string[];
  reason: string | null;
}

export interface DataMigrationReportBody {
  pair_id: string | null;
  ruleset_version: number | null;
  tables: TableLoadResult[];
  summary: {
    tables: number;
    /** Tables loaded-and-reconciled OR legitimately empty (no divergence, no error). */
    loaded: number;
    mismatched: number;
    unverifiable: number;
    rows_loaded: number;
    rules_cited: string[];
    status: 'clean' | 'divergent' | 'unverifiable' | 'empty';
  };
}
