/**
 * Conversational target-dependency sourcing for the vulnerability-reduction
 * estimate.
 *
 * Spec: 2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging (Spec C) —
 * Task Group 5.
 *
 * The "Estimated vulnerability reduction" widget must source TARGET versions from
 * the conversation's CAPTURED versioned answers (not only the uploaded manifest).
 * This module is the PURE bridge that:
 *   1. parses a captured-decision `answerValue` back into its `{ framework,
 *      version }` envelope (the same shape `versionControlConfig` writes);
 *   2. resolves each captured `(decisionCode, framework)` pair through the
 *      frontend mirror of the gateway inverse coordinate map to a concrete OSV
 *      `{ coordinate, ecosystem }`;
 *   3. projects the result into the `TargetResolvedDependency` shape the reduction
 *      hook already consumes; and
 *   4. MERGES the conversational deps with the manifest-derived deps — the
 *      MANIFEST concrete resolved version WINS on coordinate overlap (the manifest
 *      is the more specific source).
 *
 * Unmapped captured codes are SILENTLY SKIPPED (the count is surfaced so the
 * caller can `console.debug` it); a `version-unknown` sentinel rides through
 * unchanged (the OSV scan's `isScannableTargetVersion` excludes it — never guess).
 *
 * PURE — no React, no I/O, no network. Unit-tested in isolation.
 */

import { isVersionedCode } from './versionControlConfig';
import {
  isVersionSentinel,
  type CapturedDecisionRow,
} from '../../../api/architectConversationApi';
import { coordinateForCapturedVersion, type OsvEcosystem } from './capturedDecisionOsvCoordinates';
import type { TargetResolvedDependency } from './useVulnerabilityReduction';

/** A parsed `{ framework, version }` capture envelope (both fields non-empty). */
export interface ParsedFrameworkVersion {
  framework: string;
  version: string;
}

function isFrameworkVersionObject(v: unknown): v is ParsedFrameworkVersion {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { framework?: unknown }).framework === 'string' &&
    typeof (v as { version?: unknown }).version === 'string' &&
    (v as { framework: string }).framework.trim().length > 0 &&
    (v as { version: string }).version.trim().length > 0
  );
}

/**
 * Parse a captured-decision `answerValue` into its `{ framework, version }` pair,
 * or `null` when the value is a plain single-choice string (no version envelope).
 *
 * Accepts (mirrors `resolveCapturedAnswerLabel` unwrapping):
 *   - the JSON `{ value: { framework, version }, sourceQuote, sourceFile }`
 *     envelope `versionControlConfig.buildFrameworkVersionCaptureValue` writes;
 *   - a bare JSON `{ framework, version }` object;
 *   - a bare structured object (defensive).
 * Never throws: a non-JSON / non-envelope value resolves to `null`.
 */
export function parseCapturedFrameworkVersion(
  answerValue: unknown,
): ParsedFrameworkVersion | null {
  if (isFrameworkVersionObject(answerValue)) {
    return { framework: answerValue.framework, version: answerValue.version };
  }
  if (typeof answerValue !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(answerValue);
    if (isFrameworkVersionObject(parsed)) {
      return { framework: parsed.framework, version: parsed.version };
    }
    if (parsed !== null && typeof parsed === 'object' && 'value' in parsed) {
      const inner = (parsed as { value: unknown }).value;
      if (isFrameworkVersionObject(inner)) {
        return { framework: inner.framework, version: inner.version };
      }
    }
  } catch {
    /* not JSON -> a plain single-choice string answer; no version envelope. */
  }
  return null;
}

/** Map the OSV ecosystem onto the manifest ecosystem the hook tags deps with. */
function toManifestEcosystem(ecosystem: OsvEcosystem): 'MAVEN' | 'NPM' {
  return ecosystem === 'Maven' ? 'MAVEN' : 'NPM';
}

export interface ConversationalTargetDepsResult {
  /** The resolved + mapped conversational target deps (by coordinate). */
  deps: TargetResolvedDependency[];
  /** Count of captured versioned answers with NO mapped coordinate (skipped). */
  skippedUnmappedCount: number;
}

/**
 * Derive `TargetResolvedDependency` entries from a conversation's captured
 * decision rows. ONLY versioned codes (`isVersionedCode`) with a parseable
 * `{ framework, version }` envelope AND a mapped OSV coordinate contribute; every
 * other captured versioned code is counted as skipped (unmapped) and dropped.
 * De-dups by coordinate (the latest captured row for a coordinate wins).
 */
export function deriveConversationalTargetDeps(
  rows: readonly CapturedDecisionRow[] | null | undefined,
): ConversationalTargetDepsResult {
  const byCoordinate = new Map<string, TargetResolvedDependency>();
  let skippedUnmappedCount = 0;
  for (const row of rows ?? []) {
    if (!isVersionedCode(row.decisionCode)) continue;
    const fv = parseCapturedFrameworkVersion(row.answerValue);
    if (!fv) continue;
    const resolved = coordinateForCapturedVersion(row.decisionCode, fv.framework);
    if (!resolved) {
      // Unmapped captured code: NEVER guessed, NEVER sent to OSV — count only.
      skippedUnmappedCount += 1;
      continue;
    }
    byCoordinate.set(resolved.coordinate, {
      name: resolved.coordinate,
      // A `version-unknown` sentinel rides through unchanged (the scan excludes it).
      resolvedVersion: fv.version,
      versionUnknown: isVersionSentinel(fv.version),
      ecosystem: toManifestEcosystem(resolved.ecosystem),
    });
  }
  return { deps: [...byCoordinate.values()], skippedUnmappedCount };
}

/**
 * Merge conversational target deps with manifest-derived deps. The MANIFEST
 * concrete resolved version WINS on coordinate overlap (the manifest is the more
 * specific source — preserving the existing "concrete > generic" merge discipline
 * in `buildTargetInputsFromResolvedDeps`). Order-independent by coordinate.
 */
export function mergeTargetDeps(
  conversational: readonly TargetResolvedDependency[] | null | undefined,
  manifest: readonly TargetResolvedDependency[] | null | undefined,
): TargetResolvedDependency[] {
  const byCoordinate = new Map<string, TargetResolvedDependency>();
  for (const d of conversational ?? []) byCoordinate.set(d.name, d);
  // Manifest overlays last => it WINS on overlap.
  for (const d of manifest ?? []) byCoordinate.set(d.name, d);
  return [...byCoordinate.values()];
}
