/**
 * sclCorpusApi tests (SCL pipeline spec 6, 2026-08-18 — Structural Model tab).
 *
 * Pins the wire contract of the api module:
 *   (a) URL construction — AMS-direct /api/model/... base for reads + the
 *       reachability PATCH, including the contracts query params
 *       (kind / q / min_fan_in / include_body);
 *   (b) the MEANINGFUL 404 on /scans/latest resolves to null (never scanned)
 *       while other non-2xx statuses reject with SclCorpusApiError;
 *   (c) explainContract goes through the GATEWAY (/api/v1/...) with the
 *       snake_case {scan_id, contract_key} body;
 *   (d) normalizeSignals tolerates BOTH the miner's raw string[] shape and a
 *       {signals: [...]} object wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  explainContract,
  getContract,
  getLatestScan,
  listContracts,
  listReachability,
  normalizeSignals,
  patchReachabilityDisposition,
  SclCorpusApiError,
} from './sclCorpusApi';

const fetchMock = vi.fn();

function okJson(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  } as unknown as Response;
}

function errorResponse(status: number, body?: unknown): Response {
  return {
    ok: false,
    status,
    statusText: 'ERR',
    json: async () => body ?? {},
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLatestScan', () => {
  it('GETs the AMS-direct latest-scan URL and returns the scan', async () => {
    const scan = { id: 'scan-1', status: 'completed', stats_json: {}, created_at: 'now' };
    fetchMock.mockResolvedValue(okJson(scan));

    const result = await getLatestScan('p1', 'a1');

    expect(result).toEqual(scan);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model/projects/p1/architectures/a1/scl/scans/latest',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('resolves null on 404 (never scanned) instead of rejecting', async () => {
    fetchMock.mockResolvedValue(errorResponse(404));

    await expect(getLatestScan('p1', 'a1')).resolves.toBeNull();
  });

  it('rejects with SclCorpusApiError (status carried) on other failures', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { error: 'boom' }));

    const err = await getLatestScan('p1', 'a1').catch((e) => e);
    expect(err).toBeInstanceOf(SclCorpusApiError);
    expect((err as SclCorpusApiError).status).toBe(500);
    expect((err as SclCorpusApiError).message).toBe('boom');
  });
});

describe('listContracts', () => {
  it('builds the query params: kind, q, min_fan_in, include_body', async () => {
    fetchMock.mockResolvedValue(okJson([]));

    await listContracts('p1', 'a1', 'scan-1', {
      kind: 'behaviour_table',
      q: 'view',
      minFanIn: 2,
      includeBody: false,
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/model/projects/p1/architectures/a1/scl/scans/scan-1/contracts?');
    expect(url).toContain('kind=behaviour_table');
    expect(url).toContain('q=view');
    expect(url).toContain('min_fan_in=2');
    expect(url).toContain('include_body=false');
  });

  it('omits absent filters entirely', async () => {
    fetchMock.mockResolvedValue(okJson([]));

    await listContracts('p1', 'a1', 'scan-1');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('/api/model/projects/p1/architectures/a1/scl/scans/scan-1/contracts');
  });
});

describe('getContract / listReachability', () => {
  it('GETs the single-contract URL (key encoded)', async () => {
    fetchMock.mockResolvedValue(okJson({ contract_key: 'T-abc' }));

    await getContract('p1', 'a1', 'scan-1', 'T-abc');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model/projects/p1/architectures/a1/scl/scans/scan-1/contracts/T-abc',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('GETs the reachability worklist URL', async () => {
    fetchMock.mockResolvedValue(okJson([]));

    await listReachability('p1', 'a1', 'scan-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model/projects/p1/architectures/a1/scl/scans/scan-1/reachability',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('patchReachabilityDisposition', () => {
  it('PATCHes the item URL with the snake_case disposition body', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'item-1', disposition: 'dead_code' }));

    const result = await patchReachabilityDisposition('p1', 'a1', 'item-1', 'dead_code');

    expect(result.disposition).toBe('dead_code');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/model/projects/p1/architectures/a1/scl/reachability/item-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ disposition: 'dead_code' }),
      }),
    );
  });

  it('sends null to reopen an item', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'item-1', disposition: null }));

    await patchReachabilityDisposition('p1', 'a1', 'item-1', null);

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.body).toBe(JSON.stringify({ disposition: null }));
  });
});

describe('explainContract', () => {
  it('POSTs to the GATEWAY /api/v1 explain route with {scan_id, contract_key}', async () => {
    fetchMock.mockResolvedValue(okJson({ explanation: 'Plain prose.' }));

    const result = await explainContract('p1', 'a1', 'scan-1', 'T-abc');

    expect(result).toBe('Plain prose.');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/projects/p1/architectures/a1/scl/explain');
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ scan_id: 'scan-1', contract_key: 'T-abc' }));
  });

  it('rejects with the server error message on 502', async () => {
    fetchMock.mockResolvedValue(errorResponse(502, { error: 'LLM unavailable' }));

    const err = await explainContract('p1', 'a1', 'scan-1', 'T-abc').catch((e) => e);
    expect(err).toBeInstanceOf(SclCorpusApiError);
    expect((err as SclCorpusApiError).status).toBe(502);
    expect((err as SclCorpusApiError).message).toBe('LLM unavailable');
  });
});

describe('normalizeSignals (dual-shape wire tolerance)', () => {
  it('accepts the miner raw string[] shape (sclScanRunner PUT mapping)', () => {
    expect(normalizeSignals(['has_main', 'annotation:@Scheduled'])).toEqual([
      'has_main',
      'annotation:@Scheduled',
    ]);
  });

  it('accepts a {signals: [...]} object wrapper', () => {
    expect(normalizeSignals({ signals: ['no_signals'] })).toEqual(['no_signals']);
  });

  it('yields [] for null / malformed payloads', () => {
    expect(normalizeSignals(null)).toEqual([]);
    expect(normalizeSignals({} as { signals?: string[] })).toEqual([]);
  });
});
