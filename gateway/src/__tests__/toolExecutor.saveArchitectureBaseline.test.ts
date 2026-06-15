/**
 * Tests for gateway tool wiring: save_architecture_baseline
 *
 * Validates that the new save_architecture_baseline tool is properly registered
 * in the gateway's tool definitions, allow-list, and validation logic.
 *
 * TG6 tests (original 4) plus TG7 gap-fill tests (2 additional).
 */

import { isToolAllowed, validateToolArguments } from '../services/toolExecutor';
import { TOOL_DEFINITIONS } from '../types';

describe('Gateway Tool Wiring: save_architecture_baseline', () => {

  it('isToolAllowed returns true for save_architecture_baseline', () => {
    const result = isToolAllowed('save_architecture_baseline');
    expect(result).toBe(true);
  });

  it('validateToolArguments returns valid for complete save_architecture_baseline arguments', () => {
    const result = validateToolArguments('save_architecture_baseline', {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      architectureBaselineJson: '{}',
    });
    expect(result).toEqual({ valid: true });
  });

  it('validateToolArguments returns invalid when projectId is missing', () => {
    const result = validateToolArguments('save_architecture_baseline', {
      architectureBaselineJson: '{}',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('projectId');
  });

  it('TOOL_DEFINITIONS contains save_architecture_baseline with both required params', () => {
    const definition = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'save_architecture_baseline'
    );
    expect(definition).toBeDefined();
    expect(definition!.function.parameters.required).toContain('projectId');
    expect(definition!.function.parameters.required).toContain('architectureBaselineJson');
  });

});

// ============================================================================
// TG7 Gap-Fill Tests
// ============================================================================

// Test 5 (TG7): validateToolArguments returns invalid when architectureBaselineJson is missing
describe('Gateway Tool Wiring: save_architecture_baseline - gap fill', () => {

  it('validateToolArguments returns invalid when architectureBaselineJson is missing', () => {
    const result = validateToolArguments('save_architecture_baseline', {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('architectureBaselineJson');
  });

});

// ============================================================================
// Test 6 (TG7): Gateway executeTool routes save_architecture_baseline to
// correct MCP endpoint URL with correct request body structure
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

describe('Gateway executeTool: save_architecture_baseline routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executeTool constructs correct URL and request body for save_architecture_baseline', async () => {
    const axios = require('axios');

    // Mock a successful response from the MCP server
    axios.post.mockResolvedValue({
      data: {
        success: true,
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        filename: 'Test Project',
        summary: {
          applications: 1,
          services: 2,
        },
        createdEntities: {
          services: [{ name: 'OrderService', id: 'svc-abc' }],
        },
      },
      status: 200,
    });

    // Import executeTool after mocks are set up
    const { executeTool } = require('../services/toolExecutor');

    const baselinePayload = JSON.stringify({
      services: [{ name: 'OrderService' }, { name: 'PaymentService' }],
      interfaces: [{ name: 'Order API', serviceRef: 'OrderService' }],
    });

    const toolArgs = {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      architectureBaselineJson: baselinePayload,
    };

    const result = await executeTool(
      'save_architecture_baseline',
      toolArgs,
      'mcp-session-001',
      'req-001',
      'session-001'
    );

    // Verify axios.post was called with the correct URL
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [calledUrl, calledBody] = axios.post.mock.calls[0];

    expect(calledUrl).toBe('http://localhost:8090/mcp/tools/save_architecture_baseline');

    // Verify request body includes sessionId and all tool args
    expect(calledBody).toEqual({
      sessionId: 'mcp-session-001',
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      architectureBaselineJson: baselinePayload,
    });

    // Verify the result contains the expected data
    expect(result.status).toBe(200);
    expect(result.result).toHaveProperty('success', true);
    expect(result.result).toHaveProperty('projectId', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });
});
