/**
 * Shared Chat Validation Utilities
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Task Group 1: Extract Shared Utilities to chatValidation.ts
 *
 * Contains validation and utility functions shared between the v1 chat route
 * (chat.ts) and the v2 chat route (chatV2.ts). Extracted from chat.ts to
 * eliminate the cross-route import dependency where chatV2.ts imported from
 * chat.ts.
 *
 * Exports:
 * - validateBaselineJsonShape: Validates parsed JSON conforms to ArchitectureBaselineInput schema shape
 * - ensureMinimumServices: Ensures at least one service exists in the baseline JSON
 * - buildConversationTranscript: Formats OpenAI messages into a dialogue transcript string
 * - BASELINE_JSON_CORRECTIVE_INSTRUCTION: Corrective instruction for baseline JSON validation retries
 */

import { OpenAIMessage } from '../services/openaiClient';

/**
 * Corrective instruction message appended to generation messages when baseline JSON validation fails.
 * Used in the corrective-retry pattern for architecture baseline generation.
 *
 * Spec 2026-02-14: SA Increment 5 - Baseline Generation Flow
 * Task Group 3: JSON Validation with Corrective Retry
 */
export const BASELINE_JSON_CORRECTIVE_INSTRUCTION = 'Your last response was not valid JSON matching the ArchitectureBaselineInput schema. Return ONLY a single JSON object with arrays for: services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements. No markdown, no code blocks.';

/**
 * Known array fields in the ArchitectureBaselineInput schema.
 * Used by validateBaselineJsonShape to check that, if present, each field is an array.
 *
 * Spec 2026-02-14: SA Increment 5 - JSON Validation
 */
const BASELINE_ARRAY_FIELDS = [
  'services',
  'interfaces',
  'interfaceEndpoints',
  'logicalDataEntities',
  'physicalDataEntities',
  'businessLogic',
  'dataMovements',
];

/**
 * Validates the shape of parsed architecture baseline JSON.
 * Checks that the parsed value is a plain object (not array, not null) and
 * that any known array fields, if present, are actually arrays.
 *
 * Does NOT validate individual array item schemas -- only top-level shape.
 *
 * Spec 2026-02-14: SA Increment 5 - JSON Shape Validation
 * Task Group 3: Baseline Generation Flow
 *
 * Exported for direct unit testing (Task Group 5: Test Review and Gap Analysis).
 *
 * @param parsed - The parsed JSON object to validate
 * @returns Object with valid flag and optional error message
 */
export function validateBaselineJsonShape(parsed: unknown): { valid: boolean; error?: string } {
  // Must be a plain object (not array, not null)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'Parsed JSON is not a plain object' };
  }

  const obj = parsed as Record<string, unknown>;

  // Validate each known array field: if present, must be an array
  for (const field of BASELINE_ARRAY_FIELDS) {
    if (obj[field] !== undefined && !Array.isArray(obj[field])) {
      return { valid: false, error: `Field "${field}" is present but is not an array` };
    }
  }

  return { valid: true };
}

/**
 * Ensures the parsed baseline JSON has at least one service.
 * If services is absent or empty, injects the default "Core Application Service".
 *
 * Spec 2026-02-14: SA Increment 5 - Minimum Service Check
 * Task Group 3: Baseline Generation Flow
 *
 * Exported for direct unit testing (Task Group 5: Test Review and Gap Analysis).
 *
 * @param parsed - The parsed JSON object to check and potentially modify
 * @returns The modified object with at least one service guaranteed
 */
export function ensureMinimumServices(parsed: Record<string, unknown>): Record<string, unknown> {
  const services = parsed.services;
  if (!services || !Array.isArray(services) || services.length === 0) {
    parsed.services = [{ name: 'Core Application Service', description: 'Default service' }];
  }
  return parsed;
}

/**
 * Builds the conversation transcript string from the messages array.
 * Formats all user and assistant messages (excluding system messages) as
 * "User: ...\nAssistant: ..." dialogue.
 *
 * Spec 2026-02-14: SA Increment 5 - Conversation Transcript Formatting
 * Task Group 3: Baseline Generation Flow
 *
 * Exported for direct unit testing (Task Group 5: Test Review and Gap Analysis).
 *
 * @param messages - The OpenAI-format messages array
 * @returns Formatted conversation transcript string
 */
export function buildConversationTranscript(messages: OpenAIMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push(`User: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      lines.push(`Assistant: ${msg.content}`);
    }
    // Skip system messages
  }
  return lines.join('\n');
}
