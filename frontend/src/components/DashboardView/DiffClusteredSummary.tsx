/**
 * DiffClusteredSummary (Capture-State Discipline & Log-Replay program,
 * Spec 8, 2026-08-18) — the signature-level rollup above the per-item drift
 * table. One row per failure signature (worst-first) so a 1000-item round-2
 * diff triages as a handful of groups instead of a thousand reads.
 */

import React, { useMemo } from 'react';
import type { ApiBehaviourDiffItemDto } from '../../api/apiBehaviourClient';
import { clusterDiffItems, summarizeClusters } from './diffClusteringSupport';
import styles from './DiffClusteredSummary.module.css';

export interface DiffClusteredSummaryProps {
  items: ApiBehaviourDiffItemDto[];
  /** Collapse the clean (all-match) groups by default. */
  showClean?: boolean;
}

export function DiffClusteredSummary({
  items,
  showClean = false,
}: DiffClusteredSummaryProps): React.ReactElement | null {
  const clusters = useMemo(() => clusterDiffItems(items), [items]);
  const totals = useMemo(() => summarizeClusters(clusters), [clusters]);
  const [expandClean, setExpandClean] = React.useState(showClean);

  if (items.length === 0) return null;
  const visible = expandClean ? clusters : clusters.filter((c) => c.isBreakish);

  return (
    <div className={styles.panel} data-testid="diff-clustered-summary">
      <div className={styles.headerRow}>
        <span className={styles.title}>
          Clustered summary — {totals.breakishClusters} differing signature
          {totals.breakishClusters === 1 ? '' : 's'} covering {totals.breakishItems} item
          {totals.breakishItems === 1 ? '' : 's'} (of {totals.items} total in{' '}
          {totals.clusters} group{totals.clusters === 1 ? '' : 's'})
        </span>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpandClean((v) => !v)}
          data-testid="diff-clustered-summary-toggle-clean"
        >
          {expandClean ? 'Hide matching groups' : 'Show matching groups'}
        </button>
      </div>
      {visible.length === 0 ? (
        <div className={styles.empty} data-testid="diff-clustered-summary-clean">
          Every item matches — no differing signatures.
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Classification</th>
              <th>Items</th>
              <th>Sample scenarios</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((cluster) => (
              <tr
                key={cluster.key}
                className={cluster.isBreakish ? styles.rowBreak : styles.rowClean}
                data-testid="diff-clustered-summary-row"
              >
                <td>
                  {cluster.method} {cluster.path}
                </td>
                <td>{cluster.statusPair}</td>
                <td>
                  {cluster.statusClassification}
                  {cluster.bodyClassification ? ` · ${cluster.bodyClassification}` : ''}
                </td>
                <td>{cluster.count}</td>
                <td className={styles.samples}>{cluster.sampleScenarios.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
