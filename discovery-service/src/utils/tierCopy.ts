/**
 * Tier Copy Utilities
 *
 * Single source of truth for the public-facing tier -> mode and
 * tier -> warnings mappings used by the V3 Tier UX surface.
 *
 * Spec: 2026-04-20 V3 Tier UX
 *   - Task Group 4 (POST /discovery/runs) consumes these for the 409 gate
 *     payload and for the archmodel passthrough.
 *   - Task Group 5 (GET /discovery/packs/applicable) consumes these to
 *     preflight the tier + warnings before a caller decides to submit a run.
 *
 * Keeping the copy co-located here ensures both endpoints surface
 * byte-identical strings. Paraphrasing the warning text would break
 * exact-match assertions on the frontend banner and on consumer tests.
 *
 * Do NOT inline these strings elsewhere — import from this module.
 */

/**
 * Exact Tier B warning copy per spec copy table.
 * Rendered verbatim by the frontend banner on run detail.
 */
export const TIER_B_WARNINGS: readonly string[] = Object.freeze([
  "Discovery will run in language-only mode. No framework-specific adapter matches your service's tech stack. Candidate quality depends on LLM gap-fill.",
]);

/**
 * Exact Tier C warning copy per spec copy table.
 * Surfaced both on the 409 gate payload and on the persisted run.
 */
export const TIER_C_WARNINGS: readonly string[] = Object.freeze([
  'Discovery will run in LLM-only mode. No language or framework pack matches. Pass confirmLlmSolo: true to proceed.',
]);

/**
 * Public mode string surfaced on API responses and gate payloads.
 */
export type TierMode = 'pack-supervised' | 'language-only' | 'llm-solo';

/**
 * Maps a V3 tier to its public `mode` string.
 *  - A -> 'pack-supervised'
 *  - B -> 'language-only'
 *  - C -> 'llm-solo'
 */
export function tierToMode(tier: 'A' | 'B' | 'C'): TierMode {
  switch (tier) {
    case 'A':
      return 'pack-supervised';
    case 'B':
      return 'language-only';
    case 'C':
      return 'llm-solo';
  }
}

/**
 * Builds the warnings array for a given tier per the spec copy table.
 *
 *  - Tier A -> `[]` (no warnings)
 *  - Tier B -> exactly one string (the B copy)
 *  - Tier C -> exactly one string (the C copy)
 *
 * Returns a fresh array on every call so callers can safely mutate / pass
 * to JSON serializers without contaminating the frozen source constants.
 */
export function tierToWarnings(tier: 'A' | 'B' | 'C'): string[] {
  if (tier === 'A') return [];
  if (tier === 'B') return [...TIER_B_WARNINGS];
  return [...TIER_C_WARNINGS];
}
