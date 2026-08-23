/**
 * Discovery Run Log Service
 *
 * Spec 2026-05-10 Runtime Log Input at Discovery Run Start -- Task Group 2
 *
 * Persists user-uploaded runtime log files for a discovery run to the project
 * folder on disk and PATCHes the architecture-model-service to record
 * lightweight metadata references on the run row's
 * `config_snapshot.inputArtifacts.logFiles[]` JSONB array.
 *
 * On-disk layout (mirrors discoveryInsightsService project-folder pattern):
 *   {projectFolder}/discovery-runs/{runId}/logs/{sanitizedOriginalFileName}
 *
 * Sanitisation rules (per spec):
 *   - strip path separators '/' and '\\'
 *   - strip control chars (\x00-\x1F, \x7F)
 *   - collapse whitespace runs to a single underscore
 *   - preserve original extension
 *   - reject if sanitised name is empty
 *
 * Within one batch, on filename collision the base name is suffixed with
 * ' (2)', ' (3)', ... before the extension.
 *
 * Failure semantics:
 *   - any disk-write failure aborts the batch; the AMS PATCH is NOT called;
 *     a structured DiskWriteError is thrown.
 *   - AMS PATCH failure is surfaced upstream (the run is NOT rolled back; the
 *     frontend renders a warning chip / toast per spec).
 *
 * The `fs` and `architectureModelClient` modules are imported at module scope
 * so Jest can swap them for mocks (same seam as discoveryInsightsService).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  fetchProjectFolder,
  patchDiscoveryRunLogFileArtifacts,
  LogFileMeta,
} from './architectureModelClient';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of the multer File shape this service consumes. Kept minimal so
 * tests can fabricate plain objects without depending on multer's typings.
 */
export interface UploadFile {
  originalname: string;
  size: number;
  mimetype: string;
  buffer: Buffer;
}

export interface WriteLogFilesArgs {
  projectId: string;
  architectureId: string;
  runId: string;
  files: UploadFile[];
  attemptedCount: number;
  /**
   * Spec 2026-05-11 Section 1: optional runtime-evidence config rider.
   * When present, the gateway forwards this object as a sibling key
   * on the AMS log-files PATCH body so AMS can merge
   * `config_snapshot.runtimeEvidenceConfig` atomically with the
   * `inputArtifacts.logFiles[]` merge.
   */
  runtimeEvidenceConfig?: { maxLogPathPrefixSegments?: number; logPatternHint?: string };
}

export interface WriteLogFilesResult {
  logFiles: LogFileMeta[];
  attemptedCount: number;
  successfulCount: number;
}

/**
 * Thrown when project folder resolution fails. Caller should map to 500.
 */
export class ProjectFolderResolutionError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`Failed to resolve project folder for projectId=${projectId}`);
    this.name = 'ProjectFolderResolutionError';
    this.projectId = projectId;
  }
}

/**
 * Thrown when sanitisation produces an empty filename. Caller should map to
 * 400 (one bad file in the batch fails the whole upload, per spec).
 */
export class InvalidFileNameError extends Error {
  readonly originalFileName: string;
  constructor(originalFileName: string) {
    super(`Sanitised filename is empty for originalFileName=${JSON.stringify(originalFileName)}`);
    this.name = 'InvalidFileNameError';
    this.originalFileName = originalFileName;
  }
}

/**
 * Thrown when an `fs.mkdir` / `fs.writeFile` call fails. The PATCH is NOT
 * called when this is thrown.
 */
