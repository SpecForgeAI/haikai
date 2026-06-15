/**
 * Tests for gatewayClient.captureBehaviour() — the behaviour-capture relay
 * (Seam 1 of Spec 2026-05-29 Gap C, Task Group 2).
 *
 * Mirrors `gatewayClientGapFill.test.ts`:
 *  1. Success path: POSTs the assembled prompt to
 *     /api/v1/discovery/v3/behaviour-capture and returns the parsed response.
 *  2. Error path: HTTP failure surfaces as a typed BehaviourCaptureGatewayError
 *     carrying the methodId + status (so the stage records it on
 *     `steps_payload.v3.behaviourCapture.failures[]` without halting the run).
 *
 * This confirms the behaviour LLM call goes THROUGH the gateway relay — never
 * a direct LLM call from discovery.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('gatewayClient - captureBehaviour', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('POSTs the assembled prompt to /api/v1/discovery/v3/behaviour-capture and returns the parsed response', async () => {
    const llmContent = JSON.stringify({
      io: { inputs: [], output: { type: 'Owner', meaning: 'persisted owner' } },
      validation: [],
      transformation: 'normalize then save',
      data_effects: 'writes Owner',
      side_effects: 'none',
      edge_cases: [],
      provenance: { method_id: 'com.foo.OwnerService#save(Owner)' },
      confidence: 0.66,
    });

    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValueOnce({
      data: {
        content: llmContent,
        usage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
      },
    });
    const mockUse = jest.fn();
    const mockAxiosInstance = {
      post: mockPost,
      interceptors: { response: { use: mockUse } },
      defaults: { timeout: 7200000 },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const { gatewayClient } = require('../services/gatewayClient');

    const prompt = '# Role\nCapture behaviour for ONE method...';
    const methodId = 'com.foo.OwnerService#save(Owner)';
    const runId = 'run-bc-1';

    const result = await gatewayClient.captureBehaviour(prompt, methodId, runId);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/discovery/v3/behaviour-capture', {
      prompt,
      methodId,
      runId,
    });
    expect(result).toEqual({
      content: llmContent,
      usage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
    });
  });

  it('surfaces HTTP failures as a typed BehaviourCaptureGatewayError carrying methodId and status', async () => {
    // 404 is non-retryable (429/5xx are intentionally retried), so it surfaces
    // immediately.
    const axiosError = new Error('Request failed with status code 404') as any;
    axiosError.response = { status: 404, data: { error: 'Not Found' } };
    axiosError.isAxiosError = true;

    const axios = require('axios');
    const mockPost = jest.fn().mockRejectedValue(axiosError);
    const mockUse = jest.fn();
    const mockAxiosInstance = {
      post: mockPost,
      interceptors: { response: { use: mockUse } },
      defaults: { timeout: 7200000 },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const { gatewayClient, BehaviourCaptureGatewayError } = require('../services/gatewayClient');

    const methodId = 'com.foo.OwnerService#fail()';

    let caught: unknown = null;
    try {
      await gatewayClient.captureBehaviour('any prompt', methodId, 'run-err-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BehaviourCaptureGatewayError);
    const typed = caught as InstanceType<typeof BehaviourCaptureGatewayError>;
    expect(typed.methodId).toBe(methodId);
    expect(typed.status).toBe(404);
    expect(typed.message).toContain(methodId);
  });
});
