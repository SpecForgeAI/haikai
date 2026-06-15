/**
 * Project Name Sanitiser — Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write
 * (Spec 2026-05-25, Task Group 1).
 *
 * Centralises the defensive sanitisation applied to the AMS Project DTO's
 * `project.name` value before it is concatenated into a filesystem path. The
 * tech-stack loader, the close-turn writer, and the new target-tech-stack
 * context resolver all import this helper so the rejection rules stay aligned
 * across the three call sites.
 *
 * Per the spec Follow-up A there is no `project_folder` column on the AMS
 * Project entity; the project's sub-folder under the organisation root is
 * derived from `project.name` verbatim. To prevent path-traversal escapes from
 * the organisation root (the AMS DTO field `project_parent_folder` IS the
 * organisation root per audit finding 1), the helper rejects any value
 * containing `..`, `/`, or `\`.
 *
 * Plain-English error messages — no invented acronyms (per
 * `feedback_no_invented_acronyms.md`).
 */

/**
 * Thrown when a candidate `project.name` value contains a character or
 * sub-sequence that could escape the organisation folder when concatenated
 * into a filesystem path. Callers catch this and surface a clean error to the
 * conversation transcript / banner without ever attempting the file read or
 * write.
 */
export class InvalidProjectFolderNameError extends Error {
  public readonly projectName: string;
  public readonly offendingToken: string;

  constructor(projectName: string, offendingToken: string) {
    super(
      `Project name "${projectName}" cannot be used as a folder name because it contains "${offendingToken}". ` +
        `Path-traversal characters ("..", "/", "\\") are not allowed.`,
    );
    this.name = 'InvalidProjectFolderNameError';
    this.projectName = projectName;
    this.offendingToken = offendingToken;
  }
}

/**
 * Returns the input `project.name` verbatim when safe, or throws an
 * {@link InvalidProjectFolderNameError} when it contains any of the three
 * forbidden tokens.
 *
 * Forbidden tokens:
 *   - `..`  (parent-directory traversal)
 *   - `/`   (POSIX path separator)
 *   - `\\`  (Windows path separator)
 *
 * Empty / whitespace-only names are also rejected — they cannot resolve to a
 * usable folder name on either operating system.
 *
 * @param name the raw `project.name` value from the AMS Project DTO
 * @returns the same name string when safe
 * @throws InvalidProjectFolderNameError when the name contains a forbidden
 *         token or is empty after trimming.
 */
export function sanitiseProjectName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new InvalidProjectFolderNameError(String(name), '<empty>');
  }
  if (name.includes('..')) {
    throw new InvalidProjectFolderNameError(name, '..');
  }
  if (name.includes('/')) {
    throw new InvalidProjectFolderNameError(name, '/');
  }
  if (name.includes('\\')) {
    throw new InvalidProjectFolderNameError(name, '\\');
  }
  return name;
}
