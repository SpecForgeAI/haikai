/**
 * Target-state decisions-file import route + apply handler.
 *
 * Spec: 2026-06-26-target-state-decisions-file-import (Spec 3 of 3) —
 * FR3 (apply-answers write), FR4 (import-wins precedence + override summary),
 * FR5 (cross-project tier-mismatch ignore-with-note), FR8 (re-import).
 *
 * Upload a text file of FINAL target-state decisions (the round-trip of the
 * "Preview prompt-ready output") to pre-complete the architect conversation. The
 * handler parses + validates (decisionsFileImportParser.ts), then for each valid
 * architecture-wide answer writes a captured-decision row through the EXISTING
 * `postCapturedDecision` path with a NEW `createdByTask = 'decisions-file-import'`
 * — riding AMS's append-only supersession (so the import WINS over everything
 * already captured, automated or manual; no destructive overwrite). It returns an
 * override summary (what it superseded), the tier-skipped codes (codes the
 * project auto-skipped — left untouched), the skipped non-architecture sections,
 * the per-line errors (partial-accept; no silent drop), and whether the project
 * is now fully answered (so the UI can offer the existing close vs continue the
 * walk).
 *
 * Mounts onto the shared `architectConversationRouter` (at `/api`) via
 * {@link registerDecisionsFileImportRoute}, alongside the manifest upload route.
 * NO new AMS DTO — the captured-decision envelope + POST `/capture` path are
 * unchanged. The POST + read seams are injectable for the unit-test seam.
 */

import { Router, Request, Response as ExpressResponse } from 'express';
import multer from 'multer';
import { logger } from '../services/logger';
import {
  buildFrameworkVersionEnvelope,
  resolveFrameworkVersionChip,
} from '../config/architect-conversation/frameworkVersionShape';
import {
  postCapturedDecision as defaultPostCapturedDecision,
  CreateCapturedDecisionRequestBody,
} from '../services/architectConversation/targetStateCapturedDecisionsWriter';
import {
  fetchLatestCapturedDecisions as defaultFetchLatestCapturedDecisions,
  TargetStateCapturedDecision,
} from '../services/targetStateCapturedDecisionsClient';
import {
  ParsedDecisionAnswer,
  DecisionsFileBadLine,
  allDecisionCodes,
  parseDecisionsFile,
} from '../services/architectConversation/decisionsFileImportParser';

/** Fixed `created_by_task` stamped on every imported captured-decision row. */
export const DECISIONS_FILE_IMPORT_TASK_NAME = 'decisions-file-import';

/** The auto-skip sentinel `maybeAutoSkip` writes for tier-irrelevant codes. */
const NOT_APPLICABLE = 'not_applicable';

// ---------------------------------------------------------------------------
// Injectable seams (test seam)
// ---------------------------------------------------------------------------

export interface DecisionsFileImportDeps {
  postCapturedDecision: typeof defaultPostCapturedDecision;
  fetchLatestCapturedDecisions: typeof defaultFetchLatestCapturedDecisions;
}

export const defaultDecisionsFileImportDeps: DecisionsFileImportDeps = {
  postCapturedDecision: defaultPostCapturedDecision,
  fetchLatestCapturedDecisions: defaultFetchLatestCapturedDecisions,
};

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface DecisionOverride {
  decisionCode: string;
  /** Prior winning chip (null when there was no prior architecture answer). */
  prior: string | null;
  /** The newly-imported chip. */
  next: string;
}

export interface DecisionsFileImportResult {
  /** Decision codes whose rows were written (each carries `from imported file`). */
  written: string[];
  /** Per-code override summary (what the import superseded). */
  overrides: DecisionOverride[];
  /** Codes skipped because the project tier-auto-skipped them (not_applicable). */
  skippedTierCodes: string[];
  /** Non-architecture sections seen and skipped for v1 (e.g. per-service overrides). */
  skippedSections: string[];
  /** Per-line parse/validation errors (partial-accept; no silent drop). */
  badLines: DecisionsFileBadLine[];
  /** Codes attempted but whose POST failed (fail-soft) — surfaced, not thrown. */
  failedCodes: string[];
  /** True iff every tier-relevant code is now answered (offer close vs continue). */
  allAnswered: boolean;
  /** How many valid answers the file parsed. */
  parsedCount: number;
}

