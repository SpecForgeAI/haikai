/**
 * Implementer Response Validator
 *
 * Validates LLM responses against the ImplementerResponse schema v1.0.
 * Reuses extractJson and transformOpenQuestions from plannerResponseValidator.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 2: Gateway Validator - implementerResponseValidator.ts
 *
 * The ImplementerResponse is simpler than PlannerResponse:
 * - schemaVersion: "1.0"
 * - message: Conversational text for the user
 * - openQuestions: Array of technical clarifying questions (string[] from LLM, transformed to OpenQuestion[])
 */

import type {
  ImplementerResponse,
  ImplementerValidationResult,
} from '../types/chat';
import { extractJson, transformOpenQuestions } from './plannerResponseValidator';

/**
 * Validates an ImplementerResponse against schema v1.0.
 *
 * The ImplementerResponse has a simpler structure than PlannerResponse:
 * - schemaVersion: Must be "1.0"
 * - message: Required string (conversational explanation)
 * - openQuestions: Required array of question strings (transformed to OpenQuestion[] with UUIDs)
 *
 * @param content - The raw LLM response content
 * @returns ImplementerValidationResult with valid flag and parsed response or error
 */
export function validateImplementerResponse(
  content: string
): ImplementerValidationResult {
  // Step 1: Extract JSON from content
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    return { valid: false, error: 'No JSON found in response' };
  }

  // Step 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, error: 'Response is not a JSON object' };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Validate schemaVersion
  if (obj.schemaVersion !== '1.0') {
    return {
      valid: false,
      error: `Invalid schemaVersion: expected "1.0", got "${obj.schemaVersion}"`,
    };
  }

  // Step 4: Validate required message field
  if (typeof obj.message !== 'string') {
    return {
      valid: false,
      error: 'Missing or invalid required field: message (must be a string)',
    };
  }

  // Step 5: Validate openQuestions array
  if (!Array.isArray(obj.openQuestions)) {
    return {
      valid: false,
      error: 'Missing or invalid required field: openQuestions (must be an array)',
    };
  }

  // Step 6: Validate each openQuestion is a string
  for (let i = 0; i < obj.openQuestions.length; i++) {
    if (typeof obj.openQuestions[i] !== 'string') {
      return {
        valid: false,
        error: `openQuestions[${i}] must be a string`,
      };
    }
  }

  // Step 7: Transform openQuestions from string[] to OpenQuestion[]
  const transformedOpenQuestions = transformOpenQuestions(obj.openQuestions as string[]);

  // All validations passed - construct the response
  const implementerResponse: ImplementerResponse = {
    schemaVersion: '1.0',
    message: obj.message as string,
    openQuestions: transformedOpenQuestions,
  };

  return {
    valid: true,
    implementerResponse,
  };
}

/**
 * Creates a safe fallback ImplementerResponse when validation fails.
 * Preserves the raw message for display while providing empty defaults for other fields.
 *
 * @param rawMessage - The raw LLM response to preserve in the message field
 * @returns A valid ImplementerResponse with safe defaults
 */
export function createFallbackImplementerResponse(
  rawMessage: string
): ImplementerResponse {
  return {
    schemaVersion: '1.0',
    message: rawMessage,
    openQuestions: [],
  };
}
