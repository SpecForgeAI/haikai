/**
 * Tests for the batched orchestration submit (2026-06-26): N specs -> ONE job ->
 * one `feature/<batch_name>` branch. The upstream client is mocked (no live LLM).
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockUpstreamRequest = jest.fn();
jest.mock('../services/implementationLlmProxyClient', () => ({
  request: (...args: unknown[]) => mockUpstreamRequest(...args),
}));

import { submitOrchestrationBatch } from '../services/migrationOrchestrationSubmit';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('submitOrchestrationBatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends N spec_intents + batch_name + deploy + callback_url; correlates the one job_id', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(200, { job_id: 'job-b', status: 'queued' }));

    const result = await submitOrchestrationBatch({
      company: 'acme',
      project: 'order-mig',
      specs: [{ specName: 'folder-1', sessionId: 'sess-1' }, { specName: 'folder-2' }],
      batchName: 'checkout-revamp',
      deployOnComplete: true,
      callbackUrl: 'http://gw/api/implementation/build-results',
    });

    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('job-b');

    const [path, options] = mockUpstreamRequest.mock.calls[0];
    expect(path).toBe('/api/v2/jobs/orchestrations');
    const body = options.body as Record<string, unknown>;
    expect(body.batch_name).toBe('checkout-revamp');
    expect(body.deploy_on_complete).toBe(true);
    expect(body.callback_url).toBe('http://gw/api/implementation/build-results');
    expect(body.spec_intents).toEqual([
      { spec_name: 'folder-1', session_id: 'sess-1' },
      { spec_name: 'folder-2' },
    ]);
  });

  it('isolates a non-OK upstream as { ok: false } without throwing', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const result = await submitOrchestrationBatch({
      company: 'a',
      project: 'p',
      specs: [{ specName: 'folder-1' }],
      batchName: 'b',
      deployOnComplete: false,
      callbackUrl: 'http://cb',
    });

    expect(result.ok).toBe(false);
    expect(result.jobId).toBeNull();
  });
});
