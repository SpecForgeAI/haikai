/**
 * Tests for the API Behaviour Baseline coverage client.
 *
 * Spec: Migration Delivery Plan expansion — endpoint↔baseline coverage
 * (2026-06-24 fix). Verifies the gateway turns the AMS snake_case coverage
 * rows into a Map<endpointElementId, baselineId> and calls the canonical
 * architecture-scoped endpoint (NOT the old name-match path).
 */

jest.mock('../config', () => ({
  getConfig: () => ({ architectureModelServiceBaseUrl: 'http://ams.test' }),
}));

import { fetchEndpointBaselineCoverage } from '../services/apiBehaviourBaselineCoverageClient';

describe('fetchEndpointBaselineCoverage', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('GETs the architecture-scoped coverage endpoint and maps endpoint_id -> baseline_id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { endpoint_id: 'ep-1', baseline_id: 'b-1', method: 'GET', path: '/views/{viewId}' },
        { endpoint_id: 'ep-2', baseline_id: 'b-1', method: 'POST', path: '/books/validate' },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const map = await fetchEndpointBaselineCoverage('proj-1', 'arch-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://ams.test/api/projects/proj-1/architectures/arch-1/api-behaviour/endpoint-baseline-coverage',
    );
    expect(init).toMatchObject({ method: 'GET' });
    expect(map.get('ep-1')).toBe('b-1');
    expect(map.get('ep-2')).toBe('b-1');
    expect(map.size).toBe(2);
  });

  it('returns an empty map when AMS returns an empty list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }) as unknown as typeof fetch;

    const map = await fetchEndpointBaselineCoverage('proj-1', 'arch-1');
    expect(map.size).toBe(0);
  });

  it('throws on a non-2xx response so the caller can soft-fail to the bespoke path', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    }) as unknown as typeof fetch;

    await expect(fetchEndpointBaselineCoverage('proj-1', 'arch-1')).rejects.toThrow(
      /endpoint-baseline-coverage returned 500/,
    );
  });

  it('skips rows missing an endpoint_id or baseline_id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { endpoint_id: 'ep-1', baseline_id: 'b-1' },
        { endpoint_id: '', baseline_id: 'b-2' },
        { endpoint_id: 'ep-3', baseline_id: '' },
      ],
    }) as unknown as typeof fetch;

    const map = await fetchEndpointBaselineCoverage('proj-1', 'arch-1');
    expect(map.size).toBe(1);
    expect(map.get('ep-1')).toBe('b-1');
  });
});
