/**
 * Content-addressed LLM-output cache for the operational-artifact summariser
 * relay.
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery (D1), Task Group 3.
 *
 * The operational-artifact scan calls the gateway summariser relay once per
 * file. This is the operational-artifact ANALOGUE of `gapFillResponseCache.ts`
 * -- it REUSES the approach (the same `GapFillResponseCache` class +
 * `normalizePromptForHash` hashing, keyed on `(normalized-prompt + model +
 * temperature 0)`) but is a SEPARATE INSTANCE with its OWN model env knob, so
 * it never shares or poisons the gap-fill cache (Decision 7 -- clean prompt /
 * model / cache separation).
 *
 * On a hit, the prior response content is returned and NO relay/LLM call is
 * made. The cache is in-process and instantiated fresh per run (cold start).
 */

import {
  GapFillResponseCache,
  GapFillCacheEntry,
  GAP_FILL_RELAY_TEMPERATURE,
} from './gapFillResponseCache';

/**
 * The operational-artifact summariser relay temperature. The gateway sets
 * `temperature: 0` on the relay (`discoveryOperationalArtifact.ts`); the cache
 * key CONSUMES that value. Reuses the gap-fill constant (both relays are fixed
 * at 0) so the key's temperature component is self-documenting.
 */
export const OPERATIONAL_ARTIFACT_RELAY_TEMPERATURE = GAP_FILL_RELAY_TEMPERATURE;

/**
 * Default model identifier baked into the key. The real model is gateway-side;
 * this MIRRORS it so the cache busts when the deployment points the summariser
 * at a different model. Override via `OPERATIONAL_ARTIFACT_CACHE_MODEL` (falls
 * back to `GAP_FILL_CACHE_MODEL`, then a stable sentinel).
 */
const DEFAULT_OPERATIONAL_ARTIFACT_MODEL = 'gateway-default';

/**
 * Read the model identifier the key should include. Env-tunable so a deployment
 * that repoints the gateway model can keep the cache honest. Prefers the
 * dedicated `OPERATIONAL_ARTIFACT_CACHE_MODEL`, then the shared
 * `GAP_FILL_CACHE_MODEL`, then the sentinel default.
 */
export function readOperationalArtifactCacheModel(): string {
  const dedicated = process.env.OPERATIONAL_ARTIFACT_CACHE_MODEL;
  if (dedicated && dedicated.trim().length > 0) return dedicated.trim();
  const shared = process.env.GAP_FILL_CACHE_MODEL;
  if (shared && shared.trim().length > 0) return shared.trim();
  return DEFAULT_OPERATIONAL_ARTIFACT_MODEL;
}

/**
 * In-process content-addressed cache for the operational-artifact summariser.
 * A SEPARATE instance from the gap-fill cache -- reuse the APPROACH (the
 * `GapFillResponseCache` class), not the cache instance.
 */
export class OperationalArtifactResponseCache extends GapFillResponseCache {}

export type { GapFillCacheEntry as OperationalArtifactCacheEntry };
