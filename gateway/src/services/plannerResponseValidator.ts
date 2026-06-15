/**
 * Planner Response Validator
 *
 * Validates LLM responses against the PlannerResponse schema v1.1.
 * Provides JSON extraction from markdown and fallback response generation.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Task Group 2: Validator Service Layer
 *
 * Spec 2026-01-23: Questions System v1
 * - Added transformOpenQuestions function to convert string[] to OpenQuestion[]
 * - UUIDs assigned using uuid v4 during validation
 *
 * Spec 2026-01-24: Planner Message Hygiene
 * - Integrated sanitizePlannerMessage() call after JSON parse
 * - Added INFO/DEBUG logging for sanitization events
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 * - Added sessionId parameter to validatePlannerResponse for logging
 * - Added logger.warn on validation failure with sessionId, error, truncated raw content
 * - Changed createFallbackPlannerResponse to return safe static message (no raw content)
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  PlannerResponse,
  PlannerValidationResult,
  ImplementationPlan,
  OpenQuestion,
} from '../types/chat';
import { sanitizePlannerMessage, SanitizationResult } from './plannerMessageSanitizer';
import { logger } from './logger';

/**
 * Safe fallback message when parse/validation fails.
 * NEVER include raw LLM content in this message.
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 */
const SAFE_FALLBACK_MESSAGE = "I couldn't parse the structured response. Please try again.";

/**
 * Transforms an array of question strings into an array of OpenQuestion objects.
 * Each question is assigned a unique UUID v4 identifier.
 *
 * Spec 2026-01-23: Questions System v1 - Task Group 2
 *
 * @param questions - Array of question strings from LLM response
 * @returns Array of OpenQuestion objects with generated UUIDs
 */
export function transformOpenQuestions(questions: string[]): OpenQuestion[] {
  return questions.map(question => ({
    id: uuidv4(),
    question,
  }));
}

/**
 * Sanitizes a JSON string to fix common LLM output issues before parsing.
 * Applies repairs in order:
 * 1. Strip JS-style single-line and multi-line comments
 * 2. Remove trailing commas before } and ]
 * 3. Fix unescaped control characters (literal newlines/tabs/carriage returns) inside string values
 *
 * @param jsonStr - The raw JSON string to sanitize
 * @returns The sanitized JSON string
 */
export function sanitizeJsonString(jsonStr: string): string {
  let result = jsonStr;

  // 1. Strip single-line comments (// ...) that are NOT inside strings
  // Use a state machine approach to avoid stripping inside string values
  result = stripComments(result);

  // 2. Remove trailing commas before closing } or ]
  // Match comma followed by optional whitespace and closing bracket/brace
  result = result.replace(/,\s*([}\]])/g, '$1');

  // 3. Fix unescaped control characters inside JSON string values
  // Walk through the string character by character, tracking whether we're inside a string
  result = fixUnescapedControlChars(result);

  return result;
}

/**
 * Strips JS-style comments from a JSON-like string without affecting string contents.
 * Handles both // single-line and /* multi-line comments.
 */
function stripComments(str: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < str.length) {
    const ch = str[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escape = true;
        result += ch;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else {
        result += ch;
      }
      i++;
      continue;
    }

    // Not inside a string
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === '/' && i + 1 < str.length && str[i + 1] === '/') {
      // Single-line comment: skip to end of line
      i += 2;
      while (i < str.length && str[i] !== '\n') i++;
    } else if (ch === '/' && i + 1 < str.length && str[i + 1] === '*') {
      // Multi-line comment: skip to */
      i += 2;
      while (i + 1 < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i += 2; // skip */
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

/**
 * Fixes unescaped control characters (literal newlines, tabs, carriage returns)
 * that appear inside JSON string values. These cause JSON.parse() to fail.
 */
function fixUnescapedControlChars(str: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < str.length) {
    const ch = str[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escape = true;
        result += ch;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
      i++;
      continue;
    }

    // Not inside a string
    if (ch === '"') {
      inString = true;
    }
    result += ch;
    i++;
  }

  return result;
}

/**
 * Extracts JSON from content that may contain prose or markdown.
 * Tries multiple strategies:
 * 1. Direct JSON (starts with '{')
 * 2. Markdown code block (```json ... ``` or ``` ... ```)
 * 3. Bare JSON object embedded in prose
 *
 * @param content - The raw content to extract JSON from
 * @returns The extracted JSON string or null if not found
 */
export function extractJson(content: string): string | null {
  const trimmed = content.trim();

  // Strategy 1: Direct JSON (content starts with '{')
  if (trimmed.startsWith('{')) {
    // Find matching closing brace
    let depth = 0;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      if (trimmed[i] === '}') depth--;
      if (depth === 0) {
        return trimmed.substring(0, i + 1);
      }
    }
    // Return whole content if we couldn't find balanced braces
    return trimmed;
  }

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    if (extracted.startsWith('{')) {
      return extracted;
    }
  }

  // Strategy 3: Find bare JSON object in prose
  const jsonStart = content.indexOf('{');
  if (jsonStart >= 0) {
    let depth = 0;
    let end = -1;
    for (let i = jsonStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    if (end > jsonStart) {
      return content.substring(jsonStart, end + 1);
    }
  }

  return null;
}

