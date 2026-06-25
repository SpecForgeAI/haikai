/**
 * Target dependency-manifest upload API client.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 5
 * (frontend upload UX). Thin client around the single gateway route:
 *
 *   POST /api/projects/{p}/target-architectures/{t}/target-manifests   (multipart)
 *
 * The gateway route (Task Group 1 + the Group 6 hand-off exposure) accepts
 * `pom.xml` / `package.json` (+ an optional `package-lock.json` paired with a
 * `package.json`), each tagged to a target module/service, parses them through
 * the LOCKED discovery resolvers, resolves versions (Group 2), auto-answers the
 * dependency-answerable subset (Group 3) with manual-wins precedence (Group 4),
 * and returns BOTH the parse result AND the structured auto-answer + hand-off
 * slice. The wire is camelCase (the gateway assembles the response itself; it is
 * NOT a raw AMS pass-through), so no snake_case boundary mapper is needed here.
 *
 * NO SILENT DROPS: the gateway reports every dropped/unparsed file in
 * `droppedManifests[]`; this client surfaces them verbatim so the UI can show
 * them (never hide them).
 *
 * Confirmed-manifest closeout READ (Spec 5 Phase 2 follow-up, 2026-06-25): this
 * module ALSO wraps the sibling gateway READ proxy
 *
 *   GET /api/projects/{p}/target-architectures/{t}/manifest-artifacts
 *
 * which returns the AMS latest-per-tag confirmed manifest list as snake_case
 * JSON (verbatim pass-through). `fetchLatestTargetManifests` maps those rows to
 * a compact typed shape for the Migration Delivery Plan wizard's final review
 * screen. UNLIKE the upload above, the read is FAIL-SOFT: on any non-2xx or
 * network error it RESOLVES to an empty array (the caller renders "None") so a
 * degraded read never throws into the wizard.
 */

import { isVersionSentinel } from './architectConversationApi';

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Wire types — mirror the gateway response field-for-field (camelCase).
//   gateway/src/routes/targetManifestUpload.ts (TargetManifestUploadResponse)
//   gateway/src/services/targetManifest/parsedManifestModel.ts (ParsedManifest)
//   gateway/src/services/targetManifest/manifestPrecedence.ts (ResolvedTargetVersion)
//   gateway/src/services/targetManifest/manifestHandoffs.ts (ConfirmedManifestArtifact)
// ============================================================================

/** The two supported manifest kinds (Spec 3 v1 — no Gradle). */
export type ManifestKind = 'pom.xml' | 'package.json';

/** Maven vs npm ecosystem of a parsed manifest. */
export type ManifestEcosystem = 'MAVEN' | 'NPM';

/** One declared dependency row (verbatim resolver output). */
export interface DeclaredDependency {
  name: string;
  version?: string;
  versionRange?: string;
  scope: string;
  manifestPath: string;
  manifestLine?: number;
}

/** A successfully-parsed manifest (parse slice of the response). */
export interface ParsedManifest {
  status: 'parsed';
  ecosystem: ManifestEcosystem;
  kind: ManifestKind;
  tag: string;
  manifestPath: string;
  declaredDependencies: DeclaredDependency[];
  rawPomContent: string | null;
  rawManifestContent?: string;
  packageLockContent: string | null;
}

/**
 * A manifest that was DROPPED / could not be parsed. NEVER hidden — the UI lists
 * it with its reason so the user sees exactly what was rejected and why.
 */
export interface UnparsedManifest {
  status: 'unparsed';
  kind: ManifestKind | null;
  tag: string | null;
  manifestPath: string;
  reason: string;
}

/**
 * One entry in the recomputed structured target-version set (Group 4 / Spec 4
 * hand-off). `version` is a concrete string OR the `version-unknown` sentinel
 * (passthrough — never fabricated). `provenance` distinguishes a manifest-derived
 * value from a surviving manual edit.
 */
export interface ResolvedTargetVersion {
  decisionCode: string;
  framework: string;
  version: string;
  versionUnknown: boolean;
  provenance: 'manifest' | 'manual';
  sourceFile: string | null;
}

/** One confirmed per-module/service-tagged manifest (Spec 5 hand-off). */
export interface ConfirmedManifestArtifact {
  tag: string;
  ecosystem: ManifestEcosystem;
  kind: ManifestKind;
  manifestPath: string;
  content: string;
  packageLockContent: string | null;
  resolvedDependencies: Array<{
    name: string;
    resolvedVersion: string;
    versionUnknown: boolean;
    evidence: string;
    manifestPath: string;
    tag: string;
  }>;
}

