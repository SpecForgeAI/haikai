/**
 * Identifier Normalization Utility
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 *
 * Provides utility for normalizing company/project identifiers before
 * sending to the /api/v1 backend. Ensures consistent identifier formatting
 * regardless of how users enter the names.
 */

/**
 * Normalize an identifier string for API requests.
 *
 * Algorithm:
 * 1. Handle null/undefined -> return empty string
 * 2. Trim leading/trailing whitespace
 * 3. Convert to lowercase
 * 4. Replace one or more consecutive whitespace characters with a single hyphen
 *
 * @param input - The identifier string to normalize
 * @returns The normalized identifier string
 *
 * @example
 * normalizeIdentifier("  Rivvy   Studios  ") // returns "rivvy-studios"
 * normalizeIdentifier("MyCompany") // returns "mycompany"
 * normalizeIdentifier("  Project  ") // returns "project"
 * normalizeIdentifier(null) // returns ""
 * normalizeIdentifier("") // returns ""
 */
export function normalizeIdentifier(input: string): string {
  // Handle null/undefined -> empty string
  if (input == null) {
    return '';
  }

  // Trim, toLowerCase, and replace whitespace runs with single hyphen
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}
