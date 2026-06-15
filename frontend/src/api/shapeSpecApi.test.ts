/**
 * Tests for Shape-Spec Stream API Client
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 3: Shape-Spec Stream API Integration
 * Task 3.1: Write 3-4 focused tests for API request building
 *
 * Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract
 * Task Group 2: Tests for optional session_mode handling
 *
 * Spec 2026-01-30: Centralize Bearer Authentication
 * Task Group 5: Frontend now routes through Gateway (uses VITE_GATEWAY_BASE_URL)
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 4: Updated tests to expect normalized company/project values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startShapeSpecStream, ShapeSpecStreamRequest } from './shapeSpecApi';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('shapeSpecApi', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1: Request body structure matches spec.
   * Verifies the request body contains { company, project, message, session_mode: "new" }
   *
   * Spec 2026-01-30: company/project are now normalized (lowercase, hyphenated)
   */
  describe('request body structure', () => {
    it('matches spec: { company, project, message, session_mode: "new" }', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'TestCompany',
        project: 'TestProject',
        message: '/shape-spec This is the feature description',
        session_mode: 'new',
      };

      // Mock a successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream(),
      });

      // When
      await startShapeSpecStream(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the body structure
      // Spec 2026-01-30: company/project are now normalized (lowercase)
      const [, options] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(options.body as string);

      expect(parsedBody).toEqual({
        company: 'testcompany',  // normalized from 'TestCompany'
        project: 'testproject',  // normalized from 'TestProject'
        message: '/shape-spec This is the feature description',
        session_mode: 'new',
      });
    });
  });

  /**
   * Test 2: Endpoint URL routes through Gateway.
   *
   * Spec 2026-01-30: Centralize Bearer Authentication
   * The base URL now uses VITE_GATEWAY_BASE_URL with fallback to '' (same-origin).
   * In test environment, the env var is not set, so empty string is used.
   */
  describe('endpoint URL', () => {
    it('uses correct endpoint path /api/v2/shape-spec/stream via Gateway', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'MyCompany',
        project: 'MyProject',
        message: '/shape-spec Feature',
        session_mode: 'new',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream(),
      });

      // When
      await startShapeSpecStream(request);

      // Then
      const [url] = mockFetch.mock.calls[0];
      // URL should end with the correct path
      expect(url).toContain('/api/v2/shape-spec/stream');
      // Spec 2026-01-30: Now routes through Gateway (empty base URL = same origin)
      // In test environment, VITE_GATEWAY_BASE_URL is not set, so '' is used
      expect(url).toBe('/api/v2/shape-spec/stream');
    });
  });

  /**
   * Test 3: Request method is POST with JSON content type.
   *
   * Spec 2026-01-30: Centralize Bearer Authentication
   * Verifies NO Authorization header is sent (auth is handled by Gateway).
   */
  describe('request method and headers', () => {
    it('uses POST method with Content-Type: application/json (no Authorization header)', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'Company',
        project: 'Project',
        message: '/shape-spec Test',
        session_mode: 'new',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream(),
      });

      // When
      await startShapeSpecStream(request);

      // Then
      const [, options] = mockFetch.mock.calls[0];

      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
      });
      // Spec 2026-01-30: No Authorization header sent from frontend
      expect(options.headers).not.toHaveProperty('Authorization');
    });
  });

  /**
   * Test 4: Error thrown on non-2xx response.
   */
  describe('error handling', () => {
    it('throws error on non-OK response (e.g., 500)', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'Company',
        project: 'Project',
        message: '/shape-spec Test',
        session_mode: 'new',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // When/Then
      await expect(startShapeSpecStream(request)).rejects.toThrow(
        'Shape-spec stream request failed: 500'
      );
    });

    it('throws error on non-OK response (e.g., 400)', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'Company',
        project: 'Project',
        message: '/shape-spec Test',
        session_mode: 'new',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      // When/Then
      await expect(startShapeSpecStream(request)).rejects.toThrow(
        'Shape-spec stream request failed: 400'
      );
    });

    it('returns Response object on successful request', async () => {
      // Given
      const request: ShapeSpecStreamRequest = {
        company: 'Company',
        project: 'Project',
        message: '/shape-spec Test',
        session_mode: 'new',
      };

      const mockReadableStream = new ReadableStream();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockReadableStream,
      });

      // When
      const response = await startShapeSpecStream(request);

      // Then
      expect(response.ok).toBe(true);
      expect(response.body).toBe(mockReadableStream);
    });
  });

  /**
   * Spec 2026-01-28: Shape-Spec 2 - Streaming Event Contract
   * Task Group 2: Tests for optional session_mode handling
   * Task 2.1: Write 2 focused tests for API request handling
   *
   * Spec 2026-01-30: Normalize API Identifiers
   * Updated to expect normalized company/project values
   */
  describe('session_mode optional handling', () => {
    /**
     * Test: Request with session_mode includes the field in request body.
     * This is the case for new sessions.
     *
     * Spec 2026-01-30: company/project are now normalized (lowercase)
     */
    it('includes session_mode field when provided in request', async () => {
      // Given - request with session_mode: 'new' (new session)
      const request: ShapeSpecStreamRequest = {
        company: 'TestCompany',
        project: 'TestProject',
        message: '/shape-spec Start a new session',
        session_mode: 'new',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream(),
      });

      // When
      await startShapeSpecStream(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(options.body as string);

      // Verify session_mode is included in the request body
      // Spec 2026-01-30: company/project are now normalized (lowercase)
      expect(parsedBody).toHaveProperty('session_mode', 'new');
      expect(parsedBody).toEqual({
        company: 'testcompany',  // normalized from 'TestCompany'
        project: 'testproject',  // normalized from 'TestProject'
        message: '/shape-spec Start a new session',
        session_mode: 'new',
      });
    });

    /**
     * Test: Request without session_mode omits the field entirely (not null/undefined).
     * This is the case for continuation calls.
     *
     * Spec 2026-01-30: company/project are now normalized (lowercase)
     */
    it('omits session_mode field entirely when not provided (continuation call)', async () => {
      // Given - request without session_mode (continuation)
      const request: ShapeSpecStreamRequest = {
        company: 'TestCompany',
        project: 'TestProject',
        message: 'Answers to your questions:\n\nQ: What is the scope?\nA: The scope is limited to frontend changes.',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream(),
      });

      // When
      await startShapeSpecStream(request);

      // Then
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(options.body as string);

      // Verify session_mode is NOT present in the request body at all
      // (not null, not undefined string, not empty - completely absent)
      // Spec 2026-01-30: company/project are now normalized (lowercase)
      expect(parsedBody).not.toHaveProperty('session_mode');
      expect(Object.keys(parsedBody)).toEqual(['company', 'project', 'message']);
      expect(parsedBody).toEqual({
        company: 'testcompany',  // normalized from 'TestCompany'
        project: 'testproject',  // normalized from 'TestProject'
        message: 'Answers to your questions:\n\nQ: What is the scope?\nA: The scope is limited to frontend changes.',
      });
    });
  });
});
