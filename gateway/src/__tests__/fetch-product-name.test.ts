/**
 * Tests for fetchProductName function
 *
 * Tests cover:
 * - fetchProductName() returns product_name string when API responds 200 with valid JSON
 * - fetchProductName() returns null when API responds with non-OK status (e.g. 404)
 * - fetchProductName() returns null when fetch throws a network error; logs warning but does not throw
 * - fetchProductName() returns null when response JSON has no product_name field or it is empty
 *
 * Spec: 2026-02-12 Increment 5 - Wire Confirmation, Mission Generation, Tool Execution
 * Task Group 2: fetchProductName function tests
 */

// Mock the config
jest.mock('../config', () => ({
  getConfig: () => ({
    architectureModelServiceBaseUrl: 'http://localhost:8080',
  }),
}));

// Mock fetch for client tests
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('fetchProductName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return product_name string when API responds 200 with valid JSON containing product_name field', async () => {
    const mockResponse = {
      product_name: 'My Awesome Product',
      some_other_field: 'irrelevant',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const { fetchProductName } = require('../services/architectureModelClient');

    const result = await fetchProductName('test-project.json');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/projects/test-project.json/product',
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    expect(result).toBe('My Awesome Product');
  });

  it('should return null when API responds with non-OK status (e.g. 404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const { fetchProductName } = require('../services/architectureModelClient');

    const result = await fetchProductName('unknown-project.json');

    expect(result).toBeNull();
  });

  it('should return null when fetch throws a network error; logs warning but does not throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { fetchProductName } = require('../services/architectureModelClient');

    // Should not throw
    const result = await fetchProductName('test-project.json');

    expect(result).toBeNull();
  });

  it('should return null when response JSON has no product_name field or it is empty', async () => {
    // Test with missing product_name field
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ some_other_field: 'value' }),
    });

    const { fetchProductName: fetchProductName1 } = require('../services/architectureModelClient');
    const result1 = await fetchProductName1('test-project.json');
    expect(result1).toBeNull();

    // Reset modules to get fresh state
    jest.resetModules();

    // Test with empty string product_name
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ product_name: '' }),
    });

    const { fetchProductName: fetchProductName2 } = require('../services/architectureModelClient');
    const result2 = await fetchProductName2('test-project.json');
    expect(result2).toBeNull();

    // Reset modules to get fresh state
    jest.resetModules();

    // Test with whitespace-only product_name
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ product_name: '   ' }),
    });

    const { fetchProductName: fetchProductName3 } = require('../services/architectureModelClient');
    const result3 = await fetchProductName3('test-project.json');
    expect(result3).toBeNull();
  });
});