// ---------------------------------------------------------------------------
// Envelope builder — reuses the existing captured-decision envelope.
// ---------------------------------------------------------------------------

function buildAnswerEnvelope(
  answer: ParsedDecisionAnswer,
): { answerValue: string; answerSummary: string } {
  if (answer.kind === 'framework-version') {
    return buildFrameworkVersionEnvelope({
      value: { framework: answer.framework ?? '', version: answer.version ?? '' },
      sourceQuote: null,
      sourceFile: null,
    });
  }
  const value = answer.value ?? '';
  return {
    answerValue: JSON.stringify({ value, sourceQuote: null, sourceFile: null }),
    answerSummary: value,
  };
}

/** The displayed chip for a parsed answer (for the override summary). */
function chipFor(answer: ParsedDecisionAnswer): string {
  if (answer.kind === 'framework-version') {
    return resolveFrameworkVersionChip({
      framework: answer.framework ?? '',
      version: answer.version ?? '',
    });
  }
  return answer.value ?? '';
}

// ---------------------------------------------------------------------------
// Core apply handler (exported for unit testing without Express).
// ---------------------------------------------------------------------------

export async function buildDecisionsFileImportResult(
  args: {
    projectId: string;
    targetArchitectureId: string;
    fileText: string;
    conversationThreadId?: string | null;
  },
  deps: DecisionsFileImportDeps = defaultDecisionsFileImportDeps,
): Promise<DecisionsFileImportResult> {
  const { projectId, targetArchitectureId } = args;
  const parsed = parseDecisionsFile(args.fileText);

  // Read the latest decisions to (a) detect tier-auto-skipped codes and (b) build
  // the override summary. Fail-soft: a read hiccup must not block the import.
  let latest: TargetStateCapturedDecision[] = [];
  try {
    latest = await deps.fetchLatestCapturedDecisions(projectId, targetArchitectureId);
  } catch (err) {
    logger.warn('decisions-file import: could not read latest decisions (proceeding)', {
      projectId,
      targetArchitectureId,
      error: err instanceof Error ? err.message : String(err),
    });
    latest = [];
  }

  // Winning architecture-scope row per code (the import writes architecture scope).
  const winningByCode = new Map<string, TargetStateCapturedDecision>();
  for (const row of latest) {
    if (row.scopeKind !== 'architecture') continue;
    const existing = winningByCode.get(row.decisionCode);
    if (!existing || row.createdAt > existing.createdAt) {
      winningByCode.set(row.decisionCode, row);
    }
  }
  const tierSkippedCodeSet = new Set(
    [...winningByCode.entries()]
      .filter(([, row]) => row.answerValue === NOT_APPLICABLE)
      .map(([code]) => code),
  );

  const written: string[] = [];
  const overrides: DecisionOverride[] = [];
  const skippedTierCodes: string[] = [];
  const failedCodes: string[] = [];

  for (const answer of parsed.answers) {
    // FR5 — a tier-auto-skipped code is left untouched (ignore-with-a-note).
    if (tierSkippedCodeSet.has(answer.decisionCode)) {
      skippedTierCodes.push(answer.decisionCode);
      continue;
    }

    const envelope = buildAnswerEnvelope(answer);
    const body: CreateCapturedDecisionRequestBody = {
      decisionCode: answer.decisionCode,
      scopeKind: 'architecture',
      scopeRefType: null,
      scopeRefId: null,
      answerValue: envelope.answerValue,
      answerSummary: envelope.answerSummary,
      standardsLookupRef: null,
      conversationThreadId: args.conversationThreadId ?? null,
      conversationTurnRef: null,
      createdByTask: DECISIONS_FILE_IMPORT_TASK_NAME,
    };

    try {
      await deps.postCapturedDecision(projectId, targetArchitectureId, body);
    } catch (err) {
      // FR: fail-soft per-write — surface the failed code, keep importing the rest.
      failedCodes.push(answer.decisionCode);
      logger.warn('decisions-file import: row write failed (continuing)', {
        projectId,
        targetArchitectureId,
        decisionCode: answer.decisionCode,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    written.push(answer.decisionCode);

    // FR4 — override summary: did the import supersede a prior architecture answer?
    const prior = winningByCode.get(answer.decisionCode);
    const next = chipFor(answer);
    if (prior && prior.answerValue !== NOT_APPLICABLE) {
      const priorChip = prior.answerSummary && prior.answerSummary.length > 0
        ? prior.answerSummary
        : prior.answerValue;
      if (priorChip !== next) {
        overrides.push({ decisionCode: answer.decisionCode, prior: priorChip, next });
      }
    }
  }

  // FR7 branch input — is every tier-relevant code now answered?
  const relevantCodes = allDecisionCodes().filter((c) => !tierSkippedCodeSet.has(c));
  const answeredCodes = new Set<string>(written);
  for (const [code, row] of winningByCode.entries()) {
    if (row.answerValue !== NOT_APPLICABLE) answeredCodes.add(code);
  }
  const allAnswered = relevantCodes.every((c) => answeredCodes.has(c));

  return {
    written,
    overrides,
    skippedTierCodes,
    skippedSections: parsed.skippedSections,
    badLines: parsed.badLines,
    failedCodes,
    allAnswered,
    parsedCount: parsed.answers.length,
  };
}

// ---------------------------------------------------------------------------
// Express wiring — multipart upload of one text file (mirrors the manifest route).
// ---------------------------------------------------------------------------

const DECISIONS_FILE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — a decisions file is tiny.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DECISIONS_FILE_MAX_BYTES, files: 1 },
});

