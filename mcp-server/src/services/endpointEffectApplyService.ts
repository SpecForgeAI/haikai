/**
 * Endpoint-Effect Apply Service (Effect-map backfill, 2026-08-20).
 *
 * The MODEL-WRITE half of the effect-map backfill flow. The gateway derives
 * endpoint -> write-table mappings (deterministically from the SCL corpus,
 * or LLM-proposed + human-approved for the remainder) and calls
 * POST /mcp/tools/apply_endpoint_effects. The MCP server owns every model
 * write, so the apply lands through the same GET-merge-PUT round trip as
 * `candidateSaveBackService.ts` / `gapMetadataApplyService.ts` and follows
 * the same additive doctrine:
 *
 *   - an (endpoint, table) pair that already carries a write/read-write
 *     effect edge is NEVER duplicated — skipped with an honest reason;
 *   - a delta whose endpoint id or table NAME does not resolve in the
 *     committed model is skipped WHOLE (the table-name check doubles as the
 *     hallucination guard for LLM-proposed rows);
 *   - the PUT only happens when at least one edge was actually appended.
 *
 * Row shape mirrors candidateSaveBackService's endpoint_data_effects
 * save-back (snake_case wire; `data_entity_point_id` uses the `dep_phy_`
 * convention the compensation reader strips).
 */

import { randomUUID } from 'node:crypto';
import { createHttpError } from '../middleware/errorHandler';

export interface EndpointEffectDelta {
  /** `endpoints` row id in the committed model. */
  endpoint_id: string;
  /** Physical table NAME (matched case-insensitively against the model). */
  table_name: string;
  /** Provenance: deterministic corpus derivation or approved LLM proposal. */
  source: 'corpus' | 'llm';
  /** Optional human-readable evidence (root symbol / boundary cite). */
  evidence?: string | null;
  /** Omitted = 'write' (back-compat). 'read' = proven-read edges
   *  (2026-08-21) — a complete corpus walk showed the endpoint only reads,
   *  so the compensation preflight stops demanding a write map for it. */
  access_mode?: 'write' | 'read';
}

export interface SkippedEffectDelta {
  delta: EndpointEffectDelta;
  reason: string;
}

export interface ApplyEndpointEffectsResult {
  applied: number;
  skipped: SkippedEffectDelta[];
}

/** The archModelClient surface this service needs (injectable for tests). */
export interface EffectApplyModelClient {
  getProjectById(projectId: string): Promise<{ id: string; name: string }>;
  getModel(projectId: string, architectureId: string, filename: string): Promise<any | null>;
  putModel(projectId: string, architectureId: string, filename: string, dto: any): Promise<any>;
}

function resolveDefaultClient(): EffectApplyModelClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { archModelClient } = require('./archModelClient');
  return archModelClient as EffectApplyModelClient;
}

/** Strip the data-entity-point prefix the wire convention carries. */
function bareEntityId(pointId: string): string {
  return String(pointId ?? '').replace(/^dep_(phy|log)_/, '');
}

export interface ApplyEndpointEffectsArgs {
  projectId: string;
  architectureId: string;
  deltas: EndpointEffectDelta[];
}

export async function applyEndpointEffects(
  args: ApplyEndpointEffectsArgs,
  client: EffectApplyModelClient = resolveDefaultClient()
): Promise<ApplyEndpointEffectsResult> {
  const { projectId, architectureId, deltas } = args;

  const project = await client.getProjectById(projectId);
  const filename = project.name;

  const model = await client.getModel(projectId, architectureId, filename);
  if (!model) {
    throw createHttpError(
      404,
      `No committed model found for project "${projectId}" / architecture "${architectureId}" — ` +
        'effect edges can only be applied to an existing model'
    );
  }

  const endpoints: any[] = model?.metaModel?.entities?.endpoints ?? [];
  const physicals: any[] = model?.metaModel?.entities?.physical_data_entities ?? [];
  const endpointById = new Map<string, any>(
    endpoints.filter((e: any) => e?.id).map((e: any) => [String(e.id), e])
  );
  const physicalByLowerName = new Map<string, any>(
    physicals
      .filter((p: any) => p?.id && p?.name)
      .map((p: any) => [String(p.name).toLowerCase(), p])
  );

  if (!model.metaModel.relationships) model.metaModel.relationships = {};
  if (!Array.isArray(model.metaModel.relationships.endpoint_data_effects)) {
    model.metaModel.relationships.endpoint_data_effects = [];
  }
  const edges: any[] = model.metaModel.relationships.endpoint_data_effects;

  /** Existing coverage per mode: `${endpointId}|${bareEntityId}` — the
   *  additive skip predicates. Write deltas skip against write/read-write
   *  edges; read deltas skip when the pair ALREADY has any edge (a write
   *  edge subsumes a read one for the preflight's purposes). */
  const writeEdgeKeys = new Set<string>();
  const anyEdgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!edge?.endpoint_id || !edge?.data_entity_point_id) continue;
    const key = `${edge.endpoint_id}|${bareEntityId(edge.data_entity_point_id)}`;
    anyEdgeKeys.add(key);
    const mode = String(edge?.access_mode ?? '').toLowerCase();
    if (mode === 'write' || mode === 'read-write') writeEdgeKeys.add(key);
  }

  const skipped: SkippedEffectDelta[] = [];
  let applied = 0;

  for (const delta of deltas) {
    const mode = delta.access_mode === 'read' ? 'read' : 'write';
    const endpoint = endpointById.get(String(delta.endpoint_id));
    if (!endpoint) {
      skipped.push({
        delta,
        reason: `endpoint "${delta.endpoint_id}" not found in the committed model`,
      });
      continue;
    }
    const physical = physicalByLowerName.get(String(delta.table_name).toLowerCase());
    if (!physical) {
      // Doubles as the hallucination guard: a proposed table that is not a
      // committed physical entity never lands.
      skipped.push({
        delta,
        reason: `table "${delta.table_name}" is not a physical entity in the committed model`,
      });
      continue;
    }
    const key = `${endpoint.id}|${physical.id}`;
    if (mode === 'write' ? writeEdgeKeys.has(key) : anyEdgeKeys.has(key)) {
      skipped.push({
        delta,
        reason:
          `endpoint "${endpoint.id}" already has a${mode === 'write' ? ' write' : 'n'} ` +
          `effect edge to "${physical.name}" — additive apply never duplicates`,
      });
      continue;
    }

    edges.push({
      id: `ede-bf-${randomUUID()}`,
      endpoint_id: endpoint.id,
      data_entity_point_id: `dep_phy_${physical.id}`,
      access_mode: mode,
      path_metadata_json: null,
      confidence: delta.source === 'corpus' ? 0.9 : 0.7,
      description:
        `effect-map backfill (${delta.source}${mode === 'read' ? ', proven-read' : ''})` +
        (delta.evidence ? `: ${String(delta.evidence).slice(0, 300)}` : ''),
      tags: 'effect_map_backfill',
      valid_from: null,
      valid_to: null,
    });
    anyEdgeKeys.add(key);
    if (mode === 'write') writeEdgeKeys.add(key);
    applied++;
  }

  if (applied > 0) {
    await client.putModel(projectId, architectureId, filename, model);
  }

  return { applied, skipped };
}
