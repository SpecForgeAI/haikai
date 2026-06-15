/**
 * Gateway orchestration handler for the
 * `product-manager--migration-delivery-sequencing` PM task.
 *
 * Spec: 2026-05-25 PM Tasks Captured Decisions Integration + Delivery Sequencing
 * (Group 2 -- new sequencing task end-to-end).
 *
 * Sole-orchestrator flow (mirrors `migrationBookOfWorkHandler.ts`):
 *   1. Resolve context: the supplied book of work (passed by id), the
 *      Migration Discovery Context (via the existing client), and the
 *      latest captured-decisions list for the active target architecture.
 *   2. Runtime gating:
 *        - no active target architecture       -> `insufficient_context` +
 *          recommendedNextAction = "Define a target architecture first".
 *        - no captured decisions on that target -> `insufficient_context` +
 *          recommendedNextAction = "Run the architect conversation first".
 *      The two paths are distinguished by `recommendedNextAction` text per
 *      Q10 of the requirements.
 *   3. Apply the token-budget cascade against the discovery context only
 *      (the captured-decisions block is appended POST-cascade and never
 *      truncated per spec.md). If the combined payload still overflows the
 *      soft cap, throw `TokenBudgetOverflowError` -- never silently drop
 *      decision lines.
 *   4. Single synchronous LLM call.
 *   5. Validate the structured response via
 *      `assertMigrationDeliverySequencingResponse` against the loaded
 *      book-of-work initiative ids.
 *   6. POST the validated sequencing answer to Spec 2's existing
 *      captured-decisions POST endpoint via the existing writer module.
 *      Write attributes (per Q15 + the spec's Sequencing decision-capture
 *      write attributes section):
 *        - decisionCode        = 'delivery.sequencing'
 *        - scopeKind           = 'architecture'
 *        - createdByTask       = 'product-manager--migration-delivery-sequencing'
 *        - conversationThreadId = null
 *        - conversationTurnRef = null
 *        - answerValue         = JSON-stringified `initiativeOrder` structure
 *      Supersession is handled by the Spec 2 data plane -- no
 *      `previousDecisionId` parameter is sent on re-runs.
 *
 * Return shape: `{ sequenceId, summary, status, recommendedNextAction? }`.
 *
 * Dependency injection: every external boundary is overridable for tests
 * (book-of-work loader, discovery-context fetcher, captured-decisions
 * fetchers, captured-decisions POST writer, LLM caller, system-prompt).
 *
 * Plain-English naming per `feedback_no_invented_acronyms.md`: error and
 * log strings spell out "Architecture Model Service" rather than introducing
 * an acronym.
 */

import * as fs from 'fs';
import * as path from 'path';

