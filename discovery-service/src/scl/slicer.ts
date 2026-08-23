/**
 * SCL slicer — the deterministic Java slice pipeline entry point.
 *
 * Composes `indexJavaProject` → `extractShapes` → `extractBehaviour` into one
 * pure function over a source tree: same input → byte-identical
 * `stableStringify` of the result (no timing, no randomness, sorted
 * everything). This is the seam the corpus assembler (pass 3) consumes.
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md
 * ("Extraction pipeline", step 1 — deterministic slice).
 */

import { harvestProcCatalog } from './sqlProcHarvester';
import { indexJavaProject, type JavaProjectIndex } from './javaProjectIndex';
import { extractShapes } from './shapeExtractor';
import { extractBehaviour } from './behaviourExtractor';
import type {
  SclBehaviourTable,
  SclBoundaryContract,
  SclFinding,
  SclShapeContract,
} from './sclTypes';

export interface SclSliceOptions {
  /** Per-table row budget override (default `MAX_ROWS_PER_TABLE`). */
  maxRowsPerTable?: number;
}

export interface SclSliceStats {
  /** Indexed project types (classes / interfaces / enums). */
  classCount: number;
  tableCount: number;
  shapeCount: number;
  boundaryCount: number;
  /** Total rows across all behaviour tables. */
  rowCount: number;
}

export interface SclSliceResult {
  /** `[T-...]` behaviour tables, sorted by symbol. */
  tables: SclBehaviourTable[];
  /** `[S-...]` shape contracts, sorted by symbol. */
  shapes: SclShapeContract[];
  /** `[Q-...]` boundary contracts, sorted by symbol. */
  boundaries: SclBoundaryContract[];
  /** Deterministic findings (dispatch ambiguity / complexity truncation), sorted. */
  findings: SclFinding[];
  /** Inline-trivial method symbols whose tables were suppressed, sorted. */
  inlined: string[];
  /** Files tree-sitter could not parse (tolerant skip — never throws). */
  parseErrors: Array<{ path: string; message: string }>;
  /**
   * symbol → contract key across ALL planes: type FQN → S-key, method
   * symbol → T-key, boundary class FQN / boundary method symbol → Q-key.
   * Where a boundary class is also a shape (e.g. a Dao with instance
   * fields), the behavioural identity (Q-key) wins for the class FQN; the
   * shape contract itself remains in `shapes`.
   */
  keyBySymbol: Map<string, string>;
  stats: SclSliceStats;
  /** Repo-resident stored-proc bodies (db/procs etc.) harvested from `.sql`
   *  files (2026-08-23) — the Java side only NAMES procs; the bodies name
   *  the tables. Carried into the corpus for effect-walk expansion. */
  procCatalog: import('./sqlProcHarvester').ProcCatalogEntry[];
  /**
   * The full Java project index the slice was extracted from. Carried for the
   * corpus assembler (root detection needs class-level annotations /
   * supertypes / config references). NEVER part of any content-hashed
   * contract body — contracts are hashed inside the extractors over their
   * canonical bodies only.
   */
  index: JavaProjectIndex;
}

/**
 * Slices an entire Java project into SCL contracts. Deterministic: the same
 * source tree yields byte-identical `stableStringify` output for every field
 * of the result (`keyBySymbol` is a Map view of the same keys). Async only
 * for the one-time wasm parser initialisation inside `indexJavaProject`;
 * extraction itself is synchronous.
 */
export async function sliceProject(rootDir: string, options?: SclSliceOptions): Promise<SclSliceResult> {
  const index = await indexJavaProject(rootDir);
  const procCatalog = harvestProcCatalog(rootDir);
  const shapeResult = extractShapes(index);
  const behaviour = extractBehaviour(index, shapeResult.keyBySymbol, options);

  const keyBySymbol = new Map<string, string>();
  for (const [symbol, key] of shapeResult.keyBySymbol) keyBySymbol.set(symbol, key);
  for (const [symbol, key] of behaviour.keyBySymbol) keyBySymbol.set(symbol, key);

  const rowCount = behaviour.tables.reduce((n, t) => n + t.rows.length, 0);

  return {
    tables: behaviour.tables,
    shapes: shapeResult.shapes,
    boundaries: behaviour.boundaries,
    findings: behaviour.findings,
    inlined: behaviour.inlined,
    parseErrors: index.parseErrors,
    keyBySymbol,
    index,
    procCatalog,
    stats: {
      classCount: index.classesByFqn.size,
      tableCount: behaviour.tables.length,
      shapeCount: shapeResult.shapes.length,
      boundaryCount: behaviour.boundaries.length,
      rowCount,
    },
  };
}
