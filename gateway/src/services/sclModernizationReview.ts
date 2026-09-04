/**
 * SCL modernization review + confirm (SCL pipeline spec 5 of 10, 2026-08-18
 * design, "Intermediate modernization decisions").
 *
 * buildModernizationReview:
 *   latest scan -> contracts (tables / shapes / boundaries) -> deterministic
 *   observed-idiom inventory -> LLM proposals for the UNMAPPED THIRD-PARTY
 *   TYPES only (badge: provenance 'llm_proposed'; guard: proposals for froms
 *   that were not requested are DROPPED). Returns the rows plus the
 *   already-persisted `modernize.*` captured decisions for the project's
 *   target architecture so the UI can render confirmed state.
 *
 *   Proposal determinism + loud failure (2026-08-30 round, after a failed
 *   pass rendered as 91 legitimate-looking "needs a value" rows):
 *   - Generated proposals are PERSISTED per scan (AMS scan `stats_json`,
 *     key `modernization_proposals` — an opaque map slot, no AMS schema
 *     change). Subsequent loads REPLAY the cached set without an LLM call,
 *     so two consecutive loads can never disagree.
 *   - An LLM failure is still fail-soft for the review render (rows stay
 *     'unmapped') but is now LOUD on the wire: `proposalPass.status =
 *     'failed'` + the error, so the UI banners "proposals unavailable —
 *     retry" instead of presenting empty rows as human work.
 *   - `regenerateProposals: true` (the Retry-All route) bypasses the cache,
 *     re-runs the pass and re-persists on success; on failure an existing
 *     cached set is REPLAYED (never clobbered), reported as
 *     status 'failed' + source 'cache'.
 *
 * confirmModernizationDecisions:
 *   validates the confirmed rows (code must start 'modernize.', target
 *   non-empty), then persists each as a captured decision through the
 *   EXISTING decisions-store write path
 *   (services/architectConversation/targetStateCapturedDecisionsWriter.ts
 *   postCapturedDecision -> AMS POST .../target-architectures/{id}/
 *   captured-decisions, camelCase wire, atomic supersession inside AMS).
 *   NEVER partial-silent: per-row persistence failures are collected and
 *   returned alongside the confirmed count.
 *
 * Decisions live against the TARGET architecture (mirroring the target-state
 * conversation); the corpus lives against the current architecture — hence
 * the split ids.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { SclContractWire, SclScanWire } from './sclAnnotationPass';
import { computeModernizationInventory, ObservedIdiom } from './sclModernizationInventory';
import {
  fetchActiveTargetArchitectureId,
  fetchLatestCapturedDecisions,
  fetchMostRecentSavedTargetArchitectureId,
  TargetStateCapturedDecision,
} from './targetStateCapturedDecisionsClient';
import {
  CreateCapturedDecisionRequestBody,
  postCapturedDecision,
} from './architectConversation/targetStateCapturedDecisionsWriter';

export const MODERNIZATION_DECISION_CODE_PREFIX = 'modernize.';
export const MODERNIZATION_CREATED_BY_TASK = 'scl-modernization-review';

// ---------------------------------------------------------------------------
// Errors (typed so the route can map them to clean statuses)
// ---------------------------------------------------------------------------

/** No SCL scan exists for the architecture — the route answers 404. */
export class SclModernizationNoScanError extends Error {
  constructor(architectureId: string) {
    super(`no SCL scan exists for architecture ${architectureId} — run the slicer first`);
    this.name = 'SclModernizationNoScanError';
  }
}

export interface ModernizationRowOffender {
  index: number;
  code: string | null;
  reason: string;
}