/**
 * Attaches `POST .../decisions-file-import` onto the supplied router. Called once
 * from `architectConversation.ts` so it mounts alongside the manifest route. Deps
 * are injectable so route tests can stub the POST + read seams.
 */
export function registerDecisionsFileImportRoute(
  router: Router,
  deps: DecisionsFileImportDeps = defaultDecisionsFileImportDeps,
): void {
  router.post(
    '/projects/:projectId/target-architectures/:targetArchitectureId/decisions-file-import',
    (req: Request, res: ExpressResponse, next) => {
      upload.any()(req, res, (err: unknown) => {
        if (err) {
          const code = (err as { code?: string }).code;
          if (code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `Decisions file exceeds the ${DECISIONS_FILE_MAX_BYTES}-byte limit`,
            });
          }
          return res.status(400).json({
            error: `Multipart parse error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return next();
      });
    },
    async (req: Request, res: ExpressResponse) => {
      const { projectId, targetArchitectureId } = req.params;
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'A decisions text file must be uploaded' });
      }

      let fileText: string;
      try {
        fileText = files[0].buffer.toString('utf-8');
      } catch (err) {
        return res.status(400).json({
          error: `Could not decode the file as UTF-8: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const body = req.body as Record<string, unknown> | undefined;
      const conversationThreadId =
        typeof body?.conversationThreadId === 'string' && body.conversationThreadId.length > 0
          ? body.conversationThreadId
          : null;

      try {
        const result = await buildDecisionsFileImportResult(
          { projectId, targetArchitectureId, fileText, conversationThreadId },
          deps,
        );
        return res.status(200).json(result);
      } catch (err) {
        logger.error('decisions-file import: unexpected failure', {
          projectId,
          targetArchitectureId,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
