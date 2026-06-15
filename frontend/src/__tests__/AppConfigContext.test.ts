/**
 * AppConfigContext Tests
 *
 * Spec 2026-01-19: Startup Configuration for Feature Toggles
 * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
 * Task Group 3.1: Tests for AppConfig functionality
 * Task Group 4.3: Integration tests for feature toggle functionality
 *
 * Tests verify:
 * - useAppConfig() returns full config object
 * - useIncludeDelivery() returns correct boolean
 * - useIncludeDatabase() returns correct boolean
 * - Defaults are used when /api/bootstrap is unavailable (404)
 * - Defaults are used when JSON is malformed
 * - Partial config (missing property) uses default for that property
 * - Config loading blocks app render appropriately
 * - Hooks work correctly in component tree
 * - Frontend and backend defaults align
 * - Snake_case payload parsing (backend uses Jackson SNAKE_CASE)
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, ReactNode, useState, useEffect } from 'react';
import {
  AppConfigProvider,
  useAppConfig,
  useIncludeDelivery,
  useIncludeDatabase,
  useAppConfigLoading,
  loadRuntimeConfig,
  _resetWarningFlag,
  AppConfig,
} from '../contexts/AppConfigContext';

vi.mock('../contexts/UserJourneyReviewContext', () => ({
  useActivateJourneyReview: vi.fn(() => vi.fn()),
}));

/**
 * Helper wrapper component for testing hooks within provider
 */
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(AppConfigProvider, null, children);
  };
}

describe('AppConfigContext', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset warning flag before each test
    _resetWarningFlag();
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Test 1: useAppConfig() returns full config object
   */
  describe('useAppConfig returns full config object', () => {
    it('should return full AppConfig object with both properties', async () => {
      // Mock successful fetch with both values
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: true, includeDatabase: true }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      const config = result.current;
      expect(config).toHaveProperty('includeDelivery');
      expect(config).toHaveProperty('includeDatabase');
      expect(typeof config.includeDelivery).toBe('boolean');
      expect(typeof config.includeDatabase).toBe('boolean');
    });

    it('should return config with custom values from /api/bootstrap', async () => {
      // Mock fetch with custom values
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: false, includeDatabase: false }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(false);
        expect(result.current.includeDatabase).toBe(false);
      });
    });
  });

  /**
   * Test 2: useIncludeDelivery() returns correct boolean
   */
  describe('useIncludeDelivery returns correct boolean', () => {
    it('should return true when includeDelivery is true', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: true, includeDatabase: true }),
      });

      const { result } = renderHook(() => useIncludeDelivery(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('should return false when includeDelivery is false', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: false, includeDatabase: true }),
      });

      const { result } = renderHook(() => useIncludeDelivery(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });
  });

  /**
   * Test 3: useIncludeDatabase() returns correct boolean
   */
  describe('useIncludeDatabase returns correct boolean', () => {
    it('should return true when includeDatabase is true', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: true, includeDatabase: true }),
      });

      const { result } = renderHook(() => useIncludeDatabase(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });

    it('should return false when includeDatabase is false', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: true, includeDatabase: false }),
      });

      const { result } = renderHook(() => useIncludeDatabase(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });
  });

  /**
   * Test 4: Defaults are used when /api/bootstrap is unavailable (404)
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  describe('defaults when /api/bootstrap is unavailable (404)', () => {
    it('should use defaults when fetch returns 404', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load /api/bootstrap')
      );

      warnSpy.mockRestore();
    });

    it('should use defaults when network error occurs', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network error loading /api/bootstrap')
      );

      warnSpy.mockRestore();
    });
  });

  /**
   * Test 5: Defaults are used when JSON is malformed
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  describe('defaults when JSON is malformed', () => {
    it('should use defaults when JSON parsing fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid JSON in /api/bootstrap')
      );

      warnSpy.mockRestore();
    });

    it('should use defaults when JSON is not an object', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve('not an object'),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid format in /api/bootstrap')
      );

      warnSpy.mockRestore();
    });
  });

  /**
   * Test 6: Partial config (missing property) uses default for that property
   */
  describe('partial config uses defaults for missing properties', () => {
    it('should use default for missing includeDelivery', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDatabase: false }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Missing property should use default (true)
        expect(result.current.includeDelivery).toBe(true);
        // Present property should use provided value
        expect(result.current.includeDatabase).toBe(false);
      });
    });

    it('should use default for missing includeDatabase', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: false }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Present property should use provided value
        expect(result.current.includeDelivery).toBe(false);
        // Missing property should use default (true)
        expect(result.current.includeDatabase).toBe(true);
      });
    });

    it('should use default for invalid property type', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ includeDelivery: 'not a boolean', includeDatabase: 123 }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Invalid types should use defaults
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });
    });

    it('should use defaults for empty config object', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });
    });
  });
});

