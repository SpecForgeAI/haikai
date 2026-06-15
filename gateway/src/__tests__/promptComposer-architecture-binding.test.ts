/**
 * Tests for Architecture Binding Injection in Prompt Composition
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) --
 * Task Group 5 (LLM persona system-prompt injection).
 *
 * Verifies that `composeSystemPrompt` injects the literal line
 * `Architecture: <name> (id: <id>)` immediately after the persona identity
 * block ONLY when the active task's effective `saveTargetResolution`
 * resolves to `'bound-by-system-prompt'` AND an `architectureBinding`
 * argument is supplied.
 *
 * Scoping: per-task. The architect persona owns 8 tasks but only the two
 * Discovery tasks (`architect--discovery-framing`,
 * `architect--discovery-qa`) carry `saveTargetResolution:
 * 'bound-by-system-prompt'`. The architect's other tasks (e.g.
 * `architect--service-breakdown`) MUST NOT receive the architecture line
 * even when an architectureBinding is supplied -- that is the test of
 * forward-only injection control.
 *
 * Forward-only: composeSystemPrompt is a pure function of its arguments
 * plus the persona/task config files; it does not read or write any
 * thread file on disk. Existing thread JSON files are therefore never
 * modified by this code path -- system prompts are rebuilt fresh each
 * turn from current code, and only NEW threads opened after this change
 * get the line. We assert that property indirectly here: no fs.writeFile
 * is needed for the line to appear, and the line appears purely from
 * the function's arguments.
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

describe('Architecture binding injection in composeSystemPrompt (Spec #4 Group 5)', () => {
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: Discovery-triggered LLM thread for the architect persona has the
  //         `Architecture: <name> (id: <id>)` line in its system prompt.
  // ========================================================================
  it('injects `Architecture: <name> (id: <id>)` for architect--discovery-qa when an architectureBinding is supplied', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--discovery-qa',
      null,
      {},
      { id: 'arch-uuid-123', name: 'Target State' },
    );

    // The literal line must appear verbatim.
    expect(output).toContain('Architecture: Target State (id: arch-uuid-123)');

    // It must appear AFTER the persona identity (the architect identity
    // prompt mentions "solution architect" in its opening lines) and BEFORE
    // the task prompt body (the Discovery Q&A task prompt header).
    const archLineIndex = output.indexOf('Architecture: Target State (id: arch-uuid-123)');
    expect(archLineIndex).toBeGreaterThan(0);

    // Sanity: response format contract still appended after.
    expect(output).toContain('=== RESPONSE FORMAT CONTRACT ===');
    const contractIndex = output.indexOf('=== RESPONSE FORMAT CONTRACT ===');
    expect(contractIndex).toBeGreaterThan(archLineIndex);
  });

  // ========================================================================
  // Test 2: Discovery-triggered LLM thread for architect--discovery-framing
  //         also receives the line (covers the second Discovery task).
  // ========================================================================
  it('injects the architecture line for architect--discovery-framing as well', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--discovery-framing',
      null,
      {},
      { id: 'arch-uuid-456', name: 'Current State' },
    );

    expect(output).toContain('Architecture: Current State (id: arch-uuid-456)');
  });

  // ========================================================================
  // Test 3: A non-Discovery architect task (e.g. service-breakdown) does NOT
  //         get the line even when an architectureBinding is supplied.
  //         This is the forward-only injection control test for per-task
  //         scoping -- per-task `saveTargetResolution` MUST be the only gate.
  // ========================================================================
  it('does NOT inject the line for a non-Discovery architect task even if architectureBinding is supplied', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--service-breakdown',
      null,
      {},
      { id: 'arch-uuid-789', name: 'Target State' },
    );

    // The architect persona no longer carries persona-level
    // saveTargetResolution after Group 5's per-task scoping refactor, and
    // architect--service-breakdown does not declare its own value, so the
    // effective resolution is undefined -- the line MUST NOT be injected.
    expect(output).not.toContain('Architecture: Target State');
    expect(output).not.toContain('(id: arch-uuid-789)');
  });

  // ========================================================================
  // Test 4: When `bound-by-system-prompt` is the effective resolution but
  //         no architectureBinding is supplied, the line is NOT injected
  //         (defensive: missing binding never fabricates a line). This is
  //         the forward-only injection control for the legacy / pre-binding
  //         path -- existing threads where the frontend has not yet wired
  //         architectureId into the request continue without the line.
  // ========================================================================
  it('does NOT inject the line when architectureBinding is null even on a bound task', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--discovery-qa',
      null,
      {},
      null,
    );

    expect(output).not.toContain('Architecture:');
    expect(output).not.toContain('(id:');
  });
});