export class DiskWriteError extends Error {
  readonly failedFileName: string;
  readonly cause: unknown;
  constructor(failedFileName: string, cause: unknown) {
    super(`Disk write failed for ${failedFileName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DiskWriteError';
    this.failedFileName = failedFileName;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitises an uploaded file's original name per spec rules.
 *
 * Rules:
 *   - strip path separators '/' and '\\'
 *   - strip control chars (\x00-\x1F, \x7F)
 *   - collapse internal whitespace runs to a single underscore
 *   - preserve original extension
 *
 * Returns null when the resulting base name is empty (caller maps to 400).
 *
 * Note: extension is detected by the LAST `.` in the (control-stripped, slash-
 * stripped) name, then re-attached to the sanitised base.
 */
export function sanitiseFileName(originalName: string): string | null {
  if (!originalName) return null;

  // Step 1: strip path separators and control characters first so a trailing
  // path-fragment like "foo/bar.log" becomes "foobar.log" before extension
  // detection. NOTE: we use a character-class regex (no eslint-disable needed
  // for the literal control-char range).
  // eslint-disable-next-line no-control-regex
  const cleaned = originalName.replace(/[\\/\x00-\x1F\x7F]/g, '');

  if (cleaned.trim().length === 0) return null;

  // Step 2: detect extension on the cleaned form.
  const lastDot = cleaned.lastIndexOf('.');
  let base: string;
  let ext: string;
  if (lastDot > 0 && lastDot < cleaned.length - 1) {
    base = cleaned.slice(0, lastDot);
    ext = cleaned.slice(lastDot); // includes the dot
  } else {
    base = cleaned;
    ext = '';
  }

  // Step 3: collapse whitespace runs in base to single underscore.
  const collapsedBase = base.replace(/\s+/g, '_');

  // Step 4: trim leading/trailing underscores left over from whitespace at
  // the edges (e.g. "  hello  .log" -> "_hello_.log" without trim; trimming
  // makes "hello.log").
  const trimmedBase = collapsedBase.replace(/^_+|_+$/g, '');

  if (trimmedBase.length === 0) return null;

  return trimmedBase + ext;
}

/**
 * Splits a (already-sanitised) filename into [base, extension-with-dot].
 * Used by the collision-suffixing helper.
 */
function splitNameExt(sanitisedName: string): { base: string; ext: string } {
  const lastDot = sanitisedName.lastIndexOf('.');
  if (lastDot > 0 && lastDot < sanitisedName.length - 1) {
    return {
      base: sanitisedName.slice(0, lastDot),
      ext: sanitisedName.slice(lastDot),
    };
  }
  return { base: sanitisedName, ext: '' };
}

/**
 * Applies the ' (2)', ' (3)', ... suffix rule to resolve filename collisions
 * within a single upload batch. `usedNames` is a Set of names already taken
 * earlier in this batch; the caller is responsible for adding the returned
 * value to the Set.
 */
export function resolveCollisionSuffix(
  sanitisedName: string,
  usedNames: Set<string>
): string {
  if (!usedNames.has(sanitisedName)) {
    return sanitisedName;
  }
  const { base, ext } = splitNameExt(sanitisedName);
  let counter = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${base} (${counter})${ext}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

// ---------------------------------------------------------------------------
// Main entry: write all files to disk, then PATCH AMS
// ---------------------------------------------------------------------------

/**
 * Writes each uploaded file to `{projectFolder}/discovery-runs/{runId}/logs/`
 * and, on full batch success, PATCHes the AMS endpoint with a `LogFileMeta[]`
 * payload.
 *
 * Throws (caller maps to HTTP):
 *   - InvalidFileNameError       -> 400 (sanitised name was empty for one file)
 *   - ProjectFolderResolutionError -> 500
 *   - DiskWriteError             -> 500 (PATCH NOT called)
 *   - ArchitectureModelHttpError -> upstream status forwarded
 */
export async function writeLogFilesAndPatchRun(
  args: WriteLogFilesArgs
): Promise<WriteLogFilesResult> {
  const { projectId, architectureId, runId, files, attemptedCount, runtimeEvidenceConfig } =
    args;

  if (files.length === 0) {
    // Caller (route) is expected to 400 before we get here, but be defensive.
    return { logFiles: [], attemptedCount, successfulCount: 0 };
  }

  // 1. Resolve project folder.
  const projectFolder = await fetchProjectFolder(projectId);
  if (!projectFolder) {
    logger.warn('Cannot write log files: fetchProjectFolder returned null', {
      projectId,
    });
    throw new ProjectFolderResolutionError(projectId);
  }

  // 2. Sanitise + collision-resolve all names BEFORE touching disk so that an
  //    InvalidFileNameError aborts before any side-effects.
  const usedNames = new Set<string>();
  const planned: Array<{ file: UploadFile; finalName: string }> = [];
  for (const file of files) {
    const sanitised = sanitiseFileName(file.originalname);
    if (sanitised === null) {
      throw new InvalidFileNameError(file.originalname);
    }
    const finalName = resolveCollisionSuffix(sanitised, usedNames);
    usedNames.add(finalName);
    planned.push({ file, finalName });
  }

  // 3. Ensure the logs directory exists, then write each file in order.
  const logsDir = path.join(projectFolder, 'discovery-runs', runId, 'logs');
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch (mkdirErr) {
    throw new DiskWriteError(`<mkdir ${logsDir}>`, mkdirErr);
  }

  const written: LogFileMeta[] = [];
  for (const { file, finalName } of planned) {
    const absolutePath = path.join(logsDir, finalName);
    try {
      await fs.writeFile(absolutePath, file.buffer);
    } catch (writeErr) {
      // Per spec: on any disk-write failure, do NOT call PATCH.
      logger.error('Disk write failed for discovery-run log file', {
        projectId,
        architectureId,
        runId,
        finalName,
        absolutePath,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
      throw new DiskWriteError(finalName, writeErr);
    }

    const fileExtension = (() => {
      const dot = finalName.lastIndexOf('.');
      return dot >= 0 ? finalName.slice(dot).toLowerCase() : '';
    })();

    // relativePath is project-folder-rooted (NOT absolute). Use forward
    // slashes regardless of host OS so the JSONB record is portable.
    const relativePath = `discovery-runs/${runId}/logs/${finalName}`;

    written.push({
      artifactId: uuidv4(),
      originalFileName: finalName,
      sizeBytes: file.size,
      fileExtension,
      contentType: file.mimetype,
      uploadedAtIso: new Date().toISOString(),
      relativePath,
    });
  }

  // 4. PATCH AMS. If this fails the run is NOT rolled back -- the frontend
  //    will render a partial-attach warning chip the next time the run row is
  //    fetched. We propagate the upstream error (typically
  //    ArchitectureModelHttpError) so the route handler can forward the
  //    status / body to the caller.
  await patchDiscoveryRunLogFileArtifacts(projectId, architectureId, runId, {
    logFiles: written,
    attemptedCount,
    ...(runtimeEvidenceConfig !== undefined ? { runtimeEvidenceConfig } : {}),
  });

  logger.info('Discovery-run log files written and AMS patched', {
    projectId,
    architectureId,
    runId,
    successfulCount: written.length,
    attemptedCount,
  });

  return {
    logFiles: written,
    attemptedCount,
    successfulCount: written.length,
  };
}
