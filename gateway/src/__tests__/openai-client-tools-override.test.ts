/**
 * Tests for ChatRequestOptions extension: tools and toolChoice override
 *
 * Spec: Increment 5 -- Wire Confirmation, Mission Generation, and Tool Execution
 * Task Group 1: ChatRequestOptions Extension
 */

import { TOOL_DEFINITIONS, ToolDefinition } from '../types';

// Mock config
jest.mock('../config', () => ({
  getConfig: () => ({
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTimeoutMs: 60000,
  }),
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  logOpenAIRequest: jest.fn(),
}));

// Capture the createParams passed to OpenAI client.chat.completions.create
let capturedCreateParams: Record<string, unknown> | null = null;

const mockCreate = jest.fn().mockImplementation((params: Record<string, unknown>) => {
  capturedCreateParams = params;
  return Promise.resolve({
    id: 'chatcmpl-test-123',
    choices: [
      {
        message: {
          content: '{"phase":"questions","questions":["What is the scope?"]}',
          tool_calls: undefined,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  });
});

// Mock the OpenAI module
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { sendChatRequest, resetOpenAIClient, OpenAIMessage, ChatRequestOptions } from '../services/openaiClient';

describe('ChatRequestOptions tools/toolChoice override', () => {
  const testMessages: OpenAIMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    capturedCreateParams = null;
    mockCreate.mockClear();
    resetOpenAIClient();
  });

  it('should use provided tools array instead of getOpenAITools() when options.tools is set', async () => {
    // Arrange: provide only the save_product_artifacts tool definition
    const saveProductArtifactsTool = TOOL_DEFINITIONS.find(
      (t) => t.function.name === 'save_product_artifacts'
    )!;
    const customTools: ToolDefinition[] = [saveProductArtifactsTool];

    const options: ChatRequestOptions = {
      tools: customTools,
    };

    // Act
    await sendChatRequest(testMessages, 'req-1', 'sess-1', options);

    // Assert: createParams.tools should be the custom tools, not all TOOL_DEFINITIONS
    expect(capturedCreateParams).not.toBeNull();
    const toolsParam = capturedCreateParams!.tools as ToolDefinition[];
    expect(toolsParam).toHaveLength(1);
    expect(toolsParam[0].function.name).toBe('save_product_artifacts');

    // Verify it is NOT the full set of TOOL_DEFINITIONS
    expect(toolsParam.length).toBeLessThan(TOOL_DEFINITIONS.length);
  });

  it('should use provided toolChoice value instead of auto when options.toolChoice is set', async () => {
    // Arrange: provide custom tools and a forced tool_choice
    const saveProductArtifactsTool = TOOL_DEFINITIONS.find(
      (t) => t.function.name === 'save_product_artifacts'
    )!;

    const forcedToolChoice = {
      type: 'function',
      function: { name: 'save_product_artifacts' },
    };

    const options: ChatRequestOptions = {
      tools: [saveProductArtifactsTool],
      toolChoice: forcedToolChoice,
    };

    // Act
    await sendChatRequest(testMessages, 'req-2', 'sess-2', options);

    // Assert: createParams.tool_choice should be the forced value, not 'auto'
    expect(capturedCreateParams).not.toBeNull();
    expect(capturedCreateParams!.tool_choice).toEqual(forcedToolChoice);
    expect(capturedCreateParams!.tool_choice).not.toBe('auto');
  });

  it('should preserve existing default behavior when neither tools nor toolChoice is provided and jsonMode is false', async () => {
    // Arrange: no options (or empty options)
    const options: ChatRequestOptions = {};

    // Act
    await sendChatRequest(testMessages, 'req-3', 'sess-3', options);

    // Assert: createParams should use all TOOL_DEFINITIONS with tool_choice 'auto'
    expect(capturedCreateParams).not.toBeNull();
    const toolsParam = capturedCreateParams!.tools as ToolDefinition[];
    expect(toolsParam.length).toBe(TOOL_DEFINITIONS.length);
    expect(capturedCreateParams!.tool_choice).toBe('auto');

    // Verify response_format is NOT set
    expect(capturedCreateParams!.response_format).toBeUndefined();
  });

  it('should preserve jsonMode behavior (no tools, response_format: json_object) regardless of tools/toolChoice fields', async () => {
    // Arrange: jsonMode true AND tools/toolChoice provided -- jsonMode takes precedence
    const saveProductArtifactsTool = TOOL_DEFINITIONS.find(
      (t) => t.function.name === 'save_product_artifacts'
    )!;

    const options: ChatRequestOptions = {
      jsonMode: true,
      tools: [saveProductArtifactsTool],
      toolChoice: {
        type: 'function',
        function: { name: 'save_product_artifacts' },
      },
    };

    // Act
    await sendChatRequest(testMessages, 'req-4', 'sess-4', options);

    // Assert: jsonMode takes precedence -- no tools, has response_format
    expect(capturedCreateParams).not.toBeNull();
    expect(capturedCreateParams!.response_format).toEqual({ type: 'json_object' });
    expect(capturedCreateParams!.tools).toBeUndefined();
    expect(capturedCreateParams!.tool_choice).toBeUndefined();
  });
});
