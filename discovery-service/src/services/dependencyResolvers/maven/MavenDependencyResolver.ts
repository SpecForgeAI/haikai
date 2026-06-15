/**
 * MavenDependencyResolver
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * Walks all `pom.xml` files under a cloned repo and emits one
 * {@link DeclaredDependency} per `<dependency>` block. Multi-module
 * aggregator poms work automatically — each `<module>` directory has
 * its own `pom.xml` which is independently parsed and registered in
 * the lookup table.
 *
 * Locked contract (Spec 2026-05-06):
 *   - `name = "groupId:artifactId"`.
 *   - `version` stored verbatim, including unresolved `${propname}`
 *     placeholders. NO property resolution V1.
 *   - Range syntax `[a,b)` → `versionRange` verbatim, `version` left
 *     undefined.
 *   - `scope` defaults to `compile` when omitted; `<optional>true</optional>`
 *     maps to `scope='optional'`.
 *   - Walker exclusions: `node_modules/`, `target/`, `build/`, `dist/`,
 *     `out/`, `.git/`, `.gradle/`.
 *
 * No XML library — a focused regex parser handles the small surface
 * area (`<dependency>` block, child element extraction). The pom DTD
 * is forgiving enough that this matches every well-formed pom.xml; a
 * future ecosystem with richer XML needs (e.g. .NET csproj) can swap
 * in xml2js without changing the resolver contract.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DependencyResolver,
  DeclaredDependency,
  ManifestCoordinates,
  DEPENDENCY_WALKER_EXCLUDED_DIRS,
} from '../types';

const MAVEN_RANGE_PREFIX = /^[\[\(]/;
const MAVEN_RANGE_HAS_COMMA = /,/;

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  return rel.replace(/\\/g, '/');
}

/**
 * Extracts the textual content of the first occurrence of `<tag>...</tag>`
 * inside `block`. Returns trimmed inner text, or undefined when the tag
 * is absent. Comments and CDATA are not stripped — caller responsibility.
 */
function extractTag(block: string, tag: string): string | undefined {
  // Capture content between <tag> and </tag>. Non-greedy so nested-ish
  // text doesn't bleed across tags. Pom child tags are always simple
  // text values for the fields we care about (groupId, artifactId,
  // version, scope, optional) so this is sufficient.
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'i');
  const match = block.match(re);
  return match ? match[1].trim() : undefined;
}

/**
 * Best-effort 1-based line number for a 0-based byte offset within
 * the original file content. Used to populate `manifestLine` on
 * {@link DeclaredDependency} entries.
 */
