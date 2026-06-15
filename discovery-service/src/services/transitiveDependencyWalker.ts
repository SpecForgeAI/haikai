/**
 * Transitive Dependency Walker (BFS)
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 3.
 *
 * Given a root entity (Service or Library), the cloned repo's lookup
 * table, and a flag controlling external-library inclusion, walks the
 * dependency graph BFS and produces a {@link ScanPlan} listing the
 * libraries to scan, the external libraries to record one-deep, and
 * any warnings (cycle / depth-cap / unresolvable-internal).
 *
 * Locked algorithm (Spec 2026-05-06):
 *   - BFS from root; visited-set keyed by `Library.id` (root seeded by
 *     its own id when known).
 *   - Depth cap = 5 (the depth-5 library's outgoing internal edges
 *     are recorded with `status='skipped-depth-cap'`; targets are still
 *     find-or-created/materialized; never enqueued).
 *   - Cycle = revisit of an already-visited Library.id → edge recorded
 *     with `status='skipped-cycle'`; target is materialized (already
 *     exists); never re-walked.
 *   - Walked scopes: Maven `compile`/`runtime`, npm `dependencies`.
 *     All other scopes (Maven `test`/`provided`/`optional`, npm
 *     `devDependencies`/`peerDependencies`/`optionalDependencies`)
 *     produce edges only — never enqueued.
 *   - Internal scannable (in lookup table) → find-or-create Library +
 *     edge; enqueue when walked-set + not visited + depth+1 ≤ 5.
 *   - External (not in lookup table): if `includeExternal === true`,
 *     find-or-create one-deep Library + edge (no enqueue). If false,
 *     skip entirely (no Library row, no edge).
 *   - Internal-unresolvable (looks internal but missing from lookup):
 *     emit warning AND treat as external.
 *
 * The walker is decoupled from the real `archModelClient` via
 * {@link WalkerArchClient} — preflight callers can pass a `findOnly`
 * variant that performs only the find half of find-or-create and
 * returns `library_id: null` for libraries that don't yet exist;
 * actual-run callers pass the create-on-miss variant. Both produce
 * the same {@link ScanPlan} shape.
 */

import { DependencyResolver, DeclaredDependency } from './dependencyResolvers/types';
import { RepoLookupTable } from './repoLookupTableBuilder';
import { getDependencyResolver } from './dependencyResolverRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Walker root — Service- or Library-rooted. */
export interface WalkerRootEntity {
  kind: 'service' | 'library';
  id: string;
  name: string;
  /** UUID of the root's existing derived ApplicationPoint (if known). */
  applicationPointId: string;
  /** Optional Library id when `kind='library'` — used to seed visited-set. */
  libraryId?: string;
  ecosystem: 'MAVEN' | 'NPM';
  repo_location: string;
  repo_subfolder: string;
}

/**
 * Status of a planned BFS edge entry.
 *
 *   - `new` — Library did not yet exist in the model and was created
 *     during the walk (or, for preflight, will be created on the
 *     actual run).
 *   - `re-scan` — Library already existed; will be re-scanned because
 *     its scope walks transitively.
 *   - `skipped-cycle` — Library is the target of a cycle edge; already
 *     visited in this BFS; not re-walked.
 *   - `skipped-depth-cap` — Library is the target of an edge at the
 *     depth boundary (`depth+1 > 5`); not walked.
 *   - `skipped-source-not-found` — Library's on-disk source could not
 *     be resolved (neither subfolder nor sibling-folder fallback hit);
 *     scan skipped, edge still recorded. Set by the run orchestrator,
 *     not the walker itself.
 *   - `failed` — Per-library scan threw an error; the run continues
 *     with the next library. Set by the run orchestrator.
 */
export type ScanPlanStatus =
  | 'new'
  | 're-scan'
  | 'skipped-cycle'
  | 'skipped-depth-cap'
  | 'skipped-source-not-found'
  | 'failed';

export type WalkerWarningType =
  | 'cycle'
  | 'depth-cap'
  | 'unresolvable-internal';

export interface ScanPlanInternalEntry {
  library_id: string | null;
  application_point_id: string | null;
  name: string;
  repo_subfolder: string;
  depth: number;
  status: ScanPlanStatus;
}

export interface ScanPlanExternalEntry {
  library_id: string | null;
  application_point_id: string | null;
  name: string;
  declared_coordinates: string;
  scope: string;
}

