/**
 * Target State Captured Decisions client.
 *
 * Thin typed wrapper over Architecture Model Service endpoints:
 *
 *   GET /api/projects/{projectId}/active-target-architecture-id
 *     -> { activeTargetArchitectureId: <uuid> | null }
 *
 *   GET /api/projects/{projectId}/saved-target-architecture-id
 *     -> { savedTargetArchitectureId: <uuid> | null }
 *
 *   POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved
 *     -> { conversationSavedAt: <iso-8601> }
 *
 *   GET /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions
 *     -> List<TargetStateCapturedDecisionDto> (latest non-superseded rows only)
 *
 * No business logic in the gateway; the resolver consumes these calls in
 * sequence to render its bounded grouped-by-scope summary.
 *
 * Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 6.
 *
 * Spec: 2026-06-26 Target-State Conversation -- Save, Resume, and Plan Sourcing
 * Decoupled from "Active" -- Task Group 3 adds the most-recent-saved id finder
 * (the resolver default) plus the thin conversation-saved stamp client.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Wire-format types (mirror the Java DTOs verbatim, lowerCamelCase).
// ---------------------------------------------------------------------------

/**
 * Response envelope for
 * {@code GET /api/projects/{projectId}/active-target-architecture-id}.
 *
 * Architecture Model Service returns 200 with {@code activeTargetArchitectureId}
 * populated when an active target row exists, or {@code null} when it does not.
 */
export interface ActiveTargetArchitectureIdResponse {
  activeTargetArchitectureId: string | null;
}

/**
 * Response envelope for
 * {@code GET /api/projects/{projectId}/saved-target-architecture-id}.
 *
 * Architecture Model Service returns 200 with {@code savedTargetArchitectureId}
 * populated when at least one target row has a non-null
 * {@code conversation_saved_at} (most-recent-saved wins), or {@code null} when
 * no saved conversation exists. camelCase wire (mirrors the active-id envelope).
 */
export interface SavedTargetArchitectureIdResponse {
  savedTargetArchitectureId: string | null;
}

/**
 * Response envelope for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/conversation-saved}.
 *
 * Architecture Model Service returns 200 with the stamped {@code conversationSavedAt}
 * instant (ISO-8601 string). camelCase wire.
 */
export interface ConversationSavedResponse {
  conversationSavedAt: string;
}

/**
 * Mirrors {@code TargetStateCapturedDecisionDto} on the Architecture Model
 * Service side. lowerCamelCase wire format. All fields are nullable except
 * the ones declared NOT NULL in the DDL ({@code decisionId}, {@code projectId},
 * {@code targetArchitectureId}, {@code decisionCode}, {@code scopeKind},
 * {@code answerValue}, {@code createdAt}, {@code createdByTask}).
 */
export interface TargetStateCapturedDecision {
  decisionId: string;
  projectId: string;
  targetArchitectureId: string;
  decisionCode: string;
  scopeKind: string;
  scopeRefType?: string | null;
  scopeRefId?: string | null;
  answerValue: string;
  answerSummary?: string | null;
  standardsLookupRef?: string | null;
  conversationThreadId?: string | null;
  conversationTurnRef?: string | null;
  createdAt: string;
  createdByTask: string;
  supersededById?: string | null;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Fetches the project's active target architecture id (or null when no active
 * target draft exists). Used by the
 * {@code target-state-decisions-context} resolver to decide between the two
 * distinct "no target architecture defined yet" / "no decisions captured yet"
 * fallback strings.
 *
 * @throws on non-2xx response or network failure -- callers (the resolver)
 *         convert any failure into a fail-soft fallback string.
 */
export async function fetchActiveTargetArchitectureId(
  projectId: string,
): Promise<ActiveTargetArchitectureIdResponse> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/active-target-architecture-id`;

  logger.debug('Fetching active target architecture id from architecture model service', {
    projectId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service active-target-architecture-id lookup failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as ActiveTargetArchitectureIdResponse;
  return body;
}

/**
 * Fetches the project's most-recent-saved target architecture id (or null when
 * no conversation has been saved yet). Mirrors
 * {@link fetchActiveTargetArchitectureId} but resolves the saved-conversation
 * default rather than the active draft, decoupling the plan-sourcing resolvers
 * from "active" (Spec 2026-06-26 FR4 / Task Group 3).
 *
 * @throws on non-2xx response or network failure -- callers (the resolver)
 *         convert any failure into a fail-soft fallback string.
 */
export async function fetchMostRecentSavedTargetArchitectureId(
  projectId: string,
): Promise<SavedTargetArchitectureIdResponse> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/saved-target-architecture-id`;

  logger.debug('Fetching most-recent-saved target architecture id from architecture model service', {
    projectId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service saved-target-architecture-id lookup failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as SavedTargetArchitectureIdResponse;
  return body;
}

/**
 * Stamps {@code conversation_saved_at = now()} for a given target architecture
 * via {@code POST .../conversation-saved}, returning the stamped instant.
 *
 * Called by the architect-conversation close handler AFTER the CloseTurn append
 * + the target-tech-stack write. The caller treats this fail-soft: a throw is
 * surfaced additively on the close payload without aborting the close turn
 * (Spec 2026-06-26 FR3 / Task Group 3).
 *
 * @throws on non-2xx response or network failure -- the close handler converts
 *         any failure into a fail-soft typed outcome.
 */
export async function stampConversationSaved(
  projectId: string,
  targetArchitectureId: string,
): Promise<ConversationSavedResponse> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/conversation-saved`;

  logger.debug('Stamping conversation-saved marker on architecture model service', {
    projectId,
    targetArchitectureId,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service conversation-saved stamp failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as ConversationSavedResponse;
  return body;
}

/**
 * Fetches the latest non-superseded captured decisions for a (project,
 * targetArchitecture) pair. The default {@code includeSuperseded=false}
 * behaviour is preserved by omitting the query string -- the architecture
 * model service controller defaults the request parameter to false.
 *
 * @throws on non-2xx response or network failure -- callers (the resolver)
 *         convert any failure into a fail-soft fallback string.
 */
export async function fetchLatestCapturedDecisions(
  projectId: string,
  targetArchitectureId: string,
): Promise<TargetStateCapturedDecision[]> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/captured-decisions`;

  logger.debug('Fetching latest captured decisions from architecture model service', {
    projectId,
    targetArchitectureId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service captured-decisions list failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as TargetStateCapturedDecision[];
  return Array.isArray(body) ? body : [];
}
