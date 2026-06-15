/**
 * Tech Hints Resolve Route
 *
 * Implements POST /discovery/tech-hints/resolve — save-time LLM
 * classification of a service's free-text `core_tech` field against the
 * closed set of registered language/framework packs, with optional repo
 * snapshot cross-check.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 2
 *
 * Request body:
 *   { freeText: string, repoLocation?: string, repoSubfolder?: string }
 *
 * Response (200):
 *   TechHintResolution (see techHintsResolver.ts) — passed through from
 *   the resolver, optionally downgraded to `confidence: 'tech-only'` +
 *   `repoCrossCheck.status: 'partial'` when the clone failed non-timeout.
 *
 * Error responses:
 *   400 — missing/empty `freeText`.
 *   502 — LLM failure with body `{ error, reason: 'llm_timeout' |
 *         'llm_malformed' | 'network_error' }`.
 *   504 — shallow clone timeout with body `{ error, reason: 'clone_timeout' }`.
 *   500 — unexpected internal error.
 *
 * Mounting: the parent `routes/index.ts` mounts this router under
 * `/discovery/tech-hints`.
 */

import { Router, Request, Response } from 'express';
import { resolveTechHints } from '../services/techHintsResolver';
import { normalizeRepoLocation, normalizeRepoSubfolder } from '../services/repoAccess';

const techHintsResolveRouter = Router();

/**
 * POST /resolve
 */
techHintsResolveRouter.post('/resolve', async (req: Request, res: Response) => {
  const body = req.body as {
    freeText?: unknown;
    repoLocation?: unknown;
    repoSubfolder?: unknown;
  };

  // Validation: freeText required non-empty string.
  if (typeof body?.freeText !== 'string' || body.freeText.trim().length === 0) {
    return res.status(400).json({
      error: 'freeText is required and must be a non-empty string',
    });
  }

  // Optional string fields. Normalize at the boundary so small input quirks
  // (file:// prefix, backslashes, leading slash on subfolder, trailing slash)
  // do not cascade into silent scan failures or stray clone attempts.
  const repoLocationRaw =
    typeof body.repoLocation === 'string' && body.repoLocation.trim().length > 0
      ? body.repoLocation
      : undefined;
  const repoLocation = repoLocationRaw ? normalizeRepoLocation(repoLocationRaw) : undefined;

  const repoSubfolderRaw =
    typeof body.repoSubfolder === 'string' && body.repoSubfolder.trim().length > 0
      ? body.repoSubfolder
      : undefined;
  const repoSubfolder = repoSubfolderRaw ? normalizeRepoSubfolder(repoSubfolderRaw) : undefined;

  try {
    const outcome = await resolveTechHints({
      freeText: body.freeText,
      repoLocation,
      repoSubfolder,
    });

    if (outcome.kind === 'ok') {
      return res.status(200).json(outcome.resolution);
    }

    return res.status(outcome.httpStatus).json({
      error: outcome.message,
      reason: outcome.reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        where: 'POST /discovery/tech-hints/resolve',
        reason: 'network_error',
        message,
      }),
    );
    return res.status(500).json({
      error: 'Internal server error',
      reason: 'network_error',
    });
  }
});

export { techHintsResolveRouter };
