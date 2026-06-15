/**
 * Test Planner Response Validator
 *
 * Validates LLM responses against the TestPlannerResponse schema.
 * Provides JSON extraction and fallback response generation for the
 * test_planning phase (Test Engineer persona).
 *
 * Spec 2026-03-18: Refine Feature Flow - Phase 2
 */

import { v4 as uuidv4 } from 'uuid';
import type { TestPlannerResponse, TestDefinition } from '../types/chat';
import { extractJson, sanitizeJsonString } from './plannerResponseValidator';
import { logger } from './logger';

const SAFE_FALLBACK_MESSAGE = "I couldn't parse the test planning response. Please try again.";

export interface TestPlannerValidationResult {
  valid: boolean;
  testPlannerResponse?: TestPlannerResponse;
  error?: string;
}

/**
 * Validates a TestPlannerResponse from the LLM.
 *
 * @param content - The raw LLM response content
 * @param sessionId - Optional session ID for logging correlation
 * @returns TestPlannerValidationResult with valid flag and parsed response or error
 */
export function validateTestPlannerResponse(
  content: string,
  sessionId?: string
): TestPlannerValidationResult {
  // Step 1: Extract JSON from content
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    const error = 'No JSON found in test planner response';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 2: Sanitize and parse JSON
  const sanitizedJson = sanitizeJsonString(jsonStr);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedJson);
  } catch (e) {
    const error = `Invalid JSON in test planner response: ${e instanceof Error ? e.message : String(e)}`;
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  if (!parsed || typeof parsed !== 'object') {
    const error = 'Test planner response is not a JSON object';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Validate schemaVersion
  if (typeof obj.schemaVersion !== 'string') {
    const error = 'Missing schemaVersion in test planner response';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 4: Validate message
  if (typeof obj.message !== 'string') {
    const error = 'Missing or invalid message field (must be a string)';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 5: Validate testPlan array
  if (!Array.isArray(obj.testPlan)) {
    const error = 'Missing or invalid testPlan field (must be an array)';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 6: Validate each test definition
  const validTypes = new Set(['unit', 'functional', 'integration', 'e2e']);
  for (let i = 0; i < obj.testPlan.length; i++) {
    const test = obj.testPlan[i] as Record<string, unknown>;
    if (!test || typeof test !== 'object') {
      const error = `testPlan[${i}] is not an object`;
      logFailure(error, content, sessionId);
      return { valid: false, error };
    }
    if (typeof test.title !== 'string' || !test.title) {
      const error = `testPlan[${i}].title is required and must be a non-empty string`;
      logFailure(error, content, sessionId);
      return { valid: false, error };
    }
    if (typeof test.description !== 'string') {
      const error = `testPlan[${i}].description must be a string`;
      logFailure(error, content, sessionId);
      return { valid: false, error };
    }
    if (typeof test.type !== 'string' || !validTypes.has(test.type)) {
      const error = `testPlan[${i}].type must be "unit" or "functional"`;
      logFailure(error, content, sessionId);
      return { valid: false, error };
    }
  }

  // Step 7: Validate openQuestions array
  if (!Array.isArray(obj.openQuestions)) {
    const error = 'Missing or invalid openQuestions field (must be an array)';
    logFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Transform openQuestions: accept both string[] and {id, question}[] formats
  const openQuestions = (obj.openQuestions as unknown[]).map((q) => {
    if (typeof q === 'string') {
      return { id: uuidv4(), question: q };
    }
    const qObj = q as Record<string, unknown>;
    return {
      id: typeof qObj.id === 'string' ? qObj.id : uuidv4(),
      question: typeof qObj.question === 'string' ? qObj.question : String(q),
    };
  });

  // Build validated response
  const testPlannerResponse: TestPlannerResponse = {
    schemaVersion: obj.schemaVersion as string,
    message: obj.message as string,
    testPlan: obj.testPlan as TestDefinition[],
    openQuestions,
  };

  return { valid: true, testPlannerResponse };
}

/**
 * Creates a safe fallback TestPlannerResponse when validation fails.
 */
export function createFallbackTestPlannerResponse(): TestPlannerResponse {
  return {
    schemaVersion: '1.0',
    message: SAFE_FALLBACK_MESSAGE,
    testPlan: [],
    openQuestions: [],
  };
}

function logFailure(error: string, content: string, sessionId?: string): void {
  logger.warn('Test planner response validation failed', {
    event: 'test_planner_validation_failed',
    sessionId: sessionId || 'unknown',
    error,
    rawContentPreview: content.substring(0, 200),
  });
}
