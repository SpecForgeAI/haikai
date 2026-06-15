/**
 * Tests for generateProjectStandards API function
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 2: Frontend API Function for Project Standards Generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProjectStandardsPayload } from '../organisationsApi';

describe('generateProjectStandards', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetModules();
  });

  const validPayload: ProjectStandardsPayload = {
    company: 'Test Corp',
    project: 'My Project',
    sources: ['doc1.md', 'http://example.com/docs'],
  };

  it('should resolve successfully on 200 response', async () => {
    const { generateProjectStandards } = await import('../organisationsApi');

    await expect(generateProjectStandards(validPayload)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/standards/product/generate');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('should throw error on non-200 response with server message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({ error: 'Upstream authentication failed' }),
    });

    const { generateProjectStandards } = await import('../organisationsApi');

    await expect(generateProjectStandards(validPayload)).rejects.toThrow(
      'Upstream authentication failed'
    );
  });

  it('should throw generic error when response has no message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({}),
    });

    const { generateProjectStandards } = await import('../organisationsApi');

    await expect(generateProjectStandards(validPayload)).rejects.toThrow(
      'Project standards generation failed: 503 Service Unavailable'
    );
  });

  it('should send correct request body format', async () => {
    const { generateProjectStandards } = await import('../organisationsApi');

    await generateProjectStandards(validPayload);

    const [, options] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(options.body);

    expect(requestBody).toEqual({
      company: 'Test Corp',
      project: 'My Project',
      sources: ['doc1.md', 'http://example.com/docs'],
    });
  });

  it('should handle empty sources array', async () => {
    const { generateProjectStandards } = await import('../organisationsApi');

    const payloadWithEmptySources: ProjectStandardsPayload = {
      company: 'Test Corp',
      project: 'My Project',
      sources: [],
    };

    await expect(generateProjectStandards(payloadWithEmptySources)).resolves.toBeUndefined();

    const [, options] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(options.body);
    expect(requestBody.sources).toEqual([]);
  });
});
