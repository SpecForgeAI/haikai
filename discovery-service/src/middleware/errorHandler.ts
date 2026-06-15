import { Request, Response, NextFunction } from 'express';

/**
 * Error with status code for internal use.
 */
export interface HttpError extends Error {
  statusCode?: number;
}

/**
 * Express error handling middleware for Discovery Service.
 *
 * Catches errors and returns a JSON response with the error code and message.
 * Simplified version of mcp-server error handler -- omits Axios-specific handling
 * since the discovery service makes no backend calls in this skeleton increment.
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

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      code: statusCode,
      message,
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
