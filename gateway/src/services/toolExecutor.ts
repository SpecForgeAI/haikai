/**
 * Tool execution service for MCP tool calls
 */

import axios, { AxiosError } from 'axios';
import { getConfig } from '../config';
import { logger, logToolCall } from './logger';
import {
  ToolName,
  ALLOWED_TOOL_NAMES,
  ToolResult,
  TOOL_DEFINITIONS,
  ListInterfacesParams,
  GetInterfaceOasContextParams,
  ComputeOasGapsParams,
  SaveOasSpecParams,
  SaveProductArtifactsParams,
  SaveArchitectureBaselineParams,
  SaveRoadmapStructureParams,
  SaveMarkdownArtifactParams,
  SaveUsersInteractionsParams,
  SaveBacklogItemsParams,
  SaveTemporaryArchitectureDiagramParams,
  SaveUserJourneysParams,
  SaveDiscoveryConfigParams,
  SaveProjectAnchorEntitiesParams,
  CreateProjectArtifactParams,
} from '../types';

/**
 * MCP endpoint mapping for each tool
 */
const TOOL_ENDPOINTS: Record<ToolName, string> = {
  list_interfaces: '/mcp/tools/list_interfaces',
  get_interface_oas_context: '/mcp/tools/get_interface_oas_context',
  compute_oas_gaps: '/mcp/tools/compute_oas_gaps',
  save_oas_spec: '/mcp/tools/save_oas_spec',
  save_product_artifacts: '/mcp/tools/save_product_artifacts',
  save_architecture_baseline: '/mcp/tools/save_architecture_baseline',
  save_roadmap_structure: '/mcp/tools/save_roadmap_structure',
  save_markdown_artifact: '/mcp/tools/save_markdown_artifact',
  save_users_interactions: '/mcp/tools/save_users_interactions',
  save_backlog_items: '/mcp/tools/save_backlog_items',
  saveTemporaryArchitectureDiagram: '/mcp/tools/saveTemporaryArchitectureDiagram',
  save_user_journeys: '/mcp/tools/save_user_journeys',
  save_discovery_config: '/mcp/tools/save_discovery_config',
  save_project_anchor_entities: '/mcp/tools/save_project_anchor_entities',
  create_project_artifact: '/mcp/tools/create_project_artifact',
};

/**
 * Required parameters for each tool
 */
const TOOL_REQUIRED_PARAMS: Record<ToolName, string[]> = {
  list_interfaces: ['filename'],
  get_interface_oas_context: ['interfaceId'],
  compute_oas_gaps: ['interfaceId'],
  save_oas_spec: ['filename', 'interfaceId', 'format', 'oasContents'],
  save_product_artifacts: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown'],
  save_architecture_baseline: ['projectId', 'architectureBaselineJson'],
  save_roadmap_structure: ['projectId', 'roadmapJson'],
  save_markdown_artifact: ['projectId', 'artifactFilename', 'markdown'],
  save_users_interactions: ['projectId', 'usersInteractionsJson'],
  save_backlog_items: ['projectId', 'backlogJson'],
  saveTemporaryArchitectureDiagram: ['projectId', 'diagramJson'],
  save_user_journeys: ['projectId', 'userJourneysJson'],
  save_discovery_config: ['projectId', 'discoveryConfigJson'],
  save_project_anchor_entities: ['projectId', 'applications', 'appComponents'],
  create_project_artifact: ['projectId', 'artifactType', 'content', 'source'],
};

/**
 * Check if a tool name is in the allowed list.
 *
 * @param toolName - Tool name to check
 * @returns true if tool is allowed
 */
export function isToolAllowed(toolName: string): toolName is ToolName {
  return ALLOWED_TOOL_NAMES.includes(toolName as ToolName);
}

/**
 * Validate tool arguments against required parameters.
 *
 * @param toolName - Name of the tool
 * @param args - Arguments to validate
 * @returns Validation result with error message if invalid
 */
export function validateToolArguments(
  toolName: ToolName,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  const requiredParams = TOOL_REQUIRED_PARAMS[toolName];

  for (const param of requiredParams) {
    if (args[param] === undefined || args[param] === null || args[param] === '') {
      return {
        valid: false,
        error: `Missing required parameter: ${param}`,
      };
    }
  }

  // Additional validation for save_oas_spec format
  if (toolName === 'save_oas_spec') {
    const format = args.format;
    if (format !== 'yaml' && format !== 'json') {
      return {
        valid: false,
        error: 'format must be "yaml" or "json"',
      };
    }
  }

  return { valid: true };
}

