/**
 * modelApi.importInfrastructureTerraform Tests
 *
 * Spec 2026-05-08: Infrastructure Terraform Import (GCP)
 * Task Group 7 / Task 7.1
 *
 * Tests for the `importInfrastructureTerraform` API helper added to `modelApi.ts`:
 *   - POSTs `multipart/form-data` to the locked endpoint URL.
 *   - Body is the supplied FormData instance verbatim (browser supplies the
 *     multipart boundary).
 *   - Does NOT set Content-Type manually.
 *   - Parses 2xx JSON response into a typed `ImportReviewResult`.
 *   - Throws on non-OK responses, propagating the server error message.
 *   - URL-encodes path segments (projectId / architectureId).
 *
 * Test strategy: Vitest with vi.fn() shimming global.fetch (matches the pattern
 * used by `modelApi.exportInfrastructureTerraform.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  importInfrastructureTerraform,
  type ImportReviewResult,
} from '../modelApi';

const PROJECT_ID = 'proj-uuid-123';
const ARCH_ID = 'arch-uuid-456';
const ENV_ID = 'env-uuid-789';

/** Build a minimal valid `ImportReviewResult` for fake response bodies. */
function buildFakeResult(): ImportReviewResult {
  return {
    iac_source: {
      provider: 'GCP',
      repository_url: null,
      branch: null,
      commit_sha: null,
      path: null,
      workspace: null,
    },
    will_create: [],
    will_update: [],
    unsupported: [],
    warnings: [],
    summary: {
      will_create_count: 0,
      will_update_count: 0,
      unsupported_count: 0,
      warnings_count: 0,
    },
  };
}

/** Build a FormData instance with the locked-contract fields populated. */
function buildFormData(): FormData {
  const fd = new FormData();
  // One .tf file part.
  fd.append('files', new Blob(['resource "google_compute_network" "main" {}'], { type: 'text/plain' }), 'main.tf');
  fd.append('environmentId', ENV_ID);
  fd.append('cloudAccountId', 'cloud-uuid-1');
  fd.append('locationId', 'loc-uuid-1');
  fd.append('provider', 'GCP');
  fd.append('repositoryUrl', 'https://github.com/example/repo');
  fd.append('branch', 'main');
  fd.append('commitSha', 'abc123');
  fd.append('path', 'infra/');
  fd.append('workspace', 'production');
  return fd;
}

describe('modelApi.importInfrastructureTerraform', () => {
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
  // Test 1: POST URL + method + body wiring
  // ---------------------------------------------------------------------------
  it('POSTs multipart/form-data to the correct URL with the supplied FormData body and no manual Content-Type', async () => {
    const fakeResult = buildFakeResult();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => fakeResult,
    } as unknown as Response);

    const formData = buildFormData();

    await importInfrastructureTerraform(PROJECT_ID, ARCH_ID, formData);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    // Locked endpoint URL.
    expect(url).toBe(
      `/api/model/projects/${encodeURIComponent(PROJECT_ID)}/architectures/${encodeURIComponent(ARCH_ID)}/infrastructure/import-terraform`
    );

    // POST + FormData body (verbatim).
    expect(init).toBeDefined();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(formData);

    // Critically: NO manual Content-Type header. The browser must supply the
    // multipart boundary itself.
    if (init.headers) {
      const headers = init.headers as Record<string, string> | Headers;
      if (headers instanceof Headers) {
        expect(headers.get('Content-Type')).toBeNull();
      } else {
        expect(headers['Content-Type']).toBeUndefined();
        expect(headers['content-type']).toBeUndefined();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Test 2: 2xx JSON response is parsed into the typed ImportReviewResult shape
  // ---------------------------------------------------------------------------
  it('parses a 2xx JSON response into the typed ImportReviewResult shape', async () => {
    const fakeResult: ImportReviewResult = {
      iac_source: {
        provider: 'GCP',
        repository_url: 'https://github.com/example/repo',
        branch: 'main',
        commit_sha: 'abc123',
        path: 'infra/',
        workspace: 'production',
      },
      will_create: [
        {
          candidate_id: 'cand-1',
          target_entity_type: 'Network',
          proposed_entity_fields: { name: 'main-vpc' },
          proposed_binding: { iac_address: 'google_compute_network.main' },
          confidence: 0.9,
          per_candidate_warnings: [],
          evidence: {
            file_path: 'main.tf',
            start_line: 1,
            end_line: 5,
            raw_snippet: 'resource "google_compute_network" "main" {}',
          },
          ignored: false,
        },
      ],
      will_update: [],
      unsupported: [],
      warnings: ['module not parsed: registry.terraform.io/x/y/z'],
      summary: {
        will_create_count: 1,
        will_update_count: 0,
        unsupported_count: 0,
        warnings_count: 1,
      },
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => fakeResult,
    } as unknown as Response);

    const result = await importInfrastructureTerraform(PROJECT_ID, ARCH_ID, buildFormData());

    expect(result).toEqual(fakeResult);
    expect(result.will_create).toHaveLength(1);
    expect(result.will_create[0].candidate_id).toBe('cand-1');
    expect(result.summary.will_create_count).toBe(1);
    expect(result.iac_source.provider).toBe('GCP');
  });

  // ---------------------------------------------------------------------------
  // Test 3: 400 error response carries the server error message into the thrown Error
  // ---------------------------------------------------------------------------
  it('throws on a 400 response carrying the server error message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => JSON.stringify({ error: 'environmentId is required' }),
    } as unknown as Response);

    await expect(
      importInfrastructureTerraform(PROJECT_ID, ARCH_ID, buildFormData())
    ).rejects.toThrow(/environmentId is required/);
  });

  // ---------------------------------------------------------------------------
  // Test 4: network error (fetch rejects) propagates to caller
  // ---------------------------------------------------------------------------
  it('propagates a network error (fetch rejection) to the caller', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    await expect(
      importInfrastructureTerraform(PROJECT_ID, ARCH_ID, buildFormData())
    ).rejects.toThrow(/Network failure/);
  });

  // ---------------------------------------------------------------------------
  // Test 5: URL-encodes path segments (projectId / architectureId)
  // ---------------------------------------------------------------------------
  it('URL-encodes path segments containing reserved characters', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => buildFakeResult(),
    } as unknown as Response);

    const projectIdWithSpecial = 'proj id/with#chars';
    const archIdWithSpecial = 'arch?id&here';

    await importInfrastructureTerraform(
      projectIdWithSpecial,
      archIdWithSpecial,
      buildFormData()
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent(projectIdWithSpecial));
    expect(url).toContain(encodeURIComponent(archIdWithSpecial));
    expect(url).toContain('/infrastructure/import-terraform');
  });
});
