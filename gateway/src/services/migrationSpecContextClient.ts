/**
 * Migration Spec Context client (Spec 2 PM Migration Shape-Spec Batch Generation).
 *
 * Spec: 2026-05-19 PM Migration Shape-Spec Batch Generation
 * Task Group 5: Gateway Focused-Context Client.
 *
 * Thin typed wrapper over the architecture-model-service focused-context
 * endpoint `POST /api/projects/{projectId}/migration-spec-context`. Returns
 * the `MigrationSpecContextDto` verbatim (no business logic in the gateway).
 *
 * The endpoint resolves a per-story focused payload — narrower and more
 * actionable than the project-level `migration-discovery-context` (Spec 1's
 * Q-12 resolver). The new resolver is registered separately in
 * `contextResolvers.ts` (per A-5) but MAY internally call the existing
 * migration-summary resolver for project-level base context. This client is
 * the gateway-side caller; Group 7 owns the AMS controller / service / new
 * `MigrationSpecContextResolver` Java class.
 *
 * Six supported context-type blocks (per spec.md): `service`, `api`, `soap`,
 * `data`, `infrastructure`, `test_pack`. Each block carries:
 *   - story-scoped detail (current-state architecture refs, target-state
 *     refs, contract / baseline / mapping ids, evidence ids); and
 *   - optional `missingInputs[]` blockers when the resolver detects required
 *     detail is absent.
 *
 * The DTO also carries a TOP-LEVEL optional `missingInputs[]` for blockers
 * that span the whole story (e.g. an unresolved decision-task finding that
 * affects every context type). On either signal, the gateway batch handler
 * (Group 6) decides whether to attempt LLM generation with the partial
 * payload or short-circuit to `status='insufficient_context'`.
 *
 * Error handling:
 *   - AMS 4xx/5xx → throws {@link MigrationSpecContextClientError} carrying
 *     the upstream status + body so Group 6's handler can map the failure
 *     to a per-story `failed` result (R-12 — per-story failure isolation,
 *     never aborts the batch).
 *   - Network / fetch failures → re-thrown as the raw error; callers handle.
 *
 * Cross-Story Context Injection extension (2026-05-20, Task Group 5):
 *   - Optional request fields `pass` (1 or 2) and `passOneSpecIdsInScope[]`
 *     forwarded to AMS so the resolver can return pass-1-only sibling
 *     summaries.
 *   - Response shape extended with four optional top-level blocks
 *     `sibling_summaries`, `parent_rollup`, `workstream_context`, `budget_meta`.
 *
 * Design-point refs:
 *   - A-5 new resolver, separate from the existing migration-summary resolver
 *   - R-12 per-story failure isolation (typed error so Group 6 can record
 *     failure without aborting the batch)
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Supported context types (per spec.md)
// ---------------------------------------------------------------------------

export const MIGRATION_SPEC_CONTEXT_TYPES = [
  'service',
  'api',
  'soap',
  'data',
  'infrastructure',
  'test_pack',
  // 7th type (D3, 2026-06-14): a non-API D2 `discovery_capability` grouping
  // (batch pipeline / monitoring / FTP ingestion / deployment / housekeeping)
  // OR a behaviour-bearing `operational_artifact` finding fallback. The single
  // wire token is used whether the source is a capability or a finding.
  // `SHAPE_SPEC_CONTEXT_TYPES` spreads this list, so the handler requests it
  // automatically.
  'operational_capability',
] as const;
export type MigrationSpecContextType =
  (typeof MIGRATION_SPEC_CONTEXT_TYPES)[number];

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

/**
 * Input shape for {@link fetchMigrationSpecContext}.
 *
 * `contextTypes` selects which of the six blocks AMS should populate.
 * Pass-through wire shape — AMS applies the per-block cap defaults documented
 * in its controller when `maxFindings` / `maxEvidenceItems` / `maxBaselineItems`
 * are omitted.
 *
 * `pass` and `passOneSpecIdsInScope` (Cross-Story Context Injection, Task
 * Group 5) are optional. When `pass=2`, AMS will populate
 * `sibling_summaries[]` filtered to pass-1 rows only (loop guardrail at the
 * resolver boundary).
 */
