import { Router, Request, Response } from 'express';
import { archModelClient } from '../services/archModelClient';
import { generateHypotheses, persistHypotheses } from '../services/hypothesisGenerationEngine';
import { processAnswers } from '../services/hypothesisAnswerProcessor';
import { applyRefinements } from '../services/hypothesisRefinementEngine';
import { Hypothesis, HypothesisAnswer, HypothesisCategory } from '../types/hypothesis';

/**
 * Hypothesis Q&A Route Handler (Increment 15)
 *
 * Provides endpoints for hypothesis-first discovery Q&A:
 * - POST /generate (mounted at /discovery/hypothesis-qa/generate):
 *   Generates hypotheses for a completed discovery run.
 * - POST /refine (mounted at /discovery/hypothesis-qa/refine):
 *   Applies answer-based refinements to candidates/clusters.
 *
 * Spec 2026-04-06: Hypothesis-First Discovery Q&A (Increment 15)
 */
const hypothesisQaRouter = Router();

// =============================================================================
// POST /discovery/hypothesis-qa/generate
// =============================================================================

/**
 * POST /generate
 *
 * Generates hypotheses for a completed discovery run by running
 * deterministic rule checks against candidates, clusters, and atoms.
 *
 * Accepts { projectId, runId } in the request body.
 *
 * Validates:
 * - projectId and runId are provided and non-empty
 * - Referenced run exists and is in COMPLETED status
 *
 * Orchestration:
 * - Load candidates, clusters, atoms via archModelClient
 * - Run generateHypotheses engine
 * - Persist hypotheses to steps_payload via persistHypotheses
 *
 * Returns summary: { hypothesisCount, categoryCounts, hypotheses }
 */
hypothesisQaRouter.post('/generate', async (req: Request, res: Response) => {
  const { projectId, runId } = req.body;

  // Validate required fields
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'projectId is required' },
    });
    return;
  }

  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'runId is required' },
    });
    return;
  }

  try {
    // Validate run exists and is in COMPLETED status
    const run = await archModelClient.getDiscoveryRun(projectId, runId);

    if (!run) {
      res.status(404).json({
        error: { code: 404, message: 'Discovery run not found' },
      });
      return;
    }

    if (run.status !== 'COMPLETED') {
      res.status(400).json({
        error: {
          code: 400,
          message: `Discovery run must be in COMPLETED status for hypothesis generation (current status: ${run.status})`,
        },
      });
      return;
    }

    // Load candidates, clusters, atoms for the run
    const [candidates, clusters, atoms] = await Promise.all([
      archModelClient.getCandidatesByRun(projectId, runId),
      archModelClient.getClustersByRun(projectId, runId),
      archModelClient.getEvidenceByRun(projectId, runId),
    ]);

    // Relationships are needed by some rules (e.g., conflicting evidence traversal)
    // but we pass an empty array since the current rules operate on atoms within clusters
    const relationships: never[] = [];

    // Generate hypotheses via deterministic rule engine
    const hypotheses = generateHypotheses(runId, candidates, clusters, atoms, relationships);

    // Persist hypotheses to steps_payload
    await persistHypotheses(projectId, runId, hypotheses, archModelClient);

    // Compute category counts
    const categoryCounts: Record<string, number> = {};
    for (const h of hypotheses) {
      categoryCounts[h.category] = (categoryCounts[h.category] || 0) + 1;
    }

    // Return summary
    res.json({
      hypothesisCount: hypotheses.length,
      categoryCounts,
      hypotheses,
    });
  } catch (error: any) {
    console.error('[hypothesis-qa/generate] Error during hypothesis generation:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to generate hypotheses',
      },
    });
  }
});

// =============================================================================
// POST /discovery/hypothesis-qa/refine
// =============================================================================

/**
 * POST /refine
 *
 * Applies answer-based refinements to candidates/clusters for a discovery run.
 *
 * Accepts { projectId, runId, answers } in the request body.
 *
 * Validates:
 * - projectId, runId, and answers are provided
 * - answers is a non-empty array
 * - Referenced run exists
 * - Hypotheses exist in steps_payload
 *
 * Orchestration:
 * - Read hypotheses from steps_payload
 * - Call processAnswers to create evidence atoms and store answers
 * - Call applyRefinements to update candidates/clusters
 *
 * Returns summary: { refinementsApplied, confidenceChanges, atomsCreated }
 */
hypothesisQaRouter.post('/refine', async (req: Request, res: Response) => {
  const { projectId, runId, answers } = req.body;

  // Validate required fields
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'projectId is required' },
    });
    return;
  }

  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'runId is required' },
    });
    return;
  }

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    res.status(400).json({
      error: { code: 400, message: 'answers is required and must be a non-empty array' },
    });
    return;
  }

  try {
    // Validate run exists
    const run = await archModelClient.getDiscoveryRun(projectId, runId);

    if (!run) {
      res.status(404).json({
        error: { code: 404, message: 'Discovery run not found' },
      });
      return;
    }

    // Read hypotheses from steps_payload
    const stepsPayload = (run.steps_payload || {}) as Record<string, unknown>;
    const hypothesisQa = (stepsPayload.hypothesisQa as Record<string, unknown>) || {};
    const hypotheses = (hypothesisQa.hypotheses as Hypothesis[]) || [];

    if (hypotheses.length === 0) {
      res.status(400).json({
        error: {
          code: 400,
          message: 'No hypotheses found in steps_payload. Run the generate endpoint first.',
        },
      });
      return;
    }

    // Process answers: create human_qa evidence atoms and store answers
    const createdAtoms = await processAnswers(
      projectId,
      runId,
      answers as HypothesisAnswer[],
      hypotheses,
      archModelClient
    );

    // Load candidates and clusters for refinement
    const [candidates, clusters] = await Promise.all([
      archModelClient.getCandidatesByRun(projectId, runId),
      archModelClient.getClustersByRun(projectId, runId),
    ]);

    // Apply refinements based on answers
    const refinementSummary = await applyRefinements(
      projectId,
      runId,
      answers as HypothesisAnswer[],
      hypotheses,
      candidates,
      clusters,
      archModelClient
    );

    // Return summary
    res.json({
      refinementsApplied: refinementSummary.refinementsApplied,
      confidenceChanges: refinementSummary.confidenceChanges,
      atomsCreated: createdAtoms.length,
    });
  } catch (error: any) {
    console.error('[hypothesis-qa/refine] Error during refinement:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to apply refinements',
      },
    });
  }
});

export { hypothesisQaRouter };
