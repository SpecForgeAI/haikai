/**
 * Tests for generateGlobalStandards payload structure
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 2B: Frontend API StandardsGenerationPayload Update
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('generateGlobalStandards - Payload Structure', () => {
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

  it('sends external-compatible format with company, sources, technical_documents', async () => {
    // Import fresh module after mock is set up
    const { generateGlobalStandards } = await import('./organisationsApi');

    const payload = {
      company: 'Test Corp',
      sources: ['doc1.md', 'doc2.md'],
      technical_documents: {
        tech_stack: ['react.md'],
        coding_style: ['style.md'],
        conventions: ['conv.md'],
        error_handling: ['errors.md'],
        validation: ['val.md'],
      },
    };

    await generateGlobalStandards(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toContain('/api/v1/standards/global/generate');
    expect(options.method).toBe('POST');

    const sentPayload = JSON.parse(options.body);
    expect(sentPayload).toEqual(payload);
  });

  it('payload does not contain organisationId', async () => {
    const { generateGlobalStandards } = await import('./organisationsApi');

    const payload = {
      company: 'No Org ID Corp',
      sources: [],
      technical_documents: {
        tech_stack: [],
        coding_style: [],
        conventions: [],
        error_handling: [],
        validation: [],
      },
    };

    await generateGlobalStandards(payload);

    const [, options] = fetchMock.mock.calls[0];
    const sentPayload = JSON.parse(options.body);

    expect(sentPayload).not.toHaveProperty('organisationId');
    expect(sentPayload).toHaveProperty('company');
    expect(sentPayload).toHaveProperty('sources');
    expect(sentPayload).toHaveProperty('technical_documents');
  });

  it('technical_documents uses snake_case keys', async () => {
    const { generateGlobalStandards } = await import('./organisationsApi');

    const payload = {
      company: 'Snake Case Corp',
      sources: [],
      technical_documents: {
        tech_stack: ['tech.md'],
        coding_style: ['style.md'],
        conventions: ['conv.md'],
        error_handling: ['error.md'],
        validation: ['val.md'],
      },
    };

    await generateGlobalStandards(payload);

    const [, options] = fetchMock.mock.calls[0];
    const sentPayload = JSON.parse(options.body);

    // Verify snake_case keys in technical_documents
    const techDocs = sentPayload.technical_documents;
    expect(techDocs).toHaveProperty('tech_stack');
    expect(techDocs).toHaveProperty('coding_style');
    expect(techDocs).toHaveProperty('conventions');
    expect(techDocs).toHaveProperty('error_handling');
    expect(techDocs).toHaveProperty('validation');

    // Verify NO camelCase keys
    expect(techDocs).not.toHaveProperty('techStack');
    expect(techDocs).not.toHaveProperty('codingStyle');
    expect(techDocs).not.toHaveProperty('errorHandling');
  });
});