export interface FetchMigrationSpecContextInput {
  projectId: string;
  bookOfWorkId: string;
  bookItemId: string;
  workItemId: string;
  currentArchitectureId: string;
  targetArchitectureId?: string | null;
  contextTypes: MigrationSpecContextType[];
  maxFindings?: number;
  maxEvidenceItems?: number;
  maxBaselineItems?: number;
  /** Cross-story context injection: 1 or 2; absent defaults to pass-1 semantics. */
  pass?: 1 | 2;
  /**
   * Cross-story context injection: optional whitelist of pass-1 spec
   * generation row ids the resolver may read for sibling summaries. Ignored
   * on pass=1.
   */
  passOneSpecIdsInScope?: string[];
  /**
   * D3 (2026-06-14): the `discovery_capability` UUID this story was minted from
   * (read by the gateway from the WorkItem's `book_of_work_json` blob item's
   * `source_capability_id`). Forwarded to AMS so the resolver loads the
   * capability (PREFERRED source) by this id for the 7th
   * `operational_capability` block; when absent / unresolved the resolver falls
   * back to a behaviour-bearing `operational_artifact` finding. NO DDL.
   */
  sourceCapabilityId?: string | null;
}

// ---------------------------------------------------------------------------
// missingInputs blocker shape -- shared across the DTO
// ---------------------------------------------------------------------------

/**
 * A single missing-input blocker entry, the shape used both at the top level
 * of the DTO and on each populated context-type block.
 *
 * `kind` is a short categorical tag (`mapping`, `contract`, `baseline`,
 * `decision_task`, `finding`, `data_entity`, `evidence`, ...). `id` is
 * populated when the missing element has a referenceable id (e.g. an
 * unresolved decision-task id); absent when the gap is "no element of this
 * kind exists yet". `reason` is a human-readable explanation.
 */
