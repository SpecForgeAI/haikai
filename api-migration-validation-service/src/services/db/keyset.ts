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
 */

/** Build the predicate. `quotedColumns` are already engine-quoted. */
export function keysetPredicate(
  quotedColumns: string[],
  after: unknown[],
  render: (value: unknown) => string,
): string {
  if (quotedColumns.length === 0) {
    throw new Error('keyset predicate requires at least one order column');
  }
  if (after.length !== quotedColumns.length) {
    throw new Error(
      `keyset tuple arity ${after.length} does not match order-key arity ${quotedColumns.length}`,
    );
  }
  const gt = (col: string, v: unknown): string =>
    v === null || v === undefined ? `${col} IS NOT NULL` : `${col} > ${render(v)}`;
  const eq = (col: string, v: unknown): string =>
    v === null || v === undefined ? `${col} IS NULL` : `${col} = ${render(v)}`;
  const branches: string[] = [];
  for (let i = 0; i < quotedColumns.length; i++) {
    const prefix = quotedColumns.slice(0, i).map((c, j) => eq(c, after[j]));
    branches.push(`(${[...prefix, gt(quotedColumns[i], after[i])].join(' AND ')})`);
  }
  return `(${branches.join(' OR ')})`;
}
