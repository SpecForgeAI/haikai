/**
 * Tests for the LlmClient factory pattern and singleton convenience function.
 * Spec 2026-03-06: Azure OpenAI LLM Provider - Task Group 3
 *
 * Mocks both openaiClient.sendChatRequest and azureOpenaiClient.createAzureOpenAIClient
 * to verify factory routing and singleton behaviour.
 */

import type { Config } from '../config';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the logger to suppress console output
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logOpenAIRequest: jest.fn(),
}));

// Fake sendChatRequest for the openai provider path
const mockOpenaiSendChatRequest = jest.fn().mockResolvedValue({
  id: 'openai-resp-1',
  content: 'Hello from OpenAI',
  isFinal: true,
  usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
});

jest.mock('../services/openaiClient', () => ({
  sendChatRequest: mockOpenaiSendChatRequest,
  buildToolResultMessages: jest.fn(),
  // Re-export types (jest doesn't care about TS types, but keeps imports happy)
}));

// Fake Azure client returned by createAzureOpenAIClient
const mockAzureSendChatRequest = jest.fn().mockResolvedValue({
  id: 'azure-resp-1',
  content: 'Hello from Azure',
  isFinal: true,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const mockCreateAzureOpenAIClient = jest.fn().mockReturnValue({
  sendChatRequest: mockAzureSendChatRequest,
});

jest.mock('../services/azureOpenaiClient', () => ({
  createAzureOpenAIClient: mockCreateAzureOpenAIClient,
}));

// Mock getConfig -- we control what it returns per test via mockReturnValue
const mockGetConfig = jest.fn();
jest.mock('../config', () => ({
  getConfig: mockGetConfig,
  loadConfig: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Config object with the given llmProvider */
function makeConfig(llmProvider: 'openai' | 'azure-openai'): Config {
  return {
    llmProvider,
    openaiApiKey: 'test-key',
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
    azureAuthEndpoint: 'https://auth.example.com/token',
    azureApiUsername: 'user',
    azureApiPassword: 'pass',
    azureChatEndpoint: 'https://chat.example.com/genai/oai',
    azureApiVersion: '2025-11-13',
    azureApiModel: 'gpt-4o-2024-08-06',
    discoveryServiceBaseUrl: '',
    apiMigrationValidationServiceBaseUrl: '',
    migrationPlanLlmConcurrency: 4,
    migrationPlanExpansionBatchSize: 12,
    gatewayPublicBaseUrl: 'http://localhost:8081',
    buildResultsServiceToken: '',
  } as unknown as Config; // fixture: Config grows regularly; the factory pins only llm-relevant fields
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LlmClient Factory', () => {
  let createLlmClient: typeof import('../services/llmClient').createLlmClient;
  let getLlmClient: typeof import('../services/llmClient').getLlmClient;
  let resetLlmClient: typeof import('../services/llmClient').resetLlmClient;

  beforeAll(() => {
    const mod = require('../services/llmClient');
    createLlmClient = mod.createLlmClient;
    getLlmClient = mod.getLlmClient;
    resetLlmClient = mod.resetLlmClient;
  });

  beforeEach(() => {
    // Reset singleton between tests
    resetLlmClient();
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Test 1: createLlmClient with llmProvider 'openai' delegates to openaiClient
  // ==========================================================================
  it('createLlmClient with llmProvider openai returns an object whose sendChatRequest delegates to openaiClient.sendChatRequest', async () => {
    const config = makeConfig('openai');
    const client = createLlmClient(config);

    const messages = [{ role: 'user' as const, content: 'Hello' }];
    const result = await client.sendChatRequest(messages, 'req-1', 'sess-1');

    // Verify delegation to the mocked openai sendChatRequest
    expect(mockOpenaiSendChatRequest).toHaveBeenCalledTimes(1);
    // The function reference is passed directly, so it receives exactly
    // the arguments the caller provided (3 args, no trailing undefined)
    expect(mockOpenaiSendChatRequest.mock.calls[0][0]).toEqual(messages);
    expect(mockOpenaiSendChatRequest.mock.calls[0][1]).toBe('req-1');
    expect(mockOpenaiSendChatRequest.mock.calls[0][2]).toBe('sess-1');
    expect(result.id).toBe('openai-resp-1');

    // Azure factory should NOT have been called
    expect(mockCreateAzureOpenAIClient).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 2: createLlmClient with llmProvider 'azure-openai' returns Azure client
  // ==========================================================================
  it('createLlmClient with llmProvider azure-openai returns an Azure client instance', async () => {
    const config = makeConfig('azure-openai');
    const client = createLlmClient(config);

    const messages = [{ role: 'user' as const, content: 'Hello Azure' }];
    const result = await client.sendChatRequest(messages, 'req-2', 'sess-2');

    // Verify createAzureOpenAIClient was called with the config
    expect(mockCreateAzureOpenAIClient).toHaveBeenCalledTimes(1);
    expect(mockCreateAzureOpenAIClient).toHaveBeenCalledWith(config);

    // Verify the Azure client's sendChatRequest was invoked
    expect(mockAzureSendChatRequest).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('azure-resp-1');

    // OpenAI sendChatRequest should NOT have been called
    expect(mockOpenaiSendChatRequest).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 3: getLlmClient lazily creates singleton, same instance on repeat calls
  // ==========================================================================
  it('getLlmClient lazily creates a singleton and returns the same instance on subsequent calls', () => {
    const config = makeConfig('openai');
    mockGetConfig.mockReturnValue(config);

    const client1 = getLlmClient();
    const client2 = getLlmClient();

    // Same reference
    expect(client1).toBe(client2);

    // getConfig should have been called only once (lazy init)
    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  // ==========================================================================
  // Test 4: getLlmClient uses getConfig() to determine provider
  // ==========================================================================
  it('getLlmClient uses getConfig() to determine the provider', async () => {
    const azureConfig = makeConfig('azure-openai');
    mockGetConfig.mockReturnValue(azureConfig);

    const client = getLlmClient();

    // Should have called getConfig to get the provider
    expect(mockGetConfig).toHaveBeenCalledTimes(1);

    // Should have delegated to Azure factory
    expect(mockCreateAzureOpenAIClient).toHaveBeenCalledTimes(1);
    expect(mockCreateAzureOpenAIClient).toHaveBeenCalledWith(azureConfig);

    // Verify the client works as an Azure client
    const messages = [{ role: 'user' as const, content: 'Singleton test' }];
    await client.sendChatRequest(messages, 'req-3', 'sess-3');
    expect(mockAzureSendChatRequest).toHaveBeenCalledTimes(1);
  });
});