export interface MigrationSpecContextMissingInput {
  kind: string;
  id?: string | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Per-context-type block shapes
// ---------------------------------------------------------------------------

/**
 * Common shape carried by every context-type block. Each block is a free-form
 * `Record<string, unknown>` to keep the gateway-side wire shape resilient to
 * AMS-side additions without breaking the type — the only AMS-guaranteed
 * fields are `missingInputs[]` when blockers are present.
 *
 * Block-specific helpers (`MigrationSpecServiceBlock`,
 * `MigrationSpecApiBlock`, ...) document the conventional fields per type
 * that consumers may read defensively.
 */
export interface MigrationSpecContextBlock {
  /** Optional block-scoped blockers (e.g. mapping missing for an api block). */
  missingInputs?: MigrationSpecContextMissingInput[];
  /** All block-specific detail flows through this open-ended record. */
  [key: string]: unknown;
}

/** Conventional shape for the `service` block. */
export interface MigrationSpecServiceBlock extends MigrationSpecContextBlock {
  serviceId?: string;
  name?: string;
  currentArchitectureRefs?: string[];
  targetArchitectureRefs?: string[];
  relatedComponentIds?: string[];
}

/** Conventional shape for the `api` block (REST / OAS operation). */
export interface MigrationSpecApiBlock extends MigrationSpecContextBlock {
  operationId?: string;
  oasContractId?: string;
  behaviourBaselineIds?: string[];
  mappingIds?: string[];
}

/** Conventional shape for the `soap` block (SOAP / WSDL operation). */
export interface MigrationSpecSoapBlock extends MigrationSpecContextBlock {
  operationName?: string;
  wsdlRef?: string;
  baselineIds?: string[];
  mappingIds?: string[];
}

/** Conventional shape for the `data` block (data entity / table). */
export interface MigrationSpecDataBlock extends MigrationSpecContextBlock {
  entityId?: string;
  schemaRefs?: string[];
  mappingIds?: string[];
  reconciliationRefs?: string[];
}

/** Conventional shape for the `infrastructure` block. */
export interface MigrationSpecInfrastructureBlock
  extends MigrationSpecContextBlock {
  deploymentTargets?: string[];
  envRefs?: string[];
}

/** Conventional shape for the `test_pack` block. */
export interface MigrationSpecTestPackBlock extends MigrationSpecContextBlock {
  testPackIds?: string[];
  reconciliationHooks?: string[];
}

/**
 * Conventional shape for the 7th `operational_capability` block (D3,
 * 2026-06-14). Assembled by the AMS resolver from a D2 `discovery_capability`
 * (preferred, by `sourceCapabilityId`) or a behaviour-bearing
 * `operational_artifact` finding (fallback). The block carries the batch-spine
 * topology snapshot (`detailJson`: JIL-DAG, `invocations[]` edges, schedule /
 * trigger metadata, inputs / outputs, side-effects, external systems, the
 * aggregated `behaviourBearing` hint), members + their kinds, and `name` /
 * `kind` / `summary`. The inner fields are camelCase on the wire (the AMS DTO
 * pins them via explicit `@JsonProperty`); the `operational_capability` block
 * KEY itself is snake_case. Block-level `missingInputs[]` (e.g.
 * `capability_members` / `capability_behaviour`) signal a thin source.
 */
export interface MigrationSpecOperationalCapabilityBlock
  extends MigrationSpecContextBlock {
  capabilityId?: string | null;
  findingId?: string | null;
  source?: string;
  name?: string;
  kind?: string;
  summary?: string;
  confidence?: number | null;
  reviewStatus?: string | null;
  behaviourBearing?: boolean;
  members?: Array<Record<string, unknown>>;
  memberKinds?: string[];
  detailJson?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Cross-Story Context Injection top-level block shapes (Task Group 3 + 5)
// ---------------------------------------------------------------------------

/**
 * One sibling story's parser-extracted summary attached to a pass-2 context
 * response. Mirrors AMS-side `MigrationSpecContextDto.SiblingSummary`.
 */
export interface MigrationSpecSiblingSummary {
  workItemId: string;
  title?: string;
  decisions?: string[];
  interfaces?: string[];
  assumptions?: string[];
  generationPass?: number;
}

/** A captured-decision entry shipped inside the epic block of parent_rollup. */
export interface MigrationSpecCapturedDecision {
  id?: string;
  decisionKey?: string;
  decisionText?: string;
  status?: string;
  source?: string;
}

export interface MigrationSpecEpicBlock {
  workItemId?: string;
  title?: string;
  description?: string;
  capturedDecisions?: MigrationSpecCapturedDecision[];
}

export interface MigrationSpecFeatureBlock {
  workItemId?: string;
  title?: string;
  summary?: string;
}

export interface MigrationSpecInitiativeBlock {
  workItemId?: string;
  title?: string;
  summary?: string;
}

export interface MigrationSpecParentRollup {
  epic?: MigrationSpecEpicBlock;
  feature?: MigrationSpecFeatureBlock;
  initiative?: MigrationSpecInitiativeBlock;
}

export interface MigrationSpecDedupedRef {
  id?: string;
  kind?: string;
  label?: string;
  referencedByStoryIds?: string[];
}

export interface MigrationSpecWorkstreamContext {
  apiBaselines?: MigrationSpecDedupedRef[];
  architectureRefs?: MigrationSpecDedupedRef[];
}

export interface MigrationSpecBudgetMetaTrimmed {
  sibling_specs_dropped?: number;
  evidence_refs_dropped?: number;
  findings_dropped?: number;
}

export interface MigrationSpecBudgetMeta {
  used_tokens?: number;
  max_tokens?: number;
  per_story_max_tokens?: number;
  cross_story_max_tokens?: number;
  trimmed?: MigrationSpecBudgetMetaTrimmed;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Top-level DTO shape (matches the AMS response from Group 7)
// ---------------------------------------------------------------------------

/**
 * Response shape returned by the focused-context endpoint.
 *
 * - Every requested context type appears as a populated block field on the
 *   DTO (or omitted when the resolver could not assemble any detail for that
 *   block — in which case the top-level `missingInputs[]` carries the gap).
 * - When required detail is absent for a single block, the block itself
 *   carries a `missingInputs[]` array.
 * - Top-level `missingInputs[]` covers story-wide blockers (e.g. an
 *   unresolved decision task that prevents any context type from being
 *   meaningful).
 * - Returns HTTP 200 with a partial DTO when blockers are present (the
 *   gateway batch handler decides between attempting LLM generation and
 *   short-circuiting to `insufficient_context`); 4xx/5xx is reserved for
 *   technical failures.
 *
 * Cross-Story Context Injection extension (2026-05-20):
 *   - Top-level `sibling_summaries`, `parent_rollup`, `workstream_context`,
 *     `budget_meta` are optional and only populated when the request carries
 *     the appropriate `pass` / `passOneSpecIdsInScope[]` hints.
 */
export interface MigrationSpecContextDto {
  projectId: string;
  bookOfWorkId: string;
  workItemId: string;
  bookItemId?: string;
  currentArchitectureId?: string;
  targetArchitectureId?: string | null;
  generatedAt?: string;

  // Six supported context-type blocks (each optional — only populated when
  // requested AND when AMS could assemble at least partial detail).
  service?: MigrationSpecServiceBlock;
  api?: MigrationSpecApiBlock;
  soap?: MigrationSpecSoapBlock;
  data?: MigrationSpecDataBlock;
  infrastructure?: MigrationSpecInfrastructureBlock;
  test_pack?: MigrationSpecTestPackBlock;
  // 7th block (D3, 2026-06-14); only populated when `operational_capability`
  // is requested AND the resolver could assemble at least partial detail.
  operational_capability?: MigrationSpecOperationalCapabilityBlock;

  /** Story-wide blockers when required detail is absent across the board. */
  missingInputs?: MigrationSpecContextMissingInput[];

  // Cross-Story Context Injection (2026-05-20, Task Groups 3 + 5).
  /** Pass-2 only: sibling story summaries (pass-1 outputs that already exist). */
  sibling_summaries?: MigrationSpecSiblingSummary[];
  /** Walked parent chain: epic captured decisions + feature/initiative summaries. */
  parent_rollup?: MigrationSpecParentRollup;
  /** Workstream-deduped API baselines + architecture refs. */
  workstream_context?: MigrationSpecWorkstreamContext;
  /** Token-budget envelope mirroring the resolver's BudgetMetaTracker output. */
  budget_meta?: MigrationSpecBudgetMeta;

  /** Free-form additional fields AMS may include (e.g. context warnings). */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Typed error for non-2xx responses
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link fetchMigrationSpecContext} on any non-2xx AMS response.
 *
 * Carries the upstream HTTP `status` and parsed JSON `body` so Group 6's
 * batch handler can decide whether to retry (transient 5xx), map to per-story
 * `failed` (validation 4xx), or short-circuit to `insufficient_context`
 * (project / architecture / book / story not found). Per R-12 the error
 * NEVER causes a whole-batch abort.
 */
export class MigrationSpecContextClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(
      message ||
        `Migration spec context service responded ${status}`
    );
    this.name = 'MigrationSpecContextClientError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Client function
// ---------------------------------------------------------------------------

/**
 * Calls `POST /api/projects/{projectId}/migration-spec-context` on AMS and
 * returns the parsed `MigrationSpecContextDto` verbatim.
 *
 * Throws {@link MigrationSpecContextClientError} on any non-2xx response so
 * Group 6's batch handler can map the failure to a per-story `failed` result
 * without aborting the batch (R-12). Network / fetch failures bubble up as
 * the raw error — callers handle.
 *
 * Structured success log (single line):
 *   `[diag-gateway] pm_migration_shape_spec_generation focused_context_fetched`
 *   `workItemId=<id> bookItemId=<id> contextTypes=<list> blocksReturned=<n> missingInputs=<n>`
 *
 * @param input  the typed request input
 * @returns      parsed `MigrationSpecContextDto`
 * @throws       MigrationSpecContextClientError on non-2xx responses
 */
export async function fetchMigrationSpecContext(
  input: FetchMigrationSpecContextInput
): Promise<MigrationSpecContextDto> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(input.projectId)}/migration-spec-context`;

  const requestBody: Record<string, unknown> = {
    bookOfWorkId: input.bookOfWorkId,
    bookItemId: input.bookItemId,
    workItemId: input.workItemId,
    currentArchitectureId: input.currentArchitectureId,
    targetArchitectureId: input.targetArchitectureId ?? null,
    contextTypes: input.contextTypes,
    maxFindings: input.maxFindings,
    maxEvidenceItems: input.maxEvidenceItems,
    maxBaselineItems: input.maxBaselineItems,
  };
  // Cross-Story Context Injection (2026-05-20, Task Group 5): forward pass +
  // passOneSpecIdsInScope when set. Omit entirely when absent so the AMS
  // resolver retains today's pass-1 default behaviour for legacy callers.
  if (typeof input.pass === 'number') {
    requestBody.pass = input.pass;
  }
  if (Array.isArray(input.passOneSpecIdsInScope)) {
    requestBody.passOneSpecIdsInScope = input.passOneSpecIdsInScope;
  }
  // D3 (2026-06-14): forward the per-story source capability id when present so
  // the AMS resolver populates the 7th `operational_capability` block from the
  // capability (preferred). Omit entirely when absent so non-capability stories
  // are unaffected and the resolver's finding-fallback path is used.
  if (typeof input.sourceCapabilityId === 'string' && input.sourceCapabilityId.length > 0) {
    requestBody.sourceCapabilityId = input.sourceCapabilityId;
  }

  logger.debug('Fetching migration spec context from architecture-model-service', {
    projectId: input.projectId,
    url,
    workItemId: input.workItemId,
    bookItemId: input.bookItemId,
    bookOfWorkId: input.bookOfWorkId,
    contextTypes: input.contextTypes,
    pass: input.pass,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const contentType = response.headers.get('content-type') || '';
  let body: unknown;
  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    try {
      const text = await response.text();
      body = text === '' ? null : text;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    logger.warn(
      'Architecture model service returned non-OK response for migration-spec-context',
      {
        projectId: input.projectId,
        workItemId: input.workItemId,
        status: response.status,
      }
    );
    throw new MigrationSpecContextClientError(response.status, body);
  }

  // Structural validation -- the DTO MUST be an object carrying the
  // documented top-level identity fields. Anything else means the upstream
  // returned 2xx with a malformed body (e.g. raw string) and downstream
  // code would silently misbehave; surface as a typed error.
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new MigrationSpecContextClientError(
      response.status,
      body,
      'Migration spec context response body is not a JSON object'
    );
  }

  const dto = body as MigrationSpecContextDto;
  if (
    typeof dto.workItemId !== 'string' ||
    typeof dto.bookOfWorkId !== 'string' ||
    typeof dto.projectId !== 'string'
  ) {
    throw new MigrationSpecContextClientError(
      response.status,
      body,
      'Migration spec context response is missing required identity fields (projectId / bookOfWorkId / workItemId)'
    );
  }

  // Compute counts for the structured log line.
  let blocksReturned = 0;
  for (const ct of MIGRATION_SPEC_CONTEXT_TYPES) {
    const block = (dto as Record<string, unknown>)[ct];
    if (block !== undefined && block !== null) {
      blocksReturned += 1;
    }
  }
  const missingInputsCount = Array.isArray(dto.missingInputs)
    ? dto.missingInputs.length
    : 0;

  // Single structured log line per spec.md.
  console.log(
    `[diag-gateway] pm_migration_shape_spec_generation focused_context_fetched ` +
      `workItemId=${input.workItemId} bookItemId=${input.bookItemId} ` +
      `contextTypes=${input.contextTypes.join(',')} ` +
      `blocksReturned=${blocksReturned} missingInputs=${missingInputsCount}` +
      (input.pass ? ` pass=${input.pass}` : '')
  );

  return dto;
}
