/**
 * Apply Mapping Mutations Client -- Architect-Persona Conversation
 * (Spec 3, Commit 4)
 *
 * Spec: 2026-05-24-target-state-architect-conversation
 *
 * Thin POST wrapper over the new Architecture Model Service endpoint
 *   POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}
 *        /captured-decisions/{decisionId}/apply-mapping-mutations
 *
 * Sibling to `targetStateCapturedDecisionsWriter.ts` (which POSTs the
 * captured-decision row this endpoint then mutates against). The gateway
 * orchestrator invokes both in sequence -- write the decision first, then
 * apply the deterministic mapping mutations via this client -- and surfaces
 * the result as a `mapping-mutation-summary` conversation turn.
 *
 * IMPORTANT: This module makes HTTP calls. Tests stub `global.fetch`.
 */

import { getConfig } from '../../config';
import { logger } from '../logger';
import type {
  AffectedTableName,
  MappingTypeChange,
  ScopeBoundary,
} from '../../config/architect-conversation/mappingMutationRules';
import type { ScopeRefType } from '../../config/architect-conversation/questionLibrary';

// ---------------------------------------------------------------------------
// Wire-format request shape (mirrors the AMS Java DTO verbatim)
// ---------------------------------------------------------------------------

/**
 * Mirrors {@code ApplyMappingMutationsRequest} on the Architecture Model
 * Service side. lowerCamelCase wire format. The gateway forwards the rule
 * subset from `MAPPING_MUTATION_RULES` for the captured decision's
 * `decisionCode` so AMS does not need its own copy of the rules.
 *
 * Field meanings:
 * - `affectedTableSets`: the supertype element-type identifiers whose
 *   mappings the decision affects. Empty list = notes-only.
 * - `defaultMappingTypeChange`: one of the `MappingTypeChange` values; `none`
 *   means notes-only.
 * - `scopeBoundary`: always `parent-not-leaf` in v1 per Q15.
 * - `elementRefType` + `elementRefId`: optional per-element exception
 *   narrowing. Both present or both absent. `elementRefType` is one of the
 *   Q12 closed `scope_ref_type` set.
 */
export interface ApplyMappingMutationsRequestBody {
  affectedTableSets: AffectedTableName[];
  defaultMappingTypeChange: MappingTypeChange;
  scopeBoundary: ScopeBoundary;
  elementRefType?: ScopeRefType | null;
  elementRefId?: string | null;
}

// ---------------------------------------------------------------------------
// Wire-format response shape (mirrors the AMS Java DTO verbatim)
// ---------------------------------------------------------------------------

export interface ApplyMappingMutationsTableSetSummary {
  tableSet: string;
  affectedMappings: number;
  mappingTypeChanges: number;
  notesDecorations: number;
}

export interface ApplyMappingMutationsResponseBody {
  affectedMappings: number;
  mappingTypeChanges: number;
  notesDecorations: number;
  tableSetSummary: ApplyMappingMutationsTableSetSummary[];
}

// ---------------------------------------------------------------------------
// HTTP error type
// ---------------------------------------------------------------------------

/**
 * Raised when the AMS POST returns a non-2xx status. The orchestrator catches
 * this and surfaces an `error` turn with
 * `errorKind = 'mapping-mutation-failed'` rather than throwing through the
 * rest of the conversation flow. The captured-decision row written by the
 * prior POST is NOT rolled back -- decisions and mutations are separate
 * transactions and the spec accepts eventual consistency in this failure
 * mode (the user can retry).
 */
export class ApplyMappingMutationsError extends Error {
  public readonly status: number;
  public readonly bodyText: string;
  constructor(status: number, bodyText: string) {
    super(
      `architecture model service apply-mapping-mutations POST failed: HTTP ${status} body=${bodyText.slice(0, 200)}`,
    );
    this.name = 'ApplyMappingMutationsError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * POSTs to the AMS apply-mapping-mutations endpoint for the given captured
 * decision. Returns the per-table-set summary the gateway uses to render the
 * `mapping-mutation-summary` conversation turn.
 *
 * Throws `ApplyMappingMutationsError` on non-2xx response so the orchestrator
 * can translate the failure into an `error` turn without unwinding the
 * already-written captured-decision row (the contract is "decisions and
 * mutations are separate transactions; the user can retry").
 *
 * Equivalent of the AMS service's
 * `applyMappingMutationsForDecision(projectId, targetArchitectureId,
 * decisionId, ruleSubset)` call signature documented in tasks.md §4.4.
 */
export async function applyMappingMutationsForDecision(
  projectId: string,
  targetArchitectureId: string,
  decisionId: string,
  body: ApplyMappingMutationsRequestBody,
): Promise<ApplyMappingMutationsResponseBody> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/captured-decisions/${encodeURIComponent(decisionId)}` +
    `/apply-mapping-mutations`;

  logger.debug('POSTing apply-mapping-mutations to architecture model service', {
    projectId,
    targetArchitectureId,
    decisionId,
    affectedTableSets: body.affectedTableSets,
    defaultMappingTypeChange: body.defaultMappingTypeChange,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApplyMappingMutationsError(response.status, text);
  }

  const parsed = (await response.json()) as ApplyMappingMutationsResponseBody;
  return parsed;
}
