/**
 * Gap analysis tests for Azure OpenAI LLM Provider.
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 5
 *
 * These tests fill critical coverage gaps identified during test review:
 * 1. Config validation error lists ALL missing Azure vars in one message
 * 2. Azure client handles malformed JSON response from chat endpoint gracefully
 * 3. getLlmClient() returns correct provider type after resetLlmClient() with changed config
 * 4. Tool call parsing with edge-case arguments (empty object)
 * 5. buildToolResultMessages re-export from llmClient.ts works correctly
 *
 * All tests use jest.isolateModulesAsync to load fresh module instances,
 * avoiding conflicts between tests that need the real module vs. mocks.
 */

// ============================================================================
// Gap 1: Config validation error lists ALL missing Azure vars
// ============================================================================
describe('Config validation - all missing Azure vars listed (Gap 1)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should list ALL missing Azure env vars in a single error message, not just the first', async () => {
    process.env.LLM_PROVIDER = 'azure-openai';
    delete process.env.AZURE_AUTH_ENDPOINT;
    delete process.env.AZURE_API_USERNAME;
    delete process.env.AZURE_API_PASSWORD;
    delete process.env.AZURE_CHAT_ENDPOINT;
    delete process.env.AZURE_API_VERSION;
    delete process.env.AZURE_API_MODEL;
    delete process.env.OPENAI_API_KEY;

    let thrownError: Error | null = null;

    await jest.isolateModulesAsync(async () => {
      const { loadConfig } = require('../config');
      try {
        loadConfig();
      } catch (err: unknown) {
        thrownError = err as Error;
      }
    });

    expect(thrownError).not.toBeNull();

    // The SINGLE error message must contain ALL six missing variable names
    const msg = thrownError!.message;
    expect(msg).toContain('AZURE_AUTH_ENDPOINT');
    expect(msg).toContain('AZURE_API_USERNAME');
    expect(msg).toContain('AZURE_API_PASSWORD');
    expect(msg).toContain('AZURE_CHAT_ENDPOINT');
    expect(msg).toContain('AZURE_API_VERSION');
    expect(msg).toContain('AZURE_API_MODEL');
  });
});

// ============================================================================
// Gap 2 & 4: Azure client - malformed JSON and empty arguments parsing
// ============================================================================
describe('Azure OpenAI Client - Gap Tests (Gap 2 & 4)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ==========================================================================
  // Gap 2: Malformed JSON response from chat endpoint
  // ==========================================================================
  it('should throw an error when chat endpoint returns malformed JSON', async () => {
    jest.resetModules();

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logOpenAIRequest: jest.fn(),
      }));
      jest.doMock('../config', () => ({
        getConfig: jest.fn(() => ({})),
        loadConfig: jest.fn(() => ({})),
      }));

      const { resetAzureTokenCache, createAzureOpenAIClient } = require('../services/azureOpenaiClient');
      resetAzureTokenCache();

      global.fetch = jest.fn();

      const config = {
        llmProvider: 'azure-openai' as const,
        azureAuthEndpoint: 'https://auth.example.com/token',
        azureApiUsername: 'testuser',
        azureApiPassword: 'testpass',
        azureChatEndpoint: 'https://chat.example.com/genai/oai',
        azureApiVersion: '2025-11-13',
        azureApiModel: 'gpt-4o-2024-08-06',
      };

      // Mock token fetch (succeeds)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('valid-token'),
      });

      // Mock chat response -- ok:true but json() throws a parse error
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
      });

      const client = createAzureOpenAIClient(config);

      await expect(
        client.sendChatRequest(
          [{ role: 'user', content: 'Hello' }],
          'req-malformed',
          'sess-malformed'
        )
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Gap 4: Tool call parsing with empty arguments object
  // ==========================================================================
  it('should parse tool calls with empty arguments object correctly', async () => {
    jest.resetModules();

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logOpenAIRequest: jest.fn(),
      }));
      jest.doMock('../config', () => ({
        getConfig: jest.fn(() => ({})),
        loadConfig: jest.fn(() => ({})),
      }));

      const { resetAzureTokenCache, createAzureOpenAIClient } = require('../services/azureOpenaiClient');
      resetAzureTokenCache();

      global.fetch = jest.fn();

      const config = {
        llmProvider: 'azure-openai' as const,
        azureAuthEndpoint: 'https://auth.example.com/token',
        azureApiUsername: 'testuser',
        azureApiPassword: 'testpass',
        azureChatEndpoint: 'https://chat.example.com/genai/oai',
        azureApiVersion: '2025-11-13',
        azureApiModel: 'gpt-4o-2024-08-06',
      };

      // Mock token fetch
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('test-token'),
      });

      // Mock chat response with tool call that has empty arguments
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'chatcmpl-empty-args',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_empty',
                      type: 'function',
                      function: {
                        name: 'list_all_projects',
                        arguments: '{}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
      });

      const client = createAzureOpenAIClient(config);
      const result = await client.sendChatRequest(
        [{ role: 'user', content: 'List projects' }],
        'req-empty-args',
        'sess-empty-args'
      );

      // Verify tool calls are parsed correctly with empty args
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        callId: 'call_empty',
        name: 'list_all_projects',
        arguments: {},
      });
      expect(result.isFinal).toBe(false);
      // Content mapping is now always a string ('' on tool-call turns)
      expect(result.content).toBe('');
    });
  });
});