/** Confirm payload failed validation — the route answers 400 with offenders. */
export class SclModernizationValidationError extends Error {
  public readonly offenders: ModernizationRowOffender[];
  constructor(offenders: ModernizationRowOffender[]) {
    super(
      `invalid modernization decision rows: ${offenders
        .map((o) => `#${o.index} (${o.code ?? 'no code'}: ${o.reason})`)
        .join('; ')}`
    );
    this.name = 'SclModernizationValidationError';
    this.offenders = offenders;
  }
}

// ---------------------------------------------------------------------------
// Dependency seam (production defaults below; tests inject full mocks)
// ---------------------------------------------------------------------------

export interface SclModernizationDeps {
  /** GET /scl/scans/latest — null when no scan exists. */
  fetchLatestScan: (projectId: string, architectureId: string) => Promise<SclScanWire | null>;
  /** GET /scl/scans/{scanId}/contracts?kind=...&include_body=true */
  fetchContracts: (
    projectId: string,
    architectureId: string,
    scanId: string,
    kind: string
  ) => Promise<SclContractWire[]>;
  /** The project's target architecture id (active, else most-recent-saved;
   * null / failure ⇒ review still renders, existingDecisions empty). */
  resolveTargetArchitectureId: (projectId: string) => Promise<string | null>;
  /** GET .../target-architectures/{id}/captured-decisions (read client). */
  fetchDecisions: (
    projectId: string,
    targetArchitectureId: string
  ) => Promise<TargetStateCapturedDecision[]>;
  /** The EXISTING decisions write path (targetStateCapturedDecisionsWriter). */
  postDecision: (
    projectId: string,
    targetArchitectureId: string,
    body: CreateCapturedDecisionRequestBody
  ) => Promise<unknown>;
  /** The LLM chat seam (house client; jsonMode + shared rate-limit pacing). */
  llm: (args: {
    systemPrompt: string;
    userPrompt: string;
    requestTag: string;
  }) => Promise<{ content: string }>;
  /** PATCH /scans/{scanId} {stats_json} — the proposal-cache persist seam
   * (caller merges: spread the read stats_json, then set the cache key). */
  patchScan: (
    projectId: string,
    architectureId: string,
    scanId: string,
    statsJson: Record<string, unknown>
  ) => Promise<void>;
}

function sclBase(projectId: string, architectureId: string): string {
  return (
    `${getConfig().architectureModelServiceBaseUrl}/api/model/projects/` +
    `${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

async function amsGetJsonOrNull<T>(url: string, label: string): Promise<T | null> {
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`AMS ${label} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function amsPatchJson(url: string, body: unknown, label: string): Promise<void> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`AMS ${label} failed: HTTP ${response.status}`);
  }
}

/** Default LLM caller — the house idiom (see sclAnnotationPass.ts): lazy
 * require keeps tests cleanly mockable, jsonMode forces strict JSON, and the
 * client's shared 429 cool-down (llmRateLimit.ts) does the pacing. */
const defaultLlm: SclModernizationDeps['llm'] = async ({ systemPrompt, userPrompt, requestTag }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `scl-modernization-${Date.now()}`,
    requestTag,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultDeps: SclModernizationDeps = {
  fetchLatestScan: (projectId, architectureId) =>
    amsGetJsonOrNull<SclScanWire>(
      `${sclBase(projectId, architectureId)}/scans/latest`,
      'fetch_scl_latest_scan'
    ),
  fetchContracts: async (projectId, architectureId, scanId, kind) => {
    const url =
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}/contracts` +
      `?kind=${encodeURIComponent(kind)}&include_body=true`;
    const rows = await amsGetJsonOrNull<SclContractWire[]>(url, 'fetch_scl_contracts');
    return Array.isArray(rows) ? rows : [];
  },
  resolveTargetArchitectureId: async (projectId) => {
    try {
      const active = await fetchActiveTargetArchitectureId(projectId);
      if (active.activeTargetArchitectureId) return active.activeTargetArchitectureId;
      const saved = await fetchMostRecentSavedTargetArchitectureId(projectId);
      return saved.savedTargetArchitectureId ?? null;
    } catch (error) {
      logger.warn('[diag-gateway] scl_modernization target-architecture resolve failed (fail-soft)', {
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  },
  fetchDecisions: fetchLatestCapturedDecisions,
  postDecision: postCapturedDecision,
  llm: defaultLlm,
  patchScan: (projectId, architectureId, scanId, statsJson) =>
    amsPatchJson(
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}`,
      { stats_json: statsJson },
      'patch_scl_scan'
    ),
};

// ---------------------------------------------------------------------------
// LLM proposal pass (every unmapped row; guarded merge)
// ---------------------------------------------------------------------------

const PROPOSAL_SYSTEM_PROMPT =
  'You propose Java modernization targets for idioms observed in a legacy ' +
  'codebase being migrated to Java 21 + Spring Boot. Each listed item is ' +
  'either (a) a third-party TYPE, for which you propose ONE replacement (a ' +
  'modern JDK/Spring type, or "keep dependency" when no exact-semantics ' +
  'replacement exists), or (b) a code-structure OBSERVATION such as a ' +
  'near-duplicate implementation cluster, an ambiguous dispatch site, a ' +
  'data-derived authorisation predicate, or an un-ruled slicer flag, for ' +
  'which you propose ONE short policy statement (e.g. "merge into a single ' +
  'implementation behind the interface", "keep both; document the dispatch ' +
  'rule", "keep the data-driven check; do not replace with role annotations"). ' +
  'The "family" field tells you which kind each item is; "examples" are ' +
  'its use sites. Only answer for the listed items. Respond in strict JSON.';

function buildProposalPrompt(
  requests: Array<{ from: string; family: string; examples: string[] }>
): string {
  return (
    'Observed unmapped idioms — third-party types and code-structure ' +
    'observations (family + example use sites):\n' +
    `${JSON.stringify(requests, null, 2)}\n\n` +
    // MUST stay an OBJECT envelope. `defaultLlm` sends `response_format:
    // { type: 'json_object' }` (jsonMode), which FORBIDS a top-level JSON
    // array -- so asking for a bare array here contradicted the request
    // itself and a stricter model refused it outright. See
    // `extractProposalArray` for what that cost us.
    'Respond with a JSON OBJECT of the form ' +
    '{"proposals": [{"from": "<the listed type, verbatim>", "proposedTo": ' +
    '"<replacement type or policy>", "rationale": "<= 20 words"}]} with one ' +
    'entry per listed type.'
  );
}

interface LlmProposal {
  from: string;
  proposedTo: string;
  rationale: string;
}

/**
 * Resolve the proposals array out of the LLM reply (2026-09-04).
 *
 * Diagnosis, from the `[diag-gateway] ... proposal parse FAILED` log line:
 * the provider answered 200 with
 *   {"error": "Invalid instruction conflict: user requested a JSON array,
 *              but final response schema is constrained to a JSON object."}
 * The prompt asked for a bare array while `defaultLlm` sends jsonMode
 * (`response_format: json_object`), which forbids a top-level array. Both
 * were introduced in the same commit, so the contradiction was latent from
 * day one: the old first-`[`-to-last-`]` scan found the inner array whenever
 * the model resolved the conflict by wrapping it, and a stricter model
 * stopped guessing and started refusing. The bug is ours, not the provider's.
 *
 * Priority order:
 *   1. `{"proposals": [...]}`             -- the canonical envelope (prompt);
 *   2. a lone array-valued property        -- a synonym (`mappings`, `items`)
 *                                             never costs a whole batch;
 *   3. a bare top-level array              -- pre-fix replies keep working;
 *   4. non-JSON (markdown fence, prose)    -- the historical bracket scan.
 * Failures name the cause (the banner renders `proposalPass.error`
 * verbatim): the model's own refusal text, an empty reply, or the top-level
 * keys of an object with no array.
 */
function extractProposalArray(content: string): unknown[] {
  const text = (content ?? '').trim();
  if (text === '') throw new Error('LLM returned an empty response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // Not a JSON document (fenced / prose preamble): historical bracket scan.
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('LLM response contained no JSON array');
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) throw new Error('LLM response was not a JSON array');
    return raw;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.proposals)) return obj.proposals;
    const arrayKeys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (arrayKeys.length === 1) return obj[arrayKeys[0]] as unknown[];
    if (typeof obj.error === 'string' && obj.error.trim() !== '') {
      throw new Error(`LLM declined to produce proposals: ${obj.error.trim()}`);
    }
    throw new Error(
      `LLM response contained no proposals array (top-level keys: ${Object.keys(obj).join(', ') || 'none'})`
    );
  }
  throw new Error('LLM response was not a JSON array');
}

function parseProposals(content: string): LlmProposal[] {
  const raw = extractProposalArray(content);
  const proposals: LlmProposal[] = [];
  for (const item of raw) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (
      typeof p.from !== 'string' ||
      typeof p.proposedTo !== 'string' ||
      p.proposedTo.trim().length === 0
    ) {
      continue; // malformed entries dropped, well-formed siblings kept
    }
    const rationale = typeof p.rationale === 'string' ? p.rationale : '';
    proposals.push({
      from: p.from,
      proposedTo: p.proposedTo.trim(),
      // Enforce the <=20-words contract deterministically.
      rationale: rationale.split(/\s+/).filter(Boolean).slice(0, 20).join(' '),
    });
  }
  return proposals;
}

