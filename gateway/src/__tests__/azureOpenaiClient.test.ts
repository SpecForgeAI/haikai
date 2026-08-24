/**
 * Tests for Azure OpenAI client (token fetch, caching, chat request)
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 2
 *
 * All HTTP interactions are mocked via global.fetch.
 * Token cache is reset before each test for isolation.
 */

import type { Config } from '../config';

// Mock the logger to prevent console output during tests
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logOpenAIRequest: jest.fn(),
}));

// Mock config module -- we do NOT need getConfig() in the Azure client tests
// since the client takes config as a parameter, but it is imported by openaiClient
jest.mock('../config', () => ({
  getConfig: jest.fn(() => ({})),
  loadConfig: jest.fn(() => ({})),
}));

// Helper to build a minimal Config object with Azure fields populated
function makeAzureConfig(overrides?: Partial<Config>): Config {
  return {
    openaiApiKey: '',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: '',
    openaiTimeoutMs: 30000,
    mcpBaseUrl: '',
    architectureModelServiceBaseUrl: '',
    implementationLlmServiceBaseUrl: '',
    implementationLlmServiceBearerToken: '',
    jiraServiceBaseUrl: '',
    jiraBrowseBaseUrl: '',
    conversationPersistBasePath: '',
    port: 8081,
    maxToolCallsPerTurn: 8,
    maxOasBytes: 2097152,
    maxMessageBytes: 32768,
    rateLimitRpm: 60,
    rateLimitBurst: 20,
    sessionTtlHours: 24,
    maxConversationMessages: 80,
    maxConversationBytes: 200000,
    logLevel: 'info',
    allowedOrigins: [],
    enableToolTrace: false,
    condensedContext: { maxDtoCount: 50, maxJsonChars: 40000 },
    registryBasePath: '',
    llmProvider: 'azure-openai',
    azureAuthEndpoint: 'https://auth.example.com/token',
    azureApiUsername: 'testuser',
    azureApiPassword: 'testpass',
    azureChatEndpoint: 'https://chat.example.com/genai/oai',
    azureApiVersion: '2025-11-13',
    azureApiModel: 'gpt-4o-2024-08-06',
    ...overrides,
  } as Config;
}

// Standard Azure chat completion response shape
function makeChatResponse(overrides?: Record<string, unknown>) {
  return {
    id: 'chatcmpl-abc123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o-2024-08-06',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello from Azure!',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  };
}

// Standard chat response with tool calls
function makeChatResponseWithToolCalls() {
  return {
    id: 'chatcmpl-tool456',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o-2024-08-06',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'list_interfaces',
                arguments: '{"company":"TestCorp","project":"MyProject"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
    },
  };
}

