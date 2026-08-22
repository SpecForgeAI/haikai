/**
 * Foundations Review client (Foundations & Scope program, Spec 2,
 * 2026-08-22).
 *
 * Gateway routes (snake_case wire):
 *   GET  /api/v1/projects/{p}/architectures/{a}/foundation-decisions
 *   POST /api/v1/projects/{p}/architectures/{a}/foundation-decisions/apply
 *        — MCP apply_foundation_decisions: scope tags + receipts on named
 *          entities, additive PK promotion, decisions upserted to AMS.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

export interface FoundationDecisionDto {
  id: string;
  project_id: string;
  architecture_id: string;
  decision_key: string;
  rule_key: string;
  question_text: string | null;
  answer: string;
  scope: string | null;
  targets_json: Array<{ entity_name?: string }> | null;
  payload_json: Record<string, unknown> | null;
  rationale: string | null;
  evidence_hash: string | null;
  stale: boolean | null;
  decided_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ApplyFoundationDecisionInput {
  decision_key: string;
  rule_key: string;
  question_text?: string | null;
  answer: string;
  scope?: string | null;
  target_entity_names: string[];
  payload_json?: Record<string, unknown> | null;
  rationale?: string | null;
  evidence_hash?: string | null;
}

export interface ApplyFoundationDecisionsResponse {
  entities_updated: number;
  decisions_upserted: number;
  skipped: Array<{ decision_key: string; entity_name: string; reason: string }>;
}

function base(projectId: string, architectureId: string): string {
  return (
    `${GATEWAY_BASE}/api/v1/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/foundation-decisions`
  );
}

async function parse<T>(response: Response): Promise<T> {
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

export async function listFoundationDecisions(
  projectId: string,
  architectureId: string,
): Promise<FoundationDecisionDto[]> {
  const response = await fetch(base(projectId, architectureId), {
    headers: { Accept: 'application/json' },
  });
  return parse<FoundationDecisionDto[]>(response);
}

export async function applyFoundationDecisions(
  projectId: string,
  architectureId: string,
  decisions: ApplyFoundationDecisionInput[],
): Promise<ApplyFoundationDecisionsResponse> {
  const response = await fetch(`${base(projectId, architectureId)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  return parse<ApplyFoundationDecisionsResponse>(response);
}


/** Raw committed model (snake_case, unnormalized) for the JOINT foundation
 *  rules (Spec 5) — AMS-direct via the vite catch-all proxy. */
export async function fetchRawModelForFoundations(
  projectId: string,
  architectureId: string,
): Promise<unknown | null> {
  try {
    const response = await fetch(
      `/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
