/**
 * CoverageSummaryPanel + coverage-summary helpers
 *
 * Spec: 2026-06-17 Oracle Coverage Scoring -- Task Group 3 (frontend, display-only)
 *
 * The capture session carries one nullable JSONB field
 * (`coverage_summary_json`) holding the whole oracle-coverage summary the
 * validation-service scorer assembled on the completion PATCH (snake_case wire,
 * AMS default). This module:
 *
 *   - parses the raw JSONB blob into the typed {@link CoverageSummary} shape
 *     DEFENSIVELY (`parseCoverageSummary`): a null / absent / malformed /
 *     legacy-pre-fix value yields `null` so the caller renders "coverage not
 *     recorded" -- NEVER an error;
 *   - flags a "thin" endpoint (`isThinEndpoint`): only `happy_path` achieved,
 *     or all of its negative dimensions missing;
 *   - renders the overall + per-endpoint coverage with honest missed-dimension
 *     reasons in a single banner, reusing the host surface's existing
 *     banner/badge CSS classes (passed in via `classes`) -- NO bespoke
 *     charting widget.
 *
 * This is DISPLAY-ONLY: there is no hard gate, no "coverage too low to save"
 * block. The same component renders on the readiness / session-detail view
 * (`CaptureSessionDetailView`) and at Save-as-Baseline
 * (`SaveAsBaselineModal`), so the surfacing is defined exactly once.
 *
 * The {@link CoverageSummary} types mirror the validation-service
 * `CoverageSummary` shape VERBATIM (captureSessionOrchestrator.ts) so the two
 * layers cannot drift; the frontend only READS the field.
 */

import React from 'react';

// ============================================================================
// Coverage summary types (mirror validation-service `CoverageSummary` verbatim)
// ============================================================================

/** A scored coverage dimension == one generated scenario. snake_case wire. */
export interface CoverageDimension {
  name: string;
  type: string;
  expected_status: string;
  achieved: boolean;
  /** The canonical capture id when achieved; null on a MISS. */
  canonical_capture_id: string | null;
  /** Honest human-readable reason on a MISS; null when achieved. */
  reason: string | null;
  /**
   * NON-SCORING REST-convention deviation note for this dimension (e.g.
   * "returns 200 for a missing resource"); null when the behaviour was
   * conventional. snake_case wire (`observation`). Spec 2026-06-23.
   */
  observation: string | null;
}

/** Per-endpoint coverage: the rubric dimensions + the achieved/total fraction. */
export interface EndpointCoverage {
  operation_id: string;
  method: string;
  path: string;
  /** achieved dimensions / total rubric dimensions for this operation (0..1). */
  score: number;
  dimensions: CoverageDimension[];
}

/** One session-level auth-negative probe sub-result. */
export interface AuthCoverageProbe {
  /** `no_token` | `bad_token`. */
  name: string;
  /** Human-readable expectation (e.g. `401`, `401/403`). */
  expected: string;
  achieved: boolean;
  /** Observed HTTP status (null when no response / not run). */
  observed_status: number | null;
  /** Honest reason on a MISS / not-run; null when achieved. */
  reason: string | null;
}

/** The single project-level auth-coverage dimension (rolls up both probes). */
export interface AuthCoverage {
  /** Achieved only when BOTH probes returned their expected rejection. */
  achieved: boolean;
  /** The included endpoint the probes ran against; null when none qualified. */
  representative_operation_id: string | null;
  probes: AuthCoverageProbe[];
}

/**
 * The whole coverage summary persisted on the capture session (one AMS JSONB
 * field, snake_case). A later spec (baseline integrity & provenance, Spec C)
 * reads `overall_score` + per-endpoint dimensions/reasons off the session.
 */
export interface CoverageSummary {
  /** Overall (session) score, 0..1. */
  overall_score: number;
  dimensions_total: number;
  dimensions_achieved: number;
  per_endpoint: EndpointCoverage[];
  auth_coverage: AuthCoverage;
  /**
   * NON-SCORING "Observations / REST-convention deviations" list (e.g.
   * "returns 200 for a missing resource", "no auth enforced", "possible
   * crash"). DISPLAY-ONLY: it does NOT enter `overall_score` /
   * `dimensions_achieved`. snake_case wire (`observations`). Defaults to `[]`
   * for legacy / pre-fix summaries. Spec 2026-06-23.
   */
  observations: string[];
}

// ============================================================================
// Defensive parsing (legacy / pre-fix / malformed -> null, never an error)
// ============================================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toBool(v: unknown): boolean {
  return v === true;
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toNullableStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toNullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce to a string[] (drops non-strings); a non-array yields []. Never throws. */
function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseDimension(raw: unknown): CoverageDimension {
  const o = isObject(raw) ? raw : {};
  return {
    name: toStr(o.name),
    type: toStr(o.type),
    expected_status: toStr(o.expected_status),
    achieved: toBool(o.achieved),
    canonical_capture_id: toNullableStr(o.canonical_capture_id),
    reason: toNullableStr(o.reason),
    observation: toNullableStr(o.observation),
  };
}

