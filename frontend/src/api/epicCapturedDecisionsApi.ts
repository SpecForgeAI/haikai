/**
 * Epic Captured Decisions API client.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 8
 *
 * Thin client around the gateway proxy routes that forward to the AMS CRUD
 * endpoints introduced by Task Group 4:
 *
 *   GET    /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions
 *   POST   /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions
 *   PATCH  /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}
 *   DELETE /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}
 *
 * AMS persists field names in camelCase form when MockMvc-standalone tests are
 * involved, but the production application.yml registers a global Jackson
 * `SNAKE_CASE` property naming strategy. To stay future-proof against any
 * naming-strategy override AND to be tolerant of both shapes (snake_case wire
 * + camelCase legacy) we accept both at the boundary and normalise to a
 * camelCase `EpicCapturedDecisionDto` for the rest of the frontend. This
 * mirrors the precedent in `migrationDeliveryDashboardApi.ts` (follow-up #10).
 *
 * Source vocabulary:
 *   - `auto_extracted`: auto-seeded from a pass-1 parser run (has non-null
 *     sourceSpecGenerationId).
 *   - `user_edited`: an `auto_extracted` row that has since been PATCHed by a
 *     user. The AMS service layer flips the flag automatically and pins the
 *     row against future auto-overwrite.
 *   - `user_added`: created by the user via POST.
 *
 * Status vocabulary: `draft`, `confirmed`, `superseded`.
 */

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Public types (camelCase, consumed throughout the React tree)
// ============================================================================

export type EpicCapturedDecisionSource =
  | 'auto_extracted'
  | 'user_edited'
  | 'user_added';

export type EpicCapturedDecisionStatus =
  | 'draft'
  | 'confirmed'
  | 'superseded';

export interface EpicCapturedDecisionDto {
  id: string;
  projectId: string;
  epicWorkItemId: string;
  decisionKey: string;
  decisionText: string;
  source: EpicCapturedDecisionSource;
  /** Spec-generation row this decision was auto-seeded from (null for user_added). */
  sourceSpecGenerationId: string | null;
  status: EpicCapturedDecisionStatus;
  lastEditedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ============================================================================
// Private wire shape -- accepts BOTH snake_case and camelCase keys so we stay
// resilient to a Jackson naming-strategy flip.
// ============================================================================

interface EpicCapturedDecisionWireDto {
  // snake_case (production application.yml SNAKE_CASE strategy)
  id?: string | null;
  project_id?: string | null;
  epic_work_item_id?: string | null;
  decision_key?: string | null;
  decision_text?: string | null;
  source?: string | null;
  source_spec_generation_id?: string | null;
  status?: string | null;
  last_edited_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // camelCase fallbacks (MockMvc standalone tests and any naming-strategy override)
  projectId?: string | null;
  epicWorkItemId?: string | null;
  decisionKey?: string | null;
  decisionText?: string | null;
  sourceSpecGenerationId?: string | null;
  lastEditedBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function coerce(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c;
  }
  return null;
}

function mapDecision(w: EpicCapturedDecisionWireDto): EpicCapturedDecisionDto {
  const source = (coerce(w.source) ?? 'user_added') as EpicCapturedDecisionSource;
  const status = (coerce(w.status) ?? 'draft') as EpicCapturedDecisionStatus;
  return {
    id: coerce(w.id) ?? '',
    projectId: coerce(w.projectId, w.project_id) ?? '',
    epicWorkItemId: coerce(w.epicWorkItemId, w.epic_work_item_id) ?? '',
    decisionKey: coerce(w.decisionKey, w.decision_key) ?? '',
    decisionText: coerce(w.decisionText, w.decision_text) ?? '',
    source,
    sourceSpecGenerationId: coerce(
      w.sourceSpecGenerationId,
      w.source_spec_generation_id,
    ),
    status,
    lastEditedBy: coerce(w.lastEditedBy, w.last_edited_by),
    createdAt: coerce(w.createdAt, w.created_at),
    updatedAt: coerce(w.updatedAt, w.updated_at),
  };
}

// ============================================================================
// Errors
// ============================================================================

async function parseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  let serverMessage = '';
  try {
    const errorBody = (await res.json()) as {
      message?: string;
      error?: string | { message?: string };
    };
    const nested =
      typeof errorBody.error === 'object' && errorBody.error
        ? errorBody.error.message
        : typeof errorBody.error === 'string'
          ? errorBody.error
          : '';
    serverMessage = errorBody.message || nested || '';
  } catch {
    // ignore JSON parse failure
  }
  return serverMessage || fallback;
}

// ============================================================================
// API functions
// ============================================================================

function buildBase(projectId: string, epicWorkItemId: string): string {
  return (
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/epics/${encodeURIComponent(epicWorkItemId)}/captured-decisions`
  );
}

/**
 * List all captured decisions for an epic. AMS returns an empty array if no
 * rows exist for the (projectId, epicWorkItemId) pair -- it does NOT 404 in
 * that case (the resource is the collection; an empty collection is OK).
 */
export async function listEpicCapturedDecisions(
  projectId: string,
  epicWorkItemId: string,
): Promise<EpicCapturedDecisionDto[]> {
  const res = await fetch(buildBase(projectId, epicWorkItemId), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to list captured decisions: ${res.status} ${res.statusText}`,
    );
    throw new Error(msg);
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return (raw as EpicCapturedDecisionWireDto[]).map(mapDecision);
}

