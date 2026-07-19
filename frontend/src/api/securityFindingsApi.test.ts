/**
 * Tests for the Security Findings API client (Security health dashboard,
 * 2026-07-19, Specs 2+3): wire routing (gateway vs AMS-direct), snake_case
 * param construction for the parameterized register read, multipart assembly
 * for the wizard endpoints, and the 204-prefill contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SecurityFindingsApiError,
  getSecurityPrefill,
  getSecurityRegister,
  getSecurityRollup,
  ingestSecurityUpload,
  parseSecurityUpload,
  upsertSecurityAliases,
} from './securityFindingsApi';

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe('securityFindingsApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends wizard parse/ingest as multipart to the GATEWAY route with all files + JSON answer fields', async () => {
    fetchMock.mockResolvedValue(okJson({ headers: [] }));
    const files = [
      new File(['a'], 'a.csv', { type: 'text/csv' }),
      new File(['b'], 'b.csv', { type: 'text/csv' }),
    ];
    await parseSecurityUpload('p1', 'a1', files, 'Project Name');
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/projects/p1/architectures/a1/security/uploads/parse',
    );
    const parseForm = fetchMock.mock.calls[0][1].body as FormData;
    expect(parseForm.getAll('files')).toHaveLength(2);
    expect(parseForm.get('linking_column')).toBe('Project Name');

    await ingestSecurityUpload(
      'p1',
      'a1',
      files,
      { 'Project Name': 'linking_value', Severity: 'severity' },
      'service',
      [{ linking_value: 'grh/payments', entity_id: 'svc-1', match_status: 'auto' }],
    );
    const ingestForm = fetchMock.mock.calls[1][1].body as FormData;
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/v1/projects/p1/architectures/a1/security/uploads/ingest',
    );
    expect(JSON.parse(ingestForm.get('column_mapping') as string).Severity).toBe('severity');
    expect(ingestForm.get('association_level')).toBe('service');
    expect(JSON.parse(ingestForm.get('resolutions') as string)[0]).toEqual({
      linking_value: 'grh/payments',
      entity_id: 'svc-1',
      match_status: 'auto',
    });
  });

  it('builds the parameterized register read against AMS with snake_case params + comma-joined columns', async () => {
    fetchMock.mockResolvedValue(okJson({ data: [], total: 0, page: 0, size: 50, columns: [] }));
    await getSecurityRegister('p1', 'a1', {
      applicationId: 'app-1',
      applicationComponentId: 'comp-1',
      serviceId: 'svc-1',
      matchStatus: 'unmatched',
      severity: 'high',
      text: 'spring',
      columns: ['finding_id', 'title'],
      page: 2,
      size: 25,
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/api/model/projects/p1/architectures/a1/security/register?');
    expect(url).toContain('application_id=app-1');
    expect(url).toContain('application_component_id=comp-1');
    expect(url).toContain('service_id=svc-1');
    expect(url).toContain('match_status=unmatched');
    expect(url).toContain('severity=high');
    expect(url).toContain('columns=finding_id%2Ctitle');
    expect(url).toContain('page=2');
    expect(url).toContain('size=25');
  });

  it('reads the rollup with an optional report_id and teaches aliases via PUT', async () => {
    fetchMock.mockResolvedValue(okJson({ applications: [] }));
    await getSecurityRollup('p1', 'a1', 'rep-9');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/model/projects/p1/architectures/a1/security/rollup?report_id=rep-9',
    );

    await upsertSecurityAliases('p1', 'application', [
      { alias_value: 'MRX (Risk)', entity_id: 'app-mrx', entity_name: 'MRX' },
    ]);
    const [aliasUrl, aliasInit] = fetchMock.mock.calls[1];
    expect(String(aliasUrl)).toBe('/api/model/projects/p1/security/aliases');
    expect(aliasInit.method).toBe('PUT');
    expect(JSON.parse(aliasInit.body as string).aliases[0].alias_value).toBe('MRX (Risk)');
  });

  it('treats a 204 prefill as null and surfaces error bodies as typed errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);
    expect(await getSecurityPrefill('p1')).toBeNull();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable',
      json: async () => ({ error: 'bad mapping' }),
    } as unknown as Response);
    await expect(getSecurityPrefill('p1')).rejects.toMatchObject({
      name: 'SecurityFindingsApiError',
      status: 422,
      message: 'bad mapping',
    } satisfies Partial<SecurityFindingsApiError>);
  });
});
