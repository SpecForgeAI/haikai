/**
 * Business Logic Type Suggestions
 * Spec: Business Logic Type Suggestions (Non-Enforcing)
 *
 * Provides optional, non-enforcing type suggestions as clickable chips
 * in the Business Logic grid editor to improve authoring speed and
 * consistency while keeping the Type field as unrestricted free text.
 */

/**
 * BUSINESS_LOGIC_TYPE_SUGGESTIONS - suggested types for Business Logic entities.
 * These are displayed as clickable chips in the grid editor but do not
 * restrict the user from entering custom values.
 */
export const BUSINESS_LOGIC_TYPE_SUGGESTIONS: string[] = [
  'Calculation',
  'Validation',
  'Transformation',
  'Policy',
  'Workflow',
  'Aggregation',
  'Pricing',
  'Eligibility',
];
