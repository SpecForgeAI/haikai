/**
 * Spec Intent Sanitization Utility
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task 2.5: Implement spec intent newline sanitization
 *
 * Provides utility for sanitizing spec intent messages before sending to the API.
 * Removes newlines and collapses whitespace to ensure single-line messages.
 */

/**
 * Sanitize a spec intent message for API transmission.
 *
 * Algorithm:
 * 1. Replace all newline variants (\r\n, \n, \r) with single space
 * 2. Collapse repeated/consecutive spaces into single space
 * 3. Trim leading and trailing spaces
 *
 * The resulting string is guaranteed to be:
 * - Completely newline-free
 * - No consecutive whitespace
 * - No leading/trailing whitespace
 *
 * @param input - The spec intent message to sanitize
 * @returns The sanitized single-line message
 *
 * @example
 * sanitizeSpecIntent("/shape-spec ## Feature\nDescription\n\n## Scope")
 * // returns "/shape-spec ## Feature Description ## Scope"
 */
export function sanitizeSpecIntent(input: string): string {
  // Handle null/undefined -> empty string
  if (input == null) {
    return '';
  }

  // Replace all newline variants with space, collapse whitespace, trim
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