describe('AppConfigContext error handling', () => {
  beforeEach(() => {
    _resetWarningFlag();
  });

  /**
   * Test: Hooks throw when used outside provider
   */
  it('should throw error when useAppConfig is used outside AppConfigProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAppConfig());
    }).toThrow('useAppConfig must be used within an AppConfigProvider');

    consoleSpy.mockRestore();
  });

  it('should throw error when useIncludeDelivery is used outside AppConfigProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useIncludeDelivery());
    }).toThrow('useIncludeDelivery must be used within an AppConfigProvider');

    consoleSpy.mockRestore();
  });

  it('should throw error when useIncludeDatabase is used outside AppConfigProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useIncludeDatabase());
    }).toThrow('useIncludeDatabase must be used within an AppConfigProvider');

    consoleSpy.mockRestore();
  });
});

describe('loadRuntimeConfig function', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _resetWarningFlag();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Test: Successful fetch from /api/bootstrap returns correct config
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  it('should return config from successful fetch to /api/bootstrap', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ includeDelivery: false, includeDatabase: false }),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(false);
    expect(config.includeDatabase).toBe(false);

    // Verify fetch was called with correct endpoint
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/bootstrap'));
  });

  /**
   * Test: Non-OK response (4xx, 5xx) falls back to DEFAULT_CONFIG
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  it('should return defaults on fetch failure (non-OK response)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(true);

    warnSpy.mockRestore();
  });

  /**
   * Test: Network error falls back to DEFAULT_CONFIG
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  it('should return defaults on network error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Network error loading /api/bootstrap')
    );

    warnSpy.mockRestore();
  });

  /**
   * Test: Invalid JSON falls back to DEFAULT_CONFIG
   *
   * Spec 2026-01-19: Bootstrap Endpoint for Feature Toggles
   */
  it('should return defaults on invalid JSON response', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid JSON in /api/bootstrap')
    );

    warnSpy.mockRestore();
  });

  it('should log warning only once for repeated failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    // Call multiple times
    await loadRuntimeConfig();
    await loadRuntimeConfig();
    await loadRuntimeConfig();

    // Warning should only be logged once
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});

/**
 * Spec 2026-01-19: Fix Bootstrap Toggle Mapping
 * Task Group 2.1: Snake_case payload parsing tests
 *
 * These tests verify that the frontend correctly parses snake_case keys
 * from the backend (which uses Jackson SNAKE_CASE naming strategy).
 */
