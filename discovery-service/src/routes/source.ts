import { Router, Request, Response } from 'express';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { archModelClient } from '../services/archModelClient';
import {
  buildTempDir,
  isGitRepoUrl,
  normalizeRepoLocation,
} from '../services/repoAccess';

/**
 * Source-File Endpoint Route Handler
 *
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/source/...
 *
 * Spec: 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2)
 *  -- Task Group 1 (foundation). Path-design ref: W-12 (repo-relative path
 *  semantics only). Auth posture ref: W-13 (matches the existing
 *  run-scoped routes; no new auth surface introduced). GC fallback ref:
 *  W-17 (structured 410 Gone with `{ error: 'clone_evicted', runId,
 *  message }`; no auto-reclone).
 *
 * Semantics:
 *   - The path captured after `/source/` is REPO-RELATIVE (e.g.
 *     `src/main/java/com/foo/Bar.java`). The clone-root is an
 *     implementation detail callers never see -- it is resolved
 *     server-side from the run's `service_id` (service-scoped) or
 *     `config_snapshot.repos[0].url` (project-scoped), then mapped to
 *     `os.tmpdir()/discovery-<runId>/<repoSlug>/` via {@link buildTempDir}
 *     when the run cloned a remote URL, or used verbatim when the run
 *     was rooted on a local folder path.
 *   - Path traversal (`..` segments) and absolute paths (`/...`,
 *     `<drive>:\...`, `<drive>:/...`) are rejected with `400 Bad
 *     Request`. After computing the absolute resolved path, a final
 *     check requires the resolved path to live under the clone root --
 *     this catches symlink escapes.
 *   - When the cached clone has been garbage-collected (the on-disk
 *     directory no longer exists), the endpoint returns `410 Gone` with
 *     `{ error: 'clone_evicted', runId, message }`. NO fresh git clone
 *     is ever triggered by this route -- it serves only what is already
 *     on disk.
 *   - Non-existent file under a valid clone returns `404 Not Found`.
 *   - Run not present in AMS returns `404 Not Found`.
 *
 * Streaming + per-file size guard:
 *   - File contents are streamed via `fs.createReadStream` so the
 *     full byte payload is never buffered into memory.
 *   - A {@link MAX_SOURCE_FILE_BYTES} cap (10 MB) prevents accidental
 *     fetches of huge artefacts (built jars, video, etc.) from
 *     pinning RAM. Exceeding it returns `413 Payload Too Large`.
 *
 * Diagnostic logging (`[diag-runs] source_fetch ...`):
 *   - Success: `[diag-runs] source_fetch run=<short-id> path=<rel> result=ok bytes=<N>`
 *   - GC'd / clone evicted: `[diag-runs] source_fetch run=<short-id> path=<rel> result=gone`
 *   - File not found: `[diag-runs] source_fetch run=<short-id> path=<rel> result=not_found`
 *   - Invalid (traversal / absolute): `[diag-runs] source_fetch run=<short-id> path=<rel> result=invalid_path`
 *
 * Spec reference path: `agent-os/specs/2026-05-17-soap-llm-extraction-and-payload-enrichment-phase-2/spec.md`
 */

/**
 * Per-file byte cap. 10 MB is well above any reasonable source file
 * (the largest JDK source in OpenJDK is ~250 KB) and well below the
 * point where streaming a single response into memory would matter
 * for the discovery-service process budget.
 */
const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

const sourceRouter = Router({ mergeParams: true });

/**
 * Short-form run id for log lines (full uuid is noisy in logs).
 */
function shortId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

/**
 * Tests whether `candidate` is an absolute path on either POSIX or
 * Windows. We reject all absolute paths -- callers MUST supply
 * repo-relative paths only.
 *
 * - POSIX absolute: leading `/`
 * - Windows drive: `C:\...` / `C:/...` / `\\server\share`
 * - UNC (`\\?\C:\...`): same shape
 */
function isAbsolutePath(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (candidate.startsWith('/') || candidate.startsWith('\\')) return true;
  // Windows drive letter forms: `C:\...` or `C:/...`.
  if (/^[a-zA-Z]:[\\/]/.test(candidate)) return true;
  return false;
}

/**
 * Returns TRUE when any path segment is `..` (parent directory).
 *
 * We could rely on the canonical-path under-clone-root check alone,
 * but rejecting `..` explicitly gives a cleaner 400 response and
 * keeps the diag-log signal crisp.
 */
