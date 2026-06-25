/**
 * Manifest Dependency Resolvers — gateway-local port of the LOCKED
 * discovery-service resolver contract.
 *
 * Spec: 2026-06-24-target-dependency-manifest-auto-answer (Spec 3) — Task Group 1.
 *
 * WHY THIS IS A GATEWAY-LOCAL PORT (and not a cross-package import):
 * -----------------------------------------------------------------
 * The authoritative resolvers live in
 *   discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts
 *   discovery-service/src/services/dependencyResolvers/npm/NpmDependencyResolver.ts
 *   discovery-service/src/services/dependencyResolvers/maven/mavenPomMetadataParser.ts
 * and are a HARD, LOCKED contract that MUST NOT be modified or forked in place
 * (Spec 3 contract-preservation guardrail). They are reused here, not changed.
 *
 * The gateway and discovery-service are SEPARATE build units with NO import
 * path between them: the gateway `tsconfig.json` pins `rootDir: ./src`, so a
 * relative `../../../discovery-service/src/...` import is rejected by `tsc`
 * (TS6059 "not under rootDir") and the gateway documents elsewhere (see
 * `discoveryReviewConversation/reviewModelFull.ts`,
 * `discovery/resolveBulkActionSet.ts`) that it deliberately does NOT import the
 * discovery-service source across the build boundary. There is also no built
 * `dist`, no root workspace, and no published package to depend on.
 *
 * Therefore the parsing logic below is a FAITHFUL, BYTE-FOR-BYTE port of the
 * discovery-service resolvers' regex/JSON parsing so the emitted
 * {@link DeclaredDependency} rows are IDENTICAL to what the on-disk resolvers
 * would produce for the same manifest content:
 *   - Maven `name = groupId:artifactId`; `version` stored VERBATIM (including
 *     unresolved `${propname}`); `[a,b)` ranges → `versionRange`, `version`
 *     left undefined; `<dependencyManagement>` blocks skipped; scope precedence
 *     `<scope>` > `<optional>true` → `optional` > default `compile`.
 *   - npm `name` = full string incl. `@scope/`; `version` VERBATIM; range
 *     operators → `versionRange`; scope = the source-key verbatim across all
 *     four dependency groups.
 *
 * The version-RESOLUTION layer (Task Group 2) sits ON TOP of this verbatim
 * output, exactly as it would on top of the real resolver output — it never
 * mutates these rows.
 *
 * Because uploaded manifests arrive as in-memory buffers (not an on-disk repo),
 * the resolver entry points here accept the raw manifest STRING + a
 * repo-relative `manifestPath` directly (the pure equivalent of the
 * discovery-service resolver's `resolve(repoRoot, manifestPath)` after it reads
 * the file). The route layer supplies the tagged manifest path as
 * `manifestPath` so each emitted row's `manifestPath` is preserved for later
 * `sourceFile` provenance.
 *
 * PURE: no I/O, no network, no LLM. Mirrors the discovery-service resolvers'
 * "pure, stateless, never makes HTTP calls" property.
 */

// ---------------------------------------------------------------------------
// DeclaredDependency — locked shape (ported verbatim from
// discovery-service/src/services/dependencyResolvers/types.ts).
// ---------------------------------------------------------------------------

/**
 * One declared dependency entry. Locked contract (Spec 2026-05-06
 * § "DeclaredDependency shape") — kept structurally identical to the
 * discovery-service definition so downstream code that already understands the
 * discovery shape needs no adaptation.
 */
export interface DeclaredDependency {
  name: string;
  version?: string;
  versionRange?: string;
  scope: string;
  manifestPath: string;
  manifestLine?: number;
}

export type ManifestEcosystem = 'MAVEN' | 'NPM';

// ===========================================================================
// Maven — port of MavenDependencyResolver.resolve()
// ===========================================================================

