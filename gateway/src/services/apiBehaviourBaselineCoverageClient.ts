/**
 * API Behaviour Baseline coverage client.
 *
 * Thin typed wrapper over the AMS read endpoint
 * `GET /api/projects/{projectId}/architectures/{architectureId}/api-behaviour/endpoint-baseline-coverage`,
 * which returns the CANONICAL architecture endpoint → baseline coverage map
 * (which endpoint elements are covered by an ACTIVE API Behaviour Baseline, and
 * which baseline covers each).
 *
 * AMS computes the join via each baseline item's `operation_id` → operation
 * (templated OAS path) and the protocol-aware reconciliation key
 * (`InventoryReconciliationCalculator`). The gateway MUST NOT reimplement that
 * match — it consumes this payload verbatim. This replaces the old
 * baseline-NAME substring match in the phase-2 expansion, which never matched a
 * descriptively-named baseline ("Demo API Baseline v1") and therefore reported
 * every endpoint as "missing baseline".
 *
 * Spec: Migration Delivery Plan expansion — endpoint↔baseline coverage
 * (2026-06-24 fix).
 */

import { getConfig } from '../config';

/** One coverage row from AMS (snake_case wire — see EndpointBaselineCoverageDto). */
export interface EndpointBaselineCoverageRow {
  endpoint_id: string;
  baseline_id: string;
  method?: string | null;
  path?: string | null;
}

/**
 * Fetch the endpoint → baseline coverage for an architecture and return it as a
 * `Map<endpointElementId, baselineId>`. The endpoint element id matches the
 * `elements-inventory` instance id the expansion pipeline batches on, so the
 * caller can look up `map.get(instance.id)` directly. Endpoints with no active
 * baseline coverage are simply absent from the map.
 *
 * Throws on any non-2xx response (the caller soft-fails the enrichment to the
 * conservative bespoke path — an unresolved baseline never blocks expansion).
 */
export async function fetchEndpointBaselineCoverage(
  projectId: string,
  architectureId: string,
): Promise<Map<string, string>> {
  const rows = await fetchEndpointBaselineCoverageRows(projectId, architectureId);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row?.endpoint_id && row?.baseline_id) {
      map.set(row.endpoint_id, row.baseline_id);
    }
  }
  return map;
}

/**
 * RAW coverage rows (Tier-1 batch 2026-07-10): the gate's story-scoped floor
 * evaluation needs the per-endpoint `method`/`path` alongside the ids, so it
 * can attribute floor misses to in-scope stories. Same AMS read; the map
 * wrapper above delegates here.
 */
export async function fetchEndpointBaselineCoverageRows(
  projectId: string,
  architectureId: string,
): Promise<EndpointBaselineCoverageRow[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/api-behaviour/endpoint-baseline-coverage`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS endpoint-baseline-coverage returned ${response.status}: ${text || '<empty body>'}`,
    );
  }
  const rows = (await response.json()) as EndpointBaselineCoverageRow[];
  return Array.isArray(rows) ? rows : [];
}
