/**
 * Tests for Architecture Binding Injection in Prompt Composition --
 * `derived-from-context` mode.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 4 (composeSystemPrompt extended for `derived-from-context` mode).
 *
 * Verifies that `composeSystemPrompt` injects the literal line
 * `Architecture: <name> (id: <id>)` immediately after the persona identity
 * block when:
 *   - the active task's effective `saveTargetResolution` is
 *     `'derived-from-context'` AND an `architectureBinding` argument is
 *     supplied (i.e., the chatV2 caller has synthesised the binding from
 *     `Thread.metadata.boundArchitectureId` after the resolver has fired
 *     in a previous turn).
 *
 * And asserts the line is OMITTED when:
 *   - the active task's effective `saveTargetResolution` is
 *     `'derived-from-context'` but no binding has been established yet
 *     (the first conversation turn -- the LLM operates in "I need to
 *     identify the entity first" mode).
 *
 * Plus regression checks against spec #4 Group 5 behaviour for
 * `bound-by-system-prompt` and the defensive case for `clarify-at-save`.
 *
 * Forward-only: composeSystemPrompt is a pure function of its arguments
 * plus the persona/task config files; it does not read or write any
 * thread file on disk. The chatV2 caller (Group 6) is responsible for
 * synthesising the `architectureBinding` from
 * `Thread.metadata.boundArchitectureId` so the composer can stay pure.
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

describe('composeSystemPrompt -- derived-from-context binding (Spec #5 Group 4)', () => {
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: derived-from-context mode + binding present -> injects the line.
  //         architect--oas-spec is the V1 task using derived-from-context.
  //         When the chatV2 caller supplies the synthesised binding (after
  //         the resolver has fired in a previous turn), the composer MUST
  //         inject the line same as `bound-by-system-prompt`.
  // ========================================================================
  it('injects the architecture line for architect--oas-spec when a binding is supplied', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--oas-spec',
      null,
      {},
      { id: 'arch-uuid-oas-1', name: 'Target State' },
    );

    expect(output).toContain('Architecture: Target State (id: arch-uuid-oas-1)');
  });

  // ========================================================================
  // Test 2: derived-from-context mode + NO binding -> line omitted.
  //         This is the first-turn case: the LLM has not yet identified the
  //         target entity, so no binding has been resolved on the thread.
  //         The composer MUST omit the line so the LLM operates in
  //         "I need to identify the entity first" mode.
  // ========================================================================
  it('does NOT inject the line for architect--oas-spec when no binding is supplied (first turn)', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--oas-spec',
      null,
      {},
      null,
    );

    expect(output).not.toContain('Architecture:');
    expect(output).not.toContain('(id:');
  });

  // ========================================================================
  // Test 3: bound-by-system-prompt mode + binding present -> injects.
  //         Regression check from spec #4 Group 5 -- this Group 4 change
  //         (relaxing the gate from `=== 'bound-by-system-prompt'` to
  //         `=== 'bound-by-system-prompt' || === 'derived-from-context'`)
  //         must not regress the existing bound-mode injection.
  // ========================================================================
  it('still injects the architecture line for bound-by-system-prompt tasks (regression)', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--define-architecture',
      null,
      {},
      { id: 'arch-uuid-da-1', name: 'Current State' },
    );

    expect(output).toContain('Architecture: Current State (id: arch-uuid-da-1)');
  });

  // ========================================================================
  // Test 4: bound-by-system-prompt mode + NO binding -> line omitted.
  //         Defensive forward-only check -- a missing binding never
  //         fabricates a line, even on a bound task.
  // ========================================================================
  it('does NOT inject the line for a bound task when binding is absent', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--define-architecture',
      null,
      {},
      null,
    );

    expect(output).not.toContain('Architecture:');
    expect(output).not.toContain('(id:');
  });

  // ========================================================================
  // Test 5: clarify-at-save mode + binding present -> line NOT injected.
  //         For `clarify-at-save` the architecture is chosen at save-time
  //         via the picker modal, NOT bound at prompt-time. Even if a
  //         caller supplies an `architectureBinding` argument, the composer
  //         must not inject the line.
  // ========================================================================
  it('does NOT inject the line for clarify-at-save tasks even when binding is supplied', async () => {
    const output = await composeSystemPrompt(
      'ux-designer',
      'ux-designer--ui-domain',
      null,
      {},
      { id: 'arch-uuid-ux-1', name: 'Target State' },
    );

    expect(output).not.toContain('Architecture: Target State');
    expect(output).not.toContain('(id: arch-uuid-ux-1)');
  });
});