/** The auto-answer + hand-off slice (Groups 3/4/6). Null when nothing parsed. */
export interface TargetManifestAutoAnswerSlice {
  writtenCodes: string[];
  rowsWritten: number;
  partialFailureCodes: string[];
  aborted: boolean;
  failureReason: string | null;
  skippedManualCodes: string[];
  resolvedTargetVersions: ResolvedTargetVersion[];
  confirmedManifests: ConfirmedManifestArtifact[];
}

/** The full upload response. */
export interface TargetManifestUploadResponse {
  parsedManifests: ParsedManifest[];
  droppedManifests: UnparsedManifest[];
  summary: {
    parsedCount: number;
    droppedCount: number;
    totalDeclaredDependencies: number;
  };
  autoAnswer: TargetManifestAutoAnswerSlice | null;
}

// ============================================================================
// One file selected for upload, with its REQUIRED module/service tag.
// ============================================================================

/**
 * A manifest file the user selected, paired with the REQUIRED target
 * module/service tag. An optional `packageLock` (npm only) may accompany a
 * `package.json` for exact-version pinning.
 */
export interface SelectedManifest {
  /** The pom.xml / package.json file. */
  file: File;
  /** REQUIRED target module/service tag — submit is blocked until non-empty. */
  tag: string;
  /** Optional package-lock.json paired with a package.json (npm only). */
  packageLock?: File | null;
}

// ============================================================================
// Error type
// ============================================================================