/** Every row that has no value yet is eligible for a proposal (2026-09-04).
 * Previously only third-party TYPE rows (sourceCarrier / typeReference) were
 * sent to the LLM; consolidation rows and un-ruled flags stayed human-only
 * and reached the review as blanks the operator had to fill from nothing.
 * Judgement families still need the human call — the proposal is a starting
 * point and is labelled as such (see `needsHumanReview`). */
function isProposalEligible(row: ObservedIdiom): boolean {
  return row.provenance === 'unmapped';
}

/** Families where the LLM cannot KNOW the right answer (merge vs keep is a
 * product/ownership call): a proposal on these is review-advised, not a
 * default. */
const HUMAN_REVIEW_FAMILIES: ReadonlySet<string> = new Set(['consolidation']);

function needsHumanReview(row: ObservedIdiom): boolean {
  return HUMAN_REVIEW_FAMILIES.has(row.family);
}

/** The per-scan proposal cache persisted inside the scan's opaque
 * `stats_json` under this key (snake_case wire, like its stats siblings). */
export const MODERNIZATION_PROPOSALS_STATS_KEY = 'modernization_proposals';

interface CachedProposalSet {
  generatedAt: string | null;
  proposals: LlmProposal[];
}

/** Tolerantly read the cached proposal set from a scan's stats_json; any
 * malformed shape reads as absent (the pass simply regenerates). */
