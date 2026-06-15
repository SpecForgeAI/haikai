/**
 * Tests for Prompt Composition Pipeline
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 6: Prompt Composition Pipeline
 *
 * Tests:
 * 1. Composing product-manager--define-product produces output containing all key content sections
 * 2. Composing architect--define-architecture produces output containing all key content sections
 * 3. Composing product-manager--roadmap produces output containing all key content sections
 * 4. Persona identity content appears at the top of the composed prompt (before task instructions)
 * 5. Context sections are delimited with === SECTION_NAME === markers
 * 6. Response format contract from the task definition is appended at the end
 *
 * Uses initializeRegistries() to populate the persona and task maps before
 * calling composeSystemPrompt. Tests verify key CONTENT sections are present
 * (e.g., "## QUESTION STRATEGY", "## RESPONSE FORMAT", "## RULES") -- NOT
 * character-for-character match.
 */

import path from 'path';

// Mock the config module to point registryBasePath at the real config directory
const realConfigDir = path.resolve(__dirname, '..', 'config');

jest.mock('../config', () => ({
  getConfig: () => ({
    registryBasePath: realConfigDir,
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 120000,
    logLevel: 'error',
  }),
}));

// Mock the logger to suppress output during tests
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { initializeRegistries } from '../services/registryLoader';
import { composeSystemPrompt } from '../services/promptComposer';

