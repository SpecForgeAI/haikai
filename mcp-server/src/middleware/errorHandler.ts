import { Request, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import { McpToolResponse } from '../types';

/**
 * Error with status code for internal use
 */
export interface HttpError extends Error {
  statusCode?: number;
  isAxiosError?: boolean;
}

/**
 * Backend error response structure
 */
interface BackendErrorData {
  message?: string;
  error?: string;
}

/**
 * Express error handling middleware for MCP Server.
 *
 * Maps errors from the architecture-model-service backend:
 * - 400 Bad Request: Passed through as-is
 * - 404 Not Found: Passed through as-is
 * - 500+ Server Error: Mapped to 502 Bad Gateway
 *
 * @param err - The error object
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware function
 */
export function errorHandler(
  err: HttpError | AxiosError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If headers already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  let statusCode: number;
  let message: string;

  // Handle Axios errors (from backend calls)
  if (isAxiosError(err)) {
    const backendStatus = err.response?.status;
    const responseData = err.response?.data as BackendErrorData | undefined;
    const backendMessage =
      responseData?.message ||
      responseData?.error ||
      err.message;

    if (backendStatus === 400) {
      // Bad Request - pass through
      statusCode = 400;
      message = backendMessage || 'Bad Request';
    } else if (backendStatus === 404) {
      // Not Found - pass through
      statusCode = 404;
      message = backendMessage || 'Not Found';
    } else if (backendStatus && backendStatus >= 500) {
      // Server errors -> 502 Bad Gateway
      statusCode = 502;
      message = 'Backend service error';
    } else if (!err.response) {
      // Network error (backend unavailable)
      statusCode = 502;
      message = 'Backend service unavailable';
    } else {
      // Other errors -> 502
      statusCode = 502;
      message = backendMessage || 'Backend service error';
    }
  } else {
    // Handle non-Axios errors
    statusCode = (err as HttpError).statusCode || 500;
    message = err.message || 'Internal Server Error';
  }

  const response: McpToolResponse<never> = {
    error: {
      code: statusCode,
      message,
    },
  };

  res.status(statusCode).json(response);
}

/**
 * Type guard for Axios errors
 */
function isAxiosError(error: unknown): error is AxiosError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'isAxiosError' in error &&
    (error as AxiosError).isAxiosError === true
  );
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
