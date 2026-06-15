/**
 * Tests for v2 conversation engine config extension
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 2: Config Extension
 *
 * Tests:
 * 1. registryBasePath defaults to path.resolve(__dirname, 'config') when env var is absent
 * 2. registryBasePath is overridden when REGISTRY_BASE_PATH env var is set
 *
 * Note: threadPersistBasePath was removed — thread storage now resolves paths
 * via fetchProjectFolder from architectureModelClient.
 */

import path from 'path';

describe('Config V2 Fields (Spec 2026-02-28)', () => {
  // Store original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to clear cached config
    jest.resetModules();
    // Clone the original environment
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should default registryBasePath to path.resolve(__dirname, "config") when REGISTRY_BASE_PATH env var is absent', () => {
    // Set required variable
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Require first (triggers dotenv.config()), then clear the env var
    const { loadConfig } = require('../config');
    delete process.env.REGISTRY_BASE_PATH;
    const config = loadConfig();

    // __dirname in the compiled config module points to gateway/src (or dist equivalent)
    // The default should resolve to the 'config' subdirectory relative to config.ts location
    const expectedPath = path.resolve(path.dirname(require.resolve('../config')), 'config');
    expect(config.registryBasePath).toBe(expectedPath);
  });

  it('should override registryBasePath when REGISTRY_BASE_PATH env var is set', () => {
    // Set required variable
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.REGISTRY_BASE_PATH = '/custom/registry/path';

    const { loadConfig } = require('../config');
    const config = loadConfig();

    expect(config.registryBasePath).toBe('/custom/registry/path');
  });
});
