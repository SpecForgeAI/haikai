/**
 * NpmDependencyResolver
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * Walks all `package.json` files under a cloned repo and emits one
 * {@link DeclaredDependency} per declared package across the four
 * source-keys (`dependencies`, `devDependencies`, `peerDependencies`,
 * `optionalDependencies`). npm workspaces work automatically — every
 * workspace package.json is a separate manifest hit.
 *
 * Locked contract (Spec 2026-05-06):
 *   - `name` = full string including `@scope/` prefix when scoped.
 *     NO normalisation V1.
 *   - `version` stored verbatim (e.g. `^1.2.3`, `~1.2.0`, `1.2.3`,
 *     `>=1.0.0 <2.0.0`, `*`, `latest`, github / file URLs).
 *   - `versionRange` populated when the version literal contains a
 *     range operator (`^`, `~`, `>=`, `>`, `<=`, `<`, `*`, `||`,
 *     ` `, `-`); `version` remains set verbatim per locked contract.
 *   - `scope` is the source-key verbatim (`'dependencies'`, etc).
 *   - Walker exclusions: `node_modules/`, `target/`, `build/`, `dist/`,
 *     `out/`, `.git/`, `.gradle/`. `node_modules/` exclusion is
 *     critical — without it the walker recurses into every transitive
 *     vendored package.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DependencyResolver,
  DeclaredDependency,
  ManifestCoordinates,
} from '../types';
import { walkForManifest } from '../maven/MavenDependencyResolver';

const NPM_DEP_KEYS: Array<
  'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'
> = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Detects npm version-range syntax. A pinned semver literal like
 * `1.2.3` returns false; `^1.2.3`, `~1.0.0`, `>=1.0`, `*`, ranges
 * with spaces / hyphens / `||` all return true.
 */
function isNpmRange(value: string): boolean {
  if (value.length === 0) return false;
  // Common range prefixes / wildcards.
  if (/^[\^~*]/.test(value)) return true;
  if (/^[<>]=?/.test(value)) return true;
  // Wildcard segment (1.x, 1.2.x), spaces, hyphen ranges, or `||` OR-clauses.
  if (/(\s|\|\|| - )/.test(value)) return true;
  if (/\.x(\b|$)/i.test(value)) return true;
  // Tag specifiers like `latest` are not version ranges per locked contract,
  // but they're not pinned either; we conservatively store them as `version`.
  return false;
}

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.replace(/\\/g, '/');
}

/**
 * Best-effort 1-based line number for the FIRST appearance of the
 * literal `"name":` (e.g. `"react":`) in the raw JSON text. Used to
 * populate `manifestLine` on emitted entries.
 */
function lineForKey(content: string, depName: string): number | undefined {
  // Match `"<depName>"` followed by optional whitespace and a colon.
  // Escape regex metacharacters in `depName` defensively.
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

export class NpmDependencyResolver implements DependencyResolver {
  getEcosystem(): 'NPM' {
    return 'NPM';
  }

  async findManifests(repoRoot: string): Promise<string[]> {
    const found: string[] = [];
    await walkForManifest(repoRoot, 'package.json', found);
    return found;
  }

  async resolve(
    repoRoot: string,
    manifestPath: string,
  ): Promise<DeclaredDependency[]> {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const relPath = toRepoRelative(repoRoot, manifestPath);
    const out: DeclaredDependency[] = [];

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Malformed package.json — skip silently. The walker is best-
      // effort and a single bad file must not abort the whole run.
      return out;
    }

    for (const key of NPM_DEP_KEYS) {
      const block = pkg[key] as Record<string, unknown> | undefined;
      if (!block || typeof block !== 'object') continue;
      for (const [name, versionLiteral] of Object.entries(block)) {
        if (typeof versionLiteral !== 'string') continue;
        const versionRange = isNpmRange(versionLiteral) ? versionLiteral : undefined;
        out.push({
          name,
          version: versionLiteral,
          versionRange,
          scope: key,
          manifestPath: relPath,
          manifestLine: lineForKey(raw, name),
        });
      }
    }

    return out;
  }

  async extractCoordinates(
    repoRoot: string,
    manifestPath: string,
  ): Promise<ManifestCoordinates | null> {
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      return null;
    }
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    const name = pkg.name;
    if (typeof name !== 'string' || name.length === 0) return null;

    const subfolder = path
      .dirname(toRepoRelative(repoRoot, manifestPath))
      .replace(/\\/g, '/');
    return {
      ecosystem: 'NPM',
      name,
      subfolder: subfolder === '.' ? '' : subfolder,
    };
  }
}

export const npmDependencyResolver = new NpmDependencyResolver();
