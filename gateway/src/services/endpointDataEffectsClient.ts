/**
 * Gateway typed client for the AMS `endpoint_data_effects` read surface
 * (Spec 2026-07-06-f — T-SQL Affinity & Consumer Revalidation; the REST
 * controller is `EndpointDataEffectController`, changeset 209 indexes the
 * reverse side).
 *
 * Two directions on one endpoint:
 *   - by ENDPOINT ids   — all effects for a set of endpoints;
 *   - by DATA-ENTITY point ids — the REVERSE query: all effects (hence
 *     endpoints) touching the given tables / procs.
 */

import { getConfig } from '../config';

/** One `endpoint_data_effects` row (snake_case wire — AMS default). */
export interface EndpointDataEffectRow {
  id: string;
  endpoint_id: string;
  /** `dep_phy_<entityId>` / `dep_log_<entityId>` data-entity-point ref. */
  data_entity_point_id: string;
  access_mode?: string | null;
  /** Carries `query_text` / `sql_dialect` / `non_portable_constructs` etc. */
  path_metadata_json?: Record<string, unknown> | null;
  confidence?: number | null;
}

async function fetchEffects(
  projectId: string,
  architectureId: string,
  params: URLSearchParams,
): Promise<EndpointDataEffectRow[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/endpoint-data-effects?${params.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS endpoint-data-effects returned ${response.status}: ${text || '<empty>'}`);
  }
  const body = (await response.json()) as EndpointDataEffectRow[];
  return Array.isArray(body) ? body : [];
}

/** All effects FOR a set of endpoints (the carriage/gate direction). */
export async function fetchEffectsByEndpointIds(
  projectId: string,
  architectureId: string,
  endpointIds: string[],
): Promise<EndpointDataEffectRow[]> {
  if (endpointIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set('endpoint_ids', endpointIds.join(','));
  return fetchEffects(projectId, architectureId, params);
}

/** REVERSE: all effects touching the given `dep_*` points (tables / procs). */
export async function fetchEffectsByDataEntityPointIds(
  projectId: string,
  architectureId: string,
  dataEntityPointIds: string[],
): Promise<EndpointDataEffectRow[]> {
  if (dataEntityPointIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set('data_entity_point_ids', dataEntityPointIds.join(','));
  return fetchEffects(projectId, architectureId, params);
}
