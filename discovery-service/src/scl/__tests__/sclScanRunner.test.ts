/**
 * SCL scan runner tests — mocked HTTP deps recording every call: lifecycle
 * order (create → contract batches → reachability PUT → completed PATCH),
 * the snake_case contract DTO mapping, batching, and the failure path
 * (failed PATCH + rethrow).
 *
 * The slice comes from the REAL fixture app (sliced once in beforeAll) and
 * is injected through `deps.slice`, so the HTTP layer is fully mocked while
 * the persisted payloads stay honest.
 */

import * as path from 'path';
import { sliceProject, type SclSliceResult } from '../slicer';
import { assembleCorpus } from '../corpusAssembler';
import {
  runSclScan,
  createSclScan,
  type SclHttpRequest,
} from '../sclScanRunner';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'legacy-app');

const ARGS = {
  projectId: 'proj-1',
  architectureId: 'arch-1',
  sourceDir: FIXTURE_ROOT,
  amsBaseUrl: 'http://ams.test:8080',
};

const SCL_BASE =
  'http://ams.test:8080/api/model/projects/proj-1/architectures/arch-1/scl';

interface RecordedCall extends SclHttpRequest {}

function recordingHttp(options?: { failOn?: (req: SclHttpRequest) => boolean }) {
  const calls: RecordedCall[] = [];
  const http = async (req: SclHttpRequest): Promise<unknown> => {
    calls.push(req);
    if (options?.failOn?.(req)) {
      throw new Error('boom: injected AMS failure');
    }
    if (req.method === 'POST' && req.url.endsWith('/scans')) {
      return { id: 'scan-123', project_id: 'proj-1', architecture_id: 'arch-1', status: 'in_progress' };
    }
    if (req.url.endsWith('/contracts/bulk')) {
      const body = req.body as { contracts: unknown[] };
      return { upserted: body.contracts.length };
    }
    if (req.url.endsWith('/reachability')) {
      const body = req.body as { items: unknown[] };
      return { replaced: body.items.length };
    }
    return {};
  };
  return { calls, http };
}

