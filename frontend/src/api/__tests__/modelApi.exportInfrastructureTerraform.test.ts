/**
 * modelApi.exportInfrastructureTerraform Tests
 *
 * Spec 2026-05-08: Infrastructure Terraform Export (GCP)
 * Task Group 7 / Task 7.1
 *
 * Tests for the `exportInfrastructureTerraform` API helper added to `modelApi.ts`:
 *   - Builds the correct URL with required + optional query params.
 *   - Omits optional `cloudAccountId` / `locationId` from the URL when not provided.
 *   - URL-encodes path segments (projectId / architectureId).
 *   - Returns the raw `Response` object (mirrors `exportAllDiagramsAsZip`).
 *   - Throws on non-OK responses.
 *
 * Test strategy: Vitest with vi.fn() shimming global.fetch (matches the pattern
 * used by `architecturesApi.test.ts` in `frontend/src/api/__tests__/`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { exportInfrastructureTerraform } from '../modelApi';

const PROJECT_ID = 'proj-uuid-123';
const ARCH_ID = 'arch-uuid-456';
const ENV_ID = 'env-uuid-789';

describe('modelApi.exportInfrastructureTerraform', () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Test 1: builds the full URL with all 4 query params and returns raw Response
  // ---------------------------------------------------------------------------
  it('builds the correct URL with all query params and returns the raw Response', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="default_prod_20260508-120000_terraform.zip"',
      }),
      blob: async () => new Blob(['fake-zip-bytes']),
    } as unknown as Response;

    fetchMock.mockResolvedValueOnce(fakeResponse);

    const result = await exportInfrastructureTerraform(PROJECT_ID, ARCH_ID, {
      environmentId: ENV_ID,
      cloudAccountId: 'cloud-uuid-1',
      locationId: 'loc-uuid-1',
      provider: 'GCP',
    });

    // Mirrors exportAllDiagramsAsZip: returns the raw Response (NOT a parsed body)
    expect(result).toBe(fakeResponse);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];

    // URL prefix matches the locked endpoint contract
    expect(url).toContain(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID)}/infrastructure/export-terraform?`
    );

    // All 4 expected query params are present
    expect(url).toContain(`environmentId=${ENV_ID}`);
    expect(url).toContain('cloudAccountId=cloud-uuid-1');
    expect(url).toContain('locationId=loc-uuid-1');
    expect(url).toContain('provider=GCP');
  });

  // ---------------------------------------------------------------------------
  // Test 2: omits optional cloudAccountId / locationId when not provided
  // ---------------------------------------------------------------------------
  it('omits optional cloudAccountId and locationId from the URL when not provided', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: async () => new Blob(['fake']),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeResponse);

    await exportInfrastructureTerraform(PROJECT_ID, ARCH_ID, {
      environmentId: ENV_ID,
      provider: 'GCP',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];

    expect(url).toContain(`environmentId=${ENV_ID}`);
    expect(url).toContain('provider=GCP');
    expect(url).not.toContain('cloudAccountId=');
    expect(url).not.toContain('locationId=');
  });

  // ---------------------------------------------------------------------------
  // Test 3: empty-string optional values are also omitted (defensive)
  // ---------------------------------------------------------------------------
  it('omits cloudAccountId and locationId from the URL when empty strings are passed', async () => {
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: async () => new Blob(['fake']),
    } as unknown as Response;
    fetchMock.mockResolvedValueOnce(fakeResponse);

    await exportInfrastructureTerraform(PROJECT_ID, ARCH_ID, {
      environmentId: ENV_ID,
      cloudAccountId: '',
      locationId: '',
      provider: 'GCP',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).not.toContain('cloudAccountId=');
    expect(url).not.toContain('locationId=');
  });

  // ---------------------------------------------------------------------------
  // Test 4: throws on non-OK response (4xx / 5xx)
  // ---------------------------------------------------------------------------
  it('throws an Error when the backend returns a non-OK status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers(),
    } as unknown as Response);

    await expect(
      exportInfrastructureTerraform(PROJECT_ID, ARCH_ID, {
        environmentId: ENV_ID,
        provider: 'GCP',
      })
    ).rejects.toThrow(/Failed to export Infrastructure as Terraform/);
  });

  // ---------------------------------------------------------------------------
  // Test 5: URL-encodes path segments (projectId / architectureId)
  // ---------------------------------------------------------------------------
  it('URL-encodes path segments containing reserved characters', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: async () => new Blob(['x']),
    } as unknown as Response);

    const projectIdWithSpecial = 'proj id/with#chars';
    const archIdWithSpecial = 'arch?id&here';

    await exportInfrastructureTerraform(projectIdWithSpecial, archIdWithSpecial, {
      environmentId: ENV_ID,
      provider: 'GCP',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent(projectIdWithSpecial));
    expect(url).toContain(encodeURIComponent(archIdWithSpecial));
  });
});