/**
 * Validates an ImplementationPlan object.
 *
 * @param plan - The plan object to validate
 * @returns PlannerValidationResult
 */
function validateImplementationPlan(plan: unknown): PlannerValidationResult {
  if (plan === null || plan === undefined) {
    return { valid: false, error: 'implementationPlan is required in this phase' };
  }

  const p = plan as Record<string, unknown>;

  // Validate planTitle
  if (typeof p.planTitle !== 'string' || !p.planTitle) {
    return { valid: false, error: 'implementationPlan.planTitle is required and must be a non-empty string' };
  }

  // Validate increments array (used for both standard and split plans)
  if (!Array.isArray(p.increments)) {
    return { valid: false, error: 'implementationPlan.increments must be an array' };
  }

  if (p.increments.length === 0) {
    return { valid: false, error: 'implementationPlan.increments must be non-empty' };
  }

  // Validate each increment
  for (let i = 0; i < p.increments.length; i++) {
    const inc = p.increments[i] as Record<string, unknown>;

    if (!inc || typeof inc !== 'object') {
      return { valid: false, error: `increment[${i}] is not an object` };
    }

    // Required string fields
    const requiredFields = ['id', 'title', 'intent'];
    for (const field of requiredFields) {
      if (typeof inc[field] !== 'string') {
        return { valid: false, error: `increment[${i}].${field} is required and must be a string` };
      }
    }

    // partIndex must be a number
    if (typeof inc.partIndex !== 'number') {
      return { valid: false, error: `increment[${i}].partIndex is required and must be a number` };
    }
  }

  return { valid: true };
}

/**
 * Logs a validation failure with context for debugging.
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 *
 * @param error - The error message
 * @param content - The raw LLM content (will be truncated)
 * @param sessionId - The session ID for correlation
 */
function logValidationFailure(error: string, content: string, sessionId?: string): void {
  logger.warn('Planner response validation failed', {
    event: 'planner_validation_failed',
    sessionId: sessionId || 'unknown',
    error,
    rawContentPreview: content.substring(0, 200),
  });
}

/**
 * Validates a PlannerResponse against schema v1.1.
 *
 * Spec 2026-01-24: Planner Message Hygiene
 * - Applies message sanitization after JSON parse and field validation
 * - Logs sanitization events at INFO and DEBUG levels
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 * - Added sessionId parameter for logging correlation
 * - Logs validation failures with sessionId, error, and truncated raw content
 *
 * @param content - The raw LLM response content
 * @param expectImplementationPlan - Whether implementationPlan is required (true for implementation_planning phase)
 * @param sessionId - Optional session ID for logging correlation
 * @returns PlannerValidationResult with valid flag and parsed response or error
 */
