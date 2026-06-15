/**
 * Handoff Plan Validator
 *
 * Validates LLM responses for handoff planning phase.
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 3: Handoff Plan Validation and Chat Route Integration
 */

import type { HandoffIntent, HandoffPlanResponse } from '../types/chat';

/**
 * Result of handoff plan validation.
 */
export interface HandoffPlanValidationResult {
  /** Whether the validation succeeded */
  valid: boolean;
  /** The parsed handoff plan (only present if valid) */
  handoffPlan?: HandoffPlanResponse;
  /** Error message (only present if invalid) */
  error?: string;
}

/**
 * Attempts to extract JSON from content that may contain prose.
 * Tries multiple strategies:
 * 1. Direct JSON parse
 * 2. Extract from markdown code block
 * 3. Extract bare JSON object from prose
 *
 * @param content - The raw content to extract JSON from
 * @returns The extracted JSON string or null if not found
 */
function extractJson(content: string): string | null {
  // Strategy 1: Try direct parse first (content is pure JSON)
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // Strategy 2: Try extracting from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    if (extracted.startsWith('{') && extracted.endsWith('}')) {
      return extracted;
    }
  }

  // Strategy 3: Try finding a bare JSON object in prose
  const jsonMatch = content.match(/\{[\s\S]*"is_split"[\s\S]*"handoff_intents"[\s\S]*\}/);
  if (jsonMatch) {
    // Try to find the balanced JSON object
    const start = content.indexOf('{');
    if (start >= 0) {
      let depth = 0;
      let end = -1;
      for (let i = start; i < content.length; i++) {
        if (content[i] === '{') depth++;
        if (content[i] === '}') depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      if (end > start) {
        return content.substring(start, end + 1);
      }
    }
  }

  return null;
}

/**
 * Validates that a parsed object has all required HandoffIntent fields.
 *
 * @param intent - The intent object to validate
 * @param index - The index in the array (for error messages)
 * @returns Error message if invalid, undefined if valid
 */
function validateIntent(intent: unknown, index: number): string | undefined {
  if (!intent || typeof intent !== 'object') {
    return `Intent at index ${index} is not an object`;
  }

  const obj = intent as Record<string, unknown>;

  // Check required string fields
  const requiredStringFields = ['id', 'title', 'intent'];
  for (const field of requiredStringFields) {
    if (typeof obj[field] !== 'string' || obj[field] === '') {
      return `Intent at index ${index} is missing required field: ${field}`;
    }
  }

  // Check required array fields
  const requiredArrayFields = ['in_scope', 'out_of_scope', 'acceptance_criteria', 'dependencies'];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(obj[field])) {
      return `Intent at index ${index} is missing required array field: ${field}`;
    }
  }

  return undefined;
}

/**
 * Validates the LLM response content as a HandoffPlanResponse.
 *
 * Performs the following validations:
 * 1. JSON parsing (with extraction from prose if needed)
 * 2. Required top-level fields: is_split, handoff_plan_summary, handoff_intents
 * 3. handoff_intents must be non-empty array
 * 4. Each intent must have required fields
 * 5. is_split consistency: single intent = false, multiple intents = true
 *
 * @param content - The raw LLM response content
 * @returns HandoffPlanValidationResult with valid flag and parsed plan or error
 */
export function validateHandoffPlan(content: string): HandoffPlanValidationResult {
  // Step 1: Extract JSON from content
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    return {
      valid: false,
      error: 'Response is not valid JSON and no JSON could be extracted',
    };
  }

  // Step 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      valid: false,
      error: 'Response is not valid JSON',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      valid: false,
      error: 'Response is not a JSON object',
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 3: Check required top-level fields
  if (typeof obj.is_split !== 'boolean') {
    return {
      valid: false,
      error: 'Missing or invalid required field: is_split (must be boolean)',
    };
  }

  if (typeof obj.handoff_plan_summary !== 'string' || obj.handoff_plan_summary === '') {
    return {
      valid: false,
      error: 'Missing or invalid required field: handoff_plan_summary (must be non-empty string)',
    };
  }

  if (!Array.isArray(obj.handoff_intents)) {
    return {
      valid: false,
      error: 'Missing or invalid required field: handoff_intents (must be array)',
    };
  }

  // Step 4: Check handoff_intents is non-empty
  if (obj.handoff_intents.length === 0) {
    return {
      valid: false,
      error: 'handoff_intents must contain at least one intent',
    };
  }

  // Step 5: Validate each intent
  for (let i = 0; i < obj.handoff_intents.length; i++) {
    const intentError = validateIntent(obj.handoff_intents[i], i);
    if (intentError) {
      return {
        valid: false,
        error: intentError,
      };
    }
  }

  // Step 6: Check is_split consistency
  const isSplit = obj.is_split as boolean;
  const intentCount = obj.handoff_intents.length;

  if (isSplit && intentCount === 1) {
    return {
      valid: false,
      error: 'is_split is true but there is only one intent (should be false for single intent)',
    };
  }

  if (!isSplit && intentCount > 1) {
    return {
      valid: false,
      error: 'is_split is false but there are multiple intents (should be true for multiple intents)',
    };
  }

  // All validations passed - construct the response
  const handoffPlan: HandoffPlanResponse = {
    is_split: isSplit,
    handoff_plan_summary: obj.handoff_plan_summary as string,
    handoff_intents: obj.handoff_intents as HandoffIntent[],
  };

  return {
    valid: true,
    handoffPlan,
  };
}

/**
 * Generates a fallback handoff plan when validation fails.
 * Creates a single-intent plan that represents the original work item.
 *
 * @param workItemTitle - The title of the work item (optional)
 * @param workItemDescription - The description of the work item (optional)
 * @returns A valid HandoffPlanResponse as fallback
 */
export function generateFallbackPlan(
  workItemTitle?: string,
  workItemDescription?: string
): HandoffPlanResponse {
  const title = workItemTitle || 'Untitled Feature';
  const description = workItemDescription || 'No description provided';

  return {
    is_split: false,
    handoff_plan_summary: `Unable to parse LLM response. Falling back to single implementation unit for: ${title}`,
    handoff_intents: [
      {
        id: 'S1',
        title: `Implement: ${title}`,
        intent: description,
        in_scope: ['Full feature implementation as described'],
        out_of_scope: [],
        acceptance_criteria: ['Feature works as described'],
        dependencies: [],
      },
    ],
  };
}
