/**
 * Centralized Confidence Module
 *
 * Spec: 2026-04-20 V3 Tier UX — Task Group 2.
 *
 * Single source of truth for per-tag confidence values applied to new
 * discovery candidates at emission time. The V3 pipeline emits candidates
 * from four tag families:
 *
 *   - `<framework>-adapter` (any framework-adapter tag, e.g.
 *     `spring-classic-adapter`) — highest trust, midpoint 0.9.
 *   - `llm-gap-fill` — pack output supplements via LLM, midpoint 0.75.
 *   - `llm-ir-guided` — language-only (IR-guided) LLM, midpoint 0.6.
 *   - `llm-solo` — LLM-only (no pack), midpoint 0.4.
 *   - `llm-behaviour-capture` — per-method behaviour block (Gap C),
 *     midpoint 0.6.
 *
 * Each tag has a range around its midpoint; explicit values supplied by
 * an adapter or by the LLM (when it returns its own confidence in the
 * response) are clamped into that range. Values outside the range are
 * clamped to the range boundary; invalid / non-finite values fall back
 * to the tag midpoint.
 *
 * Adapters sometimes already emit an explicit confidence value (e.g.
 * 0.85–0.95). When a caller supplies `currentValue`, we preserve it
 * (clamped into the tag range) rather than overwriting with the midpoint.
 *
 * Midpoints are env-overridable via:
 *   - `CONFIDENCE_ADAPTER`
 *   - `CONFIDENCE_LLM_GAP_FILL`
 *   - `CONFIDENCE_LLM_IR_GUIDED`
 *   - `CONFIDENCE_LLM_SOLO`
 *   - `CONFIDENCE_LLM_BEHAVIOUR_CAPTURE`
 *
 * Env values must parse as a finite float in [0, 1] or they are ignored
 * in favour of the compile-time default.
 *
 * Unknown tags (not recognised by this module) return a neutral 0.5 and
 * log a single warning per process so the gap is visible in logs without
 * flooding the output.
 */

/**
 * Tag keys recognised by this module. Framework-adapter tags match by
 * `-adapter` suffix rather than by exact name (e.g. `spring-classic-adapter`,
 * `django-adapter`, `flask-adapter` are all treated as `adapter`).
 */
export type ConfidenceTagKey =
  | 'adapter'
  | 'llm-gap-fill'
  | 'llm-ir-guided'
  | 'llm-solo'
  // Business-logic behaviour capture (Spec 2026-05-29 Gap C). The per-method
  // `llmBehaviourCaptureStep` produces a 7-part structured behaviour block by
  // reading the method body + 1 hop of direct-callee bodies via the gateway
  // relay; the block is best-effort RECONSTRUCTION guidance, never proven, so
  // it gets its own confidence-scored tag (midpoint 0.6, mirroring the
  // IR-guided depth/trust profile). Env override:
  // `CONFIDENCE_LLM_BEHAVIOUR_CAPTURE`.
  | 'llm-behaviour-capture'
  // Per-endpoint response-contract enrichment (Spec 2026-05-30 response-contract
  // capture). The deterministic scanner fills the statically-knowable contract
  // fields; this tag scores ONLY the LLM-filled prose/semantic sub-fields
  // (`body_shape`, `response_summary`, `message` interpolation, `envelope`),
  // which are best-effort reconstruction guidance, never proven. Mirrors the
  // behaviour-capture trust profile (midpoint 0.6). Env override:
  // `CONFIDENCE_LLM_RESPONSE_CONTRACT`.
  | 'llm-response-contract';

/**
 * Default midpoint confidence per tag family. See module-level JSDoc for
 * rationale. Exported so other modules (e.g. tests, docs generators) can
 * reference the canonical defaults without re-declaring them.
 */
export const CONFIDENCE_DEFAULTS: Record<ConfidenceTagKey, number> = {
  adapter: 0.9,
  'llm-gap-fill': 0.75,
  'llm-ir-guided': 0.6,
  'llm-solo': 0.4,
  'llm-behaviour-capture': 0.6,
  'llm-response-contract': 0.6,
};

/**
 * Per-tag valid range [min, max]. Explicit `currentValue` inputs are
 * clamped into the corresponding range.
 */
export const CONFIDENCE_RANGES: Record<ConfidenceTagKey, [number, number]> = {
  adapter: [0.85, 0.95],
  'llm-gap-fill': [0.7, 0.8],
  'llm-ir-guided': [0.5, 0.7],
  'llm-solo': [0.3, 0.5],
  'llm-behaviour-capture': [0.5, 0.7],
  'llm-response-contract': [0.5, 0.7],
};