function parseEndpoint(raw: unknown): EndpointCoverage {
  const o = isObject(raw) ? raw : {};
  const dims: CoverageDimension[] = Array.isArray(o.dimensions)
    ? o.dimensions.map(parseDimension)
    : [];
  return {
    operation_id: toStr(o.operation_id),
    method: toStr(o.method),
    path: toStr(o.path),
    score: toNum(o.score),
    dimensions: dims,
  };
}

function parseAuthCoverage(raw: unknown): AuthCoverage {
  const o = isObject(raw) ? raw : {};
  const probes: AuthCoverageProbe[] = Array.isArray(o.probes)
    ? o.probes.map((p: unknown) => {
        const po = isObject(p) ? p : {};
        return {
          name: toStr(po.name),
          expected: toStr(po.expected),
          achieved: toBool(po.achieved),
          observed_status: toNullableNum(po.observed_status),
          reason: toNullableStr(po.reason),
        };
      })
    : [];
  return {
    achieved: toBool(o.achieved),
    representative_operation_id: toNullableStr(o.representative_operation_id),
    probes,
  };
}

/**
 * Parse the raw `coverage_summary_json` JSONB blob into the typed
 * {@link CoverageSummary}. Returns `null` for null / absent / non-object /
 * structurally-empty values (legacy or pre-fix sessions) so the caller renders
 * "coverage not recorded" rather than an error. Never throws.
 *
 * The "recorded at all" sentinel is the presence of an `overall_score` number
 * OR a non-empty `per_endpoint` array OR an `auth_coverage` object: any of
 * those means the scorer wrote a summary. An object missing all three is
 * treated as not-recorded.
 */
export function parseCoverageSummary(
  raw: Record<string, unknown> | null | undefined,
): CoverageSummary | null {
  if (!isObject(raw)) return null;
  const hasScore = typeof raw.overall_score === 'number';
  const hasEndpoints = Array.isArray(raw.per_endpoint);
  const hasAuth = isObject(raw.auth_coverage);
  if (!hasScore && !hasEndpoints && !hasAuth) return null;

  const per_endpoint: EndpointCoverage[] = hasEndpoints
    ? (raw.per_endpoint as unknown[]).map(parseEndpoint)
    : [];
  return {
    overall_score: toNum(raw.overall_score),
    dimensions_total: toNum(raw.dimensions_total),
    dimensions_achieved: toNum(raw.dimensions_achieved),
    per_endpoint,
    auth_coverage: parseAuthCoverage(raw.auth_coverage),
    observations: toStrArray(raw.observations),
  };
}

// ============================================================================
// Thin-coverage detection
// ============================================================================

function isHappyDimension(d: CoverageDimension): boolean {
  return d.type === 'happy_path' || d.name === 'happy_path';
}

/**
 * An endpoint is "thin" when its coverage barely pins behaviour:
 *   - ONLY the `happy_path` dimension achieved (no negatives), OR
 *   - it HAS negative (non-happy_path) dimensions but ALL of them are missing.
 *
 * An endpoint with no dimensions at all is not flagged thin (there is no
 * rubric to be thin against). Pure -- no side effects.
 */
export function isThinEndpoint(ep: EndpointCoverage): boolean {
  const dims = ep.dimensions;
  if (dims.length === 0) return false;
  const negatives = dims.filter((d: CoverageDimension) => !isHappyDimension(d));
  const achieved = dims.filter((d: CoverageDimension) => d.achieved);

  // Only happy_path achieved (and nothing else).
  const onlyHappyAchieved =
    achieved.length > 0 && achieved.every(isHappyDimension);
  // Has negatives, but every negative is missing.
  const allNegativesMissing =
    negatives.length > 0 && negatives.every((d: CoverageDimension) => !d.achieved);

  return onlyHappyAchieved || allNegativesMissing;
}

/** Format a 0..1 fraction as a whole-number percent (e.g. 0.6 -> "60%"). */
export function formatScorePct(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  return `${Math.round(clamped * 100)}%`;
}

// ============================================================================
// Happy-path coverage GATE (Spec 2026-07-20 Coverage Closure -- CC1)
//
// Mirrors the validation-service `captureCoverageGate.computeHappyPathGate`
// VERBATIM so the capture-screen banner and the server-side closure driver can
// never disagree. The gate the user must clear before leaving the capture
// screen is NOT full dimensional coverage -- it is "every included endpoint has
// its happy-path baseline". Dimensional coverage stays reported (above); only
// happy-path gates. Excluded endpoints (absent from `per_endpoint`) are OUT of
// the denominator -- accounted, not unresolved.
// ============================================================================

