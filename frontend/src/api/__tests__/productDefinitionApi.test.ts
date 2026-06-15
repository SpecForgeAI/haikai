/**
 * Tests for ProductDefinition API functions
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 * Task Group 2: Frontend API Module for ProductDefinition
 *
 * Tests:
 * 1. getProductDefinition returns ProductDefinitionDto on successful 200 response
 * 2. getProductDefinition returns null on 404 response (not an error)
 * 3. saveProductDefinition sends PUT with correct body and returns ProductDefinitionDto
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('productDefinitionApi', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  /**
   * Sample snake_case API response matching the backend's global Jackson
   * SNAKE_CASE naming strategy.
   */
  const snakeCaseApiResponse = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    project_id: '660e8400-e29b-41d4-a716-446655440001',
    product_name: 'My Product',
    created_at: '2026-02-12T10:00:00Z',
    updated_at: '2026-02-12T10:30:00Z',
  };

  /**
   * Expected camelCase DTO after mapping from snake_case response.
   */
  const expectedCamelCaseDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    projectId: '660e8400-e29b-41d4-a716-446655440001',
    productName: 'My Product',
    createdAt: '2026-02-12T10:00:00Z',
    updatedAt: '2026-02-12T10:30:00Z',
  };

  describe('getProductDefinition', () => {
    it('should return ProductDefinitionDto on successful 200 response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => snakeCaseApiResponse,
      });

      const { getProductDefinition } = await import('../productDefinitionApi');
      const result = await getProductDefinition('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual(expectedCamelCaseDto);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/projects/660e8400-e29b-41d4-a716-446655440001/product');
      expect(options.method).toBe('GET');
      expect(options.headers).toEqual({ 'Accept': 'application/json' });
    });

    it('should return null on 404 response (not an error)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const { getProductDefinition } = await import('../productDefinitionApi');
      const result = await getProductDefinition('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveProductDefinition', () => {
    it('should send PUT with correct body and return ProductDefinitionDto', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => snakeCaseApiResponse,
      });

      const { saveProductDefinition } = await import('../productDefinitionApi');
      const result = await saveProductDefinition(
        '660e8400-e29b-41d4-a716-446655440001',
        'My Product'
      );

      expect(result).toEqual(expectedCamelCaseDto);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/projects/660e8400-e29b-41d4-a716-446655440001/product');
      expect(options.method).toBe('PUT');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      // Verify the request body uses camelCase productName
      // (backend's @JsonProperty("productName") overrides global SNAKE_CASE strategy)
      const requestBody = JSON.parse(options.body);
      expect(requestBody).toEqual({ productName: 'My Product' });
    });
  });
});