function containsParentSegment(candidate: string): boolean {
  // Normalise separators for the segment scan only -- we do not
  // mutate the value used for resolution.
  const normalised = candidate.replace(/\\/g, '/');
  const segments = normalised.split('/');
  return segments.some((seg) => seg === '..');
}

/**
 * Resolves the on-disk clone root for a given discovery run.
 *
 * Strategy:
 *   1. Fetch the run from AMS. If absent -> return `{ kind: 'no_run' }`.
 *   2. Determine the repo location:
 *        - service-scoped (run.service_id is non-null): fetch the
 *          service and read `repo_location`.
 *        - project-scoped (no service_id): read
 *          `config_snapshot.repos[0].url`.
 *   3. Normalise via {@link normalizeRepoLocation}. If it is a remote
 *      git URL, compute `buildTempDir(runId, repoLocation)` -- this
 *      is the canonical clone path used by the runManager + Phase 1
 *      executors. If it is a local folder path, use it verbatim.
 *   4. Check that the directory exists on disk. If not -> return
 *      `{ kind: 'evicted', repoLocation }`. We deliberately do NOT
 *      auto-clone or reuse a stale value -- the endpoint serves only
 *      what is already on disk (W-17).
 */
async function resolveCloneRoot(
  projectId: string,
  architectureId: string,
  runId: string,
): Promise<
  | { kind: 'ok'; cloneRoot: string }
  | { kind: 'no_run' }
  | { kind: 'no_repo'; reason: string }
  | { kind: 'evicted' }
> {
  const run = await archModelClient.getDiscoveryRun(projectId, runId, architectureId);
  if (!run) {
    return { kind: 'no_run' };
  }

  let repoLocationRaw: string | null | undefined;
  const runRec = run as unknown as Record<string, unknown>;
  const serviceId = (runRec.service_id as string | null | undefined) ?? null;

  if (serviceId) {
    const service = await archModelClient.getService(projectId, architectureId, serviceId);
    repoLocationRaw = service?.repo_location ?? null;
  } else {
    const configSnapshot = (run.config_snapshot ?? {}) as Record<string, unknown>;
    const repos = configSnapshot.repos as Array<{ url?: string }> | undefined;
    repoLocationRaw = repos && repos.length > 0 ? repos[0].url ?? null : null;
  }

  if (!repoLocationRaw || repoLocationRaw.trim() === '') {
    return { kind: 'no_repo', reason: 'Run has no resolvable repo_location' };
  }

  const repoLocation = normalizeRepoLocation(repoLocationRaw);
  const cloneRoot = isGitRepoUrl(repoLocation)
    ? buildTempDir(runId, repoLocation)
    : repoLocation;

  try {
    const stat = await fs.stat(cloneRoot);
    if (!stat.isDirectory()) {
      return { kind: 'evicted' };
    }
  } catch {
    return { kind: 'evicted' };
  }

  return { kind: 'ok', cloneRoot };
}

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/source/...
 *
 * The path-after-`/source/` is captured via the trailing `*` and
 * resolved repo-relative against the run's clone root.
 */
