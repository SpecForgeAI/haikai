/**
 * SCL modernization review + confirm (SCL pipeline spec 5 of 10, 2026-08-18
 * design, "Intermediate modernization decisions").
 *
 * buildModernizationReview:
 *   latest scan -> contracts (tables / shapes / boundaries) -> deterministic
 *   observed-idiom inventory -> ONE batched LLM call proposing targets for
 *   the UNMAPPED THIRD-PARTY TYPES only (badge: provenance 'llm_proposed';
 *   guard: proposals for froms that were not requested are DROPPED; LLM
 *   failure is fail-soft — rows stay 'unmapped', logged). Returns the rows
 *   plus the already-persisted `modernize.*` captured decisions for the
 *   project's target architecture so the UI can render confirmed state.
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
};

// ---------------------------------------------------------------------------
// LLM proposal pass (unmapped third-party types only; guarded merge)
// ---------------------------------------------------------------------------

const PROPOSAL_SYSTEM_PROMPT =
  'You propose Java modernization targets for third-party types observed in a ' +
  'legacy codebase being migrated to Java 21 + Spring Boot. For each listed ' +
  'type propose ONE replacement (a modern JDK/Spring type, or "keep dependency" ' +
  'when no exact-semantics replacement exists). Only answer for the listed ' +
  'types. Respond in strict JSON.';

function buildProposalPrompt(
  requests: Array<{ from: string; family: string; examples: string[] }>
): string {
  return (
    'Observed unmapped third-party types (with example use sites):\n' +
    `${JSON.stringify(requests, null, 2)}\n\n` +
    'Respond with a JSON array exactly of the form ' +
    '[{"from": "<the listed type, verbatim>", "proposedTo": "<replacement type ' +
    'or policy>", "rationale": "<= 20 words"}] with one entry per listed type.'
  );
}

interface LlmProposal {
  from: string;
  proposedTo: string;
  rationale: string;
}

function parseProposals(content: string): LlmProposal[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('LLM response contained no JSON array');
  const raw = JSON.parse(content.slice(start, end + 1)) as unknown;
  if (!Array.isArray(raw)) throw new Error('LLM response was not a JSON array');
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

/** Unmapped THIRD-PARTY TYPE rows (sourceCarrier / opaque typeRef channels)
 * are the only rows the proposal pass may touch — consolidation rows and
 * un-ruled flags always stay human-only. */
function isUnmappedThirdPartyType(row: ObservedIdiom): boolean {
  return (
    row.provenance === 'unmapped' &&
    (row.matcherKey.startsWith('sourceCarrier:') || row.matcherKey.startsWith('typeReference:'))
  );
}

async function mergeLlmProposals(
  rows: ObservedIdiom[],
  llm: SclModernizationDeps['llm'],
  requestTag: string
): Promise<void> {
  const targets = rows.filter(isUnmappedThirdPartyType);
  if (targets.length === 0) return;

  const byFrom = new Map(targets.map((row) => [row.from, row]));
  const requests = targets.map((row) => ({
    from: row.from,
    family: row.family,
    examples: row.exampleCites.map((c) => `${c.symbol} (${c.sourcePath})`),
  }));

  try {
    const { content } = await llm({
      systemPrompt: PROPOSAL_SYSTEM_PROMPT,
      userPrompt: buildProposalPrompt(requests),
      requestTag,
    });
    for (const proposal of parseProposals(content)) {
      const row = byFrom.get(proposal.from);
      if (!row) {
        // Guard: proposals for froms that were never requested are DROPPED.
        logger.warn('[diag-gateway] scl_modernization dropped unrequested LLM proposal', {
          from: proposal.from,
        });
        continue;
      }
      row.defaultTo = proposal.proposedTo;
      row.provenance = 'llm_proposed';
      row.proposalRationale = proposal.rationale;
    }
  } catch (error) {
    // Fail-soft: the review still renders; unmapped rows stay unmapped.
    logger.warn('[diag-gateway] scl_modernization LLM proposal pass failed (rows stay unmapped)', {
      requested: targets.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
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
}

const CONTRACT_KINDS = ['behaviour_table', 'shape', 'boundary'] as const;

export async function buildModernizationReview(
  args: { projectId: string; architectureId: string },
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

  const rows = computeModernizationInventory(contracts, scan.stats_json ?? {});
  await mergeLlmProposals(rows, d.llm, `scl-modernization-${projectId}`);

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
  });

  return { scanId, targetArchitectureId, rows, existingDecisions };
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
