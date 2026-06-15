/**
 * Dependency Resolver — shared types and constants.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * The deterministic resolver layer parses Maven (`pom.xml`) and npm
 * (`package.json`) manifests in a cloned repo and emits one
 * `DeclaredDependency` per declared package. Resolvers are pure,
 * stateless, and decoupled from the architecture-model-service: they
 * never make HTTP calls. The walker (Task Group 3) consumes these
 * outputs to build a BFS scan plan.
 *
 * No XML/JSON parsing libraries are added — Maven uses a focused
 * regex parser over `<dependency>` blocks, and npm uses
 * `JSON.parse`. This keeps the dependency surface flat (the
 * service already ships with axios + tree-sitter + uuid).
 */

/**
 * One declared dependency entry, emitted by a resolver per
 * `<dependency>` block in `pom.xml` or per declared package in
 * `package.json`.
 *
 * Locked contract (Spec 2026-05-06 § "DeclaredDependency shape"):
 *   - Maven `name` = `groupId:artifactId`.
 *   - npm `name` = full string including `@scope/` when scoped.
 *   - `version` stored verbatim (incl. Maven `${propname}` literals).
 *   - `versionRange` carries Maven `[1.0,2.0)` syntax verbatim with
 *     `version` left null/undefined; npm V1 keeps `version` set
 *     verbatim and may also populate `versionRange` for clarity.
 *   - `scope` is the resolver's source-key:
 *       Maven: `compile` | `runtime` | `test` | `provided` | `optional`
 *       npm:   `dependencies` | `devDependencies`
 *              | `peerDependencies` | `optionalDependencies`
 *   - `manifestPath` is repo-root-relative, forward-slash form.
 *   - `manifestLine` is best-effort 1-based.
 */
export interface DeclaredDependency {
  name: string;
  version?: string;
  versionRange?: string;
  scope: string;
  manifestPath: string;
  manifestLine?: number;
}

/**
 * Coordinates returned by a resolver's `extractCoordinates`.
 *
 * Used by the lookup-table builder (Task Group 3) to map a manifest
 * to its declaring artifact — `subfolder` is the parent-dir of the
 * manifest, repo-root-relative, forward-slash form.
 */
export interface ManifestCoordinates {
  ecosystem: string;
  name: string;
  subfolder: string;
}

/**
 * Resolver contract — locked surface (Spec 2026-05-06 § "DependencyResolver
 * interface"). Mirrors the `extensionPackRegistry` design: registration is
 * compile-time via the sibling `register.ts` side-effect import; lookup
 * is by ecosystem id.
 */
export interface DependencyResolver {
  /** Returns the ecosystem this resolver handles. */
  getEcosystem(): 'MAVEN' | 'NPM' | string;

  /**
   * Recursively walks the repo root and returns absolute paths to every
   * manifest this resolver knows how to parse (e.g. all `pom.xml`).
   *
   * Implementations MUST skip entries in
   * {@link DEPENDENCY_WALKER_EXCLUDED_DIRS}.
   */
  findManifests(repoRoot: string): Promise<string[]>;

  /**
   * Parses a single manifest (absolute path) and emits one
   * {@link DeclaredDependency} per declared dependency.
   *
   * `manifestPath` field on each emitted entry is repo-root-relative
   * with forward slashes.
   */
  resolve(repoRoot: string, manifestPath: string): Promise<DeclaredDependency[]>;

  /**
   * Returns coordinates `(ecosystem, name, subfolder)` for the artifact
   * the manifest declares — used to build the lookup table that
   * classifies in-repo internal deps. Returns null when the manifest
   * is missing the identity fields (e.g. a pom with no
   * groupId/artifactId).
   */
  extractCoordinates(
    repoRoot: string,
    manifestPath: string,
  ): Promise<ManifestCoordinates | null>;
}

/**
 * Walker exclusions baked into every resolver's `findManifests`.
 *
 * These directory names are skipped at every depth of the recursive walk
 * so `findManifests` does not descend into vendor / build / VCS scratch
 * dirs that would otherwise produce false-positive manifest hits.
 *
 * Per Spec 2026-05-06 § "Walker exclusions". Project-level
 * `excludePaths` (from the run config) are layered on top by callers.
 */
export const DEPENDENCY_WALKER_EXCLUDED_DIRS: readonly string[] = [
  'node_modules',
  'target',
  'build',
  'dist',
  'out',
  '.git',
  '.gradle',
];