sourceRouter.get('/:runId/source/*', async (req: Request, res: Response): Promise<void> => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };
  // Express stores the `*` capture under params[0] when the route uses
  // the `*` wildcard. Express 4 returns it as a single string with any
  // additional `/` segments preserved verbatim.
  const rawPath = (req.params as unknown as { 0?: string })[0] ?? '';
  const runShort = shortId(runId);

  // -----------------------------------------------------------------------
  // Step 1: Reject empty paths and obviously invalid paths BEFORE any
  // archmodel calls so traversal attempts produce a fast 400.
  // -----------------------------------------------------------------------
  if (!rawPath || rawPath.trim() === '') {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=<empty> result=invalid_path`,
    );
    res.status(400).json({
      error: 'invalid_path',
      message: 'path is required after /source/',
    });
    return;
  }

  if (isAbsolutePath(rawPath)) {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=invalid_path`,
    );
    res.status(400).json({
      error: 'path_traversal_rejected',
      message: 'absolute paths are not permitted; path must be repo-relative',
    });
    return;
  }

  if (containsParentSegment(rawPath)) {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=invalid_path`,
    );
    res.status(400).json({
      error: 'path_traversal_rejected',
      message: '`..` segments are not permitted in source paths',
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Step 2: Resolve the on-disk clone root via the run row.
  // -----------------------------------------------------------------------
  let resolution: Awaited<ReturnType<typeof resolveCloneRoot>>;
  try {
    resolution = await resolveCloneRoot(projectId, architectureId, runId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[diag-runs] source_fetch run=${runShort} path=${rawPath} result=error msg=${msg}`);
    const status = (error as { response?: { status?: number } })?.response?.status ?? 500;
    res.status(status).json({
      error: 'resolve_failed',
      message: msg,
    });
    return;
  }

  if (resolution.kind === 'no_run') {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=not_found reason=no_run`,
    );
    res.status(404).json({
      error: 'run_not_found',
      message: `Discovery run ${runId} not found`,
    });
    return;
  }

  if (resolution.kind === 'no_repo') {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=not_found reason=no_repo`,
    );
    res.status(404).json({
      error: 'no_repo',
      message: resolution.reason,
    });
    return;
  }

  if (resolution.kind === 'evicted') {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=gone`,
    );
    res.status(410).json({
      error: 'clone_evicted',
      runId,
      message:
        'The cached repository clone for this run has been evicted from disk. ' +
        'Re-run discovery to repopulate the cache.',
    });
    return;
  }

  const cloneRoot = resolution.cloneRoot;

  // -----------------------------------------------------------------------
  // Step 3: Resolve the repo-relative path to an absolute on-disk path and
  // confirm it still lives under the clone root after canonicalisation.
  // This catches symlink escapes (`<cloneRoot>/escape -> /etc/passwd`).
  // -----------------------------------------------------------------------
  const requested = path.resolve(cloneRoot, rawPath);
  const cloneRootCanonical = await fs.realpath(cloneRoot).catch(() => path.resolve(cloneRoot));

  let requestedCanonical: string;
  try {
    requestedCanonical = await fs.realpath(requested);
  } catch (err: unknown) {
    // ENOENT here means the file does not exist -- this is the
    // canonical 404 case, NOT a traversal attempt.
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === 'ENOENT') {
      console.log(
        `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=not_found`,
      );
      res.status(404).json({
        error: 'file_not_found',
        message: `File not found under the run's clone root: ${rawPath}`,
      });
      return;
    }
    // Any other resolution error (EACCES, EMFILE, etc.) -- log and surface
    // the failure mode rather than masking it as a 404.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=error msg=${msg}`,
    );
    res.status(500).json({
      error: 'fs_error',
      message: msg,
    });
    return;
  }

  // Symlink-escape guard: the canonical resolved path MUST be under the
  // canonical clone root. We compare using `path.relative` so the check
  // works across drive letters and POSIX/Windows separator differences.
  const rel = path.relative(cloneRootCanonical, requestedCanonical);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=invalid_path reason=symlink_escape`,
    );
    res.status(400).json({
      error: 'path_traversal_rejected',
      message:
        'The resolved path escapes the run\'s clone root via symlink or absolute resolution.',
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Step 4: Stat the resolved file. Reject directories and files exceeding
  // the per-file cap.
  // -----------------------------------------------------------------------
  let stat;
  try {
    stat = await fs.stat(requestedCanonical);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=error msg=${msg}`,
    );
    res.status(500).json({
      error: 'fs_error',
      message: msg,
    });
    return;
  }

  if (!stat.isFile()) {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=not_found reason=not_a_file`,
    );
    res.status(404).json({
      error: 'file_not_found',
      message: `Path is not a regular file: ${rawPath}`,
    });
    return;
  }

  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    console.log(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=too_large bytes=${stat.size}`,
    );
    res.status(413).json({
      error: 'file_too_large',
      message: `File size ${stat.size} bytes exceeds the per-file cap of ${MAX_SOURCE_FILE_BYTES} bytes`,
    });
    return;
  }

  // -----------------------------------------------------------------------
  // Step 5: Stream the file contents back to the caller.
  // -----------------------------------------------------------------------
  console.log(
    `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=ok bytes=${stat.size}`,
  );
  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(stat.size));

  const stream = createReadStream(requestedCanonical);
  stream.on('error', (err) => {
    // Headers may already be sent here. Best-effort: end the response.
    console.error(
      `[diag-runs] source_fetch run=${runShort} path=${rawPath} result=stream_error msg=${err.message}`,
    );
    if (!res.headersSent) {
      res.status(500).json({ error: 'stream_error', message: err.message });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

export { sourceRouter };