export interface ScanPlanWarning {
  type: WalkerWarningType;
  message: string;
  library_name?: string;
}

export interface ScanPlan {
  root: {
    kind: 'service' | 'library';
    id: string;
    name: string;
    repo_location: string;
    repo_subfolder: string;
    ecosystem: string;
  };
  internalLibrariesToScan: ScanPlanInternalEntry[];
  externalLibrariesToRecord: ScanPlanExternalEntry[];
  warnings: ScanPlanWarning[];
}

// ---------------------------------------------------------------------------
// Walker client interface (decoupled from real archModelClient)
// ---------------------------------------------------------------------------

/**
 * Per-call payload that the walker hands to the client when
 * find-or-creating a Library. The real archModelClient flattens these
 * to snake_case at the HTTP boundary.
 */
export interface WalkerLibraryPayload {
  name: string;
  ecosystem: 'MAVEN' | 'NPM';
  repo_location?: string | null;
  repo_subfolder?: string | null;
}

/**
 * Per-call payload for find-or-creating a CodeUnitDependency edge.
 */
export interface WalkerEdgePayload {
  source_application_point_id: string;
  target_application_point_id: string;
  declared_name: string;
  declared_version: string | null;
  declared_version_range: string | null;
  scope: string;
  manifest_path: string;
  manifest_line: number | null;
}

/**
 * Library client result returned by both `findOrCreate` and `findOnly`.
 *
 * `library_id` and `application_point_id` are `null` ONLY in preflight
 * mode when the library does not yet exist (preflight does not write).
 * In actual-run mode both are always populated after a successful call.
 */
export interface WalkerLibraryResult {
  library_id: string | null;
  application_point_id: string | null;
  is_new: boolean;
}

/**
 * Walker-side architecture-model client interface. Two implementations:
 *   - **Actual run** — calls `findOrCreate` endpoints, materializing
 *     rows.
 *   - **Preflight** — calls find-only variants (or short-circuits when
 *     the row does not yet exist), returning `null` ids.
 */
export interface WalkerArchClient {
  /**
   * Find-or-create (actual run) OR find-only (preflight) for a Library
   * row identified by `(model_file_id, name, ecosystem)`. The walker
   * does not know the `model_file_id` — the implementation captures
   * `(projectId, architectureId)` in a closure.
   */
  findOrCreateLibrary(
    payload: WalkerLibraryPayload,
  ): Promise<WalkerLibraryResult>;

  /**
   * Find-or-create (actual run) OR no-op (preflight) for a
   * CodeUnitDependency edge. Preflight implementations may return
   * `null` ids when the edge does not yet exist; the walker records
   * the planned edge regardless.
   */
  findOrCreateCodeUnitDependency(
    payload: WalkerEdgePayload,
  ): Promise<{ id: string | null; is_new: boolean }>;
}

// ---------------------------------------------------------------------------
// BFS implementation
// ---------------------------------------------------------------------------

const DEPTH_CAP = 5;

const MAVEN_WALKED_SCOPES = new Set(['compile', 'runtime']);
const NPM_WALKED_SCOPES = new Set(['dependencies']);

function isWalkedScope(ecosystem: 'MAVEN' | 'NPM', scope: string): boolean {
  if (ecosystem === 'MAVEN') return MAVEN_WALKED_SCOPES.has(scope);
  return NPM_WALKED_SCOPES.has(scope);
}

/** Heuristic: a Maven dep "looks internal" when its groupId matches the project's groupId prefix. */
function looksInternalMaven(name: string, projectName: string): boolean {
  const projectGroupId = projectName.split(':')[0];
  const depGroupId = name.split(':')[0];
  if (!projectGroupId || !depGroupId) return false;
  return depGroupId === projectGroupId;
}

/** Heuristic: an npm dep "looks internal" when it shares the project's `@scope/` prefix. */
function looksInternalNpm(name: string, projectName: string): boolean {
  if (!projectName.startsWith('@')) return false;
  const scope = projectName.split('/')[0];
  return name.startsWith(`${scope}/`);
}

interface QueueEntry {
  /** Visited-set key for this library — null when we don't yet know the id (preflight new entry). */
  libraryId: string | null;
  applicationPointId: string;
  name: string;
  repo_subfolder: string;
  ecosystem: 'MAVEN' | 'NPM';
  depth: number;
}

