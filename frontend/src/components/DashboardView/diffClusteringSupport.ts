/**
 * Diff-item signature clustering (Capture-State Discipline & Log-Replay
 * program, Spec 8, 2026-08-18). PURE — unit-tested directly.
 *
 * Thousands of diff items must never become thousands of triage reads: one
 * real behavioural difference on a hot endpoint manifests as hundreds of
 * identical items. Items cluster by FAILURE SIGNATURE — (method, path,
 * status classification, body classification, source→target status pair) —
 * so the reviewer sees "PUT /pets/{id}: 200→500, body_value_drift × 214" as
 * ONE row with sample scenarios, sorted worst-first.
 */

import type { ApiBehaviourDiffItemDto } from '../../api/apiBehaviourClient';

export interface DiffCluster {
  /** Stable signature key (the grouping identity). */
  key: string;
  method: string;
  path: string;
  statusClassification: string;
  bodyClassification: string | null;
  /** `'200→500'`-style status transition; '—' when a side is absent. */
  statusPair: string;
  count: number;
  /** Up to 5 member scenario names for drill-in. */
  sampleScenarios: string[];
  /** Every member item id (group actions / drill-through). */
  itemIds: string[];
  /** TRUE when the signature is break-worthy (anything except clean match). */
  isBreakish: boolean;
}

export function isCleanItem(item: ApiBehaviourDiffItemDto): boolean {
  return (
    item.status_classification === 'status_match' &&
    (item.body_classification === null || item.body_classification === 'body_match')
  );
}

export function clusterDiffItems(items: ApiBehaviourDiffItemDto[]): DiffCluster[] {
  const byKey = new Map<string, DiffCluster>();
  for (const item of items) {
    const statusPair = `${item.source_response_status ?? '—'}→${
      item.target_response_status ?? '—'
    }`;
    const key = [
      item.method,
      item.path,
      item.status_classification,
      item.body_classification ?? '-',
      statusPair,
    ].join('|');
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.itemIds.push(item.id);
      if (existing.sampleScenarios.length < 5) {
        existing.sampleScenarios.push(item.scenario_name);
      }
      continue;
    }
    byKey.set(key, {
      key,
      method: item.method,
      path: item.path,
      statusClassification: item.status_classification,
      bodyClassification: item.body_classification,
      statusPair,
      count: 1,
      sampleScenarios: [item.scenario_name],
      itemIds: [item.id],
      isBreakish: !isCleanItem(item),
    });
  }
  // Worst-first: break-ish signatures before clean ones, larger groups first,
  // then a stable path order.
  return [...byKey.values()].sort((a, b) => {
    if (a.isBreakish !== b.isBreakish) return a.isBreakish ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`);
  });
}

export interface ClusterTotals {
  clusters: number;
  breakishClusters: number;
  items: number;
  breakishItems: number;
}

export function summarizeClusters(clusters: DiffCluster[]): ClusterTotals {
  return {
    clusters: clusters.length,
    breakishClusters: clusters.filter((c) => c.isBreakish).length,
    items: clusters.reduce((n, c) => n + c.count, 0),
    breakishItems: clusters.filter((c) => c.isBreakish).reduce((n, c) => n + c.count, 0),
  };
}
