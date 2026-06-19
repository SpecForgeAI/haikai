/**
 * Focused test for the new `LLM_HTTP_ATTEMPTS_PER_SCENARIO` env var.
 *
 * Spec: 2026-05-16 API Behaviour Capture Fixes -- Task Group 1 sub-task 1.1
 * (Decision D7).
 *
 * The module reads `process.env` at import time, so we save / restore the
 * env snapshot and use `jest.isolateModules` to force a fresh re-import
 * within each case. Pattern copied from `config.test.ts`.
 */

const KEY = 'LLM_HTTP_ATTEMPTS_PER_SCENARIO';

describe('LLM_HTTP_ATTEMPTS_PER_SCENARIO config', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
    delete process.env[KEY];
    jest.resetModules();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
  });

  it('defaults to 5 when the env var is unset', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const config = require('../config');
      expect(config.LLM_HTTP_ATTEMPTS_PER_SCENARIO).toBe(5);
    });
  });

  it('parses an explicit override from process.env', () => {
    process.env[KEY] = '7';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const config = require('../config');
      expect(config.LLM_HTTP_ATTEMPTS_PER_SCENARIO).toBe(7);
    });
  });
});
