/**
 * Tests for the Driver-side, server-to-server orchestration submit
 * (Spec 2026-06-14, Task Group 2).
 *
 * Covers the wire-contract alignment (CD-3):
 *  - the POST body carries `callback_url` on EVERY submit and `deploy_on_complete`
 *    threaded from the caller (TRUE only on the final spec);
 *  - `spec_intents` is a single-element array with the `spec_name` folder (+
 *    session_id only when present);
 *  - the returned job_id is correlated;
 *  - a non-OK upstream response yields `{ ok: false }` (the Driver isolates it)
 *    rather than throwing.
 *
 * No live LLM -- the upstream client is mocked.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockUpstreamRequest = jest.fn();
jest.mock('../services/implementationLlmProxyClient', () => ({
  request: (...args: unknown[]) => mockUpstreamRequest(...args),
}));

import { submitOrchestration } from '../services/migrationOrchestrationSubmit';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('submitOrchestration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends callback_url + deploy_on_complete and a single spec_intent; correlates the job_id', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(200, { job_id: 'job-77', status: 'queued' }));

    const result = await submitOrchestration({
      company: 'acme',
      project: 'order-mig',
      specName: '2026-06-14-folder',
      sessionId: 'sess-9',
      deployOnComplete: true,
      callbackUrl: 'http://gw/api/implementation/build-results',
    });

    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('job-77');

    const [path, options] = mockUpstreamRequest.mock.calls[0];
    expect(path).toBe('/api/v2/jobs/orchestrations');
    const body = options.body as Record<string, unknown>;
    expect(body.callback_url).toBe('http://gw/api/implementation/build-results');
    expect(body.deploy_on_complete).toBe(true);
    expect(body.spec_intents).toEqual([{ spec_name: '2026-06-14-folder', session_id: 'sess-9' }]);
  });

  it('omits session_id when absent and threads deploy_on_complete=false', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(200, { job_id: 'job-1', status: 'queued' }));

    await submitOrchestration({
      company: 'acme',
      project: 'order-mig',
      specName: 'folder-x',
      sessionId: null,
      deployOnComplete: false,
      callbackUrl: 'http://gw/cb',
    });

    const body = mockUpstreamRequest.mock.calls[0][1].body as Record<string, unknown>;
    expect(body.deploy_on_complete).toBe(false);
    expect(body.spec_intents).toEqual([{ spec_name: 'folder-x' }]);
    // still sends callback_url on a non-final submit.
    expect(body.callback_url).toBe('http://gw/cb');
  });

  it('returns { ok: false } (does NOT throw) on a non-OK upstream response', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    const result = await submitOrchestration({
      company: 'acme', project: 'p', specName: 'f', deployOnComplete: false, callbackUrl: 'http://gw/cb',
    });
    expect(result.ok).toBe(false);
    expect(result.jobId).toBeNull();
  });
});
