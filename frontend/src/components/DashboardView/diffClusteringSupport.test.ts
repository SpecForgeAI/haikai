/**
 * Diff-item signature clustering tests (Capture-State Discipline &
 * Log-Replay program, Spec 8, 2026-08-18).
 */

import { describe, expect, it } from 'vitest';
import type { ApiBehaviourDiffItemDto } from '../../api/apiBehaviourClient';
import {
  clusterDiffItems,
  isCleanItem,
  summarizeClusters,
} from './diffClusteringSupport';

function item(overrides: Partial<ApiBehaviourDiffItemDto>): ApiBehaviourDiffItemDto {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    diff_id: 'diff-1',
    method: 'GET',
    path: '/pets/{id}',
    scenario_name: 'log:1:abc',
    source_baseline_item_id: null,
    target_baseline_item_id: null,
    status_classification: 'status_match',
    body_classification: 'body_match',
    source_response_status: 200,
    target_response_status: 200,
    body_diff_json: null,
    ...overrides,
  } as ApiBehaviourDiffItemDto;
}

describe('clusterDiffItems', () => {
  it('collapses identical failure signatures into one worst-first group', () => {
    const items = [
      // 3 identical breaks on one endpoint (the hot-endpoint storm).
      ...[1, 2, 3].map((n) =>
        item({
          scenario_name: `log:${n}:x`,
          status_classification: 'status_drift',
          body_classification: null,
          source_response_status: 200,
          target_response_status: 500,
        }),
      ),
      // 1 clean item on another endpoint.
      item({ path: '/pets', scenario_name: 'happy_path' }),
      // 1 different break signature (same endpoint, different transition).
      item({
        scenario_name: 'log:9:y',
        status_classification: 'status_drift',
        body_classification: null,
        source_response_status: 200,
        target_response_status: 404,
      }),
    ];

    const clusters = clusterDiffItems(items);
    expect(clusters).toHaveLength(3);
    // Worst-first: the 3-member break group leads.
    expect(clusters[0]).toMatchObject({
      count: 3,
      isBreakish: true,
      statusPair: '200→500',
    });
    expect(clusters[0].sampleScenarios).toHaveLength(3);
    expect(clusters[0].itemIds).toHaveLength(3);
    // The clean group sorts last.
    expect(clusters[2].isBreakish).toBe(false);
  });

  it('caps sample scenarios at 5 while itemIds carry every member', () => {
    const items = Array.from({ length: 8 }, (_, n) =>
      item({
        scenario_name: `log:${n}:z`,
        status_classification: 'source_only',
        body_classification: null,
        target_response_status: null,
      }),
    );
    const clusters = clusterDiffItems(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(8);
    expect(clusters[0].sampleScenarios).toHaveLength(5);
    expect(clusters[0].itemIds).toHaveLength(8);
  });

  it('summarizeClusters accounts break-ish vs total honestly', () => {
    const clusters = clusterDiffItems([
      item({}),
      item({ scenario_name: 'b', status_classification: 'status_drift' }),
      item({ scenario_name: 'c', status_classification: 'status_drift' }),
    ]);
    expect(summarizeClusters(clusters)).toEqual({
      clusters: 2,
      breakishClusters: 1,
      items: 3,
      breakishItems: 2,
    });
  });

  it('isCleanItem treats null body classification (source/target-only rows) as not clean when status differs', () => {
    expect(isCleanItem(item({}))).toBe(true);
    expect(isCleanItem(item({ status_classification: 'source_only', body_classification: null }))).toBe(
      false,
    );
    expect(isCleanItem(item({ body_classification: 'body_value_drift' }))).toBe(false);
  });
});