function lineForOffset(content: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Maven version-range detection per locked contract: a value beginning
 * with `[` or `(` AND containing a comma is a range; everything else
 * (including unresolved `${propname}` placeholders) is stored as
 * `version` verbatim.
 */
function isMavenRange(value: string): boolean {
  return MAVEN_RANGE_PREFIX.test(value) && MAVEN_RANGE_HAS_COMMA.test(value);
}

export class MavenDependencyResolver implements DependencyResolver {
  getEcosystem(): 'MAVEN' {
    return 'MAVEN';
  }

  async findManifests(repoRoot: string): Promise<string[]> {
    const found: string[] = [];
    await walkForManifest(repoRoot, 'pom.xml', found);
    return found;
  }

  async resolve(
    repoRoot: string,
    manifestPath: string,
  ): Promise<DeclaredDependency[]> {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const relPath = toRepoRelative(repoRoot, manifestPath);
    const out: DeclaredDependency[] = [];

    // Match every `<dependency>...</dependency>` block, capturing both
    // the inner text and the byte offset (for best-effort line tracking).
    const blockRe = /<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g;
    let match: RegExpExecArray | null;

    // We must skip dependencies inside `<dependencyManagement>` blocks —
    // those are version-pinning declarations, not actual deps. Identify
    // the byte ranges of dependencyManagement blocks first.
    const managementRanges: Array<[number, number]> = [];
    const mgmtRe = /<dependencyManagement\b[^>]*>([\s\S]*?)<\/dependencyManagement>/g;
    let mgmtMatch: RegExpExecArray | null;
    while ((mgmtMatch = mgmtRe.exec(raw)) !== null) {
      managementRanges.push([mgmtMatch.index, mgmtMatch.index + mgmtMatch[0].length]);
    }

    while ((match = blockRe.exec(raw)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Skip if this dependency block is inside a dependencyManagement section.
      const inManagement = managementRanges.some(([s, e]) => start >= s && end <= e);
      if (inManagement) continue;

      const block = match[1];
      const groupId = extractTag(block, 'groupId');
      const artifactId = extractTag(block, 'artifactId');
      if (!groupId || !artifactId) {
        // Skip malformed entries.
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
        manifestPath: relPath,
        manifestLine: lineForOffset(raw, start),
      });
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

    // Find the project's own groupId / artifactId. These appear at the
    // top level of `<project>`. A Maven module pom may inherit groupId
    // from `<parent>`, so we fall back to <parent><groupId> when the
    // top-level tag is absent.
    const projectMatch = raw.match(/<project\b[^>]*>([\s\S]*?)<\/project>/);
    const projectScope = projectMatch ? projectMatch[1] : raw;

    // Capture the <parent> block (for inherited groupId fallback) BEFORE
    // we strip it from `scrubbed` — otherwise the strip removes the
    // information we need for the inheritance fallback.
    const parentMatch = projectScope.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/);
    const parentGroupId = parentMatch
      ? extractTag(parentMatch[1], 'groupId')
      : undefined;

    // Strip out child blocks that may legitimately contain their own
    // <groupId>/<artifactId> (parent, dependencies, plugins, etc.)
    // BEFORE matching the project-level identity tags. Without stripping
    // <parent>, an inheriting module pom would surface the parent's
    // artifactId / groupId as its own.
    let scrubbed = projectScope;
    scrubbed = scrubbed.replace(/<parent\b[\s\S]*?<\/parent>/g, '');
    scrubbed = scrubbed.replace(/<dependencies\b[\s\S]*?<\/dependencies>/g, '');
    scrubbed = scrubbed.replace(/<dependencyManagement\b[\s\S]*?<\/dependencyManagement>/g, '');
    scrubbed = scrubbed.replace(/<build\b[\s\S]*?<\/build>/g, '');
    scrubbed = scrubbed.replace(/<plugins\b[\s\S]*?<\/plugins>/g, '');
    scrubbed = scrubbed.replace(/<pluginManagement\b[\s\S]*?<\/pluginManagement>/g, '');
    scrubbed = scrubbed.replace(/<profiles\b[\s\S]*?<\/profiles>/g, '');
    scrubbed = scrubbed.replace(/<modules\b[\s\S]*?<\/modules>/g, '');
    scrubbed = scrubbed.replace(/<reporting\b[\s\S]*?<\/reporting>/g, '');

    const directGroupId = extractTag(scrubbed, 'groupId');
    const directArtifactId = extractTag(scrubbed, 'artifactId');

    const groupId = directGroupId ?? parentGroupId;
    const artifactId = directArtifactId;

    if (!groupId || !artifactId) {
      return null;
    }

    const subfolder = path
      .dirname(toRepoRelative(repoRoot, manifestPath))
      .replace(/\\/g, '/');
    return {
      ecosystem: 'MAVEN',
      name: `${groupId}:${artifactId}`,
      subfolder: subfolder === '.' ? '' : subfolder,
    };
  }
}

/**
 * Recursive directory walker that collects every file whose basename
 * matches `wantedBasename`. Skips directory entries listed in
 * {@link DEPENDENCY_WALKER_EXCLUDED_DIRS}.
 *
 * Exported for reuse by other resolvers in the same family (NPM).
 */
export async function walkForManifest(
  dir: string,
  wantedBasename: string,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently. The walker is best-effort
    // and missing dirs (e.g. permissions) must not abort the whole run.
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (DEPENDENCY_WALKER_EXCLUDED_DIRS.includes(entry.name)) continue;
      await walkForManifest(full, wantedBasename, out);
    } else if (entry.isFile() && entry.name === wantedBasename) {
      out.push(full);
    }
  }
}

export const mavenDependencyResolver = new MavenDependencyResolver();
