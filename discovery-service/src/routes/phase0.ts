import { Router, Request, Response } from 'express';

/**
 * Phase 0 Route Handler
 *
 * Phase 0 represents discovery framing/setup.
 * Returns stub responses only -- no real logic in this skeleton increment.
 */
const phase0Router = Router();

/**
 * POST /frame
 *
 * Accepts { projectId: string } in the request body.
 * Validates that projectId is a non-empty string.
 * Returns a stub response: { phase: 'phase0', step: 'frame', status: 'stub', projectId }
 */
phase0Router.post('/frame', (req: Request, res: Response) => {
  const { projectId } = req.body;

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
    phase: 'phase0',
    step: 'frame',
    status: 'stub',
    projectId,
  });
});

export { phase0Router };
