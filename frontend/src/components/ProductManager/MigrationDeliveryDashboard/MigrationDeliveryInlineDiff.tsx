/**
 * MigrationDeliveryInlineDiff
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 7.2
 *
 * Simple line-diff renderer used by the story drawer to compare the pass-1
 * spec snapshot (`pass1_spec_text`) against the current pass-2 spec
 * (`generated_spec_text`). Renders red-tinted "minus" rows for lines only in
 * pass 1, green-tinted "plus" rows for lines only in pass 2, and neutral
 * rows for unchanged context lines.
 *
 * Deliberately avoids pulling in an external diff library; the algorithm is
 * a classic LCS (longest common subsequence) over line splits, which is
 * adequate for the medium-length shape-spec texts we render. Performance is
 * O(N*M) where N+M are the line counts of the two specs.
 *
 * Conventions:
 *   - Pure presentational component; takes only the two text blobs.
 *   - Empty / null inputs render a "No prior version to diff against."
 *     placeholder so the surface degrades gracefully on pass-1-only rows.
 */

import React, { useMemo } from 'react';
import styles from './MigrationDeliveryDashboard.module.css';

export interface MigrationDeliveryInlineDiffProps {
  /** Snapshot of the pass-1 spec text. May be null on legacy / pass-1-only rows. */
  pass1Text: string | null | undefined;
  /** Current spec text (typically the pass-2 output). */
  pass2Text: string | null | undefined;
  /** Optional test id override. */
  testId?: string;
}

type DiffOp = 'equal' | 'added' | 'removed';

interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Compute a simple LCS-based line diff between two texts. Returns an
 * ordered list of `{op, text}` entries that, when rendered top-to-bottom,
 * recreates pass-2 with red "removed" markers for lines that were only in
 * pass 1.
 *
 * Exported for direct unit-test exercise.
 */
export function computeLineDiff(
  pass1: string,
  pass2: string,
): DiffLine[] {
  const a = pass1.length === 0 ? [] : pass1.split('\n');
  const b = pass2.length === 0 ? [] : pass2.split('\n');
  const m = a.length;
  const n = b.length;

  // LCS DP table.
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

  // Walk back through the table to emit ops in forward order.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ op: 'equal', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ op: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ op: 'removed', text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ op: 'added', text: b[j] });
    j++;
  }
  return out;
}

export const MigrationDeliveryInlineDiff: React.FC<
  MigrationDeliveryInlineDiffProps
> = ({ pass1Text, pass2Text, testId }) => {
  const lines = useMemo(() => {
    const a = pass1Text ?? '';
    const b = pass2Text ?? '';
    if (a.length === 0 && b.length === 0) return [];
    return computeLineDiff(a, b);
  }, [pass1Text, pass2Text]);

  if (!pass1Text && !pass2Text) {
    return (
      <div
        className={styles.inlineDiffEmpty}
        data-testid={`${testId ?? 'mdd-inline-diff'}-empty`}
      >
        No prior version to diff against.
      </div>
    );
  }

  if (!pass1Text) {
    return (
      <div
        className={styles.inlineDiffEmpty}
        data-testid={`${testId ?? 'mdd-inline-diff'}-no-pass1`}
      >
        No pass-1 snapshot available -- showing current spec only.
      </div>
    );
  }

  return (
    <div
      className={styles.inlineDiffContainer}
      data-testid={testId ?? 'mdd-inline-diff'}
    >
      {lines.map((line, idx) => {
        const lineClass =
          line.op === 'added'
            ? styles.inlineDiffLineAdded
            : line.op === 'removed'
              ? styles.inlineDiffLineRemoved
              : styles.inlineDiffLineEqual;
        const prefix =
          line.op === 'added' ? '+ ' : line.op === 'removed' ? '- ' : '  ';
        return (
          <div
            key={idx}
            className={lineClass}
            data-testid={`${testId ?? 'mdd-inline-diff'}-line-${idx}`}
            data-op={line.op}
          >
            <span className={styles.inlineDiffLinePrefix} aria-hidden="true">
              {prefix}
            </span>
            <span className={styles.inlineDiffLineText}>
              {line.text === '' ? '\u00a0' : line.text}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default MigrationDeliveryInlineDiff;
