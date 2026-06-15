/**
 * Common Exception Suggestions
 * Spec: Method Parameters/Returns/Throws Type-Oriented Input
 *
 * Provides optional, non-enforcing exception type suggestions for the
 * Throws field in the Methods grid editor. These are combined with
 * entity-derived suggestions from logical/physical data entities.
 */

/**
 * COMMON_EXCEPTION_SUGGESTIONS - suggested exception types for Method throws fields.
 * These are displayed as typeahead suggestions in the grid editor but do not
 * restrict the user from entering custom values.
 *
 * Common Java/general exception types that architects frequently use.
 */
export const COMMON_EXCEPTION_SUGGESTIONS: string[] = [
  'RuntimeException',
  'IllegalArgumentException',
  'IllegalStateException',
  'NullPointerException',
  'Exception',
];
