/**
 * Roadmap PM Response Validator
 *
 * Validates LLM responses against the RoadmapPmResponse schema.
 * Reuses extractJson from plannerResponseValidator for robust JSON extraction.
 * Provides fallback response generation for graceful degradation.
 *
 * Spec 2026-02-15: RM Increment 1 - Roadmap PM Mode + LHS Chat Panel
 * Task Group 3: Roadmap PM Response Validator
 *
 * The RoadmapPmResponse has 7 fields:
 * - phase: "questions" or "ready"
 * - section: One of 7 enumerated roadmap discovery sections
 * - questions: Array of discovery question strings
 * - summary: Conversational summary text for the chat bubble
 * - proposedInitiatives: Array of initiatives with nested epics
 * - assumptions: Array of assumption strings (progressive, any phase)
 * - openItems: Array of deferred/unresolved item strings (progressive, any phase)
 */

/**
 * Local type definitions for RoadmapPmResponse and RoadmapPmValidationResult.
 * These types were previously in types/chat.ts but were removed as part of
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10).
 * Kept locally here for backward compatibility until this file is fully deprecated.
 */
export interface RoadmapPmResponse {
  phase: string;
  section: string;
  questions: string[];
  summary: string;
  proposedInitiatives: Array<{ title: string; description: string; epics: Array<{ title: string; description: string }> }>;
  assumptions: string[];
  openItems: string[];
}

export interface RoadmapPmValidationResult {
  valid: boolean;
  roadmapPmResponse?: RoadmapPmResponse;
  error?: string;
}
import { extractJson } from './plannerResponseValidator';
import { logger } from './logger';

/**
 * Valid phase values for the RoadmapPmResponse.
 */
const VALID_PHASES: ReadonlySet<string> = new Set(['questions', 'ready']);

/**
 * Valid section values for the RoadmapPmResponse.
 * These represent the 7 enumerated roadmap discovery sections in strict discovery order.
 */
const VALID_SECTIONS: ReadonlySet<string> = new Set([
  'roadmap_existence_check',
  'outcome_alignment',
  'architecture_alignment',
  'sequencing_strategy',
  'initiative_structure',
  'epic_structure',
  'final_review',
]);

/**
 * Corrective instruction sent to the LLM when the first validation attempt fails.
 * Mirrors the SA_CORRECTIVE_INSTRUCTION pattern from chat.ts.
 *
 * Spec 2026-02-15: RM Increment 1 - Roadmap PM Mode + LHS Chat Panel
 */
export const ROADMAP_PM_CORRECTIVE_INSTRUCTION =
  'Your last response was not valid JSON matching the required Roadmap PM schema. Return ONLY a single JSON object with these fields: phase ("questions" or "ready"), section (one of: roadmap_existence_check, outcome_alignment, architecture_alignment, sequencing_strategy, initiative_structure, epic_structure, final_review), questions (string array, non-empty when phase="questions"), summary (non-empty string), proposedInitiatives (array of {title, description, epics}), assumptions (string array), openItems (string array). No markdown, no prose outside JSON, no extra fields.';

/**
 * Validates a RoadmapPmResponse against the expected schema.
 *
 * Validation steps:
 * 1. Extract JSON from raw content using extractJson()
 * 2. Parse the extracted JSON string
 * 3. Validate `phase` is "questions" or "ready"
 * 4. Validate `section` is one of the 7 enumerated values
 * 5. Validate `questions` is an array of strings and non-empty when phase === 'questions'
 * 6. Validate `summary` is a non-empty string
 * 7. Validate `proposedInitiatives` is an array when present (each item must have non-empty title, description as string, epics as array)
 * 8. Validate readiness gate: when phase="ready", proposedInitiatives must be present, non-empty, and at least one epic across all initiatives
 * 9. Validate `assumptions` is string[] when present (default to empty array)
 * 10. Validate `openItems` is string[] when present (default to empty array)
 *
 * On success, returns { valid: true, roadmapPmResponse: { ... } }.
 * On failure, returns { valid: false, error: "..." } and logs a warning.
 *
 * Spec 2026-02-15: RM Increment 1 - Roadmap PM Mode + LHS Chat Panel
 *
 * @param content - The raw LLM response content
 * @returns RoadmapPmValidationResult with valid flag and parsed response or error
 */
