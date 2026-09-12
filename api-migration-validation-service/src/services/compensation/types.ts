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
  /** Foundations Spec 3 (2026-08-22): key policy decided for keyless tables
   *  ('keyless_multiset' => DETECT-ONLY bracket, no undo possible). */
  keyPolicy?: 'keyless_multiset' | null;
  /** Foundations migration scope of the entity (null/absent = in_scope). */
  scope?: 'in_scope' | 'excluded' | 'volatile' | 'data_only' | null;
}

/** DETECT-ONLY observation for a keyless_multiset table (Spec 3): the
 *  scenario fired; the row-count delta is RECORDED (updates inside the
 *  table are not detectable without a key — count_only honesty). */
export interface KeylessObservation {
  table: string;
  countBefore: number | null;
  countAfter: number | null;
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
  | 'image_read_failed'
  /** Over-cap keyed table and no call parameter names a key column: the
   *  scoped tier cannot bound the write, so it refuses (recoverable) rather
   *  than run and leave residue (an S0 restore). 2026-09-12. */
  | 'unscoped_write';

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
  kind:
    | 'row_missing'
    | 'row_extra'
    | 'row_changed'
    | 'reimage_failed'
    // Scoped-row imaging (2026-08-27): a READ-planned table's count/max(PK)
    // guard moved beyond what the scoped/sweep undo reverted — a mis-mined
    // write the bracket could not revert. The heal path (Item #7) repairs
    // it from the snapshot; without a snapshot it is an honest halt.
    | 'read_guard_moved';
  pkKey: string | null;
  detail: string;
}

/**
 * Per-call hooks the bracket hands to `fire()` (scoped-row imaging,
 * 2026-08-27). `execute_http_request` calls `beforeMutatingCall` with the
 * concrete path/query parameter bag BEFORE firing each mutating call inside
 * the bracket, letting the runner take scoped before-images (WHERE pk =
 * value) for tables whose single PK column matches a parameter name —
 * first-touch-wins, so the earliest image of a key is the true "before".
 */
export interface BracketCallHooks {
  beforeMutatingCall(args: { params: Record<string, unknown> }): Promise<void>;
}

/** Tier-3 guard observation for a READ-planned table (never imaged). */
export interface ReadGuardObservation {
  table: string;
  countBefore: number | null;
  countAfter: number | null;
  maxPkBefore: number | null;
  maxPkAfter: number | null;
  /** TRUE when the movement was fully explained + reverted by the sweep. */
  revertedBySweep: boolean;
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
  /** Foundations Spec 3 (2026-08-22): detect-only observations for
   *  keyless_multiset tables in this bracket (no undo possible). */
  keylessObservations?: KeylessObservation[];
  /** Scoped-row imaging (2026-08-27): Tier-3 guard observations for
   *  READ-planned tables (informational; violations land in `residue`). */
  readGuardObservations?: ReadGuardObservation[];
}

/** Engine flavour for literal / statement rendering (= the DB engine key). */
export type CompensationEngine = import('../../types/db').DbType;
