/**
 * Tests for createOrganisationFull API function
 *
 * Spec 2026-01-31: Create Organisation Modal
 * Task Group 2: Organisations API Extension
 *
 * Tests:
 * - Successful creation with full payload
 * - 409 conflict error handling (throws OrganisationConflictError)
 * - General error handling for non-409 errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createOrganisationFull,
  CreateOrganisationPayload,
  OrganisationConflictError,
  OrganisationDto,
} from '../api/organisationsApi';

describe('createOrganisationFull', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const fullPayload: CreateOrganisationPayload = {
    name: 'Test Organisation',
    description: 'A test organisation description',
    docsAppliedToAllSources: ['https://example.com/all.md'],
    docsAppliedToTechStack: ['https://example.com/tech.md', 'https://example.com/stack.md'],
    docsAppliedToCodingStyles: ['https://example.com/styles.md'],
    docsAppliedToConventions: ['https://example.com/conventions.md'],
    docsAppliedToErrorHandling: [],
    docsAppliedToValidation: ['https://example.com/validation.md'],
  };

  it('creates organisation with full payload successfully', async () => {
    const mockResponse: OrganisationDto = {
      id: 'org-123',
      name: 'Test Organisation',
      description: 'A test organisation description',
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await createOrganisationFull(fullPayload);

    expect(result).toEqual(mockResponse);

    // Verify the API call
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/v1/organisations');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');

    // Verify payload was sent correctly
    const sentBody = JSON.parse(options.body);
    expect(sentBody.name).toBe(fullPayload.name);
    expect(sentBody.description).toBe(fullPayload.description);
    expect(sentBody.docs_applied_to_all_sources).toEqual(fullPayload.docsAppliedToAllSources);
    expect(sentBody.docs_applied_to_tech_stack).toEqual(fullPayload.docsAppliedToTechStack);
    expect(sentBody.docs_applied_to_coding_styles).toEqual(fullPayload.docsAppliedToCodingStyles);
    expect(sentBody.docs_applied_to_conventions).toEqual(fullPayload.docsAppliedToConventions);
    expect(sentBody.docs_applied_to_error_handling).toEqual(fullPayload.docsAppliedToErrorHandling);
    expect(sentBody.docs_applied_to_validation).toEqual(fullPayload.docsAppliedToValidation);
  });

  it('throws OrganisationConflictError on 409 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ message: 'Organisation already exists' }),
    });

    await expect(createOrganisationFull(fullPayload)).rejects.toThrow(OrganisationConflictError);

    // Verify the error message
    try {
      await createOrganisationFull(fullPayload);
      // If we get here, the test should fail
      expect.fail('Expected createOrganisationFull to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OrganisationConflictError);
      expect((error as OrganisationConflictError).message).toBe('Organisation already exists');
    }
  });

  it('throws generic Error on non-409 error response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Database connection failed' }),
    });

    // Verify it throws an error
    await expect(createOrganisationFull(fullPayload)).rejects.toThrow(Error);

    // Verify the error message and that it's not OrganisationConflictError
    try {
      await createOrganisationFull(fullPayload);
      expect.fail('Expected createOrganisationFull to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(OrganisationConflictError);
      expect((error as Error).message).toBe('Database connection failed');
    }
  });

  it('handles error response without JSON body', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    await expect(createOrganisationFull(fullPayload)).rejects.toThrow(
      'Failed to create organisation: 503 Service Unavailable'
    );
  });
});