export class TargetManifestApiError extends Error {
  readonly status: number;
  readonly body: { error?: string; message?: string };
  constructor(status: number, body: { error?: string; message?: string }, message?: string) {
    super(message ?? body.error ?? body.message ?? `Target manifest API error (status ${status})`);
    this.name = 'TargetManifestApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseError(res: Response): Promise<TargetManifestApiError> {
  let body: { error?: string; message?: string } = {};
  try {
    const raw = (await res.json()) as { error?: string; message?: string };
    if (raw && typeof raw === 'object') body = raw;
  } catch {
    body = { error: res.statusText || `HTTP ${res.status}` };
  }
  return new TargetManifestApiError(res.status, body);
}

// ============================================================================
// Validation helper — every selected manifest needs a non-empty tag.
// ============================================================================

/**
 * True iff EVERY selected manifest carries a non-empty (trimmed) module/service
 * tag. The upload control disables submit until this holds (Spec 3: reject an
 * untagged manifest — surfaced as a client-side block so the user is never
 * surprised by a server-side drop). An empty selection is NOT submittable.
 */
export function allManifestsTagged(selected: readonly SelectedManifest[]): boolean {
  if (selected.length === 0) return false;
  return selected.every((s) => s.tag.trim().length > 0);
}

// ============================================================================
// Upload
// ============================================================================

/**
 * Upload one or more tagged target manifests. Builds a multipart body:
 *   - each manifest file under the `files` field (in selection order),
 *   - each accompanying package-lock.json ALSO under `files` (the gateway pairs
 *     a lockfile to the package.json in the same directory by path),
 *   - a JSON `tagsByFilename` map (originalname -> tag) so each file's tag is
 *     unambiguous regardless of ordering,
 *   - the optional `conversationThreadId` so written rows carry the thread ref.
 *
 * The browser sets the multipart Content-Type (with boundary) automatically —
 * we do NOT hand-set it. Returns the full response (parse + auto-answer/hand-off
 * slice); dropped files are surfaced verbatim (never hidden).
 */
export async function uploadTargetManifests(
  projectId: string,
  targetArchitectureId: string,
  selected: readonly SelectedManifest[],
  options: { conversationThreadId?: string | null } = {},
): Promise<TargetManifestUploadResponse> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/target-manifests`;

  const fd = new FormData();
  const tagsByFilename: Record<string, string> = {};
  for (const s of selected) {
    fd.append('files', s.file, s.file.name);
    tagsByFilename[s.file.name] = s.tag.trim();
    if (s.packageLock) {
      // The paired lockfile rides the same `files` field; the gateway pairs it to
      // the package.json in the same directory. A lockfile needs no tag.
      fd.append('files', s.packageLock, s.packageLock.name);
    }
  }
  fd.append('tagsByFilename', JSON.stringify(tagsByFilename));
  if (options.conversationThreadId) {
    fd.append('conversationThreadId', options.conversationThreadId);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: fd,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TargetManifestUploadResponse;
}

// ============================================================================
// Read — latest confirmed manifests (closeout summary)
// ============================================================================

/**
 * One row of the AMS latest-per-tag confirmed manifest list as the gateway READ
 * proxy passes it through (snake_case, verbatim). Mirrors the AMS
 * `TargetManifestArtifactDto` / gateway `TargetManifestArtifactWire`
 * field-for-field; only the fields the closeout summary reads are typed (the
 * full row carries `content` / `resolved_dependencies` etc. — intentionally
 * unread here).
 */
export interface TargetManifestArtifactRow {
  tag: string;
  /** Persisted kind — `maven_pom` / `npm_package` (Spec 3 v1). */
  kind: string | null;
  manifest_path: string | null;
  is_latest?: boolean;
}

/**
 * One confirmed manifest, mapped to the compact shape the wizard's review screen
 * renders. `manifestPath` may be empty; the display helper derives a filename
 * from `kind` in that case.
 */
export interface LatestTargetManifest {
  manifestPath: string;
  tag: string;
  kind: string;
}

/**
 * Fetch the latest confirmed manifests (one per module/service tag) for a target
 * architecture via the gateway READ proxy
 *
 *   GET /api/projects/{p}/target-architectures/{t}/manifest-artifacts
 *
 * which returns the AMS snake_case list verbatim. Maps each row to the compact
 * {@link LatestTargetManifest} shape for the Migration Delivery Plan wizard's
 * final review screen.
 *
 * FAIL-SOFT: on a non-2xx response, a malformed body, OR a network error this
 * RESOLVES to an empty array (never throws) — the closeout summary then renders
 * "None". This is a read-only advisory line; a degraded read must not block or
 * crash the wizard.
 */
export async function fetchLatestTargetManifests(
  projectId: string,
  targetArchitectureId: string,
): Promise<LatestTargetManifest[]> {
  const url =
    `${GATEWAY_BASE}/api/projects/${encodeURIComponent(projectId)}` +
    `/target-architectures/${encodeURIComponent(targetArchitectureId)}` +
    `/manifest-artifacts`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return [];
    return body.map((raw) => {
      const row = (raw ?? {}) as TargetManifestArtifactRow;
      return {
        manifestPath: typeof row.manifest_path === 'string' ? row.manifest_path : '',
        tag: typeof row.tag === 'string' ? row.tag : '',
        kind: typeof row.kind === 'string' ? row.kind : '',
      };
    });
  } catch {
    // Network / parse failure — fail soft to "None" (never throw into the wizard).
    return [];
  }
}

// ============================================================================
// Derived display helpers (pure) — used by the provenance/version-unknown UI.
// ============================================================================

/**
 * The single resolved chip label for a target-version entry (e.g.
 * `Spring Boot 3.4.1`, or `Spring Boot (version unknown)` for the sentinel).
 * Mirrors the gateway/`architectConversationApi` chip resolution so the UI
 * renders exactly ONE chip per decision (never framework × version chips).
 */
export function resolvedTargetVersionChip(v: ResolvedTargetVersion): string {
  if (v.versionUnknown || isVersionSentinel(v.version)) {
    return `${v.framework} (version unknown)`;
  }
  return `${v.framework} ${v.version}`.trim();
}

/** Extract just the trailing filename from a path for compact provenance display. */
export function shortenManifestPath(path: string | null): string {
  if (!path) return '';
  const normalised = path.replace(/\\/g, '/');
  const lastSlash = normalised.lastIndexOf('/');
  return lastSlash === -1 ? normalised : normalised.slice(lastSlash + 1);
}

/**
 * Derive the build-file name for a confirmed manifest from its persisted `kind`.
 * Mirrors the gateway seed enrichment's authoritative kind mapping
 * (`migrationSeedBuildFilesEnrichment.ts` `seedFileNameForArtifact`): the
 * persisted Spec-3 kinds are `maven_pom` -> `pom.xml` and `npm_package` ->
 * `package.json`. Returns `''` for an unrecognised / empty kind (the caller
 * then leans on the manifest path).
 */
function fileNameForManifestKind(kind: string): string {
  const k = kind.trim().toLowerCase();
  if (k === 'maven_pom') return 'pom.xml';
  if (k === 'npm_package') return 'package.json';
  return '';
}

/**
 * Format one confirmed-manifest row as `"<filename> (<tag>)"` for the closeout
 * summary line, e.g. `pom.xml (orders-service)`. The filename is the trailing
 * basename of `manifestPath` (`shortenManifestPath`); when the path is empty it
 * is derived from `kind` (`maven_pom` -> `pom.xml`, `npm_package` ->
 * `package.json`). Pure + unit-testable.
 *
 * Degenerate inputs degrade gracefully: with neither a usable filename nor a tag
 * the result is `''`; a filename with no tag is just `"<filename>"`; a tag with
 * no derivable filename is `"(<tag>)"`.
 */
export function formatLatestTargetManifestLabel(row: LatestTargetManifest): string {
  const fromPath = shortenManifestPath(row.manifestPath);
  const fileName = fromPath || fileNameForManifestKind(row.kind);
  const tag = row.tag.trim();
  if (!fileName) return tag ? `(${tag})` : '';
  return tag ? `${fileName} (${tag})` : fileName;
}
