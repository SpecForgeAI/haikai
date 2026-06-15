/**
 * Tests for saveTargetResolution declarations on the 6 architect + UX
 * architecture-scoped task JSONs.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 3 (saveTargetResolution declarations on the 6 task JSONs).
 *
 * Verifies that the 6 task JSON files load through the registry loader
 * with the expected `saveTargetResolution` value:
 *   - bound-by-system-prompt: architect--define-architecture,
 *     architect--detailed-data-model, architect--generate-architecture-diagram
 *   - derived-from-context: architect--oas-spec
 *   - clarify-at-save: ux-designer--users-interactions, ux-designer--ui-domain
 *
 * This is a declarative configuration test -- it does not exercise prompt
 * composition or save-flow behaviour (those are covered by Groups 4-10).
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

import { initializeRegistries, getTaskRegistry } from '../services/registryLoader';

describe('saveTargetResolution declarations on task JSONs (Spec #5 Group 3)', () => {
  beforeAll(async () => {
    await initializeRegistries();
  });

  it('declares the correct saveTargetResolution mode for each of the 6 architecture-scoped tasks', () => {
    const tasks = getTaskRegistry();

    const expected: Record<
      string,
      'bound-by-system-prompt' | 'derived-from-context' | 'clarify-at-save'
    > = {
      'architect--define-architecture': 'bound-by-system-prompt',
      'architect--detailed-data-model': 'bound-by-system-prompt',
      'architect--generate-architecture-diagram': 'bound-by-system-prompt',
      'architect--oas-spec': 'derived-from-context',
      'ux-designer--users-interactions': 'clarify-at-save',
      'ux-designer--ui-domain': 'clarify-at-save',
    };

    for (const [taskId, expectedMode] of Object.entries(expected)) {
      const task = tasks.get(taskId);
      expect(task).toBeDefined();
      expect(task!.saveTargetResolution).toBe(expectedMode);
    }
  });

  it('keeps the spec #4 Discovery saveTargetResolution declarations intact (no regression)', () => {
    const tasks = getTaskRegistry();

    // Discovery tasks shipped in spec #4 Group 5; this spec must not regress them.
    const discoveryFraming = tasks.get('architect--discovery-framing');
    const discoveryQa = tasks.get('architect--discovery-qa');

    expect(discoveryFraming).toBeDefined();
    expect(discoveryFraming!.saveTargetResolution).toBe('bound-by-system-prompt');

    expect(discoveryQa).toBeDefined();
    expect(discoveryQa!.saveTargetResolution).toBe('bound-by-system-prompt');
  });
});
