/**
 * Structured `{framework, version}` captured-answer shape — Target-conversation
 * tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR5 capture half
 * + FR8 contract).
 *
 * The seven `versioned` question codes (`service.language`, `service.framework`,
 * `service.runtime`, `db.engine`, `db.driver`, `ui.framework`, `build.tool`)
 * decouple the framework axis from the version axis: ONE resolved
 * `{ framework, version }` value is captured (rendered as a single chip such as
 * `Spring Boot 3.4.1`), NOT a framework×version cartesian product of chips.
 *
 * This module is PURE TYPES + PURE VALIDATION. No I/O, no LLM, no orchestration.
 * It is the gateway source-of-truth for the shared shape; the frontend mirror
 * lives in `frontend/src/api/architectConversationApi.ts` and the two are kept
 * in lock-step by `frontend/src/api/__tests__/frameworkVersionShape.contractWithGateway.test.ts`.
 *
 * Wire: the value rides the EXISTING captured-decision envelope unchanged —
 * `answerValue = JSON.stringify({ value: { framework, version }, sourceQuote,
 * sourceFile })`, `answerSummary` = the resolved chip label. No new AMS DTO is
 * introduced; the persistence path is `targetStateCapturedDecisionsWriter` as
 * for every other captured decision.
 */

import frameworkVersionShapeJson from './frameworkVersionShape.json';

// ---------------------------------------------------------------------------
// Version sentinels (closed set; canonical members in frameworkVersionShape.json)
//
// A concrete version is any non-empty version string (e.g. "3.4.1"). The closed
// SENTINEL set below stands in for non-concrete states. `version-unknown` is the
// Spec 3 manifest-auto-answer state when a manifest cannot resolve a concrete
// version (steering then degrades gracefully — no guessing). Derived from the
// JSON file so the membership is never declared in TypeScript twice; drift is
// caught by the cross-package contract test.
// ---------------------------------------------------------------------------

/**
 * Tuple type capturing the literal-string sentinel members declared in
 * `frameworkVersionShape.json`. Listed here so the TS compiler can narrow the
 * JSON-imported `string[]` down to a literal-union-derivable tuple. If this list
 * and the JSON drift, the cross-package contract test catches it.
 */
type VersionSentinelTuple = readonly ['version-unknown'];

/**
 * The closed set of version SENTINEL strings. Sourced from
 * `frameworkVersionShape.json` — see that file's `_doc` for drift-detection
 * guidance. Anything NOT in this set is treated as a concrete version string.
 */
export const VERSION_SENTINELS =
  frameworkVersionShapeJson.versionSentinels as unknown as VersionSentinelTuple;

export type VersionSentinel = VersionSentinelTuple[number];

/** The Spec 3 "manifest could not resolve a concrete version" sentinel. */
export const VERSION_UNKNOWN: VersionSentinel = 'version-unknown';

/** True iff `version` is a known sentinel (non-concrete) rather than a real version. */
export function isVersionSentinel(version: string): version is VersionSentinel {
  return (VERSION_SENTINELS as readonly string[]).includes(version);
}

// ---------------------------------------------------------------------------
// The structured value
// ---------------------------------------------------------------------------

/**
 * The resolved `{ framework, version }` value captured for a `versioned`
 * question. `framework` is the chosen single-select chip (e.g. `Spring Boot
 * 3.4`); `version` is the dedicated-control version (a concrete string such as
 * `3.4.1`, OR a `VersionSentinel` like `version-unknown`).
 *
 * Both fields are required + non-empty; a malformed payload (missing/blank
 * either field) is rejected by `parseFrameworkVersion`.
 */
export interface FrameworkVersion {
  framework: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Parser / validator (pure)
// ---------------------------------------------------------------------------

export type ParseFrameworkVersionResult =
  | { ok: true; value: FrameworkVersion }
  | { ok: false; reason: string };

/**
 * Validate an unknown payload as a `FrameworkVersion`. Accepts a plain object
 * carrying non-empty string `framework` AND `version`; rejects anything else
 * (a missing field, a blank field, a non-string field, an array, a null, a
 * primitive). `version` may be a concrete version string or a known sentinel —
 * both are accepted here (the sentinel set is validated separately when a caller
 * needs to distinguish concrete vs sentinel).
 *
 * Pure — no I/O, no mutation of the input.
 */
export function parseFrameworkVersion(raw: unknown): ParseFrameworkVersionResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: `Expected a { framework, version } object, received ${
        Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw
      }.`,
    };
  }
  const obj = raw as Record<string, unknown>;
  const framework = obj.framework;
  const version = obj.version;
  if (typeof framework !== 'string' || framework.trim().length === 0) {
    return {
      ok: false,
      reason: 'Structured { framework, version } payload is missing a non-empty `framework`.',
    };
  }
  if (typeof version !== 'string' || version.trim().length === 0) {
    return {
      ok: false,
      reason: 'Structured { framework, version } payload is missing a non-empty `version`.',
    };
  }
  return {
    ok: true,
    value: { framework: framework.trim(), version: version.trim() },
  };
}

