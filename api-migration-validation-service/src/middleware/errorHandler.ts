import { Request, Response, NextFunction } from 'express';

/**
 * Error with status code for internal use.
 */
export interface HttpError extends Error {
  statusCode?: number;
}

/**
 * Express error handling middleware for the API Migration Validation Service.
 *
 * Catches errors and returns a JSON response with the error code and message.
 * Mirrors `discovery-service/src/middleware/errorHandler.ts` -- intentionally
 * minimal because the service surfaces redaction and tool-call errors via
 * structured diagnostics rather than HTTP error bodies.
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
