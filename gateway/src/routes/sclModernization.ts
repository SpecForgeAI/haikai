/**
 * SCL modernization-decisions routes (SCL pipeline spec 5 of 10, 2026-08-18
 * design, "Intermediate modernization decisions").
 *
 * The gateway surface for the modernization review + confirm flow
 * (services/sclModernizationReview.ts). Mounted at /api/v1 (server.ts),
 * matching the sibling sclAnnotation router. snake_case wire (gateway house
 * style for these routes).
 *
 *   GET /projects/:projectId/architectures/:architectureId/scl/modernization/review
 *     200 -> {
 *       scan_id, target_architecture_id: string|null,
 *       rows: [{ family, matcher_key, usage_count,
 *                example_cites: [{symbol, source_path}],
 *                matched_rule_code: string|null, from,
 *                default_to: string|null,
 *                provenance: 'ruleset_default'|'llm_proposed'|'unmapped',
 *                notes: string|null, proposal_rationale?: string }],
 *       existing_decisions: [{ decision_id, decision_code, answer_value,
 *                              answer_summary, scope_kind, created_at }],
 *       proposal_pass: { status: 'ok'|'failed',
 *                        source: 'cache'|'generated'|'none',
 *                        eligible, proposed, error: string|null,
 *                        generated_at: string|null }
 *     }
 *     404 -> {error} when no SCL scan exists;  502 on upstream failure.
 *
 *   POST /projects/:projectId/architectures/:architectureId/scl/modernization/review/proposals/retry
 *     Retry-All (2026-08-30): bypasses the per-scan proposal cache, re-runs
 *     the LLM pass and re-persists on success (a failed retry replays the
 *     surviving cache). Returns the SAME full review shape as the GET so the
 *     client swaps state in one shot. 404/502 as the GET.
 *
 *   POST /projects/:projectId/architectures/:architectureId/scl/modernization/confirm
 *     body { target_architecture_id, rows: [{ code, family, from, to,
 *            provenance, usage_count, example_cites }] }
 *     — the ARCHITECTURE id in the path locates the corpus; the TARGET
 *     architecture id in the body owns the persisted decisions (decisions
 *     live against the target architecture, like all target-state decisions).
 *     200 -> {confirmed, failed: [{code, error}]}
 *     400 -> {error, offenders} on validation failure;  502 on upstream failure.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/logger';
import { ObservedIdiom } from '../services/sclModernizationInventory';
import {
  buildModernizationReview,
  ConfirmModernizationRow,
  confirmModernizationDecisions,
  ModernizationProposalPass,
  SclModernizationNoScanError,
  SclModernizationValidationError,
} from '../services/sclModernizationReview';
import { TargetStateCapturedDecision } from '../services/targetStateCapturedDecisionsClient';

const BASE = '/projects/:projectId/architectures/:architectureId/scl/modernization';

export const sclModernizationRouter = Router();

// ---------------------------------------------------------------------------
// Wire mapping (internal camelCase -> route snake_case)
// ---------------------------------------------------------------------------

function rowToWire(row: ObservedIdiom): Record<string, unknown> {
  return {
    family: row.family,
    matcher_key: row.matcherKey,
    usage_count: row.usageCount,
    example_cites: row.exampleCites.map((cite) => ({
      symbol: cite.symbol,
      source_path: cite.sourcePath,
    })),
    matched_rule_code: row.matchedRuleCode,
    from: row.from,
    default_to: row.defaultTo,
    provenance: row.provenance,
    notes: row.notes,
    ...(row.proposalRationale !== undefined ? { proposal_rationale: row.proposalRationale } : {}),
  };
}

function decisionToWire(decision: TargetStateCapturedDecision): Record<string, unknown> {
  return {
    decision_id: decision.decisionId,
    decision_code: decision.decisionCode,
    answer_value: decision.answerValue,
    answer_summary: decision.answerSummary ?? null,
    scope_kind: decision.scopeKind,
    created_at: decision.createdAt,
  };
}

function rowFromWire(raw: unknown): ConfirmModernizationRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cites = Array.isArray(r.example_cites) ? r.example_cites : [];
  return {
    code: typeof r.code === 'string' ? r.code : '',
    family: typeof r.family === 'string' ? r.family : '',
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
    provenance: typeof r.provenance === 'string' ? r.provenance : 'unmapped',
    usageCount: typeof r.usage_count === 'number' ? r.usage_count : 0,
    exampleCites: cites.map((cite) => {
      const c = (cite ?? {}) as Record<string, unknown>;
      return {
        symbol: typeof c.symbol === 'string' ? c.symbol : '',
        sourcePath: typeof c.source_path === 'string' ? c.source_path : '',
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function proposalPassToWire(pass: ModernizationProposalPass): Record<string, unknown> {
  return {
    status: pass.status,
    source: pass.source,
    eligible: pass.eligible,
    proposed: pass.proposed,
    error: pass.error,
    generated_at: pass.generatedAt,
  };
}

/** Shared handler: the GET review and the Retry-All POST return the same
 * full review wire shape; only `regenerateProposals` differs. */
async function respondWithReview(
  req: Request,
  res: Response,
  regenerateProposals: boolean
): Promise<void> {
  const { projectId, architectureId } = req.params;
  try {
    const review = await buildModernizationReview({
      projectId,
      architectureId,
      regenerateProposals,
    });
    res.json({
      scan_id: review.scanId,
      target_architecture_id: review.targetArchitectureId,
      rows: review.rows.map(rowToWire),
      existing_decisions: review.existingDecisions.map(decisionToWire),
      proposal_pass: proposalPassToWire(review.proposalPass),
    });
  } catch (error) {
    if (error instanceof SclModernizationNoScanError) {
      res.status(404).json({ error: 'no SCL scan exists for this architecture' });
      return;
    }
    logger.error('[diag-gateway] scl_modernization review failed', {
      projectId,
      architectureId,
      regenerateProposals,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(502).json({ error: 'modernization review build failed' });
  }
}

sclModernizationRouter.get(`${BASE}/review`, (req: Request, res: Response) =>
  respondWithReview(req, res, false)
);

// Retry-All (2026-08-30): regenerate + re-persist the LLM proposals.
sclModernizationRouter.post(
  `${BASE}/review/proposals/retry`,
  (req: Request, res: Response) => respondWithReview(req, res, true)
);

sclModernizationRouter.post(`${BASE}/confirm`, async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetArchitectureId =
    typeof body.target_architecture_id === 'string' ? body.target_architecture_id : '';
  const rawRows = Array.isArray(body.rows) ? body.rows : null;

  if (!targetArchitectureId) {
    res.status(400).json({ error: 'target_architecture_id is required' });
    return;
  }
  if (!rawRows || rawRows.length === 0) {
    res.status(400).json({ error: 'rows must be a non-empty array' });
    return;
  }

  try {
    const result = await confirmModernizationDecisions({
      projectId,
      targetArchitectureId,
      rows: rawRows.map(rowFromWire),
    });
    res.json({ confirmed: result.confirmed, failed: result.failed });
  } catch (error) {
    if (error instanceof SclModernizationValidationError) {
      res.status(400).json({
        error: 'invalid modernization decision rows',
        offenders: error.offenders,
      });
      return;
    }
    logger.error('[diag-gateway] scl_modernization confirm failed', {
      projectId,
      architectureId,
      targetArchitectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(502).json({ error: 'modernization decision confirm failed' });
  }
});