/**
 * Create a new `user_added` decision. AMS pins the source to `user_added`
 * regardless of any incoming source field; the gateway forwards the request
 * verbatim.
 */
export async function createEpicCapturedDecision(
  projectId: string,
  epicWorkItemId: string,
  body: {
    decisionKey: string;
    decisionText: string;
    status?: EpicCapturedDecisionStatus;
    lastEditedBy?: string;
  },
): Promise<EpicCapturedDecisionDto> {
  const wireBody = {
    decisionKey: body.decisionKey,
    decisionText: body.decisionText,
    status: body.status ?? 'draft',
    lastEditedBy: body.lastEditedBy ?? null,
  };
  const res = await fetch(buildBase(projectId, epicWorkItemId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(wireBody),
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to create captured decision: ${res.status} ${res.statusText}`,
    );
    throw new Error(msg);
  }
  return mapDecision((await res.json()) as EpicCapturedDecisionWireDto);
}

/**
 * PATCH a captured decision. Any non-null field on an `auto_extracted` row
 * flips its source to `user_edited` and pins the row against further
 * auto-overwrite (server-side, per Task Group 4 service-layer rules).
 */
export async function updateEpicCapturedDecision(
  projectId: string,
  epicWorkItemId: string,
  id: string,
  body: {
    decisionKey?: string | null;
    decisionText?: string | null;
    status?: EpicCapturedDecisionStatus | null;
    lastEditedBy?: string | null;
  },
): Promise<EpicCapturedDecisionDto> {
  const wireBody: Record<string, unknown> = {};
  if (body.decisionKey !== undefined) wireBody.decisionKey = body.decisionKey;
  if (body.decisionText !== undefined)
    wireBody.decisionText = body.decisionText;
  if (body.status !== undefined) wireBody.status = body.status;
  if (body.lastEditedBy !== undefined)
    wireBody.lastEditedBy = body.lastEditedBy;

  const url = `${buildBase(projectId, epicWorkItemId)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(wireBody),
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to update captured decision: ${res.status} ${res.statusText}`,
    );
    throw new Error(msg);
  }
  return mapDecision((await res.json()) as EpicCapturedDecisionWireDto);
}

/**
 * Per-epic captured-decisions count summary. One row per epic that has at
 * least one decision in the project; epics with no rows are omitted.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Follow-up #3 (replaces
 * the dashboard's O(epic-count) per-epic GETs with one project-scoped call).
 */
export interface EpicCapturedDecisionsCountByEpicDto {
  epicWorkItemId: string;
  draftCount: number;
  confirmedCount: number;
  supersededCount: number;
}

interface EpicCapturedDecisionsCountWireDto {
  epicWorkItemId?: string | null;
  epic_work_item_id?: string | null;
  draftCount?: number | null;
  draft_count?: number | null;
  confirmedCount?: number | null;
  confirmed_count?: number | null;
  supersededCount?: number | null;
  superseded_count?: number | null;
}

function mapCountByEpic(
  w: EpicCapturedDecisionsCountWireDto,
): EpicCapturedDecisionsCountByEpicDto {
  return {
    epicWorkItemId: coerce(w.epicWorkItemId, w.epic_work_item_id) ?? '',
    draftCount:
      w.draftCount ?? w.draft_count ?? 0,
    confirmedCount:
      w.confirmedCount ?? w.confirmed_count ?? 0,
    supersededCount:
      w.supersededCount ?? w.superseded_count ?? 0,
  };
}

/**
 * GET the project-wide per-epic count summary. Returns one entry per epic
 * that has at least one captured decision.
 */
export async function getCapturedDecisionsSummary(
  projectId: string,
): Promise<EpicCapturedDecisionsCountByEpicDto[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/captured-decisions/summary`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to load captured-decisions summary: ${res.status} ${res.statusText}`,
    );
    throw new Error(msg);
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return (raw as EpicCapturedDecisionsCountWireDto[]).map(mapCountByEpic);
}

/**
 * Delete a captured decision. The response carries the final audit state
 * before the row is removed; the frontend uses this primarily as a success
 * signal and re-fetches the list afterwards.
 */
export async function deleteEpicCapturedDecision(
  projectId: string,
  epicWorkItemId: string,
  id: string,
  lastEditedBy?: string,
): Promise<EpicCapturedDecisionDto> {
  const qs = lastEditedBy
    ? `?lastEditedBy=${encodeURIComponent(lastEditedBy)}`
    : '';
  const url = `${buildBase(projectId, epicWorkItemId)}/${encodeURIComponent(id)}${qs}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const msg = await parseErrorMessage(
      res,
      `Failed to delete captured decision: ${res.status} ${res.statusText}`,
    );
    throw new Error(msg);
  }
  return mapDecision((await res.json()) as EpicCapturedDecisionWireDto);
}
