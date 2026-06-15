/**
 * Library Source Resolver
 *
 * Spec 2026-05-20 Discovery Library-Scoped Run Fixes — Task Group 2a.
 *
 * Resolves the on-disk source directory for an internal library
 * dependency declared by a service or library. The original walker
 * implementation assumed every internal library lived as a subfolder
 * of the root repo (`<rootRepoDir>/<repoSubfolder>`), which only holds
 * for multi-module repos. Many real layouts (e.g. `hifi-core`,
 * `hifi-db` siblings of the main service repo) keep each library in
 * its own sibling folder.
 *
 * This module implements a two-stage resolution:
 *
 *   1. **Subfolder-first.** If `<rootRepoDir>/<repoSubfolder>` exists
 *      AND contains a build manifest, return that.
 *   2. **Sibling-folder fallback.** Walk the immediate children of
 *      `dirname(rootRepoDir)` and inspect each one's build manifest:
 *        - MAVEN: pom.xml's `<groupId>` AND `<artifactId>` (project-
 *          level, NOT inherited) must equal the two halves of
 *          `libraryName` ("groupId:artifactId").
 *        - NPM:   package.json's `name` field must equal `libraryName`.
 *      Multiple matches are all returned with a warning; the caller
 *      decides what to do (in the run manager we scan each in turn).
 *   3. **No match** → empty array.
 *
 * v1 limitations:
 *   - Maven: the project's `<groupId>` must be explicit; inherited
 *     groupIds from a `<parent>` block are NOT walked for v1. The
 *     overwhelming majority of internal libraries declare their own
 *     groupId, so this is a deliberate simplification.
 *   - We do NOT recurse into nested folders looking for manifests; only
 *     the immediate sibling of `rootRepoDir` is inspected. Repos
 *     organised in `parent/{repo-a,repo-b}` are supported; deeper
 *     layouts (e.g. `parent/team/{repo-a,repo-b}`) require manual
 *     repo_location override on the Library row.
 *   - The "looks like a source dir" heuristic for the subfolder path
 *     is that the folder simply exists AND has its manifest file. We
 *     do NOT validate that any `*.java` / `*.ts` files are present;
 *     `executeLlmFileAnalysis` will surface that downstream as
 *     `filesAnalyzed=0`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * One resolved source-dir candidate. The run manager iterates the
 * returned array, calling `executeLlmFileAnalysis` for each in turn
 * (a single resolved entry is the common case).
 */
export interface ResolvedLibrarySource {
  /** Absolute path to the library's source root. */
  sourceDir: string;
  /** Absolute path to the build manifest (pom.xml / package.json) that matched. */
  manifestPath: string;
  /** Which strategy produced this result. */
  matchKind: 'subfolder' | 'sibling-folder';
}

/**
 * Checks whether a directory exists on disk.
 */