/**
 * Execute a tool by calling the MCP server.
 *
 * @param toolName - Name of the tool to execute
 * @param args - Tool arguments
 * @param mcpSessionId - Session ID for MCP server
 * @param requestId - Request ID for logging
 * @param sessionId - Session ID for logging
 * @returns Tool execution result
 */
export async function executeTool(
  toolName: ToolName,
  args: Record<string, unknown>,
  mcpSessionId: string,
  requestId: string,
  sessionId: string
): Promise<{ result: unknown; status: number; durationMs: number }> {
  const config = getConfig();
  const endpoint = TOOL_ENDPOINTS[toolName];
  const url = `${config.mcpBaseUrl}${endpoint}`;
  const startTime = Date.now();

  try {
    // Prepare request body with sessionId
    const requestBody = {
      sessionId: mcpSessionId,
      ...args,
    };

    logger.debug('Executing tool', {
      requestId,
      sessionId,
      toolName,
      endpoint,
    });

    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout for tool calls
    });

    const durationMs = Date.now() - startTime;

    logToolCall(requestId, sessionId, toolName, response.status, durationMs);

    // Return the data from the response
    // MCP returns { data: ... } or { error: ... }
    return {
      result: response.data.data || response.data,
      status: response.status,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      logToolCall(
        requestId,
        sessionId,
        toolName,
        axiosError.response?.status || 500,
        durationMs
      );

      // Extract error message from response if available
      // MCP may return either { error: { message: "..." } } or { success: false, errors: [...] }
      const responseData = axiosError.response?.data as
        | { error?: { message?: string }; success?: boolean; errors?: { field: string; entityType: string; entityName: string; message: string }[] }
        | undefined;

      let errorMessage: string;
      if (responseData?.errors && Array.isArray(responseData.errors)) {
        // Structured validation errors from MCP — format them for the LLM
        errorMessage = 'Validation failed: ' + responseData.errors.map(e => e.message).join('; ');
      } else {
        errorMessage = responseData?.error?.message || axiosError.message;
      }

      return {
        result: { error: errorMessage },
        status: axiosError.response?.status || 502,
        durationMs,
      };
    }

    // Unknown error
    logToolCall(requestId, sessionId, toolName, 500, durationMs);

    return {
      result: { error: 'Unknown error executing tool' },
      status: 500,
      durationMs,
    };
  }
}

/**
 * Execute a tool call from OpenAI and return a ToolResult.
 *
 * @param callId - OpenAI call ID
 * @param toolName - Name of the tool
 * @param args - Tool arguments (parsed JSON)
 * @param mcpSessionId - Session ID for MCP server
 * @param requestId - Request ID for logging
 * @param sessionId - Session ID for logging
 * @returns Tool result for OpenAI
 */
export async function executeToolCall(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  mcpSessionId: string,
  requestId: string,
  sessionId: string
): Promise<ToolResult & { status: number; durationMs: number }> {
  // Validate tool name
  if (!isToolAllowed(toolName)) {
    return {
      callId,
      error: `Unknown tool: ${toolName}. Allowed tools are: ${ALLOWED_TOOL_NAMES.join(', ')}`,
      status: 400,
      durationMs: 0,
    };
  }

  // Validate arguments
  const validation = validateToolArguments(toolName, args);
  if (!validation.valid) {
    return {
      callId,
      error: validation.error,
      status: 400,
      durationMs: 0,
    };
  }

  // Execute the tool
  const { result, status, durationMs } = await executeTool(
    toolName,
    args,
    mcpSessionId,
    requestId,
    sessionId
  );

  // Check if result is an error
  const resultObj = result as { error?: string };
  if (resultObj?.error) {
    return {
      callId,
      error: resultObj.error,
      status,
      durationMs,
    };
  }

  return {
    callId,
    output: result,
    status,
    durationMs,
  };
}

/**
 * Get tool definitions for OpenAI API.
 * Returns the TOOL_DEFINITIONS array.
 */
export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}
