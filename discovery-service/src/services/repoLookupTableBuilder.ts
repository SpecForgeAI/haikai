/**
 * Repo-wide Library Lookup Table Builder
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 3.
 *
 * Walks every registered {@link DependencyResolver}'s `findManifests`
 * over a cloned repo and builds per-ecosystem maps from the artifact
 * coordinate (`"groupId:artifactId"` for Maven, `"name"` for npm) to
 * the manifest's parent-dir as a repo-root-relative subfolder.
 *
 * The walker (Task Group 3 sibling, `transitiveDependencyWalker.ts`)
 * uses this table to classify a declared dependency as:
 *   - **internal scannable** (in the table) → enqueue for BFS scan,
 *   - **external** (not in the table) → record as one-deep edge
 *     (only when `includeExternal === true`),
 *   - **internal-unresolvable** (looks internal but not in table) →
 *     emit warning + treat as external.
 *
 * Built once per discovery run (preflight or actual). Resolver
 * `findManifests` already bakes in walker exclusions
 * (`node_modules/`, `target/`, etc.).
 */

import { getAllDependencyResolvers } from './dependencyResolverRegistry';

/**
 * Two-ecosystem lookup table. The keys are the resolver's coordinate
 * `name` (Maven `"groupId:artifactId"`, npm `"@scope/name"` or
 * `"name"`); the values are the manifest's parent-dir as a
 * repo-root-relative forward-slash path (or `""` when at repo root).
 */
export interface RepoLookupTable {
  maven: Map<string, string>;
  npm: Map<string, string>;
}

/**
 * Builds the lookup table by invoking every registered resolver's
 * `findManifests` + `extractCoordinates`. Manifests that fail to yield
 * coordinates (e.g. a pom without a groupId/artifactId) are skipped.
 *
 * Returns an empty table when no resolvers are registered (or the repo
 * has no manifests). Callers must defensively check `.size === 0` if
 * they need to disambiguate the two cases.
 */
export async function buildRepoLookupTable(
  repoRoot: string,
): Promise<RepoLookupTable> {
  const table: RepoLookupTable = {
    maven: new Map(),
    npm: new Map(),
  };

  for (const resolver of getAllDependencyResolvers()) {
    const ecosystem = resolver.getEcosystem();
    const manifests = await resolver.findManifests(repoRoot);
    for (const m of manifests) {
      const coords = await resolver.extractCoordinates(repoRoot, m);
      if (!coords) continue;
      const target = ecosystem === 'MAVEN' ? table.maven : ecosystem === 'NPM' ? table.npm : undefined;
      if (!target) continue;
      // First-write-wins — duplicates would be a misconfiguration.
      if (!target.has(coords.name)) {
        target.set(coords.name, coords.subfolder);
      }
    }
  }

  return table;
}