describe('Prompt Composition Pipeline (Spec 2026-02-28, Task Group 6)', () => {
  // Initialize registries once before all tests in this suite
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: product-manager--define-product contains all key content sections
  // ========================================================================
  it('should produce output containing all key content sections from PRODUCT_MANAGER_PROMPT_TEMPLATE for product-manager--define-product', async () => {
    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--define-product',
      null,
      {}
    );

    // Key content sections from the product-manager.define-product.task.md
    expect(output).toContain('## RESPONSE FORMAT');
    expect(output).toContain('## RULES');
    expect(output).toContain('## QUESTION STRATEGY');
    expect(output).toContain('## SUFFICIENCY TRACKING');
    expect(output).toContain('## YOUR ROLE');
    expect(output).toContain('## MINIMUM REQUIRED INFORMATION');

    // Verify specific content markers
    expect(output).toContain('"phase": "questions"');
    expect(output).toContain('"questions"');
    expect(output).toContain('"summary"');
  });

  // ========================================================================
  // Test 2: architect--define-architecture contains all key content sections
  // ========================================================================
  it('should produce output containing all key content sections from SOLUTION_ARCHITECT_PROMPT_TEMPLATE for architect--define-architecture', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--define-architecture',
      null,
      {}
    );

    // Key content sections from the architect.define-architecture.task.md
    expect(output).toContain('## ARCHITECTURE DISCOVERY SECTIONS');
    expect(output).toContain('## QUESTION STRATEGY');
    expect(output).toContain('## READINESS GATE');
    expect(output).toContain('## RESPONSE FORMAT');
    expect(output).toContain('## RULES');
    expect(output).toContain('## DOCUMENT-AWARE ADAPTIVE STRATEGY');
    expect(output).toContain('## SECTION PROGRESSION');
    expect(output).toContain('## DEPTH PRINCIPLE');
    expect(output).toContain('## HANDLING UNCERTAINTY');
    expect(output).toContain('## CONTEXT ALIGNMENT');

    // Verify specific content markers
    expect(output).toContain('document_intake');
    expect(output).toContain('context_and_boundaries');
    expect(output).toContain('service_decomposition');
    expect(output).toContain('final_review');
  });

  // ========================================================================
  // Test 3: product-manager--roadmap contains all key content sections
  // ========================================================================
  it('should produce output containing all key content sections from ROADMAP_PM_PROMPT_TEMPLATE for product-manager--roadmap', async () => {
    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--roadmap',
      null,
      {}
    );

    // Key content sections from the product-manager.roadmap.task.md
    expect(output).toContain('## ROADMAP DISCOVERY SECTIONS');
    expect(output).toContain('## RESPONSE FORMAT');
    expect(output).toContain('## RULES');
    expect(output).toContain('## QUESTION STRATEGY');
    expect(output).toContain('## CONTEXT ALIGNMENT');
    expect(output).toContain('## HANDLING UNCERTAINTY');

    // Verify roadmap-specific content markers (section enum is exactly these 5)
    expect(output).toContain('outcome_alignment');
    expect(output).toContain('sequencing_strategy');
    expect(output).toContain('initiative_structure');
    expect(output).toContain('epic_structure');
    expect(output).toContain('final_review');

    // Verify proposedInitiatives field is mentioned
    expect(output).toContain('proposedInitiatives');
    expect(output).toContain('assumptions');
    expect(output).toContain('openItems');
  });

  // ========================================================================
  // Test 4: Persona identity content appears at the top (before task instructions)
  // ========================================================================
  it('should place persona identity content at the top of the composed prompt before task instructions', async () => {
    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--define-product',
      null,
      {}
    );

    // The product-manager identity starts with "You are a Senior Product Manager"
    const identityMarker = 'Senior Product Manager conducting structured product discovery';
    // The task prompt starts with "## YOUR ROLE"
    const taskMarker = '## YOUR ROLE';

    const identityPos = output.indexOf(identityMarker);
    const taskPos = output.indexOf(taskMarker);

    // Both must be present
    expect(identityPos).toBeGreaterThanOrEqual(0);
    expect(taskPos).toBeGreaterThan(0);

    // Identity must come before task instructions
    expect(identityPos).toBeLessThan(taskPos);
  });

  // ========================================================================
  // Test 5: Context sections delimited with === SECTION_NAME === markers
  // ========================================================================
  it('should delimit context sections with === SECTION_NAME === markers matching the existing buildSystemPrompt pattern', async () => {
    const resolvedContext: Record<string, string> = {
      'PRODUCT MISSION': 'Build the best product in the world.',
      'TECHNICAL STANDARDS': 'Use TypeScript, Node.js, and PostgreSQL.',
    };

    const output = await composeSystemPrompt(
      'architect',
      'architect--define-architecture',
      null,
      resolvedContext
    );

    // Verify the === SECTION_NAME === delimiter pattern
    expect(output).toContain('=== PRODUCT MISSION ===');
    expect(output).toContain('Build the best product in the world.');
    expect(output).toContain('=== TECHNICAL STANDARDS ===');
    expect(output).toContain('Use TypeScript, Node.js, and PostgreSQL.');

    // Verify the delimiter format matches: === NAME ===\ncontent
    const missionIndex = output.indexOf('=== PRODUCT MISSION ===');
    const missionContentIndex = output.indexOf('Build the best product in the world.');
    expect(missionContentIndex).toBeGreaterThan(missionIndex);

    // Verify that empty context values are skipped
    const resolvedContextWithEmpty: Record<string, string> = {
      'PRODUCT MISSION': 'A real mission.',
      'TECHNICAL STANDARDS': '',
      'EMPTY SECTION': '   ',
    };

    const outputWithEmpty = await composeSystemPrompt(
      'architect',
      'architect--define-architecture',
      null,
      resolvedContextWithEmpty
    );

    expect(outputWithEmpty).toContain('=== PRODUCT MISSION ===');
    expect(outputWithEmpty).not.toContain('=== TECHNICAL STANDARDS ===');
    expect(outputWithEmpty).not.toContain('=== EMPTY SECTION ===');
  });

  // ========================================================================
  // Test 6: Response format contract appended at the end of the composed prompt
  // ========================================================================
  it('should append the response format contract from the task definition at the end of the composed prompt', async () => {
    // Test with a task that HAS a responseFormat (product-manager--define-product)
    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--define-product',
      null,
      {}
    );

    // The response format contract section should be present
    expect(output).toContain('=== RESPONSE FORMAT CONTRACT ===');
    expect(output).toContain('You MUST structure your response as a JSON object conforming to the following schema:');

    // The response format contract should be at the end of the prompt
    const contractIndex = output.indexOf('=== RESPONSE FORMAT CONTRACT ===');
    const taskContentIndex = output.indexOf('## YOUR ROLE');
    expect(contractIndex).toBeGreaterThan(taskContentIndex);

    // The JSON schema fields from the task definition should be present
    expect(output).toContain('"phase"');
    expect(output).toContain('"questions"');
    expect(output).toContain('"summary"');

    // Test with a task that has NO responseFormat (architect--tech-standards
    // is still advisory with responseFormat null; oas-spec gained a contract)
    const outputNoFormat = await composeSystemPrompt(
      'architect',
      'architect--tech-standards',
      null,
      {}
    );

    // The response format contract section should NOT be present
    expect(outputNoFormat).not.toContain('=== RESPONSE FORMAT CONTRACT ===');
    expect(outputNoFormat).not.toContain('You MUST structure your response as a JSON object conforming to the following schema:');
  });
});
