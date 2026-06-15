/**
 * Tests for gatewayClient.gapFill() method.
 *
 * Spec 2026-04-19: V3 Layered Prompt System (Task Group 3)
 *
 * Tests:
 * 1. Success path: POSTs the assembled prompt to /api/v1/discovery/v3/gap-fill
 *    and returns the parsed LLM response (content + usage).
 * 2. Error path: HTTP / network failure surfaces as a typed GapFillGatewayError
 *    carrying filePath and status so llmGapFillStep can record it on
 *    `steps_payload.gapFill.failures[]` without halting the run.
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('gatewayClient - gapFill', () => {
  // Each test isolates modules + clears mocks so the singleton axios instance
  // is rebuilt with fresh spies.
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: Success path -- POSTs to the V3 gap-fill route and returns parsed response
  // ==========================================================================
  it('POSTs the assembled prompt to /api/v1/discovery/v3/gap-fill and returns the parsed response', async () => {
    const llmContent = JSON.stringify([
      {
        type: 'class',
        name: 'PatientController',
        filePath: 'src/main/java/PatientController.java',
        confidence: 0.9,
      },
    ]);

    const axios = require('axios');
    const mockPost = jest.fn().mockResolvedValueOnce({
      data: {
        content: llmContent,
        usage: { promptTokens: 300, completionTokens: 60, totalTokens: 360 },
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

    const assembledPrompt =
      '# Role\nYou are a discovery assistant.\n# Pack output\n```json\n[]\n```';
    const filePath = 'src/main/java/PatientController.java';
    const runId = 'run-abc-1';

    const result = await gatewayClient.gapFill(assembledPrompt, filePath, runId);

    // Called exactly once
    expect(mockPost).toHaveBeenCalledTimes(1);

    // Called with the correct URL and body shape
    expect(mockPost).toHaveBeenCalledWith('/api/v1/discovery/v3/gap-fill', {
      prompt: assembledPrompt,
      filePath,
      runId,
    });

    // Parsed response shape
    expect(result).toEqual({
      content: llmContent,
      usage: { promptTokens: 300, completionTokens: 60, totalTokens: 360 },
    });
  });

  // ==========================================================================
  // Test 2: Error path -- HTTP failure surfaces as a typed GapFillGatewayError
  // ==========================================================================
  it('surfaces HTTP failures as a typed GapFillGatewayError carrying filePath and status', async () => {
    // Bug-1 fix (2026-04-21): 5xx responses are now retried (exponential
    // backoff). Use a 4xx-non-retryable status (404) to assert the
    // immediate-surface path, since `429 / 5xx` are intentionally retried.
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

    const { gatewayClient, GapFillGatewayError } = require('../services/gatewayClient');

    const filePath = 'src/main/java/FailingFile.java';

    let caught: unknown = null;
    try {
      await gatewayClient.gapFill('any prompt', filePath, 'run-err-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GapFillGatewayError);
    const typed = caught as InstanceType<typeof GapFillGatewayError>;
    expect(typed.filePath).toBe(filePath);
    expect(typed.status).toBe(404);
    expect(typed.message).toContain(filePath);
    expect(typed.message).toContain('404');
    // Non-retryable: only one POST attempt.
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  // Bug-1 fix (2026-04-21): 429 is retried with exponential backoff.
  it('retries HTTP 429 with exponential backoff and succeeds on eventual 200', async () => {
    const rateLimited = new Error('Request failed with status code 429') as any;
    rateLimited.response = {
      status: 429,
      data: { error: 'rate limited' },
      headers: { 'retry-after': '0' }, // 0 = no wait, just retry immediately
    };
    rateLimited.isAxiosError = true;

    const okResponse = {
      data: { content: '[{"candidateType":"business_logics","name":"x","filePath":"x.ts","confidence":0.8,"description":"d"}]' },
    };

    const axios = require('axios');
    const mockPost = jest
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce(okResponse);
    const mockUse = jest.fn();
    const mockAxiosInstance = {
      post: mockPost,
      interceptors: { response: { use: mockUse } },
      defaults: { timeout: 7200000 },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const { gatewayClient } = require('../services/gatewayClient');

    const result = await gatewayClient.gapFill('any', 'file.ts', 'run-429');
    expect(result.content).toContain('business_logics');
    expect(mockPost).toHaveBeenCalledTimes(3);
  }, 10_000);

  // ==========================================================================
  // Test 3: Network failure (no HTTP response) still produces typed error with status=null
  // ==========================================================================
  it('wraps pure network failures (no HTTP response) as GapFillGatewayError with status=null', async () => {
    const networkError = new Error('connect ECONNREFUSED 127.0.0.1:8081') as any;
    networkError.isAxiosError = true;
    // No `.response` attached -- mimics a dropped connection.

    const axios = require('axios');
    const mockPost = jest.fn().mockRejectedValue(networkError);
    const mockUse = jest.fn();
    const mockAxiosInstance = {
      post: mockPost,
      interceptors: { response: { use: mockUse } },
      defaults: { timeout: 7200000 },
    };
    axios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    const { gatewayClient, GapFillGatewayError } = require('../services/gatewayClient');

    let caught: unknown = null;
    try {
      await gatewayClient.gapFill('any prompt', 'src/foo/Bar.java', 'run-err-2');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GapFillGatewayError);
    const typed = caught as InstanceType<typeof GapFillGatewayError>;
    expect(typed.status).toBeNull();
    expect(typed.filePath).toBe('src/foo/Bar.java');
  });
});
