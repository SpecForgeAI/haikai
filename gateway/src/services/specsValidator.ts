/**
 * Specs Validator for generate_specs intent
 *
 * Spec 2026-01-09: Implement Generate Specs - Iteration 4
 * Task Group 1: Validation logic for generated specs
 *
 * Validates that the OpenAI response for generate_specs intent
 * is a valid JSON array of /agent-os:write-spec commands.
 */

/**
 * Validation result interface
 */
export interface SpecsValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Parsed specs array (only present when valid is true) */
  specs?: string[];
  /** Error message (only present when valid is false) */
  error?: string;
}

/**
 * The required prefix for each spec command
 */
const SPEC_PREFIX = '/agent-os:write-spec';

/**
 * Validates the content of a generate_specs response from OpenAI.
 *
 * Validation rules:
 * 1. Content must be valid JSON
 * 2. Parsed result must be an array
 * 3. Array must not be empty
 * 4. Each element must be a non-empty string
 * 5. Each string must start with /agent-os:write-spec
 *
 * @param content - Raw string content from OpenAI response
 * @returns SpecsValidationResult with valid status, specs array, or error message
 */
export function validateGeneratedSpecs(content: string): SpecsValidationResult {
  // Step 1: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      valid: false,
      error: 'Response is not valid JSON',
    };
  }

  // Step 2: Check if it's an array
  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'Response is not a JSON array',
    };
  }

  // Step 3: Check for empty array
  if (parsed.length === 0) {
    return {
      valid: false,
      error: 'Response is an empty array',
    };
  }

  // Step 4: Check each element is a non-empty string
  for (const element of parsed) {
    if (typeof element !== 'string' || element.length === 0) {
      return {
        valid: false,
        error: 'Array contains non-string elements',
      };
    }
  }

  // Step 5: Check each string starts with the spec prefix
  for (const element of parsed) {
    if (!element.startsWith(SPEC_PREFIX)) {
      return {
        valid: false,
        error: 'Invalid spec format',
      };
    }
  }

  // All validations passed
  return {
    valid: true,
    specs: parsed as string[],
  };
}
