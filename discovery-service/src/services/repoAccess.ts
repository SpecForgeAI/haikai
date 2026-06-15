import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * RepoAccessProvider Interface
 *
 * Abstraction for accessing repository contents. The default implementation
 * clones via git, but alternative modes (pre-cloned local path, sparse
 * checkout, etc.) can be added by implementing this interface.
 */
export interface RepoAccessProvider {
  /**
   * Makes repository contents available at the target directory.
   *
   * @param repoUrl - The repository URL to clone
   * @param branch - The branch to check out
   * @param targetDir - The local directory where the repo should be placed
   * @returns The path to the cloned/available repository root
   */
  cloneRepo(repoUrl: string, branch: string, targetDir: string): Promise<string>;

  /**
   * Cleans up the repository directory after extraction.
   *
   * @param targetDir - The directory to remove
   */
  cleanup(targetDir: string): Promise<void>;
}

/**
 * Detects whether a repo_location value is a remote git repository URL
 * (requiring clone) or a local folder path (used directly).
 *
 * Matches http/https/git@ prefixes. Anything else (absolute local paths,
 * POSIX paths, Windows drive paths like `C:\...` or `C:/...`) is treated
 * as a local filesystem path and must NOT be passed to `git clone`.
 *
 * Deliberately does not accept `file://` — the repo walkers use `fs.readdir`,
 * which takes OS paths, not URLs.
 */
export function isGitRepoUrl(repoLocation: string): boolean {
  return (
    repoLocation.startsWith('http://') ||
    repoLocation.startsWith('https://') ||
    repoLocation.startsWith('git@')
  );
}

/**
 * Normalizes a `repo_location` value so small input quirks don't cascade into
 * silent scan failures or stray clone attempts.
 *
 * For remote URLs (http/https/git@) only whitespace is trimmed — the URL is
 * passed through untouched.
 *
 * For local paths (including `file://` URLs saved accidentally) the function:
 *   - trims whitespace
 *   - strips a leading `file:///` or `file://` prefix
 *   - converts backslashes to forward slashes
 *   - drops any trailing slash (except when the path is just a drive root)
 */
export function normalizeRepoLocation(input: string): string {
  let v = input.trim();
  if (
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('git@')
  ) {
    return v;
  }
  v = v.replace(/^file:\/\/\/?/, '');
  v = v.replace(/\\/g, '/');
  // Drop trailing slashes but preserve a drive root like `c:/` or posix root `/`
  if (v.length > 1 && !/^[a-zA-Z]:\/$/.test(v) && v !== '/') {
    v = v.replace(/\/+$/, '');
  }
  return v;
}

/**
 * Normalizes a `repo_subfolder` value so the walker's relative-path filter
 * (`isUnderIncludePaths`) matches reliably.
 *
 * The subfolder is NOT concatenated onto the scan root — it is used as an
 * `includePaths` prefix against relative file paths. Those relative paths have
 * no leading slash and use forward slashes, so we:
 *   - trim whitespace
 *   - convert backslashes to forward slashes
 *   - strip leading and trailing slashes
 *   - collapse any `./` prefix
 */
export function normalizeRepoSubfolder(input: string): string {
  let v = input.trim();
  v = v.replace(/\\/g, '/');
  v = v.replace(/^\.\/+/, '');
  v = v.replace(/^\/+/, '').replace(/\/+$/, '');
  return v;
}

/**
 * Derives a filesystem-safe slug from a repository URL.
 *
 * @param repoUrl - The repository URL
 * @returns A sanitized slug suitable for directory names
 */
export function repoSlug(repoUrl: string): string {
  // Remove protocol, replace non-alphanumeric chars with dashes, trim dashes
  return repoUrl
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds the temp directory path for a discovery run + repo combination.
 *
 * @param runId - The discovery run UUID
 * @param repoUrl - The repository URL
 * @returns The full path to the temp directory
 */
export function buildTempDir(runId: string, repoUrl: string): string {
  return path.join(os.tmpdir(), `discovery-${runId}`, repoSlug(repoUrl));
}

/**
 * Git Clone RepoAccessProvider
 *
 * Default implementation that uses `git clone --depth 1` via child_process.execFile
 * (not exec, to avoid shell injection) to shallow-clone a repository.
 */
export class GitCloneRepoAccess implements RepoAccessProvider {
  async cloneRepo(repoUrl: string, branch: string, targetDir: string): Promise<string> {
    // Belt-and-braces: refuse to run `git clone` against anything that isn't
    // a recognised remote URL. Local paths (Windows drive paths, POSIX paths,
    // `file://` URLs) must be read directly via fs — see the filesystem
    // branches in techHintsResolver.ts and runManager.ts. A bug that routes a
    // local path here would previously have produced a confusing "Remote
    // branch ... not found" error; we fail fast with a clear message instead.
    if (!isGitRepoUrl(repoUrl)) {
      throw new Error(
        `GitCloneRepoAccess.cloneRepo refused to clone non-URL input: "${repoUrl}". ` +
        `Only http://, https://, and git@ URLs are eligible for cloning. ` +
        `Local paths must be read directly from the filesystem.`,
      );
    }

    // Ensure parent directory exists
    await fs.mkdir(targetDir, { recursive: true });

    try {
      await execFileAsync('git', [
        '-c', 'core.longpaths=true',
        'clone',
        '--depth', '1',
        '-b', branch,
        repoUrl,
        targetDir,
      ], {
        timeout: 120_000, // 2 minutes for clone
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Repos with non-default branch names (e.g. master vs main) raise this
      // error from git. Fall back to cloning whatever the repo's default
      // branch is, so service-scoped runs don't break when the framing
      // config's branch hint is wrong or absent.
      if (/Remote branch .* not found/i.test(msg) || /not a valid object name/i.test(msg)) {
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(targetDir, { recursive: true });
        console.warn(`[GitCloneRepoAccess] Branch "${branch}" not found on ${repoUrl}; retrying with default branch.`);
        await execFileAsync('git', [
          '-c', 'core.longpaths=true',
          'clone',
          '--depth', '1',
          repoUrl,
          targetDir,
        ], {
          timeout: 120_000,
        });
      } else {
        throw e;
      }
    }

    return targetDir;
  }

  async cleanup(targetDir: string): Promise<void> {
    try {
      await fs.rm(targetDir, { recursive: true, force: true });
    } catch (error) {
      // Best-effort cleanup -- log but do not throw
      console.warn(`[Discovery] Failed to clean up temp directory ${targetDir}:`, error);
    }
  }
}

/**
 * Singleton instance of the default git clone repo access provider.
 */
export const gitCloneRepoAccess = new GitCloneRepoAccess();