const ENV_VAR_NAMES: Record<ConfidenceTagKey, string> = {
  adapter: 'CONFIDENCE_ADAPTER',
  'llm-gap-fill': 'CONFIDENCE_LLM_GAP_FILL',
  'llm-ir-guided': 'CONFIDENCE_LLM_IR_GUIDED',
  'llm-solo': 'CONFIDENCE_LLM_SOLO',
  'llm-behaviour-capture': 'CONFIDENCE_LLM_BEHAVIOUR_CAPTURE',
  'llm-response-contract': 'CONFIDENCE_LLM_RESPONSE_CONTRACT',
};

/**
 * Tracks whether we've already warned about a given unknown tag so that
 * repeated emissions of the same unknown tag don't spam the log.
 */
const warnedUnknownTags = new Set<string>();

/**
 * Reads and validates the env-override midpoint for a tag. Returns the
 * override if it parses as a finite float in [0, 1]; otherwise returns
 * the compile-time default. Env is consulted at call time (rather than
 * cached at module-init) so tests can set / unset `process.env.*`
 * between cases without re-importing the module.
 */
function resolveMidpoint(tagKey: ConfidenceTagKey): number {
  const envName = ENV_VAR_NAMES[tagKey];
  const raw = process.env[envName];
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return CONFIDENCE_DEFAULTS[tagKey];
}

/**
 * Clamps `value` into the closed interval `[min, max]`.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Classifies a tag string into one of the known tag keys, or `null` if
 * the tag is unrecognised. Any tag ending in `-adapter` is treated as
 * the `adapter` family (e.g. `spring-classic-adapter`).
 */
function classifyTag(tag: string): ConfidenceTagKey | null {
  if (tag === 'llm-gap-fill') return 'llm-gap-fill';
  if (tag === 'llm-ir-guided') return 'llm-ir-guided';
  if (tag === 'llm-solo') return 'llm-solo';
  if (tag === 'llm-behaviour-capture') return 'llm-behaviour-capture';
  if (tag === 'llm-response-contract') return 'llm-response-contract';
  if (tag.endsWith('-adapter')) return 'adapter';
  return null;
}

/**
 * Returns the confidence value to assign for a candidate tagged `tag`.
 *
 * Behaviour:
 *  - If `currentValue` is a finite number in [0, 1]: clamp to the tag's
 *    range and return. This preserves adapter-emitted values (which are
 *    typically already inside `[0.85, 0.95]`) and clamps LLM-supplied
 *    values that stray outside the tag's range.
 *  - If `tag` is a recognised LLM tag and no `currentValue` is supplied:
 *    return the env-overridable midpoint (default from
 *    `CONFIDENCE_DEFAULTS`).
 *  - If `tag` ends in `-adapter` and no `currentValue` is supplied:
 *    return the adapter midpoint.
 *  - If `tag` is unknown: return `0.5` (neutral) and emit a single
 *    `console.warn` per distinct unknown tag per process.
 *
 * `currentValue === null` is treated the same as "not supplied" so that
 * callers can pass through `candidate.confidence ?? undefined` naturally.
 */
export function getConfidenceForTag(
  tag: string,
  currentValue?: number | null,
): number {
  const tagKey = classifyTag(tag);

  if (tagKey === null) {
    if (!warnedUnknownTags.has(tag)) {
      warnedUnknownTags.add(tag);
      // eslint-disable-next-line no-console
      console.warn(
        `[confidence] Unknown tag "${tag}"; returning neutral 0.5. ` +
          'Update confidence.ts if this tag family is expected.',
      );
    }
    return 0.5;
  }

  const [min, max] = CONFIDENCE_RANGES[tagKey];

  if (
    currentValue !== undefined &&
    currentValue !== null &&
    Number.isFinite(currentValue) &&
    currentValue >= 0 &&
    currentValue <= 1
  ) {
    return clamp(currentValue, min, max);
  }

  return resolveMidpoint(tagKey);
}

/**
 * Test-only helper: resets the in-memory "already warned" cache for
 * unknown tags so tests can assert the single-warn behaviour in
 * isolation. Not intended for production use.
 */
export function __resetConfidenceWarningsForTests(): void {
  warnedUnknownTags.clear();
}
