/**
 * lineDiff
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 6.4.
 *
 * Lightweight LCS-based line-diff utility. Returns an ordered list of
 * `{ type, text }` entries that, rendered top-to-bottom, recreate the new
 * text with "added" markers and the old text with "removed" markers
 * (interleaved at the right offsets to preserve context).
 *
 * Why a separate util?
 *   - The drawer (Group 7) needs a "View previous version" diff toggle that
 *     compares `previous_spec_text` (single-slot history written by the
 *     manual-edit endpoint) against the current `generated_spec_text`.
 *   - An equivalent LCS routine already lives inside
 *     `MigrationDeliveryInlineDiff.tsx` (cross-story-context spec), but that
 *     copy is component-local. Pulling the pure algorithm out into
 *     `frontend/src/utils/lineDiff.ts` keeps Group 7's rendering layer free of
 *     duplication and gives test code a stable, framework-free entry point.
 *
 * The algorithm:
 *   1. Split both texts on `\n`.
 *   2. Build the LCS DP table (O(N*M) time and memory).
 *   3. Walk the table from (0, 0) emitting `unchanged` / `added` / `removed`
 *      ops in input order.
 *
 * Adequate for shape-spec-sized texts (a few hundred lines at the outer
 * extreme). For larger payloads we would swap in Myers diff or similar, but
 * the spec calls for a lightweight implementation explicitly.
 */

/** One row in the rendered diff. */
export interface DiffLine {
  /** `unchanged` lines appear in both texts; `added` only in the new text; `removed` only in the old. */
  type: 'unchanged' | 'added' | 'removed';
  /** The raw line content (no trailing newline). */
  text: string;
}

/**
 * Compute a simple LCS-based line diff between two texts.
 *
 * Empty inputs are treated as zero-line texts (i.e. no diff rows) rather than
 * a single empty-string line, mirroring the existing
 * `MigrationDeliveryInlineDiff.computeLineDiff` behaviour.
 */
export function computeLineDiff(
  oldText: string,
  newText: string,
): DiffLine[] {
  const a = oldText.length === 0 ? [] : oldText.split('\n');
  const b = newText.length === 0 ? [] : newText.split('\n');
  const m = a.length;
  const n = b.length;

  // LCS DP table. dp[i][j] = LCS length of a[i:] vs b[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Walk forward through the table emitting ops in order.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'unchanged', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: 'removed', text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ type: 'added', text: b[j] });
    j++;
  }
  return out;
}