// ============================================================================
// Gap 3: getLlmClient() returns correct provider after resetLlmClient()
// ============================================================================
describe('LlmClient - provider switching after reset (Gap 3)', () => {
  it('should return the correct provider type after resetLlmClient() with changed config', async () => {
    jest.resetModules();

    await jest.isolateModulesAsync(async () => {
      const mockOpenaiSendChatRequest = jest.fn().mockResolvedValue({
        id: 'openai-gap-1',
        content: 'From OpenAI',
        isFinal: true,
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      });

      const mockAzureSendChatRequest = jest.fn().mockResolvedValue({
        id: 'azure-gap-1',
        content: 'From Azure',
        isFinal: true,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });

      const mockGetConfig = jest.fn();

      jest.doMock('../services/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logOpenAIRequest: jest.fn(),
      }));

      jest.doMock('../services/openaiClient', () => ({
        sendChatRequest: mockOpenaiSendChatRequest,
        buildToolResultMessages: jest.fn(),
      }));

      jest.doMock('../services/azureOpenaiClient', () => ({
        createAzureOpenAIClient: jest.fn(() => ({
          sendChatRequest: mockAzureSendChatRequest,
        })),
      }));

      jest.doMock('../config', () => ({
        getConfig: mockGetConfig,
        loadConfig: jest.fn(),
      }));

      const { getLlmClient, resetLlmClient } = require('../services/llmClient');

      // Start with OpenAI
      mockGetConfig.mockReturnValue({ llmProvider: 'openai' });

      const client1 = getLlmClient();
      const result1 = await client1.sendChatRequest(
        [{ role: 'user', content: 'Hello' }],
        'req-switch-1',
        'sess-switch-1'
      );
      expect(result1.id).toBe('openai-gap-1');
      expect(mockOpenaiSendChatRequest).toHaveBeenCalledTimes(1);
      expect(mockAzureSendChatRequest).not.toHaveBeenCalled();

      // Reset and switch to Azure
      resetLlmClient();
      mockGetConfig.mockReturnValue({ llmProvider: 'azure-openai' });

      const client2 = getLlmClient();
      const result2 = await client2.sendChatRequest(
        [{ role: 'user', content: 'Hello Azure' }],
        'req-switch-2',
        'sess-switch-2'
      );
      expect(result2.id).toBe('azure-gap-1');
      expect(mockAzureSendChatRequest).toHaveBeenCalledTimes(1);

      // They should be different instances
      expect(client1).not.toBe(client2);
    });
  });
});

// ============================================================================
// Gap 5: buildToolResultMessages re-export from llmClient.ts works correctly
// ============================================================================
describe('LlmClient - buildToolResultMessages re-export (Gap 5)', () => {
  it('should re-export buildToolResultMessages from llmClient.ts', async () => {
    jest.resetModules();

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../services/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        logOpenAIRequest: jest.fn(),
      }));
      jest.doMock('../config', () => ({
        getConfig: jest.fn(() => ({})),
        loadConfig: jest.fn(() => ({})),
      }));

      const mockBuildToolResultMessages = jest.fn();
      jest.doMock('../services/openaiClient', () => ({
        sendChatRequest: jest.fn(),
        buildToolResultMessages: mockBuildToolResultMessages,
      }));
      jest.doMock('../services/azureOpenaiClient', () => ({
        createAzureOpenAIClient: jest.fn(),
      }));

      const llmClientModule = require('../services/llmClient');

      // Verify buildToolResultMessages is exported and is the same function
      expect(llmClientModule.buildToolResultMessages).toBeDefined();
      expect(typeof llmClientModule.buildToolResultMessages).toBe('function');
      expect(llmClientModule.buildToolResultMessages).toBe(mockBuildToolResultMessages);
    });
  });
});
