/**
 * Tests for Prompt Composition with Panel Context Injection
 *
 * Spec 2026-03-01: Side Panel v1 on Architecture/MetaModel Screen (Increment 8)
 * Task Group 2: Prompt File Updates for Context Acceptance
 *
 * Tests:
 * 1. composeSystemPrompt with context sections produces prompt containing
 *    === META MODEL SUMMARY === and === MISSION === markers with content
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

describe('Prompt Composition with Panel Context (Spec 2026-03-01, Task Group 2)', () => {
  // Initialize registries once before all tests in this suite
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: composeSystemPrompt with context sections produces prompt
  //         containing === META MODEL SUMMARY === and === MISSION === markers
  // ========================================================================
  it('should produce a prompt containing === META MODEL SUMMARY === and === MISSION === section markers when resolvedContext has content', async () => {
    const resolvedContext: Record<string, string> = {
      'META MODEL SUMMARY': '{"entities":["User","Order"],"services":["AuthService"]}',
      'MISSION': 'Build a world-class e-commerce platform that serves small businesses.',
    };

    const output = await composeSystemPrompt(
      'architect',
      'architect--service-breakdown',
      null,
      resolvedContext
    );

    // Verify the === SECTION_NAME === delimiter markers are present
    expect(output).toContain('=== META MODEL SUMMARY ===');
    expect(output).toContain('=== MISSION ===');

    // Verify the actual context content is injected
    expect(output).toContain('{"entities":["User","Order"],"services":["AuthService"]}');
    expect(output).toContain('Build a world-class e-commerce platform that serves small businesses.');

    // Verify the context guidance line from the updated prompt file is present
    expect(output).toContain('If provided below');
  });

  // ========================================================================
  // Test 2: composeSystemPrompt with empty resolvedContext produces prompt
  //         without any context section markers
  // ========================================================================
  it('should produce a prompt without context section markers when resolvedContext is empty', async () => {
    const output = await composeSystemPrompt(
      'test-engineer',
      'test-engineer--feature-tests',
      null,
      {}
    );

    // Verify no === SECTION_NAME === markers are present
    expect(output).not.toContain('=== META MODEL SUMMARY ===');
    expect(output).not.toContain('=== MISSION ===');
    expect(output).not.toContain('=== TECH STACK ===');
    expect(output).not.toContain('=== TEST STRATEGY ===');

    // Verify the core prompt content is still present
    expect(output).toContain('test cases');

    // Verify the conditional guidance is present (it is part of the prompt file itself)
    expect(output).toContain('If provided below');
  });
});