describe('runSclScan (mocked AMS http)', () => {
  let slice: SclSliceResult;

  beforeAll(async () => {
    slice = await sliceProject(FIXTURE_ROOT);
  });

  const sliceDep = async (sourceDir: string): Promise<SclSliceResult> => {
    expect(sourceDir).toBe(FIXTURE_ROOT);
    return slice;
  };

  it('drives create → N contract batches → reachability PUT → completed PATCH, in order', async () => {
    const { calls, http } = recordingHttp();
    const corpus = assembleCorpus(slice);
    expect(corpus.contracts.length).toBeGreaterThan(5); // forces 2+ batches at size 5

    const result = await runSclScan(ARGS, { http, batchSize: 5, slice: sliceDep });
    expect(result.scanId).toBe('scan-123');

    // 1. Scan create.
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${SCL_BASE}/scans` });

    // 2. Contract batches: ceil(contracts / 5), sizes 5,5,...,remainder.
    const expectedBatches = Math.ceil(corpus.contracts.length / 5);
    expect(expectedBatches).toBeGreaterThanOrEqual(2);
    const bulkCalls = calls.filter((c) => c.url.endsWith('/contracts/bulk'));
    expect(bulkCalls).toHaveLength(expectedBatches);
    for (const c of bulkCalls) {
      expect(c.method).toBe('POST');
      expect(c.url).toBe(`${SCL_BASE}/scans/scan-123/contracts/bulk`);
    }
    const batchSizes = bulkCalls.map((c) => (c.body as { contracts: unknown[] }).contracts.length);
    expect(batchSizes.slice(0, -1).every((n) => n === 5)).toBe(true);
    expect(batchSizes[batchSizes.length - 1]).toBe(corpus.contracts.length - 5 * (expectedBatches - 1));
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(corpus.contracts.length);

    // 3. Reachability PUT after ALL bulk batches.
    const putIndex = calls.findIndex((c) => c.method === 'PUT');
    expect(putIndex).toBeGreaterThan(calls.indexOf(bulkCalls[bulkCalls.length - 1]));
    expect(calls[putIndex].url).toBe(`${SCL_BASE}/scans/scan-123/reachability`);
    const putBody = calls[putIndex].body as {
      items: Array<{ source_path: string; symbol: string; signals_json: { signals: string[] } }>;
    };
    expect(putBody.items).toHaveLength(corpus.reachability.length);
    // signals_json is a WRAPPED object — the AMS DTO types it as a JSON
    // object (Map) and a bare array fails Jackson binding with a 400.
    expect(putBody.items[0]).toEqual({
      source_path: corpus.reachability[0].sourcePath,
      symbol: corpus.reachability[0].symbol,
      signals_json: { signals: corpus.reachability[0].signals },
    });

    // 4. Completed PATCH last, with corpus stats + findings + parse errors.
    const last = calls[calls.length - 1];
    expect(last.method).toBe('PATCH');
    expect(last.url).toBe(`${SCL_BASE}/scans/scan-123`);
    const patchBody = last.body as { status: string; stats_json: Record<string, unknown> };
    expect(patchBody.status).toBe('completed');
    expect(patchBody.stats_json.rootCount).toBe(corpus.stats.rootCount);
    expect(patchBody.stats_json.contractCount).toBe(corpus.stats.contractCount);
    expect(patchBody.stats_json.unresolvedCallCount).toBe(corpus.stats.unresolvedCallCount);
    expect(patchBody.stats_json.findings).toEqual(JSON.parse(JSON.stringify(corpus.findings)));
    expect(patchBody.stats_json.parseErrors).toEqual(slice.parseErrors);
    expect(patchBody.stats_json.inlined).toBe(slice.inlined.length);
  });

  it('maps each contract onto the snake_case SclContractDto wire shape', async () => {
    const { calls, http } = recordingHttp();
    const corpus = assembleCorpus(slice);
    await runSclScan(ARGS, { http, batchSize: 200, slice: sliceDep });

    const bulk = calls.find((c) => c.url.endsWith('/contracts/bulk'))!;
    const wire = (bulk.body as { contracts: Array<Record<string, unknown>> }).contracts;
    expect(wire).toHaveLength(corpus.contracts.length);

    const first = corpus.contracts[0];
    expect(wire[0]).toEqual({
      contract_key: first.contractKey,
      kind: first.kind,
      source_path: first.sourcePath,
      source_symbol: first.sourceSymbol,
      content_hash: first.contentHash,
      fan_in: first.rootFanIn,
      roots_json: { roots: first.roots, total: first.rootFanIn, reachable: first.reachable },
      body_json: first.contract,
    });

    // Spot-check the hoisting fixture rides the wire with fan_in 2.
    const impl = wire.find(
      (w) => w.source_symbol === 'com.legacy.hier.service.CachingNodeServiceImpl#findNode(String)'
    )!;
    expect(impl.fan_in).toBe(2);
    expect((impl.roots_json as { reachable: boolean }).reachable).toBe(true);
  });

  it('reuses a pre-created scan id (route flow) without POSTing a second scan row', async () => {
    const { calls, http } = recordingHttp();
    const scanId = await createSclScan(ARGS, http);
    expect(scanId).toBe('scan-123');

    const result = await runSclScan({ ...ARGS, scanId }, { http, batchSize: 200, slice: sliceDep });
    expect(result.scanId).toBe('scan-123');
    const creates = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/scans'));
    expect(creates).toHaveLength(1); // only the explicit createSclScan
  });

  it('on bulk-upsert failure: sends a failed PATCH (best-effort) and rethrows the original error', async () => {
    const { calls, http } = recordingHttp({
      failOn: (req) => req.url.endsWith('/contracts/bulk'),
    });

    await expect(runSclScan(ARGS, { http, batchSize: 5, slice: sliceDep })).rejects.toThrow(
      'boom: injected AMS failure'
    );

    const last = calls[calls.length - 1];
    expect(last.method).toBe('PATCH');
    expect(last.url).toBe(`${SCL_BASE}/scans/scan-123`);
    expect(last.body).toEqual({
      status: 'failed',
      stats_json: { error: 'boom: injected AMS failure' },
    });
    // No reachability PUT and no completed PATCH ever happened.
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('rethrows even when the failed PATCH itself fails (never masks the original error)', async () => {
    const { calls, http } = recordingHttp({
      failOn: (req) => req.url.endsWith('/contracts/bulk') || req.method === 'PATCH',
    });

    await expect(runSclScan(ARGS, { http, batchSize: 5, slice: sliceDep })).rejects.toThrow(
      'boom: injected AMS failure'
    );
    // The best-effort failed PATCH was attempted.
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
  });
});