function readCachedProposals(
  statsJson: Record<string, unknown> | null | undefined
): CachedProposalSet | null {
  const raw = (statsJson ?? {})[MODERNIZATION_PROPOSALS_STATS_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.proposals)) return null;
  const proposals: LlmProposal[] = [];
  for (const item of record.proposals) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (
      typeof p.from !== 'string' ||
      typeof p.proposed_to !== 'string' ||
      p.proposed_to.trim().length === 0
    ) {
      continue;
    }
    proposals.push({
      from: p.from,
      proposedTo: p.proposed_to,
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
    });
  }
  return {
    generatedAt: typeof record.generated_at === 'string' ? record.generated_at : null,
    proposals,
  };
}

/** Guarded merge shared by the generated and cached paths: proposals for
 * froms that are not eligible rows are DROPPED. Returns the applied count. */
function applyProposals(targets: ObservedIdiom[], proposals: LlmProposal[]): number {
  const byFrom = new Map(targets.map((row) => [row.from, row]));
  let applied = 0;
  for (const proposal of proposals) {
    const row = byFrom.get(proposal.from);
    if (!row) {
      logger.warn('[diag-gateway] scl_modernization dropped unrequested LLM proposal', {
        from: proposal.from,
      });
      continue;
    }
    row.defaultTo = proposal.proposedTo;
    row.provenance = needsHumanReview(row) ? 'llm_proposed_review_advised' : 'llm_proposed';
    row.proposalRationale = proposal.rationale;
    applied++;
  }
  return applied;
}

/** ONE batched LLM call for the eligible rows. THROWS on failure — the
 * caller (runProposalPass) owns the loud-but-fail-soft handling. */