import { getConfig } from '../config';
import { logger } from './logger';
import {
  fetchMigrationDiscoveryContext as defaultFetchMigrationDiscoveryContext,
  MigrationDiscoveryContext,
  MigrationDiscoveryContextRequest,
} from './migrationDiscoveryContextClient';
import {
  applyTokenBudgetCascade,
  MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP,
  TokenBudgetOverflowError,
} from './migrationBookOfWorkHandler';
import {
  fetchActiveTargetArchitectureId as defaultFetchActiveTargetArchitectureId,
  fetchLatestCapturedDecisions as defaultFetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from './targetStateCapturedDecisionsClient';
import {
  postCapturedDecision as defaultPostCapturedDecision,
  CreateCapturedDecisionRequestBody,
} from './architectConversation/targetStateCapturedDecisionsWriter';
import {
  assertMigrationDeliverySequencingResponse,
  MigrationDeliverySequencingResponse,
  SequencedResponseA,
} from './migrationDeliverySequencingResponseValidator';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateMigrationDeliverySequencingInput {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
  bookOfWorkId: string;
  /** Optional discovery run ids passed through to the discovery context resolver. */
  discoveryRunIds?: string[];
  /** Optional API Behaviour Baseline ids passed through to the resolver. */
  apiBehaviourBaselineIds?: string[];
}

/**
 * Result envelope returned to the route layer. When `status='sequenced'`,
 * `sequenceId` is the captured-decision row id assigned by the Architecture
 * Model Service. When `status='insufficient_context'` or `status='failed'`,
 * no POST is issued and `sequenceId` is null.
 */
export interface GenerateMigrationDeliverySequencingResult {
  status: 'sequenced' | 'insufficient_context' | 'failed';
  sequenceId: string | null;
  summary: string;
  recommendedNextAction?: string;
  warnings?: Array<Record<string, unknown>>;
  errorMessage?: string;
}

// Re-export for handler-consumer convenience.
export { TokenBudgetOverflowError };

/**
 * Schema-level validation error wrapping the validator's `errors[]`. The
 * handler converts the validator-fail path into a `status='failed'` result
 * rather than throwing -- this class exists for callers that opt in to
 * `throwOnSchemaError` behaviour (currently none in production, but useful
 * for explicit-failure tests).
 */
export class MigrationDeliverySequencingSchemaError extends Error {
  public readonly errors: string[];
  constructor(errors: string[]) {
    super(
      `MigrationDeliverySequencingResponse failed validation: ${errors.join('; ')}`
    );
    this.name = 'MigrationDeliverySequencingSchemaError';
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Loaded book-of-work shape consumed by the handler
// ---------------------------------------------------------------------------

/**
 * Minimal shape -- only the fields the handler actually needs to derive the
 * set of valid initiative ids for the validator. Keep this narrow so tests
 * can fake it without standing up the full Architecture Model Service DTO.
 */
export interface LoadedBookOfWorkForSequencing {
  bookOfWorkId: string;
  projectId: string;
  initiativeIds: string[];
}

// ---------------------------------------------------------------------------
// Dependency-injection seams (mirrors migrationBookOfWorkHandler.ts)
// ---------------------------------------------------------------------------

export type BookOfWorkLoaderFn = (
  projectId: string,
  bookOfWorkId: string
) => Promise<LoadedBookOfWorkForSequencing>;

export type DiscoveryContextFetcherFn = (
  projectId: string,
  request: MigrationDiscoveryContextRequest
) => Promise<MigrationDiscoveryContext>;

export type ActiveTargetFetcherFn = (
  projectId: string
) => Promise<{ activeTargetArchitectureId: string | null }>;

export type CapturedDecisionsFetcherFn = (
  projectId: string,
  targetArchitectureId: string
) => Promise<TargetStateCapturedDecision[]>;

export type CapturedDecisionWriterFn = (
  projectId: string,
  targetArchitectureId: string,
  body: CreateCapturedDecisionRequestBody
) => Promise<TargetStateCapturedDecision>;

export type LlmCallerFn = (input: {
  systemPrompt: string;
  userPrompt: string;
  projectId: string;
}) => Promise<{ content: string }>;

export interface MigrationDeliverySequencingHandlerDeps {
  loadBookOfWork?: BookOfWorkLoaderFn;
  fetchDiscoveryContext?: DiscoveryContextFetcherFn;
  fetchActiveTargetArchitectureId?: ActiveTargetFetcherFn;
  fetchLatestCapturedDecisions?: CapturedDecisionsFetcherFn;
  postCapturedDecision?: CapturedDecisionWriterFn;
  callLlm?: LlmCallerFn;
  /** Override the system prompt (defaults to reading the markdown file). */
  systemPromptOverride?: string;
}

// ---------------------------------------------------------------------------
// Default production wiring
// ---------------------------------------------------------------------------

const TASK_ID = 'product-manager--migration-delivery-sequencing';
const SEQUENCING_DECISION_CODE = 'delivery.sequencing';
const SEQUENCING_SCOPE_KIND: 'architecture' = 'architecture';

const SYSTEM_PROMPT_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'prompts',
  'product-manager.migration-delivery-sequencing.task.md'
);

function readDefaultSystemPrompt(): string {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
}

const defaultLoadBookOfWork: BookOfWorkLoaderFn = async (
  projectId,
  bookOfWorkId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Architecture Model Service GET /migration-books-of-work/${bookOfWorkId} returned ${response.status}: ${text || '<empty body>'}`
    );
  }
  const dto = (await response.json()) as {
    book_of_work_json?: Record<string, unknown> | null;
  };
  const initiativeIds: string[] = [];
  const rawItems = (dto.book_of_work_json?.items as unknown[]) || [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    if (obj.type === 'initiative' && typeof obj.id === 'string' && obj.id.length > 0) {
      initiativeIds.push(obj.id);
    }
  }
  return { bookOfWorkId, projectId, initiativeIds };
};

const defaultCallLlm: LlmCallerFn = async ({ systemPrompt, userPrompt, projectId }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `${TASK_ID}-${Date.now()}`,
    `${TASK_ID}-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Approximate token count using the same 4-chars-per-token rule of thumb as
 * `migrationBookOfWorkHandler.ts` uses.
 */
function approxTokens(value: unknown): number {
  if (value === undefined || value === null) return 0;
  let str: string;
  try {
    str = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return 0;
  }
  return Math.ceil(str.length / 4);
}

/**
 * Render the captured-decisions block that gets appended to the prompt
 * post-cascade. The block is bounded by the question library size (~51 max)
 * so we accept it as a high-signal, never-truncated payload per the spec's
 * token-budget cascade rules.
 */
function renderCapturedDecisionsBlock(
  decisions: readonly TargetStateCapturedDecision[]
): string {
  const lines: string[] = [];
  lines.push('TARGET STATE CAPTURED DECISIONS');
  lines.push('================================');
  for (const d of decisions) {
    const scopeQualifier =
      d.scopeKind === 'architecture'
        ? '[architecture]'
        : d.scopeKind === 'element' && d.scopeRefType && d.scopeRefId
          ? `[element:${d.scopeRefType}:${d.scopeRefId}]`
          : `[${d.scopeKind}${d.scopeRefId ? `:${d.scopeRefId}` : ''}]`;
    const summaryText = d.answerSummary && d.answerSummary.length > 0
      ? d.answerSummary
      : d.answerValue;
    const standards =
      d.standardsLookupRef && d.standardsLookupRef.length > 0
        ? ` (standards: ${d.standardsLookupRef})`
        : '';
    lines.push(`- ${scopeQualifier} \`${d.decisionCode}\` -- ${summaryText}${standards}`);
  }
  return lines.join('\n');
}

/**
 * Build the user prompt content sent alongside the system prompt. The
 * discovery-context block is the cascade-trimmed payload; the
 * captured-decisions block is appended POST-cascade and never truncated; the
 * book-of-work initiative-id list is included so the LLM can reference ids.
 *
 * Exported for unit-test inspection.
 */
export function buildSequencingUserPrompt(
  bookOfWorkId: string,
  bookOfWorkInitiativeIds: readonly string[],
  cascadedDiscoveryContext: MigrationDiscoveryContext,
  decisions: readonly TargetStateCapturedDecision[]
): string {
  const lines: string[] = [];
  lines.push(`BOOK OF WORK ID: ${bookOfWorkId}`);
  lines.push('VALID INITIATIVE IDS (the only allowed values in the response):');
  for (const id of bookOfWorkInitiativeIds) lines.push(`  - ${id}`);
  lines.push('');
  lines.push('MIGRATION DISCOVERY CONTEXT (cascade-trimmed)');
  lines.push('==============================================');
  lines.push(JSON.stringify(cascadedDiscoveryContext, null, 2));
  lines.push('');
  lines.push(renderCapturedDecisionsBlock(decisions));
  lines.push('');
  lines.push(
    'Produce the MigrationDeliverySequencingResponse structured response now. ' +
      'Cite decision codes in `rationale`; reference only the valid initiative ids above; ' +
      'preserve functional equivalence; do not invent initiative ids.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateMigrationDeliverySequencing(
  input: GenerateMigrationDeliverySequencingInput,
  deps: MigrationDeliverySequencingHandlerDeps = {}
): Promise<GenerateMigrationDeliverySequencingResult> {
  const {
    projectId,
    currentArchitectureId,
    targetArchitectureId,
    bookOfWorkId,
    discoveryRunIds,
    apiBehaviourBaselineIds,
  } = input;

  const loadBookOfWork = deps.loadBookOfWork ?? defaultLoadBookOfWork;
  const fetchDiscoveryContext =
    deps.fetchDiscoveryContext ?? defaultFetchMigrationDiscoveryContext;
  const fetchActiveTargetArchitectureId =
    deps.fetchActiveTargetArchitectureId ?? defaultFetchActiveTargetArchitectureId;
  const fetchLatestCapturedDecisions =
    deps.fetchLatestCapturedDecisions ?? defaultFetchLatestCapturedDecisions;
  const postCapturedDecision =
    deps.postCapturedDecision ?? defaultPostCapturedDecision;
  const callLlm = deps.callLlm ?? defaultCallLlm;
  const systemPrompt = deps.systemPromptOverride ?? readDefaultSystemPrompt();

  console.log(
    `[diag-gateway] pm_migration_delivery_sequencing stage=loading_context ` +
      `projectId=${projectId} bookOfWorkId=${bookOfWorkId}`
  );

  // ----- Stage 1a: runtime gate -- active target architecture must exist -----
  let activeTargetId: string | null = null;
  try {
    const active = await fetchActiveTargetArchitectureId(projectId);
    activeTargetId = active?.activeTargetArchitectureId ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      'Architecture Model Service active-target lookup failed in delivery-sequencing handler',
      { projectId, error: message }
    );
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: `Architecture Model Service active-target lookup failed: ${message}`,
    };
  }
  if (!activeTargetId) {
    console.log(
      `[diag-gateway] pm_migration_delivery_sequencing stage=insufficient_context ` +
        `reason=no_active_target projectId=${projectId}`
    );
    return {
      status: 'insufficient_context',
      sequenceId: null,
      summary: 'No active target architecture defined for this project.',
      recommendedNextAction: 'Define a target architecture first',
    };
  }

  // ----- Stage 1b: runtime gate -- captured decisions must exist -----
  let decisions: TargetStateCapturedDecision[] = [];
  try {
    decisions = await fetchLatestCapturedDecisions(projectId, activeTargetId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      'Architecture Model Service captured-decisions lookup failed in delivery-sequencing handler',
      { projectId, activeTargetId, error: message }
    );
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: `Architecture Model Service captured-decisions lookup failed: ${message}`,
    };
  }
  if (!decisions || decisions.length === 0) {
    console.log(
      `[diag-gateway] pm_migration_delivery_sequencing stage=insufficient_context ` +
        `reason=no_decisions projectId=${projectId} targetArchitectureId=${activeTargetId}`
    );
    return {
      status: 'insufficient_context',
      sequenceId: null,
      summary:
        'No captured decisions exist for the active target architecture yet.',
      recommendedNextAction: 'Run the architect conversation first',
    };
  }

  // ----- Stage 2: load the supplied book of work -----
  const loadedBookOfWork = await loadBookOfWork(projectId, bookOfWorkId);
  const initiativeIds = new Set<string>(loadedBookOfWork.initiativeIds);

  // ----- Stage 3: discovery-context cascade (decisions appended post-cascade) -----
  const ctxRequest: MigrationDiscoveryContextRequest = {
    currentArchitectureId,
    targetArchitectureId,
    discoveryRunIds,
    apiBehaviourBaselineIds,
  };
  const rawContext = await fetchDiscoveryContext(projectId, ctxRequest);
  const cascade = applyTokenBudgetCascade(rawContext);

  // Post-cascade overflow check: decisions block is bounded but high-signal;
  // if combined payload exceeds the soft cap, fail loudly per spec.md.
  const decisionsBlockText = renderCapturedDecisionsBlock(decisions);
  const combinedTokens =
    cascade.finalTokenCount +
    approxTokens(decisionsBlockText) +
    approxTokens([...initiativeIds]);
  if (combinedTokens > MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP) {
    throw new TokenBudgetOverflowError(
      ['captured_decisions_block (never truncated)'],
      combinedTokens
    );
  }

  // ----- Stage 4: single synchronous LLM call -----
  const userPrompt = buildSequencingUserPrompt(
    bookOfWorkId,
    loadedBookOfWork.initiativeIds,
    cascade.context,
    decisions
  );
  console.log(
    `[diag-gateway] pm_migration_delivery_sequencing stage=calling_generator ` +
      `projectId=${projectId} bookOfWorkId=${bookOfWorkId} token_count=${combinedTokens}`
  );
  let llmContent: string;
  try {
    const llmResult = await callLlm({ systemPrompt, userPrompt, projectId });
    llmContent = llmResult.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('LLM call failed in delivery-sequencing handler', {
      projectId,
      bookOfWorkId,
      error: message,
    });
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: `LLM call failed: ${message}`,
    };
  }

  // ----- Stage 5: parse + validate -----
  console.log(
    `[diag-gateway] pm_migration_delivery_sequencing stage=validating_schema projectId=${projectId}`
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(llmContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: `LLM response was not parseable JSON: ${message}`,
    };
  }

  const validation = assertMigrationDeliverySequencingResponse(
    parsed,
    initiativeIds
  );
  if (!validation.ok) {
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: `Sequencing response validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const value: MigrationDeliverySequencingResponse = validation.value;

  // Mirror the LLM's own non-sequenced variants straight through to the caller.
  if (value.status === 'insufficient_context') {
    return {
      status: 'insufficient_context',
      sequenceId: null,
      summary: 'Sequencing LLM reported insufficient context.',
      recommendedNextAction: value.recommendedNextAction,
    };
  }
  if (value.status === 'failed') {
    return {
      status: 'failed',
      sequenceId: null,
      summary: '',
      errorMessage: value.errorMessage,
    };
  }

  // ----- Stage 6: persist via Spec 2 captured-decisions POST -----
  const sequencedResponse = value as SequencedResponseA;
  const answerValueJson = JSON.stringify({
    initiativeOrder: sequencedResponse.initiativeOrder,
  });
  const body: CreateCapturedDecisionRequestBody = {
    decisionCode: SEQUENCING_DECISION_CODE,
    scopeKind: SEQUENCING_SCOPE_KIND,
    answerValue: answerValueJson,
    answerSummary: buildSequencingAnswerSummary(sequencedResponse),
    conversationThreadId: null,
    conversationTurnRef: null,
    createdByTask: TASK_ID,
  };

  console.log(
    `[diag-gateway] pm_migration_delivery_sequencing stage=persisting_sequencing ` +
      `projectId=${projectId} bookOfWorkId=${bookOfWorkId} ` +
      `decisionCode=${SEQUENCING_DECISION_CODE} initiativeCount=${sequencedResponse.initiativeOrder.length}`
  );
  const created = await postCapturedDecision(projectId, activeTargetId, body);

  console.log(
    `[diag-gateway] pm_migration_delivery_sequencing stage=complete ` +
      `projectId=${projectId} sequenceId=${created.decisionId}`
  );

  return {
    status: 'sequenced',
    sequenceId: created.decisionId,
    summary: body.answerSummary ?? answerValueJson,
    warnings: sequencedResponse.warnings,
  };
}

/**
 * Build a short human-readable summary of the sequencing answer for the
 * captured-decision `answerSummary` field. Keeps the row's summary tight
 * (cited initiative count + total parallelisable + total blocked-by edges).
 */
function buildSequencingAnswerSummary(value: SequencedResponseA): string {
  const initiativeCount = value.initiativeOrder.length;
  let parallelisableEdges = 0;
  let blockedByEdges = 0;
  for (const entry of value.initiativeOrder) {
    parallelisableEdges += entry.parallelisableWith.length;
    blockedByEdges += entry.blockedBy.length;
  }
  return (
    `Delivery sequencing across ${initiativeCount} initiatives ` +
    `(${parallelisableEdges} parallelisable edges, ${blockedByEdges} blockedBy edges).`
  );
}
