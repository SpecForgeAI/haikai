/**
 * Architecture Explainer route
 *
 * Serves the static architecture meta-model explainer markdown.
 * Used by the frontend to prepend context-explaining text to the
 * architecture data sent to the Software Architect (shape-spec) stream.
 */

import { Router } from 'express';
import { loadArchitectureExplainer } from '../services/architectureContextBuilder';
import { logger } from '../services/logger';

export const architectureExplainerRouter = Router();

/**
 * GET /
 * Returns the architecture meta-model explainer markdown as plain text.
 */
architectureExplainerRouter.get('/', async (_req, res) => {
  try {
    const explainer = await loadArchitectureExplainer();
    res.type('text/plain').send(explainer);
  } catch (error) {
    logger.warn('Failed to load architecture explainer', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ error: 'Failed to load architecture explainer' });
  }
});