async function requestProposals(
  targets: ObservedIdiom[],
  llm: SclModernizationDeps['llm'],
  requestTag: string
): Promise<LlmProposal[]> {
  const requests = targets.map((row) => ({
    from: row.from,
    family: row.family,
    examples: row.exampleCites.map((c) => `${c.symbol} (${c.sourcePath})`),
  }));
  const { content } = await llm({
    systemPrompt: PROPOSAL_SYSTEM_PROMPT,
    userPrompt: buildProposalPrompt(requests),
    requestTag,
  });
  try {
    return parseProposals(content);
  } catch (parseError) {
    // Diagnostic (2026-09-04): a proposal-parse failure used to surface only
    // as the pass's generic "failed" outcome, with no way to see WHAT the LLM
    // returned. Log the raw response shape (never the prompt) so the failure
    // can be classified from the gateway log alone:
    //   startsWithBrace / startsWithBracket -- an object or array came back
    //     (a wrapper object around the array is the common case);
    //   hasOpenBracket && !hasCloseBracket  -- truncated output (token cap);
    //   neither bracket                     -- prose / refusal / fenced text;
    //   contentLength 0                     -- empty completion.
    // contentHead / contentTail carry the first 400 and last 200 chars so a
    // fence or trailing prose is visible without dumping the whole body.
    const shown = content ?? '';
    logger.warn('[diag-gateway] scl_modernization proposal parse FAILED -- raw LLM response shape', {
      requestTag,
      requestedCount: targets.length,
      parseError: parseError instanceof Error ? parseError.message : 'Unknown error',
      contentLength: shown.length,
      startsWithBrace: shown.trimStart().startsWith('{'),
      startsWithBracket: shown.trimStart().startsWith('['),
      hasOpenBracket: shown.includes('['),
      hasCloseBracket: shown.includes(']'),
      contentHead: shown.slice(0, 400),
      contentTail: shown.length > 400 ? shown.slice(-200) : '',
    });
    throw parseError;
  }
}

/** The wire-visible outcome of the proposal pass (bug fix 2026-08-30: a
 * failed pass previously rendered as silent legitimate-looking "needs a
 * value" rows). */
export interface ModernizationProposalPass {
  status: 'ok' | 'failed';
  /** Where the applied proposals came from: the per-scan cache, a fresh
   * generation, or nowhere ('none': no eligible rows, or a failure with no
   * cache to fall back on). */
  source: 'cache' | 'generated' | 'none';
  /** How many rows were eligible for proposals (unmapped third-party types). */
  eligible: number;
  /** How many rows received a proposal. */
  proposed: number;
  error: string | null;
  generatedAt: string | null;
}

