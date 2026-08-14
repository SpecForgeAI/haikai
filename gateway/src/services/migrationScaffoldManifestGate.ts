/**
 * Scaffold manifest-gate diagnosis (2026-08-14).
 *
 * The scaffold feature+story inject at epic-expansion time, gated on a
 * confirmed target build manifest existing for the BOOK's target
 * architecture. Every failure path of that gate used to degrade to a silent
 * "expand normally" — the live consequence was a service-plane plan with NO
 * scaffold story and eleven specs aimed at an empty repository, with nothing
 * anywhere saying why.
 *
 * This module names the gate's failure mode precisely so callers can log and
 * surface it (expansion logs it; the spec preflight turns it into a
 * book-level warning with the exact remedy):
 *
 *   - `ok`                                — manifest present for the book's arch;
 *   - `no_target_architecture`            — the book has no target architecture id;
 *   - `manifest_under_other_architecture` — nothing under the book's arch, but the
 *     project's ACTIVE or MOST-RECENT-SAVED target architecture HAS confirmed
 *     manifests (the upload/plan binding mismatch class);
 *   - `no_manifest`                       — nothing anywhere (upload never done or
 *     persist failed).
 *
 * Read-only and fail-soft: probe errors degrade toward `no_manifest` with the
 * error recorded — the diagnosis itself must never break expansion/preflight.
 */

import { logger } from './logger';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';
import {
  fetchActiveTargetArchitectureId,
  fetchMostRecentSavedTargetArchitectureId,
} from './targetStateCapturedDecisionsClient';

export type ScaffoldManifestGateStatus =
  | 'ok'
  | 'no_target_architecture'
  | 'manifest_under_other_architecture'
  | 'no_manifest';

export interface ScaffoldManifestGateDiagnosis {
  status: ScaffoldManifestGateStatus;
  /** The book's target architecture id (null when absent). */
  bookTargetArchitectureId: string | null;
  /** Artifact count under the book's architecture (0 unless `ok`). */
  artifactCount: number;
  /**
   * On `manifest_under_other_architecture`: the architecture id that DOES
   * hold confirmed manifests (active or most-recent-saved).
   */
  otherArchitectureId?: string;
  /** Probe errors encountered (fail-soft — recorded, never thrown). */
  probeErrors: string[];
}

export interface ScaffoldManifestGateDeps {
  fetchArtifacts?: typeof fetchLatestTargetManifestArtifacts;
  fetchActiveArchId?: typeof fetchActiveTargetArchitectureId;
  fetchSavedArchId?: typeof fetchMostRecentSavedTargetArchitectureId;
}

/** Human remedy text per gate status — the ONE wording every surface shows. */
export function scaffoldManifestGateRemedy(d: ScaffoldManifestGateDiagnosis): string {
  switch (d.status) {
    case 'ok':
      return 'Confirmed target build manifest present.';
    case 'no_target_architecture':
      return (
        'This plan has no target architecture bound — save the target-state ' +
        'conversation, regenerate the plan, then upload the target build manifest ' +
        '(pom.xml / package.json) on the Target State screen.'
      );
    case 'manifest_under_other_architecture':
      return (
        `A confirmed target build manifest exists — but under target architecture ` +
        `${d.otherArchitectureId}, not this plan's ${d.bookTargetArchitectureId}. ` +
        `Re-upload the manifest against the plan's target architecture (or ` +
        `regenerate the plan against the architecture the manifest was uploaded ` +
        `to), then re-expand the foundations epic.`
      );
    case 'no_manifest':
    default:
      return (
        'No confirmed target build manifest (pom.xml / package.json) is ' +
        'persisted. Upload it on the Target State screen against this plan\'s ' +
        'target architecture, then re-expand the foundations epic so the ' +
        'application-scaffold story is created.'
      );
  }
}

/**
 * Diagnose the scaffold manifest gate for a book. Never throws.
 */
export async function diagnoseScaffoldManifestGate(
  projectId: string,
  bookTargetArchitectureId: string | null | undefined,
  deps: ScaffoldManifestGateDeps = {},
): Promise<ScaffoldManifestGateDiagnosis> {
  const fetchArtifacts = deps.fetchArtifacts ?? fetchLatestTargetManifestArtifacts;
  const fetchActive = deps.fetchActiveArchId ?? fetchActiveTargetArchitectureId;
  const fetchSaved = deps.fetchSavedArchId ?? fetchMostRecentSavedTargetArchitectureId;
  const probeErrors: string[] = [];
  const bookArch = bookTargetArchitectureId ?? null;

  if (!bookArch) {
    return {
      status: 'no_target_architecture',
      bookTargetArchitectureId: null,
      artifactCount: 0,
      probeErrors,
    };
  }

  let underBook: TargetManifestArtifactWire[] = [];
  try {
    underBook = await fetchArtifacts(projectId, bookArch);
  } catch (e) {
    probeErrors.push(
      `book-arch artifacts read failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (Array.isArray(underBook) && underBook.length > 0) {
    return {
      status: 'ok',
      bookTargetArchitectureId: bookArch,
      artifactCount: underBook.length,
      probeErrors,
    };
  }

  // Cross-architecture probe: the upload page posts against a SPECIFIC
  // architecture id; a plan bound to a different one reads empty forever.
  const candidateIds = new Set<string>();
  try {
    const active = await fetchActive(projectId);
    if (active.activeTargetArchitectureId) candidateIds.add(active.activeTargetArchitectureId);
  } catch (e) {
    probeErrors.push(
      `active-arch probe failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    const saved = await fetchSaved(projectId);
    if (saved.savedTargetArchitectureId) candidateIds.add(saved.savedTargetArchitectureId);
  } catch (e) {
    probeErrors.push(
      `saved-arch probe failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  candidateIds.delete(bookArch);

  for (const otherId of candidateIds) {
    try {
      const rows = await fetchArtifacts(projectId, otherId);
      if (Array.isArray(rows) && rows.length > 0) {
        logger.warn(
          `[diag-gateway] scaffold_manifest_gate cross_architecture_mismatch ` +
            `projectId=${projectId} bookArch=${bookArch} manifestArch=${otherId} ` +
            `artifacts=${rows.length}`,
        );
        return {
          status: 'manifest_under_other_architecture',
          bookTargetArchitectureId: bookArch,
          artifactCount: 0,
          otherArchitectureId: otherId,
          probeErrors,
        };
      }
    } catch (e) {
      probeErrors.push(
        `cross-arch artifacts read failed (${otherId}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    status: 'no_manifest',
    bookTargetArchitectureId: bookArch,
    artifactCount: 0,
    probeErrors,
  };
}