/**
 * Plans the BFS scan. The actual library + edge writes happen via
 * `archClient`; the returned {@link ScanPlan} is the read-only view
 * the caller (preflight modal / runManager orchestrator) renders or
 * iterates.
 *
 * @param rootEntity     Root Service or Library — start of the BFS.
 * @param repoRoot       Cloned repo root on disk; used to read manifests.
 * @param lookupTable    Repo-wide lookup table built earlier in the run.
 * @param includeExternal When false, external (not-in-lookup) deps are
 *                       skipped entirely. When true, they are recorded
 *                       one-deep.
 * @param archClient     Client that materializes (or finds) Library +
 *                       edge rows. Preflight variants return null ids.
 */
export async function planLibraryScan(
  rootEntity: WalkerRootEntity,
  repoRoot: string,
  lookupTable: RepoLookupTable,
  includeExternal: boolean,
  archClient: WalkerArchClient,
): Promise<ScanPlan> {
  const internalEntries: ScanPlanInternalEntry[] = [];
  const externalEntries: ScanPlanExternalEntry[] = [];
  const warnings: ScanPlanWarning[] = [];

  const visited = new Set<string>();
  if (rootEntity.kind === 'library' && rootEntity.libraryId) {
    visited.add(rootEntity.libraryId);
  } else if (rootEntity.kind === 'service') {
    visited.add(`service:${rootEntity.id}`);
  }

  const queue: QueueEntry[] = [
    {
      libraryId: rootEntity.kind === 'library' ? rootEntity.libraryId ?? null : null,
      applicationPointId: rootEntity.applicationPointId,
      name: rootEntity.name,
      repo_subfolder: rootEntity.repo_subfolder,
      ecosystem: rootEntity.ecosystem,
      depth: 0,
    },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const resolver = getDependencyResolver(current.ecosystem);
    if (!resolver) continue;

    const manifestPath = await resolveManifestForLibrary(
      resolver,
      repoRoot,
      current.repo_subfolder,
    );
    if (!manifestPath) continue;

    const declared = await resolver.resolve(repoRoot, manifestPath);

    for (const dep of declared) {
      const lookup = current.ecosystem === 'MAVEN' ? lookupTable.maven : lookupTable.npm;
      const inLookup = lookup.has(dep.name);
      const looksInternal =
        !inLookup &&
        (current.ecosystem === 'MAVEN'
          ? looksInternalMaven(dep.name, current.name)
          : looksInternalNpm(dep.name, current.name));

      if (inLookup) {
        await handleInternalDep(
          dep,
          current,
          lookup.get(dep.name) ?? '',
          visited,
          queue,
          internalEntries,
          warnings,
          archClient,
        );
      } else if (looksInternal) {
        warnings.push({
          type: 'unresolvable-internal',
          message:
            `Dependency '${dep.name}' looks internal (matches root coordinate prefix) ` +
            `but is not present in the repo's lookup table; treating as external.`,
          library_name: dep.name,
        });
        if (includeExternal) {
          await recordExternal(dep, current, externalEntries, archClient);
        }
      } else {
        if (includeExternal) {
          await recordExternal(dep, current, externalEntries, archClient);
        }
      }
    }
  }

  // Stable ordering: internal entries by (depth ASC, name ASC); externals
  // by (name ASC). Locked contract.
  internalEntries.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  externalEntries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    root: {
      kind: rootEntity.kind,
      id: rootEntity.id,
      name: rootEntity.name,
      repo_location: rootEntity.repo_location,
      repo_subfolder: rootEntity.repo_subfolder,
      ecosystem: rootEntity.ecosystem,
    },
    internalLibrariesToScan: internalEntries,
    externalLibrariesToRecord: externalEntries,
    warnings,
  };
}

async function resolveManifestForLibrary(
  resolver: DependencyResolver,
  repoRoot: string,
  subfolder: string,
): Promise<string | null> {
  const manifests = await resolver.findManifests(repoRoot);
  if (manifests.length === 0) return null;
  // Find the manifest whose parent-dir matches the library's subfolder.
  const wanted = subfolder.replace(/\\/g, '/');
  const path = await import('path');
  for (const m of manifests) {
    const rel = path.relative(repoRoot, m).replace(/\\/g, '/');
    const dir = path.dirname(rel).replace(/\\/g, '/');
    const normalisedDir = dir === '.' ? '' : dir;
    if (normalisedDir === wanted) return m;
  }
  // Fallback: when the root is at repo root and `wanted` is '', return
  // the topmost manifest.
  if (wanted === '') {
    for (const m of manifests) {
      const rel = path.relative(repoRoot, m).replace(/\\/g, '/');
      if (!rel.includes('/')) return m;
    }
  }
  return null;
}