describe('Azure OpenAI Client', () => {
  // Store the original global.fetch
  const originalFetch = global.fetch;

  // Import the module under test -- done after mocks are set up
  let fetchBearerToken: typeof import('../services/azureOpenaiClient').fetchBearerToken;
  let resetAzureTokenCache: typeof import('../services/azureOpenaiClient').resetAzureTokenCache;
  let createAzureOpenAIClient: typeof import('../services/azureOpenaiClient').createAzureOpenAIClient;

  beforeAll(() => {
    const mod = require('../services/azureOpenaiClient');
    fetchBearerToken = mod.fetchBearerToken;
    resetAzureTokenCache = mod.resetAzureTokenCache;
    createAzureOpenAIClient = mod.createAzureOpenAIClient;
  });

  beforeEach(() => {
    // Reset the token cache before each test for isolation
    resetAzureTokenCache();
    // Reset the fetch mock
    global.fetch = jest.fn();
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Test 1: fetchBearerToken sends POST with Basic auth and returns trimmed token
  // ==========================================================================
  describe('fetchBearerToken', () => {
    it('should POST to azureAuthEndpoint with Basic auth header and return trimmed token text', async () => {
      const config = makeAzureConfig();
      const expectedBasic = Buffer.from('testuser:testpass').toString('base64');

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('  my-bearer-token-value  \n'),
      });

      const token = await fetchBearerToken(config);

      // Verify fetch was called with correct URL and headers
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('https://auth.example.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${expectedBasic}`,
        },
      });

      // Verify token is trimmed
      expect(token).toBe('my-bearer-token-value');
    });

    // ========================================================================
    // Test 2: fetchBearerToken throws AzureOpenAIError on non-2xx response
    // ========================================================================
    it('should throw AzureOpenAIError on non-2xx response with status code and body in message', async () => {
      const config = makeAzureConfig();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized: Invalid credentials'),
      });

      try {
        await fetchBearerToken(config);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.name).toBe('AzureOpenAIError');
        expect(error.message).toContain('401');
        expect(error.message).toContain('Unauthorized');
      }
    });
  });

  // ==========================================================================
  // Test 3: Token caching -- second call within 5 minutes reuses cached token
  // ==========================================================================
  describe('Token caching', () => {
    it('should reuse cached token on second call within 5 minutes (no second fetch)', async () => {
      const config = makeAzureConfig();

      // Mock fetch for token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('cached-token-123'),
      });

      // Mock fetch for the first chat request
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      // Mock fetch for the second chat request (should NOT trigger a new token fetch)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      const client = createAzureOpenAIClient(config);

      // First call -- fetches token + makes chat request (2 fetches)
      await client.sendChatRequest(
        [{ role: 'user', content: 'Hello' }],
        'req-1',
        'sess-1'
      );

      // Second call -- should reuse cached token (1 fetch: chat only)
      await client.sendChatRequest(
        [{ role: 'user', content: 'Hello again' }],
        'req-2',
        'sess-2'
      );

      // Total fetch calls: 1 (token) + 1 (chat) + 1 (chat) = 3
      // NOT 4 (which would mean a second token fetch)
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    // ========================================================================
    // Test 4: Token expiry -- call after 5 minutes fetches a new token
    // ========================================================================
    it('should fetch a new token after 5 minutes have elapsed', async () => {
      const config = makeAzureConfig();

      // Mock first token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('token-v1'),
      });

      // Mock first chat request
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      const client = createAzureOpenAIClient(config);

      // First call -- fetches token + chat
      await client.sendChatRequest(
        [{ role: 'user', content: 'Hello' }],
        'req-1',
        'sess-1'
      );

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Advance time by 5 minutes + 1ms to expire the token
      const realDateNow = Date.now;
      const baseTime = Date.now();
      Date.now = jest.fn(() => baseTime + 5 * 60 * 1000 + 1);

      // Mock second token fetch (after expiry)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('token-v2'),
      });

      // Mock second chat request
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      // Second call -- should fetch a new token because 5 minutes have passed
      await client.sendChatRequest(
        [{ role: 'user', content: 'Hello after expiry' }],
        'req-2',
        'sess-2'
      );

      // Total: 2 (first call) + 2 (second call with token refresh) = 4
      expect(global.fetch).toHaveBeenCalledTimes(4);

      // Restore Date.now
      Date.now = realDateNow;
    });
  });

  // ==========================================================================
  // Test 5: sendChatRequest constructs correct URL
  // ==========================================================================
  describe('sendChatRequest', () => {
    it('should construct URL as ${azureChatEndpoint}/${azureApiModel}/chat/completions?api-version=${azureApiVersion}', async () => {
      const config = makeAzureConfig({
        azureChatEndpoint: 'https://myhost.com/genai/oai',
        azureApiModel: 'gpt-5.1-2025-11-13',
        azureApiVersion: '2025-11-13',
      });

      // Mock token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('test-token'),
      });

      // Mock chat request
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      const client = createAzureOpenAIClient(config);
      await client.sendChatRequest(
        [{ role: 'user', content: 'Test' }],
        'req-url',
        'sess-url'
      );

      // The second fetch call should be the chat request with the correct URL
      const chatFetchCall = (global.fetch as jest.Mock).mock.calls[1];
      expect(chatFetchCall[0]).toBe(
        'https://myhost.com/genai/oai/gpt-5.1-2025-11-13/chat/completions?api-version=2025-11-13'
      );
    });

    // ========================================================================
    // Test 6: sendChatRequest sends Bearer token and correct JSON body
    // ========================================================================
    it('should send Bearer token in Authorization header and correct JSON body (model, messages, tools, tool_choice)', async () => {
      const config = makeAzureConfig();

      // Mock token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('my-azure-token'),
      });

      // Mock chat request
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      const testTools = [
        {
          type: 'function' as const,
          function: {
            name: 'list_interfaces',
            description: 'List interfaces',
            parameters: { type: 'object' as const, properties: {} },
          },
        },
      ];

      const client = createAzureOpenAIClient(config);
      await client.sendChatRequest(
        [{ role: 'user', content: 'Test with tools' }],
        'req-tools',
        'sess-tools',
        { tools: testTools, toolChoice: 'auto' }
      );

      // Verify the second fetch (chat request) has the correct headers and body
      const chatFetchCall = (global.fetch as jest.Mock).mock.calls[1];
      const fetchOptions = chatFetchCall[1];

      // Check Authorization header has Bearer token
      expect(fetchOptions.headers['Authorization']).toBe('Bearer my-azure-token');
      expect(fetchOptions.headers['Content-Type']).toBe('application/json');

      // Check body
      const body = JSON.parse(fetchOptions.body);
      expect(body.model).toBe('gpt-4o-2024-08-06');
      expect(body.messages).toEqual([{ role: 'user', content: 'Test with tools' }]);
      expect(body.tools).toEqual(testTools);
      expect(body.tool_choice).toBe('auto');
    });

    // ========================================================================
    // Test 7: sendChatRequest maps response to OpenAIResponse shape
    // ========================================================================
    it('should map response to OpenAIResponse shape (id, content, toolCalls, isFinal, usage)', async () => {
      const config = makeAzureConfig();

      // Mock token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('test-token'),
      });

      // Test 7a: text content response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponse()),
      });

      const client = createAzureOpenAIClient(config);
      const textResult = await client.sendChatRequest(
        [{ role: 'user', content: 'Hello' }],
        'req-map',
        'sess-map'
      );

      expect(textResult).toEqual({
        id: 'chatcmpl-abc123',
        content: 'Hello from Azure!',
        toolCalls: undefined,
        isFinal: true,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      });

      // Test 7b: tool call response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeChatResponseWithToolCalls()),
      });

      const toolResult = await client.sendChatRequest(
        [{ role: 'user', content: 'Call a tool' }],
        'req-map-tools',
        'sess-map-tools'
      );

      expect(toolResult).toEqual({
        id: 'chatcmpl-tool456',
        // Content mapping is now always a string ('' on tool-call turns)
        content: '',
        toolCalls: [
          {
            callId: 'call_abc123',
            name: 'list_interfaces',
            arguments: { company: 'TestCorp', project: 'MyProject' },
          },
        ],
        isFinal: false,
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
      });
    });

    // ========================================================================
    // Test 8: sendChatRequest throws AzureOpenAIError on non-2xx chat response
    // ========================================================================
    it('should throw AzureOpenAIError on non-2xx chat response', async () => {
      const config = makeAzureConfig();

      // Mock token fetch (succeeds)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('valid-token'),
      });

      // Mock chat request (fails with 500). A 429 is no longer a plain
      // throw: the rate-limit program (Spec 2026-07-22) cool-down-retries
      // per-minute 429s (60s sleeps — this test used to time out on it) and
      // throws LlmDailyLimitError on per-day; both have their own coverage.
      // The plain non-2xx throw path is pinned with a non-rate-limit status.
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal server error'),
      });

      const client = createAzureOpenAIClient(config);

      try {
        await client.sendChatRequest(
          [{ role: 'user', content: 'Rate limited' }],
          'req-fail',
          'sess-fail'
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.name).toBe('AzureOpenAIError');
        expect(error.message).toContain('500');
        expect(error.message).toContain('Internal server error');
        expect(error.message).toContain('req-fail');
      }
    });
  });
});
