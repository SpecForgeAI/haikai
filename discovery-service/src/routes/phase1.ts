import { Router, Request, Response } from 'express';

/**
 * Phase 1 Route Handler
 *
 * Phase 1 represents code-repo analysis with sub-stages 1a, 1b, 1c, 1d.
 * Returns stub responses only -- no real logic in this skeleton increment.
 */
const phase1Router = Router();

/**
 * Valid steps for Phase 1.
 */
const VALID_STEPS = ['1a', '1b', '1c', '1d'];

/**
 * POST /:step
 *
 * Accepts a route param :step (must be one of 1a, 1b, 1c, 1d)
 * and { projectId: string } in the request body.
 * Validates both step and projectId.
 * Returns a stub response: { phase: 'phase1', step, status: 'stub', projectId }
 */
phase1Router.post('/:step', (req: Request, res: Response) => {
  const { step } = req.params;
  const { projectId } = req.body;

  if (!VALID_STEPS.includes(step)) {
    res.status(400).json({
      error: {
        code: 400,
        message: 'Invalid step. Must be one of: 1a, 1b, 1c, 1d',
      },
    });
    return;
  }

  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({
      error: {
        code: 400,
        message: 'projectId is required',
      },
    });
    return;
  }

  res.json({
    phase: 'phase1',
    step,
    status: 'stub',
    projectId,
  });
});

export { phase1Router };
