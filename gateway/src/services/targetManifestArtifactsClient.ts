/**
 * Target Manifest Artifacts client.
 *
 * Thin typed wrapper over the two Architecture Model Service endpoints that own
 * the confirmed `target_manifest_artifacts` store (Spec 5 Phase 2):
 *
 *   POST /api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts
 *     body: { artifacts: TargetManifestArtifactInput[] }
 *     -> 201 + List<TargetManifestArtifactWire> (the persisted latest, one per tag)
 *
 *   GET  /api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts
 *     -> 200 + List<TargetManifestArtifactWire> (latest non-superseded, one per tag)
 *
 * No business logic lives in the gateway here. The write seam is consumed at the
 * upload route (Piece 2 / Task Group 3) and the read seam at the spec-gen
 * producer (Piece 4 / Task Group 5). Both CALLERS own the fail-soft posture
 * (try/catch + `[diag-gateway]` log + degrade) -- this client itself stays thin
 * and lets errors surface so a caller can catch and log them, mirroring
 * `targetStateCapturedDecisionsClient.ts`.
 *
 * AMS wire = snake_case (the global `spring.jackson.property-naming-strategy:
 * SNAKE_CASE`). The wire interfaces below mirror the AMS DTOs
 * (`TargetManifestArtifactInput` / `TargetManifestArtifactDto`) field-for-field
 * with snake_case names. `content` and `package_lock_content` are carried
 * VERBATIM (byte-for-byte; no trim, no re-encode) on both the write and the read.
 *
 * Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 2.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Wire-format types (mirror the Java DTOs verbatim, snake_case).
// ---------------------------------------------------------------------------

/**
 * One confirmed manifest artifact in the WRITE payload forwarded to
 * {@code POST .../manifest-artifacts}. Mirrors the AMS
 * {@code TargetManifestArtifactInput} record (snake_case wire).
 *
 * Scoping ids ({@code project_id}, {@code target_architecture_id}) are taken
 * from the path, not the body. {@code content} and {@code package_lock_content}
 * carry the verbatim manifest / lockfile bytes (the AMS side stores them
 * unchanged as TEXT). {@code resolved_dependencies} is stored as JSONB -- the
 * element objects pass through opaquely (the AMS DTO types them as
 * {@code List<Map<String, Object>>}).
 */
/**
 * One persisted Tier-2 "free fact" -- manifest-declared technology OUTSIDE the
 * 51 architecture questions (e.g. an MCP SDK, a Spring AI / LLM client), named
 * by the upload LLM gap-fill. Rides the SAME `target_manifest_artifacts` store
 * (Spec 2026-06-26, Task Group 7) as a JSONB array element; snake_case wire
 * (mirrors the AMS `tier2_facts` column's `{ friendly_name, coordinate }`
 * shape). Informational only -- never a captured decision.
 */
export interface Tier2FactWire {
  friendly_name: string;
  coordinate: string;
}

export interface TargetManifestArtifactInput {
  tag: string;
  kind: string | null;
  ecosystem: string | null;
  manifest_path: string | null;
  /** VERBATIM manifest content (carried as TEXT, byte-for-byte). */
  content: string | null;
  /** VERBATIM lockfile content (npm only) or null (Maven). */
  package_lock_content: string | null;
  /** Resolved dependency entries, stored as JSONB (opaque objects). */
  resolved_dependencies: Record<string, unknown>[];
  /**
   * Tier-2 "free facts" (manifest tech outside the 51 questions) as
   * `{ friendly_name, coordinate }` objects, stored as JSONB. Optional /
   * absent-tolerant (legacy rows + Maven uploads with no free facts).
   */
  tier2_facts?: Tier2FactWire[];
}

/**
 * Response shape for a {@code target_manifest_artifacts} row. Mirrors the AMS
 * {@code TargetManifestArtifactDto} record (snake_case wire). Returned (one per
 * tag) from both the write (the persisted latest) and the read (the latest
 * non-superseded). {@code content} / {@code package_lock_content} come back
 * verbatim so the producer emits the file byte-for-byte.
 */
export interface TargetManifestArtifactWire {
  id: string;
  project_id: string;
  target_architecture_id: string;
  tag: string;
  kind: string | null;
  ecosystem: string | null;
  manifest_path: string | null;
  content: string | null;
  package_lock_content: string | null;
  resolved_dependencies: Record<string, unknown>[];
  /** Tier-2 "free facts" (`{ friendly_name, coordinate }`); absent on legacy rows. */
  tier2_facts?: Tier2FactWire[];
  is_latest: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Builds the shared base URL for the manifest-artifacts endpoint. Both path
 * params are {@code encodeURIComponent}-escaped (mirrors
 * `targetStateCapturedDecisionsClient.ts`).
 */
function manifestArtifactsUrl(projectId: string, targetArchitectureId: string): string {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  return (
    `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/manifest-artifacts`
  );
}

/**
 * Persists the confirmed manifest artifacts (one per tag) for a target
 * architecture (WRITE seam). The AMS side replaces the latest per
 * {@code (project_id, target_architecture_id, tag)} and keeps history. Returns
 * the persisted latest artifacts so the caller can confirm the round-trip
 * without a second request.
 *
 * @throws on non-2xx response or network failure -- the CALLER (the upload
 *         route) catches, logs via `[diag-gateway]`, and degrades to a no-op so
 *         the upload response is never broken.
 */
export async function persistTargetManifestArtifacts(
  projectId: string,
  targetArchitectureId: string,
  artifacts: TargetManifestArtifactInput[],
): Promise<TargetManifestArtifactWire[]> {
  const url = manifestArtifactsUrl(projectId, targetArchitectureId);

  logger.debug('Persisting target manifest artifacts to architecture model service', {
    projectId,
    targetArchitectureId,
    artifactCount: artifacts.length,
    url,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ artifacts }),
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service manifest-artifacts persist failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as TargetManifestArtifactWire[];
  return Array.isArray(body) ? body : [];
}

/**
 * Fetches the latest manifest artifacts (one per tag) for a target architecture
 * (READ seam). Used by the spec-gen producer to emit the verbatim build file
 * into the generated codebase.
 *
 * @throws on non-2xx response or network failure -- the CALLER (the producer)
 *         catches, logs via `[diag-gateway]`, and degrades to `null` so the
 *         spec-gen batch is never broken.
 */
export async function fetchLatestTargetManifestArtifacts(
  projectId: string,
  targetArchitectureId: string,
): Promise<TargetManifestArtifactWire[]> {
  const url = manifestArtifactsUrl(projectId, targetArchitectureId);

  logger.debug('Fetching latest target manifest artifacts from architecture model service', {
    projectId,
    targetArchitectureId,
    url,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(
      `architecture model service manifest-artifacts list failed: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as TargetManifestArtifactWire[];
  return Array.isArray(body) ? body : [];
}
