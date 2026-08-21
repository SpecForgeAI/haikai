/**
 * Effect-map backfill client (2026-08-20).
 *
 * Gateway routes (snake_case wire):
 *   POST /api/v1/projects/{p}/architectures/{a}/effect-map-backfill/run
 *     — derives endpoint->write-table effects from the structural corpus
 *       (auto-applied additively) + guarded LLM proposals for the rest.
 *   POST /api/v1/projects/{p}/architectures/{a}/effect-map-backfill/apply
 *     — applies the APPROVED proposal subset additively.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

export interface BackfillEndpointRef {
  endpoint_id: string;
  method: string;
  path: string;
}

export interface BackfillDerived extends BackfillEndpointRef {
  tables: string[];
  evidence: string;
  unknown_tables: string[];
}

export interface BackfillProposal extends BackfillEndpointRef {
  tables: string[];
  rationale: string;
  guard_rejected: string[];
}

export interface BackfillUnproposed extends BackfillEndpointRef {
  reason: string;
}

export interface BackfillDiagnosis extends BackfillEndpointRef {
  stage: 'no_root_match' | 'chain_broken' | 'boundaries_without_write_sql';
  matched_roots: string[];
  same_verb_root_fragments: string[];
  broken_calls: string[];
  boundaries_reached: string[];
}

export interface BackfillProvenRead extends BackfillEndpointRef {
  read_tables: string[];
  evidence: string;
}

export interface BackfillSummary {
  unmapped_count: number;
  by_stage: Record<string, number>;
  top_broken_targets: string[];
  /** Endpoints excluded up front: the model already carries read effect
   *  edges for them — the capture preflight does not block those. */
  read_mapped_count: number;
  /** Endpoints proven read-only THIS run (read edges auto-applied). */
  proven_read_count: number;
}

export interface EffectMapBackfillRunResponse {
  unmapped_count: number;
  summary: BackfillSummary;
  derived: BackfillDerived[];
  derived_apply: { applied: number; skipped: Array<{ reason: string }> } | null;
  proven_read: BackfillProvenRead[];
  proven_read_apply: { applied: number; skipped: Array<{ reason: string }> } | null;
  proposals: BackfillProposal[];
  unproposed: BackfillUnproposed[];
  trace: BackfillDiagnosis[];
}

export interface EffectMapApplyResponse {
  applied: number;
  skipped: Array<{ reason: string }>;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : JSON.stringify({}),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message = (parsed as { error?: string } | null)?.error ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

function base(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/effect-map-backfill`
  );
}

export function runEffectMapBackfill(
  projectId: string,
  architectureId: string,
): Promise<EffectMapBackfillRunResponse> {
  return post<EffectMapBackfillRunResponse>(`${base(projectId, architectureId)}/run`);
}

export function applyEffectMapProposals(
  projectId: string,
  architectureId: string,
  effects: Array<{ endpoint_id: string; table_name: string }>,
): Promise<EffectMapApplyResponse> {
  return post<EffectMapApplyResponse>(`${base(projectId, architectureId)}/apply`, { effects });
}
