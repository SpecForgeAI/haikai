import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware for logging MCP tool requests.
 *
 * Logs:
 * - Tool name (derived from URL path)
 * - Session ID (from request body)
 * - Key identifiers (filename or interfaceId)
 *
 * Does NOT log full request/response payloads.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only log POST requests to MCP tool endpoints
  if (req.method !== 'POST' || !req.path.startsWith('/mcp/tools/')) {
    return next();
  }

  const startTime = Date.now();
  const toolName = extractToolName(req.path);
  const sessionId = req.body?.sessionId || 'unknown';

  // Extract key identifiers based on tool
  const identifiers = extractIdentifiers(req.body, toolName);

  // Log request
  console.log(
    `[MCP] ${toolName} | session=${sessionId}${identifiers}`
  );

  // Use res.on('finish') to log response info
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;

    console.log(
      `[MCP] ${toolName} | session=${sessionId} | status=${status} | duration=${duration}ms`
    );
  });

  next();
}

/**
 * Extracts the tool name from the request path.
 *
 * @param path - Request path (e.g., "/mcp/tools/list_interfaces")
 * @returns Tool name (e.g., "list_interfaces")
 */
function extractToolName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * Extracts key identifiers from the request body based on tool type.
 *
 * @param body - Request body
 * @param toolName - Name of the tool being called
 * @returns Formatted string with identifiers
 */
function extractIdentifiers(
  body: Record<string, unknown> | undefined,
  toolName: string
): string {
  if (!body) {
    return '';
  }

  const identifiers: string[] = [];

  if (toolName === 'list_interfaces' && body.filename) {
    identifiers.push(`filename=${body.filename}`);
  }

  if (toolName === 'get_interface_oas_context' && body.interfaceId) {
    identifiers.push(`interfaceId=${body.interfaceId}`);
  }

  return identifiers.length > 0 ? ` | ${identifiers.join(' | ')}` : '';
}