export function validatePlannerResponse(
  content: string,
  expectImplementationPlan: boolean = false,
  sessionId?: string
): PlannerValidationResult {
  // Step 1: Extract JSON from content
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    const error = 'No JSON found in response';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 2: Sanitize and parse JSON
  // Apply defensive sanitization before parsing to handle common LLM output issues
  const sanitizedJson = sanitizeJsonString(jsonStr);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizedJson);
  } catch (e) {
    const error = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  if (!parsed || typeof parsed !== 'object') {
    const error = 'Response is not a JSON object';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Validate schemaVersion
  if (obj.schemaVersion !== '1.1') {
    const error = `Invalid schemaVersion: expected "1.1", got "${obj.schemaVersion}"`;
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 4: Validate required string fields
  const requiredStrings = ['message', 'featureUnderstanding'];
  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string') {
      const error = `Missing or invalid required field: ${field} (must be a string)`;
      logValidationFailure(error, content, sessionId);
      return { valid: false, error };
    }
  }

  // Step 5: Validate required array fields
  const requiredArrays = ['assumptions', 'acceptanceCriteria', 'openQuestions'];
  for (const field of requiredArrays) {
    if (!Array.isArray(obj[field])) {
      const error = `Missing or invalid required field: ${field} (must be an array)`;
      logValidationFailure(error, content, sessionId);
      return { valid: false, error };
    }
  }

  // Step 6: Validate scope object
  if (!obj.scope || typeof obj.scope !== 'object') {
    const error = 'Missing or invalid required field: scope (must be an object)';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  const scope = obj.scope as Record<string, unknown>;
  if (!Array.isArray(scope.in)) {
    const error = 'scope.in must be an array';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }
  if (!Array.isArray(scope.out)) {
    const error = 'scope.out must be an array';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 7: Validate plannerReadyForSpec
  if (typeof obj.plannerReadyForSpec !== 'boolean') {
    const error = 'Missing or invalid required field: plannerReadyForSpec (must be a boolean)';
    logValidationFailure(error, content, sessionId);
    return { valid: false, error };
  }

  // Step 8: Validate implementationPlan based on expectImplementationPlan
  if (expectImplementationPlan) {
    const planResult = validateImplementationPlan(obj.implementationPlan);
    if (!planResult.valid) {
      logValidationFailure(planResult.error || 'implementationPlan validation failed', content, sessionId);
      return planResult;
    }
  } else {
    // During refine phase, implementationPlan must be null
    if (obj.implementationPlan !== null) {
      const error = 'implementationPlan must be null during shaping/refine phase';
      logValidationFailure(error, content, sessionId);
      return { valid: false, error };
    }
  }

  // Step 9: Transform openQuestions from string[] to OpenQuestion[]
  // Spec 2026-01-23: Questions System v1
  const transformedOpenQuestions = transformOpenQuestions(obj.openQuestions as string[]);

  // Step 10: Sanitize the message field
  // Spec 2026-01-24: Planner Message Hygiene
  const originalMessage = obj.message as string;
  const sanitizationResult: SanitizationResult = sanitizePlannerMessage(
    originalMessage,
    transformedOpenQuestions
  );

  // Log sanitization events if sanitization was applied
  if (sanitizationResult.sanitized) {
    logger.info('Planner message sanitized', {
      event: 'planner_message_sanitized',
      reasonCount: sanitizationResult.reasons.length,
      reasons: sanitizationResult.reasons,
    });

    logger.debug('Planner message sanitization details', {
      event: 'planner_message_sanitization_details',
      originalLength: originalMessage.length,
      sanitizedLength: sanitizationResult.message.length,
      detectedPatterns: sanitizationResult.reasons,
    });
  }

  // All validations passed - construct the response with sanitized message
  const plannerResponse: PlannerResponse = {
    schemaVersion: '1.1',
    message: sanitizationResult.message, // Use sanitized message
    featureUnderstanding: obj.featureUnderstanding as string,
    scope: {
      in: scope.in as string[],
      out: scope.out as string[],
    },
    assumptions: obj.assumptions as string[],
    acceptanceCriteria: obj.acceptanceCriteria as string[],
    openQuestions: transformedOpenQuestions,
    plannerReadyForSpec: obj.plannerReadyForSpec as boolean,
    implementationPlan: expectImplementationPlan
      ? (obj.implementationPlan as ImplementationPlan)
      : null,
  };

  return {
    valid: true,
    plannerResponse,
  };
}

/**
 * Creates a safe fallback PlannerResponse when validation fails.
 * Returns a safe static message - NEVER includes raw LLM content.
 *
 * Spec 2026-01-24: Fix Planner JSON Parsing Regression
 * - Changed to return safe static message instead of raw content
 * - Removed rawMessage parameter
 *
 * @returns A valid PlannerResponse with safe defaults and static fallback message
 */
export function createFallbackPlannerResponse(): PlannerResponse {
  return {
    schemaVersion: '1.1',
    message: SAFE_FALLBACK_MESSAGE,
    featureUnderstanding: '',
    scope: { in: [], out: [] },
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null,
  };
}