export function validateRoadmapPmResponse(
  content: string
): RoadmapPmValidationResult {
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

  // Step 4: Validate section is one of the 7 enumerated values
  if (typeof obj.section !== 'string' || !VALID_SECTIONS.has(obj.section)) {
    const error = `Invalid section: expected one of [${[...VALID_SECTIONS].join(', ')}], got "${obj.section}"`;
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 5: Validate questions is an array of strings and non-empty when phase === 'questions'
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

  if (obj.phase === 'questions' && obj.questions.length === 0) {
    const error = 'questions must be non-empty when phase is "questions"';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 6: Validate summary is a non-empty string
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
    const error = 'Missing or invalid required field: summary (must be a non-empty string)';
    logValidationFailure(error, content);
    return { valid: false, error };
  }

  // Step 7: Validate proposedInitiatives is an array when present
  // Each item must have a non-empty title string, description as string, epics as array
  const rawInitiatives = obj.proposedInitiatives;
  let proposedInitiatives: Array<{ title: string; description: string; epics: Array<{ title: string; description: string }> }> = [];

  if (rawInitiatives !== undefined && rawInitiatives !== null) {
    if (!Array.isArray(rawInitiatives)) {
      const error = 'proposedInitiatives must be an array when present';
      logValidationFailure(error, content);
      return { valid: false, error };
    }

    for (let i = 0; i < rawInitiatives.length; i++) {
      const initiative = rawInitiatives[i] as Record<string, unknown>;

      if (!initiative || typeof initiative !== 'object') {
        const error = `proposedInitiatives[${i}] must be an object`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }

      if (typeof initiative.title !== 'string' || initiative.title.length === 0) {
        const error = `proposedInitiatives[${i}].title must be a non-empty string`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }

      if (typeof initiative.description !== 'string') {
        const error = `proposedInitiatives[${i}].description must be a string`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }

      if (!Array.isArray(initiative.epics)) {
        const error = `proposedInitiatives[${i}].epics must be an array`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }

      // Validate each epic has title and description
      const epics = initiative.epics as Array<Record<string, unknown>>;
      for (let j = 0; j < epics.length; j++) {
        const epic = epics[j];
        if (!epic || typeof epic !== 'object') {
          const error = `proposedInitiatives[${i}].epics[${j}] must be an object`;
          logValidationFailure(error, content);
          return { valid: false, error };
        }
        if (typeof epic.title !== 'string' || epic.title.length === 0) {
          const error = `proposedInitiatives[${i}].epics[${j}].title must be a non-empty string`;
          logValidationFailure(error, content);
          return { valid: false, error };
        }
        if (typeof epic.description !== 'string') {
          const error = `proposedInitiatives[${i}].epics[${j}].description must be a string`;
          logValidationFailure(error, content);
          return { valid: false, error };
        }
      }
    }

    proposedInitiatives = rawInitiatives as typeof proposedInitiatives;
  }

  // Step 8: Readiness gate -- when phase="ready", proposedInitiatives must be present,
  // non-empty, and at least one epic must exist across all initiatives
  if (obj.phase === 'ready') {
    if (proposedInitiatives.length === 0) {
      const error = 'proposedInitiatives must be non-empty when phase is "ready"';
      logValidationFailure(error, content);
      return { valid: false, error };
    }

    const totalEpics = proposedInitiatives.reduce(
      (count, init) => count + init.epics.length,
      0
    );
    if (totalEpics === 0) {
      const error = 'At least one epic must exist across all initiatives when phase is "ready"';
      logValidationFailure(error, content);
      return { valid: false, error };
    }
  }

  // Step 9: Validate assumptions is string[] when present (default to empty array)
  let assumptions: string[] = [];
  if (obj.assumptions !== undefined && obj.assumptions !== null) {
    if (!Array.isArray(obj.assumptions)) {
      const error = 'assumptions must be an array when present';
      logValidationFailure(error, content);
      return { valid: false, error };
    }
    for (let i = 0; i < obj.assumptions.length; i++) {
      if (typeof obj.assumptions[i] !== 'string') {
        const error = `assumptions[${i}] must be a string`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }
    }
    assumptions = obj.assumptions as string[];
  }

  // Step 10: Validate openItems is string[] when present (default to empty array)
  let openItems: string[] = [];
  if (obj.openItems !== undefined && obj.openItems !== null) {
    if (!Array.isArray(obj.openItems)) {
      const error = 'openItems must be an array when present';
      logValidationFailure(error, content);
      return { valid: false, error };
    }
    for (let i = 0; i < obj.openItems.length; i++) {
      if (typeof obj.openItems[i] !== 'string') {
        const error = `openItems[${i}] must be a string`;
        logValidationFailure(error, content);
        return { valid: false, error };
      }
    }
    openItems = obj.openItems as string[];
  }

  // All validations passed - construct the response
  const roadmapPmResponse: RoadmapPmResponse = {
    phase: obj.phase as 'questions' | 'ready',
    section: obj.section as RoadmapPmResponse['section'],
    questions: obj.questions as string[],
    summary: obj.summary as string,
    proposedInitiatives,
    assumptions,
    openItems,
  };

  return {
    valid: true,
    roadmapPmResponse,
  };
}

/**
 * Creates a safe fallback RoadmapPmResponse when validation fails.
 * Returns safe defaults with phase "questions", section "roadmap_existence_check",
 * empty questions array, empty summary, empty proposedInitiatives, assumptions, and openItems.
 * This is the safe fallback when all parsing/retry fails.
 *
 * Spec 2026-02-15: RM Increment 1 - Roadmap PM Mode + LHS Chat Panel
 *
 * @returns A valid RoadmapPmResponse with safe defaults
 */
export function createFallbackRoadmapPmResponse(): RoadmapPmResponse {
  return {
    phase: 'questions',
    section: 'roadmap_existence_check',
    questions: [],
    summary: '',
    proposedInitiatives: [],
    assumptions: [],
    openItems: [],
  };
}

/**
 * Logs a validation failure with context for debugging.
 *
 * @param error - The error message
 * @param content - The raw LLM content (will be truncated to 200 chars)
 */
function logValidationFailure(error: string, content: string): void {
  logger.warn('Roadmap PM response validation failed', {
    event: 'roadmap_pm_validation_failed',
    error,
    rawContentPreview: content.substring(0, 200),
  });
}
