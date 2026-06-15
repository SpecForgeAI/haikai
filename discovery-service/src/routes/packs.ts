import { Router, Request, Response } from 'express';
import {
  computeTier,
  getRegisteredPacks,
  matchesPredicate,
} from '../services/extensionPackRegistry';
import { parseCoretech } from '../utils/coreTechParser';
import { tierToMode, tierToWarnings } from '../utils/tierCopy';

/**
 * Packs Diagnostic Routes
 *
 * Inspect which V3 LanguagePacks + FrameworkPacks are registered and,
 * given a service's `core_tech` string, which would actually activate.
 * Used to sanity-check pack/predicate configuration before committing to
 * a discovery run.
 *
 * V3-only: the legacy V2 `packs[]` registry was removed atomically in
 * Task Group 11 of the V3 Pack Migration Batch spec.
 *
 * Spec 2026-04-20: V3 Tier UX (Task Group 5)
 * - `GET /applicable` additively returns `tier`, `mode`, and `warnings`
 *   so callers can preflight a discovery run against the same tier gate
 *   logic used by `POST /discovery/runs`. Tier + mode + warnings use the
 *   shared `tierCopy` helpers so the preflight payload is byte-identical
 *   to the gate and the persisted run.
 */
const packsRouter = Router();

/**
 * GET /discovery/packs
 *
 * Lists all registered V3 packs (LanguagePacks + FrameworkPacks) with
 * their kind, id, and predicate.
 */
packsRouter.get('/', (_req: Request, res: Response) => {
  const packs = getRegisteredPacks();
  res.json({ count: packs.length, packs });
});

/**
 * GET /discovery/packs/applicable?coreTech=<string>
 *
 * Given a core_tech free-text string (e.g. "Java, Spring"), returns:
 *  - parsed techHints (same shape the pipeline sees)
 *  - which registered packs would match the predicate (LanguagePack +
 *    FrameworkPack tiers)
 *  - which would NOT match
 *  - `tier` (`'A'|'B'|'C'`) computed via the same `computeTier` the gate uses
 *  - `mode` (`'pack-supervised'|'language-only'|'llm-solo'`) derived from tier
 *  - `warnings` (`string[]`) using the same per-tier copy as the gate
 *
 * Supply core_tech directly — we do not fetch the service entity here to
 * keep the endpoint cheap and side-effect free.
 */
packsRouter.get('/applicable', (req: Request, res: Response) => {
  const coreTech = typeof req.query.coreTech === 'string' ? req.query.coreTech : '';
  if (!coreTech.trim()) {
    res.status(400).json({
      error: { code: 400, message: 'coreTech query param is required (e.g. coreTech=Java,%20Spring)' },
    });
    return;
  }

  const techHints = parseCoretech(coreTech);
  const packs = getRegisteredPacks();

  const applicable: typeof packs = [];
  const notApplicable: typeof packs = [];
  for (const p of packs) {
    if (matchesPredicate(p.when, techHints)) applicable.push(p);
    else notApplicable.push(p);
  }

  // Tier preflight: compute the same A/B/C tier the POST /discovery/runs gate
  // would compute for these techHints, plus the derived mode + warnings copy.
  const tier = computeTier(techHints);
  const mode = tierToMode(tier);
  const warnings = tierToWarnings(tier);

  res.json({
    coreTech,
    techHints,
    applicable: applicable.map((p) => ({ id: p.id, kind: p.kind, when: p.when })),
    notApplicable: notApplicable.map((p) => ({ id: p.id, kind: p.kind, when: p.when })),
    tier,
    mode,
    warnings,
  });
});

export { packsRouter };
