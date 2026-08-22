import { Router, Request, Response, NextFunction } from 'express';
import { createHttpError } from '../middleware/errorHandler';
import {
  applyFoundationDecisions,
  FoundationDecisionInput,
} from '../services/foundationDecisionApplyService';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the apply_foundation_decisions MCP tool endpoint.
 * Mounts at /mcp/tools/apply_foundation_decisions
 *
 * Foundations & Scope program, Spec 1 (2026-08-22). Applies Foundations
 * Review answers: scope tags (+ decision receipts) onto the named model
 * entities, additive PK promotion for key-policy decisions, and the
 * decision facts upserted to AMS. See foundationDecisionApplyService.
 *
 * Request body:
 *   - sessionId: string (required — house convention)
 *   - projectId / architectureId: UUID v4 (required)
 *   - decisions: non-empty array of {
 *       decision_key, rule_key, answer, scope?, target_entity_names[],
 *       question_text?, payload_json?, rationale?, evidence_hash? }
 *
 * Response: { entities_updated, decisions_upserted, skipped: [...] }
 */
export const applyFoundationDecisionsRouter = Router();

applyFoundationDecisionsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, decisions } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }
      if (
        !architectureId ||
        typeof architectureId !== 'string' ||
        !UUID_V4_REGEX.test(architectureId)
      ) {
        throw createHttpError(400, 'architectureId is required and must be a valid UUID');
      }
      if (!Array.isArray(decisions) || decisions.length === 0) {
        throw createHttpError(400, 'decisions is required and must be a non-empty array');
      }
      for (const d of decisions as Array<Record<string, unknown>>) {
        if (
          !d ||
          typeof d !== 'object' ||
          typeof d.decision_key !== 'string' ||
          d.decision_key.trim() === '' ||
          typeof d.rule_key !== 'string' ||
          typeof d.answer !== 'string' ||
          !Array.isArray(d.target_entity_names)
        ) {
          throw createHttpError(
            400,
            'every decision needs decision_key, rule_key, answer and target_entity_names[]',
          );
        }
      }

      const result = await applyFoundationDecisions({
        projectId,
        architectureId,
        decisions: decisions as FoundationDecisionInput[],
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
