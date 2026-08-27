/**
 * Config-load test. Asserts every spec-required env var has the right
 * default when the process env is empty.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
 * sub-task 4.1.
 *
 * The module reads `process.env` at import time, so each `it()` clears the
 * env (saving + restoring the snapshot) and uses `jest.isolateModules` to
 * force a fresh re-import.
 */

const ENV_KEYS = [
  'PORT',
  'ARCHITECTURE_MODEL_SERVICE_BASE_URL',
  'GATEWAY_BASE_URL',
  'OAS_SPECS_DIR',
  'LLM_SCENARIO_ROUND_LIMIT',
  'LLM_SCENARIO_RESEARCH_ROUND_CEILING',
  'MAX_RESPONSE_BODY_BYTES',
  'LLM_SETUP_ATTEMPTS_PER_SCENARIO',
  'LLM_TOOL_CALL_TIMEOUT_MS',
  'LLM_SCENARIO_WALL_CLOCK_MS',
] as const;

describe('api-migration-validation-service config defaults', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('defaults all 7 env vars when none are set', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const config = require('../config');

      expect(config.PORT).toBe(8092);
      expect(config.ARCHITECTURE_MODEL_SERVICE_BASE_URL).toBe('http://localhost:8080');
      expect(config.GATEWAY_BASE_URL).toBe('http://localhost:8081');
      expect(config.OAS_SPECS_DIR).toBe('./oas-specs');
      expect(config.LLM_SCENARIO_ROUND_LIMIT).toBe(12);
      expect(config.LLM_SCENARIO_RESEARCH_ROUND_CEILING).toBe(60);
      // Item #5 (2026-08-27): 8MB default so full bodies are stored and
      // reconciliation never compares marker-to-marker.
      expect(config.MAX_RESPONSE_BODY_BYTES).toBe(8 * 1024 * 1024);
      // Item #3 (2026-08-27): setup calls have their own budget.
      expect(config.LLM_SETUP_ATTEMPTS_PER_SCENARIO).toBe(10);
      // 180s since the LLM rate-limit program (Spec 2026-07-22): the 30s
      // default starved tool calls queued behind the shared 429 cool-down.
      expect(config.LLM_TOOL_CALL_TIMEOUT_MS).toBe(180000);
      expect(config.LLM_SCENARIO_WALL_CLOCK_MS).toBe(300000);
    });
  });

  it('overrides defaults from process env when set', () => {
    process.env.PORT = '9999';
    process.env.ARCHITECTURE_MODEL_SERVICE_BASE_URL = 'http://ams.example.com';
    process.env.GATEWAY_BASE_URL = 'http://gw.example.com';
    process.env.OAS_SPECS_DIR = '/tmp/oas';
    process.env.LLM_SCENARIO_ROUND_LIMIT = '24';
    process.env.LLM_SCENARIO_RESEARCH_ROUND_CEILING = '120';
    process.env.MAX_RESPONSE_BODY_BYTES = '1048576';
    process.env.LLM_SETUP_ATTEMPTS_PER_SCENARIO = '25';
    process.env.LLM_TOOL_CALL_TIMEOUT_MS = '60000';
    process.env.LLM_SCENARIO_WALL_CLOCK_MS = '600000';

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const config = require('../config');

      expect(config.PORT).toBe(9999);
      expect(config.ARCHITECTURE_MODEL_SERVICE_BASE_URL).toBe('http://ams.example.com');
      expect(config.GATEWAY_BASE_URL).toBe('http://gw.example.com');
      expect(config.OAS_SPECS_DIR).toBe('/tmp/oas');
      expect(config.LLM_SCENARIO_ROUND_LIMIT).toBe(24);
      expect(config.LLM_SCENARIO_RESEARCH_ROUND_CEILING).toBe(120);
      expect(config.MAX_RESPONSE_BODY_BYTES).toBe(1048576);
      expect(config.LLM_SETUP_ATTEMPTS_PER_SCENARIO).toBe(25);
      expect(config.LLM_TOOL_CALL_TIMEOUT_MS).toBe(60000);
      expect(config.LLM_SCENARIO_WALL_CLOCK_MS).toBe(600000);
    });
  });
});
