/**
 * Comparison-waiver fetch + fold (Spec 2026-07-06-j — Parity Exactness &
 * First-Class SOAP).
 *
 * Fetches the project's EFFECTIVE waiver set from AMS (its rows + the
 * seeded global legacy-allowlist rows) and folds the rows into the fast
 * lookup sets the comparator consumes. A fetch FAILURE returns null and the
 * diff runner falls back to the legacy in-code allowlist — a degraded but
 * honest posture (logged), never a silent hard-stricter run.
 */

import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import type { WaiverSet } from './jsonShapeComparator';

export interface ComparisonWaiverRow {
  id: string;
  project_id: string | null;
  scope: string;
  dimension: string;
  target: string;
  reason: string;
  author: string | null;
  provenance: string | null;
  created_at: string;
}

export function foldWaivers(rows: ComparisonWaiverRow[]): WaiverSet {
  const set: WaiverSet = {
    headerNames: new Set(),
    bodyPaths: new Set(),
    xmlXPaths: new Set(),
    orderingPaths: new Set(),
  };
  for (const row of rows) {
    switch (row.dimension) {
      case 'header':
        set.headerNames.add(row.target.toLowerCase());
        break;
      case 'body_path':
        set.bodyPaths.add(row.target);
        break;
      case 'xml_xpath':
        set.xmlXPaths.add(row.target);
        break;
      case 'ordering_path':
        set.orderingPaths.add(row.target);
        break;
      default:
        // break_fingerprint rows are Spec I's per-break waivers — consumed by
        // the gate verdict layer, not the comparator; ignored here.
        break;
    }
  }
  return set;
}

/** Fetch + fold; null on failure (caller falls back to the legacy allowlist). */
export async function fetchWaiverSet(projectId: string): Promise<WaiverSet | null> {
  try {
    const baseUrl = ARCHITECTURE_MODEL_SERVICE_BASE_URL;
    const response = await fetch(
      `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/api-behaviour/comparison-waivers`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `comparisonWaivers: AMS returned ${response.status}; falling back to the legacy allowlist`,
      );
      return null;
    }
    const rows = (await response.json()) as ComparisonWaiverRow[];
    return foldWaivers(Array.isArray(rows) ? rows : []);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      'comparisonWaivers: fetch failed; falling back to the legacy allowlist',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
