/**
 * Tests for SA Increment 5: Architecture Baseline Generation Prompt Template
 *
 * Spec 2026-02-14: SA Increment 5 -- Wire Confirmation, Baseline Generation, Tool Execution
 * Task Group 2: Architecture Baseline Generation Prompt Template
 *
 * Tests:
 * 1. ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE is exported and is a non-empty string
 * 2. Template contains the placeholder tokens {missionContent}, {techStackContent}, and {conversationTranscript}
 * 3. Template contains the ArchitectureBaselineInput schema definition (check for key entity type names)
 * 4. Template contains the instruction "Return ONLY valid JSON matching the schema"
 */

import { ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE } from '../services/promptBuilder';

describe('SA Increment 5 - Architecture Baseline Generation Prompt Template (Task Group 2)', () => {
  it('Test 1: ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE is exported and is a non-empty string', () => {
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toBeDefined();
    expect(typeof ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toBe('string');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE.length).toBeGreaterThan(0);
  });

  it('Test 2: template contains the placeholder tokens {missionContent}, {techStackContent}, and {conversationTranscript}', () => {
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('{missionContent}');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('{techStackContent}');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('{conversationTranscript}');
  });

  it('Test 3: template contains the ArchitectureBaselineInput schema definition with all 7 entity type names', () => {
    // All 7 entity array names from the ArchitectureBaselineInput schema
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('services');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('interfaces');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('interfaceEndpoints');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('logicalDataEntities');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('physicalDataEntities');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('businessLogic');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('dataMovements');

    // Key type names from the schema definitions
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('ServiceInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('InterfaceInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('InterfaceEndpointInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('LogicalDataEntityInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('PhysicalDataEntityInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('BusinessLogicInput');
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('DataMovementInput');
  });

  it('Test 4: template contains the instruction "Return ONLY valid JSON matching the schema"', () => {
    expect(ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE).toContain('Return ONLY valid JSON matching the schema');
  });
});
