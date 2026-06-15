/**
 * LLM Payload Validation
 *
 * Validates PlannerResponse and ImplementerResponse payloads before persistence.
 * Ensures data integrity by checking required fields and structure.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 9: Validation and Error Handling
 */

import type { PlannerResponse, ImplementerResponse, OpenQuestion, Question } from '../api/chatApi';

// ============================================================================
// Types
// ============================================================================

/**
 * Validation result for LLM payloads.
 */
export interface LLMValidationResult {
  /** Whether the payload is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
}

// ============================================================================
// PlannerResponse Validation
// ============================================================================

/**
 * Validates a PlannerResponse payload.
 *
 * Required fields:
 * - schemaVersion: must be '1.1'
 * - message: must be a non-empty string
 * - featureUnderstanding: must be a string
 * - scope: must have in[] and out[] arrays
 * - assumptions: must be an array
 * - acceptanceCriteria: must be an array
 * - openQuestions: must be an array of OpenQuestion objects
 * - plannerReadyForSpec: must be a boolean
 *
 * @param payload - The payload to validate
 * @returns Validation result
 */
export function validatePlannerResponse(payload: unknown): LLMValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['PlannerResponse must be a non-null object'] };
  }

  const obj = payload as Record<string, unknown>;

  // schemaVersion
  if (obj.schemaVersion !== '1.1') {
    errors.push(`Invalid schemaVersion: expected '1.1', got '${obj.schemaVersion}'`);
  }

  // message
  if (typeof obj.message !== 'string') {
    errors.push(`Invalid message: expected string, got ${typeof obj.message}`);
  }

  // featureUnderstanding
  if (typeof obj.featureUnderstanding !== 'string') {
    errors.push(`Invalid featureUnderstanding: expected string, got ${typeof obj.featureUnderstanding}`);
  }

  // scope
  if (!obj.scope || typeof obj.scope !== 'object') {
    errors.push('Invalid scope: expected object');
  } else {
    const scope = obj.scope as Record<string, unknown>;
    if (!Array.isArray(scope.in)) {
      errors.push('Invalid scope.in: expected array');
    }
    if (!Array.isArray(scope.out)) {
      errors.push('Invalid scope.out: expected array');
    }
  }

  // assumptions
  if (!Array.isArray(obj.assumptions)) {
    errors.push(`Invalid assumptions: expected array, got ${typeof obj.assumptions}`);
  }

  // acceptanceCriteria
  if (!Array.isArray(obj.acceptanceCriteria)) {
    errors.push(`Invalid acceptanceCriteria: expected array, got ${typeof obj.acceptanceCriteria}`);
  }

  // openQuestions
  if (!Array.isArray(obj.openQuestions)) {
    errors.push(`Invalid openQuestions: expected array, got ${typeof obj.openQuestions}`);
  } else {
    // Validate each question
    const questions = obj.openQuestions as unknown[];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || typeof q !== 'object') {
        errors.push(`Invalid openQuestions[${i}]: expected object`);
        continue;
      }
      const qObj = q as Record<string, unknown>;
      if (typeof qObj.id !== 'string') {
        errors.push(`Invalid openQuestions[${i}].id: expected string`);
      }
      if (typeof qObj.question !== 'string') {
        errors.push(`Invalid openQuestions[${i}].question: expected string`);
      }
    }
  }

  // plannerReadyForSpec
  if (typeof obj.plannerReadyForSpec !== 'boolean') {
    errors.push(`Invalid plannerReadyForSpec: expected boolean, got ${typeof obj.plannerReadyForSpec}`);
  }

  // implementationPlan (optional)
  if (obj.implementationPlan !== null && obj.implementationPlan !== undefined) {
    if (typeof obj.implementationPlan !== 'object') {
      errors.push(`Invalid implementationPlan: expected object or null, got ${typeof obj.implementationPlan}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// ImplementerResponse Validation
// ============================================================================

/**
 * Validates an ImplementerResponse payload.
 *
 * Required fields:
 * - schemaVersion: must be '1.0'
 * - message: must be a string
 * - openQuestions: must be an array of OpenQuestion objects
 *
 * @param payload - The payload to validate
 * @returns Validation result
 */
export function validateImplementerResponse(payload: unknown): LLMValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['ImplementerResponse must be a non-null object'] };
  }

  const obj = payload as Record<string, unknown>;

  // schemaVersion
  if (obj.schemaVersion !== '1.0') {
    errors.push(`Invalid schemaVersion: expected '1.0', got '${obj.schemaVersion}'`);
  }

  // message
  if (typeof obj.message !== 'string') {
    errors.push(`Invalid message: expected string, got ${typeof obj.message}`);
  }

  // openQuestions
  if (!Array.isArray(obj.openQuestions)) {
    errors.push(`Invalid openQuestions: expected array, got ${typeof obj.openQuestions}`);
  } else {
    // Validate each question
    const questions = obj.openQuestions as unknown[];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q || typeof q !== 'object') {
        errors.push(`Invalid openQuestions[${i}]: expected object`);
        continue;
      }
      const qObj = q as Record<string, unknown>;
      if (typeof qObj.id !== 'string') {
        errors.push(`Invalid openQuestions[${i}].id: expected string`);
      }
      if (typeof qObj.question !== 'string') {
        errors.push(`Invalid openQuestions[${i}].question: expected string`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Question Validation
// ============================================================================

/**
 * Validates a Question array.
 *
 * Each question must have:
 * - id: string
 * - question: string
 * - status: 'Open' | 'Answered'
 * - answer: string
 * - source: 'Product Manager' | 'Software Developer'
 *
 * @param questions - The questions to validate
 * @returns Validation result
 */
export function validateQuestions(questions: unknown): LLMValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(questions)) {
    return { valid: false, errors: ['Questions must be an array'] };
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || typeof q !== 'object') {
      errors.push(`Invalid questions[${i}]: expected object`);
      continue;
    }

    const qObj = q as Record<string, unknown>;

    if (typeof qObj.id !== 'string') {
      errors.push(`Invalid questions[${i}].id: expected string`);
    }

    if (typeof qObj.question !== 'string') {
      errors.push(`Invalid questions[${i}].question: expected string`);
    }

    if (qObj.status !== 'Open' && qObj.status !== 'Answered') {
      errors.push(`Invalid questions[${i}].status: expected 'Open' or 'Answered'`);
    }

    if (typeof qObj.answer !== 'string') {
      errors.push(`Invalid questions[${i}].answer: expected string`);
    }

    if (qObj.source !== 'Product Manager' && qObj.source !== 'Software Developer') {
      errors.push(`Invalid questions[${i}].source: expected 'Product Manager' or 'Software Developer'`);
    }

    // incrementId is optional
    if (qObj.incrementId !== undefined && typeof qObj.incrementId !== 'string') {
      errors.push(`Invalid questions[${i}].incrementId: expected string or undefined`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Generic Validation Dispatcher
// ============================================================================

/**
 * Validates an LLM payload based on its type.
 *
 * @param payload - The payload to validate
 * @param type - The type of payload ('PlannerResponse' | 'ImplementerResponse' | 'Questions')
 * @returns Validation result
 */
export function validateLLMPayload(
  payload: unknown,
  type: 'PlannerResponse' | 'ImplementerResponse' | 'Questions'
): LLMValidationResult {
  switch (type) {
    case 'PlannerResponse':
      return validatePlannerResponse(payload);
    case 'ImplementerResponse':
      return validateImplementerResponse(payload);
    case 'Questions':
      return validateQuestions(payload);
    default:
      return { valid: false, errors: [`Unknown payload type: ${type}`] };
  }
}