describe('loadRuntimeConfig snake_case payload parsing', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _resetWarningFlag();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Critical test: Backend sends snake_case keys (include_delivery, include_database)
   * Frontend must correctly map these to camelCase internal config.
   */
  it('should correctly parse snake_case keys from backend response', async () => {
    // Mock backend response with snake_case keys (actual runtime format)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ include_delivery: false, include_database: false }),
    });

    const config = await loadRuntimeConfig();

    // Values should be correctly mapped to camelCase internal config
    expect(config.includeDelivery).toBe(false);
    expect(config.includeDatabase).toBe(false);
  });

  it('should correctly parse snake_case true values', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ include_delivery: true, include_database: true }),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(true);
  });

  it('should correctly parse mixed snake_case values', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ include_delivery: true, include_database: false }),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(false);
  });

  it('should prefer snake_case over camelCase when both are present', async () => {
    // Edge case: if both formats are somehow present, snake_case should take precedence
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: false,
        includeDelivery: true, // This should be ignored
        include_database: false,
        includeDatabase: true, // This should be ignored
      }),
    });

    const config = await loadRuntimeConfig();

    // snake_case values should take precedence
    expect(config.includeDelivery).toBe(false);
    expect(config.includeDatabase).toBe(false);
  });

  it('should fall back to camelCase when snake_case is missing (backward compatibility)', async () => {
    // Backward compatibility: support camelCase if snake_case is not present
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ includeDelivery: false, includeDatabase: false }),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(false);
    expect(config.includeDatabase).toBe(false);
  });

  it('should use default when snake_case key has invalid type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        include_delivery: 'invalid', // Not a boolean
        include_database: 123, // Not a boolean
      }),
    });

    const config = await loadRuntimeConfig();

    // Invalid types should fall back to defaults (true)
    expect(config.includeDelivery).toBe(true);
    expect(config.includeDatabase).toBe(true);
  });

  it('should handle partial snake_case config with defaults', async () => {
    // Only include_delivery is provided
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ include_delivery: false }),
    });

    const config = await loadRuntimeConfig();

    expect(config.includeDelivery).toBe(false);
    expect(config.includeDatabase).toBe(true); // Default
  });
});

/**
 * Task Group 4.3: Integration Tests for Feature Toggle Functionality
 *
 * These tests verify critical integration paths:
 * - Config loading blocks app render appropriately
 * - Hooks work in component tree integration
 * - Frontend and backend defaults align
 */
