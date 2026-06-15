/**
 * Product Manager Response Validator
 *
 * Validates LLM responses against the ProductManagerResponse schema.
 * Reuses extractJson from plannerResponseValidator for robust JSON extraction.
 * Provides fallback response generation for graceful degradation.
 *
 * Spec 2026-02-12: Increment 3 - Introduce Product Manager Chat Mode
 * Task Group 3: Product Manager Response Validator
 *
 * The ProductManagerResponse is simpler than PlannerResponse:
 * - phase: "questions" or "ready"
 * - questions: Array of discovery question strings
 * - summary: Conversational summary text for the chat bubble
 */

/**
 * Local type definitions for ProductManagerResponse and ProductManagerValidationResult.
 * These types were previously in types/chat.ts but were removed as part of
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10).
 * Kept locally here for backward compatibility until this file is fully deprecated.
 */
export interface ProductManagerResponse {
  phase: string;
  questions: string[];
  summary: string;
}

export interface ProductManagerValidationResult {
  valid: boolean;
  productManagerResponse?: ProductManagerResponse;
  error?: string;
}
import { extractJson } from './plannerResponseValidator';
import { logger } from './logger';

/**
 * Valid phase values for the ProductManagerResponse.
 */
const VALID_PHASES: ReadonlySet<string> = new Set(['questions', 'ready']);

/**
 * Validates a ProductManagerResponse against the expected schema.
 *
 * Validation steps:
 * 1. Extract JSON from raw content using extractJson()
 * 2. Parse the extracted JSON string
 * 3. Validate `phase` is "questions" or "ready"
 * 4. Validate `questions` is an array of strings
 * 5. Validate `summary` is a string
 *
 * On success, returns { valid: true, productManagerResponse: { phase, questions, summary } }.
 * On failure, returns { valid: false, error: "..." } and logs a warning.
 *
 * Spec 2026-02-12: Increment 3 - Introduce Product Manager Chat Mode
 *
 * @param content - The raw LLM response content
 * @returns ProductManagerValidationResult with valid flag and parsed response or error
 */
export function validateProductManagerResponse(
  content: string
): ProductManagerValidationResult {
  // Step 1: Extract JSON from content
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    const error = 'No JSON found in response';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  if (!parsed || typeof parsed !== 'object') {
    const error = 'Response is not a JSON object';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Validate phase is "questions" or "ready"
  if (typeof obj.phase !== 'string' || !VALID_PHASES.has(obj.phase)) {
    const error = `Invalid phase: expected "questions" or "ready", got "${obj.phase}"`;
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 4: Validate questions is an array of strings
  if (!Array.isArray(obj.questions)) {
    const error = 'Missing or invalid required field: questions (must be an array)';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  for (let i = 0; i < obj.questions.length; i++) {
    if (typeof obj.questions[i] !== 'string') {
      const error = `questions[${i}] must be a string`;
      logValidationFailure(error, content);
      return { valid: false, error };
    }
  }

  // Step 5: Validate summary is a string
  if (typeof obj.summary !== 'string') {
    const error = 'Missing or invalid required field: summary (must be a string)';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // All validations passed - construct the response
  const productManagerResponse: ProductManagerResponse = {
    phase: obj.phase as 'questions' | 'ready',
    questions: obj.questions as string[],
    summary: obj.summary as string,
  };

  return {
    valid: true,
    productManagerResponse,
  };
}

/**
 * Creates a safe fallback ProductManagerResponse when validation fails.
 * Returns a safe default with phase "questions", empty questions array, and empty summary.
 * This is the safe fallback when all parsing/retry fails.
 *
 * Spec 2026-02-12: Increment 3 - Introduce Product Manager Chat Mode
 *
 * @returns A valid ProductManagerResponse with safe defaults
 */
export function createFallbackProductManagerResponse(): ProductManagerResponse {
  return {
    phase: 'questions',
    questions: [],
    summary: '',
  };
}

/**
 * Logs a validation failure with context for debugging.
 *
 * @param error - The error message
 * @param content - The raw LLM content (will be truncated to 200 chars)
 */
function logValidationFailure(error: string, content: string): void {
  logger.warn('Product Manager response validation failed', {
    event: 'product_manager_validation_failed',
    error,
    rawContentPreview: content.substring(0, 200),
  });
}