async function runProposalPass(args: {
  projectId: string;
  architectureId: string;
  scanId: string;
  statsJson: Record<string, unknown>;
  rows: ObservedIdiom[];
  regenerate: boolean;
  llm: SclModernizationDeps['llm'];
  patchScan: SclModernizationDeps['patchScan'];
}): Promise<ModernizationProposalPass> {
  const { projectId, architectureId, scanId, statsJson, rows, regenerate } = args;
  const targets = rows.filter(isProposalEligible);
  if (targets.length === 0) {
    return { status: 'ok', source: 'none', eligible: 0, proposed: 0, error: null, generatedAt: null };
  }

  const cached = readCachedProposals(statsJson);

  // Deterministic replay: a cached set answers every subsequent load without
  // an LLM call, so two consecutive loads can never disagree.
  if (cached && !regenerate) {
    const applied = applyProposals(targets, cached.proposals);
    return {
      status: 'ok',
      source: 'cache',
      eligible: targets.length,
      proposed: applied,
      error: null,
      generatedAt: cached.generatedAt,
    };
  }

  try {
    const proposals = await requestProposals(targets, args.llm, `scl-modernization-${projectId}`);
    const applied = applyProposals(targets, proposals);
    const generatedAt = new Date().toISOString();
    // Persist per scan (merge-spread: never clobber sibling stats keys). A
    // persist failure downgrades to a warning — the fresh proposals still
    // serve this response; the next load regenerates.
    try {
      await args.patchScan(projectId, architectureId, scanId, {
        ...statsJson,
        [MODERNIZATION_PROPOSALS_STATS_KEY]: {
          generated_at: generatedAt,
          proposals: proposals.map((p) => ({
            from: p.from,
            proposed_to: p.proposedTo,
            rationale: p.rationale,
          })),
        },
      });
    } catch (persistError) {
      logger.warn('[diag-gateway] scl_modernization proposal-cache persist failed (serving unpersisted)', {
        projectId,
        scanId,
        error: persistError instanceof Error ? persistError.message : 'Unknown error',
      });
    }
    return {
      status: 'ok',
      source: 'generated',
      eligible: targets.length,
      proposed: applied,
      error: null,
      generatedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Fail-soft for the RENDER, loud on the WIRE. A regenerate failure never
    // clobbers an existing cache — replay it so previously-seen defaults do
    // not vanish under the user.
    logger.warn('[diag-gateway] scl_modernization LLM proposal pass failed (loud on the wire)', {
      requested: targets.length,
      regenerate,
      error: message,
    });
    if (cached) {
      const applied = applyProposals(targets, cached.proposals);
      return {
        status: 'failed',
        source: 'cache',
        eligible: targets.length,
        proposed: applied,
        error: message,
        generatedAt: cached.generatedAt,
      };
    }
    return {
      status: 'failed',
      source: 'none',
      eligible: targets.length,
      proposed: 0,
      error: message,
      generatedAt: null,
    };
  }
}

// ---------------------------------------------------------------------------
// buildModernizationReview
// ---------------------------------------------------------------------------

export interface ModernizationReview {
  scanId: string;
  /** Null when the project has no target architecture yet (review still renders). */
  targetArchitectureId: string | null;
  rows: ObservedIdiom[];
  /** Already-persisted modernize.* decisions for the target architecture. */
  existingDecisions: TargetStateCapturedDecision[];
  /** Loud proposal-pass outcome (2026-08-30): the UI banners 'failed'. */
  proposalPass: ModernizationProposalPass;
}

const CONTRACT_KINDS = ['behaviour_table', 'shape', 'boundary'] as const;

export async function buildModernizationReview(
  args: {
    projectId: string;
    architectureId: string;
    /** Retry-All: bypass the per-scan cache, re-run the LLM pass and
     * re-persist on success (an existing cache survives a failed retry). */
    regenerateProposals?: boolean;
  },
  deps?: Partial<SclModernizationDeps>
): Promise<ModernizationReview> {
  const d: SclModernizationDeps = { ...defaultDeps, ...deps };
  const { projectId, architectureId } = args;

  const scan = await d.fetchLatestScan(projectId, architectureId);
  if (!scan?.id) {
    throw new SclModernizationNoScanError(architectureId);
  }
  const scanId = scan.id;

  const contracts: SclContractWire[] = [];
  for (const kind of CONTRACT_KINDS) {
    contracts.push(...(await d.fetchContracts(projectId, architectureId, scanId, kind)));
  }

  const statsJson = scan.stats_json ?? {};
  const rows = computeModernizationInventory(contracts, statsJson);
  const proposalPass = await runProposalPass({
    projectId,
    architectureId,
    scanId,
    statsJson,
    rows,
    regenerate: args.regenerateProposals === true,
    llm: d.llm,
    patchScan: d.patchScan,
  });

  const targetArchitectureId = await d.resolveTargetArchitectureId(projectId);
  let existingDecisions: TargetStateCapturedDecision[] = [];
  if (targetArchitectureId) {
    try {
      const all = await d.fetchDecisions(projectId, targetArchitectureId);
      existingDecisions = all.filter((decision) =>
        decision.decisionCode.startsWith(MODERNIZATION_DECISION_CODE_PREFIX)
      );
    } catch (error) {
      // Fail-soft: confirmed-state chrome degrades, the review still renders.
      logger.warn('[diag-gateway] scl_modernization existing-decisions read failed (fail-soft)', {
        projectId,
        targetArchitectureId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('[diag-gateway] scl_modernization review built', {
    projectId,
    architectureId,
    scanId,
    rows: rows.length,
    existingDecisions: existingDecisions.length,
    targetArchitectureId,
    proposalPass: `${proposalPass.status}/${proposalPass.source}`,
  });

  return { scanId, targetArchitectureId, rows, existingDecisions, proposalPass };
}

// ---------------------------------------------------------------------------
// confirmModernizationDecisions
// ---------------------------------------------------------------------------

export interface ConfirmModernizationRow {
  code: string;
  family: string;
  from: string;
  to: string;
  provenance: string;
  usageCount: number;
  exampleCites: Array<{ symbol: string; sourcePath: string }>;
}

export interface ConfirmModernizationResult {
  confirmed: number;
  failed: Array<{ code: string; error: string }>;
}

export async function confirmModernizationDecisions(
  args: {
    projectId: string;
    targetArchitectureId: string;
    rows: ConfirmModernizationRow[];
  },
  deps?: Partial<SclModernizationDeps>
): Promise<ConfirmModernizationResult> {
  const d: SclModernizationDeps = { ...defaultDeps, ...deps };
  const { projectId, targetArchitectureId, rows } = args;

  // Validate EVERYTHING first — a payload with any malformed row is rejected
  // whole, listing every offender (no partial-silent writes).
  const offenders: ModernizationRowOffender[] = [];
  const firstIndexByCode = new Map<string, number>();
  rows.forEach((row, index) => {
    const code = typeof row?.code === 'string' ? row.code : null;
    if (!code || !code.startsWith(MODERNIZATION_DECISION_CODE_PREFIX)) {
      offenders.push({
        index,
        code,
        reason: `decision code must start with '${MODERNIZATION_DECISION_CODE_PREFIX}'`,
      });
    }
    if (typeof row?.to !== 'string' || row.to.trim().length === 0) {
      offenders.push({ index, code, reason: 'target mapping (to) must be non-empty' });
    }
    // Duplicate-code guard (2026-08-30, Kiro third bug): the decisions store
    // supersedes by code, so two rows sharing one code silently keep only
    // the LAST write (98 posted, 96 landed). Reject the batch loudly.
    if (code) {
      const firstIndex = firstIndexByCode.get(code);
      if (firstIndex !== undefined) {
        offenders.push({
          index,
          code,
          reason: `duplicate decision code — collides with row #${firstIndex} and would silently supersede it`,
        });
      } else {
        firstIndexByCode.set(code, index);
      }
    }
  });
  if (offenders.length > 0) {
    throw new SclModernizationValidationError(offenders);
  }

  let confirmed = 0;
  const failed: Array<{ code: string; error: string }> = [];
  for (const row of rows) {
    const body: CreateCapturedDecisionRequestBody = {
      decisionCode: row.code,
      scopeKind: 'architecture',
      answerValue: JSON.stringify({
        from: row.from,
        to: row.to,
        family: row.family,
        provenance: row.provenance,
        usage_count: row.usageCount,
        example_cites: row.exampleCites.map((cite) => ({
          symbol: cite.symbol,
          source_path: cite.sourcePath,
        })),
      }),
      answerSummary: `${row.from} -> ${row.to}`,
      createdByTask: MODERNIZATION_CREATED_BY_TASK,
    };
    try {
      await d.postDecision(projectId, targetArchitectureId, body);
      confirmed++;
    } catch (error) {
      // NEVER partial-silent: every failed row is named in the response.
      const message = error instanceof Error ? error.message : 'Unknown error';
      failed.push({ code: row.code, error: message });
      logger.warn('[diag-gateway] scl_modernization decision persist failed', {
        projectId,
        targetArchitectureId,
        code: row.code,
        error: message,
      });
    }
  }

  logger.info('[diag-gateway] scl_modernization decisions confirmed', {
    projectId,
    targetArchitectureId,
    confirmed,
    failed: failed.length,
  });
  return { confirmed, failed };
}
