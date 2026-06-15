/**
 * Tests for generateGlobalStandards API Function
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 4: Frontend API Function for Standards Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateGlobalStandards, StandardsGenerationPayload } from './organisationsApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('generateGlobalStandards', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  const validPayload: StandardsGenerationPayload = {
    organisationId: 'org-123',
    name: 'Test Corp',
    docsAppliedToAllSources: ['doc1.md'],
    docsAppliedToTechStack: ['tech.md'],
    docsAppliedToCodingStyles: ['style.md'],
    docsAppliedToConventions: ['conventions.md'],
    docsAppliedToErrorHandling: ['errors.md'],
    docsAppliedToValidation: ['validation.md'],
  };

  it('resolves without error on successful response (200)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    // Should not throw
    await expect(generateGlobalStandards(validPayload)).resolves.toBeUndefined();

    // Verify fetch was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/standards/global/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('resolves without error on successful response (201)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ success: true }),
    });

    // Should not throw
    await expect(generateGlobalStandards(validPayload)).resolves.toBeUndefined();
  });

  it('throws error on non-200/201 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({ error: 'Upstream authentication failed' }),
    });

    await expect(generateGlobalStandards(validPayload)).rejects.toThrow(
      'Upstream authentication failed'
    );
  });

  it('throws error with generic message when response has no error body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(generateGlobalStandards(validPayload)).rejects.toThrow(
      'Standards generation failed: 503 Service Unavailable'
    );
  });

  it('sends request body in expected format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await generateGlobalStandards(validPayload);

    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    // Verify the payload is sent as-is (frontend format)
    expect(requestBody).toEqual({
      organisationId: 'org-123',
      name: 'Test Corp',
      docsAppliedToAllSources: ['doc1.md'],
      docsAppliedToTechStack: ['tech.md'],
      docsAppliedToCodingStyles: ['style.md'],
      docsAppliedToConventions: ['conventions.md'],
      docsAppliedToErrorHandling: ['errors.md'],
      docsAppliedToValidation: ['validation.md'],
    });
  });
});
