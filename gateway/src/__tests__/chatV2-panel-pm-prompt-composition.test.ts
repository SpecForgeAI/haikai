/**
 * Tests for Prompt Composition with Product/Roadmap Panel Context Injection
 *
 * Spec 2026-03-01: Side Panel v2 -- Product and Roadmap Screens (Increment 9)
 * Task Group 2: Prompt File Updates for PM Panel Tasks
 *
 * Tests:
 * 1. composeSystemPrompt with product/roadmap context sections produces prompt
 *    containing === PRODUCT SUMMARY ===, === ROADMAP SUMMARY ===, and
 *    === SCREEN CONTEXT === markers with content
 * 2. composeSystemPrompt with empty resolvedContext produces prompt without
 *    any context section markers
 *
 * Uses initializeRegistries() to populate persona and task maps before
 * calling composeSystemPrompt.
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

describe('Prompt Composition with PM Panel Context (Spec 2026-03-01, Task Group 2)', () => {
  // Initialize registries once before all tests in this suite
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: composeSystemPrompt with product/roadmap context sections produces
  //         prompt containing === PRODUCT SUMMARY ===, === ROADMAP SUMMARY ===,
  //         and === SCREEN CONTEXT === markers with content
  // ========================================================================
  it('should produce a prompt containing === PRODUCT SUMMARY ===, === ROADMAP SUMMARY ===, and === SCREEN CONTEXT === section markers when resolvedContext has content', async () => {
    const resolvedContext: Record<string, string> = {
      'PRODUCT SUMMARY': 'Product: My SaaS App\nMission: Defined\nInitiatives: 3\nEpics: 7',
      'ROADMAP SUMMARY': 'Initiative 1: User Management (3 epics)\nInitiative 2: Billing (2 epics)\nInitiative 3: Reporting (2 epics)',
      'SCREEN CONTEXT': 'The user is currently on the Product Definition tab, viewing their product definition and mission summary.',
    };

    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--backlog',
      null,
      resolvedContext
    );

    // Verify the === SECTION_NAME === delimiter markers are present
    expect(output).toContain('=== PRODUCT SUMMARY ===');
    expect(output).toContain('=== ROADMAP SUMMARY ===');
    expect(output).toContain('=== SCREEN CONTEXT ===');

    // Verify the actual context content is injected
    expect(output).toContain('Product: My SaaS App');
    expect(output).toContain('Initiative 1: User Management (3 epics)');
    expect(output).toContain('The user is currently on the Product Definition tab');

    // Verify the context guidance line from the updated prompt file is present
    expect(output).toContain('If provided below');
  });

  // ========================================================================
  // Test 2: composeSystemPrompt with empty resolvedContext produces prompt
  //         without any context section markers
  // ========================================================================
  it('should produce a prompt without context section markers when resolvedContext is empty', async () => {
    const output = await composeSystemPrompt(
      'product-manager',
      'product-manager--backlog',
      null,
      {}
    );

    // Verify no === SECTION_NAME === markers are present
    expect(output).not.toContain('=== PRODUCT SUMMARY ===');
    expect(output).not.toContain('=== ROADMAP SUMMARY ===');
    expect(output).not.toContain('=== SCREEN CONTEXT ===');

    // Verify the core prompt content is still present (from the original backlog task prompt)
    expect(output).toContain('backlog management');

    // Verify the conditional guidance is present (it is part of the prompt file itself)
    expect(output).toContain('If provided below');
  });
});
