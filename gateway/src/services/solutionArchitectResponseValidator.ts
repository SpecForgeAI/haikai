/**
 * Solution Architect Response Validator
 *
 * Validates LLM responses against the SolutionArchitectResponse schema.
 * Reuses extractJson from plannerResponseValidator for robust JSON extraction.
 * Provides fallback response generation for graceful degradation.
 *
 * Spec 2026-02-13: SA Increment 1 - Add Solution Architect Mode
 * Task Group 3: Solution Architect Response Validator
 *
 * The SolutionArchitectResponse has 4 fields:
 * - phase: "questions" or "ready"
 * - section: One of 10 enumerated architecture discovery sections
 * - questions: Array of discovery question strings
 * - summary: Conversational summary text for the chat bubble
 */

/**
 * Local type definitions for SolutionArchitectResponse and SolutionArchitectValidationResult.
 * These types were previously in types/chat.ts but were removed as part of
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10).
 * Kept locally here for backward compatibility until this file is fully deprecated.
 */
export interface SolutionArchitectResponse {
  phase: string;
  section: string;
  questions: string[];
  summary: string;
}

export interface SolutionArchitectValidationResult {
  valid: boolean;
  solutionArchitectResponse?: SolutionArchitectResponse;
  error?: string;
}
import { extractJson } from './plannerResponseValidator';
import { logger } from './logger';

/**
 * Valid phase values for the SolutionArchitectResponse.
 */
const VALID_PHASES: ReadonlySet<string> = new Set(['questions', 'ready']);

/**
 * Valid section values for the SolutionArchitectResponse.
 * These represent the 10 enumerated architecture discovery sections.
 */
const VALID_SECTIONS: ReadonlySet<string> = new Set([
  'document_intake',
  'context_and_boundaries',
  'ui_and_channels',
  'integrations',
  'data_model',
  'service_decomposition',
  'business_logic',
  'non_functional',
  'artefact_review',
  'final_review',
]);

/**
 * Validates a SolutionArchitectResponse against the expected schema.
 *
 * Validation steps:
 * 1. Extract JSON from raw content using extractJson()
 * 2. Parse the extracted JSON string
 * 3. Validate `phase` is "questions" or "ready"
 * 4. Validate `section` is one of the 9 enumerated values
 * 5. Validate `questions` is an array of strings
 * 6. Validate `summary` is a non-empty string
 * 7. Validate that `questions` is non-empty when `phase === 'questions'`
 *
 * On success, returns { valid: true, solutionArchitectResponse: { ... } }.
 * On failure, returns { valid: false, error: "..." } and logs a warning.
 *
 * Spec 2026-02-13: SA Increment 1 - Add Solution Architect Mode
 *
 * @param content - The raw LLM response content
 * @returns SolutionArchitectValidationResult with valid flag and parsed response or error
 */
export function validateSolutionArchitectResponse(
  content: string
): SolutionArchitectValidationResult {
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

  // Step 4: Validate section is one of the 10 enumerated values
  if (typeof obj.section !== 'string' || !VALID_SECTIONS.has(obj.section)) {
    const error = `Invalid section: expected one of [${[...VALID_SECTIONS].join(', ')}], got "${obj.section}"`;
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 5: Validate questions is an array of strings
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

  // Step 6: Validate summary is a non-empty string
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
    const error = 'Missing or invalid required field: summary (must be a non-empty string)';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 7: Validate that questions is non-empty when phase === 'questions'
  if (obj.phase === 'questions' && obj.questions.length === 0) {
    const error = 'questions must be non-empty when phase is "questions"';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // All validations passed - construct the response
  const solutionArchitectResponse: SolutionArchitectResponse = {
    phase: obj.phase as 'questions' | 'ready',
    section: obj.section as SolutionArchitectResponse['section'],
    questions: obj.questions as string[],
    summary: obj.summary as string,
  };

  return {
    valid: true,
    solutionArchitectResponse,
  };
}

/**
 * Creates a safe fallback SolutionArchitectResponse when validation fails.
 * Returns a safe default with phase "questions", section "context_and_boundaries",
 * empty questions array, empty summary, empty assumptions, and empty openItems.
 * This is the safe fallback when all parsing/retry fails.
 *
 * Spec 2026-02-13: SA Increment 1 - Add Solution Architect Mode
 *
 * @returns A valid SolutionArchitectResponse with safe defaults
 */
export function createFallbackSolutionArchitectResponse(): SolutionArchitectResponse {
  return {
    phase: 'questions',
    section: 'context_and_boundaries',
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
  logger.warn('Solution Architect response validation failed', {
    event: 'solution_architect_validation_failed',
    error,
    rawContentPreview: content.substring(0, 200),
  });
}
