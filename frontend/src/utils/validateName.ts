/**
 * Shared Name Validation Utility
 *
 * Provides reusable validation for name fields used across
 * CreateProjectModal, ImportProjectSnapshotModal, ExportProjectNameModal,
 * CreateOrganisationModal, and saveUtils.
 *
 * Follows global validation standards:
 * - Client-side for UX: immediate user feedback
 * - Fail early: reject invalid data before processing
 * - Specific error messages: field-specific, actionable
 * - Allowlists over blocklists: define what is allowed
 */

/** Maximum allowed length for name fields */
const MAX_NAME_LENGTH = 200;

/**
 * Characters that are forbidden in names because they are invalid
 * in filesystem paths on Windows, macOS, and Linux.
 *
 * Forbidden: < > : " / \ | ? *
 */
const FORBIDDEN_CHARS_REGEX = /[<>:"/\\|?*]/;

/** Human-readable list of forbidden characters for error messages */
const FORBIDDEN_CHARS_DISPLAY = '< > : " / \\ | ? *';

/**
 * Validates a name field value (project name, organisation name, etc.).
 *
 * Checks (in order):
 * 1. Non-empty after trimming
 * 2. Does not exceed MAX_NAME_LENGTH characters
 * 3. Does not contain forbidden filesystem characters
 *
 * @param value - The raw input value to validate
 * @param fieldLabel - Human-readable field name for error messages (e.g., "Product name")
 * @returns Error message string if invalid, or null if valid
 */
export function validateName(value: string, fieldLabel: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return `${fieldLabel} is required`;
  }

  if (trimmed.length > MAX_NAME_LENGTH) {
    return `${fieldLabel} must be ${MAX_NAME_LENGTH} characters or fewer`;
  }

  if (FORBIDDEN_CHARS_REGEX.test(trimmed)) {
    return `${fieldLabel} cannot contain ${FORBIDDEN_CHARS_DISPLAY}`;
  }

  return null;
}

/**
 * Validates a filename for saving to the backend.
 *
 * Same rules as validateName but with "Filename" as the default label.
 *
 * @param filename - The filename to validate
 * @returns Error message string if invalid, or null if valid
 */
export function validateFilename(filename: string): string | null {
  return validateName(filename, 'Filename');
}

export { MAX_NAME_LENGTH };