async function handleInternalDep(
  dep: DeclaredDependency,
  current: QueueEntry,
  targetSubfolder: string,
  visited: Set<string>,
  queue: QueueEntry[],
  internalEntries: ScanPlanInternalEntry[],
  warnings: ScanPlanWarning[],
  archClient: WalkerArchClient,
): Promise<void> {
  // Materialize the target Library (find or create) — even on cycle /
  // depth-cap skips, the row is materialized so the edge can attach.
  const targetLib = await archClient.findOrCreateLibrary({
    name: dep.name,
    ecosystem: current.ecosystem,
    repo_location: null,
    repo_subfolder: targetSubfolder,
  });

  // Always record the edge (cycle / depth-cap inclusive).
  if (targetLib.application_point_id) {
    await archClient.findOrCreateCodeUnitDependency({
      source_application_point_id: current.applicationPointId,
      target_application_point_id: targetLib.application_point_id,
      declared_name: dep.name,
      declared_version: dep.version ?? null,
      declared_version_range: dep.versionRange ?? null,
      scope: dep.scope,
      manifest_path: dep.manifestPath,
      manifest_line: dep.manifestLine ?? null,
    });
  }

  const visitedKey = targetLib.library_id ?? `pending:${dep.name}`;
  const isCycle = visited.has(visitedKey);
  const targetDepth = current.depth + 1;
  const overDepthCap = targetDepth > DEPTH_CAP;
  const walked = isWalkedScope(current.ecosystem, dep.scope);

  let status: ScanPlanStatus;
  if (isCycle) {
    status = 'skipped-cycle';
    warnings.push({
      type: 'cycle',
      message:
        `Cycle detected: '${dep.name}' is already visited at a shallower ` +
        `depth in this scan; edge recorded but not re-walked.`,
      library_name: dep.name,
    });
  } else if (overDepthCap) {
    status = 'skipped-depth-cap';
    warnings.push({
      type: 'depth-cap',
      message:
        `Depth cap (${DEPTH_CAP}) reached at '${dep.name}'; edge recorded ` +
        `but library not walked.`,
      library_name: dep.name,
    });
  } else {
    status = targetLib.is_new ? 'new' : 're-scan';
  }

  internalEntries.push({
    library_id: targetLib.library_id,
    application_point_id: targetLib.application_point_id,
    name: dep.name,
    repo_subfolder: targetSubfolder,
    depth: targetDepth,
    status,
  });

  // Enqueue iff: walked scope AND not cycle AND within depth cap.
  if (walked && !isCycle && !overDepthCap) {
    visited.add(visitedKey);
    queue.push({
      libraryId: targetLib.library_id,
      applicationPointId: targetLib.application_point_id ?? current.applicationPointId,
      name: dep.name,
      repo_subfolder: targetSubfolder,
      ecosystem: current.ecosystem,
      depth: targetDepth,
    });
  }
}

async function recordExternal(
  dep: DeclaredDependency,
  current: QueueEntry,
  externalEntries: ScanPlanExternalEntry[],
  archClient: WalkerArchClient,
): Promise<void> {
  const targetLib = await archClient.findOrCreateLibrary({
    name: dep.name,
    ecosystem: current.ecosystem,
    repo_location: null,
    repo_subfolder: null,
  });

  if (targetLib.application_point_id) {
    await archClient.findOrCreateCodeUnitDependency({
      source_application_point_id: current.applicationPointId,
      target_application_point_id: targetLib.application_point_id,
      declared_name: dep.name,
      declared_version: dep.version ?? null,
      declared_version_range: dep.versionRange ?? null,
      scope: dep.scope,
      manifest_path: dep.manifestPath,
      manifest_line: dep.manifestLine ?? null,
    });
  }

  const declaredCoords = dep.versionRange ? `${dep.name} ${dep.versionRange}` : dep.version ? `${dep.name}@${dep.version}` : dep.name;
  externalEntries.push({
    library_id: targetLib.library_id,
    application_point_id: targetLib.application_point_id,
    name: dep.name,
    declared_coordinates: declaredCoords,
    scope: dep.scope,
  });
}