// ---------------------------------------------------------------------------
// Chip label + capture envelope helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the single chip label for a `{ framework, version }` pair (the
 * `answerSummary` written to the captured-decision row, e.g. `Spring Boot
 * 3.4.1`). A `version-unknown` sentinel renders as `<framework> (version
 * unknown)` so the chip is honest about the unresolved version; any other
 * concrete version is appended verbatim.
 */
/**
 * Strip a trailing version-like token from a framework label so a choice whose
 * label BAKES a version ("JUnit 5", "Spring Boot 3.4", "Kubernetes 1.30") does
 * not double when the dedicated version field is appended (the "JUnit 5 5" bug).
 * Only a trailing whitespace-separated token that STARTS WITH A DIGIT is dropped
 * (so "Node 20 LTS", "oracle ojdbc11", "Chakra v3" are left intact), and never
 * down to an empty stem. A clean bare stem ("JUnit") is returned unchanged.
 */
export function stripBakedVersionFromStem(framework: string): string {
  const trimmed = (framework ?? '').trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^[0-9]/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join(' ');
  }
  return trimmed;
}

export function resolveFrameworkVersionChip(value: FrameworkVersion): string {
  const framework = stripBakedVersionFromStem(value.framework);
  if (isVersionSentinel(value.version)) {
    if (value.version === VERSION_UNKNOWN) {
      return `${framework} (version unknown)`;
    }
    return `${framework} (${value.version})`;
  }
  return `${framework} ${value.version}`.trim();
}

/** True iff `v` is a `{ framework, version }` object with both fields strings. */
function isFrameworkVersionLike(v: unknown): v is FrameworkVersion {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { framework?: unknown }).framework === 'string' &&
    typeof (v as { version?: unknown }).version === 'string'
  );
}

/**
 * Resolve the persisted `answerSummary` chip for a captured answer value, or
 * `null` when it is NOT a versioned `{ framework, version }` value (a plain
 * single-choice answer keeps `answerSummary` null and renders via its already
 * human-readable `answerValue`).
 *
 * Mirrors the frontend `resolveCapturedAnswerLabel` so the chip persisted here
 * is the SAME one the conversation transcript + Decisions Captured panel show.
 * The capture path stores versioned answers as the `{ value: { framework,
 * version }, sourceQuote, sourceFile }` envelope (or, defensively, a bare
 * `{ framework, version }` object) -- without this, `answerSummary` stayed null
 * and BOTH the panel and the prompt-ready output dumped the raw JSON envelope.
 */
export function resolveCapturedAnswerSummary(answerValue: unknown): string | null {
  if (isFrameworkVersionLike(answerValue)) {
    return resolveFrameworkVersionChip(answerValue);
  }
  if (typeof answerValue === 'string') {
    try {
      const parsed: unknown = JSON.parse(answerValue);
      if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) {
        const inner = (parsed as { value: unknown }).value;
        if (isFrameworkVersionLike(inner)) return resolveFrameworkVersionChip(inner);
      }
    } catch {
      // Not JSON -> a plain single-choice string answer; no chip summary needed.
    }
  }
  return null;
}

/**
 * The capture envelope a versioned question writes through
 * `targetStateCapturedDecisionsWriter`. This is the EXISTING captured-decision
 * envelope convention (`{ value, sourceQuote, sourceFile }` JSON-stringified
 * into `answerValue`, with `answerSummary` = the resolved chip) — the
 * `{ framework, version }` shape simply rides the `value` slot. No new
 * persistence path; no new AMS DTO; snake_case-on-the-wire behaviour unchanged.
 */
export interface FrameworkVersionCaptureEnvelope {
  /** `JSON.stringify({ value: { framework, version }, sourceQuote, sourceFile })`. */
  answerValue: string;
  /** The single resolved chip label (e.g. `Spring Boot 3.4.1`). */
  answerSummary: string;
}

/**
 * Build the captured-decision envelope for a `{ framework, version }` value.
 * `sourceQuote` / `sourceFile` default to `null` (a manual conversation answer
 * has no source file); Spec 3's manifest auto-answer passes them through with
 * the manifest provenance. The returned `answerValue` is byte-for-byte the
 * existing envelope shape used by `openTurnTechStackPrefill.ts`.
 */
export function buildFrameworkVersionEnvelope(args: {
  value: FrameworkVersion;
  sourceQuote?: string | null;
  sourceFile?: string | null;
}): FrameworkVersionCaptureEnvelope {
  const { value, sourceQuote = null, sourceFile = null } = args;
  return {
    answerValue: JSON.stringify({
      value: { framework: value.framework, version: value.version },
      sourceQuote,
      sourceFile,
    }),
    answerSummary: resolveFrameworkVersionChip(value),
  };
}