async function dirExists(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(dir);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Checks whether a file exists on disk.
 */
async function fileExists(file: string): Promise<boolean> {
  try {
    const st = await fs.stat(file);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Reads pom.xml and tests whether the project-level identity matches the
 * supplied groupId:artifactId. The strategy is to strip nested
 * `<dependencies>` / `<dependencyManagement>` / `<plugins>` /
 * `<pluginManagement>` blocks before regex-matching so dependency
 * declarations don't false-match.
 *
 * v1 limitation: inherited groupId via `<parent>` is NOT walked. If the
 * project pom has no top-level `<groupId>`, we look at the `<parent>`
 * block's `<groupId>` as a single-step fallback only.
 */
async function pomMatches(
  pomPath: string,
  groupId: string,
  artifactId: string,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(pomPath, 'utf-8');
  } catch {
    return false;
  }

  // Limit to the <project>...</project> scope.
  const projectMatch = raw.match(/<project\b[^>]*>([\s\S]*?)<\/project>/);
  const projectScope = projectMatch ? projectMatch[1] : raw;

  // Capture parent groupId BEFORE stripping the <parent> block (used as a
  // single-step fallback when the project has no top-level <groupId>).
  const parentMatch = projectScope.match(/<parent\b[^>]*>([\s\S]*?)<\/parent>/);
  const parentGroupIdMatch = parentMatch
    ? parentMatch[1].match(/<groupId>([^<]+)<\/groupId>/)
    : null;
  const parentGroupId = parentGroupIdMatch ? parentGroupIdMatch[1].trim() : null;

  // Strip nested blocks so we only see the project's OWN identity tags.
  let scrubbed = projectScope;
  scrubbed = scrubbed.replace(/<parent\b[\s\S]*?<\/parent>/g, '');
  scrubbed = scrubbed.replace(/<dependencyManagement\b[\s\S]*?<\/dependencyManagement>/g, '');
  scrubbed = scrubbed.replace(/<dependencies\b[\s\S]*?<\/dependencies>/g, '');
  scrubbed = scrubbed.replace(/<build\b[\s\S]*?<\/build>/g, '');
  scrubbed = scrubbed.replace(/<pluginManagement\b[\s\S]*?<\/pluginManagement>/g, '');
  scrubbed = scrubbed.replace(/<plugins\b[\s\S]*?<\/plugins>/g, '');
  scrubbed = scrubbed.replace(/<profiles\b[\s\S]*?<\/profiles>/g, '');
  scrubbed = scrubbed.replace(/<modules\b[\s\S]*?<\/modules>/g, '');

  const gidMatch = scrubbed.match(/<groupId>([^<]+)<\/groupId>/);
  const aidMatch = scrubbed.match(/<artifactId>([^<]+)<\/artifactId>/);

  const effectiveGroupId = (gidMatch ? gidMatch[1] : parentGroupId ?? '').trim();
  const effectiveArtifactId = (aidMatch ? aidMatch[1] : '').trim();

  return effectiveGroupId === groupId && effectiveArtifactId === artifactId;
}

/**
 * Reads package.json and tests whether the `name` field equals
 * `libraryName`.
 */
async function npmManifestMatches(
  packageJsonPath: string,
  libraryName: string,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(packageJsonPath, 'utf-8');
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.name === 'string' && parsed.name === libraryName;
  } catch {
    return false;
  }
}

/**
 * Returns the manifest file name for the ecosystem.
 */
function manifestFileFor(ecosystem: 'MAVEN' | 'NPM'): string {
  return ecosystem === 'MAVEN' ? 'pom.xml' : 'package.json';
}

/**
 * Resolves the on-disk source directory for an internal library
 * dependency.
 *
 * @param libraryName    The library's coordinate. MAVEN: "groupId:artifactId"
 *                       (e.g. "com.rbs.mib.risk.hifi:hifi-core"). NPM: the
 *                       package name (e.g. "@org/pkg" or "pkg").
 * @param repoSubfolder  The repo-subfolder hint captured by the walker
 *                       (e.g. "hifi-core" or "" for repo root).
 * @param rootRepoDir    Absolute path to the root entity's cloned/local repo.
 * @param ecosystem      'MAVEN' or 'NPM'.
 * @returns An array of resolved source dirs (empty when no match).
 *          When multiple sibling folders match, all are returned and the
 *          caller is expected to log a warning and scan each in turn.
 */
export async function resolveLibrarySource(
  libraryName: string,
  repoSubfolder: string,
  rootRepoDir: string,
  ecosystem: 'MAVEN' | 'NPM',
): Promise<ResolvedLibrarySource[]> {
  const manifestFile = manifestFileFor(ecosystem);
  const results: ResolvedLibrarySource[] = [];

  // ---------------------------------------------------------------
  // Stage 1: subfolder-first.
  //
  // Existing behaviour: if the library is a multi-module child of the
  // root repo, its source lives at <rootRepoDir>/<repoSubfolder>. We
  // accept this match when the directory exists AND the expected
  // manifest file is present.
  // ---------------------------------------------------------------
  if (repoSubfolder && repoSubfolder.length > 0) {
    const subfolderDir = path.resolve(rootRepoDir, repoSubfolder);
    const subfolderManifest = path.join(subfolderDir, manifestFile);
    if (await dirExists(subfolderDir) && await fileExists(subfolderManifest)) {
      results.push({
        sourceDir: subfolderDir,
        manifestPath: subfolderManifest,
        matchKind: 'subfolder',
      });
      return results;
    }
  }

  // ---------------------------------------------------------------
  // Stage 2: sibling-folder fallback.
  //
  // Walk the immediate children of dirname(rootRepoDir) and check
  // each one's manifest for an identity match.
  // ---------------------------------------------------------------
  const parentDir = path.dirname(rootRepoDir);
  if (!(await dirExists(parentDir))) return results;

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch {
    return results;
  }

  // Pre-split libraryName for MAVEN.
  let groupId = '';
  let artifactId = '';
  if (ecosystem === 'MAVEN') {
    const colon = libraryName.indexOf(':');
    if (colon < 0) return results; // malformed coordinate; bail.
    groupId = libraryName.substring(0, colon);
    artifactId = libraryName.substring(colon + 1);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Don't re-match the root repo itself.
    const siblingDir = path.join(parentDir, entry.name);
    if (path.resolve(siblingDir) === path.resolve(rootRepoDir)) continue;

    const siblingManifest = path.join(siblingDir, manifestFile);
    if (!(await fileExists(siblingManifest))) continue;

    let isMatch = false;
    if (ecosystem === 'MAVEN') {
      isMatch = await pomMatches(siblingManifest, groupId, artifactId);
    } else {
      isMatch = await npmManifestMatches(siblingManifest, libraryName);
    }

    if (isMatch) {
      results.push({
        sourceDir: siblingDir,
        manifestPath: siblingManifest,
        matchKind: 'sibling-folder',
      });
    }
  }

  if (results.length > 1) {
    console.warn(
      `[librarySourceResolver] Multiple sibling-folder matches for '${libraryName}' under '${parentDir}': ` +
        results.map((r) => r.sourceDir).join(', '),
    );
  }

  return results;
}
