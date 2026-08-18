/**
 * Compensation engine shared types (Capture-State Discipline program, Spec 1 —
 * design: agent-os/planning/2026-08-18-capture-state-discipline-and-log-replay-design.md).
 *
 * The engine makes every mutating capture a bracketed, VERIFIED unit:
 * before-image the effect tables, fire the call(s), diff, apply the inverse,
 * re-image and prove byte-parity with the before-image. An undo that cannot
 * prove restoration FAILS LOUDLY (`residue`) — it never reports pristine
 * state it cannot demonstrate.
 */

/** Column metadata needed to image / restore a table. */
export interface CompensationColumnMeta {
  name: string;
  /** Verbatim source type (e.g. `numeric`, `varchar`) — literal rendering hint. */
  sourceType: string | null;
  isIdentity: boolean;
}

/** Per-table metadata resolved from the committed model (fail-closed). */
export interface CompensationTableMeta {
  /** Physical table name exactly as modelled (identifier-guarded before SQL). */
  table: string;
  /** Primary-key column names, in declared order. NEVER empty (fail-closed upstream). */
  pkColumns: string[];
  columns: CompensationColumnMeta[];
}

/** One imaged table: full rows keyed by their PK tuple. */
export interface TableImage {
  table: string;
  pkColumns: string[];
  /** PK-tuple key (JSON of stringified pk values) -> full row as read. */
  rowsByPk: Map<string, Record<string, unknown>>;
  rowCount: number;
}

/** Why a table (and therefore the bracket) could not be compensated. */
export type CompensationRefusalReason =
  | 'missing_pk'
  | 'table_too_large'
  | 'unsafe_identifier'
  | 'image_read_failed';

export interface CompensationRefusal {
  table: string;
  reason: CompensationRefusalReason;
  detail: string;
}

/** Row-level diff of one table between the before and after images. */
export interface TableRowDiff {
  table: string;
  inserted: Array<Record<string, unknown>>;
  deleted: Array<Record<string, unknown>>;
  updated: Array<{
    pkKey: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
}

/**
 * Bracket outcome taxonomy — every value is explicit and loggable:
 *  - `clean`        : the call wrote nothing; no compensation was needed.
 *  - `compensated`  : writes were undone AND verification proved byte-parity
 *                     with the before-image.
 *  - `residue`      : compensation ran but verification found the DB is NOT
 *                     back at the before-image. The job MUST HALT (design
 *                     ruling: state is no longer S0; guided restore, then
 *                     resume). Detail lists every unrestored row.
 *  - `refused`      : a fail-closed pre-check refused to fire the call at all
 *                     (missing PK metadata, table over the image cap, unsafe
 *                     identifier). The mutating capture is SKIPPED, never
 *                     fired uncompensated.
 */
export type BracketOutcomeKind = 'clean' | 'compensated' | 'residue' | 'refused';

export interface ResidueDetail {
  table: string;
  kind: 'row_missing' | 'row_extra' | 'row_changed' | 'reimage_failed';
  pkKey: string | null;
  detail: string;
}

export interface BracketOutcome {
  kind: BracketOutcomeKind;
  /** Populated when kind === 'refused'. */
  refusals: CompensationRefusal[];
  /** Per-table diffs observed after the fire step (empty when clean/refused). */
  diffs: TableRowDiff[];
  /** The inverse statements that were applied (empty when clean/refused). */
  statementsApplied: string[];
  /** Populated when kind === 'residue'. */
  residue: ResidueDetail[];
  /** Identity reseed statements applied after undoing inserts (informational). */
  reseedStatements: string[];
}

/** Engine flavour for literal / statement rendering. */
export type CompensationEngine = 'sybase' | 'postgres';
