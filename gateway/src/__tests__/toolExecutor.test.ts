/**
 * Tests for gateway tool wiring: save_product_artifacts
 *
 * Validates that the new save_product_artifacts tool is properly registered
 * in the gateway's tool definitions, allow-list, and validation logic.
 */

import { isToolAllowed, validateToolArguments } from '../services/toolExecutor';
import { TOOL_DEFINITIONS } from '../types';

describe('Gateway Tool Wiring: save_product_artifacts', () => {

  it('isToolAllowed returns true for save_product_artifacts', () => {
    const result = isToolAllowed('save_product_artifacts');
    expect(result).toBe(true);
  });

  it('validateToolArguments returns valid for complete save_product_artifacts arguments', () => {
    const result = validateToolArguments('save_product_artifacts', {
      projectParentFolder: '/path',
      projectId: 'uuid',
      productName: 'name',
      missionMarkdown: '# Mission',
    });
    expect(result).toEqual({ valid: true });
  });

  it('validateToolArguments returns invalid when projectId is missing', () => {
    const result = validateToolArguments('save_product_artifacts', {
      projectParentFolder: '/path',
      productName: 'name',
      missionMarkdown: '# Mission',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('projectId');
  });

  it('TOOL_DEFINITIONS contains save_product_artifacts with all 4 required params', () => {
    const definition = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'save_product_artifacts'
    );
    expect(definition).toBeDefined();
    expect(definition!.function.parameters.required).toContain('projectParentFolder');
    expect(definition!.function.parameters.required).toContain('projectId');
    expect(definition!.function.parameters.required).toContain('productName');
    expect(definition!.function.parameters.required).toContain('missionMarkdown');
  });

});

// ============================================================================
// Gap-Filling Test D (Task Group 4):
// executeTool routes save_product_artifacts to correct URL with correct body
// ============================================================================

// Mock axios at module level for the executeTool integration test
jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  return {
    ...actualAxios,
    post: jest.fn(),
    isAxiosError: actualAxios.isAxiosError,
  };
});

// Mock config to provide a stable mcpBaseUrl
jest.mock('../config', () => ({
  getConfig: () => ({
    mcpBaseUrl: 'http://localhost:8090',
  }),
}));

// Mock logger to prevent log noise in tests
jest.mock('../services/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  logToolCall: jest.fn(),
}));

describe('Gateway executeTool: save_product_artifacts routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executeTool constructs correct URL and request body for save_product_artifacts', async () => {
    const axios = require('axios');

    // Mock a successful response from the MCP server
    axios.post.mockResolvedValue({
      data: {
        writtenPaths: ['agent-os/product/MISSION.MD'],
        productUpserted: true,
      },
      status: 200,
    });

    // Import executeTool after mocks are set up
    const { executeTool } = require('../services/toolExecutor');

    const toolArgs = {
      projectParentFolder: '/workspace/my-project',
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      productName: 'Test Product',
      missionMarkdown: '# Mission Statement',
    };

    const result = await executeTool(
      'save_product_artifacts',
      toolArgs,
      'mcp-session-001',
      'req-001',
      'session-001'
    );

    // Verify axios.post was called with the correct URL
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [calledUrl, calledBody] = axios.post.mock.calls[0];

    expect(calledUrl).toBe('http://localhost:8090/mcp/tools/save_product_artifacts');

    // Verify request body includes sessionId and all tool args
    expect(calledBody).toEqual({
      sessionId: 'mcp-session-001',
      projectParentFolder: '/workspace/my-project',
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      productName: 'Test Product',
      missionMarkdown: '# Mission Statement',
    });

    // Verify the result contains the expected data
    expect(result.status).toBe(200);
  });
});
