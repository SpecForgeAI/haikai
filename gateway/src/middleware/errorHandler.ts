/**
 * Global error handler middleware
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

/**
 * Error with HTTP status code for internal use
 */
export interface HttpError extends Error {
  statusCode?: number;
  isAxiosError?: boolean;
  code?: string;
}

/**
 * Known error types for classification
 */
export type ErrorType =
  | 'VALIDATION_ERROR'
  | 'OPENAI_ERROR'
  | 'MCP_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Classifies an error and returns appropriate status code and message
 */
function classifyError(err: HttpError): { statusCode: number; message: string; type: ErrorType } {
  // Validation errors (from validateRequest middleware)
  if (err.statusCode === 400) {
    return {
      statusCode: 400,
      message: err.message || 'Bad Request',
      type: 'VALIDATION_ERROR',
    };
  }

  // Rate limit errors
  if (err.statusCode === 429) {
    return {
      statusCode: 429,
      message: 'Too many requests, please try again later',
      type: 'RATE_LIMIT_ERROR',
    };
  }

  // OpenAI errors (usually from our client wrapper)
  if (err.message?.includes('OpenAI') || err.name === 'OpenAIError') {
    return {
      statusCode: 502,
      message: 'AI service temporarily unavailable',
      type: 'OPENAI_ERROR',
    };
  }

  // Axios errors (from MCP calls)
  if (err.isAxiosError || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return {
      statusCode: 502,
      message: 'Backend service unavailable',
      type: 'MCP_ERROR',
    };
  }

  // Default: use provided status code or 500
  return {
    statusCode: err.statusCode || 500,
    message: err.statusCode ? err.message : 'Internal server error',
    type: 'UNKNOWN_ERROR',
  };
}

/**
 * Global Express error handling middleware.
 *
 * Security considerations:
 * - Never exposes stack traces to clients
 * - Never exposes internal error details
 * - Logs full error details internally with requestId
 *
 * Error mapping:
 * - Validation errors -> 400 Bad Request
 * - OpenAI errors -> 502 Bad Gateway
 * - MCP errors -> 502 Bad Gateway
 * - Rate limit -> 429 Too Many Requests
 * - Unknown -> 500 Internal Server Error
 *
 * @param err - The error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If headers already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  const { statusCode, message, type } = classifyError(err);
  const requestId = req.requestId || 'unknown';

  // Log full error details internally (never to client)
  logger.error('Request error', {
    requestId,
    errorType: type,
    statusCode,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Return safe error response to client (no internal details)
  res.status(statusCode).json({
    error: {
      code: statusCode,
      message,
      requestId,
    },
  });
}

/**
 * Creates an HTTP error with a status code.
 *
 * @param statusCode - HTTP status code
 * @param message - Error message
 * @returns An error with statusCode property
 */
export function createHttpError(statusCode: number, message: string): HttpError {
  const error: HttpError = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Creates a validation error (400 Bad Request)
 */
export function createValidationError(message: string): HttpError {
  return createHttpError(400, message);
}

/**
 * Creates an OpenAI error (502 Bad Gateway)
 */
export function createOpenAIError(message: string): HttpError {
  const error = createHttpError(502, message);
  error.name = 'OpenAIError';
  return error;
}

/**
 * Creates an MCP error (502 Bad Gateway)
 */
export function createMCPError(message: string): HttpError {
  const error = createHttpError(502, message);
  error.isAxiosError = true;
  return error;
}