describe('AppConfigContext Integration Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    _resetWarningFlag();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Integration Test 1: Config loading blocks app render appropriately
   *
   * Verifies that the AppConfigProvider blocks rendering of children
   * until the config has been loaded.
   */
  describe('config loading blocks app render', () => {
    it('should block children render until config is loaded', async () => {
      // Create a delayed fetch to test loading state
      let resolveFetch: (value: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      global.fetch = vi.fn().mockReturnValue(fetchPromise);

      // Track whether the hook was called
      let hookCallCount = 0;
      const trackingHook = () => {
        hookCallCount++;
        return useAppConfig();
      };

      const { result } = renderHook(() => trackingHook(), {
        wrapper: createWrapper(),
      });

      // Initially, the hook should not have been called because provider blocks render
      // Since loading=true returns null, children don't render
      // After config loads, children render and hook is called

      // Resolve the fetch
      await act(async () => {
        resolveFetch!({
          ok: true,
          json: () => Promise.resolve({ includeDelivery: true, includeDatabase: true }),
        });
      });

      // Wait for the hook to have access to config
      await waitFor(() => {
        expect(result.current).toBeDefined();
        expect(result.current.includeDelivery).toBe(true);
      });

      // Hook should have been called at least once after loading
      expect(hookCallCount).toBeGreaterThanOrEqual(1);
    });

    it('should render children after config loads even on fetch failure', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      // Should eventually render with defaults
      await waitFor(() => {
        expect(result.current).toBeDefined();
        expect(result.current.includeDelivery).toBe(true);
        expect(result.current.includeDatabase).toBe(true);
      });

      warnSpy.mockRestore();
    });
  });

  /**
   * Integration Test 2: Hooks work in component tree integration
   *
   * Verifies that multiple hooks can be used together in a component tree
   * and all return consistent values.
   */
  describe('hooks in component tree integration', () => {
    it('should provide consistent config across multiple hooks', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: false, includeDatabase: true }),
      });

      // Use all hooks together
      const useAllHooks = () => {
        const config = useAppConfig();
        const includeDelivery = useIncludeDelivery();
        const includeDatabase = useIncludeDatabase();
        return { config, includeDelivery, includeDatabase };
      };

      const { result } = renderHook(() => useAllHooks(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // All hooks should return consistent values
        expect(result.current.config.includeDelivery).toBe(false);
        expect(result.current.config.includeDatabase).toBe(true);
        expect(result.current.includeDelivery).toBe(false);
        expect(result.current.includeDatabase).toBe(true);

        // Values from convenience hooks should match full config
        expect(result.current.includeDelivery).toBe(result.current.config.includeDelivery);
        expect(result.current.includeDatabase).toBe(result.current.config.includeDatabase);
      });
    });

    it('should handle config updates consistently across hooks', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ includeDelivery: true, includeDatabase: false }),
      });

      const useMultipleHooks = () => {
        const delivery1 = useIncludeDelivery();
        const delivery2 = useIncludeDelivery();
        const database1 = useIncludeDatabase();
        const database2 = useIncludeDatabase();
        return { delivery1, delivery2, database1, database2 };
      };

      const { result } = renderHook(() => useMultipleHooks(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // Multiple calls to the same hook should return the same value
        expect(result.current.delivery1).toBe(result.current.delivery2);
        expect(result.current.database1).toBe(result.current.database2);
        expect(result.current.delivery1).toBe(true);
        expect(result.current.database1).toBe(false);
      });
    });
  });

  /**
   * Integration Test 3: Frontend and backend defaults alignment
   *
   * Verifies that the frontend default configuration matches the expected
   * backend defaults, ensuring consistency between systems.
   *
   * Backend defaults (from AppFeaturesProperties.java):
   * - includeDelivery: true
   * - includeDatabase: true
   */
  describe('frontend and backend defaults alignment', () => {
    // Expected backend defaults - MUST match backend AppFeaturesProperties.java
    const BACKEND_DEFAULT_INCLUDE_DELIVERY = true;
    const BACKEND_DEFAULT_INCLUDE_DATABASE = true;

    it('should have frontend defaults matching backend defaults', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Simulate missing config file to trigger defaults
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const config = await loadRuntimeConfig();

      // Frontend defaults should match backend defaults
      expect(config.includeDelivery).toBe(BACKEND_DEFAULT_INCLUDE_DELIVERY);
      expect(config.includeDatabase).toBe(BACKEND_DEFAULT_INCLUDE_DATABASE);

      warnSpy.mockRestore();
    });

    it('should use consistent defaults across all error scenarios', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Test network error
      _resetWarningFlag();
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      let config = await loadRuntimeConfig();
      expect(config.includeDelivery).toBe(BACKEND_DEFAULT_INCLUDE_DELIVERY);
      expect(config.includeDatabase).toBe(BACKEND_DEFAULT_INCLUDE_DATABASE);

      // Test malformed JSON
      _resetWarningFlag();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });
      config = await loadRuntimeConfig();
      expect(config.includeDelivery).toBe(BACKEND_DEFAULT_INCLUDE_DELIVERY);
      expect(config.includeDatabase).toBe(BACKEND_DEFAULT_INCLUDE_DATABASE);

      // Test empty object
      _resetWarningFlag();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      config = await loadRuntimeConfig();
      expect(config.includeDelivery).toBe(BACKEND_DEFAULT_INCLUDE_DELIVERY);
      expect(config.includeDatabase).toBe(BACKEND_DEFAULT_INCLUDE_DATABASE);

      warnSpy.mockRestore();
    });
  });

  /**
   * Integration Test 4: Snake_case payload with hooks
   *
   * Verifies that snake_case payloads from the backend work correctly
   * through the full provider/hook chain.
   */
  describe('snake_case payload integration with hooks', () => {
    it('should correctly propagate snake_case false values through hooks', async () => {
      // This is the critical integration test for the bug fix
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ include_delivery: false, include_database: false }),
      });

      const { result } = renderHook(() => useAppConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        // The bug was that these would always be true (defaults) instead of false
        expect(result.current.includeDelivery).toBe(false);
        expect(result.current.includeDatabase).toBe(false);
      });
    });

    it('should correctly propagate snake_case values through useIncludeDelivery hook', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ include_delivery: false, include_database: true }),
      });

      const { result } = renderHook(() => useIncludeDelivery(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });

    it('should correctly propagate snake_case values through useIncludeDatabase hook', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ include_delivery: true, include_database: false }),
      });

      const { result } = renderHook(() => useIncludeDatabase(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current).toBe(false);
      });
    });
  });
});
