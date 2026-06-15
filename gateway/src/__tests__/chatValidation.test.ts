/**
 * Tests for chatValidation.ts shared utilities
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Task Group 1, Task 1.1: Write 4 focused tests for chatValidation.ts
 *
 * Verifies:
 * 1. validateBaselineJsonShape returns { valid: true } for well-formed baseline JSON
 * 2. validateBaselineJsonShape returns { valid: false, error: '...' } for malformed objects
 * 3. ensureMinimumServices adds default service when services array is empty
 * 4. buildConversationTranscript concatenates messages with role labels
 */

import {
  validateBaselineJsonShape,
  ensureMinimumServices,
  buildConversationTranscript,
  BASELINE_JSON_CORRECTIVE_INSTRUCTION,
} from '../routes/chatValidation';
import type { OpenAIMessage } from '../services/openaiClient';

describe('chatValidation.ts -- shared utility extraction tests', () => {
  // Test 1: validateBaselineJsonShape returns { valid: true } for well-formed baseline JSON
  it('validateBaselineJsonShape returns valid: true for a well-formed architecture baseline JSON object', () => {
    const wellFormed = {
      services: [{ name: 'API Gateway', description: 'Entry point' }],
      interfaces: [],
      interfaceEndpoints: [],
      logicalDataEntities: [{ name: 'User', description: 'User entity' }],
      physicalDataEntities: [],
      businessLogic: [],
      dataMovements: [],
    };

    const result = validateBaselineJsonShape(wellFormed);

    expect(result).toEqual({ valid: true });
  });

  // Test 2: validateBaselineJsonShape returns { valid: false, error } for malformed objects
  it('validateBaselineJsonShape returns valid: false for a malformed object (missing required top-level structure)', () => {
    // Null is not a plain object
    const nullResult = validateBaselineJsonShape(null);
    expect(nullResult.valid).toBe(false);
    expect(nullResult.error).toBeDefined();

    // Array is not a plain object
    const arrayResult = validateBaselineJsonShape([{ services: [] }]);
    expect(arrayResult.valid).toBe(false);
    expect(arrayResult.error).toBeDefined();

    // Object with a known array field set to a non-array value
    const badFieldResult = validateBaselineJsonShape({
      services: 'not-an-array',
      interfaces: [],
    });
    expect(badFieldResult.valid).toBe(false);
    expect(badFieldResult.error).toContain('services');
    expect(badFieldResult.error).toContain('not an array');
  });

  // Test 3: ensureMinimumServices adds default "Core Application Service" when services is empty
  it('ensureMinimumServices adds a default "Core Application Service" when the services array is empty', () => {
    const parsed: Record<string, unknown> = {
      services: [],
      interfaces: [],
    };

    const result = ensureMinimumServices(parsed);

    expect(result.services).toEqual([
      { name: 'Core Application Service', description: 'Default service' },
    ]);
    // Verify it returns the same mutated object
    expect(result).toBe(parsed);
  });

  // Test 4: buildConversationTranscript concatenates messages with role labels
  it('buildConversationTranscript concatenates OpenAIMessage objects into a single string with role labels', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: 'You are an architect assistant.' },
      { role: 'user', content: 'Design a microservices architecture.' },
      { role: 'assistant', content: 'Here is a proposed architecture with 3 services.' },
      { role: 'user', content: 'Can you add a gateway service?' },
      { role: 'assistant', content: 'I have added an API Gateway service.' },
    ];

    const transcript = buildConversationTranscript(messages);

    // System messages should be excluded
    expect(transcript).not.toContain('system');
    expect(transcript).not.toContain('You are an architect assistant.');

    // User and assistant messages should be formatted with role labels
    expect(transcript).toBe(
      'User: Design a microservices architecture.\n' +
      'Assistant: Here is a proposed architecture with 3 services.\n' +
      'User: Can you add a gateway service?\n' +
      'Assistant: I have added an API Gateway service.'
    );
  });

  // Bonus: verify the BASELINE_JSON_CORRECTIVE_INSTRUCTION constant is exported and has expected content
  it('BASELINE_JSON_CORRECTIVE_INSTRUCTION is a non-empty string mentioning ArchitectureBaselineInput schema', () => {
    expect(typeof BASELINE_JSON_CORRECTIVE_INSTRUCTION).toBe('string');
    expect(BASELINE_JSON_CORRECTIVE_INSTRUCTION.length).toBeGreaterThan(0);
    expect(BASELINE_JSON_CORRECTIVE_INSTRUCTION).toContain('ArchitectureBaselineInput');
  });
});
