/**
 * Tests for Organisations API Client
 *
 * Spec 2026-01-18: Organisations Iteration 2 - Mandatory Organisation Autocomplete
 * Task Group 1: Organisations API Client Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listOrganisations,
  createOrganisation,
  OrganisationDto,
  OrganisationConflictError,
} from '../api/organisationsApi';

describe('organisationsApi', () => {
  // Mock fetch
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Sample organisation for testing (snake_case API response)
  const sampleOrganisationSnake = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Organisation',
    description: 'Test description',
  };

  // Expected camelCase result
  const sampleOrganisation: OrganisationDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Organisation',
    description: 'Test description',
  };

  describe('listOrganisations', () => {
    it('returns mapped OrganisationDto array on success', async () => {
      const organisationsSnake = [
        sampleOrganisationSnake,
        { id: 'other-id', name: 'Other Org', description: null },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => organisationsSnake,
      });

      const result = await listOrganisations();

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/organisations', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      // Verify return value
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(sampleOrganisation);
      expect(result[1]).toEqual({
        id: 'other-id',
        name: 'Other Org',
        description: null,
      });
    });

    it('throws error on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' }),
      });

      await expect(listOrganisations()).rejects.toThrow('Server error');
    });

    it('throws with default message when no JSON error body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Not JSON');
        },
      });

      await expect(listOrganisations()).rejects.toThrow(
        'Failed to list organisations: 500 Internal Server Error'
      );
    });
  });

  describe('createOrganisation', () => {
    it('sends correct snake_case payload and returns mapped result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => sampleOrganisationSnake,
      });

      const result = await createOrganisation('Test Organisation');

      // Verify fetch was called with correct snake_case body
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/organisations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Organisation',
          description: null,
        }),
      });

      // Verify return value is mapped correctly
      expect(result).toEqual(sampleOrganisation);
    });

    it('throws OrganisationConflictError on 409 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ message: 'Organisation already exists' }),
      });

      try {
        await createOrganisation('Duplicate Org');
        expect.fail('Should have thrown OrganisationConflictError');
      } catch (error) {
        expect(error).toBeInstanceOf(OrganisationConflictError);
        expect((error as OrganisationConflictError).isConflict).toBe(true);
        expect((error as OrganisationConflictError).message).toBe('Organisation already exists');
      }
    });

    it('throws generic error on other failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid organisation name' }),
      });

      try {
        await createOrganisation('');
        expect.fail('Should have thrown Error');
      } catch (error) {
        expect(error).not.toBeInstanceOf(OrganisationConflictError);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Invalid organisation name');
      }
    });

    it('extracts error message from JSON error body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({ error: 'Name too short' }),
      });

      await expect(createOrganisation('X')).rejects.toThrow('Name too short');
    });
  });
});
