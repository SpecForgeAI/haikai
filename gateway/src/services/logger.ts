/**
 * Structured logging service using winston
 */

import winston from 'winston';

// Default log level for initialization before config is loaded
const DEFAULT_LOG_LEVEL = 'info';

/**
 * Creates a winston logger with structured JSON output.
 *
 * Features:
 * - JSON format for structured logging
 * - Timestamp included in every log entry
 * - Colorized output for development
 * - Respects LOG_LEVEL configuration
 *
 * @param logLevel - Log level (error, warn, info, http, verbose, debug, silly)
 * @returns Configured winston logger
 */
function createLogger(logLevel: string = DEFAULT_LOG_LEVEL): winston.Logger {
  const format = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env.NODE_ENV === 'development'
      ? winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
            return `${timestamp} [${level}] ${message} ${metaStr}`;
          })
        )
      : winston.format.json()
  );

  return winston.createLogger({
    level: logLevel,
    format,
    defaultMeta: { service: 'gateway' },
    transports: [
      new winston.transports.Console(),
    ],
  });
}

// Create singleton logger instance
export const logger = createLogger(process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL);

/**
 * Log a request start event
 */
export function logRequestStart(
  requestId: string,
  sessionId: string,
  method: string,
  path: string
): void {
  logger.info('Request started', {
    event: 'request_start',
    requestId,
    sessionId,
    method,
    path,
  });
}

/**
 * Log a request completion event
 */
export function logRequestEnd(
  requestId: string,
  sessionId: string,
  statusCode: number,
  durationMs: number
): void {
  logger.info('Request completed', {
    event: 'request_end',
    requestId,
    sessionId,
    statusCode,
    durationMs,
  });
}

/**
 * Log a tool call event
 */
export function logToolCall(
  requestId: string,
  sessionId: string,
  toolName: string,
  status: number,
  durationMs: number
): void {
  logger.info('Tool call completed', {
    event: 'tool_call',
    requestId,
    sessionId,
    toolName,
    status,
    durationMs,
  });
}

/**
 * Log OpenAI request metrics
 */
export function logOpenAIRequest(
  requestId: string,
  sessionId: string,
  durationMs: number,
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }
): void {
  logger.info('OpenAI request completed', {
    event: 'openai_request',
    requestId,
    sessionId,
    durationMs,
    ...tokenUsage,
  });
}

/**
 * Log OAS content metadata (not the content itself for security)
 */
export function logOasContent(
  requestId: string,
  sessionId: string,
  contentLength: number,
  contentHash?: string
): void {
  logger.debug('OAS content processed', {
    event: 'oas_content',
    requestId,
    sessionId,
    contentLength,
    contentHash,
  });
}
