/**
 * Tests for the swap-architecture hint in architect--generate-architecture-diagram
 * task prompt.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 5 (architect--generate-architecture-diagram task prompt swap-architecture
 * hint).
 *
 * Verifies that the task prompt for `architect--generate-architecture-diagram`
 * carries a static instructional sentence telling the LLM to surface a
 * swap-architecture hint in its first response, and that this static
 * instruction appears in the composed system prompt alongside the
 * `Architecture: <name> (id: <id>)` line that `bound-by-system-prompt` mode
 * injects (Spec #4 Group 5 / Spec #5 Group 4).
 *
 * Substitution model: the task prompt file is loaded as static text via
 * `fs.readFile` -- there is no template substitution at composition time.
 * The static instruction therefore tells the LLM to read the architecture
 * name verbatim from the `Architecture:` line in the system prompt and
 * parrot it in its opening user-facing message. The test asserts both
 * pieces are present in the composed system prompt.
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

describe('architect--generate-architecture-diagram swap-architecture hint (Spec #5 Group 5)', () => {
  beforeAll(async () => {
    await initializeRegistries();
  });

  // ========================================================================
  // Test 1: composed system prompt for architect--generate-architecture-diagram
  //         contains BOTH the `Architecture:` line (from bound-by-system-prompt
  //         injection) AND the swap-architecture instructional text from the
  //         task prompt file.
  //
  //         The bound-mode architecture name appears literally on the
  //         `Architecture: <name> (id: <id>)` line; the swap-architecture
  //         instruction directs the LLM to read that name and parrot it
  //         in its opening user-facing message.
  // ========================================================================
  it('contains the bound Architecture line AND the swap-architecture instructional sentence when binding is supplied', async () => {
    const output = await composeSystemPrompt(
      'architect',
      'architect--generate-architecture-diagram',
      null,
      {},
      { id: 'arch-uuid-erd-1', name: 'Target State' },
    );

    // The bound-mode architecture line MUST be present (Spec #4 Group 5
    // injection). The architect--generate-architecture-diagram task is
    // declared `bound-by-system-prompt` (Group 3 / spec).
    expect(output).toContain('Architecture: Target State (id: arch-uuid-erd-1)');

    // The architecture name appears literally on the injected line so the
    // LLM can read it and parrot it -- this is the substitution mechanism
    // for the static task-prompt instruction.
    expect(output).toContain('Target State');

    // The static swap-architecture instructional text from the task prompt
    // file MUST be present, with the exact wording the LLM is told to use
    // in its opening user-facing message.
    expect(output).toContain(
      'We are generating a diagram from architecture',
    );
    expect(output).toContain(
      'switch architecture in the selector if you want to generate from a different one.',
    );

    // The instruction MUST direct the LLM to read the name from the
    // Architecture: line above. Asserting the presence of a marker phrase
    // that ties the static instruction to the injected line.
    expect(output).toContain('Read the architecture name verbatim');
  });
});
