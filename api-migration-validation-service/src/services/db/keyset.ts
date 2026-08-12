/**
 * NULL-aware keyset (cursor) pagination predicate — shared by every DbAdapter
 * (2026-08-07, the full-table bulk load).
 *
 * The bulk load previously read AT MOST one capped page per table (readCap
 * skip-or-load gate + the sidecar's 10k clamp), so tables over the caps
 * loaded partially or not at all — silent data loss. Reads are now paginated
 * with a keyset cursor: each page fetches rows strictly AFTER the previous
 * page's last order-key tuple, under the cross-engine NULLS-LOW ascending
 * contract. Neither engine's row-value comparison honours that contract
 * (Sybase ASE has none; Postgres row comparison treats NULL as unknown), so
 * the tuple predicate is expanded explicitly:
 *
 *   (c1 > v1) OR (c1 = v1 AND c2 > v2) OR (c1 = v1 AND c2 = v2 AND c3 > v3)…
 *
 * with `col IS NOT NULL` standing in for `col > NULL` (a NULL sorts lowest,
 * so "after NULL" = every non-null value) and `col IS NULL` for `col = NULL`.
 *
 * Value rendering is engine-owned via `render` (Sybase literalises — the
 * sidecar takes no params; Postgres appends a parameter placeholder), so this
 * module stays engine-agnostic.
 *
 * SARGABLE leading bound (2026-08-11): the OR expansion alone is unsargable
 * on both engines — the optimiser scans from the table start and discards
 * rows before the cursor, so page cost grows LINEARLY with page number and
 * deep pages deterministically cross the per-query timeout (the live
 * 13-table truncated-load shape: clean multiples of pageRows, byte-identical
 * across runs). A redundant `c1 >= v1` conjunct (implied by every OR branch,
 * so semantics are untouched) gives the optimiser an index range seek on the
 * leading key column. Omitted when v1 is NULL (NULLS-LOW: the branch forms
 * already handle it, and `>= NULL` has no useful bound).
 */

/**
 * Build the predicate. `quotedColumns` are already engine-quoted. `render`
 * receives the COLUMN INDEX alongside the value (2026-08-12) so literal-SQL
 * engines can render each cursor member under its column's declared type
 * (the sidecar wire carries numerics as strings; quoting one against a
 * numeric column is an engine type error). Parameterising renders ignore it.
 */
export function keysetPredicate(
  quotedColumns: string[],
  after: unknown[],
  render: (value: unknown, index: number) => string,
): string {
  if (quotedColumns.length === 0) {
    throw new Error('keyset predicate requires at least one order column');
  }
  if (after.length !== quotedColumns.length) {
    throw new Error(
      `keyset tuple arity ${after.length} does not match order-key arity ${quotedColumns.length}`,
    );
  }
  const gt = (col: string, v: unknown, i: number): string =>
    v === null || v === undefined ? `${col} IS NOT NULL` : `${col} > ${render(v, i)}`;
  const eq = (col: string, v: unknown, i: number): string =>
    v === null || v === undefined ? `${col} IS NULL` : `${col} = ${render(v, i)}`;
  const bound =
    quotedColumns.length > 1 && after[0] !== null && after[0] !== undefined
      ? `${quotedColumns[0]} >= ${render(after[0], 0)} AND `
      : '';
  const branches: string[] = [];
  for (let i = 0; i < quotedColumns.length; i++) {
    const prefix = quotedColumns.slice(0, i).map((c, j) => eq(c, after[j], j));
    branches.push(`(${[...prefix, gt(quotedColumns[i], after[i], i)].join(' AND ')})`);
  }
  return `(${bound}(${branches.join(' OR ')}))`;
}