const MAVEN_RANGE_PREFIX = /^[\[\(]/;
const MAVEN_RANGE_HAS_COMMA = /,/;

/**
 * Extracts the textual content of the first occurrence of `<tag>...</tag>`
 * inside `block`. Returns trimmed inner text, or undefined when absent.
 * (Ported verbatim from the discovery-service Maven resolver.)
 */
function extractTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i');
  const match = block.match(re);
  return match ? match[1].trim() : undefined;
}

/** Best-effort 1-based line number for a 0-based byte offset. */
function lineForOffset(content: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Maven version-range detection per locked contract: a value beginning with
 * `[` or `(` AND containing a comma is a range; everything else (including
 * unresolved `${propname}` placeholders) is stored as `version` verbatim.
 */
function isMavenRange(value: string): boolean {
  return MAVEN_RANGE_PREFIX.test(value) && MAVEN_RANGE_HAS_COMMA.test(value);
}

/**
 * Parse a `pom.xml` string into {@link DeclaredDependency} rows — the pure
 * equivalent of `MavenDependencyResolver.resolve(repoRoot, manifestPath)` once
 * the file has been read. `manifestPath` is the repo-relative path stamped on
 * every emitted row.
 *
 * Versions are stored VERBATIM (incl. `${propname}`); `<dependencyManagement>`
 * entries are skipped (those are version-pinning declarations, not deps).
 */
export function resolveMavenManifest(
  rawPom: string,
  manifestPath: string,
): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  if (!rawPom || typeof rawPom !== 'string') return out;

  // Identify the byte ranges of <dependencyManagement> blocks so we can skip
  // dependencies declared inside them (pinning declarations, not real deps).
  const managementRanges: Array<[number, number]> = [];
  const mgmtRe = /<dependencyManagement\b[^>]*>([\s\S]*?)<\/dependencyManagement>/g;
  let mgmtMatch: RegExpExecArray | null;
  while ((mgmtMatch = mgmtRe.exec(rawPom)) !== null) {
    managementRanges.push([mgmtMatch.index, mgmtMatch.index + mgmtMatch[0].length]);
  }

  const blockRe = /<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(rawPom)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const inManagement = managementRanges.some(([s, e]) => start >= s && end <= e);
    if (inManagement) continue;

    const block = match[1];
    const groupId = extractTag(block, 'groupId');
    const artifactId = extractTag(block, 'artifactId');
    if (!groupId || !artifactId) {
      // Skip malformed entries (mirrors the resolver).
      continue;
    }

    const versionRaw = extractTag(block, 'version');
    const scopeRaw = extractTag(block, 'scope');
    const optionalRaw = extractTag(block, 'optional');

    let version: string | undefined;
    let versionRange: string | undefined;
    if (versionRaw && versionRaw.length > 0) {
      if (isMavenRange(versionRaw)) {
        versionRange = versionRaw;
      } else {
        // Verbatim — including ${propname} literals per locked contract.
        version = versionRaw;
      }
    }

    // Scope precedence: explicit <scope> wins; otherwise <optional>true</optional>
    // promotes to scope='optional'; otherwise default 'compile'.
    let scope = 'compile';
    if (scopeRaw && scopeRaw.length > 0) {
      scope = scopeRaw;
    } else if (optionalRaw && optionalRaw.toLowerCase() === 'true') {
      scope = 'optional';
    }

    out.push({
      name: `${groupId}:${artifactId}`,
      version,
      versionRange,
      scope,
      manifestPath,
      manifestLine: lineForOffset(rawPom, start),
    });
  }

  return out;
}

// ===========================================================================
// npm — port of NpmDependencyResolver.resolve()
// ===========================================================================

const NPM_DEP_KEYS: Array<
  'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
> = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Detects npm version-range syntax. A pinned semver literal like `1.2.3`
 * returns false; `^1.2.3`, `~1.0.0`, `>=1.0`, `*`, ranges with spaces /
 * hyphens / `||`, `1.x` all return true. `latest`/dist-tags return false (not a
 * range, but not pinned either — stored verbatim as `version`).
 * (Ported verbatim from the discovery-service npm resolver.)
 */
function isNpmRange(value: string): boolean {
  if (value.length === 0) return false;
  if (/^[\^~*]/.test(value)) return true;
  if (/^[<>]=?/.test(value)) return true;
  if (/(\s|\|\|| - )/.test(value)) return true;
  if (/\.x(\b|$)/i.test(value)) return true;
  return false;
}

/**
 * Best-effort 1-based line number for the FIRST appearance of `"name":` in the
 * raw JSON text. Used to populate `manifestLine`.
 */
function lineForKey(content: string, depName: string): number | undefined {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`"${escaped}"\\s*:`);
  const idx = content.search(re);
  if (idx < 0) return undefined;
  let line = 1;
  for (let i = 0; i < idx; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Raised when a `package.json` cannot be JSON-parsed. The route layer catches
 * this so the dropped manifest is LOGGED + surfaced (no silent drop), instead
 * of the discovery-service resolver's "skip silently" behaviour which is
 * appropriate for a whole-repo walk but NOT for a single user upload.
 */
export class NpmManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NpmManifestParseError';
  }
}

/**
 * Parse a `package.json` string into {@link DeclaredDependency} rows across all
 * four dependency groups — the pure equivalent of
 * `NpmDependencyResolver.resolve(repoRoot, manifestPath)` once the file has
 * been read. Versions stored VERBATIM.
 *
 * Unlike the discovery-service resolver (which swallows a malformed
 * `package.json` because a whole-repo walk must not abort), a single uploaded
 * manifest that fails to parse THROWS {@link NpmManifestParseError} so the
 * route can log + report the drop (no silent drop — Spec 3 cross-cutting rule).
 */
export function resolveNpmManifest(
  rawJson: string,
  manifestPath: string,
): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  if (!rawJson || typeof rawJson !== 'string') {
    throw new NpmManifestParseError('package.json content is empty');
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (err) {
    throw new NpmManifestParseError(
      `package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw new NpmManifestParseError('package.json did not parse to a JSON object');
  }

  for (const key of NPM_DEP_KEYS) {
    const block = pkg[key] as Record<string, unknown> | undefined;
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [name, versionLiteral] of Object.entries(block)) {
      if (typeof versionLiteral !== 'string') continue;
      const versionRange = isNpmRange(versionLiteral) ? versionLiteral : undefined;
      out.push({
        name,
        version: versionLiteral,
        versionRange,
        scope: key,
        manifestPath,
        manifestLine: lineForKey(rawJson, name),
      });
    }
  }

  return out;
}
