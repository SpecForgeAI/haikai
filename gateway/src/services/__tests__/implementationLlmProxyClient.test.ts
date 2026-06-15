/**
 * Tests for Implementation LLM Proxy Client
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 2: New Client Creation
 */

// Mock logger to prevent console output during tests
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('implementationLlmProxyClient', () => {
  // Store original environment
  const originalEnv = process.env;
  // Store original fetch
  const originalFetch = global.fetch;
  // Mock fetch function
  let mockFetch: jest.Mock;

  beforeEach(() => {
    // Reset modules to clear cached config
    jest.resetModules();
    // Clone the original environment
    process.env = { ...originalEnv };
    // Set required env vars for config loading
    process.env.OPENAI_API_KEY = 'test-api-key';

    // Create a fresh mock fetch for each test
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore fetch
    global.fetch = originalFetch;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
    // Ensure fetch is restored
    global.fetch = originalFetch;
  });

  describe('request()', () => {
    it('should inject Authorization header correctly when token is configured', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-bearer-token-123';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { request } = require('../implementationLlmProxyClient');

      // Mock successful response
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Act
      await request('/api/v1/test-endpoint', {
        method: 'POST',
        body: { data: 'test' },
      });

      // Assert - check that fetch was called with Authorization header
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/v1/test-endpoint');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-bearer-token-123');
    });

    it('should throw Error with descriptive message when token is missing/blank', async () => {
      // Arrange - no token configured
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = '';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { request } = require('../implementationLlmProxyClient');

      // Act & Assert
      await expect(
        request('/api/v1/test-endpoint', { method: 'GET' })
      ).rejects.toThrow('Implementation LLM Service Bearer token is not configured');

      // Verify fetch was never called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw Error with descriptive message when token is undefined', async () => {
      // Arrange - token not set at all (config returns empty string default)
      // Require first (triggers dotenv.config()), then clear the token
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';
      const { request } = require('../implementationLlmProxyClient');
      delete process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN;

      // Act & Assert
      await expect(
        request('/api/v1/test-endpoint', { method: 'GET' })
      ).rejects.toThrow('Implementation LLM Service Bearer token is not configured');

      // Verify fetch was never called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should construct correct URL from base URL + path', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://custom-host:9000';

      const { request } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      );

      // Act
      await request('/api/v1/shape-spec/stream', { method: 'GET' });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://custom-host:9000/api/v1/shape-spec/stream');
    });

    it('should NOT allow caller to override Authorization header', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'correct-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { request } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      // Act - try to override Authorization header
      await request('/api/v1/test-endpoint', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer malicious-token',
          'Content-Type': 'application/json',
        },
        body: { data: 'test' },
      });

      // Assert - request should use correct token, not the caller-provided one
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toHaveProperty('Authorization', 'Bearer correct-token');
    });

    it('should preserve caller-provided headers and options', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { request } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      // Act
      await request('/api/v1/test-endpoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
        body: { data: 'test' },
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toHaveProperty('Content-Type', 'application/json');
      expect(options.headers).toHaveProperty('X-Custom-Header', 'custom-value');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-token');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ data: 'test' }));
    });
  });

  describe('postJson()', () => {
    it('should set Content-Type and Accept headers to application/json', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { postJson } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      // Act
      await postJson('/api/v1/standards/global/generate', { company: 'TestCorp' });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers).toHaveProperty('Content-Type', 'application/json');
      expect(options.headers).toHaveProperty('Accept', 'application/json');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-token');
      expect(options.body).toBe(JSON.stringify({ company: 'TestCorp' }));
    });
  });

  describe('getJson()', () => {
    it('should set Accept header to application/json', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { getJson } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'test' }), { status: 200 })
      );

      // Act
      await getJson('/api/v1/health');

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('GET');
      expect(options.headers).toHaveProperty('Accept', 'application/json');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-token');
      // Should NOT have Content-Type for GET requests
      expect(options.body).toBeUndefined();
    });
  });

  describe('requestStream()', () => {
    it('should NOT set Accept: application/json header for SSE responses', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { requestStream } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response('data: test\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      // Act
      await requestStream('/api/v1/shape-spec/stream', {
        method: 'POST',
        body: { company: 'Global', project: 'TestProject' },
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      // Accept header should NOT be application/json for streaming
      expect(options.headers.Accept).toBeUndefined();
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-token');
    });

    it('should propagate AbortSignal correctly', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { requestStream } = require('../implementationLlmProxyClient');

      mockFetch.mockResolvedValueOnce(
        new Response('data: test\n\n', { status: 200 })
      );

      const abortController = new AbortController();

      // Act
      await requestStream('/api/v1/shape-spec/stream', {
        method: 'POST',
        body: { company: 'Global' },
        signal: abortController.signal,
      });

      // Assert - check that fetch was called with the signal
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBe(abortController.signal);
    });

    it('should abort fetch when AbortSignal is triggered', async () => {
      // Arrange
      process.env.IMPLEMENTATION_LLM_SERVICE_BEARER_TOKEN = 'test-token';
      process.env.IMPLEMENTATION_LLM_SERVICE_BASE_URL = 'http://localhost:8000';

      const { requestStream } = require('../implementationLlmProxyClient');

      const abortController = new AbortController();
      const abortError = new DOMException('The operation was aborted.', 'AbortError');

      // Mock fetch to reject with abort error
      mockFetch.mockRejectedValueOnce(abortError);

      // Act - abort immediately before the request completes
      abortController.abort();

      // Assert - should propagate the abort error with correct name
      try {
        await requestStream('/api/v1/test-endpoint', {
          method: 'POST',
          body: { data: 'test' },
          signal: abortController.signal,
        });
        // Should not reach here
        fail('Expected requestStream to throw an error');
      } catch (error) {
        expect((error as DOMException).name).toBe('AbortError');
        expect((error as DOMException).message).toBe('The operation was aborted.');
      }
    });
  });
});