/** One included endpoint still missing its happy-path baseline. */
export interface UnresolvedEndpoint {
  operation_id: string;
  method: string;
  path: string;
  reason: string;
}

/** The happy-path gate verdict (snake_case, mirrors the service type). */
export interface HappyPathGate {
  complete: boolean;
  included_total: number;
  happy_achieved: number;
  unresolved: UnresolvedEndpoint[];
}

/**
 * Compute the happy-path gate from a raw `coverage_summary_json` blob. Pure.
 * A null / unrecorded summary or zero included endpoints is never "complete".
 */
export function computeHappyPathGate(
  raw: Record<string, unknown> | null | undefined,
): HappyPathGate {
  const summary = parseCoverageSummary(raw);
  if (!summary) {
    return { complete: false, included_total: 0, happy_achieved: 0, unresolved: [] };
  }
  const unresolved: UnresolvedEndpoint[] = [];
  let happyAchieved = 0;
  for (const ep of summary.per_endpoint) {
    const happy = ep.dimensions.find(isHappyDimension);
    if (happy && happy.achieved) {
      happyAchieved += 1;
    } else {
      unresolved.push({
        operation_id: ep.operation_id,
        method: ep.method,
        path: ep.path,
        reason:
          (happy && happy.reason) ||
          'happy-path baseline not captured (no successful reference request recorded)',
      });
    }
  }
  const includedTotal = summary.per_endpoint.length;
  return {
    complete: includedTotal > 0 && unresolved.length === 0,
    included_total: includedTotal,
    happy_achieved: happyAchieved,
    unresolved,
  };
}

export interface CoverageGateBannerClasses {
  /** Outer banner container. */
  banner: string;
  /** A neutral/info badge. */
  badge: string;
  /** A warning badge variant. */
  badgeWarning?: string;
  /** The "Retry uncovered APIs" action button. */
  button?: string;
}

export interface CoverageGateBannerProps {
  raw: Record<string, unknown> | null | undefined;
  classes: CoverageGateBannerClasses;
  /**
   * Kick off Coverage Closure for the unresolved endpoints. When omitted the
   * action button is not rendered (the host has not wired closure yet).
   */
  onRetryUncovered?: (unresolved: UnresolvedEndpoint[]) => void;
  testId?: string;
}

/**
 * The capture-screen gate banner: "Baseline complete ✓" once every included
 * endpoint has its happy-path baseline, otherwise "N endpoint(s) unresolved"
 * with a "Retry uncovered APIs" action. Renders nothing until coverage exists
 * (there is no gate to show before the first capture).
 */
export const CoverageGateBanner: React.FC<CoverageGateBannerProps> = ({
  raw,
  classes,
  onRetryUncovered,
  testId = 'coverage-gate',
}) => {
  const gate = computeHappyPathGate(raw);
  if (gate.included_total === 0) return null;
  const warnClass = classes.badgeWarning ?? classes.badge;
  const n = gate.unresolved.length;

  return (
    <div
      className={classes.banner}
      data-testid={testId}
      data-complete={gate.complete ? 'true' : 'false'}
      role="status"
    >
      {gate.complete ? (
        <strong data-testid={`${testId}-complete`}>
          ✓ Baseline complete — all {gate.included_total} included endpoints have
          a happy-path baseline.
        </strong>
      ) : (
        <>
          <strong data-testid={`${testId}-incomplete`}>
            {n} endpoint{n === 1 ? '' : 's'} unresolved — {gate.happy_achieved} of{' '}
            {gate.included_total} included endpoints have a happy-path baseline.
          </strong>
          <span className={classes.badge}>
            You should not leave this screen until every included endpoint has its
            happy-path baseline. Dimensional coverage above is informational.
          </span>
          <ul data-testid={`${testId}-unresolved-list`}>
            {gate.unresolved.map((u) => (
              <li
                key={u.operation_id}
                className={warnClass}
                data-testid={`${testId}-unresolved`}
                data-operation-id={u.operation_id}
              >
                {(u.method || '').toUpperCase()} {u.path || u.operation_id}: {u.reason}
              </li>
            ))}
          </ul>
          {onRetryUncovered && (
            <button
              type="button"
              className={classes.button}
              data-testid={`${testId}-retry`}
              onClick={() => onRetryUncovered(gate.unresolved)}
            >
              Retry uncovered APIs
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ============================================================================
// Presentational component
// ============================================================================

export interface CoverageSummaryPanelClasses {
  /** Outer banner container (e.g. the surface's secretsPrompt / warningBanner). */
  banner: string;
  /** A neutral/info badge (e.g. statusBadge / discoveryBadge). */
  badge: string;
  /** A warning badge variant (e.g. discoveryBadgeWarning) -- used for thin / missed. */
  badgeWarning?: string;
}

export interface CoverageSummaryPanelProps {
  /** Raw JSONB blob off the session DTO (snake_case wire). */
  raw: Record<string, unknown> | null | undefined;
  classes: CoverageSummaryPanelClasses;
  /** Test id for the root element. */
  testId?: string;
}

/**
 * Render the coverage summary (overall + per-endpoint dimensions with honest
 * missed reasons + thin-coverage flags + the project-level auth dimension).
 * A null / absent / unrecorded summary renders the "coverage not recorded"
 * sentinel, never an error.
 */
export const CoverageSummaryPanel: React.FC<CoverageSummaryPanelProps> = ({
  raw,
  classes,
  testId = 'coverage-summary',
}) => {
  const summary = parseCoverageSummary(raw);

  if (!summary) {
    return (
      <div
        className={classes.banner}
        data-testid={`${testId}-not-recorded`}
        role="status"
      >
        <strong>Coverage not recorded.</strong>
        <span>
          This session was captured before oracle coverage scoring was
          available (or no summary was written), so there is no per-endpoint
          coverage to show. Re-run a capture to record coverage.
        </span>
      </div>
    );
  }

  const warnClass = classes.badgeWarning ?? classes.badge;
  const auth = summary.auth_coverage;
  const unachievedProbes = auth.probes.filter((p) => !p.achieved);

  return (
    <div className={classes.banner} data-testid={testId} role="status">
      <strong data-testid={`${testId}-overall`}>
        Behaviour observed/captured: {formatScorePct(summary.overall_score)} (
        {summary.dimensions_achieved} of {summary.dimensions_total} dimensions
        captured)
      </strong>
      <span
        className={classes.badge}
        data-testid={`${testId}-metric-note`}
      >
        This % means how much of the intended behaviour we captured — not how
        closely the API follows REST conventions (see deviations below).
      </span>

      {summary.per_endpoint.length === 0 && (
        <span data-testid={`${testId}-no-endpoints`}>
          No per-endpoint coverage was recorded for this session.
        </span>
      )}

      {summary.per_endpoint.map((ep) => {
        const thin = isThinEndpoint(ep);
        const missed = ep.dimensions.filter((d) => !d.achieved);
        const label = `${(ep.method || '').toUpperCase()} ${
          ep.path || ep.operation_id
        }`.trim();
        return (
          <div
            key={ep.operation_id}
            data-testid={`${testId}-endpoint`}
            data-operation-id={ep.operation_id}
            data-thin={thin ? 'true' : 'false'}
          >
            <span className={classes.badge}>
              {label || ep.operation_id}: {formatScorePct(ep.score)}
            </span>
            {thin && (
              <span
                className={warnClass}
                data-testid={`${testId}-thin-flag`}
                title="Thin coverage: only happy_path captured, or all negative scenarios missing"
              >
                Thin coverage
              </span>
            )}
            {missed.length > 0 && (
              <ul data-testid={`${testId}-missed-list`}>
                {missed.map((d) => (
                  <li key={d.name} data-testid={`${testId}-missed-reason`}>
                    {d.name}: {d.reason ?? 'not achieved'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {/* Project-level auth-negative coverage (one dimension, contributes to
          the overall score only -- never to a per-endpoint score). */}
      <div
        data-testid={`${testId}-auth`}
        data-achieved={auth.achieved ? 'true' : 'false'}
      >
        <span className={auth.achieved ? classes.badge : warnClass}>
          Auth-negative coverage: {auth.achieved ? 'achieved' : 'missing'}
        </span>
        {!auth.achieved && (
          <ul data-testid={`${testId}-auth-reasons`}>
            {unachievedProbes.map((p) => (
              <li key={p.name} data-testid={`${testId}-auth-reason`}>
                {p.name} (expected {p.expected}): {p.reason ?? 'not achieved'}
              </li>
            ))}
            {unachievedProbes.length === 0 && (
              <li data-testid={`${testId}-auth-reason`}>
                auth probes did not run for this session
              </li>
            )}
          </ul>
        )}
      </div>

      {/* NON-SCORING "Observations / REST-convention deviations" list (Spec
          2026-06-23). DISPLAY-ONLY: these never affect the % above; they record
          HOW this API departs from REST conventions (e.g. returns 200 for a
          missing resource, no auth enforced, possible crash). Rendered on both
          host surfaces (CaptureSessionDetailView + SaveAsBaselineModal). */}
      {summary.observations.length > 0 && (
        <div data-testid={`${testId}-observations`}>
          <strong>Observations / REST-convention deviations (non-scoring)</strong>
          <ul data-testid={`${testId}-observations-list`}>
            {summary.observations.map((obs, i) => (
              <li
                key={`${i}-${obs}`}
                className={warnClass}
                data-testid={`${testId}-observation`}
              >
                {obs}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CoverageSummaryPanel;
